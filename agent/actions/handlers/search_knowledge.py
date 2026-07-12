"""
Search Knowledge Action Handler

Exposes RAG knowledge search as a DECIDE-phase action, allowing the LLM
to perform on-demand retrieval mid-task — matching the old architecture's
search_knowledge tool capability.
"""

from __future__ import annotations

import logging
from typing import Any

from agent.models import ActionParams, ActionResult, CanvasState

logger = logging.getLogger(__name__)


async def search_knowledge_fn(
    params: ActionParams,
    canvas: CanvasState,
) -> ActionResult:
    """Search the RAG knowledge base for prompt templates, style guides,
    platform rules, or copywriting references.

    The rag_retriever is injected via params.model_extra — the DECIDE phase
    passes it through when the LLM selects this action.

    Expected params.model_extra keys:
        - rag_retriever: RAGRetriever instance
        - query: search query string
        - categories: list of category names to search
    """
    extra = getattr(params, "model_extra", {}) or {}
    rag_retriever = extra.get("rag_retriever")
    query = extra.get("query", "")
    categories = extra.get("categories", ["prompt_template", "style_guide"])

    if rag_retriever is None:
        return ActionResult(
            success=False,
            error="RAG retriever not available",
        )

    if not query:
        return ActionResult(
            success=False,
            error="No search query provided",
        )

    try:
        result = await rag_retriever.retrieve_multi_category(
            query=query,
            categories=categories,
            top_k_per_category=2,
        )

        results_list = [
            {"content": r.content[:300], "category": r.category, "score": r.score}
            for r in result.results
        ]

        return ActionResult(
            success=True,
            data={
                "results": results_list,
                "results_count": len(results_list),
                "context": result.context[:500] if result.context else "",
                "query": query,
            },
        )
    except Exception as e:
        logger.error(f"search_knowledge action failed: {e}")
        return ActionResult(
            success=False,
            error=f"Knowledge search failed: {str(e)}",
        )
