import os
import asyncio
import json
import sys
import logging
import secrets
from pathlib import Path
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Any
from dotenv import dotenv_values, load_dotenv

# Load the project-level environment before importing any local modules. Some of
# those modules read model settings at import time, so loading afterwards makes
# startup behavior depend on the process working directory/import order.
PROJECT_ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
load_dotenv(dotenv_path=PROJECT_ENV_PATH)
PROJECT_ROOT = str(PROJECT_ENV_PATH.parent)
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from pipeline import run_pipeline, run_pipeline_stream

logger = logging.getLogger(__name__)

app = FastAPI(title="AI Product Image Agent Service")

# API 配置在模块级别加载一次，不再从请求体获取
CHAT_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
CHAT_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
CHAT_MODEL = os.getenv("DEEPSEEK_CHAT_MODEL", "deepseek-v4-flash")

IMAGE_API_KEY = os.getenv("DOUBAO_API_KEY", "")
IMAGE_MODEL = os.getenv("DOUBAO_IMAGE_MODEL", "doubao-seedream-5-0-lite-260128")

# Vision model for product image analysis (e.g., gpt-4o, doubao-vision)
CHAT_VISION_API_KEY = os.getenv("CHAT_VISION_API_KEY", "")
CHAT_VISION_BASE_URL = os.getenv("CHAT_VISION_BASE_URL", "https://api.openai.com/v1")
CHAT_VISION_MODEL = os.getenv("CHAT_VISION_MODEL", "gpt-4o")

# Multimodal model for requirement_collector and competitor_analyst (aliyun bailian qwen3.6-plus)
MULTIMODAL_API_KEY = os.getenv("DASHSCOPE_API_KEY", os.getenv("MULTIMODAL_API_KEY", ""))
MULTIMODAL_BASE_URL = os.getenv("MULTIMODAL_BASE_URL", "https://ws-kbw1pwxjomfj4o8k.cn-beijing.maas.aliyuncs.com/compatible-mode/v1")
MULTIMODAL_MODEL = os.getenv("MULTIMODAL_MODEL", "qwen3.6-plus")


def get_multimodal_config() -> dict[str, str]:
    """Return current multimodal settings with an explicit project-file fallback.

    Some launchers export an empty DASHSCOPE_API_KEY. python-dotenv deliberately
    does not replace an existing empty variable when override=False, which made
    the same .env work in a shell but fail from a dev-service launcher.
    """
    file_config = dotenv_values(PROJECT_ENV_PATH) if PROJECT_ENV_PATH.exists() else {}

    def configured_value(*keys: str, default: str = "") -> str:
        for key in keys:
            env_value = os.getenv(key, "").strip()
            if env_value:
                return env_value
            file_value = str(file_config.get(key) or "").strip()
            if file_value:
                return file_value
        return default

    return {
        "api_key": configured_value("DASHSCOPE_API_KEY", "MULTIMODAL_API_KEY"),
        "base_url": configured_value("MULTIMODAL_BASE_URL", default=MULTIMODAL_BASE_URL),
        "model": configured_value("MULTIMODAL_MODEL", default=MULTIMODAL_MODEL),
    }

# RAG 配置
RAG_ENABLED = os.getenv("RAG_ENABLED", "true").lower() == "true"
# Embedding 默认使用 OpenAI API（text-embedding-3-small 模型）
# DeepSeek 不支持 Embedding API，因此需要独立配置
EMBEDDING_API_KEY = os.getenv("EMBEDDING_API_KEY", "")
EMBEDDING_BASE_URL = os.getenv("EMBEDDING_BASE_URL", "https://api.openai.com/v1")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
EMBEDDING_DIMENSION = 1536


def _is_placeholder_secret(value: str) -> bool:
    normalized = (value or "").strip().lower()
    return not normalized or normalized.startswith(("your_", "replace_", "placeholder"))

# RAG 模块全局实例（延迟初始化）
_rag_retriever = None
_vector_store = None
_embedding_service = None
_media_vector_service = None


