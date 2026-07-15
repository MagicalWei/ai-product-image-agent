"""
Multi-Agent — Prompt Writer

Compiles design brief, competitor insights, and RAG context into
high-quality English image generation prompts.
"""

from __future__ import annotations

import logging

from agent.multi_agent.base import BaseAgent
from agent.multi_agent.shared_context import AgentRole, AgentMessage, SharedContext

logger = logging.getLogger(__name__)

PROMPT_WRITER_SYSTEM_PROMPT = (
    "你是 AI 图像生成 Prompt 工程师。根据设计需求、竞品分析和知识库参考，"
    "为每个图层类型编写高质量英文 prompt（80-150词）。\n\n"
    "编写规则：\n"
    "1. 使用英文撰写（图像模型对英文 prompt 响应更好）。\n"
    "2. 包含：主体描述、材质/质感、光照、构图、色调、风格标签。\n"
    "3. 如果提供了竞品分析，融入差异化策略，避免与竞品同质化。\n"
    "4. 如果提供了 RAG 知识库参考，优先使用其中的 prompt 模板和风格指南。\n"
    "5. 为每个图层类型（subject, background, text, decoration）分别编写 prompt。\n\n"
    "输出 JSON 格式：\n"
    '{"prompts": [{"layer_type": "subject", "prompt": "English prompt...", "style_tags": ["tag1", "tag2"]}, ...]}\n'
    "不要 markdown 包裹。\n"
)

PROMPT_WRITER_OUTPUT_SCHEMA = {
    "prompts": [
        {
            "layer_type": "subject",
            "prompt": "A detailed English prompt...",
            "style_tags": ["minimalist", "studio-lighting"],
        }
    ]
}


class PromptWriterAgent(BaseAgent):
    """Compiles all context into high-quality image generation prompts."""

    role = AgentRole.PROMPT_WRITER

    async def execute(self, ctx: SharedContext) -> AgentMessage:
        brief = ctx.design_brief
        if not brief:
            return self._build_agent_message(
                action="write_prompts",
                content="无法撰写 prompt：缺少设计需求",
                success=False,
                error="No design brief available",
            )

        logger.info(f"[PromptWriter] Writing prompts for '{brief.subject}'")

        # Build comprehensive context for the prompt writer
        context_parts = [
            f"## 设计需求\n"
            f"- 产品：{brief.subject}\n"
            f"- 使用场景：{brief.use_case or '电商商品图'}\n"
            f"- 风格偏好：{brief.style_hint or '未指定'}\n"
            f"- 目标平台：{brief.platform or '未指定'}\n"
            f"- 目标国家：{brief.target_country or '未指定'}\n"
            f"- 图片比例：{brief.aspect_ratio}\n"
            f"- 需要的图片类型：{', '.join(brief.image_types) if brief.image_types else 'main'}\n"
            f"- 核心卖点：{brief.selling_points or '未指定'}\n"
            f"- 色系偏好：{', '.join(brief.color_palette) if brief.color_palette else '未指定'}\n"
        ]

        # Add competitor report if available
        if ctx.competitor_report and not ctx.competitor_report.get("error"):
            cr = ctx.competitor_report
            context_parts.append(
                f"\n## 竞品分析\n"
                f"- 常见风格：{', '.join(cr.get('styles', []))}\n"
                f"- 常用构图：{', '.join(cr.get('common_layouts', []))}\n"
                f"- 色调趋势：{', '.join(cr.get('color_trends', []))}\n"
                f"- 差异化机会：{', '.join(cr.get('differentiation_opportunities', []))}\n"
                f"- 最佳实践：{', '.join(cr.get('best_practices', []))}\n"
            )

        # Add RAG context if available
        if ctx.rag_context:
            context_parts.append(f"\n## 知识库参考\n{ctx.rag_context[:500]}")

        user_content = "\n".join(context_parts)

        try:
            result = await self.think_structured(
                system_prompt=PROMPT_WRITER_SYSTEM_PROMPT,
                user_content=user_content,
                output_schema=PROMPT_WRITER_OUTPUT_SCHEMA,
            )

            prompts = result.get("prompts", [])
            ctx.final_prompts = prompts

            prompt_summary = ", ".join(
                f"{p.get('layer_type', 'unknown')}({len(p.get('prompt', ''))}chars)"
                for p in prompts
            )

            return self._build_agent_message(
                action="write_prompts",
                content=f"已撰写 {len(prompts)} 个 prompt：{prompt_summary}",
                data={"prompts": prompts},
            )

        except Exception as e:
            logger.error(f"[PromptWriter] Failed: {e}")
            # Fallback: generate simple prompt from brief
            fallback_prompt = _build_fallback_prompt(brief)
            ctx.final_prompts = [{"layer_type": "subject", "prompt": fallback_prompt, "style_tags": brief.color_palette}]
            return self._build_agent_message(
                action="write_prompts",
                content=f"Prompt 撰写降级（使用模板生成）",
                data={"prompts": ctx.final_prompts},
                success=False,
                error=str(e),
            )


def _build_fallback_prompt(brief) -> str:
    """Build a simple prompt from the design brief when LLM fails."""
    parts = [
        f"Professional e-commerce product image of {brief.subject or 'product'}",
    ]
    if brief.style_hint:
        parts.append(f"in {brief.style_hint} style")
    parts.append("studio lighting, high resolution, clean composition")
    if brief.selling_points:
        parts.append(f"highlighting: {brief.selling_points}")
    if brief.platform:
        parts.append(f"optimized for {brief.platform}")
    return ", ".join(parts)