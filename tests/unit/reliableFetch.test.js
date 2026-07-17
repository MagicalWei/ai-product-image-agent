import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithRetries, isConnectivityError } from '../../backend/utils/reliableFetch.js';
import { fetchJsonWithRetry } from '../../frontend/src/lib/reliableFetch.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('reliable fetch helpers', () => {
  it('recognizes connection errors', () => {
    expect(isConnectivityError({ cause: { code: 'ECONNREFUSED' }, message: 'fetch failed' })).toBe(true);
  });

  it('retries retryable backend responses', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await fetchWithRetries('http://agent.test', {}, { attempts: 2, timeoutMs: 1000 });
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not abort an established streaming response after the connect timeout', async () => {
    vi.useFakeTimers();
    let requestSignal;
    const fetchMock = vi.fn().mockImplementation(async (_url, options) => {
      requestSignal = options.signal;
      return new Response('event stream', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchWithRetries(
      'http://agent.test/stream',
      {},
      { attempts: 1, timeoutMs: 1000, timeoutScope: 'connect' },
    );
    expect(response.status).toBe(200);
    expect(requestSignal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(2000);
    expect(requestSignal.aborted).toBe(false);
  });

  it('retries upload JSON without changing the request body', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":"busy"}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"success":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchJsonWithRetry('/api/assets/upload', { method: 'POST', body: '{"id":"same"}' }, { attempts: 2, timeoutMs: 1000 });
    expect(result.data.success).toBe(true);
    expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[1][1].body);
  });
});
