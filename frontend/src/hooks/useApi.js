// src/hooks/useApi.js
import { useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';

/**
 * Custom hook for making authenticated API calls.
 *
 * Returns:
 *   - request(url, options): perform an API request with automatic cookie auth
 *   - loading: boolean indicating if a request is in-flight
 *   - error: the last error object, or null
 *
 * Behaviour:
 *   - Uses credentials: 'include' so browser automatically sends session cookies
 *   - 401 responses -> clears auth state (redirects to login)
 *   - 403 responses -> shows an upgrade prompt via toast
 *   - Network / other errors -> surfaces via toast and return value
 */
const useApi = () => {
  const { logout } = useAuth();
  const { showError } = useApp();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const request = useCallback(
    async (url, options = {}) => {
      setLoading(true);
      setError(null);

      // Build headers — no manual Authorization header needed
      const headers = { ...(options.headers || {}) };
      // Default to JSON if no Content-Type specified and there's a body
      if (!headers['Content-Type'] && options.body && typeof options.body === 'string') {
        headers['Content-Type'] = 'application/json';
      }

      // Track whether the error was already surfaced via toast in the try block
      let handled = false;

      try {
        const response = await fetch(url, {
          ...options,
          headers,
          credentials: 'include', // Browser sends session cookie automatically
        });

        // Handle common error patterns
        if (response.status === 401) {
          logout();
          showError('登录已过期，请重新登录。');
          const err = new Error('认证已过期，请重新登录');
          setError(err);
          handled = true;
          throw err;
        }

        if (response.status === 403) {
          showError('当前账号权限不足，请升级会员以解锁此功能。');
          const err = new Error('权限不足，请升级会员');
          setError(err);
          handled = true;
          throw err;
        }

        if (!response.ok) {
          let errorMessage = `请求失败 (${response.status})`;
          try {
            const data = await response.json();
            errorMessage = data.message || data.error || errorMessage;
          } catch (_) {
            // response body is not JSON
          }
          const err = new Error(errorMessage);
          setError(err);
          handled = true;
          showError(errorMessage);
          throw err;
        }

        const data = await response.json();
        return data;
      } catch (err) {
        if (!handled && err.name !== 'AbortError') {
          showError(`网络请求异常: ${err.message || '未知错误'}`);
          setError(err);
        }
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [logout, showError]
  );

  return { request, loading, error };
};

export default useApi;
