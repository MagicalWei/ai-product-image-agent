import os
import json
import re
import asyncio
import httpx
import logging
from typing import Dict, List, Any, Optional
from dotenv import load_dotenv

# ── Modular imports (Phase 0 refactoring) ──
from prompts import (
    COLLECT_INFO_SYSTEM_PROMPT,
    INTENT_CLASSIFIER_PROMPT,
    FINE_GRAINED_INTENT_CLASSIFIER_PROMPT,
    CHITCHAT_SYSTEM_PROMPT,
    MODIFY_SYSTEM_PROMPT,
    DESIGN_PLANNER_SYSTEM_PROMPT,
    PROMPT_ENGINEER_SYSTEM_PROMPT,
    IMAGE_EVALUATOR_SYSTEM_PROMPT,
    EXTRACT_JSON_SYSTEM_PROMPT,
    MODIFY_INTENT_WITH_CANVAS_PROMPT,
)
from config import (
    IMAGE_TYPE_CONFIGS,
    CANVAS_TOOLS,
    map_aspect_ratio_to_size,
    map_ratio_for_openai_image,
    clean_json_string,
    _extract_basic_info_from_history,
    _build_canvas_context,
    _build_brand_context,
    tool_call,
)
from chat_client import (
    model_supports_vision,
    strip_images_from_messages,
    _build_openai_messages,
    _build_anthropic_messages,
    _call_chat_api,
    _call_openai_compatible_api,
    _call_anthropic_api,
    execute_chat_with_fallbacks,
    execute_chat_with_fallbacks_full,
    call_openai_image_api,
    call_anthropic_svg_generator,
    get_chat_fallback_configs,
    get_image_fallback_configs,
)
from tools import CANVAS_TOOLS as _canvas_tools
from memory import AgentMemory
from agent_loop import run_unified_agent, run_agent_loop
from intents import parse_intent_result, get_routing_action, normalize_intent

logger = logging.getLogger(__name__)

# ── Re-export CANVAS_TOOLS for backward compatibility ──
CANVAS_TOOLS = _canvas_tools

# ========================================================
# NOTE: All constants, prompts, configs, chat client functions,
# and tools are now imported from their respective modules:
#   prompts.py, config.py, chat_client.py, tools.py
# ========================================================


# ========================================================
# Phase 1: Information Collection
# ========================================================


async def plan_design(
    product_name: str,
    selling_points: str,
    image_types: List[str],
    ecom_platform: str,
    target_country: str,
    style_preference: str,
    color_palette: List[str],
    brand_memory: Dict[str, Any],
    cheap_model_config: Dict[str, str],
) -> Dict[str, Any]:
    """Layer 1: Design Planner — creates a structured design plan before image generation.

    Takes product info + brand memory + image types and returns a structured design plan
    that guides all subsequent prompt engineering and ensures cross-image style consistency.
    """
    api_key = cheap_model_config.get("api_key", "")
    if not api_key:
        logger.info("[Design Planner] No API key, skipping design planning")
        return {"design_plan": None}

    # Build image type descriptions for the planner
    img_type_descriptions = []
    for it in image_types:
        cfg = IMAGE_TYPE_CONFIGS.get(it)
        if cfg:
            img_type_descriptions.append(f"  - {it} ({cfg['name']}): {cfg['description']}")

    planner_prompt = (
        f"请为以下产品制定电商图片设计方案：\n\n"
        f"产品名称: {product_name}\n"
        f"核心卖点: {selling_points}\n"
        f"电商平台: {ecom_platform or '通用电商'}\n"
        f"目标国家: {target_country or '全球'}\n"
        f"风格偏好: {style_preference or '未指定'}\n"
        f"色调偏好: {', '.join(color_palette) if color_palette else '未指定'}\n"
        f"需要生成的图片类型:\n{chr(10).join(img_type_descriptions)}\n"
    )

    brand_context = _build_brand_context(brand_memory)
    if brand_context:
        planner_prompt += f"\n{brand_context}\n"

    messages = [
        {"role": "system", "content": DESIGN_PLANNER_SYSTEM_PROMPT},
        {"role": "user", "content": planner_prompt},
    ]

    try:
        primary_config = {
            "protocol": "openai",
            "api_key": api_key,
            "base_url": cheap_model_config.get("base_url", "https://api.deepseek.com/v1"),
            "model": cheap_model_config.get("model", "deepseek-chat"),
        }
        resp = await execute_chat_with_fallbacks(
            messages, primary_config, get_chat_fallback_configs()
        )
        cleaned = clean_json_string(resp)
        design_plan = json.loads(cleaned)
        logger.info(f"[Design Planner] Design direction: {design_plan.get('design_direction', 'N/A')[:80]}")
        return {"design_plan": design_plan}
    except Exception as e:
        logger.warning(f"[Design Planner] Failed: {e}, proceeding without design plan")
        return {"design_plan": None}


