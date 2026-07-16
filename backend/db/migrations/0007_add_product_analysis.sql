-- Product analysis stays separate from Agent memory until the user confirms it.
ALTER TABLE "doubao_agent_sessions"
  ADD COLUMN IF NOT EXISTS "product_analysis_draft" jsonb DEFAULT '{}' NOT NULL;

ALTER TABLE "doubao_agent_sessions"
  ADD COLUMN IF NOT EXISTS "product_analysis_confirmed" jsonb DEFAULT '{}' NOT NULL;
