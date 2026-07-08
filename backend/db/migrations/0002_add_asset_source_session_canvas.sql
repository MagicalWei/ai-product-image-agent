-- Migration 0002: Add asset source, session_id, and session canvas_state
-- Purpose: Enable asset classification (ai_generated / user_uploaded),
--          link assets to sessions, and persist canvas state server-side.

-- 1. assets table: add source column
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "source" varchar(32) NOT NULL DEFAULT 'user_uploaded';

-- 2. assets table: add session_id column (nullable FK to doubao_agent_sessions)
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "session_id" varchar(128);
ALTER TABLE "assets" ADD CONSTRAINT "fk_assets_session"
  FOREIGN KEY ("session_id") REFERENCES "doubao_agent_sessions"("session_id") ON DELETE SET NULL;

-- 3. Indexes for new columns
CREATE INDEX IF NOT EXISTS "idx_assets_session_id" ON "assets" ("session_id");
CREATE INDEX IF NOT EXISTS "idx_assets_source" ON "assets" ("source");
CREATE INDEX IF NOT EXISTS "idx_assets_uid_source" ON "assets" ("uid", "source");

-- 4. doubao_agent_sessions table: add canvas_state column
ALTER TABLE "doubao_agent_sessions" ADD COLUMN IF NOT EXISTS "canvas_state" jsonb DEFAULT '{}' NOT NULL;
