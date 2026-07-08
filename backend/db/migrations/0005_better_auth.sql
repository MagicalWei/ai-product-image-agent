-- ============================================================================
-- Better Auth Migration
-- Adds Better Auth required columns and tables while preserving existing data.
-- NOTE: Better Auth's Kysely adapter uses camelCase column names.
-- ============================================================================

-- 1. Add Better Auth columns to users table
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "id" varchar(64);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "name" varchar(255) DEFAULT '';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified" boolean DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "image" varchar(512) DEFAULT '';

-- 2. Sync existing uid values into id column
UPDATE "users" SET "id" = "uid" WHERE "id" IS NULL;

-- 3. Add unique constraint on id
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_id_unique" UNIQUE("id");
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

-- 4. Create trigger to keep id and uid in sync for new inserts
CREATE OR REPLACE FUNCTION sync_uid_id() RETURNS TRIGGER AS $$
BEGIN
  NEW.id = COALESCE(NEW.id, NEW.uid);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_uid_id ON "users";
CREATE TRIGGER trg_sync_uid_id
  BEFORE INSERT ON "users"
  FOR EACH ROW EXECUTE FUNCTION sync_uid_id();

-- 5. Create Better Auth session table (camelCase columns for Kysely adapter)
CREATE TABLE IF NOT EXISTS "session" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "expiresAt" timestamp NOT NULL,
  "token" varchar(255) UNIQUE NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  "userId" varchar(64) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "ipAddress" varchar(255),
  "userAgent" text
);

CREATE INDEX IF NOT EXISTS "idx_session_userId" ON "session"("userId");
CREATE INDEX IF NOT EXISTS "idx_session_token" ON "session"("token");

-- 6. Create Better Auth account table (for future OAuth support)
CREATE TABLE IF NOT EXISTS "account" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "accountId" varchar(255) NOT NULL,
  "providerId" varchar(255) NOT NULL,
  "userId" varchar(64) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamp,
  "refreshTokenExpiresAt" timestamp,
  "scope" text,
  "password" text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_account_userId" ON "account"("userId");

-- 7. Create Better Auth verification table
CREATE TABLE IF NOT EXISTS "verification" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "identifier" varchar(255) NOT NULL,
  "value" varchar(255) NOT NULL,
  "expiresAt" timestamp NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_verification_identifier" ON "verification"("identifier");
