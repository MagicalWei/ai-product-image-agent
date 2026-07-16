"""
Multi-Agent — Image Generator

Calls image generation APIs to produce candidate images for each prompt.
Supports both text-to-image and image-to-image (when reference images are provided).
Does NOT call LLM — uses the existing Doubao Seedream → DALL-E fallback chain.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys

import httpx

from agent.multi_agent.base import BaseAgent
from agent.multi_agent.shared_context import AgentRole, AgentMessage, SharedContext

logger = logging.getLogger(__name__)


class ImageGeneratorAgent(BaseAgent):
    """Generates images for each prompt using the image generation API chain.

    When ctx.reference_images contains images and the prompt indicates
    modification intent, uses image-to-image mode via Seedream's init_image.
    """

    role = AgentRole.IMAGE_GENERATOR

    def __init__(self, chat_config: dict[str, str], image_config: dict[str, str]):
        super().__init__(chat_config)
        self._image_config = image_config

    async def execute(self, ctx: SharedContext) -> AgentMessage:
        prompts = ctx.final_prompts
        if not prompts:
            return self._build_agent_message(
                action="generate_images",
                content="跳過生圖：沒有可用的 prompt",
                success=False,
                error="No prompts available",
            )

        # Image-to-image should only run when the user explicitly asked to edit
        # an existing image or to transfer/reference its style. Product uploads
        # are often just analysis inputs and should not force init_image.
        reference_images = self._select_generation_references(ctx)
        if reference_images:
            logger.info(
                f"[ImageGenerator] Image-to-image mode: {len(reference_images)} reference(s)"
            )

        logger.info(f"[ImageGenerator] Generating {len(prompts)} images...")

        # Generate all images in parallel
        tasks = [self._generate_single(p, reference_images) for p in prompts]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        generated_count = 0
        errors = []
        for i, result in enumerate(results):
            layer_type = prompts[i].get("layer_type", f"layer_{i}")
            if isinstance(result, Exception):
                errors.append(f"{layer_type}: {str(result)}")
                logger.error(f"[ImageGenerator] Failed for {layer_type}: {result}")
            elif result:
                ctx.generated_images[layer_type] = result
                generated_count += 1
            else:
                errors.append(f"{layer_type}: no URL returned")

        success = generated_count > 0
        return self._build_agent_message(
            action="generate_images",
            content=f"已生成 {generated_count}/{len(prompts)} 张图片",
            data={
                "generated_images": ctx.generated_images,
                "errors": errors,
            },
            success=success,
            error="; ".join(errors) if errors else None,
        )

    async def _generate_single(
        self, prompt_entry: dict, reference_images: list[str] | None = None
    ) -> str | None:
        """Generate a single image, trying primary then fallbacks.

        If ctx.reference_images are available, uses image-to-image mode
        by passing the first reference as init_image to Seedream.
        """
        prompt_text = prompt_entry.get("prompt", "")
        if not prompt_text:
            return None

        image_model_key = self._image_config.get("api_key", "")
        neg_prompt = "低画质、变形肢体、模糊、水印"

        reference_images = reference_images or []

        # Try primary (Doubao Seedream)
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
                    "model": os.getenv("DOUBAO_IMAGE_MODEL", "doubao-seedream-5-0-lite-260128"),
                    "prompt": prompt_text,
                    "size": "1920x1920",
                    "response_format": "url",
                    "watermark": False,
                    "sequential_image_generation": "disabled",
                }

                # Seedream 5.0 Lite accepts one or more image inputs through
                # the official `image` array. The annotated frame itself is the
                # spatial signal for local editing.
                if reference_images:
                    payload["image"] = [
                        img if img.startswith("data:") else f"data:image/png;base64,{img}"
                        for img in reference_images[:10]
                    ]
                    logger.info(
                        "[ImageGenerator] Using Seedream image inputs: %s",
                        len(payload["image"]),
                    )

                sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..",
                                                 "backend", "agent_service"))
                from chat_client import post_json_with_retries

                async with httpx.AsyncClient(
                    timeout=httpx.Timeout(90.0, connect=30.0)
                ) as client:
                    resp = await post_json_with_retries(
                        client,
                        url,
                        headers=headers,
                        payload=payload,
                        provider="Seedream",
                    )
                    data = resp.json()
                    images = data.get("data", [])
                    if images:
                        return images[0].get("url")
            except Exception as e:
                logger.warning(f"[ImageGenerator] Primary failed: {e}")

        # Try fallbacks (DALL-E also supports image-to-image via image_fidelity)
        return await self._try_fallbacks(prompt_text, neg_prompt, reference_images)

    def _select_generation_references(self, ctx: SharedContext) -> list[str]:
        """Return reference images only when they should drive generation."""
        if not ctx.reference_images:
            return []

        if ctx.metadata.get("_force_image_agent"):
            return ctx.reference_images

        ref_intent = ctx.metadata.get("_ref_images_intent", "")
        if ref_intent in {"style_transfer", "composition_only"}:
            return ctx.reference_images
        if ref_intent == "ignore":
            return []

        user_message = (ctx.user_message or "").lower()
        modification_keywords = [
            "修改", "改", "换成", "替换", "去掉", "删除", "加上", "添加",
            "modify", "change", "replace", "remove", "add", "edit", "update",
            "变成", "改为", "调整", "换一个",
        ]
        if any(kw in user_message for kw in modification_keywords):
            return ctx.reference_images

        return []

    async def _try_fallbacks(
        self, prompt: str, neg_prompt: str, reference_images: list[str] | None = None
    ) -> str | None:
        """Try DALL-E then Anthropic SVG fallback chain."""
        import sys
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..",
                                         "backend", "agent_service"))
        from chat_client import (
            get_image_fallback_configs,
            call_openai_image_api,
            call_anthropic_svg_generator,
        )
        from config import map_ratio_for_openai_image

        for fb_config in get_image_fallback_configs():
            if not fb_config.get("api_key"):
                continue
            try:
                protocol = fb_config["protocol"].lower().strip()
                if protocol == "openai":
                    # DALL-E 3 doesn't natively support init_image, but we pass
                    # it through the fallback function which handles it if supported
                    return await call_openai_image_api(
                        prompt,
                        map_ratio_for_openai_image("1:1"),
                        neg_prompt,
                        fb_config,
                    )
                elif protocol == "anthropic":
                    return await call_anthropic_svg_generator(
                        prompt, neg_prompt, fb_config
                    )
            except Exception as e:
                logger.warning(f"[ImageGenerator] Fallback failed: {e}")

        return None
