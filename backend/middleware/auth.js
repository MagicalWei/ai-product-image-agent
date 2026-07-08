import jwt from 'jsonwebtoken';
import config from '../config.js';

const JWT_SECRET = config.JWT_SECRET;

// In-memory blacklist for revoked tokens
const tokenBlacklist = new Set();

/**
 * Revoke a token by adding it to the blacklist.
 */
export function revokeToken(token) {
  if (token) {
    tokenBlacklist.add(token);
  }
}

/**
 * Generate a JWT token for a given user.
 * Signs with uid, email and role claims, expires in 7 days.
 * @param {{ uid: string, email: string, role?: string }} user
 * @returns {string} Signed JWT
 */
export function generateToken(user) {
  return jwt.sign(
    { uid: user.uid, email: user.email, role: user.role || 'user' },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/**
 * Express middleware that enforces a valid Bearer JWT in the Authorization header.
 * On success, attaches decoded payload to req.user.
 * Returns 401 if the token is missing, invalid, or revoked.
 */
export function authenticateToken(req, res, next) {
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
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: '认证令牌无效或已过期，请重新登录' });
  }
}

/**
 * Like authenticateToken, but does not reject the request when no token is present.
 * If a valid token is supplied, req.user is populated; otherwise req.user stays undefined.
 */
export function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token || tokenBlacklist.has(token)) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
  } catch {
    // Token present but invalid — silently ignore for optional auth
  }

  next();
}
