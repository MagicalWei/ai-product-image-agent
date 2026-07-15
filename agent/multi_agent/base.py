"""
Multi-Agent — Base Agent

Abstract base class for all agents. Provides think() and think_structured()
methods that delegate to the existing chat_client.py fallback chain.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from abc import ABC, abstractmethod
from typing import Any

from agent.multi_agent.shared_context import AgentRole, AgentMessage, SharedContext

logger = logging.getLogger(__name__)

# Resolve agent_service directory once for chat_client imports
_AGENT_SERVICE_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "backend", "agent_service"),
)


def _ensure_agent_service_in_path() -> None:
    if _AGENT_SERVICE_DIR not in sys.path:
        sys.path.insert(0, _AGENT_SERVICE_DIR)


class BaseAgent(ABC):
    """Abstract base for all multi-agent agents.

    Subclasses must define:
      - role: AgentRole class attribute
      - execute(ctx) -> AgentMessage method

    The chat config is injected at init so all agents share the same
    LLM configuration (model, api_key, base_url) from the orchestrator.
    """

    role: AgentRole

    def __init__(self, chat_config: dict[str, str]):
        self._chat_config = chat_config

    # ── LLM helpers ──

    async def think(self, system_prompt: str, user_content: str) -> str:
        """Call the LLM with a system prompt and user content. Returns raw text."""
        _ensure_agent_service_in_path()
        from chat_client import execute_chat_with_fallbacks, get_chat_fallback_configs

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ]

        primary_config = {
            "protocol": "openai",
            "api_key": self._chat_config.get("api_key", ""),
            "base_url": self._chat_config.get("base_url", "https://api.deepseek.com/v1"),
            "model": self._chat_config.get("model", "deepseek-chat"),
        }

        return await execute_chat_with_fallbacks(
            messages, primary_config, get_chat_fallback_configs()
        )

    async def think_structured(
        self,
        system_prompt: str,
        user_content: str,
        output_schema: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Call the LLM and parse the response as JSON. Returns a dict."""
        _ensure_agent_service_in_path()
        from chat_client import execute_chat_with_fallbacks, get_chat_fallback_configs
        from config import clean_json_string

        # Append JSON output instruction if schema is provided
        full_system = system_prompt
        if output_schema:
            schema_str = json.dumps(output_schema, ensure_ascii=False, indent=2)
            full_system += (
                f"\n\n请严格按照以下 JSON schema 输出（不要 markdown 包裹）：\n```json\n{schema_str}\n```"
            )
        else:
            full_system += "\n\n请输出严格的 JSON 对象（不要 markdown 包裹）。"

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": full_system},
            {"role": "user", "content": user_content},
        ]

        primary_config = {
            "protocol": "openai",
            "api_key": self._chat_config.get("api_key", ""),
            "base_url": self._chat_config.get("base_url", "https://api.deepseek.com/v1"),
            "model": self._chat_config.get("model", "deepseek-chat"),
        }

        resp = await execute_chat_with_fallbacks(
            messages, primary_config, get_chat_fallback_configs()
        )
        cleaned = clean_json_string(resp)
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            logger.warning(f"[{self.role.value}] Failed to parse JSON, returning raw text")
            return {"raw_output": resp, "parse_error": True}

    # ── Abstract method ──

    @abstractmethod
    async def execute(self, ctx: SharedContext) -> AgentMessage:
        """Execute this agent's task using the shared context.

        Args:
            ctx: The shared blackboard. Read inputs from ctx, write outputs back.

        Returns:
            An AgentMessage describing what was done and its result.
        """
        ...

    # ── Utility ──

    def _build_agent_message(
        self,
        action: str,
        content: str,
        data: dict[str, Any] | None = None,
        success: bool = True,
        error: str | None = None,
    ) -> AgentMessage:
        return AgentMessage(
            role=self.role,
            action=action,
            content=content,
            data=data or {},
            success=success,
            error=error,
        )
