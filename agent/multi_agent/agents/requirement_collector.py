"""
Multi-Agent — Requirement Collector

Extracts structured design requirements from raw user input.
Produces a DesignBrief written to SharedContext.
"""

from __future__ import annotations

import logging

from agent.multi_agent.base import BaseAgent
from agent.multi_agent.shared_context import AgentRole, AgentMessage, SharedContext
from agent.models import DesignBrief

logger = logging.getLogger(__name__)

REQUIREMENT_COLLECTOR_SYSTEM_PROMPT = (
    "你是电商商品图设计需求分析师。从用户输入和对话记忆中提取以下信息，输出 JSON。\n\n"
    "提取字段：\n"
    "- subject: 产品名称（如\"无线蓝牙耳机\"）\n"
    "- use_case: 使用场景（如\"亚马逊主图\"、\"淘宝详情页\"）\n"
    "- style_hint: 风格偏好（如\"极简白底\"、\"科技感\"、\"温馨场景\"）\n"
    "- platform: 目标电商平台（如\"amazon\"、\"taobao\"、\"shopify\"）\n"
    "- target_country: 目标国家（如\"US\"、\"JP\"、\"CN\"）\n"
    "- aspect_ratio: 图片比例（默认\"1:1\"）\n"
    "- image_types: 需要的图片类型列表（如[\"main\", \"scene_selling\"]）\n"
    "- selling_points: 核心卖点（用逗号分隔）\n"
    "- color_palette: 色系偏好（如[\"白色\", \"蓝色\"]）\n\n"
    "规则：\n"
    "1. 如果用户没有明确提到某个字段，留空字符串或空列表，不要编造。\n"
    "2. 从用户消息中尽可能多地提取信息。\n"
    "3. 只输出 JSON，不要任何解释文字。\n"
)

REQUIREMENT_OUTPUT_SCHEMA = {
    "subject": "",
    "use_case": "",
    "style_hint": "",
    "platform": "",
    "target_country": "",
    "aspect_ratio": "1:1",
    "image_types": [],
    "selling_points": "",
    "color_palette": [],
}


class RequirementCollectorAgent(BaseAgent):
    """Extracts structured DesignBrief from user input."""

    role = AgentRole.REQUIREMENT_COLLECTOR

    async def execute(self, ctx: SharedContext) -> AgentMessage:
        logger.info("[RequirementCollector] Extracting design requirements...")

        # If design_brief is already populated (from memory), skip extraction
        if ctx.design_brief and ctx.design_brief.subject:
            logger.info("[RequirementCollector] Using pre-populated design brief from memory")
            return self._build_agent_message(
                action="collect_requirements",
                content=f"使用已有设计需求：产品={ctx.design_brief.subject}，"
                        f"平台={ctx.design_brief.platform or '未指定'}，"
                        f"风格={ctx.design_brief.style_hint or '未指定'}",
                data={"design_brief": ctx.design_brief.model_dump()},
            )

        user_text = ctx.user_message

        try:
            result = await self.think_structured(
                system_prompt=REQUIREMENT_COLLECTOR_SYSTEM_PROMPT,
                user_content=f"用户输入：\n{user_text}",
                output_schema=REQUIREMENT_OUTPUT_SCHEMA,
            )

            brief = DesignBrief(
                subject=result.get("subject", ""),
                use_case=result.get("use_case", ""),
                style_hint=result.get("style_hint", ""),
                platform=result.get("platform", ""),
                target_country=result.get("target_country", ""),
                aspect_ratio=result.get("aspect_ratio", "1:1"),
                image_types=result.get("image_types", []),
                selling_points=result.get("selling_points", ""),
                color_palette=result.get("color_palette", []),
                raw_message=user_text,
            )

            ctx.design_brief = brief

            return self._build_agent_message(
                action="collect_requirements",
                content=f"已提取设计需求：产品={brief.subject}，平台={brief.platform or '未指定'}，"
                        f"风格={brief.style_hint or '未指定'}，图片类型={brief.image_types or '未指定'}",
                data={"design_brief": brief.model_dump()},
            )

        except Exception as e:
            logger.error(f"[RequirementCollector] Failed: {e}")
            # Fallback: build minimal brief from raw message
            fallback_brief = DesignBrief(
                subject=user_text[:100],
                raw_message=user_text,
            )
            ctx.design_brief = fallback_brief
            return self._build_agent_message(
                action="collect_requirements",
                content=f"需求提取部分成功（fallback）：产品={fallback_brief.subject}",
                data={"design_brief": fallback_brief.model_dump()},
                success=False,
                error=str(e),
            )