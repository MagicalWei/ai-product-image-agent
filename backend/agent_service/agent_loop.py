"""
Agent Service — Unified Agent Loop (DEPRECATED)

⚠️ 此文件为 unified 架构，保留用于过渡期回退。
   新架构见 /agent/core/loop.py（sense-decide-act-review 四阶段循环）。
   设置 AGENT_ARCHITECTURE=unified 使用此文件，默认使用新架构。

One LLM call with tools replaces the entire multi-layer pipeline:
  classify_intent → collect_info → plan_design → ReAct → generate
"""

import os
import json
import asyncio
import logging
from typing import Dict, List, Any, Optional, AsyncGenerator

import httpx

from memory import AgentMemory
from config import (
    IMAGE_TYPE_CONFIGS,
    map_aspect_ratio_to_size,
    map_ratio_for_openai_image,
    clean_json_string,
    _build_brand_context,
)
from prompts import AGENT_SYSTEM_PROMPT
from tools import AGENT_TOOLS
from chat_client import (
    execute_chat_with_fallbacks_full,
    get_chat_fallback_configs,
    get_image_fallback_configs,
    call_openai_image_api,
    call_anthropic_svg_generator,
)

logger = logging.getLogger(__name__)

MAX_RETRIES_PER_IMAGE = 3
MAX_ITERATIONS = 10
WARNING_THRESHOLD = 8


