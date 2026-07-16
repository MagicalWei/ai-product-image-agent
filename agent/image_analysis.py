"""Deterministic multimodal product-image analysis for the MVP."""

from __future__ import annotations

import base64
import json
import logging
import os
import sys
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

logger = logging.getLogger(__name__)

_AGENT_SERVICE_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "backend", "agent_service"),
)


class ProductIdentification(BaseModel):
    model_config = ConfigDict(extra="ignore")

    product_name: str = Field(min_length=1, max_length=120)
    product_category: str = Field(default="", max_length=120)
    confidence: float = Field(ge=0, le=1)

    @field_validator("confidence", mode="before")
    @classmethod
    def normalize_confidence(cls, value: Any) -> float:
        if isinstance(value, str):
            return {"high": 0.9, "medium": 0.65, "low": 0.35}.get(value.lower(), value)
        return value


class SellingPoint(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=240)
    visual_evidence: str = Field(min_length=1, max_length=240)
    confidence: float = Field(ge=0, le=1)
    verification: Literal["confirmed_visual", "likely_visual", "unsupported"]

    @field_validator("confidence", mode="before")
    @classmethod
    def normalize_confidence(cls, value: Any) -> float:
        if isinstance(value, str):
            return {"high": 0.9, "medium": 0.65, "low": 0.35}.get(value.lower(), value)
        return value


class ImageQuality(BaseModel):
    model_config = ConfigDict(extra="ignore")

    subject_complete: bool = True
    clarity: Literal["good", "fair", "poor"] = "fair"
    issues: list[str] = Field(default_factory=list, max_length=6)


class ProductImageAnalysis(BaseModel):
    """Validated draft. It is not Agent memory until explicitly confirmed."""

    model_config = ConfigDict(extra="ignore")

    schema_version: Literal["1.0"] = "1.0"
    status: Literal["draft", "confirmed"] = "draft"
    product: ProductIdentification
    visible_facts: list[str] = Field(min_length=1, max_length=12)
    selling_points: list[SellingPoint] = Field(min_length=3, max_length=5)
    uncertain_claims: list[str] = Field(default_factory=list, max_length=8)
    image_quality: ImageQuality = Field(default_factory=ImageQuality)


IMAGE_ANALYSIS_OUTPUT_SCHEMA = {
    "schema_version": "1.0",
    "status": "draft",
    "product": {
        "product_name": "商品通用名称，不要编造品牌或型号",
        "product_category": "商品类别",
        "confidence": 0.85,
    },
    "visible_facts": ["图片中可以直接观察到的事实"],
    "selling_points": [
        {
            "title": "候选卖点1",
            "description": "谨慎描述1",
            "visual_evidence": "具体视觉证据1",
            "confidence": 0.8,
            "verification": "confirmed_visual | likely_visual | unsupported",
        },
        {
            "title": "候选卖点2",
            "description": "谨慎描述2",
            "visual_evidence": "具体视觉证据2",
            "confidence": 0.7,
            "verification": "confirmed_visual | likely_visual | unsupported",
        },
        {
            "title": "候选卖点3",
            "description": "谨慎描述3",
            "visual_evidence": "具体视觉证据3",
            "confidence": 0.6,
            "verification": "confirmed_visual | likely_visual | unsupported",
        },
    ],
    "uncertain_claims": ["图片无法证明的关键性能或参数"],
    "image_quality": {
        "subject_complete": True,
        "clarity": "good | fair | poor",
        "issues": ["影响识别的图片问题"],
    },
}

IMAGE_ANALYSIS_SYSTEM_PROMPT = """
你是严谨的电商商品图分析师。只分析图片中真实可见的信息，输出简体中文 JSON。

目标：识别商品，并给出 3-5 条候选卖点。每条卖点必须包含具体视觉证据和 0-1 置信度。

强制规则：
1. 严格区分可见事实与推测。图片不能证明的续航、容量、功率、防水等级、材质成分、认证、疗效、性能数据，不得写成事实。
2. confirmed_visual 仅用于图片能够直接证明的卖点；likely_visual 用于合理但仍需用户确认的推测；unsupported 用于图片不支持、必须补充资料的主张。
3. 不识别或猜测不存在的品牌、型号、参数和功能。
4. 即使图片信息不足，也返回 3 条谨慎候选卖点，可降低置信度并明确需要确认；不要向用户提问。
5. visible_facts 只写直接观察结果。uncertain_claims 明确列出无法从图片判断的内容。
6. 只输出 JSON，不要 markdown、解释或前后缀。
""".strip()


