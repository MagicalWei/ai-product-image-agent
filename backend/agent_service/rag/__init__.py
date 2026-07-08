"""
RAG 模块

为 Agent 流水线提供检索增强生成能力：
- EmbeddingService: OpenAI 兼容协议 embedding 调用
- VectorStore: pgvector 向量存储 CRUD + 相似度搜索
- RAGRetriever: 检索增强（查询重写 + 向量检索 + 上下文构建）
- KnowledgeBase: 商品图知识库管理（加载/分块/索引）
"""

from .embeddings import EmbeddingService
from .vector_store import VectorStore
from .retrieval import RAGRetriever
from .knowledge_base import KnowledgeBase
from .models import RagDocument, SearchResult, RetrieveResult, KnowledgeChunk

__all__ = [
    "EmbeddingService",
    "VectorStore",
    "RAGRetriever",
    "KnowledgeBase",
    "RagDocument",
    "SearchResult",
    "RetrieveResult",
    "KnowledgeChunk",
]
