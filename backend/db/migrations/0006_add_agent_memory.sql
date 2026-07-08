-- Migration 0006: Add agent_memory JSONB column to doubao_agent_sessions
-- Supports Phase 1 structured memory system

ALTER TABLE doubao_agent_sessions
ADD COLUMN IF NOT EXISTS agent_memory JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN doubao_agent_sessions.agent_memory IS 'Structured agent memory (AgentMemory dataclass serialized as JSON)';
