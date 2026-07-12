"""
Clarifier

Checks whether the design brief is complete enough to proceed,
and generates clarification questions if not.
"""

from __future__ import annotations

from agent.models import DesignBrief

_REQUIRED_FIELDS = ["subject", "use_case", "style_hint"]


def needs_clarification(brief: DesignBrief) -> bool:
    """Check if the design brief has enough information to proceed.

    Returns True if we need to ask the user more questions.
    """
    for field in _REQUIRED_FIELDS:
        if not getattr(brief, field, None):
            return True
    return False


def generate_clarification_questions(brief: DesignBrief) -> list[str]:
    """Generate targeted clarification questions based on missing fields.

    Does NOT use LLM — this is a rule-based function to keep latency low.
    The questions are returned to the frontend for the user to answer.
    """
    questions: list[str] = []

    if not brief.subject:
        questions.append("你想做什么产品的电商图呢？比如保温杯、耳机、手机壳...")
    if not brief.style_hint:
        questions.append("你偏好什么风格？比如简约白底、高端商务、自然场景、可爱活泼...")
    if not brief.use_case and not brief.platform:
        questions.append("图片用在哪个电商平台？淘宝、Amazon、Shopify还是其他？")

    # Additional helpful questions
    if brief.subject and not brief.selling_points:
        questions.append("这个产品有什么核心卖点需要突出吗？")

    if brief.subject and not brief.image_types:
        questions.append("需要什么类型的图片？主图、场景图、卖点图还是其他？")

    return questions


def calculate_completeness(brief: DesignBrief) -> float:
    """Calculate how complete the design brief is (0.0 to 1.0)."""
    fields = [
        bool(brief.subject),
        bool(brief.use_case or brief.platform),
        bool(brief.style_hint),
        bool(brief.selling_points),
        bool(brief.image_types),
        bool(brief.aspect_ratio and brief.aspect_ratio != "1:1"),  # non-default
    ]
    return sum(fields) / len(fields)