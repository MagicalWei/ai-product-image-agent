"""
Multi-Agent — Competitor Analyst

Analyzes visual strategies of top products in the same category.
Produces a competitor report written to SharedContext.
"""

from __future__ import annotations

import logging

from agent.multi_agent.base import BaseAgent
from agent.multi_agent.shared_context import AgentRole, AgentMessage, SharedContext

logger = logging.getLogger(__name__)

COMPETITOR_ANALYST_SYSTEM_PROMPT = (
    "你是电商竞品分析专家。根据产品品类和目标平台，分析该品类 top 商品主图的视觉策略。\n\n"
    "分析维度：\n"
    "1. styles: 常见视觉风格列表（如\"白底产品图\"、\"场景种草图\"、\"科技感蓝黑\"等）\n"
    "2. common_layouts: 常用构图方式（如\"产品居中+文字左上角\"、\"对角线构图\"等）\n"
    "3. color_trends: 色调趋势（如\"高饱和度暖色\"、\"低饱和度冷淡风\"等）\n"
    "4. differentiation_opportunities: 差异化机会（该品类中尚未被充分利用的视觉策略）\n"
    "5. best_practices: 该品类最佳实践建议\n\n"
    "输出 JSON 格式，不要 markdown 包裹。基于你的电商行业知识进行分析。\n"
)

COMPETITOR_OUTPUT_SCHEMA = {
    "styles": ["style1", "style2"],
    "common_layouts": ["layout1", "layout2"],
    "color_trends": ["trend1", "trend2"],
    "differentiation_opportunities": ["opportunity1"],
    "best_practices": ["practice1"],
}


class CompetitorAnalystAgent(BaseAgent):
    """Analyzes competitor visual strategies for the product category."""

    role = AgentRole.COMPETITOR_ANALYST

    def __init__(self, chat_config: dict[str, str], multimodal_config: dict[str, str] | None = None):
        super().__init__(chat_config)
        self._multimodal_config = multimodal_config or {}

    async def execute(self, ctx: SharedContext) -> AgentMessage:
        brief = ctx.design_brief
        if not brief:
            return self._build_agent_message(
                action="analyze_competitors",
                content="跳过竞品分析：缺少产品信息",
                success=False,
                error="No design brief available",
            )

        product = brief.subject or "该产品"
        platform = brief.platform or "主流电商平台"
        target_country = brief.target_country or "全球"

        logger.info(f"[CompetitorAnalyst] Analyzing competitors for '{product}' on {platform}")

        user_content = (
            f"产品品类：{product}\n"
            f"目标平台：{platform}\n"
            f"目标国家：{target_country}\n"
            f"风格偏好：{brief.style_hint or '未指定'}\n\n"
            f"请分析该品类在{platform}上的 top 商品主图视觉策略。"
        )

        try:
            # Use multimodal config if available, otherwise fall back to chat config
            result = await self.think_structured(
                system_prompt=COMPETITOR_ANALYST_SYSTEM_PROMPT,
                user_content=user_content,
                output_schema=COMPETITOR_OUTPUT_SCHEMA,
                config_override=self._multimodal_config if self._multimodal_config.get("api_key") else None,
            )

            ctx.competitor_report = result

            return self._build_agent_message(
                action="analyze_competitors",
                content=f"竞品分析完成：发现 {len(result.get('styles', []))} 种风格、"
                        f"{len(result.get('differentiation_opportunities', []))} 个差异化机会",
                data=result,
            )

        except Exception as e:
            logger.error(f"[CompetitorAnalyst] Failed: {e}")
            ctx.competitor_report = {
                "styles": [],
                "common_layouts": [],
                "color_trends": [],
                "differentiation_opportunities": [],
                "best_practices": [],
                "error": str(e),
            }
            return self._build_agent_message(
                action="analyze_competitors",
                content="竞品分析跳过（LLM 调用失败）",
                data=ctx.competitor_report,
                success=False,
                error=str(e),
            )