"""
layout_suggest action handler

AI-suggested layer layout for a set of image types.
"""

from __future__ import annotations

from agent.canvas.layer_ops import suggest_layout
from agent.models import ActionParams, ActionResult, CanvasState


async def layout_suggest_fn(
    params: ActionParams,
    canvas: CanvasState,
) -> ActionResult:
    """Suggest bounding box layouts for requested image types.

    Expects params.model_extra to contain:
    - image_types: list[str] — types to generate layout for
    """
    extra = params.model_extra or {}
    image_types = extra.get("image_types", [])

    if not image_types:
        # Default to existing layer types on canvas
        image_types = [l.type for l in canvas.layers]
        if not image_types:
            image_types = ["subject"]

    boxes = suggest_layout(image_types, canvas.size)
    layout = [
        {"image_type": it, "bbox": bbox.model_dump()}
        for it, bbox in zip(image_types, boxes)
    ]

    return ActionResult(
        success=True,
        data={
            "action": "layout_suggest",
            "layout": layout,
            "canvas_size": {
                "width": canvas.size.width,
                "height": canvas.size.height,
            },
        },
    )