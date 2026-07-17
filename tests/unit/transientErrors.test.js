import { describe, expect, it } from 'vitest';
import { createResilientPool, isTransientDatabaseError, retryTransientDatabaseOperation } from '../../backend/utils/transientErrors.js';

describe('transient database errors', () => {
  it('recognizes Neon connection termination and reset errors', () => {
    expect(isTransientDatabaseError(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(isTransientDatabaseError({ code: 'ECONNRESET', message: 'socket closed' })).toBe(true);
    expect(isTransientDatabaseError({ code: '57P01', message: 'admin shutdown' })).toBe(true);
    expect(isTransientDatabaseError({
      message: 'Failed to get session',
      cause: new Error('Connection terminated due to connection timeout'),
    })).toBe(true);
  });

  it('does not hide programming errors', () => {
    expect(isTransientDatabaseError(new TypeError('undefined is not a function'))).toBe(false);
  });
});

it('retries a transient database operation and preserves the result', async () => {
  let calls = 0;
  const result = await retryTransientDatabaseOperation(async () => {
    calls += 1;
    if (calls < 3) throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    return 'ok';
  }, { attempts: 3, baseDelayMs: 1 });
  expect(result).toBe('ok');
  expect(calls).toBe(3);
});

it('wraps pool queries with transient retries', async () => {
  let calls = 0;
  const pool = createResilientPool({
    async query() {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
      return { rows: [{ value: 1 }] };
    },
  });
  await expect(pool.query('select 1')).resolves.toEqual({ rows: [{ value: 1 }] });
  expect(calls).toBe(2);
});
