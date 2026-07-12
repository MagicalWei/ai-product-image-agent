"""
upscale action handler

Super-resolution upscaling of a layer image.
"""

from __future__ import annotations

from agent.models import ActionParams, ActionResult, CanvasState


async def upscale_fn(
    params: ActionParams,
    canvas: CanvasState,
) -> ActionResult:
    """Upscale a layer image by scale_factor.

    Expects params.model_extra to contain:
    - layer_id: str — target layer
    - scale_factor: int — 2 or 4 (default: 2)
    """
    extra = params.model_extra or {}
    layer_id = extra.get("layer_id", "")
    scale_factor = extra.get("scale_factor", 2)

    if not layer_id:
        return ActionResult(success=False, error="No layer_id provided for upscale")

    layer = canvas.get_layer(layer_id)
    if layer is None:
        return ActionResult(
            success=False,
            error=f"Layer '{layer_id}' not found in canvas '{canvas.canvas_id}'",
        )

    if not layer.asset_ref:
        return ActionResult(
            success=False,
            error=f"Layer '{layer_id}' has no asset_ref to upscale",
        )

    if scale_factor not in (2, 4):
        return ActionResult(
            success=False,
            error=f"scale_factor must be 2 or 4, got {scale_factor}",
        )

    # TODO: Integrate with upscaling API (e.g., Real-ESRGAN, Seedream upscale)
    return ActionResult(
        success=True,
        data={
            "action": "upscale",
            "layer_id": layer_id,
            "asset_ref": layer.asset_ref,
            "scale_factor": scale_factor,
            "note": "Upscale — API integration pending",
        },
    )