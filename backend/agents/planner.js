import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config.js';

/**
 * Safely parse JSON from AI model output, stripping markdown fences if present.
 */
function safeParsePlannerJSON(raw) {
  let text = raw.trim();
  // Strip markdown code fences: ```json ... ``` or ``` ... ```
  if (text.includes('```')) {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) text = match[1].trim();
  }
  // Try to extract JSON object if there's leading text
  if (!text.startsWith('{')) {
    const idx = text.indexOf('{');
    if (idx !== -1) text = text.slice(idx);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('[Planner] Failed to parse AI output as JSON:', e.message);
    console.error('[Planner] Raw output:', raw.substring(0, 500));
    // Return a safe fallback that triggers clarify
    return {
      intent: 'clarify',
      clarify_msg: 'AI 返回了无法解析的响应，请重新描述您的需求。',
      model: '',
      prompt: '',
      copywriting: {},
      context_update: {},
      reasoning: ['AI 输出解析失败，自动回退到 clarify 模式']
    };
  }
}

const PLANNER_SYSTEM_PROMPT = `你是一个高级AI商用设计助手（类似Lovart AI）。
你需要分析用户对服装/商用商品图的生图或改图指令，并结合当前的“品牌与产品上下文”输出执行计划。

你的输出必须是一个合法的 JSON 对象，包含以下字段：
1. "intent": 意图识别，必须是 ["generate", "refine", "copywrite", "clarify", "general"] 之一。
   - "generate": 用户想生成全新的商品场景图。
   - "refine": 用户指明要修改现有画面的特定元素或光线（如“调亮一点”、“换个晴天背景”）。
   - "copywrite": 用户单纯只想修改或生成文案。
   - "clarify": 用户意图极其不明确、过于简短或有歧义时（例如只说“优化”或“怎么做”），需要向用户反问以获取更多意图信息。
   - "general": 其他聊天。
1.5 "clarify_msg": 如果 intent 是 "clarify"，请在这里填写你需要询问用户的反问语句（如“请问您具体想要生成什么场景的背景，或者需要修改哪里的文案呢？”）。如果不是，可为空。
2. "model": 推荐的生图模型，必须是 ["image_model_a", "image_model_b"] 之一。
   - 如果用户追求真实物理质感、电商棚拍、真实人像，推荐 "image_model_a"。
   - 如果用户要求插画、动漫、创意手绘或特定艺术风格，推荐 "image_model_b"。
3. "prompt": 生成图片背景场景的英文提示词（约100字）。只描述背景、灯光、道具、整体色调，不要描述商品本身复杂的结构，因为我们会单独叠加商品抠图。如果是 "refine"，这里填写针对画面调整的英文精修或重绘提示词。
4. "copywriting": 自动为商品生成的文案（若不需要则为空对象）：
   - "title": 吸引人的广告标题（15字以内）
   - "subtitle": 卖点副标题（25字以内）
5. "context_update": 从用户输入中提取或推断的品牌/产品信息更新（若无更新则不填）：
   - "brand_name": 品牌名
   - "style": 视觉风格（如 极清、森系、复古、高端）
   - "color_palette": 配色方案（字符串数组）
   - "product_name": 产品名称
   - "product_category": 产品品类
   - "selling_points": 卖点（字符串数组）
6. "reasoning": 包含 3-4 条思考分析的链条（字符串数组），体现规划过程。

请严格输出 JSON 格式。`;

export async function runPlanner(userInstruction, brandMemory, key, customProxy) {
  const providerKey = key || config.AI_API_KEY || config.GEMINI_API_KEY;
  const provider = config.AI_PROVIDER;

  const userContextPrompt = `## 当前品牌与产品记忆
- 品牌名称: ${brandMemory.brand_name || '未知'}
- 视觉风格: ${brandMemory.style || '未指定'}
- 品牌色系: ${JSON.stringify(brandMemory.color_palette)}
- 产品名称: ${brandMemory.product_name || '未知'}
- 产品分类: ${brandMemory.product_category || '未指定'}
- 核心卖点: ${JSON.stringify(brandMemory.selling_points)}

## 用户最新指令
"${userInstruction}"

请根据上述信息，制定并返回 JSON 执行计划。`;

  if (provider === 'gemini') {
    const genAI = new GoogleGenerativeAI(providerKey);
    const rawProxy = customProxy || config.API_PROXY_URL;
    const proxyUrl = rawProxy ? { baseUrl: rawProxy } : undefined;
    const model = genAI.getGenerativeModel({
      model: config.AI_CHAT_MODEL,
      generationConfig: {
        responseMimeType: "application/json"
      }
    }, proxyUrl);

    const result = await model.generateContent([
      { text: PLANNER_SYSTEM_PROMPT },
      { text: userContextPrompt }
    ]);

    const text = result.response.text();
    return safeParsePlannerJSON(text);
  } else {
    // OpenAI-compatible Chat Completion JSON Mode
    const baseUrl = customProxy || config.AI_BASE_URL || 'https://api.openai.com/v1';
    const chatModel = config.AI_CHAT_MODEL;
    const url = `${baseUrl}/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${providerKey}`,
      },
      body: JSON.stringify({
        model: chatModel,
        messages: [
          { role: 'system', content: PLANNER_SYSTEM_PROMPT },
          { role: 'user', content: userContextPrompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'OpenAI-compatible planner request failed');
    }
    return safeParsePlannerJSON(data.choices[0].message.content);
  }
}
