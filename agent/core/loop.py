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

    # ================================================================
    # Public API
    # ================================================================

    async def run(
        self,
        message: str,
        memory: Any,  # AgentMemory
        product_image_base64: str = "",
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
        style_reference_images = style_reference_images or []

        # Hydrate CanvasState from AgentMemory (existing layers/images)
        _hydrate_canvas_from_memory(canvas, memory, self._canvas, cid)

        # A composer attachment is an explicit generation/edit command. Route
        # it straight to the image action so the Agent never asks requirement
        # questions or treats the image as analysis-only input.
        from agent.image_routing import (
            build_seedream_edit_prompt,
            parse_direct_image_request,
        )

        direct_image_agent, region_edit, clean_message = parse_direct_image_request(message)
        if style_transfer_mode and product_image_base64 and style_reference_images:
            yield {"event": "agent_thinking", "phase": "style_analysis", "iteration": 0}
            handler = get_action("style_transfer_batch")
            result = await handler(ActionParams(
                action="style_transfer_batch",
                product_image=product_image_base64,
                style_reference_images=style_reference_images,
                product_name=getattr(memory, "product_name", ""),
                selling_points=getattr(memory, "selling_points", ""),
                image_model_key=self._image_config.get("api_key", ""),
                negative_prompt=getattr(memory, "negative_prompt", ""),
                multimodal_config=self._multimodal_config,
            ), canvas)
            if not result.success:
                yield {"event": "error", "message": f"风格迁移失败: {result.error}"}
                yield {"event": "done"}
                return
            images = result.data.get("images", {})
            prompts = result.data.get("prompts", {})
            expected_types = ["main", "selling_point", "detail"]
            missing_types = [image_type for image_type in expected_types if image_type not in images]
            for image_type, image_url in images.items():
                canvas = self._canvas.create_layer(
                    cid, layer_type="subject", asset_ref=image_url,
                    prompt_used=prompts.get(image_type, ""), status="ready",
                )
                if hasattr(memory, "record_generation"):
                    memory.record_generation(image_type, prompts.get(image_type, ""), image_url, 0)
                yield {"event": "image_progress", "image_type": image_type, "url": image_url, "prompt": prompts.get(image_type, "")}
            memory.image_types = ["main", "selling_point", "detail"]
            memory.reference_images_intent = "style_transfer"
            memory.vlm_style_analysis = result.data.get("style_analysis") or None
            memory.add_chat_turn("assistant", "已按参考图风格生成主图、卖点图和详情图。")
            _sync_canvas_to_memory(canvas, memory)
            warning = f"以下图片生成失败，请重试：{', '.join(missing_types)}" if missing_types else ""
            yield {"event": "image_done", "all_images": images, "all_prompts": prompts, "average_scores": {}, "warning": warning}
            message_text = (
                "已完成风格迁移套图：主图、卖点图、详情图。"
                if not missing_types else
                f"已生成 {len(images)}/3 张；{', '.join(missing_types)} 生成失败，可点击生成风格套图重试。"
            )
            yield {"event": "agent_message", "agent": "agent", "text": message_text}
            yield {"event": "memory_updated", "agent_memory": memory.to_dict()}
            yield {"event": "done"}
            return
        if product_set_mode and product_image_base64:
            requested_types = [
                image_type for image_type in (getattr(memory, "image_types", []) or ["main", "selling_point", "detail"])
                if image_type in {"main", "selling_point", "detail"}
            ]
            yield {"event": "agent_thinking", "phase": "product_set_generation", "iteration": 0}
            handler = get_action("generate_product_set")
            result = await handler(ActionParams(
                action="generate_product_set",
                product_image=product_image_base64,
                image_types=requested_types,
                product_name=getattr(memory, "product_name", ""),
                selling_points=getattr(memory, "selling_points", ""),
                style_preference=getattr(memory, "style_preference", ""),
                image_model_key=self._image_config.get("api_key", ""),
                negative_prompt=getattr(memory, "negative_prompt", ""),
            ), canvas)
            if not result.success:
                yield {"event": "error", "message": f"商品套图生成失败: {result.error}"}
                yield {"event": "done"}
                return
            images = result.data.get("images", {})
            prompts = result.data.get("prompts", {})
            missing_types = [image_type for image_type in requested_types if image_type not in images]
            for image_type, image_url in images.items():
                canvas = self._canvas.create_layer(
                    cid, layer_type="subject", asset_ref=image_url,
                    prompt_used=prompts.get(image_type, ""), status="ready",
                )
                if hasattr(memory, "record_generation"):
                    memory.record_generation(image_type, prompts.get(image_type, ""), image_url, 0)
                yield {"event": "image_progress", "image_type": image_type, "url": image_url, "prompt": prompts.get(image_type, "")}
            memory.image_types = requested_types
            memory.add_chat_turn("assistant", f"已生成 {len(images)} 张商品图片。")
            _sync_canvas_to_memory(canvas, memory)
            warning = f"以下图片生成失败，请重试：{', '.join(missing_types)}" if missing_types else ""
            yield {"event": "image_done", "all_images": images, "all_prompts": prompts, "average_scores": {}, "warning": warning}
            yield {
                "event": "agent_message", "agent": "agent",
                "text": f"已完成商品图片生成（{len(images)}/{len(requested_types)} 张）。" + (f" 未完成：{', '.join(missing_types)}。" if missing_types else ""),
            }
            yield {"event": "memory_updated", "agent_memory": memory.to_dict()}
            yield {"event": "done"}
            return
        if direct_image_agent and product_image_base64:
            from agent.intent.safety_filter import safety_check

            yield {"event": "agent_thinking", "phase": "sense", "iteration": 0}
            safety_result = await safety_check(clean_message)
            if not safety_result.passed:
                yield {
                    "event": "error",
                    "message": f"内容安全检查未通过: {safety_result.blocked_reason}",
                }
                yield {"event": "done"}
                return

            prompt = build_seedream_edit_prompt(clean_message, region_edit=region_edit)
            yield {
                "event": "agent_thinking",
                "phase": "image_generator",
                "iteration": 1,
                "agent_role": "image_generator",
            }
            yield {
                "event": "agent_tool_start",
                "tool": "generate_layer",
                "args": {"layer_type": "subject", "prompt": prompt},
                "iteration": 1,
            }

            handler = get_action("generate_layer")
            direct_action_config = {
                "layer_type": "subject",
                "prompt": prompt,
                "style_tags": [],
                "image_model_key": self._image_config.get("api_key", ""),
                "aspect_ratio": getattr(memory, "aspect_ratio", "1:1"),
                "negative_prompt": getattr(memory, "negative_prompt", ""),
                "size_doubao": self._image_config.get("size", "1920x1920"),
                "reference_images": [product_image_base64],
            }
            action_params = ActionParams(
                action="generate_layer",
                **direct_action_config,
            )
            result = await handler(action_params, canvas)
            if not result.success or not result.data.get("url"):
                yield {
                    "event": "error",
                    "message": f"生图 Agent 执行失败: {result.error or '未返回图片'}",
                }
                yield {"event": "done"}
                return

            image_url = result.data["url"]
            canvas = self._canvas.create_layer(
                cid,
                layer_type="subject",
                asset_ref=image_url,
                prompt_used=prompt,
                status="ready",
            )
            if hasattr(memory, "record_generation"):
                memory.record_generation("edit", prompt, image_url, 0)
            memory.add_chat_turn("assistant", "已按附件图片执行局部修改。" if region_edit else "已按附件图片执行生图。")
            _sync_canvas_to_memory(canvas, memory)
            yield {
                "event": "image_progress",
                "image_type": "edit",
                "url": image_url,
                "prompt": prompt,
            }
            yield {
                "event": "image_done",
                "all_images": {"edit": image_url},
                "all_prompts": {"edit": prompt},
                "average_scores": {"overall": 0.0},
            }
            yield {
                "event": "agent_message",
                "agent": "image_generator",
                "text": "已完成框选区域修改。" if region_edit else "已根据附件图片完成生成。",
            }
            yield {"event": "memory_updated", "agent_memory": memory.to_dict()}
            yield {"event": "done"}
            return

        # ============================================
        # PHASE 1: SENSE
        # ============================================
        yield {"event": "agent_thinking", "phase": "sense", "iteration": 0}

        design_brief, enriched_ctx, clarification_needed = await self._sense(
            message, memory, product_image_base64, rag_retriever
        )

        # If clarification is needed, yield questions and return
        if clarification_needed:
            from agent.intent.clarifier import generate_clarification_questions

            questions = generate_clarification_questions(design_brief)
            yield {
                "event": "agent_message",
                "agent": "agent",
                "text": "在开始之前，我需要确认几个信息：\n" + "\n".join(
                    f"{i+1}. {q}" for i, q in enumerate(questions)
                ),
            }
            memory.add_chat_turn("assistant", "需要澄清设计需求")
            _sync_canvas_to_memory(canvas, memory)
            yield {"event": "memory_updated", "agent_memory": memory.to_dict()}
            yield {"event": "canvas_queried", "current_images": memory.current_images, "stitch_regions": memory.stitch_regions}
            yield {"event": "done"}
            return

        # Safety check
        from agent.intent.safety_filter import safety_check

        safety_result = await safety_check(message)
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
            )

            action_name = decision.get("action", "")
            action_params_raw = decision.get("params", {})
            reasoning = decision.get("reasoning", "")

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
                yield {
                    "event": "error",
                    "message": f"未知动作: {action_name}。可用: {list_actions()}",
                }
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

            # Inject extra config into params for handlers that need it
            action_config = {
                **action_params_raw,
                "image_model_key": self._image_config.get("api_key", ""),
                "aspect_ratio": getattr(memory, "aspect_ratio", "1:1"),
                "negative_prompt": getattr(memory, "negative_prompt", "低画质、变形肢体、模糊、水印"),
                "size_doubao": self._image_config.get("size", "1920x1920"),
                "rag_retriever": rag_retriever,
            }
            action_params = ActionParams(
                action=action_name,
                **{k: v for k, v in action_config.items() if k != "action"},
            )

            result = await handler(action_params, canvas)

            if not result.success:
                yield {
                    "event": "error",
                    "message": f"动作 {action_name} 失败: {result.error}",
                }
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
    ) -> tuple[DesignBrief, EnrichedContext, bool]:
        """Phase 1: SENSE — classify, filter, assemble context, check clarification."""
        from agent.intent.classifier import classify_input
        from agent.intent.brief_parser import apply_requirement_reply
        from agent.intent.clarifier import needs_clarification
        from agent.intent.context_assembler import assemble_context

        # Persist compact replies such as "自然场景，卖点图" before checking
        # missing slots, otherwise the Agent asks the same questions again.
        apply_requirement_reply(message, memory)

        # Classify intent
        has_image = bool(product_image_base64)
        intent = classify_input(
            message,
            has_image=has_image,
            memory=memory,
            last_intent=getattr(memory, "last_intent", ""),
            current_phase=getattr(memory, "current_phase", ""),
        )

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
            reference_image_refs=[f"data:image/png;base64,{product_image_base64}"] if product_image_base64 else [],
        )

        # If new design or chitchat and no subject, extract from message
        if not brief.subject and intent in (IntentType.NEW_DESIGN, IntentType.CHITCHAT):
            brief.subject = message[:100]  # Use message as tentative subject

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

        # Check if clarification is needed (only for NEW_DESIGN with missing info)
        clarification_needed = False
        if intent == IntentType.NEW_DESIGN:
            clarification_needed = needs_clarification(
                brief,
                recent_chat=getattr(memory, "recent_chat", None),
                current_phase=getattr(memory, "current_phase", ""),
            )

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
    ) -> dict[str, Any]:
        """Phase 2: DECIDE — LLM selects the next action from the registry."""
        available_actions = list_actions()
        action_descriptions = {
            "generate_layer": "生成一个新图层图片。params: layer_type (subject/background/text/decoration), prompt (英文), style_tags",
            "inpaint_region": "局部重绘某个图层的区域。params: layer_id, bbox (x,y,width,height), prompt",
            "remove_background": "移除图层背景（抠图）。params: layer_id",
            "compose": "多图层合成为最终图片。params: layer_ids (要合成的图层ID列表)",
            "upscale": "超分辨率放大图层。params: layer_id, scale_factor (2或4)",
            "layout_suggest": "AI建议图层布局。params: image_types (图片类型列表)",
            "search_knowledge": "搜索RAG知识库获取 prompt 模板/风格指南/平台规则。params: query (搜索词), categories (分类列表，可选: prompt_template, style_guide, platform_rule, copywriting)",
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

        context = "\n".join(context_parts)

        # Call LLM to decide — include product image as multimodal content
        try:
            decision = await self._call_decide_llm(
                system_prompt, context,
                product_image_base64=product_image_base64,
                memory=memory,
            )
            return decision
        except Exception as e:
            logger.error(f"Decide LLM call failed: {e}")
            # Fallback: if nothing generated yet, generate main layer
            if not generated_images and design_brief.subject:
                from agent.intent.prompt_expander import expand_prompt

                prompt = await expand_prompt(design_brief, enriched_ctx, "subject",
                                             rag_retriever=rag_retriever)
                return {
                    "action": "generate_layer",
                    "params": {
                        "layer_type": "subject",
                        "prompt": prompt,
                        "style_tags": design_brief.color_palette,
                    },
                    "reasoning": f"Auto-generate subject layer (LLM fallback: {e})",
                }
            return {"action": "finish", "params": {}, "reasoning": "LLM decision failed, finishing"}

    async def _review(
        self,
        canvas: CanvasState,
        design_brief: DesignBrief,
        action_name: str,
        last_layer_id: str,
        data: dict[str, Any],
    ) -> ReviewResult | None:
        """Phase 4: REVIEW — local for single layer, global for compose."""
        # Skip review for non-generative actions
        if action_name in ("layout_suggest", "remove_background", "upscale"):
            return None

        # For compose: must do global review
        if action_name == "compose":
            from agent.review.global_review import review_composition

            return await review_composition(canvas, design_brief, self._vision_config)

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
                vision_config=self._vision_config,
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
                vision_config=self._vision_config,
            )

        return None

    # ================================================================
    # LLM helpers
    # ================================================================

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
            "2. 如果已有主体图但缺少其他类型 → generate_layer (对应类型)\n"
            "3. 如果所有需要的类型都已生成 → finish\n"
            "4. 如果用户信息不足（不知道产品、风格等） → chat 询问\n"
            "5. 多图层需要合并时 → compose\n"
            "6. 用户闲聊 → chat 友好回复并引导回商品图话题\n"
            "7. 不要连续两次执行相同动作，检查重试次数避免死循环\n"
            "8. 如果用户上传了产品参考图（上下文中有说明），生成 prompt 时必须描述该产品的实际外观特征（颜色、形状、材质等）\n"
            "9. 如果对 prompt 写法不确定或需要某平台的风格参考，可先调用 search_knowledge 检索知识库\n\n"
            "## 输出格式\n"
            "返回严格的JSON对象（不要markdown包裹）：\n"
            '{"action": "动作名", "params": {...}, "reasoning": "简短中文说明"}\n'
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
                        "url": f"data:image/png;base64,{product_image_base64}",
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

        resp = await execute_chat_with_fallbacks(
            messages, primary_config, get_chat_fallback_configs()
        )
        cleaned = clean_json_string(resp)
        return json.loads(cleaned)


# ================================================================
# Module-level helpers
# ================================================================


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
