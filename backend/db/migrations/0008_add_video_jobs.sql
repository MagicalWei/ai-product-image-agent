CREATE TABLE IF NOT EXISTS "video_jobs" (
    "id" varchar(128) PRIMARY KEY NOT NULL,
    "uid" varchar(64) NOT NULL REFERENCES "users"("uid") ON DELETE CASCADE,
    "session_id" varchar(128),
    "status" varchar(32) DEFAULT 'queued' NOT NULL,
    "progress" integer DEFAULT 0 NOT NULL,
    "plan" jsonb DEFAULT '{}' NOT NULL,
    "output_url" varchar(512) DEFAULT '',
    "error" text DEFAULT '',
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_video_jobs_uid_created" ON "video_jobs" ("uid", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_video_jobs_status" ON "video_jobs" ("status");
