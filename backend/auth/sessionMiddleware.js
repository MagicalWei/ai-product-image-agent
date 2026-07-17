import { auth } from './betterAuth.js';
import { getPool } from '../db/db.js';
import { isTransientDatabaseError } from '../utils/transientErrors.js';

async function getSessionWithRetry(headers) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await auth.api.getSession({ headers });
    } catch (error) {
      lastError = error;
      if (attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** (attempt - 1))));
      }
    }
  }
  lastError.authServiceFailure = true;
  throw lastError;
}

/**
 * authenticateSession — replaces old authenticateToken.
 *
 * Uses Better Auth session cookies to authenticate requests.
 * On success, attaches a req.user object with the same shape as the old JWT middleware.
 * Returns 401 if no valid session is found.
 */
export async function authenticateSession(req, res, next) {
  try {
    const session = await getSessionWithRetry(req.headers);

    if (!session || !session.user) {
      return res.status(401).json({ error: '请先登录，未检测到认证令牌' });
    }

    // Build req.user with the same shape as old JWT middleware
    // Better Auth stores user in session.user with camelCase fields
    const user = session.user;
    req.user = {
      uid: user.id, // Better Auth uses 'id'; we map to 'uid' for backwards compat
      email: user.email,
      role: user.role || 'user',
      membership_type: user.membershipType || user.membership_type || 'free',
      billing_cycle: user.billingCycle || user.billing_cycle || 'none',
      remaining_credits: user.remainingCredits ?? user.remaining_credits ?? 10,
      mimo_key: user.mimoKey || user.mimo_key || '',
      gemini_key: user.geminiKey || user.gemini_key || '',
      qwen_key: user.qwenKey || user.qwen_key || '',
      custom_proxy: user.customProxy || user.custom_proxy || '',
      name: user.name || '',
      email_verified: user.emailVerified || user.email_verified || false,
      image: user.image || '',
    };

    next();
  } catch (err) {
    console.error('[authenticateSession] Error:', err.message);
    if (err.authServiceFailure || isTransientDatabaseError(err)) {
      return res.status(503).json({
        error: '登录状态服务正在恢复，请稍后重试',
        code: 'AUTH_SERVICE_TEMPORARY_UNAVAILABLE',
        retryable: true,
      });
    }
    return res.status(401).json({ error: '认证令牌无效或已过期，请重新登录' });
  }
}

/**
 * optionalSessionAuth — replaces old optionalAuth.
 *
 * Like authenticateSession, but does not reject the request when no session is present.
 * If a valid session exists, req.user is populated; otherwise req.user stays undefined.
 */
export async function optionalSessionAuth(req, res, next) {
  try {
    const session = await getSessionWithRetry(req.headers);

    if (session && session.user) {
      const user = session.user;
      req.user = {
        uid: user.id,
        email: user.email,
        role: user.role || 'user',
        membership_type: user.membershipType || user.membership_type || 'free',
        billing_cycle: user.billingCycle || user.billing_cycle || 'none',
        remaining_credits: user.remainingCredits ?? user.remaining_credits ?? 10,
        mimo_key: user.mimoKey || user.mimo_key || '',
        gemini_key: user.geminiKey || user.gemini_key || '',
        qwen_key: user.qwenKey || user.qwen_key || '',
        custom_proxy: user.customProxy || user.custom_proxy || '',
        name: user.name || '',
        email_verified: user.emailVerified || user.email_verified || false,
        image: user.image || '',
      };
    }
    // Session missing or invalid — silently continue
  } catch {
    // Silently ignore errors for optional auth
  }

  next();
}
