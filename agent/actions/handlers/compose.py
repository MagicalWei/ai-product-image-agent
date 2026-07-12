"""
compose action handler

Multi-layer composition — flattens selected layers into a final image.
Must trigger global review after composition.
"""

from __future__ import annotations

from agent.models import ActionParams, ActionResult, CanvasState, ComposeParams


async def compose_fn(
    params: ActionParams,
    canvas: CanvasState,
) -> ActionResult:
    """Compose multiple layers into a single output.

    Expects params.model_extra to contain:
    - layer_ids: list[str] — layers to compose together
    - size: dict with width, height (optional, defaults to canvas size)

    After composition, the caller (core loop) must trigger global_review.
    """
    extra = params.model_extra or {}
    layer_ids = extra.get("layer_ids", [])
    if isinstance(params, ComposeParams):
        layer_ids = params.layer_ids

    if not layer_ids:
        return ActionResult(success=False, error="No layer_ids provided for compose")

    # Validate all layers exist
    for lid in layer_ids:
        if canvas.get_layer(lid) is None:
            return ActionResult(
                success=False,
                error=f"Layer '{lid}' not found in canvas '{canvas.canvas_id}'",
            )

    # Collect layers in z-index order
    selected = sorted(
        [l for l in canvas.layers if l.id in layer_ids],
        key=lambda l: l.z_index,
    )

    asset_refs = [l.asset_ref for l in selected if l.asset_ref]

    # TODO: Actual image compositing (PIL/Pillow or call external service)
    # For now, return the layer info so the frontend/caller can do composition

    return ActionResult(
        success=True,
        data={
            "action": "compose",
            "composed_layers": [l.id for l in selected],
            "asset_refs": asset_refs,
            "canvas_size": {
                "width": canvas.size.width,
                "height": canvas.size.height,
            },
            "needs_global_review": True,
        },
    )