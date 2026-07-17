const DEFAULT_RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const CONNECTIVITY_CODES = new Set([
  'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET',
]);

export function isConnectivityError(error) {
  const code = String(error?.cause?.code || error?.code || '').toUpperCase();
  return CONNECTIVITY_CODES.has(code)
    || /fetch failed|connection refused|network unreachable/i.test(String(error?.message || ''));
}

export async function fetchWithRetries(url, options = {}, retryOptions = {}) {
  const attempts = Math.max(1, Number(retryOptions.attempts || 3));
  const timeoutMs = Math.max(1000, Number(retryOptions.timeoutMs || 30000));
  const retryStatuses = retryOptions.retryStatuses || DEFAULT_RETRYABLE_STATUS;
  const retryNetwork = retryOptions.retryNetwork || isConnectivityError;
  const timeoutScope = retryOptions.timeoutScope || 'request';
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      let response;
      if (timeoutScope === 'connect') {
        // Streaming responses may legitimately remain open for several minutes.
        // Limit only the wait for response headers; aborting the same signal
        // later also kills an already healthy SSE body mid-generation.
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
          response = await fetch(url, { ...options, signal: controller.signal });
        } finally {
          clearTimeout(timeoutId);
        }
      } else {
        response = await fetch(url, {
          ...options,
          signal: AbortSignal.timeout(timeoutMs),
        });
      }
      if (!retryStatuses.has(response.status) || attempt >= attempts) return response;
      await response.body?.cancel().catch(() => {});
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !retryNetwork(error)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(2000, 250 * (2 ** (attempt - 1)))));
  }
  throw lastError || new Error('Network request failed');
}
