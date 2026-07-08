import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config.js';

export const EVALUATION_SYSTEM_PROMPT = `你是一个资深的电商视觉 AI 分析系统，负责为服装商品图进行专业级的多维度视觉评估。
你将收到一张服装商品图片，以及该商品的名称、核心卖点和用户的优化指令。

请你基于以下维度对图片进行严格评分（0-100 分），并给出专业的电商优化建议：

1. **lighting** (自然光影渲染)：光线是否自然、是否有高级感的光影层次
2. **composition** (构图比例美学)：构图是否平衡、主体是否突出、是否有视觉引导线
3. **branding** (品牌调性一致性)：是否符合该品类的高端定位、色调是否和谐
4. **photorealism** (质感高拟真度)：是否有明显的 AI 生成痕迹、面料质感是否真实

同时，请预估该图片在电商信息流广告中的表现：
- **ctr**: 预估点击率（行业基准约 3.0-3.5%，优秀为 5%+）
- **cvr**: 预估转化率（行业基准约 1.0-1.5%，优秀为 2%+）
- **quality**: 综合视觉品质评分（0-100）

请列出该图的视觉优势（positives，至少2条）和视觉劣化点（negatives，至少1条）。

最后，请给出一段 150-250 字的中文专业诊断建议（critique），包括：
- 当前图片的核心优势
- 最需要改进的 1-2 个方向
- 具体的生图提示词优化建议（如应该添加什么关键词）

你必须严格以如下 JSON 格式返回，不要包含任何 Markdown 标记或代码块标记：
{
  "ctr": 数字,
  "cvr": 数字,
  "quality": 整数,
  "lighting": 整数,
  "composition": 整数,
  "branding": 整数,
  "photorealism": 整数,
  "positives": ["优势1", "优势2"],
  "negatives": ["劣化点1"],
  "critique": "详细的专业诊断与优化建议文案..."
}`;

/**
 * Normalize raw AI evaluation output into a safe, clamped structure.
 */
export function normalizeEvaluation(raw) {
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  return {
    ctr: clamp(parseFloat(raw.ctr) || 4.5, 0.5, 12.0),
    cvr: clamp(parseFloat(raw.cvr) || 1.2, 0.2, 6.0),
    quality: clamp(parseInt(raw.quality) || 80, 0, 100),
    details: {
      lighting: clamp(parseInt(raw?.details?.lighting) || 80, 0, 100),
      composition: clamp(parseInt(raw?.details?.composition) || 80, 0, 100),
      branding: clamp(parseInt(raw?.details?.branding) || 80, 0, 100),
      photorealism: clamp(parseInt(raw?.details?.photorealism) || 80, 0, 100),
    },
    positives: Array.isArray(raw.positives) ? raw.positives : ['视觉表现良好'],
    negatives: Array.isArray(raw.negatives) ? raw.negatives : ['暂无明显缺陷'],
    critique: raw.critique || '评估完成，暂无额外建议。',
  };
}

/**
 * Safely parse JSON from evaluation model output, stripping markdown.
 */
function safeParseEvaluationJSON(raw) {
  let text = raw.trim();
  if (text.includes('```')) {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) text = match[1].trim();
  }
  if (!text.startsWith('{')) {
    const idx = text.indexOf('{');
    if (idx !== -1) text = text.slice(idx);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('[Evaluator] Failed to parse AI output as JSON:', e.message);
    return {
      ctr: 5.0, cvr: 1.5, quality: 85,
      positives: ['AI无法返回标准化评分，系统已采用预设值保障流程继续'],
      negatives: [],
      critique: '无。'
    };
  }
}