def get_embedding_config() -> dict[str, Any]:
    """Use explicit embedding config, or the verified DashScope compatible API."""
    explicit_key = os.getenv("EMBEDDING_API_KEY", "").strip()
    if not _is_placeholder_secret(explicit_key):
        return {
            "api_key": explicit_key,
            "base_url": os.getenv("EMBEDDING_BASE_URL", "https://api.openai.com/v1"),
            "model": os.getenv("EMBEDDING_MODEL", "text-embedding-3-small"),
            "dimension": EMBEDDING_DIMENSION,
        }
    dashscope_key = os.getenv("DASHSCOPE_API_KEY", "").strip()
    if dashscope_key:
        return {
            "api_key": dashscope_key,
            "base_url": os.getenv(
                "DASHSCOPE_EMBEDDING_BASE_URL",
                "https://dashscope.aliyuncs.com/compatible-mode/v1",
            ),
            "model": os.getenv("DASHSCOPE_EMBEDDING_MODEL", "text-embedding-v4"),
            "dimension": EMBEDDING_DIMENSION,
        }
    return {"api_key": "", "base_url": "", "model": "", "dimension": EMBEDDING_DIMENSION}


async def _init_rag():
    """初始化 RAG 模块（Embedding + VectorStore + KnowledgeBase）"""
    global _rag_retriever, _vector_store, _embedding_service, _media_vector_service

    if not RAG_ENABLED:
        logger.info("RAG is disabled (RAG_ENABLED=false)")
        return

    embedding_config = get_embedding_config()
    if not embedding_config["api_key"]:
        logger.warning("No usable EMBEDDING_API_KEY configured, RAG will be disabled")
        return

    try:
        from rag.embeddings import EmbeddingService
        from rag.vector_store import VectorStore
        from rag.retrieval import RAGRetriever
        from rag.knowledge_base import KnowledgeBase

        # 初始化 Embedding 服务
        _embedding_service = EmbeddingService(
            **embedding_config,
        )

        # 初始化 VectorStore
        _vector_store = VectorStore()
        await _vector_store.initialize()

        # 初始化 RAG 检索器
        _rag_retriever = RAGRetriever(
            vector_store=_vector_store,
            embedding_service=_embedding_service,
        )

        from agent.media.repository import MediaEmbeddingRepository
        from agent.media.service import MediaVectorService
        _media_vector_service = MediaVectorService(
            repository=MediaEmbeddingRepository(_vector_store.pool),
            embedding_service=_embedding_service,
        )

        # 检查知识库是否已有数据，如无则自动入库
        doc_count = await _vector_store.count()
        if doc_count == 0:
            logger.info("RAG knowledge base is empty, indexing documents...")
            kb = KnowledgeBase(
                vector_store=_vector_store,
                embedding_service=_embedding_service,
            )
            indexed = await kb.load_and_index()
            logger.info(f"RAG knowledge base indexed: {indexed} documents")
        else:
            logger.info(f"RAG initialized: {doc_count} documents in vector store")

    except Exception as e:
        logger.error(f"Failed to initialize RAG: {e}")
        # RAG 初始化失败不应阻止服务启动，_rag_retriever 保持 None 即表示禁用


def get_rag_retriever():
    """获取 RAG 检索器实例"""
    return _rag_retriever if RAG_ENABLED else None


@app.on_event("startup")
async def startup():
    """FastAPI 启动事件：初始化 RAG 模块"""
    await _init_rag()


@app.on_event("shutdown")
async def shutdown():
    """FastAPI 关闭事件：清理资源"""
    global _vector_store
    if _vector_store:
        await _vector_store.close()
        _vector_store = None


class RunRequest(BaseModel):
    """Node.js 只传业务数据，不传密钥"""
    # Flow control
    current_phase: str = "COLLECTING_INFO"
    session_id: str = ""
    user_id: str = ""
    chat_history: List[Dict[str, str]] = []
    message: str = Field(default="", max_length=4000)

    # Phase 1 fields - Product info
    product_name: str = ""
    selling_points: str = ""
    ecom_platform: str = ""
    aspect_ratio: str = "1:1"
    language: str = "zh"
    target_country: str = ""
    image_types: List[str] = []

    # Phase 1 fields - Visual info
    product_image_base64: str = ""
    style_preference: str = ""
    reference_images: List[str] = []
    style_reference_images: List[str] = []
    style_transfer_mode: bool = False
    product_set_mode: bool = False
    color_palette: List[str] = []

    # Phase 2 fields
    negative_prompt: str = ""

    # Brand memory
    brand_memory: Dict[str, Any] = {}

    # Structured agent memory (Phase 1)
    agent_memory: Dict[str, Any] = {}

    # Flow control flags (Phase 4)
    skip_info_collection: bool = False
    skip_design_planning: bool = False
    single_image_mode: bool = False
    target_single_type: str = ""
    refinement_mode: bool = False

    # Canvas state fields (Phase 3: Tool Call)
    tool_results: Dict[str, Any] = {}
    canvas_snapshot: Optional[Any] = None
    stitch_regions: List[Dict[str, Any]] = []
    current_images: Dict[str, str] = {}
    mask_data: Optional[Any] = None


