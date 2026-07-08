/**
 * Lightweight in-memory rate limiter with user-aware keying.
 *
 * - For authenticated users: limits are per-uid (not per-IP), so one user's
 *   rapid testing doesn't affect others.
 * - For unauthenticated requests: falls back to IP-based limiting.
 * - Counters auto-cleanup every 5 minutes.
 * - Configurable via environment: BYPASS_AI_RATE_LIMIT=true disables AI limit.
 *
 * Production scaling: replace with Redis-based solution for multi-process.
 */

const counters = new Map();

// Auto-cleanup every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of counters) {
    if (now > entry.resetAt) counters.delete(key);
  }
}, 5 * 60 * 1000).unref();

/**
 * Extract a stable rate-limit key from the request.
 * Prefers authenticated uid over IP so limits are per-user.
 */
function getKey(req) {
  // Better Auth stores session user on req.user (set by sessionMiddleware)
  if (req.user && req.user.uid) {
    return `uid:${req.user.uid}`;
  }
  // Fallback to IP
  return `ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
}

/**
 * @param {{ windowMs: number, max: number, message?: object, skip?: (req) => boolean }} options
 * @returns {import('express').RequestHandler}
 */
export function createRateLimiter({ windowMs, max, message, skip }) {
  return (req, res, next) => {
    // Optional skip function for dynamic bypass
    if (skip && skip(req)) {
      return next();
    }

    const key = getKey(req);
    const now = Date.now();
    let entry = counters.get(key);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      counters.set(key, entry);
    }

    entry.count++;

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - entry.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

    if (entry.count > max) {
      return res.status(429).json(message || { error: '请求过于频繁，请稍后再试' });
    }

    next();
  };
}

export { getKey };
