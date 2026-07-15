"""
Multi-Agent — Agent Registry

Imports and registers all agents. Provides a factory function
to instantiate all agents with shared configs.
"""

from agent.multi_agent.agents.requirement_collector import RequirementCollectorAgent
from agent.multi_agent.agents.competitor_analyst import CompetitorAnalystAgent
from agent.multi_agent.agents.prompt_writer import PromptWriterAgent
from agent.multi_agent.agents.image_generator import ImageGeneratorAgent
from agent.multi_agent.agents.reviewer import ReviewerAgent

__all__ = [
    "RequirementCollectorAgent",
    "CompetitorAnalystAgent",
    "PromptWriterAgent",
    "ImageGeneratorAgent",
    "ReviewerAgent",
    "create_all_agents",
]


def create_all_agents(
    chat_config: dict[str, str],
    image_config: dict[str, str],
    vision_config: dict[str, str] | None = None,
) -> dict:
    """Create all agent instances with shared configurations.

    Returns a dict keyed by AgentRole value.
    """
    return {
        "requirement_collector": RequirementCollectorAgent(chat_config),
        "competitor_analyst": CompetitorAnalystAgent(chat_config),
        "prompt_writer": PromptWriterAgent(chat_config),
        "image_generator": ImageGeneratorAgent(chat_config, image_config),
        "reviewer": ReviewerAgent(chat_config, vision_config),
    }