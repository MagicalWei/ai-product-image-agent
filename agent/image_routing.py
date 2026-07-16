"""Transient routing signals for image-attached chat turns."""

from __future__ import annotations

DIRECT_IMAGE_AGENT_MARKER = "[[DIRECT_IMAGE_AGENT]]"
DIRECT_IMAGE_AGENT_REGION_MARKER = "[[DIRECT_IMAGE_AGENT_REGION]]"


def parse_direct_image_request(message: str) -> tuple[bool, bool, str]:
    """Return (is_direct, is_region_edit, user_prompt) and remove control tags."""
    raw = message or ""
    is_region_edit = DIRECT_IMAGE_AGENT_REGION_MARKER in raw
    is_direct = is_region_edit or DIRECT_IMAGE_AGENT_MARKER in raw
    clean_prompt = raw.replace(DIRECT_IMAGE_AGENT_REGION_MARKER, "").replace(
        DIRECT_IMAGE_AGENT_MARKER, ""
    ).strip()
    return is_direct, is_region_edit, clean_prompt


def build_seedream_edit_prompt(user_prompt: str, *, region_edit: bool) -> str:
    """Add only the invariants needed for reliable Seedream image editing."""
    prompt = (user_prompt or "").strip()
    if not region_edit:
        return prompt
    return (
        "这是一张带有彩色矩形线框的图片编辑任务。"
        "只修改矩形框内的区域，框外的产品、构图、光影和背景保持不变。"
        "最终图片中移除彩色矩形框和透明色块。\n"
        f"用户修改要求：{prompt}"
    )