async def generate_dynamic_prompt(
    img_type: str,
    design_plan: Optional[Dict[str, Any]],
    product_name: str,
    selling_points: str,
    ecom_platform: str,
    target_country: str,
    style_preference: str,
    color_palette: List[str],
    aspect_ratio: str,
    previous_attempts: List[Dict[str, Any]],
    round_num: int,
    cheap_model_config: Dict[str, str],
    rag_retriever: Any = None,
    canvas_context: str = "",
) -> str:
    """Think phase: LLM dynamically writes/revises prompt for a specific image type.

    Round 0: Write prompt from scratch based on design plan + product info.
    Round N: Revise prompt based on evaluation feedback from previous rounds.

    If rag_retriever is provided, retrieves relevant knowledge (prompt templates,
    platform style guides) and injects into the LLM prompt for enhanced quality.
    """
    api_key = cheap_model_config.get("api_key", "")
    if not api_key:
        # Fallback to template-based prompt if no LLM available
        return _build_template_prompt(
            img_type, product_name, selling_points, ecom_platform,
            target_country, style_preference, color_palette, aspect_ratio
        )

    img_config = IMAGE_TYPE_CONFIGS.get(img_type, {})
    img_type_name = img_config.get("name", img_type)
    img_type_desc = img_config.get("description", "")

    # Build design plan context
    plan_context = ""
    if design_plan:
        plan_context = (
            f"## 设计方案\n"
            f"整体方向: {design_plan.get('design_direction', '')}\n"
            f"视觉风格: {design_plan.get('visual_style', '')}\n"
            f"一致性要求: {design_plan.get('consistency_notes', '')}\n"
        )
        for pip in design_plan.get("per_image_plans", []):
            if pip.get("type") == img_type:
                plan_context += (
                    f"## 本图片设计指导\n"
                    f"构图: {pip.get('composition', '')}\n"
                    f"光线: {pip.get('lighting', '')}\n"
                    f"背景: {pip.get('background', '')}\n"
                    f"氛围: {pip.get('mood', '')}\n"
                )
                break

    # Build feedback context from previous attempts
    feedback_context = ""
    if previous_attempts and round_num > 0:
        last_attempt = previous_attempts[-1]
        last_eval = last_attempt.get("evaluation", {})
        if last_eval:
            issues = last_eval.get("issues", [])
            suggestions = last_eval.get("suggestions", [])
            if issues or suggestions:
                feedback_context = "## 前一轮评估反馈（请针对以下问题修改prompt）\n"
                if issues:
                    feedback_context += "问题:\n" + "\n".join(f"  - {i}" for i in issues) + "\n"
                if suggestions:
                    feedback_context += "改进建议:\n" + "\n".join(f"  - {s}" for s in suggestions) + "\n"

    # ── RAG: 检索相关 prompt 模板和平台风格指南 ──
    rag_context = ""
    if rag_retriever is not None:
        try:
            rag_query = f"{img_type_name} {product_name} {selling_points} {ecom_platform or 'general e-commerce'}"
            rag_result = await rag_retriever.retrieve_multi_category(
                query=rag_query,
                categories=["prompt_template", "style_guide"],
                top_k_per_category=2,
            )
            if rag_result.context:
                rag_context = (
                    f"\n## 参考知识库\n"
                    f"以下是从知识库中检索到的相关 prompt 模板和风格指南，"
                    f"请参考其中的写法、术语和构图建议来优化生图 prompt：\n\n"
                    f"{rag_result.context}\n"
                )
                logger.info(
                    f"[RAG] Injected {len(rag_result.results)} knowledge chunks "
                    f"into prompt for '{img_type}'"
                )
        except Exception as e:
            logger.warning(f"[RAG] Failed to retrieve context: {e}")

    user_prompt = (
        f"请为以下产品编写一张{img_type_name}（{img_type_desc}）的英文生图prompt。\n\n"
        f"产品名称: {product_name}\n"
        f"核心卖点: {selling_points}\n"
        f"电商平台: {ecom_platform or '通用电商'}\n"
        f"目标国家: {target_country or '全球'}\n"
        f"风格偏好: {style_preference}\n"
        f"色调: {', '.join(color_palette) if color_palette else '未指定'}\n"
        f"图片比例: {aspect_ratio}\n"
        f"当前是第{round_num + 1}轮生成\n"
    )
    if plan_context:
        user_prompt += f"\n{plan_context}\n"
    if canvas_context:
        user_prompt += f"\n## 当前画布状态\n{canvas_context}\n"
    if rag_context:
        user_prompt += f"\n{rag_context}\n"
    if feedback_context:
        user_prompt += f"\n{feedback_context}\n"

    messages = [
        {"role": "system", "content": PROMPT_ENGINEER_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]

    try:
        primary_config = {
            "protocol": "openai",
            "api_key": api_key,
            "base_url": cheap_model_config.get("base_url", "https://api.deepseek.com/v1"),
            "model": cheap_model_config.get("model", "deepseek-chat"),
        }
        prompt = await execute_chat_with_fallbacks(
            messages, primary_config, get_chat_fallback_configs()
        )
        prompt = prompt.strip().strip('"').strip("'")
        logger.info(f"[Prompt Engineer] Round {round_num} for '{img_type}': {prompt[:100]}...")
        return prompt
    except Exception as e:
        logger.warning(f"[Prompt Engineer] Failed: {e}, using template fallback")
        return _build_template_prompt(
            img_type, product_name, selling_points, ecom_platform,
            target_country, style_preference, color_palette, aspect_ratio
        )


def _build_template_prompt(
    img_type: str,
    product_name: str,
    selling_points: str,
    ecom_platform: str,
    target_country: str,
    style_preference: str,
    color_palette: List[str],
    aspect_ratio: str,
) -> str:
    """Template-based prompt fallback when LLM prompt engineering is unavailable."""
    config = IMAGE_TYPE_CONFIGS.get(img_type)
    if not config:
        return f"Professional e-commerce product image of {product_name}. Selling points: {selling_points}."

    format_vars = {
        "product_name": product_name,
        "selling_points": selling_points,
        "ecom_platform": ecom_platform or "general e-commerce",
        "target_country": target_country or "global",
        "style_preference": style_preference,
    }
    if color_palette:
        format_vars["style_preference"] = f"{style_preference}, color palette: {', '.join(color_palette)}"

    try:
        prompt = config["prompt_template"].format(**format_vars)
    except KeyError:
        prompt = config["prompt_template"].replace("{product_name}", product_name).replace("{selling_points}", selling_points).replace("{style_preference}", style_preference).replace("{ecom_platform}", ecom_platform or "general e-commerce").replace("{target_country}", target_country or "global")

    # Platform-specific modifiers
    if ecom_platform and "amazon" in ecom_platform.lower():
        prompt += " Amazon-compliant product image, pure white background (RGB 255,255,255), no text on image."
    elif ecom_platform and "shopify" in ecom_platform.lower():
        prompt += " Lifestyle product photography, warm and inviting."

    # Aspect ratio modifiers
    if aspect_ratio == "9:16":
        prompt += " Vertical/portrait orientation for mobile-first platforms."
    elif aspect_ratio == "16:9":
        prompt += " Horizontal/landscape orientation for banners."

    return prompt


async def evaluate_image(
    image_url: str,
    img_type: str,
    design_plan: Optional[Dict[str, Any]],
    product_name: str,
    ecom_platform: str,
    vision_model_config: Dict[str, str],
    cheap_model_config: Dict[str, str],
) -> Dict[str, Any]:
    """Observe phase: Use multimodal LLM to evaluate generated image quality.

    Returns a dict with scores, overall_score, passed, issues, suggestions.
    Falls back to text-only evaluation (no image) if vision model is unavailable.
    """
    img_config = IMAGE_TYPE_CONFIGS.get(img_type, {})
    img_type_name = img_config.get("name", img_type)

    # Build evaluation context
    eval_context = (
        f"评估这张{img_type_name}的电商图片质量。\n"
        f"产品: {product_name}\n"
        f"平台: {ecom_platform or '通用电商'}\n"
    )
    if design_plan:
        eval_context += (
            f"预期设计方向: {design_plan.get('design_direction', '')}\n"
            f"预期视觉风格: {design_plan.get('visual_style', '')}\n"
        )
        for pip in design_plan.get("per_image_plans", []):
            if pip.get("type") == img_type:
                eval_context += f"预期构图: {pip.get('composition', '')}\n"
                eval_context += f"预期光线: {pip.get('lighting', '')}\n"
                break

    # Try vision model first
    vision_api_key = vision_model_config.get("api_key", "")
    if vision_api_key:
        try:
            logger.info(f"[Evaluator] Using vision model for '{img_type}'")
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
            resp = await execute_chat_with_fallbacks(
                messages, primary_config, get_chat_fallback_configs()
            )
            cleaned = clean_json_string(resp)
            evaluation = json.loads(cleaned)
            overall = evaluation.get("overall_score", 70)
            passed = evaluation.get("passed", overall >= 80)
            logger.info(f"[Evaluator] '{img_type}' score: {overall}/100, passed={passed}")
            return {
                "overall_score": overall,
                "passed": passed,
                "scores": evaluation.get("scores", {}),
                "issues": evaluation.get("issues", []),
                "suggestions": evaluation.get("suggestions", []),
            }
        except Exception as e:
            logger.warning(f"[Evaluator] Vision evaluation failed: {e}, falling back to text-only")

    # Text-only fallback: LLM evaluates based on prompt quality (no image viewing)
    try:
        logger.warning(f"[Evaluator] Using text-only evaluation for '{img_type}'")
        messages = [
            {"role": "system", "content": IMAGE_EVALUATOR_SYSTEM_PROMPT},
            {"role": "user", "content": eval_context + "\n注意：无法查看图片，请基于设计规范给出默认评估（分数70-75，建议继续优化）。"},
        ]
        primary_config = {
            "protocol": "openai",
            "api_key": cheap_model_config.get("api_key", ""),
            "base_url": cheap_model_config.get("base_url", "https://api.deepseek.com/v1"),
            "model": cheap_model_config.get("model", "deepseek-chat"),
        }
        resp = await execute_chat_with_fallbacks(
            messages, primary_config, get_chat_fallback_configs()
        )
        cleaned = clean_json_string(resp)
        evaluation = json.loads(cleaned)
        return {
            "overall_score": evaluation.get("overall_score", 72),
            "passed": evaluation.get("passed", False),
            "scores": evaluation.get("scores", {}),
            "issues": evaluation.get("issues", []),
            "suggestions": evaluation.get("suggestions", []),
        }
    except Exception as e:
        logger.error(f"[Evaluator] Text-only evaluation failed: {e}, returning default pass")
        return {
            "overall_score": 75,
            "passed": True,
            "scores": {},
            "issues": [],
            "suggestions": [],
        }

AGENT_MODE = os.getenv("AGENT_MODE", "react")  # "react" or "legacy"


async def _run_generation_loop(
    memory: AgentMemory,
    image_types: List[str],
    product_name: str,
    selling_points: str,
    ecom_platform: str,
    aspect_ratio: str,
    target_country: str,
    style_preference: str,
    color_palette: List[str],
    neg_prompt: str,
    image_model_key: str,
    design_plan: Optional[Dict[str, Any]],
    cheap_model_config: Dict[str, str],
    vision_model_config: Dict[str, str],
    rag_retriever: Any = None,
    canvas_context: str = "",
    current_images: Dict[str, str] = None,
    stitch_regions: List[Dict[str, Any]] = None,
    canvas_snapshot: str = "",
    mask_data: Any = None,
):
    """Route to either new ReAct Agent Loop or legacy loop based on AGENT_MODE."""
    if AGENT_MODE == "legacy":
        async for event in generate_images_with_react_loop(
            image_types=image_types,
            product_name=product_name,
            selling_points=selling_points,
            ecom_platform=ecom_platform,
            aspect_ratio=aspect_ratio,
            target_country=target_country,
            style_preference=style_preference,
            color_palette=color_palette,
            neg_prompt=neg_prompt,
            image_model_key=image_model_key,
            design_plan=design_plan,
            cheap_model_config=cheap_model_config,
            vision_model_config=vision_model_config,
            canvas_context=canvas_context,
            current_images=current_images or {},
            stitch_regions=stitch_regions or [],
            canvas_snapshot=canvas_snapshot,
            mask_data=mask_data,
            rag_retriever=rag_retriever,
        ):
            yield event
    else:
        async for event in run_agent_loop(
            memory=memory,
            design_plan=design_plan,
            cheap_model_config=cheap_model_config,
            vision_model_config=vision_model_config,
            image_model_key=image_model_key,
            rag_retriever=rag_retriever,
            aspect_ratio=aspect_ratio,
            neg_prompt=neg_prompt,
        ):
            yield event


async def generate_images_with_react_loop(
    image_types: List[str],
    product_name: str,
    selling_points: str,
    ecom_platform: str,
    aspect_ratio: str,
    target_country: str,
    style_preference: str,
    color_palette: List[str],
    neg_prompt: str,
    image_model_key: str,
    design_plan: Optional[Dict[str, Any]],
    cheap_model_config: Dict[str, str],
    vision_model_config: Dict[str, str],
    max_rounds: int = 5,
    quality_threshold: int = 80,
    abandon_threshold: int = 50,
    canvas_context: str = "",
    current_images: Dict[str, str] = None,
    stitch_regions: List[Dict[str, Any]] = None,
    canvas_snapshot: str = "",
    mask_data: Any = None,
    rag_retriever: Any = None,
):
    """Layer 2: ReAct Generation Loop with Think→Act→Observe→Reflect.

    This is an async generator that yields SSE events for each step in the loop,
    allowing the frontend to see evaluation progress in real-time.

    If canvas_context is provided, the Think phase can emit tool_call SSE events
    enabling the LLM to query canvas state via function calling.

    Yields: evaluation_progress, tool_call, image_progress, image_done events
    """
    if current_images is None:
        current_images = {}
    if stitch_regions is None:
        stitch_regions = []
    size_doubao = map_aspect_ratio_to_size(aspect_ratio)
    generated_images: Dict[str, str] = {}
    all_prompts: Dict[str, str] = {}
    all_evaluations: Dict[str, List[Dict[str, Any]]] = {}
    errors: List[str] = []

    for img_type in image_types:
        config = IMAGE_TYPE_CONFIGS.get(img_type)
        if not config:
            logger.warning(f"[ReAct Loop] Unknown image type: {img_type}, skipping")
            continue

        img_type_name = config["name"]
        previous_attempts: List[Dict[str, Any]] = []
        best_image_url = None
        best_score = 0
        best_prompt = ""
        round_num = 0
        img_evaluations: List[Dict[str, Any]] = []

        # ── ReAct Loop for this image type ──
        while round_num < max_rounds:
            # THINK: Generate/revise prompt
            yield {
                "event": "evaluation_progress",
                "image_type": img_type,
                "image_type_name": img_type_name,
                "status": "thinking",
                "round": round_num + 1,
                "max_rounds": max_rounds,
            }

            if round_num == 0:
                yield {
                    "event": "agent_message",
                    "agent": "designer",
                    "text": f"正在为 {img_type_name} 生成图片...",
                }
            else:
                yield {
                    "event": "agent_message",
                    "agent": "designer",
                    "text": f"正在为 {img_type_name} 生成第 {round_num + 1} 轮优化版本...",
                }

            # ── Canvas-aware Think: let LLM query canvas state via tool calls ──
            canvas_query_result = None
            if canvas_context and round_num == 0:
                try:
                    api_key = cheap_model_config.get("api_key", "")
                    if api_key:
                        # Ask LLM whether it needs canvas state info
                        tool_check_messages = [
                            {
                                "role": "system",
                                "content": (
                                    "你是一个图片生成助手。在生成 prompt 之前，"
                                    "如果需要了解当前画布上的图片信息或用户框选的修改区域，"
                                    "请调用相关函数获取信息。如果不需要，直接回复 'no_tool_needed'。"
                                ),
                            },
                            {
                                "role": "user",
                                "content": (
                                    f"准备为产品 '{product_name}' 生成 {img_type_name}。\n"
                                    f"用户修改需求上下文: {canvas_context[:500]}\n"
                                    f"是否需要查询画布状态？"
                                ),
                            },
                        ]
                        primary_config = {
                            "protocol": "openai",
                            "api_key": api_key,
                            "base_url": cheap_model_config.get("base_url", "https://api.deepseek.com/v1"),
                            "model": cheap_model_config.get("model", "deepseek-chat"),
                        }
                        resp = await execute_chat_with_fallbacks_full(
                            tool_check_messages, primary_config, get_chat_fallback_configs(),
                            tools=CANVAS_TOOLS, tool_choice="auto",
                        )
                        tool_calls = resp.get("tool_calls", [])
                        if tool_calls:
                            for tc in tool_calls:
                                fn = tc.get("function", {})
                                tool_name = fn.get("name", "")
                                logger.info(f"[ReAct Loop] LLM requested tool: {tool_name}")
                                # Emit tool_call SSE event for frontend
                                yield {
                                    "event": "tool_call",
                                    "tool": tool_name,
                                    "args": fn.get("arguments", {}),
                                    "image_type": img_type,
                                }
                                # Provide canvas state as tool result inline
                                if tool_name == "get_canvas_state":
                                    canvas_query_result = {
                                        "current_images": current_images,
                                        "canvas_snapshot": canvas_snapshot,
                                    }
                                elif tool_name == "get_stitch_regions":
                                    canvas_query_result = {
                                        "stitch_regions": stitch_regions,
                                        "mask_data": mask_data,
                                    }
                except Exception as tool_err:
                    logger.warning(f"[ReAct Loop] Canvas tool query failed (non-fatal): {tool_err}")

            prompt = await generate_dynamic_prompt(
                img_type=img_type,
                design_plan=design_plan,
                product_name=product_name,
                selling_points=selling_points,
                ecom_platform=ecom_platform,
                target_country=target_country,
                style_preference=style_preference,
                color_palette=color_palette,
                aspect_ratio=aspect_ratio,
                previous_attempts=previous_attempts,
                round_num=round_num,
                cheap_model_config=cheap_model_config,
                rag_retriever=rag_retriever,
                canvas_context=json.dumps(canvas_query_result, ensure_ascii=False) if canvas_query_result else "",
            )

            # ACT: Call image generation API
            yield {
                "event": "evaluation_progress",
                "image_type": img_type,
                "image_type_name": img_type_name,
                "status": "generating",
                "round": round_num + 1,
                "max_rounds": max_rounds,
            }

            img_url = None
            gen_errors = []
            # Try primary image model
            if image_model_key:
                try:
                    logger.info(f"[ReAct Loop] Type '{img_type}' Round {round_num}: Generating...")
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

            if not img_url:
                logger.error(f"[ReAct Loop] Type '{img_type}' Round {round_num}: Generation failed")
                break  # Can't evaluate without an image

            # OBSERVE: Evaluate image quality
            yield {
                "event": "evaluation_progress",
                "image_type": img_type,
                "image_type_name": img_type_name,
                "status": "evaluating",
                "round": round_num + 1,
                "max_rounds": max_rounds,
            }

            evaluation = await evaluate_image(
                image_url=img_url,
                img_type=img_type,
                design_plan=design_plan,
                product_name=product_name,
                ecom_platform=ecom_platform,
                vision_model_config=vision_model_config,
                cheap_model_config=cheap_model_config,
            )

            score = evaluation.get("overall_score", 0)
            passed = evaluation.get("passed", False)
            img_evaluations.append(evaluation)

            yield {
                "event": "evaluation_progress",
                "image_type": img_type,
                "image_type_name": img_type_name,
                "status": "evaluated",
                "round": round_num + 1,
                "max_rounds": max_rounds,
                "score": score,
                "passed": passed,
                "issues": evaluation.get("issues", []),
                "suggestions": evaluation.get("suggestions", []),
            }

            # Track best result
            if img_url and score > best_score:
                best_score = score
                best_image_url = img_url
                best_prompt = prompt

            attempt_record = {
                "round": round_num,
                "prompt": prompt,
                "image_url": img_url,
                "evaluation": evaluation,
            }
            previous_attempts.append(attempt_record)

            # REFLECT: Decide next step
            if passed and score >= quality_threshold:
                logger.info(f"[ReAct Loop] Type '{img_type}': PASSED at round {round_num} (score={score})")
                break

            if round_num >= 2 and score < abandon_threshold:
                logger.info(f"[ReAct Loop] Type '{img_type}': ABANDONED at round {round_num} (score={score} < {abandon_threshold})")
                break

            round_num += 1

        # ── Save best result for this image type ──
        if best_image_url:
            generated_images[img_type] = best_image_url
            all_prompts[img_type] = best_prompt
            all_evaluations[img_type] = img_evaluations
            yield {
                "event": "image_progress",
                "image_type": img_type,
                "url": best_image_url,
                "prompt": best_prompt,
                "best_score": best_score,
                "rounds_used": len(previous_attempts),
            }
        else:
            errors.append(f"Type '{img_type}': ALL attempts failed in {round_num + 1} rounds")
            logger.error(f"[ReAct Loop] Type '{img_type}': ALL attempts failed")

        await asyncio.sleep(0.05)

    # ── Final result ──
    result: Dict[str, Any] = {
        "generated_images": generated_images,
        "prompts": all_prompts,
        "evaluations": all_evaluations,
        "current_phase": "DONE",
    }

    if errors:
        result["error"] = f"Some image types failed: {'; '.join(errors)}"
        if not generated_images:
            result["error"] = f"All image generation failed. Errors: {'; '.join(errors)}"

    if generated_images:
        yield {"event": "image_done", "all_images": generated_images}
    elif errors:
        yield {"event": "image_done", "all_images": generated_images, "warning": result.get("error", "")}


async def extract_modify_intent(
    message: str,
    product_name: str,
    selling_points: str,
    existing_image_types: List[str],
    existing_style: str,
    cheap_model_config: Dict[str, str],
    canvas_context: str = "",
) -> Dict[str, Any]:
    """Extract structured modify intent from user message using LLM.

    Args:
        canvas_context: Optional canvas state context (current images, stitch regions, etc.)
                        injected to help the LLM understand what's on the canvas.

    Returns a dict with modify_type, target_image_types, modification_description, etc.
    """
    api_key = cheap_model_config.get("api_key", "")
    if not api_key:
        # Fallback to keyword matching
        return _extract_modify_by_keywords(message, existing_image_types, existing_style)

    user_prompt = (
        f"当前产品: {product_name}\n"
        f"卖点: {selling_points}\n"
        f"已有图片类型: {existing_image_types}\n"
        f"当前风格: {existing_style}\n\n"
        f"用户修改需求: {message}"
    )

    # Inject canvas context if available
    if canvas_context:
        user_prompt = canvas_context + "\n" + user_prompt

    messages = [
        {"role": "system", "content": MODIFY_INTENT_WITH_CANVAS_PROMPT},
        {"role": "user", "content": user_prompt},
    ]

    try:
        primary_config = {
            "protocol": "openai",
            "api_key": api_key,
            "base_url": cheap_model_config.get("base_url", "https://api.deepseek.com/v1"),
            "model": cheap_model_config.get("model", "deepseek-chat"),
        }
        resp = await execute_chat_with_fallbacks(
            messages, primary_config, get_chat_fallback_configs()
        )
        cleaned = clean_json_string(resp)
        result = json.loads(cleaned)
        logger.info(f"[Modify Intent] Type: {result.get('modify_type', 'unknown')}")
        return result
    except Exception as e:
        logger.warning(f"[Modify Intent] LLM extraction failed: {e}, falling back to keywords")
        return _extract_modify_by_keywords(message, existing_image_types, existing_style)


def _extract_modify_by_keywords(
    message: str,
    existing_image_types: List[str],
    existing_style: str,
) -> Dict[str, Any]:
    """Keyword-based modify intent extraction fallback."""
    new_image_types = list(existing_image_types)
    user_lower = message.lower()
    for img_type, config in IMAGE_TYPE_CONFIGS.items():
        name = config["name"]
        if name in message or img_type in user_lower:
            new_image_types = [img_type]
            break

    new_style = existing_style
    style_keywords = ["暖色调", "冷色调", "极简", "复古", "科技", "自然", "暗黑", "明亮", "柔和"]
    for kw in style_keywords:
        if kw in message:
            new_style = kw
            break

    return {
        "modify_type": "style_change" if new_style != existing_style else "new_image_type",
        "target_image_types": new_image_types,
        "modification_description": message,
        "new_constraints": message,
        "style_update": new_style,
        "color_update": [],
    }


async def classify_intent(
    message: str,
    current_phase: str,
    has_product_info: bool,
    cheap_model_config: Dict[str, str],
) -> Dict[str, Any]:
    """Classify user intent into fine-grained 9-intent system with sub_intents.

    Uses FINE_GRAINED_INTENT_CLASSIFIER_PROMPT for structured JSON output.
    Falls back to keyword matching on any error.
    Returns: {"intent": "...", "sub_intent": "...", "target_scope": "...", "target_image_types": [...], "confidence": 0.9}
    """
    api_key = cheap_model_config.get("api_key", "")
    if not api_key:
        return {"intent": "new_design", "sub_intent": "", "target_scope": "all_images", "target_image_types": [], "confidence": 0.5}

    # Build classification context
    phase_context = f"当前阶段: {current_phase}"
    info_context = "已有完整产品信息" if has_product_info else "产品信息不完整"

    messages = [
        {"role": "system", "content": FINE_GRAINED_INTENT_CLASSIFIER_PROMPT},
        {"role": "user", "content": f"{phase_context}\n{info_context}\n用户消息: {message}"},
    ]

    try:
        primary_config = {
            "protocol": "openai",
            "api_key": api_key,
            "base_url": cheap_model_config.get("base_url", "https://api.deepseek.com/v1"),
            "model": cheap_model_config.get("model", "deepseek-chat"),
        }
        resp = await execute_chat_with_fallbacks(
            messages, primary_config, get_chat_fallback_configs()
        )
        result = parse_intent_result(resp)
        logger.info(f"[Intent] Classified: {result['intent']} sub={result.get('sub_intent', '')} scope={result.get('target_scope', '')} confidence={result.get('confidence', 0)}")
        return result
    except Exception as e:
        logger.error(f"[Intent] Classification failed: {e}, falling back to keyword match")
        return _classify_intent_by_keywords(message, has_product_info, current_phase)


def _classify_intent_by_keywords(
    message: str,
    has_product_info: bool,
    current_phase: str,
) -> Dict[str, Any]:
    """Keyword-based intent classification fallback when LLM is unavailable."""
    msg_lower = message.lower()

    # Chitchat / ask_question
    chitchat_patterns = ["你是谁", "你能做什么", "功能", "天气", "讲个笑话", "你好", "hello", "hi", "帮助", "怎么用"]
    if any(p in msg_lower for p in chitchat_patterns) and not has_product_info:
        if any(p in msg_lower for p in ["你能做什么", "功能", "怎么用"]):
            return {"intent": "ask_question", "sub_intent": "", "target_scope": "all_images", "target_image_types": [], "confidence": 0.8}
        return {"intent": "chitchat", "sub_intent": "", "target_scope": "all_images", "target_image_types": [], "confidence": 0.8}

    # Update brand
    brand_patterns = ["记住我的", "我的品牌", "品牌色", "品牌风格"]
    if any(p in msg_lower for p in brand_patterns):
        return {"intent": "update_brand", "sub_intent": "", "target_scope": "all_images", "target_image_types": [], "confidence": 0.8}

    # Quick generate
    quick_patterns = ["直接生成", "快速生成", "马上生成", "帮我生成"]
    if any(p in msg_lower for p in quick_patterns) and has_product_info:
        return {"intent": "quick_generate", "sub_intent": "", "target_scope": "all_images", "target_image_types": [], "confidence": 0.7}

    # Add image type
    add_patterns = ["再加", "加一张", "加个", "增加", "多生成一张"]
    if any(p in msg_lower for p in add_patterns) and has_product_info:
        return {"intent": "add_image_type", "sub_intent": "", "target_scope": "all_images", "target_image_types": [], "confidence": 0.7}

    # Regenerate
    re_patterns = ["重新生成", "重做", "换风格", "重新来", "再生成一次"]
    if any(p in msg_lower for p in re_patterns) and has_product_info:
        return {"intent": "regenerate", "sub_intent": "new_style_retry", "target_scope": "all_images", "target_image_types": [], "confidence": 0.7}

    # Modify image
    modify_patterns = ["改成", "换成", "修改", "调整", "换背景", "换颜色", "删除", "去掉", "加点"]
    if any(p in msg_lower for p in modify_patterns) and has_product_info:
        return {"intent": "modify_image", "sub_intent": "other", "target_scope": "all_images", "target_image_types": [], "confidence": 0.7}

    # New design with product keywords → quick_generate (user provided product, just go)
    prod_patterns = ["耳机", "手机", "手表", "鞋子", "衣服", "产品", "商品", "主图", "场景", "电商", "amazon", "亚马逊", "淘宝", "天猫", "shopify", "lazada", "虾皮",
                     "保温杯", "杯子", "电脑", "笔记本", "平板", "键盘", "鼠标", "包", "化妆品", "口红", "面膜", "香水", "首饰", "项链", "戒指", "眼镜",
                     "食品", "零食", "饮料", "茶", "咖啡", "家具", "灯", "沙发", "椅子", "桌子", "玩具", "书", "花", "植物"]
    has_product_keywords = any(p in msg_lower for p in prod_patterns)
    if not has_product_info and has_product_keywords:
        return {"intent": "quick_generate", "sub_intent": "", "target_scope": "all_images", "target_image_types": [], "confidence": 0.7}

    # Continue collecting — only if in COLLECTING_INFO, no product info yet, and message looks like a follow-up
    if current_phase == "COLLECTING_INFO" and not has_product_info:
        return {"intent": "continue_collecting", "sub_intent": "", "target_scope": "all_images", "target_image_types": [], "confidence": 0.7}

    # Default: new design (user intent unclear, need to ask)
    return {"intent": "new_design", "sub_intent": "", "target_scope": "all_images", "target_image_types": [], "confidence": 0.6}


async def _extract_brand_update(
    message: str,
    cheap_model_config: Dict[str, str],
) -> Dict[str, Any]:
    """Extract brand preferences from user message via lightweight LLM call.

    Returns dict with optional: brand_name, brand_style, color_palette, style_preference, reply
    """
    api_key = cheap_model_config.get("api_key", "")
    if not api_key:
        return {"reply": "已记住你的品牌偏好！"}

    prompt = (
        "从用户消息中提取品牌偏好信息，输出JSON：\n"
        "{\n"
        '  "brand_name": "品牌名（如有）",\n'
        '  "brand_style": "品牌风格描述（如有）",\n'
        '  "color_palette": ["颜色1", "颜色2"],\n'
        '  "style_preference": "风格偏好（如有）",\n'
        '  "reply": "确认回复（1句话）"\n'
        "}\n\n"
        f"用户消息: {message}"
    )

    try:
        primary_config = {
            "protocol": "openai",
            "api_key": api_key,
            "base_url": cheap_model_config.get("base_url", "https://api.deepseek.com/v1"),
            "model": cheap_model_config.get("model", "deepseek-chat"),
        }
        resp = await execute_chat_with_fallbacks(
            [{"role": "user", "content": prompt}],
            primary_config,
            get_chat_fallback_configs(),
        )
        cleaned = clean_json_string(resp)
        result = json.loads(cleaned)
        logger.info(f"[Brand Update] Extracted: {result.get('brand_name', '')} / {result.get('brand_style', '')}")
        return result
    except Exception as e:
        logger.warning(f"[Brand Update] Extraction failed: {e}")
        return {"reply": f"已记住你的偏好！"}


async def handle_chitchat(
    message: str,
    chat_history: List[Dict[str, str]],
    cheap_model_config: Dict[str, str],
) -> Dict[str, Any]:
    """Handle chitchat/introductory questions with a friendly response."""
    api_key = cheap_model_config.get("api_key", "")
    if not api_key:
        return {
            "chat_history": list(chat_history),
            "current_phase": "COLLECTING_INFO",
        }

    messages = [
        {"role": "system", "content": CHITCHAT_SYSTEM_PROMPT},
    ]
    for msg in chat_history[-4:]:  # Only recent context
        messages.append({"role": msg.get("role", "user"), "content": msg.get("content", "")})
    messages.append({"role": "user", "content": message})

    try:
        primary_config = {
            "protocol": "openai",
            "api_key": api_key,
            "base_url": cheap_model_config.get("base_url", "https://api.deepseek.com/v1"),
            "model": cheap_model_config.get("model", "deepseek-chat"),
        }
        resp = await execute_chat_with_fallbacks(
            messages, primary_config, get_chat_fallback_configs()
        )

        new_history = list(chat_history)
        new_history.append({"role": "user", "content": message})
        new_history.append({"role": "assistant", "content": resp})

        return {
            "chat_history": new_history,
            "current_phase": "COLLECTING_INFO",
            "chitchat_reply": resp,
        }
    except Exception as e:
        logger.warning(f"[Chitchat] Failed: {e}")
        return {
            "chat_history": list(chat_history),
            "current_phase": "COLLECTING_INFO",
        }


async def collect_info(
    chat_history: List[Dict[str, str]],
    message: str,
    cheap_model_config: Dict[str, str],
    vision_model_config: Dict[str, str],
    product_image_base64: str,
    brand_memory: Dict[str, Any],
    memory: "AgentMemory" = None,
) -> Dict[str, Any]:
    """Phase 1: Collect product info via LLM conversation.

    If AgentMemory already has product info, it will be injected into the prompt
    so the LLM can directly return __INFO_COMPLETE__ instead of asking questions.

    Returns a dict with:
      - current_phase: "COLLECTING_INFO" (need more info) or "GENERATING_IMAGES" (ready)
      - chat_history: updated conversation
      - product_name, selling_points, image_types, ... (when GENERATING_IMAGES)
    """
    api_key = cheap_model_config.get("api_key", "")
    base_url = cheap_model_config.get("base_url", "https://api.deepseek.com/v1")
    model_name = cheap_model_config.get("model", "deepseek-chat")

    if not api_key:
        return {"error": "Cheap model API Key is not configured.", "current_phase": "DONE"}

    has_product_image = bool(product_image_base64)

    # Build system prompt with brand memory and existing memory context
    system_prompt = COLLECT_INFO_SYSTEM_PROMPT + _build_brand_context(brand_memory)

    # If AgentMemory already has product info, inject it so LLM knows info is complete
    memory_context = ""
    if memory and memory.product_name and memory.selling_points:
        memory_context = (
            f"\n\n[系统提示] 以下产品信息已由用户通过表单提供，无需重复询问：\n"
            f"- 产品名称: {memory.product_name}\n"
            f"- 核心卖点: {memory.selling_points}\n"
            f"- 电商平台: {memory.ecom_platform or '未指定'}\n"
            f"- 图片比例: {memory.aspect_ratio}\n"
            f"- 目标国家: {memory.target_country or '未指定'}\n"
            f"- 图片类型: {', '.join(memory.image_types) if memory.image_types else '未指定'}\n"
            f"- 风格偏好: {memory.style_preference or '未指定'}\n"
            f"\n请在回复中直接输出 __INFO_COMPLETE__ 标记，然后用 JSON 格式返回上述所有字段。"
        )

    # Build messages
    messages = [{"role": "system", "content": system_prompt + memory_context}]
    for msg in chat_history:
        messages.append({"role": msg.get("role", "user"), "content": msg.get("content", "")})

    # Add user message (with image if present)
    if has_product_image and not any(
        "product_image" in (msg.get("content", "") if msg.get("role") == "user" else "")
        for msg in chat_history[-3:]
    ):
        image_url = f"data:image/jpeg;base64,{product_image_base64}"
        user_content = [
            {"type": "text", "text": message + "\n\n[用户已上传产品图片，请基于图片中的产品外观进行信息提取]"},
            {"type": "image_url", "image_url": {"url": image_url, "detail": "auto"}},
        ]
        messages.append({"role": "user", "content": user_content})
    else:
        messages.append({"role": "user", "content": message})

    # Choose primary config: vision model if image present, else cheap model
    vision_api_key = vision_model_config.get("api_key", "")
    if has_product_image and vision_api_key:
        primary_config = {
            "protocol": "openai",
            "api_key": vision_api_key,
            "base_url": vision_model_config.get("base_url", "https://api.openai.com/v1"),
            "model": vision_model_config.get("model", "gpt-4o"),
        }
        logger.info(f"[Collect Info] Using vision model {vision_model_config.get('model', 'gpt-4o')}")
    else:
        primary_config = {
            "protocol": "openai",
            "api_key": api_key,
            "base_url": base_url,
            "model": model_name,
        }

    try:
        resp_text = await execute_chat_with_fallbacks(messages, primary_config, get_chat_fallback_configs())

        new_history = list(chat_history)
        new_history.append({"role": "user", "content": message})
        new_history.append({"role": "assistant", "content": resp_text})

        if "__INFO_COMPLETE__" in resp_text:
            # Extract structured info via a second LLM call
            extract_messages = [
                {"role": "system", "content": EXTRACT_JSON_SYSTEM_PROMPT},
                {"role": "user", "content": "对话历史：\n" + "\n".join(
                    f"{'用户' if m['role']=='user' else '助手'}: {m['content']}"
                    for m in new_history[-10:]
                )},
            ]

            try:
                extract_resp = await execute_chat_with_fallbacks(
                    extract_messages, primary_config, get_chat_fallback_configs()
                )
                cleaned = clean_json_string(extract_resp)
                extracted = json.loads(cleaned)

                return {
                    "chat_history": new_history,
                    "current_phase": "GENERATING_IMAGES",
                    "product_name": extracted.get("product_name", ""),
                    "selling_points": extracted.get("selling_points", ""),
                    "ecom_platform": extracted.get("ecom_platform", ""),
                    "aspect_ratio": extracted.get("aspect_ratio", "1:1"),
                    "language": extracted.get("language", "zh"),
                    "target_country": extracted.get("target_country", ""),
                    "image_types": extracted.get("image_types", ["main"]),
                    "style_preference": extracted.get("style_preference", ""),
                    "color_palette": extracted.get("color_palette", []),
                    "negative_prompt": extracted.get("negative_prompt", "低画质、变形肢体、模糊、水印"),
                }
            except Exception as extract_err:
                logger.warning(f"[Collect Info] Extraction failed: {extract_err}, attempting regex fallback")
                basic_info = _extract_basic_info_from_history(new_history)
                return {
                    "chat_history": new_history,
                    "current_phase": "GENERATING_IMAGES",
                    "product_name": basic_info.get("product_name", "product"),
                    "selling_points": basic_info.get("selling_points", "high quality"),
                    "image_types": ["main"],
                    "aspect_ratio": "1:1",
                    "language": "zh",
                    "negative_prompt": "低画质、变形肢体、模糊、水印",
                }
        else:
            return {
                "chat_history": new_history,
                "current_phase": "COLLECTING_INFO",
            }
    except Exception as e:
        return {"error": f"Info collection failed: {str(e)}", "current_phase": "DONE"}


# ========================================================
# Phase 2: Image Generation
# ========================================================

async def _generate_single_image_type(
    img_type: str,
    prompt: str,
    aspect_ratio: str,
    neg_prompt: str,
    image_model_key: str,
    size_doubao: str,
    image_model_name: str = "doubao-seedream-5-0-260128",
) -> tuple:
    """Generate a single image type with fallback chain. Returns (img_type, image_url_or_None, errors_list)."""
    image_url = None
    gen_errors = []

    # 1. Try Primary Image Model (Doubao/Volcengine ARK Seedream)
    if image_model_key:
        try:
            logger.info(f"[Generate Images] Type '{img_type}': Trying Primary image model ({image_model_name})")
            url = os.getenv("IMAGE_API_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3/images/generations")
            headers = {
                "Authorization": f"Bearer {image_model_key}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": image_model_name,
                "prompt": prompt,
                "size": size_doubao,
                "response_format": "url",
                "extra_body": {
                    "watermark": True,
                },
            }
            if neg_prompt:
                payload["negative_prompt"] = neg_prompt
            async with httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=30.0)) as client:
                response = await client.post(url, headers=headers, json=payload)
                if response.status_code == 200:
                    data = response.json()
                    images = data.get("data", [])
                    if images:
                        image_url = images[0].get("url")
                        logger.info(f"[Generate Images] Type '{img_type}': Success via Primary")
                else:
                    gen_errors.append(f"Primary API error (HTTP {response.status_code}): {response.text[:200]}")
        except Exception as e:
            gen_errors.append(f"Primary connection failed: {str(e)}")

    # 2. Try Fallbacks if primary failed
    if not image_url:
        fallback_configs = get_image_fallback_configs()
        for idx, fb_config in enumerate(fallback_configs):
            if not fb_config.get("api_key"):
                continue
            try:
                protocol = fb_config["protocol"].lower().strip()
                logger.info(f"[Generate Images] Type '{img_type}': Trying Image Fallback {idx+1} ({fb_config['model']})")
                if protocol == "openai":
                    image_url = await call_openai_image_api(
                        prompt, map_ratio_for_openai_image(aspect_ratio), neg_prompt, fb_config
                    )
                elif protocol == "anthropic":
                    image_url = await call_anthropic_svg_generator(prompt, neg_prompt, fb_config)
                if image_url:
                    break
            except Exception as e:
                gen_errors.append(f"Fallback {idx+1} failed: {str(e)}")

    return (img_type, image_url, gen_errors)


