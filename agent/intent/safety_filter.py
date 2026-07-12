"""
Safety Filter

Pre-screening for harmful or policy-violating content.
Must intercept BEFORE any image generation.
"""

from __future__ import annotations

from agent.models import SafetyResult

# Basic blocklist for demo purposes. In production, use a proper
# content moderation API or model.
_BLOCKED_TERMS = [
    # Copyright characters
    "mickey mouse", "米老鼠", "mickey", "minnie mouse", "米妮",
    "pikachu", "皮卡丘", "pokemon", "宝可梦",
    "mario", "马里奥", "super mario",
    "spider-man", "蜘蛛侠", "spiderman",
    "hello kitty", "凯蒂猫",
    "peppa pig", "小猪佩奇",
    # Celebrities / real persons
    "taylor swift", "elon musk", "trump",
    # Explicitly harmful
    "nude", "naked", "porn", "裸体",
]


async def safety_check(
    message: str,
    images: list[str] | None = None,
) -> SafetyResult:
    """Check input message and optional images for policy violations.

    Args:
        message: User's text message.
        images: List of image URLs/base64 strings (optional).

    Returns:
        SafetyResult with passed=True if content is safe.
    """
    msg_lower = message.lower()

    flags: list[str] = []

    # Check text against blocked terms
    for term in _BLOCKED_TERMS:
        if term in msg_lower:
            flags.append(f"blocked_term:{term}")

    # Check for real person portrait requests
    portrait_keywords = ["真人", "明星", "名人", "celebrity", "real person", "真实人物"]
    for kw in portrait_keywords:
        if kw in msg_lower:
            flags.append(f"portrait_request:{kw}")

    # Image safety check (placeholder — integrate with actual scanner)
    if images:
        # TODO: Run images through a content safety scanner
        pass

    if flags:
        return SafetyResult(
            passed=False,
            blocked_reason=f"Content policy violation: {'; '.join(flags)}",
            flags=flags,
        )

    return SafetyResult(passed=True)