"""
Multi-Agent — Shared Context

Defines AgentRole enum, AgentMessage for inter-agent communication,
and SharedContext — the blackboard that all agents read from and write to.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from agent.models import DesignBrief


class AgentRole(str, Enum):
    """All agent roles in the multi-agent architecture."""
    ORCHESTRATOR = "orchestrator"
    REQUIREMENT_COLLECTOR = "requirement_collector"
    COMPETITOR_ANALYST = "competitor_analyst"
    PROMPT_WRITER = "prompt_writer"
    IMAGE_GENERATOR = "image_generator"
    REVIEWER = "reviewer"


class AgentMessage(BaseModel):
    """A message produced by an agent during execution, logged to message_history."""

    role: AgentRole
    action: str = ""  # e.g. "collect_requirements", "analyze_competitors"
    content: str = ""  # human-readable summary
    data: dict[str, Any] = Field(default_factory=dict)  # structured output
    timestamp: datetime = Field(default_factory=datetime.now)
    success: bool = True
    error: str | None = None


class SharedContext(BaseModel):
    """Shared blackboard for all agents in a single orchestration run.

    Agents read from and write to this context. No agent communicates
    directly with another — all data flows through SharedContext.
    """

    session_id: str = ""
    user_message: str = ""

    # ── Requirement Collector output ──
    design_brief: DesignBrief | None = None

    # ── Competitor Analyst output ──
    competitor_report: dict[str, Any] | None = None

    # ── RAG / knowledge context ──
    rag_context: str = ""

    # ── Prompt Writer output ──
    final_prompts: list[dict[str, Any]] = Field(default_factory=list)
    # Each item: {"layer_type": "subject", "prompt": "...", "style_tags": [...]}

    # ── Image Generator output ──
    generated_images: dict[str, str] = Field(default_factory=dict)
    # e.g. {"subject": "https://...", "background": "https://..."}

    # ── Reviewer output ──
    review_results: list[dict[str, Any]] = Field(default_factory=list)
    # Each item: {"layer_type": "...", "passed": bool, "score": float, "issues": [...], "suggestions": [...]}

    # ── Final chat reply ──
    chat_reply: str = ""

    # ── Execution log ──
    message_history: list[AgentMessage] = Field(default_factory=list)

    # ── Extra metadata ──
    metadata: dict[str, Any] = Field(default_factory=dict)

    def add_message(self, msg: AgentMessage) -> None:
        """Append a message to the execution log."""
        self.message_history.append(msg)

    def last_message(self) -> AgentMessage | None:
        """Get the most recent message, or None if empty."""
        return self.message_history[-1] if self.message_history else None
