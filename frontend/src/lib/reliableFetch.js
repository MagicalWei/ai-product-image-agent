const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function retryDelay(response, attempt) {
  const retryAfter = Number(response?.headers?.get?.('Retry-After'));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(5000, retryAfter * 1000);
  return Math.min(2500, 300 * (2 ** (attempt - 1)));
}

export async function fetchJsonWithRetry(url, options = {}, retryOptions = {}) {
  const attempts = Math.max(1, Number(retryOptions.attempts || 3));
  const timeoutMs = Math.max(1000, Number(retryOptions.timeoutMs || 45000));
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('请求超时')), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const text = await response.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { error: text || `请求失败（${response.status}）` };
      }
      if (!RETRYABLE_STATUS.has(response.status) || attempt >= attempts) {
        return { response, data };
      }
      await wait(retryDelay(response, attempt));
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) throw error;
      await wait(Math.min(2500, 300 * (2 ** (attempt - 1))));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error('请求失败');
}
