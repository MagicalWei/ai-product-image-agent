"""
pgvector 向量存储 — CRUD + 相似度搜索

使用 asyncpg 直连 PostgreSQL，操作 rag_documents 表。
"""

import os
import json
import logging
from typing import List, Optional, Dict, Any

import asyncpg

from .models import RagDocument, SearchResult

logger = logging.getLogger(__name__)

# pgvector 建表 SQL
CREATE_RAG_TABLE_SQL = """
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS rag_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    embedding vector(1536),
    category VARCHAR(64),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rag_documents_category
    ON rag_documents (category);

CREATE INDEX IF NOT EXISTS idx_rag_documents_embedding
    ON rag_documents USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
"""

# 相似度搜索 SQL（余弦相似度）
SEARCH_SQL = """
SELECT
    id::text,
    content,
    metadata,
    category,
    1 - (embedding <=> $1) AS score
FROM rag_documents
WHERE embedding IS NOT NULL
    AND ($4::varchar IS NULL OR category = $4)
ORDER BY embedding <=> $1
LIMIT $2
OFFSET $3
"""

COUNT_SQL = """
SELECT COUNT(*) FROM rag_documents
WHERE embedding IS NOT NULL
    AND ($1::varchar IS NULL OR category = $1)
"""

INSERT_SQL = """
INSERT INTO rag_documents (content, metadata, embedding, category)
VALUES ($1, $2::jsonb, $3::vector, $4)
ON CONFLICT (id) DO UPDATE
SET content = EXCLUDED.content,
    metadata = EXCLUDED.metadata,
    embedding = EXCLUDED.embedding,
    category = EXCLUDED.category
RETURNING id::text
"""

DELETE_BY_CATEGORY_SQL = """
DELETE FROM rag_documents WHERE category = $1
"""


class VectorStore:
    """pgvector 向量存储

    用法:
        store = VectorStore(database_url="postgresql://...")
        await store.initialize()
        await store.insert(document)
        results = await store.search(query_vector, top_k=5)
        await store.close()
    """

    def __init__(self, database_url: Optional[str] = None):
        self.database_url = database_url or os.getenv("DATABASE_URL", "")
        if not self.database_url:
            raise ValueError("DATABASE_URL is required for VectorStore")

        self.pool: Optional[asyncpg.Pool] = None

    async def initialize(self):
        """初始化连接池并确保表存在"""
        if self.pool is not None:
            return

        self.pool = await asyncpg.create_pool(
            self.database_url,
            min_size=1,
            max_size=5,
            command_timeout=30,
        )
        # 建表
        async with self.pool.acquire() as conn:
            await conn.execute(CREATE_RAG_TABLE_SQL)

        logger.info("VectorStore initialized: pgvector extension + rag_documents table ready")

    async def close(self):
        """关闭连接池"""
        if self.pool:
            await self.pool.close()
            self.pool = None
            logger.info("VectorStore connection pool closed")

    async def insert(self, doc: RagDocument) -> str:
        """插入或更新文档

        Args:
            doc: 文档对象，需包含 content, metadata, embedding(可选), category(可选)

        Returns:
            文档 ID
        """
        if not self.pool:
            raise RuntimeError("VectorStore not initialized. Call initialize() first.")

        embedding_str = None
        if doc.embedding:
            # pgvector 接受格式为 '[0.1, 0.2, ...]' 的字符串
            embedding_str = json.dumps(doc.embedding)

        metadata_json = json.dumps(doc.metadata, ensure_ascii=False)

        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                INSERT_SQL,
                doc.content,
                metadata_json,
                embedding_str,
                doc.category or "general",
            )
            doc_id = row[0]
            return doc_id

    async def insert_batch(self, docs: List[RagDocument]) -> List[str]:
        """批量插入文档

        Args:
            docs: 文档列表

        Returns:
            文档 ID 列表
        """
        if not self.pool:
            raise RuntimeError("VectorStore not initialized. Call initialize() first.")

        ids: List[str] = []
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                for doc in docs:
                    embedding_str = None
                    if doc.embedding:
                        embedding_str = json.dumps(doc.embedding)

                    metadata_json = json.dumps(doc.metadata, ensure_ascii=False)

                    row = await conn.fetchrow(
                        INSERT_SQL,
                        doc.content,
                        metadata_json,
                        embedding_str,
                        doc.category or "general",
                    )
                    ids.append(row[0])

        logger.info(f"Inserted {len(ids)} documents into rag_documents")
        return ids

    async def search(
        self,
        query_vector: List[float],
        top_k: int = 5,
        category: Optional[str] = None,
        offset: int = 0,
    ) -> List[SearchResult]:
        """向量相似度搜索（余弦相似度）

        Args:
            query_vector: 查询向量
            top_k: 返回结果数
            category: 按分类过滤（可选）
            offset: 分页偏移

        Returns:
            按相似度降序排列的搜索结果
        """
        if not self.pool:
            raise RuntimeError("VectorStore not initialized. Call initialize() first.")

        embedding_str = json.dumps(query_vector)

        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                SEARCH_SQL,
                embedding_str,
                top_k,
                offset,
                category,
            )

        results = []
        for row in rows:
            metadata = row["metadata"]
            if isinstance(metadata, str):
                metadata = json.loads(metadata)

            results.append(SearchResult(
                id=row["id"],
                content=row["content"],
                metadata=metadata,
                category=row["category"],
                score=float(row["score"]),
            ))

        return results

    async def count(self, category: Optional[str] = None) -> int:
        """统计文档数量"""
        if not self.pool:
            raise RuntimeError("VectorStore not initialized. Call initialize() first.")

        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(COUNT_SQL, category)
            return row[0] if row else 0

    async def delete_by_category(self, category: str) -> int:
        """按分类删除文档"""
        if not self.pool:
            raise RuntimeError("VectorStore not initialized. Call initialize() first.")

        async with self.pool.acquire() as conn:
            result = await conn.execute(DELETE_BY_CATEGORY_SQL, category)
            # asyncpg 返回格式: "DELETE N"
            count = int(result.split()[-1]) if result else 0
            logger.info(f"Deleted {count} documents from category '{category}'")
            return count
