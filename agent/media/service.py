"""Convert validated multimodal observations into searchable pgvector records."""

from __future__ import annotations

import asyncio
from typing import Any

from .repository import MediaEmbeddingRepository


def _text(value: Any, limit: int = 2000) -> str:
    return str(value or "").strip()[:limit]


def _join(values: Any, limit: int = 2000) -> str:
    if not isinstance(values, list):
        return _text(values, limit)
    return "；".join(_text(value, 300) for value in values if _text(value, 300))[:limit]


def _style_text(analysis: dict[str, Any]) -> str:
    style = analysis.get("visual_style") or analysis.get("style") or {}
    if isinstance(style, str):
        return _text(style)
    if not isinstance(style, dict):
        return ""
    ordered = (
        style.get("style_summary"), style.get("background"), style.get("lighting"),
        style.get("composition"), style.get("color_palette"), style.get("typography"),
        style.get("mood"), style.get("camera"),
    )
    return _join([value for value in ordered if value])


def build_media_segments(
    analysis: dict[str, Any],
    *,
    media_type: str,
    source_index: int = 0,
) -> list[dict[str, Any]]:
    if media_type == "video":
        scenes = [
            scene for scene in analysis.get("scenes", [])
            if int(scene.get("source_index", 0)) == source_index
        ]
        product = _text(analysis.get("product"))
        selling_points = _join(analysis.get("selling_points"))
        base_style = _style_text(analysis)
        segments = []
        for index, scene in enumerate(scenes):
            description = _text(scene.get("description"))
            scene_style = _text(scene.get("style") or scene.get("visual_style"))
            segments.append({
                "segment_index": index,
                "content_text": f"{description}。商品：{product}。卖点：{selling_points}".strip("。"),
                "style_text": scene_style or base_style or description,
                "product_text": f"{product}；{selling_points}".strip("；"),
                "start_time": float(scene.get("start", 0)),
                "end_time": float(scene.get("end", 0)),
                "metadata": {
                    "source_index": source_index,
                    "importance": scene.get("importance"),
                    "quality": scene.get("quality"),
                },
            })
        if segments:
            return segments
        return [{
            "segment_index": 0,
            "content_text": _text(analysis.get("summary")) or f"商品视频：{product}",
            "style_text": base_style or _text(analysis.get("summary")),
            "product_text": f"{product}；{selling_points}".strip("；"),
            "metadata": {"source_index": source_index},
        }]

    product = analysis.get("product") or {}
    product_name = _text(product.get("product_name") if isinstance(product, dict) else product)
    product_category = _text(product.get("product_category") if isinstance(product, dict) else "")
    visible_facts = _join(analysis.get("visible_facts"))
    selling_points_raw = analysis.get("selling_points") or []
    selling_points = []
    for point in selling_points_raw if isinstance(selling_points_raw, list) else []:
        if isinstance(point, dict):
            selling_points.append("：".join(filter(None, [_text(point.get("title")), _text(point.get("description"))])))
        else:
            selling_points.append(_text(point))
    selling_point_text = _join(selling_points)
    style = _style_text(analysis)
    return [{
        "segment_index": 0,
        "content_text": f"{product_name}。{visible_facts}。{selling_point_text}".strip("。"),
        "style_text": style or visible_facts,
        "product_text": f"{product_name}；{product_category}；{selling_point_text}".strip("；"),
        "metadata": {
            "confidence": product.get("confidence") if isinstance(product, dict) else None,
            "uncertain_claims": analysis.get("uncertain_claims", []),
        },
    }]


class MediaVectorService:
    def __init__(self, repository: MediaEmbeddingRepository, embedding_service: Any):
        self.repository = repository
        self.embedding_service = embedding_service

    async def index_analysis(
        self,
        *,
        uid: str,
        asset_id: str,
        session_id: str | None,
        media_type: str,
        analysis: dict[str, Any],
        source_index: int = 0,
    ) -> int:
        await self.repository.mark_status(uid, asset_id, "indexing")
        try:
            segments = build_media_segments(analysis, media_type=media_type, source_index=source_index)
            texts: list[str] = []
            for segment in segments:
                texts.extend([
                    segment["content_text"] or "未描述的媒体内容",
                    segment["style_text"] or "未描述的视觉风格",
                    segment["product_text"] or "未识别商品",
                ])
            vectors = await self.embedding_service.embed(texts)
            for index, segment in enumerate(segments):
                segment["content_embedding"] = vectors[index * 3]
                segment["style_embedding"] = vectors[index * 3 + 1]
                segment["product_embedding"] = vectors[index * 3 + 2]
            await self.repository.replace_segments(
                uid=uid,
                asset_id=asset_id,
                session_id=session_id,
                media_type=media_type,
                segments=segments,
            )
            return len(segments)
        except Exception as error:
            await self.repository.mark_status(uid, asset_id, "failed", str(error))
            raise

    async def search(
        self,
        *,
        uid: str,
        query: str,
        vector_kind: str = "content",
        media_type: str | None = None,
        top_k: int = 6,
        min_score: float = 0.0,
    ) -> list[dict[str, Any]]:
        vector = await self.embedding_service.embed_query(query)
        return await self.repository.search(
            uid=uid,
            query_vector=vector,
            vector_kind=vector_kind,
            media_type=media_type,
            top_k=top_k,
            min_score=min_score,
        )

    async def context_for_agent(self, uid: str, query: str, top_k: int = 4) -> str:
        query_vector = await self.embedding_service.embed_query(query)
        content_results, style_results = await asyncio.gather(
            self.repository.search(
                uid=uid, query_vector=query_vector, vector_kind="content", top_k=top_k, min_score=0.2,
            ),
            self.repository.search(
                uid=uid, query_vector=query_vector, vector_kind="style", top_k=top_k, min_score=0.2,
            ),
        )
        merged: dict[str, dict[str, Any]] = {}
        for item in [*content_results, *style_results]:
            identity = str(item["id"])
            if identity not in merged or float(item["score"]) > float(merged[identity]["score"]):
                merged[identity] = item
        results = sorted(merged.values(), key=lambda item: float(item["score"]), reverse=True)[:top_k]
        if not results:
            return ""
        parts = []
        for index, item in enumerate(results, 1):
            time_range = ""
            if item.get("start_time") is not None and item.get("end_time") is not None:
                time_range = f"，片段 {float(item['start_time']):.1f}-{float(item['end_time']):.1f}s"
            parts.append(
                f"【历史素材 {index}】{item['asset_name']}{time_range}，相关度 {float(item['score']):.2f}\n"
                f"内容：{item['content_text']}\n风格：{item['style_text']}\n素材地址：{item['asset_url']}"
            )
        return "\n".join(parts)
