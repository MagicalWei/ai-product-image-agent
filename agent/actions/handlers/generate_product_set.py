"""Generate a deterministic e-commerce image set from an authoritative product image."""

from __future__ import annotations

import asyncio

from agent.actions.handlers.generate_layer import generate_layer_fn
from agent.models import ActionParams, ActionResult, CanvasState


SUPPORTED_IMAGE_TYPES = ("main", "selling_point", "detail")


async def generate_product_set_fn(params: ActionParams, canvas: CanvasState) -> ActionResult:
    extra = params.model_extra or {}
    product_image = extra.get("product_image", "")
    if not product_image:
        return ActionResult(success=False, error="商品图不能为空")

    requested = [
        image_type for image_type in (extra.get("image_types") or [])
        if image_type in SUPPORTED_IMAGE_TYPES
    ]
    requested = list(dict.fromkeys(requested))
    if not requested:
        return ActionResult(success=False, error="未选择有效的套图类型")

    product_name = extra.get("product_name") or "新商品"
    selling_points = extra.get("selling_points") or "图片中可见且可证明的商品优势"
    style = extra.get("style_preference") or "高级、清晰、适合电商转化"
    common = (
        "IMAGE 1 is the authoritative product photograph. Preserve the exact product identity, shape, proportions, "
        "colors, materials, packaging and visible details. Do not replace, redesign or invent product features. "
        f"Product: {product_name}. Visual style: {style}. "
    )
    all_prompts = {
        "main": common + "Create a premium square e-commerce hero image with strong product focus, clean hierarchy and no unsupported claims.",
        "selling_point": common + f"Create a square selling-point image for: {selling_points}. Use concise original Chinese copy only when legible and only make claims supported by the input.",
        "detail": common + f"Create a vertical A+/detail-page image with structured sections, close-up visual storytelling and product benefits: {selling_points}.",
    }
    prompts = {image_type: all_prompts[image_type] for image_type in requested}

    async def generate_one(image_type: str):
        is_detail = image_type == "detail"
        result = await generate_layer_fn(ActionParams(
            action="generate_layer",
            layer_type="subject",
            prompt=prompts[image_type],
            reference_images=[product_image],
            image_model_key=extra.get("image_model_key", ""),
            negative_prompt=extra.get("negative_prompt", ""),
            aspect_ratio="3:4" if is_detail else "1:1",
            # Seedream requires at least 3,686,400 output pixels. 1440x1920
            # looks like 3:4 but is rejected by the API (2,764,800 pixels).
            size_doubao="1728x2304" if is_detail else "1920x1920",
        ), canvas)
        return image_type, result

    async def run(types: list[str]):
        return await asyncio.gather(*(generate_one(image_type) for image_type in types))

    images: dict[str, str] = {}
    errors: list[str] = []
    for image_type, result in await run(requested):
        if result.success and result.data.get("url"):
            images[image_type] = result.data["url"]
        else:
            errors.append(f"{image_type}: {result.error or '未返回图片'}")

    missing = [image_type for image_type in requested if image_type not in images]
    if missing:
        errors = []
        for image_type, result in await run(missing):
            if result.success and result.data.get("url"):
                images[image_type] = result.data["url"]
            else:
                errors.append(f"{image_type}: {result.error or '未返回图片'}")

    return ActionResult(
        success=bool(images),
        data={"images": images, "prompts": prompts, "errors": errors, "requested_types": requested},
        error="; ".join(errors) if not images else None,
    )
