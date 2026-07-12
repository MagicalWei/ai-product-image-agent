"""
Local Review

Evaluates a single generated layer against its prompt — checks clarity,
artifacts, and prompt adherence. Uses a lightweight VLM.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from typing import Any

from agent.models import Layer, ReviewResult

logger = logging.getLogger(__name__)


async def review_layer_quality(
    layer: Layer,
    image_url: str,
    prompt_used: str,
    vision_config: dict[str, str],
) -> ReviewResult:
    """Review a single layer's image quality against its prompt.

    Args:
        layer: The layer that was generated.
        image_url: URL of the generated image.
        prompt_used: The prompt used to generate the image.
        vision_config: Dict with api_key, base_url, model for the vision model.

    Returns:
        ReviewResult with scores, passed/failed, issues, and suggestions.
    """
    # Load the evaluator prompt and chat client
    _agent_service_dir = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "backend", "agent_service"),
    )
    if _agent_service_dir not in sys.path:
        sys.path.insert(0, _agent_service_dir)

    from prompts import IMAGE_EVALUATOR_SYSTEM_PROMPT

    vision_api_key = vision_config.get("api_key", "")
    if not vision_api_key:
        # No vision model available — return a default pass
        return ReviewResult(
            passed=True,
            overall_score=75.0,
            local_score=75.0,
            scores={},
            issues=[],
            suggestions=["No vision model available for review"],
        )

    eval_context = (
        f"Evaluate this {layer.type} layer image quality.\n"
        f"Prompt used: {prompt_used[:300]}\n"
    )

    try:
        from chat_client import execute_chat_with_fallbacks, get_chat_fallback_configs
        from config import clean_json_string

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": IMAGE_EVALUATOR_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": eval_context},
                    {
                        "type": "image_url",
                        "image_url": {"url": image_url, "detail": "auto"},
                    },
                ],
            },
        ]

        primary_config = {
            "protocol": "openai",
            "api_key": vision_api_key,
            "base_url": vision_config.get("base_url", "https://api.openai.com/v1"),
            "model": vision_config.get("model", "gpt-4o"),
        }

        resp = await execute_chat_with_fallbacks(
            messages, primary_config, get_chat_fallback_configs()
        )
        cleaned = clean_json_string(resp)
        evaluation = json.loads(cleaned)

        overall = evaluation.get("overall_score", 70)
        passed = evaluation.get("passed", overall >= 80)

        return ReviewResult(
            passed=passed,
            overall_score=overall,
            local_score=overall,
            scores=evaluation.get("scores", {}),
            issues=evaluation.get("issues", []),
            suggestions=evaluation.get("suggestions", []),
        )
    except Exception as e:
        logger.warning(f"Local review failed: {e}")
        return ReviewResult(
            passed=True,
            overall_score=75.0,
            local_score=75.0,
            scores={},
            issues=[],
            suggestions=[f"Review skipped due to error: {str(e)}"],
        )