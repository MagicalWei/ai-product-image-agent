"""
remove_background action handler

Removes background from a layer image. Can call @imgly/background-removal
(WASM, frontend) or rembg (Python, backend).
"""

from __future__ import annotations

from agent.models import ActionParams, ActionResult, CanvasState


async def remove_background_fn(
    params: ActionParams,
    canvas: CanvasState,
) -> ActionResult:
    """Remove background from a layer's image.

    Expects params.model_extra to contain:
    - layer_id: str — target layer to remove background from
    """
    extra = params.model_extra or {}
    layer_id = extra.get("layer_id", "")

    if not layer_id:
        return ActionResult(success=False, error="No layer_id provided for remove_background")

    layer = canvas.get_layer(layer_id)
    if layer is None:
        return ActionResult(
            success=False,
            error=f"Layer '{layer_id}' not found in canvas '{canvas.canvas_id}'",
        )

    if not layer.asset_ref:
        return ActionResult(
            success=False,
            error=f"Layer '{layer_id}' has no asset_ref to process",
        )

    # TODO: Integrate with rembg or call external background removal service
    # For now, this signals that the frontend should handle it via @imgly/background-removal

    return ActionResult(
        success=True,
        data={
            "action": "remove_background",
            "layer_id": layer_id,
            "asset_ref": layer.asset_ref,
            "note": "Background removal — frontend-side via @imgly/background-removal or backend rembg",
        },
    )