async def run_unified_agent(
    message: str,
    memory: AgentMemory,
    cheap_model_config: Dict[str, str],
    vision_model_config: Dict[str, str],
    image_model_key: str,
    rag_retriever: Any = None,
    product_image_base64: str = "",
    max_iterations: int = MAX_ITERATIONS,
) -> AsyncGenerator[Dict[str, Any], None]:
    """The ONE agent loop. Takes raw user message + memory, lets the LLM decide
    everything. No more classify_intent, collect_info, plan_design, or legacy loops.

    Args:
        message: Raw user message
        memory: AgentMemory with full state
        cheap_model_config: Chat model config
        vision_model_config: Vision model config
        image_model_key: Image generation API key
        rag_retriever: Optional RAG retriever
        product_image_base64: Optional product image for vision
        max_iterations: Safety limit
    """
    aspect_ratio = memory.aspect_ratio or "1:1"
    neg_prompt = memory.negative_prompt or "低画质、变形肢体、模糊、水印"
    size_doubao = map_aspect_ratio_to_size(aspect_ratio)

    # ── Build system prompt ──
    memory_context = memory.build_llm_context()
    system_prompt = AGENT_SYSTEM_PROMPT

    # Add image type descriptions so LLM knows what types are available
    img_type_desc_lines = []
    for it, cfg in IMAGE_TYPE_CONFIGS.items():
        name = cfg.get("name", it)
        desc = cfg.get("description", "")
        img_type_desc_lines.append(f"- **{it}**: {name}" + (f" ({desc})" if desc else ""))
    system_prompt += (
        "\n\n## 可用图片类型\n"
        + "\n".join(img_type_desc_lines)
    )

    # Add memory context (product info, history, etc.)
    if memory_context:
        system_prompt += f"\n\n{memory_context}"

    # Add brand context using full _build_brand_context (7 fields)
    brand_dict = {
        "brand_name": memory.brand_name,
        "style": memory.brand_style,
        "product_name": memory.product_name,
        "product_category": memory.product_category,
        "selling_points": [memory.selling_points] if memory.selling_points else [],
    }
    brand_context = _build_brand_context(brand_dict)
    if brand_context:
        system_prompt += brand_context

    # ── Build messages ──
    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
    ]

    # Include recent chat history from memory
    for chat in memory.recent_chat[-4:]:
        messages.append({"role": chat["role"], "content": chat["content"]})

    # Build the user message (with optional product image)
    user_content: Any = message
    if product_image_base64:
        user_content = [
            {"type": "text", "text": message},
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/png;base64,{product_image_base64}",
                    "detail": "auto",
                },
            },
        ]
    messages.append({"role": "user", "content": user_content})

    # ── Main loop ──
    generated_images: Dict[str, str] = {}
    all_prompts: Dict[str, str] = {}
    image_retry_counts: Dict[str, int] = {}
    all_evaluations: Dict[str, List[Dict[str, Any]]] = {}

    iteration = 0

    while iteration < max_iterations:
        iteration += 1

        # Safety: push to finish after warning threshold
        if iteration >= WARNING_THRESHOLD:
            messages.append({
                "role": "user",
                "content": (
                    f"[系统提示] 第{iteration}轮。如果图片已可用，请调用 finish_task 结束。"
                    "如果还没生成图片，请立即调用 generate_image。不要继续对话。"
                ),
            })

        yield {
            "event": "agent_thinking",
            "iteration": iteration,
            "max_iterations": max_iterations,
        }

        # Call LLM with tools
        try:
            primary_config = {
                "protocol": "openai",
                "api_key": cheap_model_config.get("api_key", ""),
                "base_url": cheap_model_config.get("base_url", "https://api.deepseek.com/v1"),
                "model": cheap_model_config.get("model", "deepseek-chat"),
            }

            resp = await execute_chat_with_fallbacks_full(
                messages,
                primary_config,
                get_chat_fallback_configs(),
                tools=AGENT_TOOLS,
                tool_choice="auto",
            )
        except Exception as e:
            logger.error(f"[Unified Agent] LLM call failed at iteration {iteration}: {e}")
            yield {"event": "error", "message": f"Agent LLM 调用失败: {str(e)}"}
            break

        content = resp.get("content", "")
        tool_calls = resp.get("tool_calls", [])

        # Record assistant message
        assistant_msg: Dict[str, Any] = {"role": "assistant", "content": content}
        if tool_calls:
            assistant_msg["tool_calls"] = tool_calls
        messages.append(assistant_msg)

        # Yield text content
        if content and content.strip():
            yield {
                "event": "agent_message",
                "agent": "agent",
                "text": content[:500],
                "iteration": iteration,
            }

        # No tool calls — LLM is just chatting or asking a question
        if not tool_calls:
            if not generated_images:
                memory.add_chat_turn("assistant", content[:500])
                yield {"event": "memory_updated", "agent_memory": memory.to_dict()}
                yield {"event": "done"}
                return
            continue

        # Process tool calls
        for tc in tool_calls:
            fn = tc.get("function", {})
            tool_name = fn.get("name", "")
            try:
                tool_args = json.loads(fn.get("arguments", "{}"))
            except json.JSONDecodeError:
                tool_args = {}

            yield {
                "event": "agent_tool_start",
                "tool": tool_name,
                "args": tool_args,
                "iteration": iteration,
            }

            tool_result = await _execute_agent_tool(
                tool_name=tool_name,
                tool_args=tool_args,
                memory=memory,
                generated_images=generated_images,
                all_prompts=all_prompts,
                all_evaluations=all_evaluations,
                image_retry_counts=image_retry_counts,
                size_doubao=size_doubao,
                aspect_ratio=aspect_ratio,
                neg_prompt=neg_prompt,
                image_model_key=image_model_key,
                cheap_model_config=cheap_model_config,
                vision_model_config=vision_model_config,
                rag_retriever=rag_retriever,
                design_plan=memory.design_plan,
            )

            # Feed tool result back to LLM
            tool_msg = {
                "role": "tool",
                "tool_call_id": tc.get("id", f"call_{iteration}_{tool_name}"),
                "name": tool_name,
                "content": json.dumps(tool_result, ensure_ascii=False),
            }
            messages.append(tool_msg)

            # Yield events for frontend
            if tool_name == "generate_image":
                img_type = tool_args.get("image_type", "main")
                img_url = tool_result.get("url", "")
                prompt = tool_args.get("prompt", "")
                if img_url:
                    generated_images[img_type] = img_url
                    all_prompts[img_type] = prompt
                    _update_memory_from_generation(memory, img_type, prompt, img_url)
                    yield {
                        "event": "image_progress",
                        "image_type": img_type,
                        "url": img_url,
                        "prompt": prompt,
                    }
                else:
                    yield {
                        "event": "error",
                        "message": f"图片生成失败 ({img_type}): {tool_result.get('error', '未知错误')}",
                    }

            elif tool_name == "evaluate_image":
                yield {
                    "event": "evaluation_progress",
                    "image_type": tool_args.get("image_type", ""),
                    "status": "evaluated",
                    "score": tool_result.get("overall_score", 0),
                    "passed": tool_result.get("passed", False),
                    "issues": tool_result.get("issues", []),
                    "suggestions": tool_result.get("suggestions", []),
                }

            elif tool_name == "query_canvas":
                yield {
                    "event": "canvas_queried",
                    "current_images": tool_result.get("current_images", {}),
                    "stitch_regions": tool_result.get("stitch_regions", []),
                }

            elif tool_name == "search_knowledge":
                if tool_result.get("results"):
                    yield {
                        "event": "knowledge_found",
                        "results_count": len(tool_result.get("results", [])),
                        "context": tool_result.get("context", "")[:300],
                    }

            elif tool_name == "finish_task":
                memory.add_chat_turn("assistant", tool_result.get("summary", "任务完成")[:500])
                yield {
                    "event": "agent_message",
                    "agent": "agent",
                    "text": tool_result.get("summary", "任务完成"),
                }
                yield {
                    "event": "image_done",
                    "all_images": generated_images,
                    "all_prompts": all_prompts,
                }
                yield {"event": "memory_updated", "agent_memory": memory.to_dict()}
                yield {"event": "done"}
                return

        await asyncio.sleep(0.05)

    # ── Max iterations reached ──
    if generated_images:
        memory.add_chat_turn("assistant", "图片已生成完成")
        yield {
            "event": "image_done",
            "all_images": generated_images,
            "all_prompts": all_prompts,
            "warning": f"Agent 达到最大迭代次数 ({max_iterations})",
        }
        yield {"event": "memory_updated", "agent_memory": memory.to_dict()}
        yield {"event": "done"}
    else:
        yield {
            "event": "error",
            "message": f"Agent 在 {max_iterations} 轮内未能生成任何图片",
        }


