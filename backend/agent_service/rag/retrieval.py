"""
检索增强模块 — 查询重写 + 向量检索 + 上下文构建

提供 RAGRetriever 类，封装完整的 RAG 检索流程：
  用户查询 → [可选]查询重写 → 向量检索(top-k) → 上下文构建 → 注入 LLM prompt
"""

import logging
from typing import List, Optional, Dict, Any

from .embeddings import EmbeddingService
from .vector_store import VectorStore
from .models import SearchResult, RetrieveResult
from .knowledge_base import QUERY_REWRITE_PROMPT

logger = logging.getLogger(__name__)

# 查询重写系统提示词（复用在 RAG 模块中）
_QUERY_REWRITE_SYSTEM = (
    "你是一个电商商品图领域的查询优化助手。"
    "你的任务是将用户的模糊查询改写为更适合向量检索的精确查询。"
    "改写原则：\n"
    "1. 保持原意不变\n"
    "2. 增加电商商品图相关术语（如 product photography, e-commerce image, white background 等）\n"
    "3. 保持简洁，不要添加无关信息\n"
    "4. 如果原查询已经足够精确，直接返回原查询\n\n"
    "只输出改写后的查询文本，不要输出任何解释或JSON。"
)


class RAGRetriever:
    """RAG 检索器 — 完整的检索增强流程

    用法:
        retriever = RAGRetriever(vector_store, embedding_service)
        result = await retriever.retrieve(
            query="护肤品主图 white background",
            category="prompt_template",
            top_k=3,
        )
        # result.context 可直接注入 LLM prompt
    """

    def __init__(
        self,
        vector_store: VectorStore,
        embedding_service: EmbeddingService,
        enable_query_rewrite: bool = False,
    ):
        self.vector_store = vector_store
        self.embedding_service = embedding_service
        self.enable_query_rewrite = enable_query_rewrite  # 默认关闭，Agent 场景中查询通常已经足够精确

    async def retrieve(
        self,
        query: str,
        category: Optional[str] = None,
        top_k: int = 5,
        rewrite_query: bool = False,
    ) -> RetrieveResult:
        """执行完整的 RAG 检索流程

        Args:
            query: 用户查询文本
            category: 按分类过滤（可选）。可选值: prompt_template / style_guide / platform_rule / copywriting
            top_k: 返回结果数量
            rewrite_query: 是否先对查询做重写（默认 False，Agent 场景查询已足够精确）

        Returns:
            RetrieveResult 包含原始查询、重写后查询、检索结果列表、拼接好的上下文字符串
        """
        result = RetrieveResult(query=query, results=[])

        # Step 1: 查询重写（可选）
        search_query = query
        if rewrite_query and self.enable_query_rewrite:
            # 不做 LLM 查询重写（Agent 场景不需要），仅做简单规范化
            search_query = query.strip().lower()
            result.rewritten_query = search_query
        else:
            result.rewritten_query = query

        # Step 2: 向量检索
        query_vector = await self.embedding_service.embed_query(search_query)
        search_results = await self.vector_store.search(
            query_vector=query_vector,
            top_k=top_k,
            category=category,
        )
        result.results = search_results

        # Step 3: 构建上下文
        result.context = self._build_context(search_results)

        logger.info(
            f"RAG retrieve: query='{query[:80]}', category={category}, "
            f"top_k={top_k}, found={len(search_results)} results"
        )
        return result

    async def retrieve_multi_category(
        self,
        query: str,
        categories: Optional[List[str]] = None,
        top_k_per_category: int = 3,
    ) -> RetrieveResult:
        """多分类检索 — 从多个分类中分别检索并合并结果

        Args:
            query: 用户查询
            categories: 分类列表，None 表示不限分类
            top_k_per_category: 每个分类的返回数量

        Returns:
            RetrieveResult 包含合并去重排序后的检索结果
        """
        if not categories:
            # 不限分类
            return await self.retrieve(query, category=None, top_k=top_k_per_category * 3)

        query_vector = await self.embedding_service.embed_query(query)

        all_results: List[SearchResult] = []
        seen_ids: set = set()

        for cat in categories:
            results = await self.vector_store.search(
                query_vector=query_vector,
                top_k=top_k_per_category,
                category=cat,
            )
            for r in results:
                if r.id not in seen_ids:
                    seen_ids.add(r.id)
                    all_results.append(r)

        # 按 score 降序排列
        all_results.sort(key=lambda x: x.score, reverse=True)

        result = RetrieveResult(query=query, results=all_results)
        result.context = self._build_context(all_results)

        logger.info(
            f"RAG multi-category retrieve: query='{query[:80]}', "
            f"categories={categories}, found={len(all_results)} results"
        )
        return result

    def _build_context(self, results: List[SearchResult], max_length: int = 3000) -> str:
        """构建上下文字符串

        Args:
            results: 检索结果列表
            max_length: 最大字符长度

        Returns:
            格式化的上下文字符串
        """
        if not results:
            return ""

        parts: List[str] = []
        current_length = 0

        for i, r in enumerate(results, 1):
            cat_label = r.category or "通用"
            entry = (
                f"【参考 {i}】(分类: {cat_label}, 相关度: {r.score:.2f})\n"
                f"{r.content}\n"
            )
            if current_length + len(entry) > max_length:
                break
            parts.append(entry)
            current_length += len(entry)

        return "\n".join(parts)
