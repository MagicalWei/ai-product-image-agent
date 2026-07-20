"""Combine global knowledge RAG with account-scoped media memory."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any


class AccountRetrievalFacade:
    def __init__(self, knowledge_retriever: Any, media_service: Any, uid: str):
        self.knowledge_retriever = knowledge_retriever
        self.media_service = media_service
        self.uid = uid
        self._media_context_cache: dict[str, str] = {}

    async def retrieve_multi_category(self, query: str, categories=None, top_k_per_category: int = 3):
        knowledge = None
        if self.knowledge_retriever is not None:
            try:
                knowledge = await self.knowledge_retriever.retrieve_multi_category(
                    query=query,
                    categories=categories,
                    top_k_per_category=top_k_per_category,
                )
            except Exception:
                knowledge = None
        media_context = self._media_context_cache.get(query, "")
        if query not in self._media_context_cache:
            try:
                media_context = await self.media_service.context_for_agent(
                    self.uid,
                    query,
                    top_k=min(4, max(2, top_k_per_category)),
                )
            except Exception:
                media_context = ""
            self._media_context_cache[query] = media_context
        contexts = []
        if media_context:
            contexts.append("## 当前账号历史视觉素材\n" + media_context)
        if knowledge is not None and knowledge.context:
            contexts.append(knowledge.context)
        return SimpleNamespace(
            query=query,
            results=getattr(knowledge, "results", []) if knowledge else [],
            context="\n\n".join(contexts),
        )

    async def retrieve(self, query: str, category=None, top_k: int = 5, **kwargs):
        return await self.retrieve_multi_category(
            query=query,
            categories=[category] if category else None,
            top_k_per_category=top_k,
        )