def _validate_internal_token(token: str | None) -> None:
    expected = os.getenv("MEDIA_INDEX_INTERNAL_TOKEN") or os.getenv("JWT_SECRET", "")
    if not expected or not token or not secrets.compare_digest(token, expected):
        raise HTTPException(status_code=401, detail="Invalid internal service token")


def _request_retriever(user_id: str):
    if not user_id or _media_vector_service is None:
        return get_rag_retriever()
    from agent.media.retrieval import AccountRetrievalFacade
    return AccountRetrievalFacade(get_rag_retriever(), _media_vector_service, user_id)


@app.post("/agent/run-stream")
async def run_agent_stream(req: RunRequest, x_internal_token: str | None = Header(default=None)):
    """SSE streaming endpoint using pipeline stream for progressive UI updates."""
    if not CHAT_API_KEY and not os.getenv("CHAT_FALLBACK_1_KEY"):
        raise HTTPException(status_code=500, detail="No chat model API key configured on server")
    if not IMAGE_API_KEY and not os.getenv("IMAGE_FALLBACK_1_KEY"):
        raise HTTPException(status_code=500, detail="No image model API key configured on server")

    if req.user_id:
        _validate_internal_token(x_internal_token)
    inputs = {
        "current_phase": req.current_phase,
        "session_id": req.session_id,
        "chat_history": req.chat_history,
        "message": req.message,

        "product_name": req.product_name,
        "selling_points": req.selling_points,
        "ecom_platform": req.ecom_platform,
        "aspect_ratio": req.aspect_ratio,
        "language": req.language,
        "target_country": req.target_country,
        "image_types": req.image_types,

        "product_image_base64": req.product_image_base64,
        "style_preference": req.style_preference,
        "reference_images": req.reference_images,
        "style_reference_images": req.style_reference_images,
        "style_transfer_mode": req.style_transfer_mode,
        "product_set_mode": req.product_set_mode,
        "color_palette": req.color_palette,

        "generated_images": {},
        "prompts": {},
        "negative_prompt": req.negative_prompt,

        "cheap_model_api_key": CHAT_API_KEY,
        "cheap_model_base_url": CHAT_BASE_URL,
        "cheap_model_name": CHAT_MODEL,
        "chat_vision_model_api_key": CHAT_VISION_API_KEY,
        "chat_vision_model_base_url": CHAT_VISION_BASE_URL,
        "chat_vision_model_name": CHAT_VISION_MODEL,
        "multimodal_api_key": get_multimodal_config()["api_key"],
        "multimodal_base_url": get_multimodal_config()["base_url"],
        "multimodal_model": get_multimodal_config()["model"],
        "image_model_api_key": IMAGE_API_KEY,
        "image_model_name": IMAGE_MODEL,

        "brand_memory": req.brand_memory,

        # Structured agent memory (Phase 1)
        "agent_memory": req.agent_memory,

        # Flow control flags (Phase 4)
        "skip_info_collection": req.skip_info_collection,
        "skip_design_planning": req.skip_design_planning,
        "single_image_mode": req.single_image_mode,
        "target_single_type": req.target_single_type,
        "refinement_mode": req.refinement_mode,

        # Canvas state fields
        "tool_results": req.tool_results,
        "canvas_snapshot": req.canvas_snapshot,
        "stitch_regions": req.stitch_regions,
        "current_images": req.current_images,
        "mask_data": req.mask_data,

        "rag_retriever": _request_retriever(req.user_id),

        "error": ""
    }

    async def event_generator():
        async for event in run_pipeline_stream(inputs):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@app.post("/agent/run")
