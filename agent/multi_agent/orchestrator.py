"""
Multi-Agent — Orchestrator

The central coordinator that manages all agents, executes the DAG workflow,
and yields SSE events to the frontend. This is the main entry point for
the multi-agent architecture.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, AsyncGenerator
from agent.multi_agent.shared_context import (
    AgentRole,
    AgentMessage,
    SharedContext,
)
from agent.multi_agent.agents import create_all_agents
from agent.multi_agent.workflow import (
    WORKFLOW_STEPS,
    get_dependency_order,
    get_required_agents,
)

logger = logging.getLogger(__name__)


class MultiAgentOrchestrator:
    """Orchestrates the multi-agent workflow for e-commerce image generation.

    Workflow:
      1. Requirement Collector — extracts DesignBrief from user input
      2. [optional] Orchestrator LLM decides: competitor analysis? RAG search?
      3. Prompt Writer — compiles context into image prompts
      4. Image Generator — generates images for each prompt
      5. Reviewer — evaluates generated images

    Yields SSE event dicts compatible with the existing frontend protocol.
    """

    def __init__(
        self,
        chat_config: dict[str, str],
        image_config: dict[str, str],
        vision_config: dict[str, str] | None = None,
        multimodal_config: dict[str, str] | None = None,
        rag_retriever: Any = None,
    ):
        self._chat_config = chat_config
        self._image_config = image_config
        self._vision_config = vision_config or {}
        self._multimodal_config = multimodal_config or {}
        self._rag_retriever = rag_retriever

        # Create all agents
        self._agents = create_all_agents(
            chat_config=chat_config,
            image_config=image_config,
            vision_config=vision_config,
            multimodal_config=multimodal_config,
        )

    async def run(
        self,
        message: str,
        memory: Any,
        product_image_base64: str = "",
        reference_images: list[str] = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        """Run the multi-agent workflow.

        Args:
            message: Raw user message.
            memory: AgentMemory instance (for extracting product info and chat history).
            product_image_base64: Optional base64 product image.
            reference_images: Optional list of base64 reference images from user.

        Yields:
            SSE event dicts compatible with the existing frontend.
        """
        from agent.image_routing import (
            build_seedream_edit_prompt,
            parse_direct_image_request,
        )

        direct_image_agent, region_edit, clean_message = parse_direct_image_request(message)
        message = clean_message

        # ── Initialize SharedContext ──
        session_id = getattr(memory, "product_name", "") or f"session_{id(memory)}"

        # Build reference_images list: product image first, then user reference images
        ref_images = list(reference_images or [])
        if product_image_base64:
            # Ensure data URI prefix
            if not product_image_base64.startswith("data:"):
                product_image_base64 = f"data:image/png;base64,{product_image_base64}"
            # Put product image at the front so agents see it first, without
            # sending the same composer attachment twice.
            ref_images = [product_image_base64] + [
                image for image in ref_images if image != product_image_base64
            ]

        ctx = SharedContext(
            session_id=session_id,
            user_message=message,
            reference_images=ref_images,
        )
        if direct_image_agent and ref_images:
            ctx.metadata["_force_image_agent"] = True
            ctx.metadata["_region_edit"] = region_edit

        # Pre-populate design brief from memory if available
        if hasattr(memory, "product_name") and memory.product_name:
            from agent.models import DesignBrief
            ctx.design_brief = DesignBrief(
                subject=getattr(memory, "product_name", ""),
                use_case=getattr(memory, "ecom_platform", "") or "ecommerce",
                style_hint=getattr(memory, "style_preference", ""),
                platform=getattr(memory, "ecom_platform", ""),
                target_country=getattr(memory, "target_country", ""),
                aspect_ratio=getattr(memory, "aspect_ratio", "1:1"),
                image_types=getattr(memory, "image_types", []),
                selling_points=getattr(memory, "selling_points", ""),
                color_palette=getattr(memory, "color_palette", []),
                raw_message=message,
                reference_image_refs=[product_image_base64] if product_image_base64 else [],
            )
            ctx.metadata["_has_memory_brief"] = True

        # ── Pass recent chat history to SharedContext for requirement_collector ──
        if hasattr(memory, "recent_chat") and memory.recent_chat:
            ctx.metadata["_chat_history"] = memory.recent_chat

        # ── Pass _product_analysis from agent_memory to SharedContext ──
        if hasattr(memory, "agent_memory_dict"):
            agent_memory_dict = memory.agent_memory_dict or {}
        elif hasattr(memory, "to_dict"):
            agent_memory_dict = memory.to_dict() or {}
        else:
            agent_memory_dict = {}
        if agent_memory_dict.get("_product_analysis"):
            ctx.metadata["_product_analysis"] = agent_memory_dict["_product_analysis"]
            logger.info("[Orchestrator] Found _product_analysis in memory, passing to context")

        # ── Restore reference image state from persistent memory ──
        if hasattr(memory, "reference_images_intent") and memory.reference_images_intent:
            ctx.metadata["_ref_usage_confirmed"] = True
            ctx.metadata["_ref_images_intent"] = memory.reference_images_intent
            logger.info(f"[Orchestrator] Restored reference_images_intent from memory: {memory.reference_images_intent}")

        if hasattr(memory, "vlm_style_analysis") and memory.vlm_style_analysis:
            ctx.style_analysis = memory.vlm_style_analysis
            logger.info("[Orchestrator] Restored vlm_style_analysis from memory, skipping VLM re-analysis")

        if hasattr(memory, "reference_image_urls") and memory.reference_image_urls:
            # Restore reference images from memory if not provided in current request
            if not ctx.reference_images:
                ctx.reference_images = memory.reference_image_urls
                logger.info(f"[Orchestrator] Restored {len(memory.reference_image_urls)} reference images from memory")

        # ── Restore product_image_analysis from memory dedicated field ──
        if hasattr(memory, "product_image_analysis") and memory.product_image_analysis:
            if not ctx.metadata.get("_product_analysis"):
                ctx.metadata["_product_analysis"] = memory.product_image_analysis
                logger.info("[Orchestrator] Restored product_image_analysis from memory dedicated field")

        # ── Yield initial event ──
        yield {
            "event": "agent_message",
            "agent": AgentRole.ORCHESTRATOR.value,
            "text": "正在调用生图 Agent..." if direct_image_agent else "正在启动多 Agent 协作...",
        }

        # Composer attachments are explicit image-generation inputs. Skip the
        # requirement collector and prompt writer; Seedream receives the image
        # and the user's prompt in this same turn.
        if direct_image_agent and ctx.reference_images:
            from agent.models import DesignBrief

            if not ctx.design_brief:
                ctx.design_brief = DesignBrief(
                    subject=getattr(memory, "product_name", "") or "附件图片",
                    use_case="image_edit" if region_edit else "image_to_image",
                    aspect_ratio=getattr(memory, "aspect_ratio", "1:1"),
                    image_types=["main"],
                    raw_message=message,
                    reference_image_refs=ctx.reference_images[:1],
                )
            direct_prompt = build_seedream_edit_prompt(message, region_edit=region_edit)
            ctx.final_prompts = [{
                "layer_type": "edit",
                "prompt": direct_prompt,
                "style_tags": [],
            }]
            yield {
                "event": "agent_thinking",
                "phase": "image_generator",
                "iteration": 1,
                "agent_role": AgentRole.IMAGE_GENERATOR.value,
                "description": "附件图片已强制路由至生图 Agent",
            }
            result_event = await self._run_agent_with_events(
                self._agents["image_generator"], ctx
            )
            yield result_event
            for event in self._assemble_response(ctx, memory):
                yield event
            return

        # ── Determine which agents to run ──
        # Always run required agents. Run optional agents based on available info.
        required_agents = get_required_agents()
        enabled_agents = set(required_agents)

        # Enable competitor analyst if we have product info and style hint
        if ctx.design_brief and ctx.design_brief.subject and ctx.design_brief.style_hint:
            enabled_agents.add("competitor_analyst")

        # RAG context retrieval (parallel with competitor analyst)
        rag_task = None
        if self._rag_retriever and ctx.design_brief and ctx.design_brief.subject:
            rag_task = asyncio.create_task(self._retrieve_rag_context(ctx))

        # ── Execute workflow by dependency levels ──
        levels = get_dependency_order(enabled_agents)

        for level_idx, level in enumerate(levels):
            logger.info(f"[Orchestrator] Executing level {level_idx}: {level}")

            # Execute all agents in this level in parallel
            tasks = []
            for agent_key in level:
                if agent_key in self._agents:
                    agent = self._agents[agent_key]
                    step_info = _find_step(agent_key)
                    yield {
                        "event": "agent_thinking",
                        "phase": agent_key,
                        "iteration": level_idx + 1,
                        "agent_role": agent.role.value,
                        "description": step_info.get("description", "") if step_info else "",
                    }
                    tasks.append(self._run_agent_with_events(agent, ctx))

            # Wait for all agents in this level
            results = await asyncio.gather(*tasks, return_exceptions=True)

            # Yield agent results as SSE events
            for result in results:
                if isinstance(result, Exception):
                    logger.error(f"[Orchestrator] Agent failed: {result}")
                    yield {
                        "event": "error",
                        "message": f"Agent 执行失败: {str(result)}",
                        "agent_role": "unknown",
                    }
                elif isinstance(result, dict):
                    yield result

            # After requirement_collector (level 0), check if clarification is needed
            if level_idx == 0 and ctx.metadata.get("_clarification_needed"):
                clarification_questions = ctx.metadata.get("_clarification_questions", [])

                # ── 即使需要澄清，也持久化已提取的信息 ──
                brief = ctx.design_brief
                if brief and hasattr(memory, "product_name"):
                    if brief.subject and not memory.product_name:
                        memory.product_name = brief.subject
                    if brief.image_types:
                        memory.image_types = brief.image_types
                    if brief.selling_points:
                        memory.selling_points = brief.selling_points
                    if brief.style_hint and not memory.style_preference:
                        memory.style_preference = brief.style_hint
                    if brief.color_palette:
                        memory.color_palette = brief.color_palette

                # ── Persist reference image state ──
                if hasattr(memory, "reference_image_urls"):
                    if ctx.reference_images and not memory.reference_image_urls:
                        # Store truncated base64 (max 3 images, 2000 chars each)
                        memory.reference_image_urls = [
                            img[:2000] for img in ctx.reference_images[:3]
                        ]
                if hasattr(memory, "reference_images_intent"):
                    intent = ctx.metadata.get("_ref_images_intent", "")
                    if intent and not memory.reference_images_intent:
                        memory.reference_images_intent = intent
                if hasattr(memory, "vlm_style_analysis"):
                    if ctx.style_analysis and not memory.vlm_style_analysis:
                        memory.vlm_style_analysis = ctx.style_analysis
                if hasattr(memory, "product_image_analysis"):
                    pa = ctx.metadata.get("_product_analysis")
                    if pa and not memory.product_image_analysis:
                        memory.product_image_analysis = pa

                yield {
                    "event": "clarification_needed",
                    "agent": "requirement_collector",
                    "questions": clarification_questions,
                }
                # 持久化 agent_memory
                yield {
                    "event": "memory_updated",
                    "agent_memory": memory.to_dict() if hasattr(memory, "to_dict") else {}
                }
                yield {"event": "done"}
                return

        # ── Wait for RAG if still running ──
        if rag_task and not rag_task.done():
            try:
                await rag_task
            except Exception as e:
                logger.warning(f"[Orchestrator] RAG retrieval failed: {e}")

        # ── Assemble final response ──
        for event in self._assemble_response(ctx, memory):
            yield event

    async def _run_agent_with_events(self, agent, ctx: SharedContext) -> dict[str, Any]:
        """Run a single agent and return an SSE event dict."""
        agent_key = agent.role.value
        agent_name = AGENT_DISPLAY_NAMES.get(agent.role, agent_key)

        try:
            msg: AgentMessage = await agent.execute(ctx)
            ctx.add_message(msg)

            if msg.success:
                return {
                    "event": "agent_message",
                    "agent": agent_key,
                    "agent_role": agent_key,
                    "text": f"【{agent_name}】{msg.content}",
                }
            else:
                return {
                    "event": "agent_message",
                    "agent": agent_key,
                    "agent_role": agent_key,
                    "text": f"【{agent_name}】⚠️ {msg.content}",
                }
        except Exception as e:
            logger.error(f"[Orchestrator] Agent '{agent_key}' crashed: {e}")
            error_msg = AgentMessage(
                role=agent.role,
                action="error",
                content=f"执行失败: {str(e)}",
                success=False,
                error=str(e),
            )
            ctx.add_message(error_msg)
            return {
                "event": "error",
                "message": f"【{agent_name}】执行失败: {str(e)}",
                "agent_role": agent_key,
            }

    async def _retrieve_rag_context(self, ctx: SharedContext) -> None:
        """Retrieve RAG context in the background."""
        try:
            brief = ctx.design_brief
            query = f"{brief.subject} {brief.style_hint}" if brief else ctx.user_message
            result = await self._rag_retriever.retrieve_multi_category(
                query=query,
                categories=["prompt_template", "style_guide"],
                top_k_per_category=2,
            )
            if result and result.context:
                ctx.rag_context = result.context[:500]
                logger.info(f"[Orchestrator] RAG context retrieved: {len(ctx.rag_context)} chars")
        except Exception as e:
            logger.warning(f"[Orchestrator] RAG retrieval failed: {e}")

    def _assemble_response(
        self, ctx: SharedContext, memory: Any
    ) -> list[dict[str, Any]]:
        """Assemble and yield the final response events."""
        events: list[dict[str, Any]] = []
        # Yield generated images
        if ctx.generated_images:
            for img_type, img_url in ctx.generated_images.items():
                matching_prompt = ""
                for p in ctx.final_prompts:
                    if p.get("layer_type") == img_type:
                        matching_prompt = p.get("prompt", "")
                        break
                events.append({
                    "event": "image_progress",
                    "image_type": img_type,
                    "url": img_url,
                    "prompt": matching_prompt,
                })

        # Yield final image_done event
        events.append({
            "event": "image_done",
            "all_images": ctx.generated_images,
            "all_prompts": {p.get("layer_type", "main"): p.get("prompt", "") for p in ctx.final_prompts},
            "average_scores": {"overall": 0.0},
            "review_results": ctx.review_results,
        })

        # Build chat reply
        brief = ctx.design_brief
        chat_reply = _build_final_reply(ctx, brief)
        ctx.chat_reply = chat_reply

        events.append({
            "event": "agent_message",
            "agent": AgentRole.ORCHESTRATOR.value,
            "agent_role": AgentRole.ORCHESTRATOR.value,
            "text": chat_reply,
        })

        # Update memory
        if hasattr(memory, "add_chat_turn"):
            memory.add_chat_turn("assistant", chat_reply[:500])

        # Sync DesignBrief fields back to AgentMemory so they persist across turns
        if brief and hasattr(memory, "product_name"):
            if brief.subject and brief.subject != memory.product_name:
                memory.product_name = brief.subject
            if brief.image_types:
                memory.image_types = brief.image_types
            if brief.selling_points:
                memory.selling_points = brief.selling_points
            if brief.style_hint and brief.style_hint != memory.style_preference:
                memory.style_preference = brief.style_hint
            if brief.color_palette:
                memory.color_palette = brief.color_palette
            if brief.platform and not memory.ecom_platform:
                memory.ecom_platform = brief.platform
            if brief.target_country and not memory.target_country:
                memory.target_country = brief.target_country

        # ── Persist reference image state ──
        if hasattr(memory, "reference_images_intent"):
            intent = ctx.metadata.get("_ref_images_intent", "")
            if intent:
                memory.reference_images_intent = intent
        if hasattr(memory, "vlm_style_analysis"):
            if ctx.style_analysis:
                memory.vlm_style_analysis = ctx.style_analysis
        if hasattr(memory, "product_image_analysis"):
            pa = ctx.metadata.get("_product_analysis")
            if pa:
                memory.product_image_analysis = pa

        events.append({"event": "memory_updated", "agent_memory": memory.to_dict() if hasattr(memory, "to_dict") else {}})
        events.append({"event": "done"})

        return events


# ── Display names for agents ──

AGENT_DISPLAY_NAMES = {
    AgentRole.ORCHESTRATOR: "编排助手",
    AgentRole.REQUIREMENT_COLLECTOR: "需求分析",
    AgentRole.COMPETITOR_ANALYST: "竞品分析",
    AgentRole.PROMPT_WRITER: "Prompt 工程师",
    AgentRole.IMAGE_GENERATOR: "视觉设计师",
}


# ── Helpers ──

def _find_step(agent_key: str) -> dict[str, Any] | None:
    for step in WORKFLOW_STEPS:
        if step["agent"] == agent_key:
            return step
    return None


def _build_final_reply(ctx: SharedContext, brief) -> str:
    """Build a human-readable final reply summarizing what was done."""
    parts = []

    if brief and brief.subject:
        parts.append(f"已为「{brief.subject}」完成商品图生成。")

    img_count = len(ctx.generated_images)
    if img_count > 0:
        parts.append(f"共生成 {img_count} 张图片。")

    if ctx.competitor_report and not ctx.competitor_report.get("error"):
        opps = ctx.competitor_report.get("differentiation_opportunities", [])
        if opps:
            parts.append(f"竞品差异化建议：{opps[0][:80]}")

    return " ".join(parts) if parts else "任务完成。"
