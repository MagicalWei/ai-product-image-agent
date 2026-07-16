"""Generate an e-commerce image set using one product and one style reference."""

from __future__ import annotations

import json
import os
import sys
import asyncio
from typing import Any

from agent.actions.handlers.generate_layer import generate_layer_fn
from agent.models import ActionParams, ActionResult, CanvasState


STYLE_SYSTEM_PROMPT = """你是电商视觉风格分析师。只分析参考图的视觉语言，不识别或复用其中商品。
返回严格 JSON：dominant_colors(数组), lighting, composition, background, mood, typography, decorative_elements(数组)。
不要输出品牌名、商品名、Logo 或参考图文案。"""


async def _analyze_style(image: str, config: dict[str, str]) -> dict[str, Any]:
    if not config.get("api_key"):
        return {}
    service_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "backend", "agent_service"))
    if service_dir not in sys.path:
        sys.path.insert(0, service_dir)
    from chat_client import execute_chat_with_fallbacks, get_chat_fallback_configs
    from config import clean_json_string

    image_url = image if image.startswith("data:") else f"data:image/png;base64,{image}"
    response = await execute_chat_with_fallbacks([
        {"role": "system", "content": STYLE_SYSTEM_PROMPT},
        {"role": "user", "content": [
            {"type": "text", "text": "分析这张图可迁移的视觉风格。"},
            {"type": "image_url", "image_url": {"url": image_url}},
        ]},
    ], {
        "protocol": "openai",
        "api_key": config.get("api_key", ""),
        "base_url": config.get("base_url", ""),
        "model": config.get("model", ""),
    }, get_chat_fallback_configs())
    try:
        return json.loads(clean_json_string(response))
    except (json.JSONDecodeError, TypeError):
        return {}


def _style_summary(style: dict[str, Any]) -> str:
    return "; ".join(
        f"{key}: {', '.join(value) if isinstance(value, list) else value}"
        for key, value in style.items() if value
    ) or "faithfully match the reference image's palette, lighting, composition, background treatment and mood"


async def style_transfer_batch_fn(params: ActionParams, canvas: CanvasState) -> ActionResult:
    extra = params.model_extra or {}
    product_image = extra.get("product_image", "")
    style_images = extra.get("style_reference_images", []) or []
    if not product_image or not style_images:
        return ActionResult(success=False, error="产品图和风格参考图均不能为空")

    style = await _analyze_style(style_images[0], extra.get("multimodal_config", {}) or {})
    style_text = _style_summary(style)
    product_name = extra.get("product_name", "新产品")
    selling_points = extra.get("selling_points", "")
    common = (
        "IMAGE 1 is the authoritative NEW PRODUCT. Preserve its exact identity, shape, proportions, colors, materials and details. "
        "IMAGE 2 is STYLE-ONLY: borrow palette, lighting, composition rhythm, background treatment and mood, but never copy its product, "
        "logo, trademark, text or distinctive props. The final image must feature only IMAGE 1's product. "
        f"Product: {product_name}. Transferable style: {style_text}. "
    )
    prompts = {
        "main": common + "Create a premium square e-commerce hero main image, strong product focus, clean hierarchy, no copied text or logos.",
        "selling_point": common + f"Create a square selling-point image with clear visual callouts for: {selling_points or 'visible product advantages'}. Use concise original Chinese copy only when legible.",
        "detail": common + f"Create a vertical product detail image with close-up feature storytelling and structured information sections for: {selling_points or 'visible product details'}. Use original layout and copy.",
    }
    references = [product_image, style_images[0]]

    async def generate_one(image_type: str, prompt: str):
        result = await generate_layer_fn(ActionParams(
            action="generate_layer",
            layer_type="subject",
            prompt=prompt,
            reference_images=references,
            image_model_key=extra.get("image_model_key", ""),
            negative_prompt=extra.get("negative_prompt", ""),
            aspect_ratio="3:4" if image_type == "detail" else "1:1",
            size_doubao="1440x1920" if image_type == "detail" else "1920x1920",
        ), canvas)
        return image_type, result

    generated = await asyncio.gather(*(
        generate_one(image_type, prompt) for image_type, prompt in prompts.items()
    ))
    images: dict[str, str] = {}
    errors: list[str] = []
    for image_type, result in generated:
        if result.success and result.data.get("url"):
            images[image_type] = result.data["url"]
        else:
            errors.append(f"{image_type}: {result.error or '未返回图片'}")

    # A style set is only useful when all requested formats exist. Retry only
    # the missing formats once; successful images are never regenerated.
    missing_types = [image_type for image_type in prompts if image_type not in images]
    if missing_types:
        retried = await asyncio.gather(*(
            generate_one(image_type, prompts[image_type]) for image_type in missing_types
        ))
        errors = []
        for image_type, result in retried:
            if result.success and result.data.get("url"):
                images[image_type] = result.data["url"]
            else:
                errors.append(f"{image_type}: {result.error or '未返回图片'}")
    return ActionResult(
        success=bool(images),
        data={"images": images, "prompts": prompts, "style_analysis": style, "errors": errors},
        error="; ".join(errors) if not images else None,
    )
