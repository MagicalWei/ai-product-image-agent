"""
Prompt Expander

Expands a short user description into a professional 80-150 word English
image generation prompt. Reuses IMAGE_TYPE_CONFIGS prompt templates.

When a RAG retriever is available, performs on-demand multi-category
retrieval to enrich the expanded prompt with style guides and platform rules.
"""

from __future__ import annotations

import os
import sys
from typing import Any

from agent.models import DesignBrief, EnrichedContext, LayerType


async def expand_prompt(
    brief: DesignBrief,
    context: EnrichedContext,
    layer_type: LayerType = "subject",
    rag_retriever: Any = None,
) -> str:
    """Expand a design brief into a detailed English image generation prompt.

    Uses IMAGE_TYPE_CONFIGS prompt templates from the existing config.py
    as a base, filling in product name, selling points, style, etc.

    If rag_retriever is provided, performs on-demand retrieval against
    prompt_template and style_guide categories to enrich the output.

    Args:
        brief: The design brief extracted from user input.
        context: Enriched context with RAG, brand, memory.
        layer_type: The type of layer being generated.
        rag_retriever: Optional RAGRetriever for on-demand knowledge search.

    Returns:
        An 80-150 word English prompt ready for the image generation API.
    """
    # Load IMAGE_TYPE_CONFIGS from existing config
    _agent_service_dir = os.path.abspath(
        os.path.join(
            os.path.dirname(__file__),
            "..", "..", "backend", "agent_service",
        ),
    )
    if _agent_service_dir not in sys.path:
        sys.path.insert(0, _agent_service_dir)
    from config import IMAGE_TYPE_CONFIGS

    # Map layer_type to image config key
    type_map = {
        "subject": "main",
        "background": "scene_selling",
        "text": "selling_point",
        "decoration": "scene_tag",
    }
    config_key = type_map.get(layer_type, "main")
    img_config = IMAGE_TYPE_CONFIGS.get(config_key, IMAGE_TYPE_CONFIGS["main"])

    template = img_config.get("prompt_template", "")

    # Fill template placeholders
    # Use brief fields with fallbacks
    product = brief.subject or "product"
    selling_points = brief.selling_points or "high quality, professional"
    style = brief.style_hint or "clean studio lighting"
    platform = brief.platform or "e-commerce"
    country = brief.target_country or "global"

    prompt = template.format(
        product_name=product,
        selling_points=selling_points,
        style_preference=style,
        ecom_platform=platform,
        target_country=country,
    )

    # ── RAG enrichment: on-demand multi-category retrieval ──
    rag_context = await _enrich_with_rag(brief, rag_retriever, context.rag_context)

    if rag_context:
        # Append RAG style guidance at the end for the image model
        rag_trimmed = rag_context[:300]
        prompt += f" Additional style notes: {rag_trimmed}"

    # Ensure prompt is in reasonable length range
    words = prompt.split()
    if len(words) < 50:
        # Pad with professional photography terms
        prompt += (
            " Professional product photography, commercial photography quality, "
            "high resolution, detailed texture, perfect lighting."
        )
    elif len(words) > 200:
        # Truncate
        prompt = " ".join(words[:200])

    return prompt.strip()


async def _enrich_with_rag(
    brief: DesignBrief,
    rag_retriever: Any,
    existing_rag_context: str = "",
) -> str:
    """Perform on-demand RAG retrieval for prompt enrichment.

    Tries to retrieve from multiple knowledge categories relevant to the
    layer being generated. Falls back to existing_rag_context if the
    retriever is unavailable or returns no results.

    Args:
        brief: The design brief.
        rag_retriever: RAGRetriever instance or None.
        existing_rag_context: Pre-fetched RAG context from the SENSE phase.

    Returns:
        Enriched RAG context string (truncated to 500 chars).
    """
    if rag_retriever is None:
        return existing_rag_context

    query = f"{brief.subject} {brief.style_hint} {brief.platform}".strip()
    if not query:
        return existing_rag_context

    try:
        result = await rag_retriever.retrieve_multi_category(
            query=query,
            categories=["prompt_template", "style_guide", "platform_rule"],
            top_k_per_category=2,
        )
        if result.context:
            return result.context[:500]
    except Exception:
        pass

    return existing_rag_context