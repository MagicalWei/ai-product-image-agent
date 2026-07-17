"""
Agent Service — Pipeline Orchestrator

Thin wrapper around the agent loop that aggregates SSE events.
Supports three architectures via AGENT_ARCHITECTURE env var:
  - "sense-decide-act-review" (default): new four-phase loop (agent.core.loop)
  - "multi-agent": multi-agent collaboration (agent.multi_agent)
  - "unified" (deprecated, read-only observation): single LLM tool-calling loop (agent_loop.py)
"""

import os
import sys
import logging
from typing import Dict, Any

from memory import AgentMemory
from agent_loop import run_unified_agent

logger = logging.getLogger(__name__)

# Feature flag: "unified" | "sense-decide-act-review" | "multi-agent"
AGENT_ARCHITECTURE = os.getenv("AGENT_ARCHITECTURE", "sense-decide-act-review")


async def run_pipeline(inputs: Dict[str, Any]) -> Dict[str, Any]:
    """Run the agent (blocking). Collects all events into a result dict."""
    result: Dict[str, Any] = {
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
    """Agent pipeline — selects architecture based on AGENT_ARCHITECTURE env var.

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
    multimodal_config = {
        "api_key": inputs.get("multimodal_api_key", os.getenv("DASHSCOPE_API_KEY", "")),
        "base_url": inputs.get("multimodal_base_url", os.getenv("MULTIMODAL_BASE_URL", "https://ws-kbw1pwxjomfj4o8k.cn-beijing.maas.aliyuncs.com/compatible-mode/v1")),
        "model": inputs.get("multimodal_model", os.getenv("MULTIMODAL_MODEL", "qwen3.6-plus")),
    }

    # ── Load AgentMemory ──
    memory = AgentMemory.from_dict(inputs.get("agent_memory"))
    memory.add_chat_turn("user", message)
    memory.current_phase = current_phase

    # Sync product info from inputs into memory
    if product_name and not memory.product_name:
        memory.product_name = product_name
    if selling_points and (inputs.get("product_set_mode") or not memory.selling_points):
        memory.selling_points = selling_points
    if inputs.get("image_types") and (inputs.get("product_set_mode") or inputs.get("style_transfer_mode") or not memory.image_types):
        memory.image_types = inputs.get("image_types", [])
    if inputs.get("style_preference") and (inputs.get("product_set_mode") or not memory.style_preference):
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

    # ── Select architecture ──
    logger.info(
        f"[Pipeline] Architecture={AGENT_ARCHITECTURE} — message: {message[:100]}"
    )

    yield {
        "event": "agent_message",
        "agent": "agent",
        "text": "",
    }

    image_model_key = inputs.get("image_model_api_key", "")

    if AGENT_ARCHITECTURE == "sense-decide-act-review":
        async for event in _run_new_loop(
            message=message,
            memory=memory,
            cheap_model_config=cheap_model_config,
            vision_model_config=vision_model_config,
            multimodal_config=multimodal_config,
            image_model_key=image_model_key,
            rag_retriever=rag_retriever,
            product_image_base64=inputs.get("product_image_base64", ""),
            reference_images=inputs.get("reference_images", []),
            style_reference_images=inputs.get("style_reference_images", []),
            style_transfer_mode=inputs.get("style_transfer_mode", False),
            product_set_mode=inputs.get("product_set_mode", False),
            session_id=inputs.get("session_id", ""),
        ):
            yield event
    elif AGENT_ARCHITECTURE == "multi-agent":
        async for event in _run_multi_agent(
            message=message,
            memory=memory,
            cheap_model_config=cheap_model_config,
            vision_model_config=vision_model_config,
            image_model_key=image_model_key,
            rag_retriever=rag_retriever,
            product_image_base64=inputs.get("product_image_base64", ""),
            reference_images=inputs.get("reference_images", []),
            multimodal_config=multimodal_config,
        ):
            yield event
    else:
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


async def _run_new_loop(
    message: str,
    memory: AgentMemory,
    cheap_model_config: Dict[str, str],
    vision_model_config: Dict[str, str],
    multimodal_config: Dict[str, str],
    image_model_key: str,
    rag_retriever: Any = None,
    product_image_base64: str = "",
    reference_images: list[str] | None = None,
    style_reference_images: list[str] | None = None,
    style_transfer_mode: bool = False,
    product_set_mode: bool = False,
    session_id: str = "",
):
    """Run the new sense-decide-act-review loop."""
    # Ensure project root is in path for agent imports
    _project_root = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..")
    )
    if _project_root not in sys.path:
        sys.path.insert(0, _project_root)

    from agent.actions.handlers import register_all_actions
    from agent.assets.store import AssetStore
    from agent.canvas.state import CanvasStateManager
    from agent.canvas.identity import build_agent_canvas_id
    from agent.canvas.version_tree import VersionTree
    from agent.actions.registry import ACTION_REGISTRY
    from agent.core.loop import SenseDecideActReviewLoop

    # Initialize components
    register_all_actions()
    canvas_mgr = CanvasStateManager()
    asset_store = AssetStore()

    # Try loading existing canvas state from asset store for
    # cross-request persistence (keyed by session/product).
    session_canvas_id = build_agent_canvas_id(session_id, memory.product_name)
    if session_canvas_id:
        canvas_mgr.load_from_asset_store(session_canvas_id, asset_store)

    version_tree = VersionTree(asset_store)

    image_config = {
        "api_key": image_model_key,
    }

    loop = SenseDecideActReviewLoop(
        action_registry=ACTION_REGISTRY,
        canvas_manager=canvas_mgr,
        version_tree=version_tree,
        chat_config=cheap_model_config,
        vision_config=vision_model_config,
        image_config=image_config,
        multimodal_config=multimodal_config,
    )

    async for event in loop.run(
        message=message,
        memory=memory,
        product_image_base64=product_image_base64,
        reference_images=reference_images or [],
        style_reference_images=style_reference_images or [],
        style_transfer_mode=style_transfer_mode,
        product_set_mode=product_set_mode,
        canvas_id=session_canvas_id,
        rag_retriever=rag_retriever,
    ):
        yield event

    # Persist canvas state after loop completes for next request
    if session_canvas_id:
        canvas_mgr.save_to_asset_store(session_canvas_id, asset_store)


async def _run_multi_agent(
    message: str,
    memory: AgentMemory,
    cheap_model_config: Dict[str, str],
    vision_model_config: Dict[str, str],
    image_model_key: str,
    rag_retriever: Any = None,
    product_image_base64: str = "",
    reference_images: list[str] = None,
    multimodal_config: Dict[str, str] = None,
):
    """Run the multi-agent architecture."""
    _project_root = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..")
    )
    if _project_root not in sys.path:
        sys.path.insert(0, _project_root)

    from agent.multi_agent import MultiAgentOrchestrator

    image_config = {
        "api_key": image_model_key,
    }

    orchestrator = MultiAgentOrchestrator(
        chat_config=cheap_model_config,
        image_config=image_config,
        vision_config=vision_model_config,
        multimodal_config=multimodal_config or {},
        rag_retriever=rag_retriever,
    )

    async for event in orchestrator.run(
        message=message,
        memory=memory,
        product_image_base64=product_image_base64,
        reference_images=reference_images or [],
    ):
        yield event
