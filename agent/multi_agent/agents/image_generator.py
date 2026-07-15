"""
Multi-Agent — Image Generator

Calls image generation APIs to produce candidate images for each prompt.
Does NOT call LLM — uses the existing Doubao Seedream → DALL-E fallback chain.
"""

from __future__ import annotations

import asyncio
import logging
import os

import httpx

from agent.multi_agent.base import BaseAgent
from agent.multi_agent.shared_context import AgentRole, AgentMessage, SharedContext

logger = logging.getLogger(__name__)


class ImageGeneratorAgent(BaseAgent):
    """Generates images for each prompt using the image generation API chain.

    This agent does NOT use the LLM (think/think_structured). It directly
    calls image generation APIs via the existing fallback chain.
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

        logger.info(f"[ImageGenerator] Generating {len(prompts)} images...")

        # Generate all images in parallel
        tasks = [self._generate_single(p) for p in prompts]
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

    async def _generate_single(self, prompt_entry: dict) -> str | None:
        """Generate a single image, trying primary then fallbacks."""
        prompt_text = prompt_entry.get("prompt", "")
        if not prompt_text:
            return None

        image_model_key = self._image_config.get("api_key", "")
        neg_prompt = "低画质、变形肢体、模糊、水印"

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
                    "model": os.getenv("DOUBAO_IMAGE_MODEL", "doubao-seedream-5-0-260128"),
                    "prompt": prompt_text,
                    "size": "1920x1920",
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
                            return images[0].get("url")
            except Exception as e:
                logger.warning(f"[ImageGenerator] Primary failed: {e}")

        # Try fallbacks
        return await self._try_fallbacks(prompt_text, neg_prompt)

    async def _try_fallbacks(self, prompt: str, neg_prompt: str) -> str | None:
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