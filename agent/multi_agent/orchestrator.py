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
        rag_retriever: Any = None,
    ):
        self._chat_config = chat_config
        self._image_config = image_config
        self._vision_config = vision_config or {}
        self._rag_retriever = rag_retriever

        # Create all agents
        self._agents = create_all_agents(
            chat_config=chat_config,
            image_config=image_config,
            vision_config=vision_config,
        )

    async def run(
        self,
        message: str,
        memory: Any,
        product_image_base64: str = "",
    ) -> AsyncGenerator[dict[str, Any], None]:
        """Run the multi-agent workflow.

        Args:
            message: Raw user message.
            memory: AgentMemory instance (for extracting product info and chat history).
            product_image_base64: Optional base64 product image.

        Yields:
            SSE event dicts compatible with the existing frontend.
        """
        # ── Initialize SharedContext ──
        session_id = getattr(memory, "product_name", "") or f"session_{id(memory)}"
        ctx = SharedContext(
            session_id=session_id,
            user_message=message,
        )

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
                reference_image_refs=[f"data:image/png;base64,{product_image_base64}"] if product_image_base64 else [],
            )

        # ── Yield initial event ──
        yield {
            "event": "agent_message",
            "agent": AgentRole.ORCHESTRATOR.value,
            "text": "正在启动多 Agent 协作...",
        }

        # ── Determine which agents to run ──
        # Always run required agents. Run optional agents based on available info.
        required_agents = get_required_agents()
        enabled_agents = set(required_agents)

        # Enable competitor analyst if we have product info
        if ctx.design_brief and ctx.design_brief.subject:
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

        # Yield review results
        if ctx.review_results:
            for review in ctx.review_results:
                events.append({
                    "event": "evaluation_progress",
                    "image_type": review.get("layer_type", "main"),
                    "status": "evaluated",
                    "score": review.get("overall_score", 0),
                    "passed": review.get("passed", False),
                    "issues": review.get("issues", []),
                    "suggestions": review.get("suggestions", []),
                })

        # Yield final image_done event
        avg_score = 0.0
        if ctx.review_results:
            scores = [r.get("overall_score", 0) for r in ctx.review_results]
            avg_score = sum(scores) / len(scores) if scores else 0.0

        events.append({
            "event": "image_done",
            "all_images": ctx.generated_images,
            "all_prompts": {p.get("layer_type", "main"): p.get("prompt", "") for p in ctx.final_prompts},
            "average_scores": {"overall": round(avg_score, 1)},
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
    AgentRole.REVIEWER: "质量审查",
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

    if ctx.review_results:
        passed = sum(1 for r in ctx.review_results if r.get("passed", False))
        total = len(ctx.review_results)
        parts.append(f"质量审查：{passed}/{total} 通过。")

    if ctx.competitor_report and not ctx.competitor_report.get("error"):
        opps = ctx.competitor_report.get("differentiation_opportunities", [])
        if opps:
            parts.append(f"竞品差异化建议：{opps[0][:80]}")

    return " ".join(parts) if parts else "任务完成。"
