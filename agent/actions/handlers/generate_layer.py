"""
generate_layer action handler

Generates a single layer image. Reuses image generation logic from the
existing agent_loop._tool_generate_image (Doubao Seedream → DALL-E 3 →
DALL-E 2 → Anthropic SVG fallback chain).
"""

from __future__ import annotations

import os
import sys
import logging

import httpx

from agent.models import (
    ActionParams,
    ActionResult,
    CanvasState,
    GenerateLayerParams,
)

logger = logging.getLogger(__name__)

MAX_RETRIES_PER_IMAGE = 3


async def generate_layer_fn(
    params: ActionParams,
    canvas: CanvasState,
) -> ActionResult:
    """Generate a single layer image and add it to the canvas.

    Expects params to be GenerateLayerParams with: layer_type, prompt, style_tags.
    Also reads extra fields from the raw params dict for API configuration.
    """
    p = _to_generate_params(params)
    if not p.prompt:
        return ActionResult(success=False, error="No prompt provided")

    # Resolve image size from canvas or params
    size_str = params.model_extra.get("size_doubao", "1920x1920") if params.model_extra else "1920x1920"
    neg_prompt = (params.model_extra or {}).get("negative_prompt", "低画质、变形肢体、模糊、水印")
    image_model_key = (params.model_extra or {}).get("image_model_key", "")
    aspect_ratio = (params.model_extra or {}).get("aspect_ratio", "1:1")

    img_url = None
    gen_errors: list[str] = []

    # Try primary image model (Doubao Seedream)
    if image_model_key:
        try:
            url = os.getenv(
                "IMAGE_API_BASE_URL",
                "https://ark.cn-beijing.volces.com/api/v3/images/generations",
            )
            headers = {
                "Authorization": f"Bearer {image_model_key}",
                "Content-Type": "application/json",
            }
            payload = {
                "model": os.getenv("DOUBAO_IMAGE_MODEL", "doubao-seedream-5-0-260128"),
                "prompt": p.prompt,
                "size": size_str,
                "response_format": "url",
                "extra_body": {"watermark": True},
            }
            if neg_prompt:
                payload["negative_prompt"] = neg_prompt

            async with httpx.AsyncClient(
                timeout=httpx.Timeout(90.0, connect=30.0)
            ) as client:
                resp = await client.post(url, headers=headers, json=payload)
                if resp.status_code == 200:
                    data = resp.json()
                    images = data.get("data", [])
                    if images:
                        img_url = images[0].get("url")
                else:
                    gen_errors.append(f"HTTP {resp.status_code}: {resp.text[:200]}")
        except Exception as e:
            gen_errors.append(f"Primary: {str(e)}")

    # Try fallbacks
    if not img_url:
        img_url = await _try_image_fallbacks(p.prompt, aspect_ratio, neg_prompt, gen_errors)

    if img_url:
        # Build a new layer with the generated image
        from agent.canvas.state import CanvasStateManager

        # Return the URL in data; the caller (core loop) will manage canvas state
        return ActionResult(
            success=True,
            data={
                "url": img_url,
                "prompt": p.prompt,
                "layer_type": p.layer_type,
                "style_tags": p.style_tags,
            },
        )
    else:
        return ActionResult(
            success=False,
            error="; ".join(gen_errors),
        )


async def _try_image_fallbacks(
    prompt: str,
    aspect_ratio: str,
    neg_prompt: str,
    errors: list[str],
) -> str | None:
    """Try fallback image generation APIs."""
    # Delayed imports to avoid circular dependencies at module level
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..",
                                     "backend", "agent_service"))
    from chat_client import (
        get_image_fallback_configs,
        call_openai_image_api,
        call_anthropic_svg_generator,
    )
    from config import map_ratio_for_openai_image

    for idx, fb_config in enumerate(get_image_fallback_configs()):
        if not fb_config.get("api_key"):
            continue
        try:
            protocol = fb_config["protocol"].lower().strip()
            if protocol == "openai":
                img_url = await call_openai_image_api(
                    prompt,
                    map_ratio_for_openai_image(aspect_ratio),
                    neg_prompt,
                    fb_config,
                )
            elif protocol == "anthropic":
                img_url = await call_anthropic_svg_generator(
                    prompt, neg_prompt, fb_config
                )
            else:
                continue
            if img_url:
                return img_url
        except Exception as e:
            errors.append(f"Fallback {idx + 1}: {str(e)}")

    return None


def _to_generate_params(params: ActionParams) -> GenerateLayerParams:
    """Convert generic ActionParams to GenerateLayerParams."""
    if isinstance(params, GenerateLayerParams):
        return params
    return GenerateLayerParams(
        action=params.action or "generate_layer",
        layer_type=params.model_extra.get("layer_type", "subject") if params.model_extra else "subject",
        prompt=params.model_extra.get("prompt", "") if params.model_extra else "",
        style_tags=params.model_extra.get("style_tags", []) if params.model_extra else [],
    )
