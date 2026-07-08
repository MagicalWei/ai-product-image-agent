-- Migration 0003: Add pending_tool_calls and tool_results to doubao_agent_sessions
-- Purpose: Support the Agent tool-call protocol (canvas operations like getElements, getCanvasSnapshot, etc.)
--          that the frontend executes and reports back to the backend.

-- 1. doubao_agent_sessions: add pending_tool_calls column (jsonb, tracks tool calls awaiting frontend response)
ALTER TABLE "doubao_agent_sessions" ADD COLUMN IF NOT EXISTS "pending_tool_calls" jsonb DEFAULT '[]' NOT NULL;

-- 2. doubao_agent_sessions: add tool_results column (jsonb, stores results returned by frontend for completed tool calls)
ALTER TABLE "doubao_agent_sessions" ADD COLUMN IF NOT EXISTS "tool_results" jsonb DEFAULT '{}' NOT NULL;
