const TRANSIENT_DB_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'EPIPE', '57P01', '57P02', '57P03',
  '08000', '08001', '08003', '08004', '08006', '08007', '08P01',
]);

export function isTransientDatabaseError(error) {
  let current = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const code = String(current?.code || '').toUpperCase();
    const message = String(current?.message || current || '').toLowerCase();
    if (TRANSIENT_DB_CODES.has(code)
      || message.includes('connection terminated unexpectedly')
      || message.includes('connection terminated due to connection timeout')
      || message.includes('connection reset by peer')
      || message.includes('terminating connection due to administrator command')) {
      return true;
    }
    current = current?.cause;
  }
  return false;
}

export async function retryTransientDatabaseOperation(operation, options = {}) {
  const attempts = Math.max(1, Number(options.attempts || 3));
  const baseDelayMs = Math.max(0, Number(options.baseDelayMs || 150));
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (!isTransientDatabaseError(error) || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * (2 ** (attempt - 1))));
    }
  }
  throw lastError;
}

export function createResilientPool(pool) {
  return new Proxy(pool, {
    get(target, property, receiver) {
      if (property === 'query') {
        return (...args) => retryTransientDatabaseOperation(() => target.query(...args));
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
