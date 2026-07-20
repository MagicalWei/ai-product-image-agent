CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "media_type" varchar(16) NOT NULL DEFAULT 'image';
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "index_status" varchar(24) NOT NULL DEFAULT 'pending';
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "indexed_at" timestamp;
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "index_error" text DEFAULT '';

CREATE TABLE IF NOT EXISTS "media_embeddings" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "uid" varchar(64) NOT NULL REFERENCES "users"("uid") ON DELETE CASCADE,
    "asset_id" varchar(128) NOT NULL REFERENCES "assets"("id") ON DELETE CASCADE,
    "session_id" varchar(128),
    "segment_index" integer NOT NULL DEFAULT 0,
    "media_type" varchar(16) NOT NULL,
    "content_text" text NOT NULL DEFAULT '',
    "style_text" text NOT NULL DEFAULT '',
    "product_text" text NOT NULL DEFAULT '',
    "start_time" real,
    "end_time" real,
    "keyframe_url" varchar(512) DEFAULT '',
    "metadata" jsonb NOT NULL DEFAULT '{}',
    "content_embedding" vector(1536),
    "style_embedding" vector(1536),
    "product_embedding" vector(1536),
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now(),
    CONSTRAINT "uq_media_embeddings_asset_segment" UNIQUE ("asset_id", "segment_index")
);

CREATE INDEX IF NOT EXISTS "idx_assets_uid_index_status"
    ON "assets" ("uid", "index_status");
CREATE INDEX IF NOT EXISTS "idx_media_embeddings_uid_type"
    ON "media_embeddings" ("uid", "media_type");
CREATE INDEX IF NOT EXISTS "idx_media_embeddings_asset"
    ON "media_embeddings" ("asset_id");
CREATE INDEX IF NOT EXISTS "idx_media_embeddings_content_hnsw"
    ON "media_embeddings" USING hnsw ("content_embedding" vector_cosine_ops);
CREATE INDEX IF NOT EXISTS "idx_media_embeddings_style_hnsw"
    ON "media_embeddings" USING hnsw ("style_embedding" vector_cosine_ops);
CREATE INDEX IF NOT EXISTS "idx_media_embeddings_product_hnsw"
    ON "media_embeddings" USING hnsw ("product_embedding" vector_cosine_ops);
