"""Generate a deterministic e-commerce image set from an authoritative product image."""

from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import Any

from agent.actions.handlers.generate_layer import generate_layer_fn
from agent.models import ActionParams, ActionResult, CanvasState


SUPPORTED_IMAGE_TYPES = ("main", "selling_point", "detail")


def _normalize_visual_direction(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "design_rationale": str(raw.get("design_rationale") or "").strip()[:400],
        "palette": [str(item).strip()[:60] for item in raw.get("palette", [])[:6]]
        if isinstance(raw.get("palette"), list) else [],
        "lighting": str(raw.get("lighting") or "").strip()[:200],
        "background": str(raw.get("background") or "").strip()[:260],
        "layout": str(raw.get("layout") or "").strip()[:300],
        "typography": str(raw.get("typography") or "").strip()[:200],
    }


async def _plan_visual_direction(
    product_image: str,
    product_name: str,
    selling_points: str,
    config: dict[str, str],
) -> dict[str, Any]:
    if not all(str(config.get(key) or "").strip() for key in ("api_key", "base_url", "model")):
        return {}
    service_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "backend", "agent_service"))
    if service_dir not in sys.path:
        sys.path.insert(0, service_dir)
    from chat_client import execute_chat_with_fallbacks

    try:
        response = await execute_chat_with_fallbacks([
            {
                "role": "system",
                "content": (
                    "你是电商视觉总监。根据商品图可见证据和用户卖点，为一套主图、卖点图、详情图制定统一视觉方向。"
                    "不要虚构商品材质、功能、品牌或参数，不要套用固定风格标签。只输出 JSON。"
                ),
            },
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": (
                        f"商品：{product_name}；卖点：{selling_points}。"
                        '返回：{"design_rationale":"","palette":[""],"lighting":"",'
                        '"background":"","layout":"","typography":""}'
                    )},
                    {"type": "image_url", "image_url": {"url": product_image, "detail": "low"}},
                ],
            },
        ], {
            "protocol": "openai",
            "api_key": config["api_key"],
            "base_url": config["base_url"],
            "model": config["model"],
            "supports_vision": True,
            "max_tokens": 1000,
            "timeout_seconds": 60,
        }, [])
        text = str(response or "").replace("```json", "").replace("```", "").strip()
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            text = text[start:end + 1]
        return _normalize_visual_direction(json.loads(text))
    except Exception:
        return {}


def _direction_summary(direction: dict[str, Any]) -> str:
    values = []
    for key in ("design_rationale", "palette", "lighting", "background", "layout", "typography"):
        value = direction.get(key)
        if isinstance(value, list):
            value = ", ".join(value)
        if value:
            values.append(f"{key}: {value}")
    return "; ".join(values)


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
    style_preference = str(extra.get("style_preference") or "")
    automatic_style = not style_preference or style_preference.startswith("根据商品")
    visual_direction = await _plan_visual_direction(
        product_image,
        product_name,
        selling_points,
        extra.get("multimodal_config", {}) or {},
    ) if automatic_style else {}
    style = (
        _direction_summary(visual_direction)
        or style_preference
        or "clean evidence-based e-commerce hierarchy consistent with the visible product"
    )
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
        data={
            "images": images,
            "prompts": prompts,
            "errors": errors,
            "requested_types": requested,
            "visual_direction": visual_direction,
        },
        error="; ".join(errors) if not images else None,
    )
