"""
Retry Logic

Structured retry decision based on review results. Outputs diagnostic
info so the next attempt can be targeted — never "regenerate everything".
"""

from __future__ import annotations

from agent.models import ReviewResult, RetryDecision

MAX_RETRIES = 2


async def decide_retry(
    review: ReviewResult,
    retry_count: int,
) -> RetryDecision:
    """Decide whether to retry based on review results and retry count.

    Outputs a structured diagnostic so the next attempt is targeted:
    - "color_mismatch" → adjust color palette
    - "composition_issue" → adjust layout
    - "clarity_issue" → adjust prompt for more detail
    - "prompt_mismatch" → rewrite prompt

    Args:
        review: The review result to base the decision on.
        retry_count: How many retries have already been attempted.

    Returns:
        RetryDecision with should_retry and diagnostic info.
    """
    if review.passed:
        return RetryDecision(should_retry=False, reason="Review passed")

    if retry_count >= MAX_RETRIES:
        return RetryDecision(
            should_retry=False,
            reason=f"Max retries ({MAX_RETRIES}) reached",
            diagnostic={"retry_count": retry_count, "final_score": review.overall_score},
        )

    # Analyze issues to determine the diagnostic category
    diagnostic = _analyze_issues(review)

    return RetryDecision(
        should_retry=True,
        reason=f"Retry {retry_count + 1}/{MAX_RETRIES}: {', '.join(diagnostic.get('categories', ['unspecified']))}",
        diagnostic=diagnostic,
        adjusted_params=diagnostic.get("adjustments", {}),
    )


def _analyze_issues(review: ReviewResult) -> dict:
    """Analyze review issues to categorize the problem and suggest adjustments."""
    issues_text = " ".join(review.issues).lower()
    suggestions_text = " ".join(review.suggestions).lower()

    categories = []
    adjustments = {}

    # Color-related issues
    color_keywords = ["color", "tone", "色调", "配色", "颜色", "palette", "warm", "cool"]
    if any(kw in issues_text for kw in color_keywords):
        categories.append("color_mismatch")
        adjustments["refine_color"] = True

    # Lighting issues
    light_keywords = ["light", "dark", "bright", "shadow", "光线", "亮度", "阴影", "曝光"]
    if any(kw in issues_text for kw in light_keywords):
        categories.append("lighting_issue")
        adjustments["adjust_lighting"] = True

    # Composition/layout issues
    comp_keywords = ["composition", "layout", "构图", "布局", "crop", "裁切", "position"]
    if any(kw in issues_text for kw in comp_keywords):
        categories.append("composition_issue")
        adjustments["adjust_layout"] = True

    # Clarity/sharpness
    clarity_keywords = ["blur", "模糊", "清晰", "sharp", "resolution", "分辨率"]
    if any(kw in issues_text for kw in clarity_keywords):
        categories.append("clarity_issue")
        adjustments["increase_detail"] = True

    # Background issues
    bg_keywords = ["background", "背景", "white", "白底"]
    if any(kw in issues_text for kw in bg_keywords):
        categories.append("background_issue")
        adjustments["refine_background"] = True

    # Prompt adherence
    if review.overall_score < 70 and not categories:
        categories.append("prompt_mismatch")
        adjustments["rewrite_prompt"] = True

    if not categories:
        categories.append("general_quality")
        adjustments["refine_all"] = True

    return {
        "categories": categories,
        "overall_score": review.overall_score,
        "key_issues": review.issues[:3],
        "key_suggestions": review.suggestions[:3],
        "adjustments": adjustments,
    }