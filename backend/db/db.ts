/**
 * Database layer — hybrid approach:
 * - Drizzle ORM for schema definition + migrations
 * - pg Pool for existing route query compatibility
 *
 * This module replaces the inline initializeDatabase() in the old server.js.
 */

import pg, { type Pool as PoolType } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import config from '../config.js';
import * as schema from './schema';
import * as relations from './relations';

const { Pool } = pg;

/**
 * Create PostgreSQL connection pool.
 * Same configuration as the original server.js pool.
 */
function createPool(): PoolType {
  const sslConfig =
    config.DB_SSL === 'false'
      ? false
      : { rejectUnauthorized: config.NODE_ENV === 'production' };

  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: sslConfig,
    connectionTimeoutMillis: process.env.NODE_ENV === 'test' ? 3000 : 5000,
  });

  pool.on('error', (err: Error) => {
    console.error('[Neon DB] Unexpected error on idle client:', err.message);
  });

  return pool;
}

let pool: PoolType | undefined;
let db: NodePgDatabase<typeof schema & typeof relations> | undefined;
let initialized = false;

/**
 * Initialize database connection.
 * Must be called once at server startup before any route handlers.
 */
export async function initDatabase() {
  if (initialized) {
    return { pool: pool!, db: db! };
  }

  if (!config.DATABASE_URL || config.DATABASE_URL.trim() === '') {
    console.error('[Neon DB] FATAL: No DATABASE_URL provided. Cannot start server.');
    process.exit(1);
  }

  // Retry connection with backoff
  let retries = process.env.NODE_ENV === 'test' ? 1 : 5;
  let delay = process.env.NODE_ENV === 'test' ? 50 : 1000;

  while (retries > 0) {
    try {
      pool = createPool();
      const client = await pool.connect();
      client.release();
      console.log('[Neon DB] Successfully connected to PostgreSQL instance.');
      break;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      retries -= 1;
      console.warn(
        `[Neon DB] Connection failed. Retries remaining: ${retries}. Error: ${message}`
      );
      if (retries === 0) {
        console.error(
          '[Neon DB] FATAL: Database connection failed after all attempts. Cannot start server.'
        );
        process.exit(1);
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 1.2;
    }
  }

  // Create Drizzle ORM instance
  const verifiedPool = pool!;
  db = drizzle(verifiedPool, { schema: { ...schema, ...relations } });

  console.log('[Neon DB] Database initialized. Schema is managed via Drizzle migrations (`pnpm db:migrate`).');

  initialized = true;
  return { pool, db };
}

/**
 * Get the raw pg Pool instance (for existing route files).
 */
export function getPool(): PoolType {
  if (!pool) {
    throw new Error(
      'Database pool not initialized. Call initDatabase() before getPool().'
    );
  }
  return pool;
}

/**
 * Get the Drizzle ORM instance (for new ORM-based queries).
 */
export function getDb() {
  if (!db) {
    throw new Error(
      'Drizzle instance not initialized. Call initDatabase() before getDb().'
    );
  }
  return db;
}

// Re-export schema and relations for convenience
export { schema, relations };
