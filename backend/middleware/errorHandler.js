import config from '../config.js';

/**
 * Custom application error that carries an HTTP status code.
 * Throw this from route handlers to produce a structured error response.
 */
export class AppError extends Error {
  /**
   * @param {string} message  Human-readable error description
   * @param {number} statusCode  HTTP status code (default 500)
   */
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Wraps an async Express route handler so that any thrown error (sync or rejected
 * promise) is automatically forwarded to the next error-handling middleware.
 *
 * Usage:
 *   router.get('/foo', asyncHandler(async (req, res) => { ... }));
 *
 * @param {Function} fn  Async route handler
 * @returns {Function} Wrapped handler safe for Express
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Global Express error-handling middleware (4-param signature).
 * Must be registered AFTER all route handlers via app.use(errorHandler).
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // Default to false unless explicitly 'development' or 'test'
  const isDev = config.NODE_ENV === 'development' || config.NODE_ENV === 'test';

  // Log full error in every environment
  console.error('[ErrorHandler]', {
    message: err.message,
    statusCode: err.statusCode || 500,
    path: req.originalUrl,
    method: req.method,
    stack: isDev ? err.stack : undefined,
  });

  // AppError: trusted, application-level error
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message,
      ...(isDev && { stack: err.stack }),
    });
  }

  // Stripe webhook raw body errors — pass through the raw message
  if (err.type === 'StripeSignatureVerificationError') {
    return res.status(400).send(`Webhook Signature Error: ${err.message}`);
  }

  // Untrusted / unexpected errors
  const statusCode = err.statusCode || err.status || 500;
  res.status(statusCode).json({
    error: isDev ? err.message : 'Internal server error',
    ...(isDev && { stack: err.stack }),
  });
}

export default errorHandler;