async def run_agent(req: RunRequest, x_internal_token: str | None = Header(default=None)):
    # 检查模型密钥是否已配置
    if not CHAT_API_KEY and not os.getenv("CHAT_FALLBACK_1_KEY"):
        raise HTTPException(status_code=500, detail="No chat model API key configured on server")
    if not IMAGE_API_KEY and not os.getenv("IMAGE_FALLBACK_1_KEY"):
        raise HTTPException(status_code=500, detail="No image model API key configured on server")

    if req.user_id:
        _validate_internal_token(x_internal_token)
    inputs = {
        "current_phase": req.current_phase,
        "chat_history": req.chat_history,
        "message": req.message,

        "product_name": req.product_name,
        "selling_points": req.selling_points,
        "ecom_platform": req.ecom_platform,
        "aspect_ratio": req.aspect_ratio,
        "language": req.language,
        "target_country": req.target_country,
        "image_types": req.image_types,

        "product_image_base64": req.product_image_base64,
        "style_preference": req.style_preference,
        "reference_images": req.reference_images,
        "color_palette": req.color_palette,

        "generated_images": {},
        "prompts": {},
        "negative_prompt": req.negative_prompt,

        # API 配置从环境变量读取
        "cheap_model_api_key": CHAT_API_KEY,
        "cheap_model_base_url": CHAT_BASE_URL,
        "cheap_model_name": CHAT_MODEL,
        "chat_vision_model_api_key": CHAT_VISION_API_KEY,
        "chat_vision_model_base_url": CHAT_VISION_BASE_URL,
        "chat_vision_model_name": CHAT_VISION_MODEL,
        "multimodal_api_key": MULTIMODAL_API_KEY,
        "multimodal_base_url": MULTIMODAL_BASE_URL,
        "multimodal_model": MULTIMODAL_MODEL,
        "image_model_api_key": IMAGE_API_KEY,
        "image_model_name": IMAGE_MODEL,

        # Brand memory
        "brand_memory": req.brand_memory,

        # Structured agent memory (Phase 1)
        "agent_memory": req.agent_memory,

        # Flow control flags (Phase 4)
        "skip_info_collection": req.skip_info_collection,
        "skip_design_planning": req.skip_design_planning,
        "single_image_mode": req.single_image_mode,
        "target_single_type": req.target_single_type,
        "refinement_mode": req.refinement_mode,

        # Canvas state fields
        "tool_results": req.tool_results,
        "canvas_snapshot": req.canvas_snapshot,
        "stitch_regions": req.stitch_regions,
        "current_images": req.current_images,
        "mask_data": req.mask_data,

        "rag_retriever": _request_retriever(req.user_id),

        "error": ""
    }

    try:
        result = await run_pipeline(inputs)
        return {
            "current_phase": result.get("current_phase"),
            "chat_history": result.get("chat_history"),
            "product_name": result.get("product_name"),
            "selling_points": result.get("selling_points"),
            "ecom_platform": result.get("ecom_platform"),
            "aspect_ratio": result.get("aspect_ratio"),
            "language": result.get("language"),
            "target_country": result.get("target_country"),
            "image_types": result.get("image_types"),
            "style_preference": result.get("style_preference"),
            "color_palette": result.get("color_palette"),
            "generated_images": result.get("generated_images"),
            "prompts": result.get("prompts"),
            "negative_prompt": result.get("negative_prompt"),
            "error": result.get("error")
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Graph Execution Error: {str(e)}")


class AnalyzeProductImageRequest(BaseModel):
    """Request for product image analysis endpoint."""
    image_base64: str = Field(min_length=1, max_length=14_500_000)
    file_name: str = Field(default="", max_length=255)


class MediaIndexRequest(BaseModel):
    uid: str = Field(min_length=1, max_length=64)
    asset_id: str = Field(min_length=1, max_length=128)
    session_id: str = Field(default="", max_length=128)
    media_type: str = Field(pattern="^(image|video)$")
    analysis: Dict[str, Any] = Field(default_factory=dict)
    image_base64: str = Field(default="", max_length=14_500_000)
    file_name: str = Field(default="", max_length=255)
    source_index: int = Field(default=0, ge=0, le=16)


class MediaSearchRequest(BaseModel):
    uid: str = Field(min_length=1, max_length=64)
    query: str = Field(min_length=1, max_length=1000)
    vector_kind: str = Field(default="content", pattern="^(content|style|product)$")
    media_type: Optional[str] = Field(default=None, pattern="^(image|video)$")
    top_k: int = Field(default=6, ge=1, le=20)
    min_score: float = Field(default=0.0, ge=-1, le=1)


class ViralFrame(BaseModel):
    timestamp: float = Field(default=0, ge=0, le=60)
    image: str = Field(min_length=20, max_length=2_500_000)


class ViralProductSource(BaseModel):
    kind: str = Field(pattern="^(video|image)$")
    source_index: int = Field(ge=0, le=8)
    duration: float = Field(default=0, ge=0, le=60)
    frames: List[ViralFrame] = Field(min_length=1, max_length=8)


class ViralReplicationRequest(BaseModel):
    uid: str = Field(min_length=1, max_length=64)
    reference_duration: float = Field(gt=0, le=60)
    reference_frames: List[ViralFrame] = Field(min_length=1, max_length=12)
    product_sources: List[ViralProductSource] = Field(min_length=1, max_length=8)
    instruction: str = Field(default="", max_length=1000)
    strength: str = Field(default="medium", pattern="^(light|medium|high)$")


class ReverseImagePromptRequest(BaseModel):
    image_base64: str = Field(min_length=20, max_length=14_500_000)
    composition_preference: str = Field(default="auto", max_length=80)


class GenerateVideoClipRequest(BaseModel):
    image_base64: str = Field(min_length=20, max_length=28_000_000)
    prompt: str = Field(min_length=1, max_length=1000)
    duration: float = Field(default=5, ge=4, le=12)
    ratio: str = Field(default="9:16", pattern="^(16:9|9:16|1:1|4:3|3:4|21:9)$")


@app.post("/agent/analyze-product-image")
async def analyze_product_image_endpoint(req: AnalyzeProductImageRequest):
    """Analyze a product image using multimodal qwen3.6-plus.

    Returns structured analysis as JSON (not SSE).
    """
    multimodal_config = get_multimodal_config()

    if not multimodal_config["api_key"]:
        raise HTTPException(status_code=500, detail="No multimodal API key configured")

    # Ensure project root is in path for agent imports
    _project_root = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..")
    )
    if _project_root not in sys.path:
        sys.path.insert(0, _project_root)

    from agent.image_analysis import analyze_product_image

    try:
        result = await analyze_product_image(
            image_base64=req.image_base64,
            multimodal_config=multimodal_config,
            file_name=req.file_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {"success": True, "analysis": result}


@app.post("/agent/tools/reverse-image-prompt")
async def reverse_image_prompt_endpoint(
    req: ReverseImagePromptRequest,
    x_internal_token: str | None = Header(default=None),
):
    _validate_internal_token(x_internal_token)
    from agent.actions.handlers.reverse_image_prompt import reverse_image_prompt_fn
    from agent.models import ActionParams, CanvasState

    result = await reverse_image_prompt_fn(ActionParams(
        action="reverse_image_prompt",
        image_base64=req.image_base64,
        composition_preference=req.composition_preference,
        multimodal_config=get_multimodal_config(),
    ), CanvasState(canvas_id="toolbox-reverse-prompt"))
    if not result.success:
        status = 503 if "未配置" in str(result.error or "") else 502
        raise HTTPException(status_code=status, detail=result.error or "图片提示词反推失败")
    return {"success": True, **result.data}


@app.post("/agent/video/generate-clip")
async def generate_video_clip_endpoint(
    req: GenerateVideoClipRequest,
    x_internal_token: str | None = Header(default=None),
):
    _validate_internal_token(x_internal_token)
    from agent.actions.handlers.generate_video_clip import generate_video_clip_fn
    from agent.models import ActionParams, CanvasState

    result = await generate_video_clip_fn(ActionParams(
        action="generate_video_clip",
        image_base64=req.image_base64,
        prompt=req.prompt,
        duration=req.duration,
        ratio=req.ratio,
    ), CanvasState(canvas_id="video-image-to-video"))
    if not result.success:
        error = str(result.error or "图生视频生成失败")
        status = 503 if "未配置" in error else 502
        raise HTTPException(status_code=status, detail=error)
    return {"success": True, **result.data}


@app.post("/agent/media/index")
async def index_media_endpoint(
    req: MediaIndexRequest,
    x_internal_token: str | None = Header(default=None),
):
    _validate_internal_token(x_internal_token)
    if _media_vector_service is None:
        raise HTTPException(status_code=503, detail="Media vector service is not ready")
    try:
        analysis = req.analysis
        if not analysis and req.media_type == "image" and req.image_base64:
            from agent.image_analysis import analyze_product_image
            analysis = await analyze_product_image(
                image_base64=req.image_base64,
                multimodal_config=get_multimodal_config(),
                file_name=req.file_name,
            )
        if not analysis:
            raise ValueError("Media analysis is required for indexing")
        count = await _media_vector_service.index_analysis(
            uid=req.uid,
            asset_id=req.asset_id,
            session_id=req.session_id or None,
            media_type=req.media_type,
            analysis=analysis,
            source_index=req.source_index,
        )
    except ValueError as error:
        await _media_vector_service.repository.mark_status(req.uid, req.asset_id, "failed", str(error))
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        await _media_vector_service.repository.mark_status(req.uid, req.asset_id, "failed", str(error))
        logger.exception("Media indexing failed for asset %s", req.asset_id)
        raise HTTPException(status_code=502, detail="Media indexing failed") from error
    return {"success": True, "asset_id": req.asset_id, "segments_indexed": count}


@app.post("/agent/media/search")
async def search_media_endpoint(
    req: MediaSearchRequest,
    x_internal_token: str | None = Header(default=None),
):
    _validate_internal_token(x_internal_token)
    if _media_vector_service is None:
        raise HTTPException(status_code=503, detail="Media vector service is not ready")
    results = await _media_vector_service.search(
        uid=req.uid,
        query=req.query,
        vector_kind=req.vector_kind,
        media_type=req.media_type,
        top_k=req.top_k,
        min_score=req.min_score,
    )
    return {"success": True, "results": results}


@app.post("/agent/video/replicate")
async def replicate_video_endpoint(
    req: ViralReplicationRequest,
    x_internal_token: str | None = Header(default=None),
):
    _validate_internal_token(x_internal_token)
    from agent.video_replication import analyze_viral_replication
    try:
        multimodal_config = get_multimodal_config()
        if not multimodal_config["api_key"]:
            raise HTTPException(status_code=503, detail="未配置可用的多模态模型")
        blueprint = await analyze_viral_replication(
            reference_frames=[frame.model_dump(mode="json") for frame in req.reference_frames],
            reference_duration=req.reference_duration,
            product_sources=[source.model_dump(mode="json") for source in req.product_sources],
            instruction=req.instruction,
            strength=req.strength,
            multimodal_config=multimodal_config,
        )
        if _media_vector_service is not None:
            async def historical_candidates(shot: dict[str, Any]):
                query = " ".join(filter(None, [
                    shot.get("purpose", ""), shot.get("shot_type", ""),
                    shot.get("camera", ""), shot.get("visual_style", ""),
                ]))
                try:
                    results = await _media_vector_service.search(
                        uid=req.uid, query=query, vector_kind="content", top_k=2, min_score=0.25,
                    )
                except Exception:
                    return []
                return [{
                    "asset_id": item["asset_id"],
                    "asset_name": item["asset_name"],
                    "asset_url": item["asset_url"],
                    "media_type": item["media_type"],
                    "start_time": item.get("start_time"),
                    "end_time": item.get("end_time"),
                    "score": round(float(item["score"]), 4),
                } for item in results]

            candidate_lists = await asyncio.gather(*[
                historical_candidates(shot) for shot in blueprint["shots"][:8]
            ])
            for shot, candidates in zip(blueprint["shots"], candidate_lists):
                shot["historical_candidates"] = candidates
        return {"success": True, "blueprint": blueprint}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.get("/health")
def health():
    return {
        "status": "ok",
        "multimodal_ready": bool(get_multimodal_config()["api_key"]),
        "media_vector_ready": _media_vector_service is not None,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