async def generate_images(
    image_types: List[str],
    product_name: str,
    selling_points: str,
    ecom_platform: str,
    aspect_ratio: str,
    target_country: str,
    style_preference: str,
    color_palette: List[str],
    neg_prompt: str,
    image_model_key: str,
) -> Dict[str, Any]:
    """Phase 2: Generate images for each selected image type in parallel.

    Returns a dict with generated_images, prompts, and error (if any).
    """
    size_doubao = map_aspect_ratio_to_size(aspect_ratio)

    prompts: Dict[str, str] = {}
    format_vars = {
        "product_name": product_name,
        "selling_points": selling_points,
        "ecom_platform": ecom_platform or "general e-commerce",
        "target_country": target_country or "global",
        "style_preference": style_preference,
    }

    if color_palette:
        format_vars["style_preference"] = f"{style_preference}, color palette: {', '.join(color_palette)}"

    tasks = []
    for img_type in image_types:
        config = IMAGE_TYPE_CONFIGS.get(img_type)
        if not config:
            logger.warning(f"[Generate Images] Unknown image type: {img_type}, skipping")
            continue

        try:
            prompt = config["prompt_template"].format(**format_vars)
        except KeyError:
            prompt = config["prompt_template"].replace("{product_name}", product_name).replace("{selling_points}", selling_points).replace("{style_preference}", style_preference).replace("{ecom_platform}", ecom_platform or "general e-commerce").replace("{target_country}", target_country or "global")

        if ecom_platform and "amazon" in ecom_platform.lower():
            prompt += " Amazon-compliant product image, pure white background (RGB 255,255,255), no text on image."
        elif ecom_platform and "shopify" in ecom_platform.lower():
            prompt += " Lifestyle product photography, warm and inviting."

        if aspect_ratio == "9:16":
            prompt += " Vertical/portrait orientation for mobile-first platforms."
        elif aspect_ratio == "16:9":
            prompt += " Horizontal/landscape orientation for banners."

        prompts[img_type] = prompt
        tasks.append(
            _generate_single_image_type(
                img_type, prompt, aspect_ratio, neg_prompt,
                image_model_key, size_doubao
            )
        )

    generated_images: Dict[str, str] = {}
    errors: List[str] = []

    if tasks:
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for result in results:
            if isinstance(result, Exception):
                errors.append(f"Task exception: {str(result)}")
                continue
            img_type, image_url, gen_errors = result
            if image_url:
                generated_images[img_type] = image_url
            else:
                errors.append(f"Type '{img_type}': {'; '.join(gen_errors)}" if gen_errors else f"Type '{img_type}': ALL attempts failed")
                logger.error(f"[Generate Images] Type '{img_type}': ALL attempts failed")

    result: Dict[str, Any] = {
        "generated_images": generated_images,
        "prompts": prompts,
        "current_phase": "DONE",
    }

    if errors:
        result["error"] = f"Some image types failed to generate: {'; '.join(errors)}"
        if not generated_images:
            result["error"] = f"All image generation failed. Errors: {'; '.join(errors)}"

    return result


