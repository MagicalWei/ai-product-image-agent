"""Deterministic extraction for short requirement replies."""

from __future__ import annotations

from typing import Any


_STYLE_KEYWORDS = (
    "自然场景", "简约白底", "高端商务", "可爱活泼", "科技感", "极简", "复古", "奢华",
)

_IMAGE_TYPE_KEYWORDS = (
    ("卖点图", "selling_point"),
    ("主图", "main"),
    ("场景图", "scene"),
    ("细节图", "detail"),
    ("白底图", "white_background"),
    ("尺寸图", "size"),
    ("对比图", "comparison"),
)


def apply_requirement_reply(message: str, memory: Any) -> None:
    """Update structured memory from explicit Chinese requirement keywords."""
    text = (message or "").strip()
    if not text or memory is None:
        return

    for style in _STYLE_KEYWORDS:
        if style in text:
            memory.style_preference = style
            break

    requested_types = [value for keyword, value in _IMAGE_TYPE_KEYWORDS if keyword in text]
    if requested_types:
        existing = list(getattr(memory, "image_types", []) or [])
        memory.image_types = list(dict.fromkeys([*existing, *requested_types]))