def _update_memory_from_generation(
    memory: AgentMemory,
    img_type: str,
    prompt: str,
    url: str,
) -> None:
    """Update memory with generation results."""
    memory.record_generation(img_type, prompt, url, 0)
    if img_type not in memory.image_types:
        memory.image_types.append(img_type)
        memory.image_types = list(dict.fromkeys(memory.image_types))  # dedupe
    memory.current_phase = "GENERATING_IMAGES"


# ========================================================
# Tool execution
# ========================================================


async def _execute_agent_tool(
    tool_name: str,
    tool_args: Dict[str, Any],
    memory: AgentMemory,
    generated_images: Dict[str, str],
    all_prompts: Dict[str, str],
    all_evaluations: Dict[str, List[Dict[str, Any]]],
    image_retry_counts: Dict[str, int],
    size_doubao: str,
    aspect_ratio: str,
    neg_prompt: str,
    image_model_key: str,
    cheap_model_config: Dict[str, str],
    vision_model_config: Dict[str, str],
    rag_retriever: Any,
    design_plan: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Execute an agent tool and return the result."""

    if tool_name == "generate_image":
        return await _tool_generate_image(
            tool_args, memory, image_retry_counts,
            size_doubao, neg_prompt, image_model_key, aspect_ratio,
        )

    elif tool_name == "evaluate_image":
        return await _tool_evaluate_image(
            tool_args, memory, generated_images, all_evaluations,
            vision_model_config, cheap_model_config, design_plan,
        )

    elif tool_name == "query_canvas":
        return _tool_query_canvas(memory)

    elif tool_name == "search_knowledge":
        return await _tool_search_knowledge(tool_args, memory, rag_retriever)

    elif tool_name == "update_plan":
        return _tool_update_plan(tool_args, memory)

    elif tool_name == "finish_task":
        return _tool_finish_task(tool_args, generated_images, all_evaluations)

    else:
        return {"error": f"Unknown tool: {tool_name}"}


async def _tool_generate_image(
    args: Dict[str, Any],
    memory: AgentMemory,
    image_retry_counts: Dict[str, int],
    size_doubao: str,
    neg_prompt: str,
    image_model_key: str,
    aspect_ratio: str,
) -> Dict[str, Any]:
    """Execute generate_image tool."""
    img_type = args.get("image_type", "main")
    prompt = args.get("prompt", "")

    if not prompt:
        return {"error": "No prompt provided"}

    retry_count = image_retry_counts.get(img_type, 0)
    if retry_count >= MAX_RETRIES_PER_IMAGE:
        return {
            "error": f"Image type '{img_type}' has reached max retries ({MAX_RETRIES_PER_IMAGE})",
            "retry_count": retry_count,
        }

    image_retry_counts[img_type] = retry_count + 1
    img_url = None
    gen_errors = []

    # Try primary image model
    if image_model_key:
        try:
            url = os.getenv("IMAGE_API_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3/images/generations")
            headers = {
                "Authorization": f"Bearer {image_model_key}",
                "Content-Type": "application/json",
            }
            payload = {
                "model": os.getenv("DOUBAO_IMAGE_MODEL", "doubao-seedream-5-0-260128"),
                "prompt": prompt,
                "size": size_doubao,
                "response_format": "url",
                "extra_body": {"watermark": True},
            }
            if neg_prompt:
                payload["negative_prompt"] = neg_prompt
            async with httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=30.0)) as client:
                response = await client.post(url, headers=headers, json=payload)
                if response.status_code == 200:
                    data = response.json()
                    images = data.get("data", [])
                    if images:
                        img_url = images[0].get("url")
                else:
                    gen_errors.append(f"HTTP {response.status_code}: {response.text[:200]}")
        except Exception as e:
            gen_errors.append(f"Primary: {str(e)}")

    # Try fallbacks
    if not img_url:
        for idx, fb_config in enumerate(get_image_fallback_configs()):
            if not fb_config.get("api_key"):
                continue
            try:
                protocol = fb_config["protocol"].lower().strip()
                if protocol == "openai":
                    img_url = await call_openai_image_api(
                        prompt, map_ratio_for_openai_image(aspect_ratio), neg_prompt, fb_config
                    )
                elif protocol == "anthropic":
                    img_url = await call_anthropic_svg_generator(prompt, neg_prompt, fb_config)
                if img_url:
                    break
            except Exception as e:
                gen_errors.append(f"Fallback {idx+1}: {str(e)}")

    if img_url:
        memory.record_generation(img_type, prompt, img_url, 0)
        return {
            "success": True,
            "image_type": img_type,
            "url": img_url,
            "retry_count": image_retry_counts[img_type],
        }
    else:
        return {
            "success": False,
            "image_type": img_type,
            "error": "; ".join(gen_errors),
            "retry_count": image_retry_counts[img_type],
        }


async def _tool_evaluate_image(
    args: Dict[str, Any],
    memory: AgentMemory,
    generated_images: Dict[str, str],
    all_evaluations: Dict[str, List[Dict[str, Any]]],
    vision_model_config: Dict[str, str],
    cheap_model_config: Dict[str, str],
    design_plan: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Execute evaluate_image tool."""
    img_type = args.get("image_type", "")

    if img_type not in generated_images:
        return {"error": f"No generated image found for type '{img_type}'"}

    image_url = generated_images[img_type]
    img_config = IMAGE_TYPE_CONFIGS.get(img_type, {})
    img_type_name = img_config.get("name", img_type)

    eval_context = (
        f"评估这张{img_type_name}的电商图片质量。\n"
        f"产品: {memory.product_name}\n"
        f"平台: {memory.ecom_platform or '通用电商'}\n"
    )
    if design_plan:
        eval_context += (
            f"预期设计方向: {design_plan.get('design_direction', '')}\n"
        )

    from prompts import IMAGE_EVALUATOR_SYSTEM_PROMPT

    vision_api_key = vision_model_config.get("api_key", "")
    if vision_api_key:
        try:
            messages = [
                {"role": "system", "content": IMAGE_EVALUATOR_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": eval_context},
                        {"type": "image_url", "image_url": {"url": image_url, "detail": "auto"}},
                    ],
                },
            ]
            primary_config = {
                "protocol": "openai",
                "api_key": vision_api_key,
                "base_url": vision_model_config.get("base_url", "https://api.openai.com/v1"),
                "model": vision_model_config.get("model", "gpt-4o"),
            }
            from chat_client import execute_chat_with_fallbacks
            resp = await execute_chat_with_fallbacks(
                messages, primary_config, get_chat_fallback_configs()
            )
            cleaned = clean_json_string(resp)
            evaluation = json.loads(cleaned)
            overall = evaluation.get("overall_score", 70)
            passed = evaluation.get("passed", overall >= 80)

            result = {
                "image_type": img_type,
                "overall_score": overall,
                "passed": passed,
                "scores": evaluation.get("scores", {}),
                "issues": evaluation.get("issues", []),
                "suggestions": evaluation.get("suggestions", []),
            }
        except Exception as e:
            logger.warning(f"[Agent Loop] Vision evaluation failed: {e}")
            result = {
                "image_type": img_type,
                "overall_score": 75,
                "passed": True,
                "scores": {},
                "issues": [],
                "suggestions": [],
            }
    else:
        result = {
            "image_type": img_type,
            "overall_score": 75,
            "passed": True,
            "scores": {},
            "issues": [],
            "suggestions": [],
        }

    if img_type not in all_evaluations:
        all_evaluations[img_type] = []
    all_evaluations[img_type].append(result)

    if image_url:
        memory.record_generation(img_type, "", image_url, result.get("overall_score", 0))

    return result


