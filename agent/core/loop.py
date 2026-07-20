"""
Sense-Decide-Act-Review Loop

The core agent loop implementing the four-phase architecture:
  1. SENSE  — classify intent, safety filter, assemble context, clarify, expand prompt
  2. DECIDE — LLM structured output selects action from ACTION_REGISTRY
  3. ACT    — Execute selected action handler
  4. REVIEW — Local (single layer) or global (multi-layer) review, with retry

Yields SSE event dicts compatible with the existing frontend protocol.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from typing import Any, AsyncGenerator

from agent.actions.registry import ActionHandler, get_action, list_actions
from agent.canvas.state import CanvasStateManager
from agent.canvas.version_tree import VersionTree
from agent.image_routing import (
    build_seedream_edit_prompt,
    is_attachment_receipt_question,
    parse_direct_image_request,
)
from agent.models import (
    ActionParams,
    ActionResult,
    CanvasState,
    DesignBrief,
    EnrichedContext,
    IntentType,
    RetryDecision,
    ReviewResult,
)

logger = logging.getLogger(__name__)

# Maximum retries per action
MAX_RETRIES_PER_ACTION = 2
MAX_ITERATIONS = 10
WARNING_THRESHOLD = 8


def _usable_model_config(config: dict[str, Any]) -> bool:
    return bool(
        str(config.get("api_key") or "").strip()
        and str(config.get("base_url") or "").strip()
        and str(config.get("model") or "").strip()
    )


class SenseDecideActReviewLoop:
    """sense → decide → act → review four-phase agent loop.

    Replaces the single-LLM tool-calling loop with a structured pipeline
    that maintains CanvasState as the single source of truth.
    """

    def __init__(
        self,
        action_registry: dict[str, ActionHandler],
        canvas_manager: CanvasStateManager,
        version_tree: VersionTree,
        chat_config: dict[str, str],
        vision_config: dict[str, str],
        image_config: dict[str, Any] | None = None,
        multimodal_config: dict[str, str] | None = None,
    ):
        self._actions = action_registry
        self._canvas = canvas_manager
        self._versions = version_tree
        self._chat_config = chat_config
        self._vision_config = vision_config
        self._image_config = image_config or {}
        self._multimodal_config = multimodal_config or vision_config
        self._review_config = (
            vision_config if vision_config.get("api_key") else self._multimodal_config
        )

    def _chat_fallback_chain(self, configured: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Return usable, deduplicated fallbacks including the working VLM endpoint."""
        candidates = [*configured]
        if _usable_model_config(self._multimodal_config):
            candidates.append({
                "protocol": "openai",
                "api_key": self._multimodal_config.get("api_key", ""),
                "base_url": self._multimodal_config.get("base_url", ""),
                "model": self._multimodal_config.get("model", ""),
            })
        seen: set[tuple[str, str]] = set()
        result: list[dict[str, Any]] = []
        for config in candidates:
            if not _usable_model_config(config):
                continue
            identity = (str(config.get("base_url")), str(config.get("model")))
            if identity in seen:
                continue
            seen.add(identity)
            result.append({**config, "timeout_seconds": 20, "retry_attempts": 1})
        return result

    # ================================================================
    # Public API
    # ================================================================

    async def run(
        self,
        message: str,
        memory: Any,  # AgentMemory
        product_image_base64: str = "",
        reference_images: list[str] | None = None,
        style_reference_images: list[str] | None = None,
        style_transfer_mode: bool = False,
        product_set_mode: bool = False,
        canvas_id: str | None = None,
        rag_retriever: Any = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        """Run the sense-decide-act-review loop.

        Args:
            message: Raw user message.
            memory: AgentMemory instance.
            product_image_base64: Optional base64 product image.
            canvas_id: Optional canvas ID (auto-generated from session if None).
            rag_retriever: Optional RAG retriever for knowledge search.

        Yields:
            SSE event dicts compatible with the existing frontend.
        """
        # Use a stable canvas_id: prefer explicit, then session-derived, fallback to memory id
        cid = canvas_id
        if cid is None:
            session_id = getattr(memory, "product_name", "") or f"mem_{id(memory)}"
            cid = f"canvas_{session_id}"
        canvas = self._canvas.get_or_create(cid)
        direct_image_request, region_edit_requested, clean_message = parse_direct_image_request(message)
        clean_message = clean_message or message
        reference_images = reference_images or []
        style_reference_images = style_reference_images or []
        direct_edit_references = list(dict.fromkeys(
            image for image in reference_images if image
        ))
        if direct_image_request and not direct_edit_references and product_image_base64:
            direct_edit_references = [product_image_base64]
        style_reference_candidates = list(dict.fromkeys([
            *style_reference_images,
            *[
                image for image in reference_images
                if image and image != product_image_base64 and not region_edit_requested
            ],
        ]))

        # pipeline.py records the raw turn before architecture dispatch. Keep
        # memory user-visible and prevent internal routing markers from being
        # replayed into later LLM calls.
        if getattr(memory, "recent_chat", None):
            last_turn = memory.recent_chat[-1]
            if last_turn.get("role") == "user" and last_turn.get("content") == message:
                last_turn["content"] = clean_message

        # Hydrate CanvasState from AgentMemory (existing layers/images)
        _hydrate_canvas_from_memory(canvas, memory, self._canvas, cid)

        # UI modes are observations for the Agent, never execution switches.
        # The DECIDE phase remains the only place that may choose an Action.
        request_hints = {
            "product_set_requested": bool(product_set_mode),
            "style_transfer_requested": bool(style_transfer_mode),
            "has_product_image": bool(product_image_base64),
            "has_style_reference": bool(style_reference_images),
            "has_untyped_reference": bool(reference_images),
            "reference_attachment_count": len(style_reference_candidates),
            "direct_image_request": direct_image_request,
            "region_edit_requested": region_edit_requested,
            "edit_reference_count": len(direct_edit_references),
        }
        received_references = list(dict.fromkeys([
            *style_reference_images,
            *reference_images,
        ]))
        if received_references:
            logger.info(
                "[Agent Reference] received explicit_style=%s untyped=%s total=%s",
                len(style_reference_images),
                len(reference_images),
                len(received_references),
            )
            yield {
                "event": "reference_received",
                "explicit_style_count": len(style_reference_images),
                "untyped_count": len(reference_images),
                "total_count": len(received_references),
            }

        if direct_image_request and direct_edit_references and is_attachment_receipt_question(clean_message):
            image_label = "框选图" if region_edit_requested else "图片附件"
            acknowledgment = (
                f"已收到 {len(direct_edit_references)} 张{image_label}，"
                "图片已进入本轮 Agent 上下文。你可以直接告诉我要修改的内容。"
            )
            yield {"event": "agent_message", "agent": "agent", "text": acknowledgment}
            memory.add_chat_turn("assistant", acknowledgment)
            _sync_canvas_to_memory(canvas, memory)
            yield {"event": "memory_updated", "agent_memory": memory.to_dict()}
            yield {"event": "canvas_queried", "current_images": memory.current_images, "stitch_regions": memory.stitch_regions}
            yield {"event": "done"}
            return

        # ============================================
        # PHASE 1: SENSE
        # ============================================
        yield {"event": "agent_thinking", "phase": "sense", "iteration": 0}

        if region_edit_requested and direct_edit_references:
            # A frame drawn by the user already supplies edit target, scope and
            # source image. Model-based requirement extraction adds latency and
            # can only lose authoritative UI state, so SENSE assembles the brief
            # deterministically for this narrow interaction contract.
            design_brief = DesignBrief(
                subject=getattr(memory, "product_name", ""),
                use_case=getattr(memory, "ecom_platform", "") or "ecommerce",
                style_hint=getattr(memory, "style_preference", ""),
                platform=getattr(memory, "ecom_platform", ""),
                target_country=getattr(memory, "target_country", ""),
                aspect_ratio=getattr(memory, "aspect_ratio", "1:1"),
                image_types=getattr(memory, "image_types", []),
                selling_points=getattr(memory, "selling_points", ""),
                color_palette=getattr(memory, "color_palette", []),
                raw_message=clean_message,
                reference_image_refs=[],
            )
            enriched_ctx = EnrichedContext(design_brief=design_brief)
            clarification_needed = False
        else:
            design_brief, enriched_ctx, clarification_needed = await self._sense(
                clean_message, memory, product_image_base64, rag_retriever, request_hints
            )

        # An attached edit image is authoritative input. Do not ask the user to
        # re-upload it or provide coordinates that are already encoded by the box.
        if direct_image_request and direct_edit_references:
            clarification_needed = False

        # If clarification is needed, yield questions and return
        if clarification_needed:
            from agent.intent.clarifier import generate_clarification_questions

            questions = (
                enriched_ctx.clarification_questions
                or generate_clarification_questions(design_brief)
            )[:3]
            clarification_text = "在开始之前，我需要确认几个信息：\n" + "\n".join(
                f"{i+1}. {q}" for i, q in enumerate(questions)
            )
            yield {
                "event": "agent_message",
                "agent": "agent",
                "text": clarification_text,
            }
            # The exact question is required to resolve short replies such as
            # “要的/是/不用”. A generic placeholder loses the referent and
            # forces another clarification/model round.
            memory.add_chat_turn("assistant", clarification_text)
            _sync_canvas_to_memory(canvas, memory)
            yield {"event": "memory_updated", "agent_memory": memory.to_dict()}
            yield {"event": "canvas_queried", "current_images": memory.current_images, "stitch_regions": memory.stitch_regions}
            yield {"event": "done"}
            return

        # Safety check
        from agent.intent.safety_filter import safety_check

        safety_result = await safety_check(clean_message)
        if not safety_result.passed:
            yield {
                "event": "error",
                "message": f"内容安全检查未通过: {safety_result.blocked_reason}",
            }
            yield {"event": "done"}
            return

        # ============================================
        # PHASE 2-4: DECIDE → ACT → REVIEW loop
        # ============================================
        generated_images: dict[str, str] = {}
        all_prompts: dict[str, str] = {}
        all_evaluations: dict[str, list[dict[str, Any]]] = {}
        retry_counts: dict[str, int] = {}
        action_failures: list[dict[str, Any]] = []

        iteration = 0
        last_action = ""
        last_layer_id = ""
        has_product_image = bool(product_image_base64)

        while iteration < MAX_ITERATIONS:
            iteration += 1

            yield {
                "event": "agent_thinking",
                "phase": "decide",
                "iteration": iteration,
                "max_iterations": MAX_ITERATIONS,
            }

            # Safety push at warning threshold
            if iteration >= WARNING_THRESHOLD:
                yield {
                    "event": "agent_message",
                    "agent": "agent",
                    "text": f"已达到 {iteration} 轮，正在完成当前任务...",
                }

            # ============================================
            # PHASE 2: DECIDE
            # ============================================
            try:
                decision = await self._decide(
                    design_brief=design_brief,
                    enriched_ctx=enriched_ctx,
                    canvas=canvas,
                    memory=memory,
                    generated_images=generated_images,
                    retry_counts=retry_counts,
                    last_action=last_action,
                    iteration=iteration,
                    product_image_base64=product_image_base64 if iteration == 1 else "",
                    has_product_image=has_product_image,
                    request_hints=request_hints,
                    action_failures=action_failures,
                )
            except Exception as error:
                logger.error("[Agent Decide] unavailable after model fallbacks: %s", error)
                yield {
                    "event": "error",
                    "code": "AGENT_DECISION_UNAVAILABLE",
                    "retryable": True,
                    "message": "Agent 决策模型暂时不可用，任务和画布已保留，请重试本轮。",
                }
                yield {"event": "memory_updated", "agent_memory": memory.to_dict()}
                yield {"event": "done"}
                return

            action_name = decision.get("action", "")
            action_params_raw = decision.get("params", {})
            if not isinstance(action_params_raw, dict):
                action_params_raw = {}
            reasoning = decision.get("reasoning", "")
            if iteration == 1 and isinstance(decision.get("plan"), dict):
                memory.design_plan = decision["plan"]
                yield {"event": "design_plan", "design_plan": decision["plan"]}

            # Check if the LLM wants to finish
            if action_name == "finish" or action_name == "finish_task":
                summary = action_params_raw.get("summary", reasoning or "任务完成")
                avg_scores = _compute_average_scores(all_evaluations)
                yield {
                    "event": "agent_message",
                    "agent": "agent",
                    "text": summary[:500],
                }
                yield {
                    "event": "image_done",
                    "all_images": generated_images,
                    "all_prompts": all_prompts,
                    "average_scores": avg_scores,
                }
                memory.add_chat_turn("assistant", summary[:500])
                _sync_canvas_to_memory(canvas, memory)
                yield {"event": "memory_updated", "agent_memory": memory.to_dict()}
                yield {"event": "canvas_queried", "current_images": memory.current_images, "stitch_regions": memory.stitch_regions}
                yield {"event": "done"}
                return

            # Check if LLM wants to chat (no action needed)
            if not action_name or action_name == "chat":
                # Prefer params.text (chat response body), fallback to reasoning
                chat_text = action_params_raw.get("text", "") or action_params_raw.get("message", "") or reasoning
                if chat_text:
                    yield {
                        "event": "agent_message",
                        "agent": "agent",
                        "text": chat_text[:500],
                    }
                if not generated_images:
                    memory.add_chat_turn("assistant", chat_text[:500])
                    _sync_canvas_to_memory(canvas, memory)
                    yield {"event": "memory_updated", "agent_memory": memory.to_dict()}
                    yield {"event": "canvas_queried", "current_images": memory.current_images, "stitch_regions": memory.stitch_regions}
                    yield {"event": "done"}
                    return
                continue

            # Validate action is registered
            try:
                handler = get_action(action_name)
            except KeyError:
                failure = {
                    "action": action_name,
                    "error": f"未知动作，可用动作：{list_actions()}",
                    "params": action_params_raw,
                    "iteration": iteration,
                }
                action_failures.append(failure)
                yield {"event": "action_failed", **failure, "will_retry": True}
                continue

            yield {
                "event": "agent_tool_start",
                "tool": action_name,
                "args": action_params_raw,
                "iteration": iteration,
            }

            # ============================================
            # PHASE 3: ACT
            # ============================================
            yield {"event": "agent_thinking", "phase": "act", "iteration": iteration}

            if action_name == "generate_layer" and region_edit_requested:
                action_params_raw["prompt"] = build_seedream_edit_prompt(
                    action_params_raw.get("prompt") or clean_message,
                    region_edit=True,
                )

            # Inject extra config into params for handlers that need it
            action_config = {
                **action_params_raw,
                "image_model_key": self._image_config.get("api_key", ""),
                "aspect_ratio": action_params_raw.get("aspect_ratio") or getattr(memory, "aspect_ratio", "1:1"),
                "negative_prompt": getattr(memory, "negative_prompt", "低画质、变形肢体、模糊、水印"),
                "size_doubao": self._image_config.get("size", "1920x1920"),
                "rag_retriever": rag_retriever,
                "product_image": product_image_base64,
                "reference_images": (
                    direct_edit_references
                    if direct_image_request
                    else ([product_image_base64] if product_image_base64 else [])
                ),
                "style_reference_images": style_reference_candidates,
                "multimodal_config": self._multimodal_config,
                "product_name": action_params_raw.get("product_name") or design_brief.subject,
                "selling_points": action_params_raw.get("selling_points") or design_brief.selling_points,
                "style_preference": action_params_raw.get("style_preference") or design_brief.style_hint,
                "image_types": action_params_raw.get("image_types") or design_brief.image_types,
            }
            action_params = ActionParams(
                action=action_name,
                **{k: v for k, v in action_config.items() if k != "action"},
            )

            try:
                result = await handler(action_params, canvas)
            except Exception as error:
                logger.exception("[Agent Act] action %s crashed", action_name)
                result = ActionResult(
                    success=False,
                    error=f"Action execution error: {type(error).__name__}",
                )

            if not result.success:
                failure = {
                    "action": action_name,
                    "error": result.error or "工具未返回有效结果",
                    "params": action_params_raw,
                    "iteration": iteration,
                }
                action_failures.append(failure)
                retry_counts[action_name] = retry_counts.get(action_name, 0) + 1
                yield {"event": "action_failed", **failure, "will_retry": True}
                yield {
                    "event": "agent_message",
                    "agent": "agent",
                    "text": "工具参数或执行结果不完整，Agent 正在根据反馈修正计划。",
                }
                if retry_counts[action_name] >= 3:
                    yield {
                        "event": "error",
                        "code": "ACTION_REPAIR_EXHAUSTED",
                        "retryable": True,
                        "message": f"Agent 连续修正 {action_name} 仍未成功，任务状态已保留。",
                    }
                    yield {"event": "memory_updated", "agent_memory": memory.to_dict()}
                    yield {"event": "done"}
                    return
                last_action = action_name
                continue

            # Update canvas state with result
            data = result.data

            # Handle search_knowledge — yield knowledge_found event and inject into context
            if action_name == "search_knowledge":
                if data.get("results"):
                    yield {
                        "event": "knowledge_found",
                        "results_count": data.get("results_count", 0),
                        "context": data.get("context", "")[:300],
                    }
                    # Inject results into enriched context for subsequent DECIDE rounds
                    enriched_ctx.rag_context += "\n" + (data.get("context", "")[:500])
                last_action = action_name
                continue

            if action_name == "reverse_image_prompt":
                reverse_prompt = data.get("reverse_prompt") or {}
                message = (
                    "图片提示词已反推完成。\n\n"
                    f"中文 Prompt：{reverse_prompt.get('prompt_cn', '')}\n\n"
                    f"English Prompt：{reverse_prompt.get('prompt_en', '')}\n\n"
                    f"Negative Prompt：{reverse_prompt.get('negative_prompt', '')}"
                )
                yield {"event": "reverse_prompt_result", "result": reverse_prompt, "message": message}
                yield {"event": "agent_message", "agent": "agent", "text": message}
                memory.add_chat_turn("assistant", message)
                yield {"event": "memory_updated", "agent_memory": memory.to_dict()}
                yield {"event": "done"}
                return

            if action_name == "plan_video_edit":
                plan = data.get("video_edit_plan") or {}
                message = data.get("message") or "剪辑方案已准备好，请选择视频素材后执行。"
                yield {"event": "video_edit_plan", "plan": plan, "message": message}
                yield {"event": "agent_message", "agent": "agent", "text": message}
                memory.add_chat_turn("assistant", message)
                yield {"event": "memory_updated", "agent_memory": memory.to_dict()}
                yield {"event": "done"}
                return

            if action_name == "plan_viral_replication":
                plan = data.get("viral_replication_plan") or {}
                message = data.get("message") or "爆款结构复刻工作台已准备好。"
                yield {"event": "viral_replication_plan", "plan": plan, "message": message}
                yield {"event": "agent_message", "agent": "agent", "text": message}
                memory.add_chat_turn("assistant", message)
                yield {"event": "memory_updated", "agent_memory": memory.to_dict()}
                yield {"event": "done"}
                return

            if "url" in data:
                img_url = data["url"]
                prompt = data.get("prompt", "")
                layer_type = data.get("layer_type", "subject")

                # Create or update layer in canvas
                layer_id = data.get("layer_id") or action_params_raw.get("layer_id", "")

                if layer_id and canvas.get_layer(layer_id):
                    canvas = self._canvas.update_layer(
                        cid, layer_id,
                        {"asset_ref": img_url, "prompt_used": prompt, "status": "ready"},
                    )
                else:
                    canvas = self._canvas.create_layer(
                        cid,
                        layer_type=layer_type,
                        asset_ref=img_url,
                        prompt_used=prompt,
                        status="ready",
                        style_tags=data.get("style_tags", []),
                    )
                    # Get the newly created layer's id
                    layer_id = canvas.layers[-1].id

                last_layer_id = layer_id

                # Track for frontend
                img_type = layer_type or "main"
                generated_images[img_type] = img_url
                all_prompts[img_type] = prompt

                # Update memory via formal sync
                if hasattr(memory, "record_generation"):
                    memory.record_generation(img_type, prompt, img_url, 0)
                _sync_canvas_to_memory(canvas, memory)

                yield {
                    "event": "image_progress",
                    "image_type": img_type,
                    "url": img_url,
                    "prompt": prompt,
                    "layer_id": layer_id,
                }

            # Batch Actions return a typed image map. The Agent still owns the
            # next decision (review/finish); the handler only executes tools.
            if isinstance(data.get("images"), dict):
                batch_prompts = data.get("prompts", {}) or {}
                requested_image_types = action_config.get("image_types") or list(data["images"])
                memory.image_types = [
                    image_type for image_type in requested_image_types
                    if image_type in {"main", "selling_point", "detail"}
                ]
                for image_type, image_url in data["images"].items():
                    prompt = batch_prompts.get(image_type, "")
                    canvas = self._canvas.create_layer(
                        cid,
                        layer_type="subject",
                        asset_ref=image_url,
                        prompt_used=prompt,
                        status="ready",
                    )
                    generated_images[image_type] = image_url
                    all_prompts[image_type] = prompt
                    if hasattr(memory, "record_generation"):
                        memory.record_generation(image_type, prompt, image_url, 0)
                    yield {
                        "event": "image_progress",
                        "image_type": image_type,
                        "url": image_url,
                        "prompt": prompt,
                    }
                if action_name == "style_transfer_batch":
                    memory.reference_images_intent = "style_transfer"
                    memory.vlm_style_analysis = data.get("style_analysis") or None
                _sync_canvas_to_memory(canvas, memory)

            # Create version in version tree
            self._versions.create_version(canvas, f"{action_name}: {reasoning[:100]}")

            # ============================================
            # PHASE 4: REVIEW
            # ============================================
            yield {"event": "agent_thinking", "phase": "review", "iteration": iteration}

            review_result = await self._review(
                canvas=canvas,
                design_brief=design_brief,
                action_name=action_name,
                last_layer_id=last_layer_id,
                data=data,
            )

            if review_result:
                yield {
                    "event": "evaluation_progress",
                    "image_type": data.get("layer_type", "main"),
                    "status": "evaluated",
                    "score": review_result.overall_score,
                    "passed": review_result.passed,
                    "issues": review_result.issues,
                    "suggestions": review_result.suggestions,
                }

                if review_result.passed:
                    # Record evaluation
                    eval_key = data.get("layer_type", "main")
                    if eval_key not in all_evaluations:
                        all_evaluations[eval_key] = []
                    all_evaluations[eval_key].append({
                        "overall_score": review_result.overall_score,
                        "passed": review_result.passed,
                        "issues": review_result.issues,
                    })

                    if region_edit_requested and generated_images:
                        avg_scores = _compute_average_scores(all_evaluations)
                        yield {
                            "event": "image_done",
                            "all_images": generated_images,
                            "all_prompts": all_prompts,
                            "average_scores": avg_scores,
                        }
                        completion_text = "已完成框选区域修改，框外画面保持不变。"
                        yield {"event": "agent_message", "agent": "agent", "text": completion_text}
                        memory.add_chat_turn("assistant", completion_text)
                        _sync_canvas_to_memory(canvas, memory)
                        yield {"event": "memory_updated", "agent_memory": memory.to_dict()}
                        yield {"event": "canvas_queried", "current_images": memory.current_images, "stitch_regions": memory.stitch_regions}
                        yield {"event": "done"}
                        return

                    # If all needed image types are generated, finish
                    image_types_needed = getattr(memory, "image_types", [])
                    if image_types_needed and all(
                        t in generated_images for t in image_types_needed
                    ):
                        avg_scores = _compute_average_scores(all_evaluations)
                        yield {
                            "event": "image_done",
                            "all_images": generated_images,
                            "all_prompts": all_prompts,
                            "average_scores": avg_scores,
                        }
                        memory.add_chat_turn("assistant", "所有图片已生成完成")
                        _sync_canvas_to_memory(canvas, memory)
                        yield {"event": "memory_updated", "agent_memory": memory.to_dict()}
                        yield {"event": "canvas_queried", "current_images": memory.current_images, "stitch_regions": memory.stitch_regions}
                        yield {"event": "done"}
                        return
                else:
                    # Decide retry
                    retry_key = data.get("layer_type", "main")
                    current_retries = retry_counts.get(retry_key, 0)

                    from agent.review.retry_logic import decide_retry

                    retry_decision = await decide_retry(review_result, current_retries)

                    if retry_decision.should_retry:
                        retry_counts[retry_key] = current_retries + 1
                        # Feed diagnostic back into the next decide iteration
                        enriched_ctx.memory_context += (
                            f"\n[Review] {retry_decision.reason}"
                        )
                        yield {
                            "event": "agent_message",
                            "agent": "agent",
                            "text": f"正在优化: {retry_decision.reason}",
                        }
                        continue
                    else:
                        # Max retries — accept current result
                        yield {
                            "event": "agent_message",
                            "agent": "agent",
                            "text": f"已达到最大重试次数，当前结果: score={review_result.overall_score}",
                        }

            last_action = action_name
            await asyncio.sleep(0.05)

        # ── Max iterations reached ──
        if generated_images:
            avg_scores = _compute_average_scores(all_evaluations)
            yield {
                "event": "image_done",
                "all_images": generated_images,
                "all_prompts": all_prompts,
                "average_scores": avg_scores,
                "warning": f"Agent 达到最大迭代次数 ({MAX_ITERATIONS})",
            }
            memory.add_chat_turn("assistant", "图片已生成完成")
            _sync_canvas_to_memory(canvas, memory)
            yield {"event": "memory_updated", "agent_memory": memory.to_dict()}
            yield {"event": "canvas_queried", "current_images": memory.current_images, "stitch_regions": memory.stitch_regions}
            yield {"event": "done"}
        else:
            yield {
                "event": "error",
                "message": f"Agent 在 {MAX_ITERATIONS} 轮内未能生成任何图片",
            }

    # ================================================================
    # Phase implementations
    # ================================================================

    async def _sense(
        self,
        message: str,
        memory: Any,
        product_image_base64: str,
        rag_retriever: Any,
        request_hints: dict[str, Any] | None = None,
    ) -> tuple[DesignBrief, EnrichedContext, bool]:
        """Phase 1: SENSE — model-based goal and slot understanding."""
        from agent.intent.context_assembler import assemble_context

        understanding: dict[str, Any] = {}
        try:
            understanding = await self._call_sense_llm(message, memory, request_hints or {})
        except Exception as error:
            # This does not choose a business action. DECIDE remains model-owned
            # and will return a retryable error if all model fallbacks are down.
            logger.warning("[Agent Sense] understanding unavailable: %s", error)

        slots = understanding.get("slots", {}) if isinstance(understanding.get("slots"), dict) else {}
        for field in (
            "product_name", "selling_points", "style_preference", "ecom_platform",
            "target_country", "aspect_ratio", "image_types", "color_palette",
        ):
            value = slots.get(field)
            if value not in (None, "", []):
                setattr(memory, field, value)
        intent_value = understanding.get("intent", "")
        try:
            intent = IntentType(intent_value)
        except ValueError:
            intent = IntentType.NEW_DESIGN if product_image_base64 else IntentType.CHITCHAT
        memory.last_intent = intent.value

        # Build design brief from message and memory
        brief = DesignBrief(
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
            reference_image_refs=[_as_data_url(product_image_base64)] if product_image_base64 else [],
        )

        # RAG context
        rag_context = ""
        if rag_retriever is not None and brief.subject:
            try:
                result = await rag_retriever.retrieve_multi_category(
                    query=f"{brief.subject} {brief.style_hint}",
                    categories=["prompt_template", "style_guide"],
                    top_k_per_category=2,
                )
                rag_context = result.context[:500] if result.context else ""
            except Exception:
                pass

        # Brand context
        brand_context = ""
        if hasattr(memory, "brand_name") and memory.brand_name:
            from agent_service.config import _build_brand_context
            brand_context = _build_brand_context({
                "brand_name": memory.brand_name,
                "style": getattr(memory, "brand_style", ""),
            })

        # Assemble enriched context
        enriched_ctx = await assemble_context(
            brief=brief,
            memory=memory,
            brand_context=brand_context,
            rag_context=rag_context,
        )
        enriched_ctx.clarification_questions = [
            str(question).strip()
            for question in (understanding.get("clarification_questions") or [])
            if str(question).strip()
        ][:3]

        clarification_needed = bool(understanding.get("needs_clarification", False))

        return brief, enriched_ctx, clarification_needed

    async def _decide(
        self,
        design_brief: DesignBrief,
        enriched_ctx: EnrichedContext,
        canvas: CanvasState,
        memory: Any,
        generated_images: dict[str, str],
        retry_counts: dict[str, int],
        last_action: str,
        iteration: int,
        product_image_base64: str = "",
        has_product_image: bool = False,
        request_hints: dict[str, Any] | None = None,
        action_failures: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Phase 2: DECIDE — LLM selects the next action from the registry."""
        hints = request_hints or {}
        if (
            hints.get("direct_image_request")
            and hints.get("region_edit_requested")
            and hints.get("edit_reference_count", 0) > 0
        ):
            # This is an Agent harness policy, not keyword routing: the UI event
            # proves the user selected a bounded image-edit action. Asking an LLM
            # to rediscover the tool adds cost, latency and a failure point.
            return {
                "plan": {
                    "goal": "修改用户框选的图片区域",
                    "steps": ["读取框选图", "执行局部图像编辑", "审查结果"],
                    "completion_criteria": ["框内问题已修复", "框外画面保持不变"],
                },
                "action": "generate_layer",
                "params": {
                    "layer_type": "subject",
                    "prompt": design_brief.raw_message,
                    "style_tags": [],
                },
                "reasoning": "用户已通过框选图明确编辑范围，直接执行图像编辑。",
            }
        available_actions = list_actions()
        # Tool discovery is capability-aware. A style-transfer action cannot
        # run without an explicit style reference, so do not advertise it to
        # DECIDE and then spend another model round repairing an impossible
        # choice. This is a runtime tool precondition, not intent routing.
        if not hints.get("reference_attachment_count", 0):
            available_actions = [
                action for action in available_actions
                if action != "style_transfer_batch"
            ]
        action_descriptions = {
            "generate_layer": "生成一个新图层图片。params: layer_type (subject/background/text/decoration), prompt (英文), style_tags",
            "layout_suggest": "AI建议图层布局。params: image_types (图片类型列表)",
            "search_knowledge": "搜索RAG知识库获取 prompt 模板/风格指南/平台规则。params: query (搜索词), categories (分类列表，可选: prompt_template, style_guide, platform_rule, copywriting)",
            "generate_product_set": "基于商品原图生成一组电商图片，可用于A+/详情页、主图、卖点图和续作。必填 params.image_types，值只能从 main、selling_point、detail 中选择；可选 product_name、selling_points、style_preference",
            "style_transfer_batch": "需要商品图和明确上传的风格参考图；把参考图的视觉语言迁移到新商品。必填 params.image_types，值只能从 main、selling_point、detail 中选择；可选 product_name、selling_points",
            "plan_video_edit": "为视频裁剪、拼接、横竖屏转换、文字叠加、淡入淡出和背景音乐生成结构化剪辑方案。参数可含 aspect_ratio、clips、overlay_text、text_position、original_volume、music_volume、fade、fps；该动作不生成图片",
            "plan_viral_replication": "打开爆款结构复刻工作台。用于上传不超过60秒的参考视频，拆解钩子、节奏、镜头结构和CTA，再用新商品素材原创复刻。参数可含 strength(light/medium/high)。",
            "reverse_image_prompt": "使用多模态模型从已上传图片反推可见主体、构图、镜头、光线、配色和原创生图提示词。参数可含 composition_preference。",
        }

        # Build decide prompt
        system_prompt = self._build_decide_prompt(available_actions, action_descriptions)

        # Build context
        context_parts = [
            f"## 用户需求\n{design_brief.raw_message}",
            f"\n## 设计概要\n- 产品: {design_brief.subject}",
            f"- 风格: {design_brief.style_hint or '未指定'}",
            f"- 平台: {design_brief.platform or '未指定'}",
            f"- 图片类型: {design_brief.image_types or '未指定'}",
            f"- 卖点: {design_brief.selling_points or '未指定'}",
        ]

        if enriched_ctx.memory_context:
            context_parts.append(f"\n## 任务状态\n{enriched_ctx.memory_context}")
        if enriched_ctx.rag_context:
            context_parts.append(f"\n## 知识库参考\n{enriched_ctx.rag_context[:300]}")
        if enriched_ctx.brand_context:
            context_parts.append(f"\n{enriched_ctx.brand_context}")
        if getattr(memory, "design_plan", None):
            context_parts.append(
                "\n## 当前任务计划\n"
                + json.dumps(memory.design_plan, ensure_ascii=False)
            )
        if action_failures:
            context_parts.append(
                "\n## Action 执行反馈（必须修正，不能直接 finish）\n"
                + json.dumps(action_failures[-3:], ensure_ascii=False)
            )

        # Canvas state summary
        layer_summary = []
        for layer in canvas.layers:
            layer_summary.append(
                f"  [{layer.id}] {layer.type} z={layer.z_index} status={layer.status}"
            )
        context_parts.append(
            f"\n## 当前画布 (version={canvas.version})\n" +
            ("\n".join(layer_summary) if layer_summary else "  空画布，无图层")
        )

        # Generated so far
        if generated_images:
            context_parts.append(
                f"\n## 已生成图片\n" +
                "\n".join(f"  - {t}: {url[:80]}..." for t, url in generated_images.items())
            )

        # Product image (user uploaded reference)
        if has_product_image:
            context_parts.append(
                "\n## 用户上传了产品参考图\n"
                "图片已作为多模态输入提供给本决策。请根据图片内容确定产品特征、颜色、形状等。"
            )
        if request_hints:
            context_parts.append(
                "\n## 界面提供的输入事实（仅供决策，不是执行指令）\n"
                + json.dumps(request_hints, ensure_ascii=False)
            )

        context = "\n".join(context_parts)

        # DECIDE selects a tool from structured state; it does not need to
        # re-read the full-resolution product image. The product image remains
        # available to ACT as the authoritative generation reference. Avoiding
        # a redundant multimodal call materially reduces time-to-first-action.
        return await self._call_decide_llm(
            system_prompt, context,
            product_image_base64="",
            memory=memory,
        )

    async def _review(
        self,
        canvas: CanvasState,
        design_brief: DesignBrief,
        action_name: str,
        last_layer_id: str,
        data: dict[str, Any],
    ) -> ReviewResult | None:
        """Phase 4: REVIEW — local for single layer, global for compose."""
        if action_name in ("generate_product_set", "style_transfer_batch") and data.get("images"):
            from agent.review.local_review import review_layer_quality

            reviews = []
            for image_type, image_url in data["images"].items():
                layer = next((item for item in reversed(canvas.layers) if item.asset_ref == image_url), None)
                if layer is None:
                    continue
                reviews.append(await review_layer_quality(
                    layer=layer,
                    image_url=image_url,
                    prompt_used=(data.get("prompts", {}) or {}).get(image_type, ""),
                    vision_config=self._review_config,
                ))
            if reviews:
                return ReviewResult(
                    passed=all(review.passed for review in reviews),
                    overall_score=sum(review.overall_score for review in reviews) / len(reviews),
                    local_score=sum(review.local_score for review in reviews) / len(reviews),
                    scores={},
                    issues=[issue for review in reviews for issue in review.issues],
                    suggestions=[suggestion for review in reviews for suggestion in review.suggestions],
                )

        # Skip review for non-generative actions
        if action_name in ("layout_suggest", "remove_background", "upscale"):
            return None

        # For compose: must do global review
        if action_name == "compose":
            from agent.review.global_review import review_composition

            return await review_composition(canvas, design_brief, self._review_config)

        # For generate_layer: do local review
        if action_name == "generate_layer" and "url" in data:
            layer = canvas.get_layer(last_layer_id)
            if layer is None:
                return None

            from agent.review.local_review import review_layer_quality

            return await review_layer_quality(
                layer=layer,
                image_url=data["url"],
                prompt_used=data.get("prompt", ""),
                vision_config=self._review_config,
            )

        # For inpaint: do local review
        if action_name == "inpaint_region" and "url" in data:
            layer = canvas.get_layer(last_layer_id)
            if layer is None:
                return None

            from agent.review.local_review import review_layer_quality

            return await review_layer_quality(
                layer=layer,
                image_url=data["url"],
                prompt_used=data.get("prompt", ""),
                vision_config=self._review_config,
            )

        return None

    # ================================================================
    # LLM helpers
    # ================================================================

    async def _call_sense_llm(
        self,
        message: str,
        memory: Any,
        request_hints: dict[str, Any],
    ) -> dict[str, Any]:
        """Use the Agent model to understand the goal and update task slots."""
        _agent_service_dir = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "..", "backend", "agent_service"),
        )
        if _agent_service_dir not in sys.path:
            sys.path.insert(0, _agent_service_dir)
        from chat_client import execute_chat_with_fallbacks, get_chat_fallback_configs
        from config import clean_json_string

        memory_context = memory.build_llm_context() if hasattr(memory, "build_llm_context") else ""
        system_prompt = (
            "你是电商视觉 Agent 的 SENSE 模块。理解用户当前目标，并结合持续任务记忆提取本轮变化。"
            "不要选择工具，不要生成图片，不要用关键词机械匹配。返回严格 JSON："
            '{"intent":"new_design|continue_generation|style_transfer|edit_layer|upload_reference|clarification|chitchat",'
            '"goal":"一句话目标","slots":{"product_name":"","selling_points":"","style_preference":"",'
            '"ecom_platform":"","target_country":"","aspect_ratio":"","image_types":[],"color_palette":[]},'
            '"needs_clarification":false,"clarification_questions":[]}。'
            "只提取用户明确表达或上下文能可靠确定的字段；续作必须保留未改变的历史字段。"
            "只有缺失信息会实质改变结果时才提问，最多3个问题。"
        )
        user_prompt = (
            f"当前任务记忆：\n{memory_context or '无'}\n\n"
            f"界面输入事实：\n{json.dumps(request_hints, ensure_ascii=False)}\n\n"
            f"用户本轮消息：\n{message}"
        )
        primary_config = {
            "protocol": "openai",
            "api_key": self._chat_config.get("api_key", ""),
            "base_url": self._chat_config.get("base_url", "https://api.deepseek.com/v1"),
            "model": self._chat_config.get("model", "deepseek-chat"),
            "timeout_seconds": 20,
            "retry_attempts": 1,
        }
        fallback_configs = self._chat_fallback_chain(get_chat_fallback_configs())

        def validate_understanding(response: str) -> dict[str, Any]:
            parsed = json.loads(clean_json_string(response))
            if not isinstance(parsed, dict):
                raise ValueError("Agent sense response must be a JSON object")
            return parsed

        parsed = await execute_chat_with_fallbacks(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            primary_config,
            fallback_configs,
            response_validator=validate_understanding,
        )
        return parsed

    def _build_decide_prompt(
        self,
        available_actions: list[str],
        action_descriptions: dict[str, str],
    ) -> str:
        """Build the system prompt for the decide phase."""
        action_list = "\n".join(
            f"- **{name}**: {action_descriptions.get(name, '')}"
            for name in available_actions
        )

        return (
            "你是一个电商商品图设计决策Agent。根据当前画布状态和用户需求，选择下一步动作。\n\n"
            "## 可用动作\n"
            f"{action_list}\n"
            "- **finish**: 所有图片已生成完毕，结束任务。params: summary (中文摘要)\n"
            "- **chat**: 需要和用户对话（询问信息、回答闲聊等）。params: text (中文回复文本)\n\n"
            "## 决策规则\n"
            "1. 如果画布为空且用户需要生成图片 → generate_layer (subject)\n"
            "2. A+/详情页、商品套图、沿用商品继续生成 → generate_product_set；由 image_types 指定输出类型\n"
            "3. 有风格参考图且目标是风格迁移 → style_transfer_batch\n"
            "4. 用户要求剪辑、拼接、转码或制作已有素材视频 → plan_video_edit\n"
            "5. 用户明确要求复刻爆款视频、参考视频结构或同款视频节奏 → plan_viral_replication\n"
            "6. 用户明确要求看图反推、提取或生成提示词 → reverse_image_prompt\n"
            "   未标注用途的参考附件不是自动风格迁移指令；结合用户目标判断。用户明确说“按这个风格”等且有参考附件时，可将其作为风格参考。\n"
            "7. 单张自由创作或单图编辑 → generate_layer，并使用商品原图作为 reference_images\n"
            "8. Action 返回图片后，结合目标和当前结果决定继续、审查或 finish\n"
            "9. 如果用户信息不足 → chat 询问；用户闲聊 → chat 回复\n"
            "10. 不要连续执行无进展的相同动作，检查重试次数避免死循环\n"
            "11. 用户上传的商品图是商品身份唯一真源，不得替换或虚构商品特征\n"
            "12. 对 prompt 或平台规则不确定时，可先 search_knowledge\n"
            "13. 收到 Action 执行反馈时，必须修正 params 后重新调用；未生成目标图片前禁止 finish\n\n"
            "14. 界面输入事实中的附件数量是后端已接收的权威事实；数量大于0时禁止回复‘未收到图片’或要求重新上传\n"
            "15. region_edit_requested=true 且用户提出修改要求时，选择 generate_layer；框选图已包含位置，不得再次询问坐标或图层\n\n"
            "## 输出格式\n"
            "返回严格的JSON对象（不要markdown包裹）：\n"
            '{"plan":{"goal":"目标","steps":["步骤"],"completion_criteria":["标准"]},'
            '"action":"动作名","params":{...},"reasoning":"简短中文说明"}\n'
        )

    async def _call_decide_llm(
        self,
        system_prompt: str,
        context: str,
        product_image_base64: str = "",
        memory: Any = None,
    ) -> dict[str, Any]:
        """Call the LLM for the decide phase. Uses the chat client's fallback chain.

        When product_image_base64 is provided, it is included as a multimodal
        image input so the LLM can see the user's uploaded product photo.

        When memory is provided, recent_chat[-4:] messages are inserted as
        independent multi-turn {role, content} pairs between system and current user.
        """
        _agent_service_dir = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "..", "backend", "agent_service"),
        )
        if _agent_service_dir not in sys.path:
            sys.path.insert(0, _agent_service_dir)

        from chat_client import execute_chat_with_fallbacks, get_chat_fallback_configs
        from config import clean_json_string

        # Build user content — include product image if provided
        user_content: Any = context
        if product_image_base64:
            user_content = [
                {"type": "text", "text": context},
                {
                    "type": "image_url",
                    "image_url": {
                        "url": _as_data_url(product_image_base64),
                        "detail": "auto",
                    },
                },
            ]

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
        ]

        # Insert recent chat history as independent multi-turn messages
        if memory and hasattr(memory, "recent_chat") and memory.recent_chat:
            for chat in memory.recent_chat[-4:]:
                messages.append({
                    "role": chat["role"],
                    "content": chat["content"][:500],
                })

        messages.append({"role": "user", "content": user_content})

        primary_config = {
            "protocol": "openai",
            "api_key": self._chat_config.get("api_key", ""),
            "base_url": self._chat_config.get("base_url", "https://api.deepseek.com/v1"),
            "model": self._chat_config.get("model", "deepseek-chat"),
        }

        primary_config.update({"timeout_seconds": 20, "retry_attempts": 1})
        fallback_configs = self._chat_fallback_chain(get_chat_fallback_configs())

        def validate_decision(response: str) -> dict[str, Any]:
            parsed = json.loads(clean_json_string(response))
            if not isinstance(parsed, dict):
                raise ValueError("Agent decision must be a JSON object")
            return parsed

        decision = await execute_chat_with_fallbacks(
            messages,
            primary_config,
            fallback_configs,
            response_validator=validate_decision,
        )
        params = decision.get("params")
        if not isinstance(params, dict):
            decision["params"] = {}
        elif isinstance(params.get("style_tags"), str):
            params["style_tags"] = [
                item.strip() for item in params["style_tags"].split(",") if item.strip()
            ]
        return decision


# ================================================================
# Module-level helpers
# ================================================================


def _as_data_url(image: str) -> str:
    """Normalize either a full data URL or raw base64 for multimodal calls."""
    if not image:
        return ""
    return image if image.startswith("data:image/") else f"data:image/png;base64,{image}"


def _hydrate_canvas_from_memory(
    canvas: CanvasState,
    memory: Any,
    canvas_mgr: Any,
    canvas_id: str,
) -> None:
    """Hydrate CanvasState with existing data from AgentMemory.

    Called at the start of each run() to populate the canvas with
    layers from previously generated images. Uses the formal
    sync_to_canvas_state() method on AgentMemory.
    """
    if not hasattr(memory, "sync_to_canvas_state"):
        return

    mem_data = memory.sync_to_canvas_state()
    current_images = mem_data.get("current_images", {})

    # Skip if no existing images to hydrate
    if not current_images:
        return

    # Create a layer for each existing image
    type_order = ["background", "subject", "text", "decoration"]
    for layer_type in type_order:
        if layer_type in current_images:
            asset_ref = current_images[layer_type]
            # Check if a layer with this asset already exists
            existing = any(
                l.asset_ref == asset_ref for l in canvas.layers
            )
            if not existing:
                canvas_mgr.create_layer(
                    canvas_id,
                    layer_type=layer_type,
                    asset_ref=asset_ref,
                    status="ready",
                )

    # Refresh local canvas reference
    updated = canvas_mgr.get_state(canvas_id)
    if updated:
        # Update global style from memory preferences
        style_pref = mem_data.get("style_preference", "")
        color_palette = mem_data.get("color_palette", [])
        from agent.models import GlobalStyle
        new_style = GlobalStyle(
            mood=style_pref if style_pref else None,
            primary_color=color_palette[0] if color_palette else None,
        )
        canvas_mgr._states[canvas_id] = updated.model_copy(
            update={"global_style": new_style}
        )


def _sync_canvas_to_memory(canvas: CanvasState, memory: Any) -> None:
    """Sync CanvasState layers back into AgentMemory via the formal bridge.

    Called before every memory_updated event to ensure the frontend
    always sees the authoritative canvas state.
    """
    if not hasattr(memory, "sync_from_canvas_state"):
        return

    canvas_dict = {
        "layers": [
            {
                "type": layer.type,
                "asset_ref": layer.asset_ref,
                "z_index": layer.z_index,
                "status": layer.status,
                "id": layer.id,
            }
            for layer in canvas.layers
            if layer.asset_ref
        ],
    }
    memory.sync_from_canvas_state(canvas_dict)


def _compute_average_scores(
    all_evaluations: dict[str, list[dict[str, Any]]],
) -> dict[str, float]:
    """Compute average review score per image type.

    Matches the old architecture's finish_task average_scores output.
    """
    avg_scores: dict[str, float] = {}
    for img_type, evals in all_evaluations.items():
        if evals:
            scores = [e.get("overall_score", 0) for e in evals]
            avg_scores[img_type] = sum(scores) / len(scores) if scores else 0
    return avg_scores
