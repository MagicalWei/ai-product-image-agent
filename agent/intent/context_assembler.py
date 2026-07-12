"""
Context Assembler

Assembles enriched context from multiple sources: design brief, brand
memory, RAG retrieval, and agent memory — packaged for the decide phase.
"""

from __future__ import annotations

from typing import Any

from agent.models import DesignBrief, EnrichedContext


async def assemble_context(
    brief: DesignBrief,
    memory: Any,  # AgentMemory from backend.agent_service.memory
    brand_context: str = "",
    rag_context: str = "",
) -> EnrichedContext:
    """Assemble all context sources into an EnrichedContext for the decide phase.

    Args:
        brief: Design brief extracted from user input.
        memory: AgentMemory instance (existing memory system).
        brand_context: Pre-built brand memory string.
        rag_context: RAG retrieval results as formatted string.

    Returns:
        EnrichedContext ready for prompt expansion and decide phase.
    """
    memory_context = ""
    if memory is not None:
        try:
            memory_context = memory.build_llm_context()
        except Exception:
            memory_context = ""

    return EnrichedContext(
        design_brief=brief,
        rag_context=rag_context,
        brand_context=brand_context,
        memory_context=memory_context,
    )