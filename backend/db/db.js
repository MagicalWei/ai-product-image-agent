/**
 * Database layer — hybrid approach:
 * - Drizzle ORM for schema definition + migrations
 * - pg Pool for existing route query compatibility
 *
 * This module replaces the inline initializeDatabase() in the old server.js.
 */

import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import config from '../config.js';

const { Pool } = pg;

let pool;
let db;
let initialized = false;

/**
 * Initialize database connection.
 * Must be called once at server startup before any route handlers.
 */
export async function initDatabase() {
  if (initialized) {
    return { pool, db };
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
      retries -= 1;
      console.warn(
        `[Neon DB] Connection failed. Retries remaining: ${retries}. Error: ${err.message}`
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

  // Create Drizzle ORM instance (for migrations and any future ORM-based queries)
  db = drizzle(pool);

  console.log('[Neon DB] Database initialized. Schema is managed via Drizzle migrations (`pnpm db:migrate`).');

  initialized = true;
  return { pool, db };
}

function createPool() {
  const sslConfig =
    config.DB_SSL === 'false'
      ? false
      : { rejectUnauthorized: config.NODE_ENV === 'production' };

  const p = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: sslConfig,
    connectionTimeoutMillis: process.env.NODE_ENV === 'test' ? 3000 : 5000,
  });

  p.on('error', (err) => {
    console.error('[Neon DB] Unexpected error on idle client:', err.message);
  });

  return p;
}

/**
 * Get the raw pg Pool instance (for existing route files).
 */
export function getPool() {
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
