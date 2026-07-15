"""
Multi-Agent Architecture Package

Provides a multi-agent collaboration system as an alternative to the
sense-decide-act-review single-agent loop.

Usage:
    from agent.multi_agent import MultiAgentOrchestrator

    orchestrator = MultiAgentOrchestrator(
        chat_config=...,
        image_config=...,
        vision_config=...,
        rag_retriever=...,
    )
    async for event in orchestrator.run(message, memory):
        yield event
"""

from agent.multi_agent.shared_context import AgentRole, AgentMessage, SharedContext
from agent.multi_agent.base import BaseAgent
from agent.multi_agent.orchestrator import MultiAgentOrchestrator

__all__ = [
    "AgentRole",
    "AgentMessage",
    "SharedContext",
    "BaseAgent",
    "MultiAgentOrchestrator",
]
