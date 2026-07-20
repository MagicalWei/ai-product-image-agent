"""
Embedding 服务 — 统一使用 OpenAI 兼容协议

所有 AI 模型调用统一使用 OpenAI 兼容协议，不再依赖本地 HuggingFace 模型。
"""

import os
import logging
from typing import List, Optional

from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

# 默认 Embedding 配置
DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"
DEFAULT_EMBEDDING_DIM = 1536  # text-embedding-3-small 维度

# text-embedding-3-large 维度为 3072，但 small 版本性价比更高


class EmbeddingService:
    """Embedding 服务 — OpenAI 兼容协议

    用法:
        svc = EmbeddingService(api_key="sk-xxx", base_url="https://api.openai.com/v1")
        vectors = await svc.embed(["文本1", "文本2"])
        vec = await svc.embed_query("单条查询")
    """

    def __init__(
        self,
        api_key: str,
        base_url: Optional[str] = None,
        model: str = DEFAULT_EMBEDDING_MODEL,
        dimension: int = DEFAULT_EMBEDDING_DIM,
    ):
        if not api_key:
            raise ValueError("Embedding API key is required")

        self.api_key = api_key
        self.base_url = base_url or "https://api.openai.com/v1"
        self.model = model
        self.dim = dimension

        self.client = AsyncOpenAI(
            api_key=api_key,
            base_url=self.base_url,
        )
        logger.info(
            f"EmbeddingService initialized: model={self.model}, "
            f"base_url={self.base_url}, dim={self.dim}"
        )

    async def embed(self, texts: List[str]) -> List[List[float]]:
        """批量文本转向量

        Args:
            texts: 文本列表，每批最多 2048 条（OpenAI 限制）

        Returns:
            向量列表，每个向量长度为 dim
        """
        if not texts:
            return []

        # OpenAI embedding API 单次调用限制约 2048 条，这里做简单分批
        # Keep compatibility with providers such as DashScope whose
        # OpenAI-compatible endpoint accepts at most 10 inputs per request.
        batch_size = 10
        all_embeddings: List[List[float]] = []

        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            try:
                resp = await self.client.embeddings.create(
                    model=self.model,
                    input=batch,
                    dimensions=self.dim,
                )
                # 按 index 排序确保顺序
                batch_embeddings = sorted(resp.data, key=lambda x: x.index)
                all_embeddings.extend([e.embedding for e in batch_embeddings])
            except Exception as e:
                logger.error(f"Embedding batch {i // batch_size} failed: {e}")
                raise

        return all_embeddings

    async def embed_query(self, text: str) -> List[float]:
        """单条查询转向量

        Args:
            text: 查询文本

        Returns:
            向量（长度为 dim 的浮点数列表）
        """
        if not text:
            raise ValueError("Embedding text cannot be empty")

        results = await self.embed([text])
        return results[0]

    @property
    def dimension(self) -> int:
        return self.dim
