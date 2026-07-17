"""Transient routing signals for image-attached chat turns."""

from __future__ import annotations

import re

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
    # The composer may prepend an internal explanation before the actual user
    # text. That routing metadata must never leak into SENSE/DECIDE prompts.
    if "[用户指令]" in clean_prompt:
        clean_prompt = clean_prompt.split("[用户指令]", 1)[1].strip()
    return is_direct, is_region_edit, clean_prompt


def is_attachment_receipt_question(message: str) -> bool:
    """Return whether the user is only asking if attached images arrived."""
    compact = re.sub(r"\s+", "", message or "").lower()
    if not compact:
        return False
    asks_about_image = any(word in compact for word in ("图片", "图像", "附件", "框选图", "参考图"))
    asks_receipt = any(
        phrase in compact
        for phrase in ("看到了吗", "看到吗", "收到吗", "收到了吗", "有没有收到", "能看到吗")
    )
    asks_receipt = asks_receipt or (
        any(verb in compact for verb in ("看到", "收到", "看见"))
        and compact.rstrip("？?").endswith(("吗", "没"))
    )
    return asks_about_image and asks_receipt


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
