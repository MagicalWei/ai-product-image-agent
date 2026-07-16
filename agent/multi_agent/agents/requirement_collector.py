"""
Multi-Agent — Requirement Collector

Extracts structured design requirements from raw user input.
Produces a DesignBrief written to SharedContext.
Also analyzes reference images for style consistency and asks
clarification questions when needed.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from typing import Any

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
    "- image_types: 需要的图片类型列表。支持的类型及中文对应：\n"
    "  · main = 主图/白底图/首图\n"
    "  · selling_point = 卖点图/信息图\n"
    "  · scene_selling = 场景图/使用场景\n"
    "  · detail = 详情图/细节特写\n"
    "  · comparison = 对比图/before after\n"
    "  · structure = 拆解图/结构图\n"
    "  · person_scene = 模特图/人物场景\n"
    "  · scene_tag = 促销标签图\n"
    "  例如用户说\"主图\"则填[\"main\"]，说\"主图和场景图\"则填[\"main\", \"scene_selling\"]。\n"
    "- selling_points: 核心卖点（用逗号分隔）\n"
    "- color_palette: 色系偏好（如[\"白色\", \"蓝色\"]）\n\n"
    "规则：\n"
    "1. 如果用户没有明确提到某个字段，留空字符串或空列表，不要编造。\n"
    "2. 从用户消息中尽可能多地提取信息。\n"
    "3. 特别注意将用户的中文描述映射到对应的 image_types 代码值。\n"
    "4. 只输出 JSON，不要任何解释文字。\n"
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

# Vision model prompt for analyzing reference image style
REFERENCE_STYLE_ANALYSIS_PROMPT = (
    "你是一位专业的视觉设计分析师。请仔细分析这张参考图片的视觉风格特征，"
    "提取以下信息用于指导后续图像生成。\n\n"
    "分析维度：\n"
    "- dominant_colors: 3-5个主要颜色（用中文描述，如\"暖白\"、\"深蓝灰\"）\n"
    "- lighting: 光照风格（如\"柔光正面光\"、\"侧逆光\"、\"顶光\"）\n"
    "- composition: 构图方式（如\"产品居中\"、\"三分法\"、\"对角线\"）\n"
    "- mood: 整体氛围（如\"高端专业\"、\"温馨自然\"、\"科技冷峻\"）\n"
    "- style_category: 风格归类（如\"极简白底\"、\"场景种草图\"、\"信息图\"、\"模特实拍\"）\n"
    "- style_notes: 其他值得注意的风格特征\n\n"
    "输出 JSON 格式，不要 markdown 包裹。\n"
)

MAX_REFERENCE_IMAGES_TO_ANALYZE = 3


class RequirementCollectorAgent(BaseAgent):
    """Extracts structured DesignBrief from user input, analyzes reference images,
    and asks clarification questions when needed."""

    role = AgentRole.REQUIREMENT_COLLECTOR

    def __init__(self, chat_config: dict[str, str], vision_config: dict[str, str] | None = None, multimodal_config: dict[str, str] | None = None):
        super().__init__(chat_config)
        self._vision_config = vision_config or {}
        self._multimodal_config = multimodal_config or {}

    async def execute(self, ctx: SharedContext) -> AgentMessage:
        logger.info("[RequirementCollector] Extracting design requirements...")

        has_memory_brief = ctx.metadata.get("_has_memory_brief", False)
        has_reference_images = bool(ctx.reference_images)
        has_new_message = bool(ctx.user_message and ctx.user_message.strip())

        # ── Step 0: Check for pre-analyzed product image from canvas upload ──
        product_analysis = ctx.metadata.get("_product_analysis")
        if product_analysis and not has_memory_brief:
            logger.info("[RequirementCollector] Found _product_analysis, pre-filling design brief")
            self._prefill_from_product_analysis(ctx, product_analysis)

        # ── Step 1: Analyze reference images for style (independent of brief extraction) ──
        if has_reference_images and self._multimodal_config.get("api_key"):
            await self._analyze_reference_images(ctx)

        # ── Step 1: Extract/merge design brief ──
        if has_memory_brief and ctx.design_brief and ctx.design_brief.subject:
            # Merge: existing brief + new user message + reference style
            logger.info("[RequirementCollector] Merging memory brief with new input")
            await self._merge_brief(ctx)
        else:
            # Fresh extraction from user input
            await self._extract_fresh_brief(ctx)

        # ── Step 2: Check if clarification is needed ──
        questions = self._build_clarification_questions(ctx)
        if questions:
            ctx.metadata["_clarification_needed"] = True
            ctx.metadata["_clarification_questions"] = questions
            return self._build_agent_message(
                action="collect_requirements",
                content=f"需要确认：{'; '.join(questions)}",
                data={
                    "design_brief": ctx.design_brief.model_dump() if ctx.design_brief else {},
                    "clarification_needed": True,
                    "questions": questions,
                },
            )

        return self._build_agent_message(
            action="collect_requirements",
            content=self._build_summary(ctx),
            data={"design_brief": ctx.design_brief.model_dump() if ctx.design_brief else {}},
        )

    # ── Reference image style analysis ──

    async def _analyze_reference_images(self, ctx: SharedContext) -> None:
        """Analyze reference images using multimodal model, write to ctx.style_analysis.

        Skips VLM call if style_analysis was already restored from persistent memory.
        """
        # Skip if already analyzed (restored from memory by orchestrator)
        if ctx.style_analysis:
            logger.info(
                "[RequirementCollector] style_analysis already present (restored from memory), "
                f"skipping VLM re-analysis: {ctx.style_analysis.get('style_category', 'unknown')}"
            )
            return

        images_to_analyze = ctx.reference_images[:MAX_REFERENCE_IMAGES_TO_ANALYZE]
        logger.info(
            f"[RequirementCollector] Analyzing {len(images_to_analyze)} reference images for style..."
        )

        analyses = []
        for i, img_b64 in enumerate(images_to_analyze):
            try:
                result = await self._call_multimodal(
                    system_prompt=REFERENCE_STYLE_ANALYSIS_PROMPT,
                    image_base64=img_b64,
                )
                if result and not result.get("parse_error"):
                    analyses.append(result)
                    logger.info(f"[RequirementCollector] Reference image {i+1} analyzed: {result.get('style_category', 'unknown')}")
            except Exception as e:
                logger.warning(f"[RequirementCollector] Failed to analyze reference image {i+1}: {e}")

        if analyses:
            # Merge analyses from multiple images
            merged = self._merge_style_analyses(analyses)
            ctx.style_analysis = merged
            logger.info(f"[RequirementCollector] Style analysis complete: {merged.get('style_category', 'unknown')}")

    async def _call_multimodal(
        self, system_prompt: str, image_base64: str
    ) -> dict[str, Any]:
        """Call multimodal model (qwen3.6-plus) with an image."""
        _agent_service_dir = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "..", "..", "backend", "agent_service"),
        )
        if _agent_service_dir not in sys.path:
            sys.path.insert(0, _agent_service_dir)
        from chat_client import execute_chat_with_fallbacks, get_chat_fallback_configs
        from config import clean_json_string

        # Ensure the image has a proper data URI prefix
        img_url = image_base64
        if not img_url.startswith("data:"):
            img_url = f"data:image/png;base64,{image_base64}"

        messages = [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "请分析这张参考图片的视觉风格特征。"},
                    {"type": "image_url", "image_url": {"url": img_url}},
                ],
            },
        ]

        primary_config = {
            "protocol": "openai",
            "api_key": self._multimodal_config.get("api_key", ""),
            "base_url": self._multimodal_config.get("base_url", "https://ws-kbw1pwxjomfj4o8k.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"),
            "model": self._multimodal_config.get("model", "qwen3.6-plus"),
        }

        resp = await execute_chat_with_fallbacks(
            messages, primary_config, get_chat_fallback_configs()
        )
        cleaned = clean_json_string(resp)
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            logger.warning("[RequirementCollector] Multimodal response not valid JSON")
            return {"raw_output": resp, "parse_error": True}

    def _merge_style_analyses(self, analyses: list[dict]) -> dict[str, Any]:
        """Merge style analyses from multiple reference images."""
        if len(analyses) == 1:
            return analyses[0]

        all_colors = []
        lightings = []
        compositions = []
        moods = []
        categories = []
        all_notes = []

        for a in analyses:
            if a.get("dominant_colors"):
                all_colors.extend(a["dominant_colors"])
            if a.get("lighting"):
                lightings.append(a["lighting"])
            if a.get("composition"):
                compositions.append(a["composition"])
            if a.get("mood"):
                moods.append(a["mood"])
            if a.get("style_category"):
                categories.append(a["style_category"])
            if a.get("style_notes"):
                all_notes.append(a["style_notes"])

        # Deduplicate colors while preserving order
        seen = set()
        unique_colors = []
        for c in all_colors:
            if c not in seen:
                seen.add(c)
                unique_colors.append(c)

        return {
            "dominant_colors": unique_colors[:8],
            "lighting": " + ".join(dict.fromkeys(lightings)) if lightings else "",
            "composition": " + ".join(dict.fromkeys(compositions)) if compositions else "",
            "mood": " + ".join(dict.fromkeys(moods)) if moods else "",
            "style_category": " + ".join(dict.fromkeys(categories)) if categories else "",
            "style_notes": "; ".join(all_notes) if all_notes else "",
            "reference_count": len(analyses),
        }

    # ── Brief extraction / merging ──

    async def _merge_brief(self, ctx: SharedContext) -> None:
        """Merge existing memory brief with new user message and reference images."""
        user_text = ctx.user_message
        if not user_text:
            return  # No new input, keep existing brief

        # ── Detect reference image intent from user reply ──
        ref_intent_keywords = {
            "style_transfer": ["按风格", "按这个风格", "用这个风格", "参考风格", "风格迁移",
                               "按这张图的风格", "用参考图的风格", "按参考图风格"],
            "composition_only": ["只参考构图", "参考构图", "构图", "布局", "只参考布局",
                                  "参考布局就行", "构图参考"],
            "ignore": ["随便看看", "只是看看", "不上传", "不用参考", "忽略", "随便",
                       "随便吧", "随便来", "无所谓", "都行", "都可以", "随意"],
        }
        for intent, keywords in ref_intent_keywords.items():
            if any(kw in user_text for kw in keywords):
                ctx.metadata["_ref_images_intent"] = intent
                ctx.metadata["_ref_usage_confirmed"] = True
                logger.info(f"[RequirementCollector] Detected reference image intent: {intent}")
                break

        existing_brief = ctx.design_brief
        existing_summary = (
            f"已有设计需求：\n"
            f"- 产品：{existing_brief.subject}\n"
            f"- 使用场景：{existing_brief.use_case or '未指定'}\n"
            f"- 风格偏好：{existing_brief.style_hint or '未指定'}\n"
            f"- 平台：{existing_brief.platform or '未指定'}\n"
            f"- 图片类型：{', '.join(existing_brief.image_types) if existing_brief.image_types else '未指定'}\n"
            f"- 卖点：{existing_brief.selling_points or '未指定'}\n"
            f"- 色系：{', '.join(existing_brief.color_palette) if existing_brief.color_palette else '未指定'}\n"
        )

        # Build chat history context
        chat_history = ctx.metadata.get("_chat_history", [])
        history_lines = []
        if chat_history:
            history_lines = ["\n## 对话历史"]
            for msg in chat_history[-6:]:
                role_label = "用户" if msg.get("role") == "user" else "助手"
                content = (msg.get("content", "") or "")[:300]
                history_lines.append(f"{role_label}: {content}")

        user_content = f"{existing_summary}\n{''.join(history_lines)}\n\n用户新消息：\n{user_text}"

        try:
            result = await self.think_structured(
                system_prompt=REQUIREMENT_COLLECTOR_SYSTEM_PROMPT
                + "\n如果新消息对已有字段有补充或修改，更新对应字段。如果没有新信息，保留已有值。",
                user_content=user_content,
                output_schema=REQUIREMENT_OUTPUT_SCHEMA,
            )

            # Merge: use new values if non-empty, otherwise keep existing
            brief = DesignBrief(
                subject=result.get("subject") or existing_brief.subject,
                use_case=result.get("use_case") or existing_brief.use_case,
                style_hint=result.get("style_hint") or existing_brief.style_hint,
                platform=result.get("platform") or existing_brief.platform,
                target_country=result.get("target_country") or existing_brief.target_country,
                aspect_ratio=result.get("aspect_ratio") or existing_brief.aspect_ratio or "1:1",
                image_types=result.get("image_types") or existing_brief.image_types,
                selling_points=result.get("selling_points") or existing_brief.selling_points,
                color_palette=result.get("color_palette") or existing_brief.color_palette,
                reference_image_refs=existing_brief.reference_image_refs,
                raw_message=f"{existing_brief.raw_message}\n---\n{user_text}",
            )
            ctx.design_brief = brief
            logger.info(f"[RequirementCollector] Brief merged: subject={brief.subject}")

        except Exception as e:
            logger.error(f"[RequirementCollector] Merge failed: {e}")
            # Keep existing brief

    async def _extract_fresh_brief(self, ctx: SharedContext) -> None:
        """Extract design brief from scratch."""
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
                reference_image_refs=ctx.reference_images[:MAX_REFERENCE_IMAGES_TO_ANALYZE] if ctx.reference_images else [],
                raw_message=user_text,
            )

            ctx.design_brief = brief

        except Exception as e:
            logger.error(f"[RequirementCollector] Failed: {e}")
            fallback_brief = DesignBrief(
                subject=user_text[:100],
                raw_message=user_text,
            )
            ctx.design_brief = fallback_brief

    # ── Clarification ──

    def _build_clarification_questions(self, ctx: SharedContext) -> list[str]:
        """Determine if clarification questions are needed."""
        questions = []
        brief = ctx.design_brief

        # Check reference images usage intent (skip if already confirmed from memory)
        if ctx.reference_images and not ctx.metadata.get("_ref_usage_confirmed"):
            ctx.metadata["_ref_usage_confirmed"] = True  # Only ask once
            questions.append(
                f"我看到你上传了 {len(ctx.reference_images)} 张参考图，请问：\n"
                "  1. 要按照这些图的风格来生成吗？\n"
                "  2. 还是只参考构图/布局？\n"
                "  3. 或者只是随便看看？\n"
                "请回复你的选择（可以说\"按风格\"、\"只参考构图\"或\"随便看看\"）。"
            )

        # Check image types (skip if pre-filled from product analysis)
        if brief and (not brief.image_types or len(brief.image_types) == 0):
            if not ctx.metadata.get("_prefilled_from_analysis"):
                questions.append(
                    "你需要哪些类型的图片？可选类型：主图（白底产品图）、"
                    "卖点图（信息图风格）、详情图（细节特写）、场景图（产品+使用场景）。"
                    "请告诉我你需要哪几种。"
                )

        # Check subject
        if not brief or not brief.subject:
            questions.append("请问你要生成什么产品的图片？请提供产品名称。")

        return questions

    def _build_summary(self, ctx: SharedContext) -> str:
        """Build a human-readable summary of the extracted brief."""
        brief = ctx.design_brief
        if not brief:
            return "未能提取设计需求"

        parts = [f"产品={brief.subject}"]
        if brief.platform:
            parts.append(f"平台={brief.platform}")
        if brief.style_hint:
            parts.append(f"风格={brief.style_hint}")
        if brief.image_types:
            parts.append(f"图片类型={', '.join(brief.image_types)}")
        else:
            parts.append("图片类型=未指定")
        if ctx.style_analysis:
            parts.append(f"参考图风格={ctx.style_analysis.get('style_category', '已分析')}")

        return f"已提取设计需求：{'，'.join(parts)}"

    # ── Product analysis pre-fill ──

    def _prefill_from_product_analysis(self, ctx: SharedContext, analysis: dict) -> None:
        """Pre-fill DesignBrief from product image analysis results.

        Called when a product image was auto-analyzed on canvas upload.
        The analysis provides product name, selling points, style, and image type suggestions.
        """
        if analysis.get("parse_error") or analysis.get("error"):
            logger.warning("[RequirementCollector] Product analysis has errors, skipping pre-fill")
            return

        product_id = analysis.get("product_identification", {})
        selling = analysis.get("selling_points", {})
        visual = analysis.get("visual_style", {})
        img_suggestions = analysis.get("image_type_suggestions", [])

        subject = product_id.get("product_name", "")
        suggested_selling_points = selling.get("suggested_selling_points", [])
        style_category = visual.get("style_category", "")
        dominant_colors = visual.get("dominant_colors", [])
        suggested_types = [s.get("type", "") for s in img_suggestions if s.get("type")]

        # Build style hint from visual analysis
        style_parts = []
        if style_category:
            style_parts.append(style_category)
        if visual.get("mood"):
            style_parts.append(visual.get("mood"))
        style_hint = "，".join(style_parts) if style_parts else ""

        # Use user message if present, otherwise default
        user_text = ctx.user_message.strip() if ctx.user_message else ""

        from agent.models import DesignBrief
        ctx.design_brief = DesignBrief(
            subject=subject or "待确认商品",
            use_case="ecommerce",
            style_hint=style_hint or "根据商品图自动分析",
            platform="",
            target_country="",
            aspect_ratio="1:1",
            image_types=suggested_types,
            selling_points="，".join(suggested_selling_points) if suggested_selling_points else "",
            color_palette=dominant_colors,
            reference_image_refs=[],
            raw_message=user_text or f"自动分析商品图：{subject}",
        )
        ctx.metadata["_prefilled_from_analysis"] = True
        logger.info(
            f"[RequirementCollector] Pre-filled brief from analysis: "
            f"subject={subject}, types={suggested_types}, colors={dominant_colors}"
        )
