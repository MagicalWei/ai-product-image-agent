"""Multimodal Agent for extracting and safely adapting viral-video structure."""

from __future__ import annotations

import json
import os
import sys
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

_AGENT_SERVICE_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "backend", "agent_service"),
)


class ReplicationShot(BaseModel):
    model_config = ConfigDict(extra="ignore")

    reference_start: float = Field(ge=0, le=60)
    reference_end: float = Field(gt=0, le=60)
    target_duration: float = Field(ge=0.6, le=12)
    purpose: str = Field(min_length=1, max_length=100)
    shot_type: str = Field(default="product", max_length=80)
    camera: str = Field(default="", max_length=100)
    motion: str = Field(default="", max_length=100)
    visual_style: str = Field(default="", max_length=240)
    copy_pattern: str = Field(default="", max_length=160)
    adapted_copy: str = Field(default="", max_length=120)
    product_source_kind: str = Field(default="missing", pattern="^(video|image|missing)$")
    product_source_index: int = Field(default=0, ge=0, le=8)
    product_start: float = Field(default=0, ge=0, le=60)
    product_end: float = Field(default=0, ge=0, le=60)
    match_reason: str = Field(default="", max_length=200)


class ReplicationBlueprint(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str = Field(default="爆款结构复刻方案", max_length=120)
    summary: str = Field(default="", max_length=600)
    hook_type: str = Field(default="", max_length=100)
    hook_pattern: str = Field(default="", max_length=200)
    overall_style: str = Field(default="", max_length=400)
    pacing: str = Field(default="", max_length=200)
    shots: list[ReplicationShot] = Field(min_length=1, max_length=12)
    cta_pattern: str = Field(default="", max_length=200)
    originality_notes: list[str] = Field(default_factory=list, max_length=8)
    risks: list[str] = Field(default_factory=list, max_length=8)


def _clean_json(raw: str) -> dict[str, Any]:
    text = str(raw or "").strip()
    fenced = text.find("```")
    if fenced >= 0:
        text = text.replace("```json", "").replace("```", "").strip()
    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        text = text[start:end + 1]
    return json.loads(text)


def normalize_replication_blueprint(
    raw: dict[str, Any],
    *,
    reference_duration: float,
    product_sources: list[dict[str, Any]],
) -> dict[str, Any]:
    blueprint = ReplicationBlueprint.model_validate(raw)
    sources_by_kind: dict[str, list[dict[str, Any]]] = {"video": [], "image": []}
    for source in product_sources:
        kind = str(source.get("kind") or "")
        if kind in sources_by_kind:
            sources_by_kind[kind].append(source)

    normalized_shots = []
    for shot in blueprint.shots:
        start = min(max(0.0, shot.reference_start), max(0.0, reference_duration - 0.1))
        end = min(max(start + 0.1, shot.reference_end), reference_duration)
        kind = shot.product_source_kind
        kind_sources = sources_by_kind.get(kind, [])
        source_index = shot.product_source_index
        if kind == "missing" or source_index >= len(kind_sources):
            kind, source_index = "missing", 0
        product_start, product_end = 0.0, 0.0
        if kind == "video":
            duration = float(kind_sources[source_index].get("duration") or 0)
            product_start = min(max(0.0, shot.product_start), duration)
            requested_end = shot.product_end or product_start + shot.target_duration
            product_end = min(max(product_start + 0.1, requested_end), duration)
            if product_end <= product_start:
                kind = "missing"
        elif kind == "image":
            product_end = shot.target_duration

        normalized_shots.append({
            **shot.model_dump(mode="json"),
            "reference_start": round(start, 3),
            "reference_end": round(end, 3),
            "target_duration": round(min(shot.target_duration, 6.0), 3),
            "product_source_kind": kind,
            "product_source_index": source_index,
            "product_start": round(product_start, 3),
            "product_end": round(product_end, 3),
        })

    result = blueprint.model_dump(mode="json")
    result["shots"] = normalized_shots
    result["reference_duration"] = round(reference_duration, 3)
    result["target_duration"] = round(sum(shot["target_duration"] for shot in normalized_shots), 3)
    result["aspect_ratio"] = "9:16"
    result["mapped_shots"] = sum(shot["product_source_kind"] != "missing" for shot in normalized_shots)
    result["missing_shots"] = sum(shot["product_source_kind"] == "missing" for shot in normalized_shots)
    return result


async def analyze_viral_replication(
    *,
    reference_frames: list[dict[str, Any]],
    reference_duration: float,
    product_sources: list[dict[str, Any]],
    instruction: str,
    strength: str,
    multimodal_config: dict[str, str],
) -> dict[str, Any]:
    if reference_duration <= 0 or reference_duration > 60:
        raise ValueError("参考视频时长必须在 60 秒以内")
    if not reference_frames:
        raise ValueError("参考视频没有可分析的关键帧")
    if not product_sources:
        raise ValueError("请至少上传一个新商品素材")
    if _AGENT_SERVICE_DIR not in sys.path:
        sys.path.insert(0, _AGENT_SERVICE_DIR)
    from chat_client import execute_chat_with_fallbacks

    content: list[dict[str, Any]] = [{
        "type": "text",
        "text": (
            "先分析参考视频的高转化结构，再用新商品素材重新编排。"
            "只复用抽象结构、节奏、镜头语言和文案公式，不复制品牌、Logo、人物身份、完整文案或受版权保护素材。"
            f"\n复刻强度：{strength}。用户补充要求：{instruction[:500]}"
        ),
    }]
    for frame in reference_frames:
        content.extend([
            {"type": "text", "text": f"参考视频 {float(frame['timestamp']):.2f} 秒"},
            {"type": "image_url", "image_url": {"url": frame["image"], "detail": "low"}},
        ])
    for source in product_sources:
        source_index = source["source_index"]
        kind = source["kind"]
        for frame in source.get("frames", []):
            timestamp = float(frame.get("timestamp") or 0)
            content.extend([
                {"type": "text", "text": f"新商品{kind}素材 {source_index}，{timestamp:.2f} 秒"},
                {"type": "image_url", "image_url": {"url": frame["image"], "detail": "low"}},
            ])

    source_meta = [{
        "kind": source["kind"],
        "source_index": source["source_index"],
        "duration": source.get("duration", 0),
    } for source in product_sources]
    content.append({
        "type": "text",
        "text": (
            f"参考时长：{reference_duration:.2f}s；新商品素材：{json.dumps(source_meta, ensure_ascii=False)}。"
            "输出严格 JSON，最多 12 个镜头。product_source_index 是同一种 kind 内的编号。"
            "没有匹配素材必须写 missing，禁止编造素材。adapted_copy 必须改写为新商品可用的原创短文案。"
            '\n结构：{"title":"","summary":"","hook_type":"","hook_pattern":"","overall_style":"",'
            '"pacing":"","shots":[{"reference_start":0,"reference_end":2,"target_duration":2,'
            '"purpose":"","shot_type":"","camera":"","motion":"","visual_style":"",'
            '"copy_pattern":"","adapted_copy":"","product_source_kind":"video|image|missing",'
            '"product_source_index":0,"product_start":0,"product_end":2,"match_reason":""}],'
            '"cta_pattern":"","originality_notes":[""],"risks":[""]}'
        ),
    })
    primary = {
        "protocol": "openai",
        "api_key": multimodal_config["api_key"],
        "base_url": multimodal_config["base_url"],
        "model": multimodal_config["model"],
        "supports_vision": True,
        "max_tokens": 3000,
        "timeout_seconds": 120,
    }
    messages = [
        {"role": "system", "content": "你是电商短视频结构复刻 Agent。先理解证据，再输出可执行且原创安全的结构蓝图。只输出 JSON。"},
        {"role": "user", "content": content},
    ]
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            response = await execute_chat_with_fallbacks(messages, primary, [])
            return normalize_replication_blueprint(
                _clean_json(response),
                reference_duration=reference_duration,
                product_sources=product_sources,
            )
        except (json.JSONDecodeError, ValidationError, ValueError, TypeError) as error:
            last_error = error
            messages.append({
                "role": "user",
                "content": "上次输出无效。请只返回完整 JSON，并保证所有时间在真实素材时长内。",
            })
    raise RuntimeError(f"爆款结构蓝图生成失败: {last_error}")