# ========================================================
# Pipeline Orchestrator (replaces LangGraph StateGraph)
# ========================================================

async def run_pipeline(inputs: Dict[str, Any]) -> Dict[str, Any]:
    """Run the unified agent (blocking). Collects all events into a result dict."""
    result = {
        "generated_images": {},
        "prompts": {},
        "current_phase": "COLLECTING_INFO",
        "error": "",
    }

    async for event in run_pipeline_stream(inputs):
        if event.get("event") == "image_progress":
            img_type = event.get("image_type", "")
            img_url = event.get("url", "")
            if img_type and img_url:
                result["generated_images"][img_type] = img_url
                result["prompts"][img_type] = event.get("prompt", "")
        elif event.get("event") == "image_done":
            result["all_images"] = event.get("all_images", {})
            result["current_phase"] = "DONE"
        elif event.get("event") == "memory_updated":
            result["agent_memory"] = event.get("agent_memory", {})
        elif event.get("event") == "error":
            result["error"] = event.get("message", "")

    return result


async def run_pipeline_stream(inputs: Dict[str, Any]):
    """Unified Agent pipeline — single LLM call with tools replaces the entire
    multi-layer architecture.

    The LLM handles: intent understanding, product info extraction, prompt
    writing, image generation, evaluation, and task completion — all in one
    tool-calling conversation loop.

    Yields SSE event dicts that can be serialized to JSON.
    """
    rag_retriever = inputs.get("rag_retriever")
    message = inputs.get("message", "")
    current_phase = inputs.get("current_phase", "COLLECTING_INFO")
    product_name = inputs.get("product_name", "")
    selling_points = inputs.get("selling_points", "")

    cheap_model_config = {
        "api_key": inputs.get("cheap_model_api_key", ""),
        "base_url": inputs.get("cheap_model_base_url", "https://api.deepseek.com/v1"),
        "model": inputs.get("cheap_model_name", "deepseek-chat"),
    }
    vision_model_config = {
        "api_key": inputs.get("chat_vision_model_api_key", ""),
        "base_url": inputs.get("chat_vision_model_base_url", "https://api.openai.com/v1"),
        "model": inputs.get("chat_vision_model_name", "gpt-4o"),
    }

    # ── Load AgentMemory ──
    memory = AgentMemory.from_dict(inputs.get("agent_memory"))
    memory.add_chat_turn("user", message)
    memory.current_phase = current_phase

    # Sync product info from inputs into memory
    if product_name and not memory.product_name:
        memory.product_name = product_name
    if selling_points and not memory.selling_points:
        memory.selling_points = selling_points
    if inputs.get("image_types") and not memory.image_types:
        memory.image_types = inputs.get("image_types", [])
    if inputs.get("style_preference") and not memory.style_preference:
        memory.style_preference = inputs.get("style_preference", "")
    if inputs.get("ecom_platform") and not memory.ecom_platform:
        memory.ecom_platform = inputs.get("ecom_platform", "")
    if inputs.get("aspect_ratio") and memory.aspect_ratio == "1:1":
        memory.aspect_ratio = inputs.get("aspect_ratio", "1:1")
    if inputs.get("target_country") and not memory.target_country:
        memory.target_country = inputs.get("target_country", "")
    if inputs.get("color_palette") and not memory.color_palette:
        memory.color_palette = inputs.get("color_palette", [])
    if inputs.get("current_images"):
        memory.current_images = inputs.get("current_images", {})
    if inputs.get("stitch_regions"):
        memory.stitch_regions = inputs.get("stitch_regions", [])

    # Flow control flags from frontend
    if inputs.get("skip_info_collection"):
        memory.skip_info_collection = True
    if inputs.get("skip_design_planning"):
        memory.skip_design_planning = True
    if inputs.get("single_image_mode"):
        memory.single_image_mode = True
        memory.target_single_type = inputs.get("target_single_type", "")
    if inputs.get("refinement_mode"):
        memory.refinement_mode = True

    # ── Check for AGENT_MODE=legacy ──
    agent_mode = os.environ.get("AGENT_MODE", "unified")
    if agent_mode == "legacy":
        logger.info("[Pipeline] Using legacy multi-layer pipeline")
        async for event in _run_pipeline_stream_legacy(
            inputs, memory, cheap_model_config, vision_model_config, rag_retriever
        ):
            yield event
        return

    # ── Unified Agent: one LLM call with tools ──
    logger.info(f"[Pipeline] Unified agent mode — message: {message[:100]}")

    yield {
        "event": "agent_message",
        "agent": "agent",
        "text": "",
    }

    image_model_key = inputs.get("image_model_api_key", "")

    async for event in run_unified_agent(
        message=message,
        memory=memory,
        cheap_model_config=cheap_model_config,
        vision_model_config=vision_model_config,
        image_model_key=image_model_key,
        rag_retriever=rag_retriever,
        product_image_base64=inputs.get("product_image_base64", ""),
    ):
        yield event


