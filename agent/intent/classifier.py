"""
Input Classifier

Classifies user input into intent categories using lightweight rules
(optionally a cheap LLM call). Does not consume the main model's budget.
"""

from __future__ import annotations

from typing import Any

from agent.models import IntentType


# Keywords for rule-based classification
_NEW_DESIGN_KEYWORDS = [
    "生成", "做", "创建", "画", "设计", "制作", "来一张", "来一个",
    "generate", "create", "make", "design", "produce",
    "主图", "图标", "卖点图", "场景图", "对比图", "结构图",
    "白底图", "头图", "详情图", "banner",
]

_EDIT_KEYWORDS = [
    "改", "换", "修", "调整", "替换", "修改", "换成", "改成",
    "去掉", "删除", "移除", "加", "添加", "增加",
    "背景换成", "颜色换成", "变大", "变小", "移动",
    "change", "replace", "edit", "modify", "remove", "add",
    "background", "color", "resize",
]

_UPLOAD_KEYWORDS = [
    "上传", "参考图", "参考图片", "这张图", "这个图片",
    "upload", "reference",
]


def classify_input(
    message: str,
    has_image: bool = False,
) -> IntentType:
    """Classify user input into an intent category.

    Uses rule-based keyword matching for speed. Can be upgraded to a
    lightweight LLM call if accuracy needs improvement.

    Args:
        message: The user's raw text message.
        has_image: Whether the user attached an image.

    Returns:
        The classified IntentType.
    """
    msg_lower = message.lower().strip()

    # Empty or very short message
    if not msg_lower or len(msg_lower) < 2:
        return IntentType.CHITCHAT

    # Image upload takes priority
    if has_image:
        # Check if it's a reference upload with design intent
        for kw in _NEW_DESIGN_KEYWORDS + _EDIT_KEYWORDS:
            if kw in msg_lower:
                return IntentType.UPLOAD_REFERENCE
        return IntentType.UPLOAD_REFERENCE

    # Check for edit intent first (more specific patterns)
    edit_score = sum(1 for kw in _EDIT_KEYWORDS if kw in msg_lower)
    if edit_score >= 1:
        return IntentType.EDIT_LAYER

    # Check for new design intent
    design_score = sum(1 for kw in _NEW_DESIGN_KEYWORDS if kw in msg_lower)
    if design_score >= 1:
        return IntentType.NEW_DESIGN

    # Check for clarification responses (short answers to questions)
    clarification_patterns = ["是", "否", "对", "不对", "可以", "好的", "行", "ok", "yes", "no", "能"]
    if any(msg_lower == p or msg_lower.startswith(p) for p in clarification_patterns):
        return IntentType.CLARIFICATION

    # Default to chitchat
    return IntentType.CHITCHAT