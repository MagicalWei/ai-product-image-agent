import os
import json
import logging
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Any
from dotenv import load_dotenv
from pipeline import run_pipeline, run_pipeline_stream

# 从父目录 .env 加载环境变量
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

logger = logging.getLogger(__name__)

app = FastAPI(title="AI Product Image Agent Service")

# API 配置在模块级别加载一次，不再从请求体获取
CHAT_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
CHAT_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
CHAT_MODEL = os.getenv("DEEPSEEK_CHAT_MODEL", "deepseek-v4-flash")

IMAGE_API_KEY = os.getenv("DOUBAO_API_KEY", "")
IMAGE_MODEL = os.getenv("DOUBAO_IMAGE_MODEL", "doubao-seedream-5-0-260128")

# Vision model for product image analysis (e.g., gpt-4o, doubao-vision)
CHAT_VISION_API_KEY = os.getenv("CHAT_VISION_API_KEY", "")
CHAT_VISION_BASE_URL = os.getenv("CHAT_VISION_BASE_URL", "https://api.openai.com/v1")
CHAT_VISION_MODEL = os.getenv("CHAT_VISION_MODEL", "gpt-4o")

# RAG 配置
RAG_ENABLED = os.getenv("RAG_ENABLED", "true").lower() == "true"
# Embedding 默认使用 OpenAI API（text-embedding-3-small 模型）
# DeepSeek 不支持 Embedding API，因此需要独立配置
EMBEDDING_API_KEY = os.getenv("EMBEDDING_API_KEY", "")
EMBEDDING_BASE_URL = os.getenv("EMBEDDING_BASE_URL", "https://api.openai.com/v1")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")

# RAG 模块全局实例（延迟初始化）
_rag_retriever = None
_vector_store = None
_embedding_service = None


async def _init_rag():
    """初始化 RAG 模块（Embedding + VectorStore + KnowledgeBase）"""
    global _rag_retriever, _vector_store, _embedding_service

    if not RAG_ENABLED:
        logger.info("RAG is disabled (RAG_ENABLED=false)")
        return

    if not EMBEDDING_API_KEY:
        logger.warning("No EMBEDDING_API_KEY configured, RAG will be disabled")
        return

    try:
        from rag.embeddings import EmbeddingService
        from rag.vector_store import VectorStore
        from rag.retrieval import RAGRetriever
        from rag.knowledge_base import KnowledgeBase

        # 初始化 Embedding 服务
        _embedding_service = EmbeddingService(
            api_key=EMBEDDING_API_KEY,
            base_url=EMBEDDING_BASE_URL,
            model=EMBEDDING_MODEL,
        )

        # 初始化 VectorStore
        _vector_store = VectorStore()
        await _vector_store.initialize()

        # 初始化 RAG 检索器
        _rag_retriever = RAGRetriever(
            vector_store=_vector_store,
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


@app.post("/agent/run-stream")
async def run_agent_stream(req: RunRequest):
    """SSE streaming endpoint using pipeline stream for progressive UI updates."""
    if not CHAT_API_KEY and not os.getenv("CHAT_FALLBACK_1_KEY"):
        raise HTTPException(status_code=500, detail="No chat model API key configured on server")
    if not IMAGE_API_KEY and not os.getenv("IMAGE_FALLBACK_1_KEY"):
        raise HTTPException(status_code=500, detail="No image model API key configured on server")

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

        "cheap_model_api_key": CHAT_API_KEY,
        "cheap_model_base_url": CHAT_BASE_URL,
        "cheap_model_name": CHAT_MODEL,
        "chat_vision_model_api_key": CHAT_VISION_API_KEY,
        "chat_vision_model_base_url": CHAT_VISION_BASE_URL,
        "chat_vision_model_name": CHAT_VISION_MODEL,
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

        "rag_retriever": get_rag_retriever(),

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
async def run_agent(req: RunRequest):
    # 检查模型密钥是否已配置
    if not CHAT_API_KEY and not os.getenv("CHAT_FALLBACK_1_KEY"):
        raise HTTPException(status_code=500, detail="No chat model API key configured on server")
    if not IMAGE_API_KEY and not os.getenv("IMAGE_FALLBACK_1_KEY"):
        raise HTTPException(status_code=500, detail="No image model API key configured on server")

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

        "rag_retriever": get_rag_retriever(),

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


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
