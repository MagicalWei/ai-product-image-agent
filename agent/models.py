"""
Agent — Pydantic Models

Core data model definitions for the sense-decide-act-review agent architecture.
This is the type foundation for all other modules. No dependencies on any
other agent module.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


# ========================================================
# Geometry
# ========================================================


class BoundingBox(BaseModel):
    """A rectangular region in pixel coordinates."""

    x: float = 0.0
    y: float = 0.0
    width: float = 0.0
    height: float = 0.0

    @property
    def area(self) -> float:
        return self.width * self.height

    def to_tuple(self) -> tuple[float, float, float, float]:
        return (self.x, self.y, self.width, self.height)

    @classmethod
    def from_normalized(
        cls, nx: float, ny: float, nw: float, nh: float, canvas_w: int, canvas_h: int
    ) -> "BoundingBox":
        """Convert normalized (0-1) coords to pixel coords."""
        return cls(
            x=nx * canvas_w,
            y=ny * canvas_h,
            width=nw * canvas_w,
            height=nh * canvas_h,
        )

    def to_normalized(self, canvas_w: int, canvas_h: int) -> "BoundingBox":
        """Convert pixel coords to normalized (0-1)."""
        return BoundingBox(
            x=self.x / canvas_w if canvas_w else 0,
            y=self.y / canvas_h if canvas_h else 0,
            width=self.width / canvas_w if canvas_w else 0,
            height=self.height / canvas_h if canvas_h else 0,
        )


class CanvasSize(BaseModel):
    """Canvas dimensions in pixels."""

    width: int = 1920
    height: int = 1920


# ========================================================
# Layer & Canvas State
# ========================================================

LayerType = Literal["background", "subject", "text", "decoration"]
LayerStatus = Literal["draft", "generating", "ready", "failed"]


class Layer(BaseModel):
    """A single layer in the scene graph."""

    id: str
    type: LayerType = "subject"
    z_index: int = 0
    bbox: BoundingBox = Field(default_factory=BoundingBox)
    asset_ref: str = ""  # Reference to Asset Store, not raw image data
    prompt_used: str | None = None
    style_tags: list[str] = Field(default_factory=list)
    status: LayerStatus = "draft"
    metadata: dict[str, Any] = Field(default_factory=dict)


class GlobalStyle(BaseModel):
    """Cross-layer style constraints."""

    primary_color: str | None = None
    light_direction: str | None = None  # e.g. "top-left", "front"
    mood: str | None = None  # e.g. "professional", "warm", "minimal"
    background_type: str | None = None  # e.g. "solid_white", "gradient", "scene"


class CanvasState(BaseModel):
    """Scene graph — the single source of truth for canvas state."""

    canvas_id: str
    size: CanvasSize = Field(default_factory=CanvasSize)
    layers: list[Layer] = Field(default_factory=list)
    global_style: GlobalStyle = Field(default_factory=GlobalStyle)
    version: int = 1
    parent_version: int | None = None

    def get_layer(self, layer_id: str) -> Layer | None:
        for layer in self.layers:
            if layer.id == layer_id:
                return layer
        return None

    def max_z_index(self) -> int:
        if not self.layers:
            return 0
        return max(l.z_index for l in self.layers)


# ========================================================
# Version tree
# ========================================================


class VersionNode(BaseModel):
    """A node in the version tree — each edit produces a new version."""

    version: int
    parent_version: int | None = None
    canvas_state: CanvasState
    created_at: datetime = Field(default_factory=datetime.now)
    description: str = ""


# ========================================================
# Action params & results
# ========================================================


class ActionParams(BaseModel):
    """Base input for all action handlers. Subclass for specific actions."""

    model_config = ConfigDict(extra="allow", arbitrary_types_allowed=True)

    action: str = ""


class GenerateLayerParams(ActionParams):
    """Params for generate_layer action."""

    action: str = "generate_layer"
    layer_type: LayerType = "subject"
    prompt: str = ""
    style_tags: list[str] = Field(default_factory=list)


class InpaintRegionParams(ActionParams):
    """Params for inpaint_region action."""

    action: str = "inpaint_region"
    layer_id: str = ""
    bbox: BoundingBox = Field(default_factory=BoundingBox)
    mask_ref: str | None = None
    prompt: str = ""


class RemoveBackgroundParams(ActionParams):
    """Params for remove_background action."""

    action: str = "remove_background"
    layer_id: str = ""


class ComposeParams(ActionParams):
    """Params for compose action (multi-layer flattening)."""

    action: str = "compose"
    layer_ids: list[str] = Field(default_factory=list)


class UpscaleParams(ActionParams):
    """Params for upscale action."""

    action: str = "upscale"
    layer_id: str = ""
    scale_factor: int = 2


class LayoutSuggestParams(ActionParams):
    """Params for layout_suggest action."""

    action: str = "layout_suggest"
    image_types: list[str] = Field(default_factory=list)


class ActionResult(BaseModel):
    """Unified result from any action handler."""

    success: bool = True
    data: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
    new_canvas_state: CanvasState | None = None


# ========================================================
# Design brief & suggestions
# ========================================================


class DesignBrief(BaseModel):
    """Structured design brief extracted from user input."""

    subject: str = ""  # Product name
    use_case: str = ""  # e.g. "taobao_main_image", "amazon_a+"
    style_hint: str = ""
    platform: str = ""
    target_country: str = ""
    aspect_ratio: str = "1:1"
    image_types: list[str] = Field(default_factory=list)
    selling_points: str = ""
    color_palette: list[str] = Field(default_factory=list)
    reference_image_refs: list[str] = Field(default_factory=list)
    raw_message: str = ""


class DesignSuggestion(BaseModel):
    """Structured design suggestion from VLM image analysis."""

    detected_subject: str = ""
    current_issues: list[str] = Field(default_factory=list)
    suggested_layers: list[str] = Field(default_factory=list)
    suggested_crop: BoundingBox | None = None
    style_notes: dict[str, Any] = Field(default_factory=dict)
    category_template_hint: str | None = None


# ========================================================
# Annotations & region grounding
# ========================================================


class Annotation(BaseModel):
    """User bounding-box annotation on an image."""

    id: str
    canvas_id: str
    source_asset_ref: str  # Always points to original image, never a crop
    bbox: BoundingBox  # Pixel coords in original image resolution
    note: str | None = None
    created_at: datetime = Field(default_factory=datetime.now)


class RegionGroundingPayload(BaseModel):
    """Precise region grounding for edit operations."""

    source_asset_ref: str
    bbox_normalized: BoundingBox  # 0-1 normalized coords
    bbox_pixel: BoundingBox  # Original image pixel coords
    region_caption: str  # Pre-generated text description of the region
    user_note: str | None = None


# ========================================================
# Review
# ========================================================


class ReviewResult(BaseModel):
    """Result from local or global review."""

    passed: bool = False
    overall_score: float = 0.0
    local_score: float | None = None
    global_score: float | None = None
    scores: dict[str, float] = Field(default_factory=dict)
    issues: list[str] = Field(default_factory=list)
    suggestions: list[str] = Field(default_factory=list)


class RetryDecision(BaseModel):
    """Decision output from retry logic."""

    should_retry: bool = False
    reason: str = ""
    diagnostic: dict[str, Any] = Field(default_factory=dict)
    target_layer_id: str | None = None
    adjusted_params: dict[str, Any] = Field(default_factory=dict)


# ========================================================
# Intent classification
# ========================================================


class IntentType(str, Enum):
    NEW_DESIGN = "new_design"
    EDIT_LAYER = "edit_layer"
    UPLOAD_REFERENCE = "upload_reference"
    CLARIFICATION = "clarification"
    CHITCHAT = "chitchat"


class SafetyResult(BaseModel):
    """Result from safety filter check."""

    passed: bool = True
    blocked_reason: str | None = None
    flags: list[str] = Field(default_factory=list)


class EnrichedContext(BaseModel):
    """Context assembled for the decide phase."""

    design_brief: DesignBrief = Field(default_factory=DesignBrief)
    rag_context: str = ""
    brand_context: str = ""
    memory_context: str = ""
    design_suggestions: list[DesignSuggestion] = Field(default_factory=list)


# ========================================================
# SSE events
# ========================================================


class SSEEvent(BaseModel):
    """An event yielded to the frontend via SSE."""

    event: str
    data: dict[str, Any] = Field(default_factory=dict)

    def to_sse_string(self) -> str:
        import json

        payload = {"event": self.event, **self.data}
        return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
