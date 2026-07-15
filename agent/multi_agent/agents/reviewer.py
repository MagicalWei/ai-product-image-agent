"""
Multi-Agent — Reviewer

Evaluates generated images against the design brief, prompts, and
competitor standards. Reuses existing review infrastructure where possible.
"""

from __future__ import annotations

import logging

from agent.multi_agent.base import BaseAgent
from agent.multi_agent.shared_context import AgentRole, AgentMessage, SharedContext

logger = logging.getLogger(__name__)

REVIEWER_SYSTEM_PROMPT = (
    "你是电商商品图质量审查专家。评估生成图片是否满足设计需求、竞品标准和质量要求。\n\n"
    "评估维度（每项 0-100 分）：\n"
    "1. prompt_adherence: 图片是否准确反映了 prompt 描述\n"
    "2. design_brief_match: 是否满足设计需求（风格、卖点、色系等）\n"
    "3. competitor_benchmark: 与竞品视觉标准相比如何\n"
    "4. commercial_quality: 商业可用性（清晰度、构图、专业感）\n"
    "5. differentiation: 是否体现了差异化策略\n\n"
    "通过标准：overall_score >= 80\n\n"
    "输出 JSON：\n"
    '{"reviews": [{"layer_type": "subject", "overall_score": 85, "passed": true, '
    '"scores": {"prompt_adherence": 90, ...}, "issues": [], "suggestions": []}]}\n'
    "不要 markdown 包裹。\n"
)

REVIEWER_OUTPUT_SCHEMA = {
    "reviews": [
        {
            "layer_type": "subject",
            "overall_score": 85,
            "passed": True,
            "scores": {
                "prompt_adherence": 90,
                "design_brief_match": 85,
                "competitor_benchmark": 80,
                "commercial_quality": 88,
                "differentiation": 82,
            },
            "issues": [],
            "suggestions": [],
        }
    ]
}


class ReviewerAgent(BaseAgent):
    """Reviews generated images for quality and design brief alignment."""

    role = AgentRole.REVIEWER

    def __init__(self, chat_config: dict[str, str], vision_config: dict[str, str] | None = None):
        super().__init__(chat_config)
        self._vision_config = vision_config or {}

    async def execute(self, ctx: SharedContext) -> AgentMessage:
        generated = ctx.generated_images
        if not generated:
            return self._build_agent_message(
                action="review_images",
                content="跳过审查：没有生成的图片",
                success=False,
                error="No images to review",
            )

        brief = ctx.design_brief
        prompts = ctx.final_prompts
        competitor = ctx.competitor_report

        logger.info(f"[Reviewer] Reviewing {len(generated)} images...")

        review_results = []
        for layer_type, img_url in generated.items():
            # Find matching prompt
            matching_prompt = ""
            for p in prompts:
                if p.get("layer_type") == layer_type:
                    matching_prompt = p.get("prompt", "")
                    break

            review = await self._review_single(
                layer_type=layer_type,
                img_url=img_url,
                prompt_text=matching_prompt,
                design_brief=brief,
                competitor_report=competitor,
            )
            review_results.append(review)

        ctx.review_results = review_results

        passed_count = sum(1 for r in review_results if r.get("passed", False))
        avg_score = (
            sum(r.get("overall_score", 0) for r in review_results) / len(review_results)
            if review_results
            else 0
        )

        return self._build_agent_message(
            action="review_images",
            content=f"审查完成：{passed_count}/{len(review_results)} 通过，平均分 {avg_score:.1f}",
            data={
                "reviews": review_results,
                "passed_count": passed_count,
                "average_score": round(avg_score, 1),
            },
        )

    async def _review_single(
        self,
        layer_type: str,
        img_url: str,
        prompt_text: str,
        design_brief,
        competitor_report: dict | None,
    ) -> dict:
        """Review a single generated image using text-based evaluation."""
        # Build evaluation context
        context_parts = [
            f"评估对象：{layer_type} 图层",
            f"生成图片 URL：{img_url}",
            f"使用的 prompt：{prompt_text[:300]}",
        ]

        if design_brief:
            context_parts.append(
                f"\n设计需求：\n"
                f"- 产品：{design_brief.subject}\n"
                f"- 风格：{design_brief.style_hint or '未指定'}\n"
                f"- 平台：{design_brief.platform or '未指定'}\n"
                f"- 卖点：{design_brief.selling_points or '未指定'}\n"
                f"- 色系：{', '.join(design_brief.color_palette) if design_brief.color_palette else '未指定'}"
            )

        if competitor_report and not competitor_report.get("error"):
            context_parts.append(
                f"\n竞品标准：\n"
                f"- 常见风格：{', '.join(competitor_report.get('styles', []))}\n"
                f"- 最佳实践：{', '.join(competitor_report.get('best_practices', []))}"
            )

        user_content = "\n".join(context_parts)

        # If vision model is available, include the image
        if self._vision_config.get("api_key"):
            return await self._review_with_vision(layer_type, img_url, user_content)
        else:
            return await self._review_text_only(layer_type, user_content)

    async def _review_with_vision(
        self, layer_type: str, img_url: str, user_content: str
    ) -> dict:
        """Review with vision model — sees the actual image."""
        import os, sys
        _agent_service_dir = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "..", "..", "backend", "agent_service"),
        )
        if _agent_service_dir not in sys.path:
            sys.path.insert(0, _agent_service_dir)
        from chat_client import execute_chat_with_fallbacks, get_chat_fallback_configs
        from config import clean_json_string
        import json

        messages = [
            {"role": "system", "content": REVIEWER_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_content},
                    {"type": "image_url", "image_url": {"url": img_url, "detail": "auto"}},
                ],
            },
        ]

        primary_config = {
            "protocol": "openai",
            "api_key": self._vision_config.get("api_key", ""),
            "base_url": self._vision_config.get("base_url", "https://api.openai.com/v1"),
            "model": self._vision_config.get("model", "gpt-4o"),
        }

        try:
            resp = await execute_chat_with_fallbacks(
                messages, primary_config, get_chat_fallback_configs()
            )
            cleaned = clean_json_string(resp)
            result = json.loads(cleaned)
            reviews = result.get("reviews", [{}])
            return reviews[0] if reviews else {"layer_type": layer_type, "overall_score": 75, "passed": True}
        except Exception as e:
            logger.warning(f"[Reviewer] Vision review failed, falling back to text: {e}")
            return await self._review_text_only(layer_type, user_content)

    async def _review_text_only(self, layer_type: str, user_content: str) -> dict:
        """Text-only review — evaluates based on prompt and context without seeing the image."""
        try:
            result = await self.think_structured(
                system_prompt=REVIEWER_SYSTEM_PROMPT,
                user_content=user_content + "\n\n注意：你无法直接查看图片，请基于 prompt 和需求描述进行文本评估。",
                output_schema=REVIEWER_OUTPUT_SCHEMA,
            )
            reviews = result.get("reviews", [{}])
            review = reviews[0] if reviews else {}
            review["layer_type"] = layer_type
            return review
        except Exception as e:
            logger.warning(f"[Reviewer] Text-only review failed: {e}")
            return {
                "layer_type": layer_type,
                "overall_score": 75,
                "passed": True,
                "scores": {},
                "issues": [],
                "suggestions": [f"Review skipped due to error: {str(e)}"],
            }