async def _run_pipeline_stream_legacy(
    inputs: Dict[str, Any],
    memory: AgentMemory,
    cheap_model_config: Dict[str, str],
    vision_model_config: Dict[str, str],
    rag_retriever: Any,
):
    """Legacy multi-layer pipeline. Kept for AGENT_MODE=legacy backward compat.

    This is the OLD behavior: classify_intent → route → collect_info → plan_design → ReAct.
    """
    message = inputs.get("message", "")
    current_phase = inputs.get("current_phase", "COLLECTING_INFO")
    chat_history = inputs.get("chat_history", [])

    # ── Layer 0: Intent Classification ──
    has_product_info = bool(memory.product_name and memory.selling_points)
    intent_result = await classify_intent(message, current_phase, has_product_info, cheap_model_config)
    intent = intent_result.get("intent", "new_design")
    memory.last_intent = intent

    yield {
        "event": "intent_detected",
        "intent": intent,
        "sub_intent": intent_result.get("sub_intent", ""),
        "target_scope": intent_result.get("target_scope", "all_images"),
        "target_image_types": intent_result.get("target_image_types", []),
        "confidence": intent_result.get("confidence", 0),
        "current_phase": current_phase,
    }

    # Get routing action
    routing = get_routing_action(intent_result, memory)

    # ── Route: Chitchat ──
    if routing["action"] == "chitchat":
        chitchat_result = await handle_chitchat(message, chat_history, cheap_model_config)
        memory.add_chat_turn("assistant", chitchat_result.get("chitchat_reply", ""))
        yield {
            "event": "chitchat_reply",
            "phase": current_phase,
            "text": chitchat_result.get("chitchat_reply", ""),
            "chat_history": chitchat_result.get("chat_history", []),
        }
        yield {"event": "memory_updated", "agent_memory": memory.to_dict()}
        yield {"event": "done"}
        return

    # ── Route: Ask Question ──
    if routing["action"] == "ask_question":
        ask_result = await handle_chitchat(message, chat_history, cheap_model_config)
        memory.add_chat_turn("assistant", ask_result.get("chitchat_reply", ""))
        yield {
            "event": "chitchat_reply",
            "phase": current_phase,
            "text": ask_result.get("chitchat_reply", ""),
            "chat_history": ask_result.get("chat_history", []),
        }
        yield {"event": "memory_updated", "agent_memory": memory.to_dict()}
        yield {"event": "done"}
        return

    # ── Route: Update Brand ──
    if routing["action"] == "update_brand":
        yield {"event": "phase_start", "phase": "UPDATE_BRAND"}
        yield {
            "event": "agent_message",
            "agent": "coordinator",
            "text": "好的，我来记住你的品牌偏好...",
        }
        brand_update = await _extract_brand_update(message, cheap_model_config)
        if brand_update.get("brand_name"):
            memory.update_brand(
                brand_name=brand_update.get("brand_name", ""),
                brand_style=brand_update.get("brand_style", ""),
            )
        if brand_update.get("color_palette"):
            memory.color_palette = brand_update["color_palette"]
        if brand_update.get("style_preference"):
            memory.style_preference = brand_update["style_preference"]

        memory.add_chat_turn("assistant", brand_update.get("reply", "已记住你的品牌偏好！"))
        yield {
            "event": "agent_message",
            "agent": "coordinator",
            "text": brand_update.get("reply", "已记住你的品牌偏好！"),
        }
        yield {"event": "memory_updated", "agent_memory": memory.to_dict()}
        yield {"event": "done"}
        return

    # ── Route: New Design (reset memory) ──
    if routing["action"] == "new_design" or routing.get("reset_memory"):
        memory.reset_for_new_design()
        yield {
            "event": "new_design_started",
            "phase": "COLLECTING_INFO",
            "text": "好的，让我们开始新的设计！请告诉我你的产品信息和需要的图片类型。",
        }

    # ── Route: Modify Image ──
    if routing["action"] == "modify" and has_product_info:
        yield {"event": "phase_start", "phase": "MODIFY"}
        yield {
            "event": "agent_message",
            "agent": "coordinator",
            "text": "好的，根据你的需求调整图片设计...",
        }

        canvas_context = _build_canvas_context(inputs)
        if canvas_context:
            logger.info(f"[Pipeline Legacy] Canvas context built ({len(canvas_context)} chars)")

        modify_intent = await extract_modify_intent(
            message=message,
            product_name=memory.product_name,
            selling_points=memory.selling_points,
            existing_image_types=memory.image_types,
            existing_style=memory.style_preference,
            cheap_model_config=cheap_model_config,
            canvas_context=canvas_context,
        )

        new_image_types = modify_intent.get("target_image_types", memory.image_types)
        new_style = modify_intent.get("style_update") or memory.style_preference

        if routing.get("target_scope") == "single_image" and routing.get("target_image_types"):
            new_image_types = routing["target_image_types"]

        yield {
            "event": "info_complete",
            "phase": "MODIFY",
            "chat_history": chat_history,
        }
        yield {
            "event": "phase_complete",
            "phase": "MODIFY",
            "product_name": memory.product_name,
            "selling_points": memory.selling_points,
            "image_types": new_image_types,
        }

        design_plan = None
        if not memory.skip_design_planning:
            yield {"event": "phase_start", "phase": "DESIGN_PLANNING"}
            design_result = await plan_design(
                product_name=memory.product_name,
                selling_points=memory.selling_points,
                image_types=new_image_types,
                ecom_platform=memory.ecom_platform,
                target_country=memory.target_country,
                style_preference=new_style or memory.style_preference,
                color_palette=memory.color_palette,
                brand_memory=inputs.get("brand_memory", {}),
                cheap_model_config=cheap_model_config,
            )
            design_plan = design_result.get("design_plan")

        yield {"event": "phase_start", "phase": "GENERATING_IMAGES"}
        async for event in _run_generation_loop(
            memory=memory,
            image_types=new_image_types,
            product_name=memory.product_name,
            selling_points=memory.selling_points,
            ecom_platform=memory.ecom_platform,
            aspect_ratio=memory.aspect_ratio,
            target_country=memory.target_country,
            style_preference=new_style or memory.style_preference,
            color_palette=memory.color_palette,
            neg_prompt=memory.negative_prompt,
            image_model_key=inputs.get("image_model_api_key", ""),
            design_plan=design_plan,
            cheap_model_config=cheap_model_config,
            vision_model_config=vision_model_config,
            rag_retriever=rag_retriever,
            canvas_context=canvas_context,
            current_images=memory.current_images,
            stitch_regions=memory.stitch_regions,
            canvas_snapshot=inputs.get("canvas_snapshot", ""),
            mask_data=inputs.get("mask_data"),
        ):
            yield event

        yield {
            "event": "agent_message",
            "agent": "coordinator",
            "text": "所有图片已根据你的需求重新生成完成！",
        }
        yield {"event": "memory_updated", "agent_memory": memory.to_dict()}
        yield {"event": "done"}
        return

    # ── Normal Flow: Phase 1 → Layer 1 → Layer 2 ──
    phase1_result = None
    collect_inputs = dict(inputs)

    can_skip_info = (
        memory.skip_info_collection
        and memory.product_name
        and memory.image_types
    )

    if can_skip_info:
        yield {
            "event": "flow_decision",
            "decision": "skip_info_collection",
            "text": "信息齐全，跳过信息收集，直接进入设计规划...",
        }
        phase1_result = {
            "current_phase": "GENERATING_IMAGES",
            "product_name": memory.product_name,
            "selling_points": memory.selling_points,
            "image_types": memory.image_types,
            "ecom_platform": memory.ecom_platform,
            "aspect_ratio": memory.aspect_ratio,
            "target_country": memory.target_country,
            "style_preference": memory.style_preference,
            "color_palette": memory.color_palette,
            "negative_prompt": memory.negative_prompt,
            "chat_history": collect_inputs.get("chat_history", []),
        }
    else:
        yield {"event": "phase_start", "phase": "COLLECTING_INFO"}
        yield {
            "event": "agent_message",
            "agent": "coordinator",
            "text": "收到需求，让我先了解一下你的产品信息...",
        }

        if current_phase in ("DONE", "GENERATING_IMAGES") and intent in ("new_design", "generate"):
            collect_inputs["product_name"] = ""
            collect_inputs["selling_points"] = ""
            collect_inputs["image_types"] = []
            yield {
                "event": "new_design_started",
                "phase": "COLLECTING_INFO",
                "text": "好的，让我们开始新的设计！请告诉我你的产品信息和需要的图片类型。",
            }

        try:
            phase1_result = await collect_info(
                chat_history=collect_inputs.get("chat_history", []),
                message=message,
                cheap_model_config=cheap_model_config,
                vision_model_config=vision_model_config,
                product_image_base64=collect_inputs.get("product_image_base64", ""),
                brand_memory=collect_inputs.get("brand_memory", {}),
                memory=memory,
            )
        except Exception as e:
            yield {"event": "error", "message": f"Phase 1 failed: {str(e)}"}
            return

        if phase1_result.get("error"):
            yield {"event": "error", "message": phase1_result["error"]}
            return

        if phase1_result.get("current_phase") != "GENERATING_IMAGES":
            yield {
                "event": "info_complete",
                "phase": "COLLECTING_INFO",
                "chat_history": phase1_result.get("chat_history", []),
            }
            yield {"event": "done"}
            return

        yield {
            "event": "phase_complete",
            "phase": "COLLECTING_INFO",
            "product_name": phase1_result.get("product_name", ""),
            "selling_points": phase1_result.get("selling_points", ""),
            "image_types": phase1_result.get("image_types", []),
        }

    # Sync Phase 1 results to memory
    memory.update_from_collect_info(phase1_result)

    # Apply single_image_mode
    effective_image_types = memory.image_types
    if memory.single_image_mode and memory.target_single_type:
        target_type = memory.target_single_type
        if target_type in effective_image_types:
            effective_image_types = [target_type]
            yield {
                "event": "flow_decision",
                "decision": "single_image_mode",
                "text": f"单图模式：只生成 {target_type}",
                "target_type": target_type,
            }

    # Layer 1: Design Planner
    design_plan = None
    if memory.skip_design_planning:
        yield {
            "event": "flow_decision",
            "decision": "skip_design_planning",
            "text": "跳过设计规划，直接进入图片生成...",
        }
    else:
        yield {
            "event": "agent_message",
            "agent": "coordinator",
            "text": "信息收集完成！正在制定设计方案...",
        }
        yield {"event": "phase_start", "phase": "DESIGN_PLANNING"}
        design_result = await plan_design(
            product_name=memory.product_name,
            selling_points=memory.selling_points,
            image_types=effective_image_types,
            ecom_platform=memory.ecom_platform,
            target_country=memory.target_country,
            style_preference=memory.style_preference or "professional e-commerce",
            color_palette=memory.color_palette,
            brand_memory=inputs.get("brand_memory", {}),
            cheap_model_config=cheap_model_config,
        )
        design_plan = design_result.get("design_plan")
        if design_plan:
            yield {"event": "design_plan", "design_plan": design_plan}
            yield {
                "event": "agent_message",
                "agent": "planner",
                "text": "设计方案已制定，开始生成图片...",
            }

    # Layer 2: ReAct Generation Loop
    canvas_context = _build_canvas_context(inputs)
    yield {"event": "phase_start", "phase": "GENERATING_IMAGES"}
    async for event in _run_generation_loop(
        memory=memory,
        image_types=effective_image_types,
        product_name=memory.product_name,
        selling_points=memory.selling_points,
        ecom_platform=memory.ecom_platform,
        aspect_ratio=memory.aspect_ratio,
        target_country=memory.target_country,
        style_preference=memory.style_preference or "professional e-commerce",
        color_palette=memory.color_palette,
        neg_prompt=memory.negative_prompt,
        image_model_key=inputs.get("image_model_api_key", ""),
        design_plan=design_plan,
        cheap_model_config=cheap_model_config,
        vision_model_config=vision_model_config,
        rag_retriever=rag_retriever,
        canvas_context=canvas_context,
        current_images=memory.current_images,
        stitch_regions=memory.stitch_regions,
        canvas_snapshot=inputs.get("canvas_snapshot", ""),
        mask_data=inputs.get("mask_data"),
    ):
        yield event

    yield {
        "event": "agent_message",
        "agent": "coordinator",
        "text": "所有图片已生成！",
    }
    yield {"event": "memory_updated", "agent_memory": memory.to_dict()}
    yield {"event": "done"}
