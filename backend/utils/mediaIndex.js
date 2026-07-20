import config from '../config.js';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

async function callMediaService(path, body, timeoutMs = 120_000) {
  const token = process.env.MEDIA_INDEX_INTERNAL_TOKEN || config.JWT_SECRET;
  const response = await fetch(`${AI_SERVICE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Token': token,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || `媒体向量服务调用失败 (HTTP ${response.status})`);
  }
  return data;
}

export function indexMediaAsset(payload) {
  return callMediaService('/agent/media/index', payload);
}

export function searchMediaAssets(payload) {
  return callMediaService('/agent/media/search', payload, 30_000);
}
