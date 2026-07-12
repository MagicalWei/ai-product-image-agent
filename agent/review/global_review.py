"""
Global Review

Evaluates the entire canvas composition: color consistency, occlusion,
whitespace balance, overall harmony. Required after multi-layer compose.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from typing import Any

from agent.models import CanvasState, DesignBrief, ReviewResult

logger = logging.getLogger(__name__)

GLOBAL_REVIEW_SYSTEM_PROMPT = (
    "You are a professional e-commerce design reviewer. Evaluate the overall "
    "composition of a multi-layer product image.\n\n"
    "Evaluation dimensions (each 0-100):\n"
    "1. color_harmony: Are colors consistent across layers? No clashing tones.\n"
    "2. occlusion: Are layers properly stacked? No unwanted overlaps.\n"
    "3. whitespace_balance: Is there appropriate breathing room? Not too cluttered or empty.\n"
    "4. visual_hierarchy: Does the eye flow naturally from subject to supporting elements?\n"
    "5. brand_consistency: Does the overall look match the intended style and platform?\n"
    "6. composition_quality: Overall professional quality of the layout.\n\n"
    "Output strict JSON (no markdown wrapping):\n"
    '{"scores": {"color_harmony": 85, ...}, "overall_score": 83, "passed": true, '
    '"issues": ["text layer overlaps product"], "suggestions": ["move text 20px left"]}\n\n'
    "Pass threshold: overall_score >= 80.\n"
)


async def review_composition(
    canvas: CanvasState,
    design_brief: DesignBrief,
    vision_config: dict[str, str],
) -> ReviewResult:
    """Review the overall canvas composition across all layers.

    This MUST be called after multi-layer compose operations.
    Single-layer operations only need local_review.

    Args:
        canvas: Current canvas state with all layers.
        design_brief: The original design intent.
        vision_config: Dict with api_key, base_url, model for the vision model.

    Returns:
        ReviewResult with global composition scores.
    """
    vision_api_key = vision_config.get("api_key", "")

    # Build a text-only evaluation context (no composite image to show yet)
    layer_descriptions = []
    for layer in sorted(canvas.layers, key=lambda l: l.z_index):
        layer_descriptions.append(
            f"  - [{layer.type}] z={layer.z_index}, status={layer.status}, "
            f"bbox=({layer.bbox.x:.0f},{layer.bbox.y:.0f},{layer.bbox.width:.0f},{layer.bbox.height:.0f}), "
            f"tags={layer.style_tags}"
        )

    eval_context = (
        f"Evaluate the overall composition of this {canvas.size.width}x{canvas.size.height} canvas.\n"
        f"Design intent: {design_brief.subject} — {design_brief.style_hint} "
        f"for {design_brief.platform or 'e-commerce'}.\n"
        f"Layers ({len(canvas.layers)}):\n"
        + "\n".join(layer_descriptions)
    )

    if not vision_api_key:
        # No vision model — do a rule-based check
        return _rule_based_global_review(canvas, design_brief)

    try:
        _agent_service_dir = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "..", "backend", "agent_service"),
        )
        if _agent_service_dir not in sys.path:
            sys.path.insert(0, _agent_service_dir)
        from chat_client import execute_chat_with_fallbacks, get_chat_fallback_configs
        from config import clean_json_string

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": GLOBAL_REVIEW_SYSTEM_PROMPT},
            {"role": "user", "content": eval_context},
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
            global_score=overall,
            scores=evaluation.get("scores", {}),
            issues=evaluation.get("issues", []),
            suggestions=evaluation.get("suggestions", []),
        )
    except Exception as e:
        logger.warning(f"Global review failed: {e}")
        return _rule_based_global_review(canvas, design_brief)


def _rule_based_global_review(
    canvas: CanvasState,
    design_brief: DesignBrief,
) -> ReviewResult:
    """Fallback rule-based global review when no vision model is available."""
    issues: list[str] = []
    suggestions: list[str] = []

    # Check: at least one subject layer
    subject_layers = [l for l in canvas.layers if l.type == "subject"]
    if not subject_layers:
        issues.append("No subject layer found")
        suggestions.append("Add a product/subject layer as the focal point")

    # Check: z-index uniqueness
    z_indices = [l.z_index for l in canvas.layers]
    if len(z_indices) != len(set(z_indices)):
        issues.append("Duplicate z-indices detected")
        suggestions.append("Assign unique z-indices to each layer")

    # Check: all layers have valid status
    failed_layers = [l.id for l in canvas.layers if l.status == "failed"]
    if failed_layers:
        issues.append(f"Failed layers: {failed_layers}")
        suggestions.append("Regenerate or remove failed layers")

    # Score based on issue count
    score = max(30, 90 - len(issues) * 15)
    passed = score >= 80

    return ReviewResult(
        passed=passed,
        overall_score=float(score),
        global_score=float(score),
        scores={},
        issues=issues,
        suggestions=suggestions,
    )