// Helper to download image URL to base64
async function downloadImageAsBase64(imgUrl) {
  const res = await fetch(imgUrl);
  if (!res.ok) {
    throw new Error(`Failed to download generated image from URL: ${imgUrl}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer).toString('base64');
}

// Helper for OpenAI-compatible Image Generation fallback to URL
async function generateBackgroundOpenAIUrlFallback(prompt, apiKey, baseUrl, imageModel) {
  const url = `${baseUrl}/images/generations`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: imageModel,
      prompt: prompt,
      n: 1,
      size: '1024x1024'
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || 'OpenAI-compatible image generation failed');
  }

  const imgUrl = data.data?.[0]?.url;
  if (!imgUrl) {
    throw new Error('OpenAI compatible API did not return an image URL');
  }

  return await downloadImageAsBase64(imgUrl);
}

// 1. Rewrite Prompt
export async function rewritePrompt(productInfo, userInstruction, key, customProxy) {
  if (process.env.NODE_ENV === 'test') {
    return `mock rewritten prompt for ${productInfo.name} with instruction: ${userInstruction}`;
  }
  const providerKey = key || config.AI_API_KEY || config.GEMINI_API_KEY;
  const provider = config.AI_PROVIDER;

  if (provider === 'gemini') {
    const genAI = new GoogleGenerativeAI(providerKey);
    const rawProxy = customProxy || config.API_PROXY_URL;
    const proxyUrl = rawProxy ? { baseUrl: rawProxy } : undefined;
    const model = genAI.getGenerativeModel({ model: config.AI_CHAT_MODEL }, proxyUrl);

    const systemPrompt = `你是一个电商商品背景生图提示词专家。你的任务是根据给出的商品名称、卖点，以及用户的优化指令，将它们融合成一段专门用于高质量生图模型的英文 Prompt。

  请遵循以下规范：
  1. 生成的 Prompt 必须是纯英文，100 词左右。
  2. 描述应该聚焦在商品所在的场景、背景、光影氛围上（例如：placed on a luxury wooden table, soft morning sunlight, blurred outdoor park background, warm tone, commercial product shot, 8k, high fidelity）。
  3. 注意：只描述"背景和场景环境"，不要在 Prompt 里过多地描述商品本身过于复杂的细节（因为商品主体我们会使用前端抠图叠加），主要描绘商品被优雅放置的环境和整体画面氛围。
  4. 只输出这段纯英文 Prompt，不要包含任何 markdown 块或前缀标签，不要有 'Here is your prompt:' 等多余废话。`;

    const userPrompt = `## 商品名称：${productInfo.name}
- 核心卖点：${productInfo.sellingPoints}
- 用户的修改或场景生成指令：${userInstruction}`;

    const result = await model.generateContent([
      { text: systemPrompt },
      { text: userPrompt },
    ]);

    return result.response.text().trim();
  } else {
    // OpenAI-compatible Chat Completion
    const baseUrl = customProxy || config.AI_BASE_URL || 'https://api.openai.com/v1';
    const chatModel = config.AI_CHAT_MODEL;
    const url = `${baseUrl}/chat/completions`;

    const systemPrompt = `You are an expert e-commerce product background image prompt engineer. Your task is to combine the product name, selling points, and user's instruction into a high-quality English prompt of about 100 words for image generation models.

  Follow these guidelines:
  1. The generated prompt must be in plain English, around 100 words.
  2. Describe the scene, background, lighting, and mood (e.g. placed on a luxury wooden table, soft morning sunlight, warm tone, commercial product shot, 8k).
  3. Focus only on the background scene, context and environment. Do not describe the product's complex details itself (since we overlay the product cutout in the frontend).
  4. Only output the prompt string itself. Do not include markdown headers, block markers, or quotes.`;

    const userPrompt = `Product Name: ${productInfo.name}
Selling Points: ${productInfo.sellingPoints}
User Instruction: ${userInstruction}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${providerKey}`,
      },
      body: JSON.stringify({
        model: chatModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'OpenAI-compatible prompt rewrite request failed');
    }
    return data.choices[0].message.content.trim();
  }
}

// 2. Evaluate Image
export async function evaluateImage(base64Data, productInfo, userInstruction, key, customProxy) {
  if (process.env.NODE_ENV === 'test') {
    return normalizeEvaluation({
      ctr: 5.2,
      cvr: 1.8,
      quality: 88,
      details: {
        lighting: 85,
        composition: 90,
        branding: 85,
        photorealism: 92
      },
      positives: ['Mock positive 1', 'Mock positive 2'],
      negatives: ['Mock negative 1'],
      critique: 'Mock critique建議。'
    });
  }
  const providerKey = key || config.AI_API_KEY || config.GEMINI_API_KEY;
  const provider = config.AI_PROVIDER;

  if (provider === 'gemini') {
    const genAI = new GoogleGenerativeAI(providerKey);
    const rawProxy = customProxy || config.API_PROXY_URL;
    const proxyUrl = rawProxy ? { baseUrl: rawProxy } : undefined;
    const model = genAI.getGenerativeModel({ model: config.AI_CHAT_MODEL }, proxyUrl);

    const userPrompt = `## 商品信息
- 商品名称：${productInfo.name}
- 核心卖点：${productInfo.sellingPoints}
- 当前视觉风格：${productInfo.styleId || '未指定'}

## 用户优化指令
${userInstruction || '请对当前图片进行首次全面评估'}

请严格按照系统要求的 JSON 格式返回评估结果。`;

    const result = await model.generateContent([
      { text: EVALUATION_SYSTEM_PROMPT },
      {
        inlineData: {
          mimeType: 'image/jpeg',
          data: base64Data,
        },
      },
      { text: userPrompt },
    ]);

    const responseText = result.response.text();
    const parsed = safeParseEvaluationJSON(responseText);
    return normalizeEvaluation(parsed);
  } else {
    // OpenAI-compatible Chat Completion (Vision payload)
    const baseUrl = customProxy || config.AI_BASE_URL || 'https://api.openai.com/v1';
    const chatModel = config.AI_CHAT_MODEL;
    const url = `${baseUrl}/chat/completions`;

    const userPrompt = `## 商品信息
- 商品名称：${productInfo.name}
- 核心卖点：${productInfo.sellingPoints}
- 当前视觉风格：${productInfo.styleId || '未指定'}

## 用户优化指令
${userInstruction || '请对当前图片进行首次全面评估'}

请严格按照系统要求的 JSON 格式返回评估结果。`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${providerKey}`,
      },
      body: JSON.stringify({
        model: chatModel,
        messages: [
          { role: 'system', content: EVALUATION_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: userPrompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${base64Data}`
                }
              }
            ]
          }
        ],
        response_format: { type: 'json_object' }
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'OpenAI-compatible image evaluation request failed');
    }

    const content = data.choices[0].message.content.trim();
    const parsed = safeParseEvaluationJSON(content);
    return normalizeEvaluation(parsed);
  }
}

// 3. Generate Background (with optional referenceImage for inpainting)
export async function generateBackground(prompt, key, customProxy, modelOverride, referenceImage = null) {
  if (process.env.NODE_ENV === 'test') {
    return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  }
  const providerKey = key || config.AI_API_KEY || config.GEMINI_API_KEY;
  const isDalle = modelOverride === 'dall-e-3' || modelOverride === 'dalle';
  const provider = modelOverride ? (isDalle ? 'openai' : 'gemini') : config.AI_PROVIDER;

  if (provider === 'gemini') {
    const proxyUrl = customProxy || config.API_PROXY_URL || 'https://generativelanguage.googleapis.com';
    const targetModel = modelOverride || config.AI_IMAGE_MODEL;
    const url = `${proxyUrl}/v1beta/models/${targetModel}:generateImages`;

    let response;
    let retries = 2;
    let lastError = null;

    while (retries > 0) {
      try {
        console.log(`[AI Image API] Generating background image... (Attempts left: ${retries})`);
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': providerKey },
          body: JSON.stringify({
            prompt,
            numberOfImages: 1,
            outputMimeType: 'image/jpeg',
            aspectRatio: '1:1',
          }),
        });
        if (response.ok) break;
        
        const errData = await response.json().catch(() => ({}));
        lastError = new Error(errData.error?.message || `HTTP ${response.status}`);
      } catch (e) {
        lastError = e;
      }
      retries--;
      if (retries > 0) {
        console.warn(`[AI Image API] Generation failed, retrying in 1.5s... Error: ${lastError.message}`);
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    if (!response || !response.ok) {
      throw new Error(`AI 图像生成底层模型调用错误: ${lastError?.message || '未知错误'}`);
    }

    const data = await response.json();

    const base64Bytes = data.generatedImages?.[0]?.image?.imageBytes;
    if (!base64Bytes) {
      throw new Error('AI 图像生成接口未返回有效的图像数据');
    }

    return base64Bytes;
  } else {
    // OpenAI-compatible Image Generation (/v1/images/generations)
    // If referenceImage is provided, use /v1/images/edits for inpainting
    const baseUrl = customProxy || config.AI_BASE_URL || 'https://api.openai.com/v1';
    const imageModel = modelOverride || config.AI_IMAGE_MODEL;

    if (referenceImage) {
      // Inpainting mode: use /v1/images/edits with the reference (annotated) image
      const url = `${baseUrl}/images/edits`;
      console.log(`[AI Image] Inpainting with prompt: "${prompt}" via model "${imageModel}"`);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${providerKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: imageModel,
            prompt: prompt,
            image: referenceImage,
            n: 1,
            size: '1024x1024',
            response_format: 'b64_json'
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          // Fallback: try generations with the prompt (no image edit support)
          console.warn('[AI Image] Image edit failed, falling back to generations...', data.error?.message);
        } else {
          const base64Bytes = data.data?.[0]?.b64_json;
          if (base64Bytes) return base64Bytes;
          const imgUrl = data.data?.[0]?.url;
          if (imgUrl) return await downloadImageAsBase64(imgUrl);
        }
      } catch (err) {
        console.warn('[AI Image] Image edit call failed, falling back to generations...', err.message);
      }
      // Fall through to standard generation if edit fails
    }

    const url = `${baseUrl}/images/generations`;

    console.log(`[AI Image] Generating background for prompt: "${prompt}" via model "${imageModel}"`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${providerKey}`,
        },
        body: JSON.stringify({
          model: imageModel,
          prompt: prompt,
          n: 1,
          size: '1024x1024',
          response_format: 'b64_json'
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        console.warn('[AI Image] b64_json request failed, trying URL format...', data.error?.message);
        return await generateBackgroundOpenAIUrlFallback(prompt, providerKey, baseUrl, imageModel);
      }

      const base64Bytes = data.data?.[0]?.b64_json;
      if (!base64Bytes) {
        const imgUrl = data.data?.[0]?.url;
        if (imgUrl) {
          return await downloadImageAsBase64(imgUrl);
        }
        throw new Error('OpenAI 图像生成未返回任何有效的图像数据或URL');
      }

      return base64Bytes;
    } catch (err) {
      console.warn('[AI Image] Direct image generation call failed, attempting URL fallback...', err.message);
      return await generateBackgroundOpenAIUrlFallback(prompt, providerKey, baseUrl, imageModel);
    }
  }
}