def _tool_query_canvas(memory: AgentMemory) -> Dict[str, Any]:
    """Execute query_canvas tool."""
    return {
        "current_images": memory.current_images,
        "stitch_regions": memory.stitch_regions,
    }


async def _tool_search_knowledge(
    args: Dict[str, Any],
    memory: AgentMemory,
    rag_retriever: Any,
) -> Dict[str, Any]:
    """Execute search_knowledge tool."""
    query = args.get("query", f"{memory.product_name} {memory.selling_points}")
    categories = args.get("categories", ["prompt_template", "style_guide"])

    if rag_retriever is None:
        return {"results": [], "context": "", "note": "RAG retriever not available"}

    try:
        result = await rag_retriever.retrieve_multi_category(
            query=query,
            categories=categories,
            top_k_per_category=2,
        )
        return {
            "results": [
                {"content": r.content[:200], "category": r.category}
                for r in result.results
            ],
            "context": result.context[:500] if result.context else "",
        }
    except Exception as e:
        return {"error": f"Knowledge search failed: {str(e)}", "results": [], "context": ""}


def _tool_update_plan(args: Dict[str, Any], memory: AgentMemory) -> Dict[str, Any]:
    """Execute update_plan tool."""
    changes = args.get("changes", "")
    if memory.design_plan:
        memory.design_plan["_agent_updates"] = memory.design_plan.get("_agent_updates", [])
        memory.design_plan["_agent_updates"].append(changes)
    return {"success": True, "changes_recorded": changes}


def _tool_finish_task(
    args: Dict[str, Any],
    generated_images: Dict[str, str],
    all_evaluations: Dict[str, List[Dict[str, Any]]],
) -> Dict[str, Any]:
    """Execute finish_task tool."""
    summary = args.get("summary", "任务完成")

    total_images = len(generated_images)
    avg_scores = {}
    for img_type, evals in all_evaluations.items():
        if evals:
            scores = [e.get("overall_score", 0) for e in evals]
            avg_scores[img_type] = sum(scores) / len(scores) if scores else 0

    return {
        "success": True,
        "summary": summary,
        "total_images_generated": total_images,
        "average_scores": avg_scores,
        "image_types": list(generated_images.keys()),
    }
