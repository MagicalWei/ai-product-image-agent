import { auth } from './betterAuth.js';
import jwt from 'jsonwebtoken';
import config from '../config.js';

/**
 * transitionalAuth — Temporary middleware that supports both Better Auth session
 * cookies and legacy JWT Bearer tokens during the migration window.
 *
 * Priority:
 * 1. Try Better Auth session cookie first
 * 2. Fall back to legacy JWT Bearer token
 *
 * This middleware builds req.user in the same shape as the old JWT middleware,
 * ensuring downstream routes work without changes.
 *
 * After the transition period (1-2 days), this file should be deleted and all
 * routes should use authenticateSession directly.
 */

// In-memory blacklist for revoked JWT tokens (copied from old middleware)
const tokenBlacklist = new Set();

/**
 * Add a token to the blacklist.
 */
export function revokeToken(token) {
  if (token) {
    tokenBlacklist.add(token);
  }
}

export async function transitionalAuth(req, res, next) {
  // 1. Try Better Auth session cookie first
  try {
    const session = await auth.api.getSession({
      headers: req.headers,
    });

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
      return next();
    }
  } catch {
    // Session check failed, fall through to JWT
  }

  // 2. Fall back to legacy JWT Bearer token
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ error: '请先登录，未检测到认证令牌' });
  }

  if (tokenBlacklist.has(token)) {
    return res.status(401).json({ error: '认证令牌已失效，请重新登录' });
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    req.user = decoded;

    // Log that this user is still using JWT (for monitoring migration progress)
    console.log(`[transitionalAuth] User ${decoded.email} still using legacy JWT. Consider re-login.`);

    next();
  } catch (err) {
    return res.status(401).json({ error: '认证令牌无效或已过期，请重新登录' });
  }
}

/**
 * Like transitionalAuth, but optional — doesn't reject when no auth is present.
 */
export async function transitionalOptionalAuth(req, res, next) {
  // 1. Try Better Auth session cookie first
  try {
    const session = await auth.api.getSession({
      headers: req.headers,
    });

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
      return next();
    }
  } catch {
    // Session check failed, fall through to JWT
  }

  // 2. Fall back to legacy JWT Bearer token
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token || tokenBlacklist.has(token)) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    req.user = decoded;
  } catch {
    // Token present but invalid — silently ignore
  }

  next();
}
