"""Reverse-engineer an evidence-grounded generation prompt from an image."""

from __future__ import annotations

import json
import os
import sys
from typing import Any

from agent.models import ActionParams, ActionResult, CanvasState


def _clean_json(value: str) -> dict[str, Any]:
    text = str(value or "").strip().replace("```json", "").replace("```", "")
    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        text = text[start:end + 1]
    return json.loads(text)


def _normalize(raw: dict[str, Any]) -> dict[str, Any]:
    def string_list(key: str, limit: int, item_limit: int) -> list[str]:
        value = raw.get(key)
        if not isinstance(value, list):
            return []
        return [str(item).strip()[:item_limit] for item in value[:limit] if str(item).strip()]

    allowed_ratios = {"1:1", "3:4", "4:5", "9:16", "16:9"}
    ratio = str(raw.get("recommended_ratio") or "1:1")
    return {
        "subject": str(raw.get("subject") or "").strip()[:240],
        "composition": str(raw.get("composition") or "").strip()[:500],
        "camera": str(raw.get("camera") or "").strip()[:300],
        "lighting": str(raw.get("lighting") or "").strip()[:300],
        "color_palette": string_list("color_palette", 8, 60),
        "background": str(raw.get("background") or "").strip()[:400],
        "typography": str(raw.get("typography") or "").strip()[:300],
        "prompt_cn": str(raw.get("prompt_cn") or "").strip()[:3000],
        "prompt_en": str(raw.get("prompt_en") or "").strip()[:3000],
        "negative_prompt": str(raw.get("negative_prompt") or "").strip()[:1000],
        "recommended_ratio": ratio if ratio in allowed_ratios else "1:1",
        "visible_evidence": string_list("visible_evidence", 10, 240),
        "uncertain_elements": string_list("uncertain_elements", 10, 240),
    }


async def reverse_image_prompt_fn(params: ActionParams, canvas: CanvasState) -> ActionResult:
    extra = params.model_extra or {}
    image = str(extra.get("image_base64") or extra.get("product_image") or extra.get("image") or "")
    config = extra.get("multimodal_config") or {}
    composition_preference = str(extra.get("composition_preference") or "auto")[:80]
    if not image.startswith("data:image/"):
        return ActionResult(success=False, error="请上传有效的图片")
    if not all(str(config.get(key) or "").strip() for key in ("api_key", "base_url", "model")):
        return ActionResult(success=False, error="未配置可用的多模态模型")

    service_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "backend", "agent_service"))
    if service_dir not in sys.path:
        sys.path.insert(0, service_dir)
    from chat_client import execute_chat_with_fallbacks

    messages = [
        {
            "role": "system",
            "content": (
                "你是商业视觉提示词分析 Agent。只根据图片可见证据反推构图、镜头、光线、色彩、背景和排版。"
                "不得猜测品牌、型号、材质参数或不可见功能。输出可用于新图生成的原创提示词，不照抄图片文字。只输出 JSON。"
            ),
        },
        {
            "role": "user",
            "content": [
                {"type": "text", "text": (
                    f"构图偏好：{composition_preference}。分析图片并返回严格 JSON："
                    '{"subject":"","composition":"","camera":"","lighting":"","color_palette":[""],'
                    '"background":"","typography":"","prompt_cn":"","prompt_en":"",'
                    '"negative_prompt":"","recommended_ratio":"1:1|3:4|4:5|9:16|16:9",'
                    '"visible_evidence":[""],"uncertain_elements":[""]}'
                )},
                {"type": "image_url", "image_url": {"url": image, "detail": "high"}},
            ],
        },
    ]
    try:
        response = await execute_chat_with_fallbacks(messages, {
            "protocol": "openai",
            "api_key": config["api_key"],
            "base_url": config["base_url"],
            "model": config["model"],
            "supports_vision": True,
            "max_tokens": 2400,
            "timeout_seconds": 90,
        }, [])
        result = _normalize(_clean_json(response))
        if not result["prompt_cn"] and not result["prompt_en"]:
            return ActionResult(success=False, error="多模态模型没有返回有效提示词")
        return ActionResult(success=True, data={"reverse_prompt": result})
    except Exception as error:
        return ActionResult(success=False, error=f"图片提示词反推失败：{type(error).__name__}")
