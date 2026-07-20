"""Persistence for account-isolated image and video-segment embeddings."""

from __future__ import annotations

import json
from typing import Any


class MediaEmbeddingRepository:
    VECTOR_COLUMNS = {
        "content": "content_embedding",
        "style": "style_embedding",
        "product": "product_embedding",
    }

    def __init__(self, pool: Any):
        self.pool = pool

    async def replace_segments(
        self,
        *,
        uid: str,
        asset_id: str,
        session_id: str | None,
        media_type: str,
        segments: list[dict[str, Any]],
    ) -> None:
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                owner = await connection.fetchval(
                    "SELECT 1 FROM assets WHERE id = $1 AND uid = $2",
                    asset_id,
                    uid,
                )
                if not owner:
                    raise ValueError("素材不存在或不属于当前账号")
                await connection.execute(
                    "DELETE FROM media_embeddings WHERE asset_id = $1 AND uid = $2",
                    asset_id,
                    uid,
                )
                for segment in segments:
                    await connection.execute(
                        """
                        INSERT INTO media_embeddings (
                            uid, asset_id, session_id, segment_index, media_type,
                            content_text, style_text, product_text,
                            start_time, end_time, keyframe_url, metadata,
                            content_embedding, style_embedding, product_embedding
                        ) VALUES (
                            $1, $2, $3, $4, $5, $6, $7, $8,
                            $9, $10, $11, $12::jsonb,
                            $13::vector, $14::vector, $15::vector
                        )
                        """,
                        uid,
                        asset_id,
                        session_id,
                        segment["segment_index"],
                        media_type,
                        segment["content_text"],
                        segment["style_text"],
                        segment["product_text"],
                        segment.get("start_time"),
                        segment.get("end_time"),
                        segment.get("keyframe_url", ""),
                        json.dumps(segment.get("metadata", {}), ensure_ascii=False),
                        json.dumps(segment["content_embedding"]),
                        json.dumps(segment["style_embedding"]),
                        json.dumps(segment["product_embedding"]),
                    )
                await connection.execute(
                    """
                    UPDATE assets
                    SET index_status = 'indexed', indexed_at = CURRENT_TIMESTAMP, index_error = ''
                    WHERE id = $1 AND uid = $2
                    """,
                    asset_id,
                    uid,
                )

    async def mark_status(self, uid: str, asset_id: str, status: str, error: str = "") -> None:
        await self.pool.execute(
            """
            UPDATE assets SET index_status = $1, index_error = $2
            WHERE id = $3 AND uid = $4
            """,
            status,
            error[:500],
            asset_id,
            uid,
        )

    async def search(
        self,
        *,
        uid: str,
        query_vector: list[float],
        vector_kind: str = "content",
        media_type: str | None = None,
        top_k: int = 6,
        min_score: float = 0.0,
    ) -> list[dict[str, Any]]:
        vector_column = self.VECTOR_COLUMNS.get(vector_kind)
        if vector_column is None:
            raise ValueError("不支持的媒体向量类型")
        rows = await self.pool.fetch(
            f"""
            SELECT m.id::text, m.asset_id, m.segment_index, m.media_type,
                   m.content_text, m.style_text, m.product_text,
                   m.start_time, m.end_time, m.keyframe_url, m.metadata,
                   a.name AS asset_name, a.url AS asset_url,
                   1 - (m.{vector_column} <=> $1::vector) AS score
            FROM media_embeddings m
            JOIN assets a ON a.id = m.asset_id AND a.uid = m.uid
            WHERE m.uid = $2
              AND m.{vector_column} IS NOT NULL
              AND ($3::varchar IS NULL OR m.media_type = $3)
              AND 1 - (m.{vector_column} <=> $1::vector) >= $4
            ORDER BY m.{vector_column} <=> $1::vector
            LIMIT $5
            """,
            json.dumps(query_vector),
            uid,
            media_type,
            min_score,
            max(1, min(top_k, 20)),
        )
        return [dict(row) for row in rows]
