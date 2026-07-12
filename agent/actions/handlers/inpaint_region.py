"""
inpaint_region action handler

Local inpainting/repainting of a region within a layer based on bbox + mask.
"""

from __future__ import annotations

from agent.models import ActionParams, ActionResult, CanvasState


async def inpaint_region_fn(
    params: ActionParams,
    canvas: CanvasState,
) -> ActionResult:
    """Inpaint a specific region of a layer.

    Expects params.model_extra to contain:
    - layer_id: str — target layer
    - bbox: dict with x, y, width, height
    - prompt: str — what to generate in the masked region
    - mask_ref: str | None — optional mask image reference
    """
    extra = params.model_extra or {}
    layer_id = extra.get("layer_id", "")
    prompt = extra.get("prompt", "")
    bbox_data = extra.get("bbox", {})
    mask_ref = extra.get("mask_ref")

    if not layer_id:
        return ActionResult(success=False, error="No layer_id provided for inpaint")

    layer = canvas.get_layer(layer_id)
    if layer is None:
        return ActionResult(
            success=False,
            error=f"Layer '{layer_id}' not found in canvas '{canvas.canvas_id}'",
        )

    if not prompt:
        return ActionResult(success=False, error="No prompt provided for inpaint")

    # TODO: Integrate with actual inpainting API (e.g., Seedream inpaint endpoint)
    # For now, this is a placeholder that returns the region info.
    # The actual inpainting will call the image generation API with a mask.

    return ActionResult(
        success=True,
        data={
            "action": "inpaint_region",
            "layer_id": layer_id,
            "bbox": bbox_data,
            "prompt": prompt,
            "mask_ref": mask_ref,
            "note": "Inpaint handler — API integration pending",
        },
    )