def _normalize_image_data(image_base64: str) -> str:
    if not image_base64 or not isinstance(image_base64, str):
        raise ValueError("图片数据为空")
    if image_base64.startswith("data:"):
        header, separator, payload = image_base64.partition(",")
        if not separator or ";base64" not in header:
            raise ValueError("图片 Data URL 格式无效")
        mime_type = header[5:].split(";", 1)[0]
        if mime_type not in {"image/jpeg", "image/png", "image/webp"}:
            raise ValueError("仅支持 JPG、PNG、WebP 图片")
    else:
        payload = image_base64
        image_base64 = f"data:image/png;base64,{payload}"
    try:
        raw = base64.b64decode(payload, validate=True)
    except Exception as exc:
        raise ValueError("图片 Base64 数据无效") from exc
    if not raw:
        raise ValueError("图片内容为空")
    if len(raw) > 10 * 1024 * 1024:
        raise ValueError("图片不能超过 10 MB")
    return image_base64


async def analyze_product_image(
    image_base64: str,
    multimodal_config: dict[str, Any] | None = None,
    file_name: str = "",
) -> dict[str, Any]:
    """Analyze one product image with one bounded JSON-repair retry."""
    config = multimodal_config or {
        "api_key": os.getenv("DASHSCOPE_API_KEY", ""),
        "base_url": os.getenv("MULTIMODAL_BASE_URL", ""),
        "model": os.getenv("MULTIMODAL_MODEL", "qwen3.6-plus"),
    }
    if not config.get("api_key"):
        raise RuntimeError("服务器未配置多模态模型 API Key")

    image_url = _normalize_image_data(image_base64)
    schema = json.dumps(IMAGE_ANALYSIS_OUTPUT_SCHEMA, ensure_ascii=False, indent=2)
    system_prompt = f"{IMAGE_ANALYSIS_SYSTEM_PROMPT}\n\n严格按照以下结构输出：\n{schema}"
    messages = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "分析这张商品图，返回可核验的商品事实和候选卖点。"},
                {"type": "image_url", "image_url": {"url": image_url}},
            ],
        },
    ]

    if _AGENT_SERVICE_DIR not in sys.path:
        sys.path.insert(0, _AGENT_SERVICE_DIR)
    from chat_client import execute_chat_with_fallbacks
    from config import clean_json_string

    primary_config = {
        "protocol": "openai",
        "api_key": config["api_key"],
        "base_url": config.get("base_url", ""),
        "model": config.get("model", "qwen3.6-plus"),
        "supports_vision": True,
        # The validated MVP schema is compact; bounding the response prevents
        # long, verbose generations from delaying the confirmation card.
        "max_tokens": 1000,
    }

    last_error: Exception | None = None
    for attempt in range(2):
        attempt_messages = messages
        if attempt == 1:
            attempt_messages = messages + [{
                "role": "user",
                "content": "上一次输出未通过结构校验。请重新查看原图，只输出符合 schema 的完整 JSON，卖点必须为 3-5 条。",
            }]
        try:
            response = await execute_chat_with_fallbacks(attempt_messages, primary_config, [])
            parsed = json.loads(clean_json_string(response))
            result = ProductImageAnalysis.model_validate(parsed)
            logger.info(
                "[ImageAnalysis] product=%s selling_points=%s file=%s",
                result.product.product_name,
                len(result.selling_points),
                file_name,
            )
            return result.model_dump(mode="json")
        except (json.JSONDecodeError, ValidationError, TypeError, ValueError) as exc:
            last_error = exc
            logger.warning("[ImageAnalysis] Invalid structured output attempt %s: %s", attempt + 1, exc)

    raise RuntimeError(f"多模态模型未返回有效的商品分析结果: {last_error}")


def encode_image_file_to_base64(file_path: str) -> str | None:
    import mimetypes

    try:
        mime_type = mimetypes.guess_type(file_path)[0] or "image/png"
        with open(file_path, "rb") as file:
            data = file.read()
        return f"data:{mime_type};base64,{base64.b64encode(data).decode('utf-8')}"
    except Exception as exc:
        logger.error("[ImageAnalysis] Failed to encode file %s: %s", file_path, exc)
        return None
