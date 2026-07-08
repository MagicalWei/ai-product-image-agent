/**
 * Unit tests for backend middleware modules.
 * Tests cover: JWT auth, error handling, rate limiting.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';

// ─── Mock config before importing middleware ────────────────────────────────
vi.mock('../../backend/config.js', () => ({
  default: {
    JWT_SECRET: 'test-secret-key-for-unit-tests',
    DATABASE_URL: 'postgresql://mock',
    STRIPE_SECRET_KEY: 'sk_test_mock',
    STRIPE_WEBHOOK_SECRET: 'whsec_mock',
    GEMINI_API_KEY: 'mock-key',
  },
  PORT: 3000,
  projectRoot: '/tmp/mock-project',
}));

// ─── Import middleware after mocking config ───────────────────────────────────
import { generateToken, authenticateToken, optionalAuth } from '../../backend/middleware/auth.js';
import { AppError, asyncHandler, errorHandler } from '../../backend/middleware/errorHandler.js';

// ─── Helper: mock Express req/res/next ───────────────────────────────────────
function mockReq(overrides = {}) {
  return { headers: {}, ...overrides };
}

function mockRes() {
  const res = {
    statusCode: 200,
    _json: null,
    _body: null,
    status(code) { res.statusCode = code; return res; },
    json(data) { res._json = data; return res; },
    send(data) { res._body = data; return res; },
    setHeader: vi.fn(),
    end: vi.fn(),
  };
  return res;
}

function mockNext() {
  return vi.fn();
}

// ═══════════════════════════════════════════════════════════════════════════
// JWT Token Generation
// ═══════════════════════════════════════════════════════════════════════════

describe('generateToken', () => {
  it('should generate a valid JWT string', () => {
    const user = { uid: 'user-123', email: 'test@example.com' };
    const token = generateToken(user);

    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // JWT has 3 parts

    // Decode and verify payload
    const decoded = jwt.decode(token);
    expect(decoded.uid).toBe('user-123');
    expect(decoded.email).toBe('test@example.com');
    expect(decoded.exp).toBeDefined();
  });

  it('should set token expiration to 7 days', () => {
    const user = { uid: 'user-456', email: 'a@b.com' };
    const token = generateToken(user);
    const decoded = jwt.decode(token);

    const now = Math.floor(Date.now() / 1000);
    const sevenDaysInSeconds = 7 * 24 * 60 * 60;
    const tolerance = 10; // 10 seconds tolerance

    expect(decoded.exp - now).toBeGreaterThan(sevenDaysInSeconds - tolerance);
    expect(decoded.exp - now).toBeLessThanOrEqual(sevenDaysInSeconds + tolerance);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// authenticateToken Middleware
// ═══════════════════════════════════════════════════════════════════════════

describe('authenticateToken', () => {
  it('should return 401 when no Authorization header is present', () => {
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    authenticateToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res._json.error).toContain('登录');
  });

  it('should return 401 for an invalid token', () => {
    const req = mockReq({
      headers: { authorization: 'Bearer invalid-token-string' },
    });
    const res = mockRes();
    const next = mockNext();

    authenticateToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res._json.error).toContain('无效');
  });

  it('should attach decoded user to req.user on valid token', () => {
    const token = jwt.sign(
      { uid: 'user-789', email: 'valid@test.com' },
      'test-secret-key-for-unit-tests',
      { expiresIn: '1h' }
    );

    const req = mockReq({
      headers: { authorization: `Bearer ${token}` },
    });
    const res = mockRes();
    const next = mockNext();

    authenticateToken(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user.uid).toBe('user-789');
    expect(req.user.email).toBe('valid@test.com');
  });

  it('should return 401 for an expired token', () => {
    const token = jwt.sign(
      { uid: 'user-expired', email: 'old@test.com' },
      'test-secret-key-for-unit-tests',
      { expiresIn: '-1s' } // already expired
    );

    const req = mockReq({
      headers: { authorization: `Bearer ${token}` },
    });
    const res = mockRes();
    const next = mockNext();

    authenticateToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// optionalAuth Middleware
// ═══════════════════════════════════════════════════════════════════════════

describe('optionalAuth', () => {
  it('should call next() without error when no token is provided', () => {
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    optionalAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toBeUndefined();
  });

  it('should populate req.user when a valid token is provided', () => {
    const token = jwt.sign(
      { uid: 'user-opt', email: 'opt@test.com' },
      'test-secret-key-for-unit-tests',
      { expiresIn: '1h' }
    );

    const req = mockReq({
      headers: { authorization: `Bearer ${token}` },
    });
    const res = mockRes();
    const next = mockNext();

    optionalAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user.uid).toBe('user-opt');
  });

  it('should silently ignore an invalid token and continue', () => {
    const req = mockReq({
      headers: { authorization: 'Bearer bad-token' },
    });
    const res = mockRes();
    const next = mockNext();

    optionalAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AppError
// ═══════════════════════════════════════════════════════════════════════════

describe('AppError', () => {
  it('should extend Error with statusCode', () => {
    const err = new AppError('Test error message', 422);

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Test error message');
    expect(err.statusCode).toBe(422);
    expect(err.name).toBe('AppError');
  });

  it('should default statusCode to 500', () => {
    const err = new AppError('Server error');
    expect(err.statusCode).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// asyncHandler
// ═══════════════════════════════════════════════════════════════════════════

describe('asyncHandler', () => {
  it('should call the wrapped function with req, res, next', async () => {
    const handler = vi.fn((req, res, next) => {
      res.json({ ok: true });
    });

    const wrapped = asyncHandler(handler);
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    await wrapped(req, res, next);

    expect(handler).toHaveBeenCalledWith(req, res, next);
    expect(res._json).toEqual({ ok: true });
  });

  it('should forward async errors to next()', async () => {
    const handler = vi.fn(async () => {
      throw new AppError('Async failure', 409);
    });

    const wrapped = asyncHandler(handler);
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    await wrapped(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(AppError);
    expect(error.message).toBe('Async failure');
    expect(error.statusCode).toBe(409);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// errorHandler Middleware
// ═══════════════════════════════════════════════════════════════════════════

describe('errorHandler', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
  });

  it('should return structured JSON error response', () => {
    const err = new AppError('Validation failed', 422);
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(422);
    expect(res._json).toBeDefined();
    expect(res._json.error).toBe('Validation failed');
  });

  it('should default to 500 for unknown errors', () => {
    const err = new Error('Unknown error');
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(500);
    expect(res._json.error).toBeDefined();
  });

  it('should handle Stripe signature errors', () => {
    const err = new Error('Stripe webhook signature failed');
    err.type = 'StripeSignatureVerificationError';
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(400);
  });
});
