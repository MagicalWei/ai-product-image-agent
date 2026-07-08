// src/utils/geminiEvaluator.js
// Utility functions for Gemini API-based image evaluation

/**
 * Validates that a Gemini API key string matches expected format.
 * @param {string} apiKey - The API key to validate
 * @returns {boolean} Whether the key matches a valid format
 */
export function isValidApiKeyFormat(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') return false;
  // Gemini API keys typically start with 'AI' and are 39 characters
  return /^AI[a-zA-Z0-9_-]{35,}$/.test(apiKey.trim());
}

/**
 * Evaluates a product image using the Gemini API for quality scoring.
 * @param {string} imageDataUrl - Base64-encoded data URL of the image
 * @param {string} apiKey - Gemini API key
 * @param {object} options - Evaluation options
 * @param {string} [options.style] - The style category of the product image
 * @param {string} [options.prompt] - Custom evaluation prompt
 * @returns {Promise<object>} Evaluation result with scores and feedback
 */
export async function evaluateImageWithGemini(imageDataUrl, apiKey, options = {}) {
  if (!isValidApiKeyFormat(apiKey)) {
    throw new Error('Invalid Gemini API key format');
  }

  if (!imageDataUrl) {
    throw new Error('No image data provided');
  }

  const { style = 'general', prompt } = options;

  // Extract base64 data from data URL
  const base64Data = imageDataUrl.split(',')[1];
  const mimeType = imageDataUrl.split(';')[0].split(':')[1] || 'image/png';

  const evaluationPrompt = prompt || `You are a professional product photography critic. Analyze this product image and provide:
1. Overall quality score (1-10)
2. Composition score (1-10)
3. Lighting score (1-10)
4. Background quality score (1-10)
5. Product presentation score (1-10)
6. Brief feedback text (2-3 sentences)

Style category: ${style}

Return your response as JSON with keys: overallScore, compositionScore, lightingScore, backgroundScore, presentationScore, feedback`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: evaluationPrompt },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Data,
                },
              },
            ],
          }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 512,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Try to parse JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const result = JSON.parse(jsonMatch[0]);
        return {
          overallScore: result.overallScore || 5,
          compositionScore: result.compositionScore || 5,
          lightingScore: result.lightingScore || 5,
          backgroundScore: result.backgroundScore || 5,
          presentationScore: result.presentationScore || 5,
          feedback: result.feedback || 'Evaluation complete.',
          raw: text,
        };
      } catch (parseErr) {
        // JSON parse failed, return raw text
      }
    }

    return {
      overallScore: 5,
      compositionScore: 5,
      lightingScore: 5,
      backgroundScore: 5,
      presentationScore: 5,
      feedback: text || 'Unable to parse evaluation result.',
      raw: text,
    };
  } catch (error) {
    console.error('[geminiEvaluator] Evaluation failed:', error);
    throw error;
  }
}
