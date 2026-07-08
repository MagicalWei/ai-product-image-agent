-- Actual production schema (uid varchar format, matching all route code)
-- This replaces the incorrect Drizzle-generated schema that used user_id uuid.

CREATE TABLE IF NOT EXISTS "users" (
    "uid" varchar(64) PRIMARY KEY NOT NULL,
    "email" varchar(255) NOT NULL,
    "password" varchar(255) NOT NULL,
    "role" varchar(32) DEFAULT 'user' NOT NULL,
    "membership_type" varchar(32) DEFAULT 'free' NOT NULL,
    "billing_cycle" varchar(32) DEFAULT 'none' NOT NULL,
    "remaining_credits" integer DEFAULT 10 NOT NULL,
    "mimo_key" varchar(255) DEFAULT '',
    "gemini_key" varchar(255) DEFAULT '',
    "qwen_key" varchar(255) DEFAULT '',
    "custom_proxy" varchar(512) DEFAULT '',
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "users_email_unique" UNIQUE("email"),
    CONSTRAINT "chk_remaining_credits" CHECK ("remaining_credits" >= 0)
);

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "doubao_agent_sessions" (
    "session_id" varchar(128) PRIMARY KEY NOT NULL,
    "uid" varchar(64) NOT NULL REFERENCES "users"("uid") ON DELETE CASCADE,
    "title" varchar(255) DEFAULT '新设计会话' NOT NULL,
    "current_state" varchar(64) DEFAULT 'COLLECTING_INFO' NOT NULL,
    "chat_history" jsonb DEFAULT '[]' NOT NULL,
    "last_params" jsonb DEFAULT '{}' NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "brand_memories" (
    "uid" varchar(64) PRIMARY KEY REFERENCES "users"("uid") ON DELETE CASCADE,
    "brand_name" varchar(255) DEFAULT '',
    "style" varchar(255) DEFAULT '',
    "color_palette" jsonb DEFAULT '[]' NOT NULL,
    "typography" varchar(255) DEFAULT '',
    "logo_url" varchar(512) DEFAULT '',
    "product_name" varchar(255) DEFAULT '',
    "product_category" varchar(255) DEFAULT '',
    "selling_points" jsonb DEFAULT '[]' NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "assets" (
    "id" varchar(128) PRIMARY KEY NOT NULL,
    "uid" varchar(64) NOT NULL REFERENCES "users"("uid") ON DELETE CASCADE,
    "name" varchar(255) NOT NULL,
    "url" varchar(512) NOT NULL,
    "size" varchar(32) NOT NULL DEFAULT '0 KB',
    "date" varchar(16) NOT NULL DEFAULT '',
    "metrics" jsonb,
    "created_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "orders" (
    "id" varchar(128) PRIMARY KEY NOT NULL,
    "uid" varchar(64) NOT NULL REFERENCES "users"("uid") ON DELETE CASCADE,
    "order_no" varchar(64) NOT NULL UNIQUE,
    "status" varchar(32) DEFAULT 'pending' NOT NULL,
    "amount" numeric(10, 2) NOT NULL,
    "credits" integer NOT NULL,
    "plan_id" varchar(64) NOT NULL,
    "stripe_session_id" varchar(255),
    "paid_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "email_verification_codes" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "email" varchar(255) NOT NULL,
    "code" varchar(6) NOT NULL,
    "expires_at" timestamp NOT NULL,
    "used" boolean DEFAULT false NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_users_email" ON "users" ("email");
CREATE INDEX IF NOT EXISTS "idx_sessions_uid" ON "doubao_agent_sessions" ("uid");
CREATE INDEX IF NOT EXISTS "idx_sessions_uid_updated" ON "doubao_agent_sessions" ("uid", "updated_at" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "idx_assets_uid" ON "assets" ("uid");
CREATE INDEX IF NOT EXISTS "idx_assets_uid_date" ON "assets" ("uid", "date" DESC);
CREATE INDEX IF NOT EXISTS "idx_verification_email" ON "email_verification_codes" ("email", "used", "expires_at");
CREATE INDEX IF NOT EXISTS "idx_orders_uid" ON "orders" ("uid");
CREATE INDEX IF NOT EXISTS "idx_orders_uid_created" ON "orders" ("uid", "created_at" DESC NULLS LAST);

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "usage_logs" (
    "id" varchar(128) PRIMARY KEY NOT NULL,
    "uid" varchar(64) NOT NULL REFERENCES "users"("uid") ON DELETE CASCADE,
    "action" varchar(32) NOT NULL,
    "credits_delta" integer NOT NULL DEFAULT 0,
    "credits_after" integer NOT NULL DEFAULT 0,
    "detail" text DEFAULT '',
    "created_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_usage_logs_uid" ON "usage_logs" ("uid");
CREATE INDEX IF NOT EXISTS "idx_usage_logs_uid_created" ON "usage_logs" ("uid", "created_at" DESC NULLS LAST);
