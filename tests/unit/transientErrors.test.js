import { describe, expect, it } from 'vitest';
import { isTransientDatabaseError } from '../../backend/utils/transientErrors.js';

describe('transient database errors', () => {
  it('recognizes Neon connection termination and reset errors', () => {
    expect(isTransientDatabaseError(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(isTransientDatabaseError({ code: 'ECONNRESET', message: 'socket closed' })).toBe(true);
    expect(isTransientDatabaseError({ code: '57P01', message: 'admin shutdown' })).toBe(true);
  });

  it('does not hide programming errors', () => {
    expect(isTransientDatabaseError(new TypeError('undefined is not a function'))).toBe(false);
  });
});
