"""
Agent Service — Structured Memory System (Phase 1)

AgentMemory replaces raw chat_history arrays with a structured slot-filling
approach, preventing context bloat and enabling fine-grained state tracking.
"""

import json
from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional


@dataclass
class AgentMemory:
    """Structured agent memory with product info slots and generation history."""

    # ── Product info slots ──
    product_name: str = ""
    product_category: str = ""
    selling_points: str = ""
    ecom_platform: str = ""
    aspect_ratio: str = "1:1"
    language: str = "zh"
    target_country: str = ""

    # ── Design preferences ──
    style_preference: str = ""
    color_palette: List[str] = field(default_factory=list)
    negative_prompt: str = "低画质、变形肢体、模糊、水印"
    image_types: List[str] = field(default_factory=list)

    # ── Generation history (last N entries) ──
    generation_history: List[Dict[str, Any]] = field(default_factory=list)

    # ── Brand memory ──
    brand_name: str = ""
    brand_style: str = ""

    # ── Flow control ──
    is_new_design: bool = True
    needs_planning: bool = True
    last_intent: str = ""
    current_phase: str = "COLLECTING_INFO"

    # ── Flexible flow (Phase 4) ──
    skip_info_collection: bool = False
    skip_design_planning: bool = False
    single_image_mode: bool = False
    target_single_type: str = ""
    refinement_mode: bool = False

    # ── Compact recent chat (last 6 messages) ──
    recent_chat: List[Dict[str, str]] = field(default_factory=list)

    # ── Design plan cache ──
    design_plan: Optional[Dict[str, Any]] = None

    # ── Canvas context ──
    current_images: Dict[str, str] = field(default_factory=dict)
    stitch_regions: List[Dict[str, Any]] = field(default_factory=list)

    # ── Serialization ──

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to JSON-compatible dict for DB storage."""
        return {
            "product_name": self.product_name,
            "product_category": self.product_category,
            "selling_points": self.selling_points,
            "ecom_platform": self.ecom_platform,
            "aspect_ratio": self.aspect_ratio,
            "language": self.language,
            "target_country": self.target_country,
            "style_preference": self.style_preference,
            "color_palette": self.color_palette,
            "negative_prompt": self.negative_prompt,
            "image_types": self.image_types,
            "generation_history": self.generation_history,
            "brand_name": self.brand_name,
            "brand_style": self.brand_style,
            "is_new_design": self.is_new_design,
            "needs_planning": self.needs_planning,
            "last_intent": self.last_intent,
            "current_phase": self.current_phase,
            "skip_info_collection": self.skip_info_collection,
            "skip_design_planning": self.skip_design_planning,
            "single_image_mode": self.single_image_mode,
            "target_single_type": self.target_single_type,
            "refinement_mode": self.refinement_mode,
            "recent_chat": self.recent_chat,
            "design_plan": self.design_plan,
            "current_images": self.current_images,
            "stitch_regions": self.stitch_regions,
        }

    @classmethod
    def from_dict(cls, data: Optional[Dict[str, Any]]) -> "AgentMemory":
        """Deserialize from DB JSONB field."""
        if not data or not isinstance(data, dict):
            return cls()

        return cls(
            product_name=data.get("product_name", ""),
            product_category=data.get("product_category", ""),
            selling_points=data.get("selling_points", ""),
            ecom_platform=data.get("ecom_platform", ""),
            aspect_ratio=data.get("aspect_ratio", "1:1"),
            language=data.get("language", "zh"),
            target_country=data.get("target_country", ""),
            style_preference=data.get("style_preference", ""),
            color_palette=data.get("color_palette", []),
            negative_prompt=data.get("negative_prompt", "低画质、变形肢体、模糊、水印"),
            image_types=data.get("image_types", []),
            generation_history=data.get("generation_history", []),
            brand_name=data.get("brand_name", ""),
            brand_style=data.get("brand_style", ""),
            is_new_design=data.get("is_new_design", True),
            needs_planning=data.get("needs_planning", True),
            last_intent=data.get("last_intent", ""),
            current_phase=data.get("current_phase", "COLLECTING_INFO"),
            skip_info_collection=data.get("skip_info_collection", False),
            skip_design_planning=data.get("skip_design_planning", False),
            single_image_mode=data.get("single_image_mode", False),
            target_single_type=data.get("target_single_type", ""),
            refinement_mode=data.get("refinement_mode", False),
            recent_chat=data.get("recent_chat", []),
            design_plan=data.get("design_plan"),
            current_images=data.get("current_images", {}),
            stitch_regions=data.get("stitch_regions", []),
        )

    # ── Update methods ──

    def update_from_collect_info(self, result: Dict[str, Any]) -> None:
        """Populate slots from Phase 1 collect_info result."""
        if result.get("product_name"):
            self.product_name = result["product_name"]
        if result.get("selling_points"):
            self.selling_points = result["selling_points"]
        if result.get("ecom_platform"):
            self.ecom_platform = result["ecom_platform"]
        if result.get("aspect_ratio"):
            self.aspect_ratio = result["aspect_ratio"]
        if result.get("language"):
            self.language = result["language"]
        if result.get("target_country"):
            self.target_country = result["target_country"]
        if result.get("image_types"):
            self.image_types = result["image_types"]
        if result.get("style_preference"):
            self.style_preference = result["style_preference"]
        if result.get("color_palette"):
            self.color_palette = result["color_palette"]
        if result.get("negative_prompt"):
            self.negative_prompt = result["negative_prompt"]
        if result.get("product_category"):
            self.product_category = result["product_category"]

        self.is_new_design = False
        self.needs_planning = True

    def update_from_design_plan(self, plan: Dict[str, Any]) -> None:
        """Store design plan and mark planning as done."""
        self.design_plan = plan
        self.needs_planning = False

    def record_generation(self, img_type: str, prompt: str, url: str, score: float) -> None:
        """Record a generation attempt in history (keeps last 20)."""
        self.generation_history.append({
            "image_type": img_type,
            "prompt": prompt,
            "url": url,
            "score": score,
        })
        # Trim to last 20
        if len(self.generation_history) > 20:
            self.generation_history = self.generation_history[-20:]

    def add_chat_turn(self, role: str, content: str) -> None:
        """Add a chat turn to recent_chat (keeps last 6 messages)."""
        self.recent_chat.append({"role": role, "content": content})
        if len(self.recent_chat) > 6:
            self.recent_chat = self.recent_chat[-6:]

    def reset_for_new_design(self) -> None:
        """Reset memory for a new design session."""
        self.product_name = ""
        self.product_category = ""
        self.selling_points = ""
        self.image_types = []
        self.style_preference = ""
        self.color_palette = []
        self.design_plan = None
        self.generation_history = []
        self.is_new_design = True
        self.needs_planning = True
        self.current_phase = "COLLECTING_INFO"
        self.skip_info_collection = False
        self.skip_design_planning = False
        self.single_image_mode = False
        self.target_single_type = ""
        self.refinement_mode = False
        self.current_images = {}
        self.stitch_regions = []

    def update_brand(self, brand_name: str = "", brand_style: str = "") -> None:
        """Update brand memory slots."""
        if brand_name:
            self.brand_name = brand_name
        if brand_style:
            self.brand_style = brand_style

    def build_llm_context(self) -> str:
        """Build a compact context string for LLM system prompts.

        Replaces raw chat_history arrays with structured slot summaries,
        preventing context bloat beyond 10 turns.
        """
        parts = []

        # Product info
        if self.product_name:
            parts.append(f"产品: {self.product_name}")
        if self.product_category:
            parts.append(f"类别: {self.product_category}")
        if self.selling_points:
            parts.append(f"卖点: {self.selling_points}")
        if self.ecom_platform:
            parts.append(f"平台: {self.ecom_platform}")
        if self.target_country:
            parts.append(f"目标国家: {self.target_country}")
        if self.aspect_ratio:
            parts.append(f"比例: {self.aspect_ratio}")

        # Design preferences
        if self.style_preference:
            parts.append(f"风格: {self.style_preference}")
        if self.color_palette:
            parts.append(f"色调: {', '.join(self.color_palette)}")
        if self.negative_prompt:
            parts.append(f"负向提示: {self.negative_prompt}")

        # Image types
        if self.image_types:
            parts.append(f"图片类型: {', '.join(self.image_types)}")

        # Brand
        if self.brand_name:
            parts.append(f"品牌: {self.brand_name}")
        if self.brand_style:
            parts.append(f"品牌风格: {self.brand_style}")

        # Flow control
        if self.single_image_mode and self.target_single_type:
            parts.append(f"[只要 {self.target_single_type}]")
        if self.refinement_mode:
            parts.append("[迭代优化模式]")

        # Generation history (compact)
        if self.generation_history:
            latest = self.generation_history[-3:]  # Last 3 only
            history_lines = ["最近生成:"]
            for g in latest:
                history_lines.append(
                    f"  - {g['image_type']}: score={g.get('score', 'N/A')}"
                )
            parts.append("\n".join(history_lines))

        header = "## 当前任务状态\n" if parts else ""
        structured = "\n".join(f"- {p}" for p in parts)

        # Recent chat (compact)
        chat_section = ""
        if self.recent_chat:
            chat_lines = ["\n## 最近对话"]
            for msg in self.recent_chat[-4:]:
                role_label = "用户" if msg["role"] == "user" else "助手"
                content = msg["content"][:200]  # Truncate long messages
                chat_lines.append(f"{role_label}: {content}")
            chat_section = "\n".join(chat_lines)

        return f"{header}{structured}{chat_section}"
