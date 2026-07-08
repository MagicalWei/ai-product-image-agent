import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';
import * as relations from './relations';

const { Pool } = pg;

/**
 * Create and export the drizzle database instance.
 *
 * Uses DATABASE_URL from environment, with SSL support for Neon PostgreSQL.
 * The pool is created once and reused across all queries.
 */
function createDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to initialize the database connection');
  }

  const sslConfig =
    process.env.DB_SSL === 'false'
      ? false
      : { rejectUnauthorized: process.env.NODE_ENV === 'production' };

  const pool = new Pool({
    connectionString,
    ssl: sslConfig,
    connectionTimeoutMillis: process.env.NODE_ENV === 'test' ? 3000 : 5000,
  });

  pool.on('error', (err: Error) => {
    console.error('[Neon DB] Unexpected error on idle client:', err.message);
  });

  return drizzle(pool, { schema: { ...schema, ...relations } });
}

export const db = createDb();

// Re-export schema for convenience
export * from './schema';
export * from './relations';
