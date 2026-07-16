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
    "你是 AI 图像生成 Prompt 工程师。用户的 image_types 字段指定了需要生成的图片类型，"
    "每种类型各生成 1 个 prompt。\n\n"
    "支持的图片类型：\n"
    "- main: 白底/透明底产品主图，产品居中，专业影棚灯光，适合电商首图\n"
    "- selling_point: 标注核心卖点的信息图风格图片，文字+图标+产品组合展示\n"
    "- scene_selling: 产品在真实使用场景中，叠加卖点文字标注\n"
    "- detail: 产品细节特写图，展示材质、工艺、局部特征\n"
    "- comparison: before/after 对比图\n"
    "- structure: 产品拆解/结构图\n"
    "- person_scene: 模特+产品场景图\n"
    "- scene_tag: 场景+促销标签图\n\n"
    "规则：\n"
    "1. 根据 image_types 列表，每种类型生成 1 个 prompt（不是每个图层）\n"
    "2. 如果 image_types 为空，默认生成 main 类型\n"
    "3. 所有 prompt 使用英文撰写，控制在 600 字以内\n"
    "4. 包含：主体描述、材质/质感、光照、构图、色调、风格标签\n"
    "5. 如果提供了参考图风格分析，融入其中提取的色彩、光影、构图、风格特征\n"
    "6. 如果提供了竞品分析，融入差异化策略\n"
    "7. 如果提供了 RAG 知识库参考，优先使用其中的 prompt 模板和风格指南\n"
    "8. 【重要】如果上下文中包含「用户修改意图」说明用户在已有参考图基础上做修改，"
    "生成的是图片编辑 prompt（image-to-image），必须包含：\n"
    "   - 保留原图的产品主体、结构、构图\n"
    "   - 只修改用户指定的元素（如背景、颜色、光照等）\n"
    "   - 以 'Image editing: modify the existing image...' 开头\n"
    "9. 【风格迁移】如果用户明确表达了「用参考图的风格来生成」的意图，且提供了风格分析：\n"
    "   - 从风格分析中提取：色调（dominant_colors）、光照（lighting）、构图（composition）、氛围（mood）关键词\n"
    "   - 将这些关键词作为主导风格应用到目标产品上\n"
    "   - 生成「以 [产品] 为主体，采用参考图的 [色调]+[光照]+[构图]+[氛围]」风格的 prompt\n"
    "   - 不要照搬参考图中的产品，而是将风格特征迁移到目标产品\n\n"
    "输出 JSON 格式：\n"
    '{"prompts": [{"layer_type": "main", "prompt": "English prompt...", "style_tags": ["tag1", "tag2"]}, ...]}\n'
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

        # Detect image modification intent: has reference images + user message
        is_modification = (
            len(ctx.reference_images) > 0
            and ctx.user_message
            and not ctx.metadata.get("_has_memory_brief")
        )
        # Also check if the user message contains modification keywords
        modification_keywords = [
            "修改", "改", "换成", "替换", "去掉", "删除", "加上", "添加",
            "modify", "change", "replace", "remove", "add", "edit", "update",
            "换成", "变成", "改为", "调整", "换一个",
        ]
        has_modification_intent = any(kw in ctx.user_message.lower() for kw in modification_keywords)
        is_modification = is_modification or (len(ctx.reference_images) > 0 and has_modification_intent)

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

        # Add modification intent context
        if is_modification:
            context_parts.append(
                f"\n## 用户修改意图（重要）\n"
                f"用户已提供 {len(ctx.reference_images)} 张参考图，希望基于参考图进行修改，"
                f"而不是从零生成新图片。\n"
                f"用户修改描述：{ctx.user_message}\n"
                f"请生成 image-to-image 编辑 prompt，保留原图的主体和结构，"
                f"只修改用户描述中指定的元素。\n"
            )

        # Add style analysis from reference images if available
        if ctx.style_analysis:
            sa = ctx.style_analysis
            sa_parts = ["\n## 参考图风格分析"]
            if sa.get("dominant_colors"):
                sa_parts.append(f"- 主色调：{', '.join(sa['dominant_colors'])}")
            if sa.get("lighting"):
                sa_parts.append(f"- 光照风格：{sa['lighting']}")
            if sa.get("composition"):
                sa_parts.append(f"- 构图方式：{sa['composition']}")
            if sa.get("mood"):
                sa_parts.append(f"- 整体氛围：{sa['mood']}")
            if sa.get("style_category"):
                sa_parts.append(f"- 风格类别：{sa['style_category']}")
            if sa.get("style_notes"):
                sa_parts.append(f"- 补充说明：{sa['style_notes']}")
            context_parts.append("\n".join(sa_parts))

            # ── Style transfer: inject dominant style instruction ──
            ref_intent = ctx.metadata.get("_ref_images_intent", "")
            if ref_intent == "style_transfer":
                style_keywords = []
                if sa.get("dominant_colors"):
                    style_keywords.append(f"色调采用{'、'.join(sa['dominant_colors'])}")
                if sa.get("lighting"):
                    style_keywords.append(f"光照采用{sa['lighting']}")
                if sa.get("composition"):
                    style_keywords.append(f"构图采用{sa['composition']}")
                if sa.get("mood"):
                    style_keywords.append(f"氛围采用{sa['mood']}")
                if sa.get("style_category"):
                    style_keywords.append(f"整体风格为{sa['style_category']}")

                style_instruction = (
                    f"\n## 风格迁移指令（重要）\n"
                    f"用户要求使用参考图的风格来生成目标产品的图片。\n"
                    f"请将以下参考图风格特征迁移到「{brief.subject}」上：\n"
                    f"{chr(10).join(f'- {k}' for k in style_keywords)}\n"
                    f"注意：生成的主体是「{brief.subject}」，不是参考图中的产品。"
                    f"只是把参考图的视觉风格（色调、光照、构图、氛围）应用过来。"
                )
                context_parts.append(style_instruction)
                logger.info(f"[PromptWriter] Style transfer mode active for '{brief.subject}'")

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