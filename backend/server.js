import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import cors from 'cors';
import { createRateLimiter } from './middleware/rateLimit.js';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './swagger.js';

// Config import triggers .env loading and REQUIRED_ENV_VARS check
import config, { PORT, projectRoot } from './config.js';

// Database layer (Drizzle ORM + pg pool)
import { initDatabase } from './db/db.js';

// Auth
import { auth } from './auth/betterAuth.js';
import { toNodeHandler } from 'better-auth/node';

// Middleware
import { errorHandler } from './middleware/errorHandler.js';
import { isTransientDatabaseError } from './utils/transientErrors.js';

// Routes
import authRouter, { setPool as setAuthPool } from './routes/auth.js';
import paymentRouter, { setPool as setPaymentPool } from './routes/payment.js';
import assetsRouter, { setPool as setAssetsPool } from './routes/assets.js';
import aiRouter, { setPool as setAiPool } from './routes/ai.js';
import agentRouter, { setPool as setAgentPool } from './routes/agent.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─────────────────────────────────────────────────────────────────────────────
// Express App
// ─────────────────────────────────────────────────────────────────────────────

const app = express();

// Trust reverse proxy (important for rate limiting behind Nginx/Cloudflare)
if (config.NODE_ENV === 'production' || process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

// ─── Global Middleware ───────────────────────────────────────────────────────

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: false, // allow cross-origin image loading for frontend
  contentSecurityPolicy: false, // set manually below
}));

// Custom CSP header (set manually to avoid Helmet version incompatibilities)
app.use((_req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' ws: wss:",
      "font-src 'self' https: data:",
      "media-src 'self'",
      "object-src 'none'",
      "frame-src 'self' https://js.stripe.com",
      "base-uri 'self'",
      "form-action 'self' https://checkout.stripe.com",
    ].join('; ')
  );
  next();
});

// CORS — dynamic config from environment
const origins = config.CORS_ORIGIN.split(',').map(o => o.trim());
app.use(cors({
  origin: origins.length === 1 ? origins[0] : origins,
  credentials: true,
}));

// ─── Rate Limiting ────────────────────────────────────────────────────────────
// General rate limiter: 200 requests per 15 minutes per IP
const generalLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  message: { error: '请求过于频繁，请稍后再试' },
  skip: (req) => (
    process.env.NODE_ENV !== 'production' ||
    req.path === '/api/agent/chat-stream'
  ),
});

// Strict rate limiter for auth endpoints: 30 requests per 15 minutes per IP
const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: '登录尝试过于频繁，请15分钟后再试' },
});

app.use(generalLimiter);
app.use('/api/auth/sign-in/email', authLimiter);

// A 10 MB binary image expands to about 13.4 MB as base64 JSON.
app.use(express.json({
  limit: '16mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
}));

// URL-encoded form data
app.use(express.urlencoded({ extended: true, limit: '16mb' }));

// ─── Static Files ────────────────────────────────────────────────────────────
const uploadsDir = path.join(projectRoot, 'frontend', 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// ─── Better Auth Handler ─────────────────────────────────────────────────────
// Better Auth handles: sign-in/email, sign-up/email, sign-out, get-session, etc.
// toNodeHandler returns a (req, res) => void function that reads req.url directly.
// Express's app.use strips the mount prefix and puts it in req.baseUrl.
// better-call's constructRelativeUrl uses req.baseUrl + req.url to rebuild the full path.
app.use('/api/auth', toNodeHandler(auth));

// ─── Custom Auth Routes ──────────────────────────────────────────────────────
// Mounted at /api/custom-auth to avoid conflict with Better Auth's /api/auth.
// Handles: sync-keys, me, profile/:uid
app.use('/api/custom-auth', authRouter);

// ─── Business Routes ─────────────────────────────────────────────────────────
app.use('/api/payment', paymentRouter);
app.use('/api/assets', assetsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/agent', agentRouter);

// ─── Swagger UI (development only) ────────────────────────────────────────────
if (config.NODE_ENV !== 'production') {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

// Production Notifications API
app.get('/api/notifications', (_req, res) => {
  res.json({ system: [], promotion: [] });
});

// ─── Error Handler (must be last) ────────────────────────────────────────────
app.use(errorHandler);

// ─────────────────────────────────────────────────────────────────────────────
// Database Initialization & Server Start
// ─────────────────────────────────────────────────────────────────────────────

// Initialize database connection (no more inline CREATE TABLE IF NOT EXISTS)
// Schema is now managed via Drizzle ORM migrations: pnpm db:generate && pnpm db:migrate
const { pool } = await initDatabase();

setAuthPool(pool);
setPaymentPool(pool);
setAssetsPool(pool);
setAiPool(pool);
setAgentPool(pool);

const server = app.listen(PORT, () => {
  console.log('============================================');
  console.log(`Node.js Backend Server running on http://localhost:${PORT}`);
  console.log('============================================');
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
async function gracefulShutdown(signal) {
  console.log(`[Server] Received ${signal}. Shutting down gracefully...`);
  server.close(async () => {
    console.log('[Server] HTTP server closed.');
    try {
      await pool.end();
      console.log('[Server] Database pool closed.');
    } catch (err) {
      console.error('[Server] Error closing database pool:', err.message);
    }
    process.exit(0);
  });

  // Force shutdown after 10s
  setTimeout(() => {
    console.error('[Server] Forced shutdown after timeout.');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ─── Global Exception Handlers ────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught Exception:', err.message);
  console.error(err.stack);
  if (isTransientDatabaseError(err)) {
    // pg/Neon can emit a socket error after a remote compute restart even
    // after the Pool has discarded that client. The pool remains usable and
    // will create a fresh connection for the next request, so exiting here
    // turns a recoverable database event into a full authentication outage.
    console.warn('[Server] Transient database connection was discarded; service remains available.');
    return;
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled Rejection at:', promise);
  console.error('[Server] Reason:', reason?.message || reason);
  // Don't crash on unhandled rejections — log and continue
});

export default app;
