"""
RAG 模块 — Pydantic 数据模型
"""

from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime


class RagDocument(BaseModel):
    """RAG 知识库文档模型"""
    id: Optional[str] = None
    content: str
    metadata: Dict[str, Any] = Field(default_factory=dict)
    embedding: Optional[List[float]] = None
    category: Optional[str] = None  # prompt_template / style_guide / platform_rule / copywriting
    created_at: Optional[datetime] = None


class SearchResult(BaseModel):
    """向量检索结果"""
    id: str
    content: str
    metadata: Dict[str, Any]
    category: Optional[str] = None
    score: float  # 余弦相似度，越高越相似


class RetrieveResult(BaseModel):
    """RAG 检索返回结果"""
    query: str
    rewritten_query: Optional[str] = None
    results: List[SearchResult] = []
    context: str = ""  # 拼接好的上下文字符串，可直接注入 LLM prompt


class KnowledgeChunk(BaseModel):
    """知识库文档分块"""
    content: str
    metadata: Dict[str, Any] = Field(default_factory=dict)
    category: str = "general"
