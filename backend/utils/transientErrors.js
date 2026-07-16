const TRANSIENT_DB_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'EPIPE', '57P01', '57P02', '57P03',
  '08000', '08001', '08003', '08004', '08006', '08007', '08P01',
]);

export function isTransientDatabaseError(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || error || '').toLowerCase();
  return TRANSIENT_DB_CODES.has(code)
    || message.includes('connection terminated unexpectedly')
    || message.includes('connection reset by peer')
    || message.includes('terminating connection due to administrator command');
}

