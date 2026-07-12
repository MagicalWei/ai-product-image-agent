"""
Canvas State Manager

Manages the current canvas state (scene graph). Single source of truth
for all image operations. Every image operation must read canvas state
before acting and update it after.
"""

from __future__ import annotations

import uuid
from typing import Any

from agent.models import (
    BoundingBox,
    CanvasSize,
    CanvasState,
    GlobalStyle,
    Layer,
    LayerStatus,
    LayerType,
)


class CanvasStateManager:
    """Manages current canvas state (scene graph).

    Usage: create one instance per request/agent run. Not a singleton
    across requests — each agent session owns its canvas.
    """

    def __init__(self) -> None:
        self._states: dict[str, CanvasState] = {}

    # ── Canvas CRUD ──

    def create_canvas(
        self,
        canvas_id: str | None = None,
        size: CanvasSize | None = None,
        global_style: GlobalStyle | None = None,
    ) -> CanvasState:
        """Create a new empty canvas."""
        cid = canvas_id or uuid.uuid4().hex[:12]
        state = CanvasState(
            canvas_id=cid,
            size=size or CanvasSize(),
            global_style=global_style or GlobalStyle(),
        )
        self._states[cid] = state
        return state

    def get_state(self, canvas_id: str) -> CanvasState | None:
        """Get current canvas state by id."""
        return self._states.get(canvas_id)

    def get_or_create(self, canvas_id: str) -> CanvasState:
        """Get existing canvas or create a new one."""
        state = self._states.get(canvas_id)
        if state is None:
            state = self.create_canvas(canvas_id)
        return state

    def set_state(self, state: CanvasState) -> None:
        """Replace the stored canvas state (e.g. after version switch)."""
        self._states[state.canvas_id] = state

    # ── Layer CRUD ──

    def create_layer(
        self,
        canvas_id: str,
        layer_type: LayerType = "subject",
        z_index: int | None = None,
        bbox: BoundingBox | None = None,
        asset_ref: str = "",
        prompt_used: str | None = None,
        style_tags: list[str] | None = None,
        status: LayerStatus = "draft",
    ) -> CanvasState:
        """Add a new layer to the canvas. Returns updated CanvasState."""
        canvas = self.get_or_create(canvas_id)

        if z_index is None:
            z_index = canvas.max_z_index() + 1

        layer = Layer(
            id=uuid.uuid4().hex[:8],
            type=layer_type,
            z_index=z_index,
            bbox=bbox or BoundingBox(
                x=0, y=0, width=canvas.size.width, height=canvas.size.height
            ),
            asset_ref=asset_ref,
            prompt_used=prompt_used,
            style_tags=style_tags or [],
            status=status,
        )

        new_layers = list(canvas.layers) + [layer]
        new_state = canvas.model_copy(
            update={"layers": new_layers, "version": canvas.version + 1}
        )
        self._states[canvas_id] = new_state
        return new_state

    def update_layer(
        self, canvas_id: str, layer_id: str, updates: dict[str, Any]
    ) -> CanvasState:
        """Update fields on an existing layer. Returns updated CanvasState."""
        canvas = self.get_or_create(canvas_id)
        new_layers = []
        found = False
        for layer in canvas.layers:
            if layer.id == layer_id:
                updated = layer.model_copy(update=updates)
                new_layers.append(updated)
                found = True
            else:
                new_layers.append(layer)

        if not found:
            raise KeyError(f"Layer '{layer_id}' not found in canvas '{canvas_id}'")

        new_state = canvas.model_copy(
            update={"layers": new_layers, "version": canvas.version + 1}
        )
        self._states[canvas_id] = new_state
        return new_state

    def remove_layer(self, canvas_id: str, layer_id: str) -> CanvasState:
        """Remove a layer from the canvas. Returns updated CanvasState."""
        canvas = self.get_or_create(canvas_id)
        new_layers = [l for l in canvas.layers if l.id != layer_id]
        if len(new_layers) == len(canvas.layers):
            raise KeyError(f"Layer '{layer_id}' not found in canvas '{canvas_id}'")

        new_state = canvas.model_copy(
            update={"layers": new_layers, "version": canvas.version + 1}
        )
        self._states[canvas_id] = new_state
        return new_state

    def reorder_layers(
        self, canvas_id: str, z_index_map: dict[str, int]
    ) -> CanvasState:
        """Reorder layers by setting new z-indices. Returns updated CanvasState."""
        canvas = self.get_or_create(canvas_id)
        new_layers = []
        for layer in canvas.layers:
            if layer.id in z_index_map:
                new_layers.append(layer.model_copy(update={"z_index": z_index_map[layer.id]}))
            else:
                new_layers.append(layer)

        new_state = canvas.model_copy(
            update={"layers": new_layers, "version": canvas.version + 1}
        )
        self._states[canvas_id] = new_state
        return new_state

    def get_layer(self, canvas_id: str, layer_id: str) -> Layer | None:
        """Get a single layer by id."""
        canvas = self._states.get(canvas_id)
        if canvas is None:
            return None
        return canvas.get_layer(layer_id)

    # ── Serialization ──

    def to_dict(self, canvas_id: str) -> dict[str, Any]:
        """Serialize canvas state for frontend consumption."""
        canvas = self.get_state(canvas_id)
        if canvas is None:
            return {}
        return canvas.model_dump(mode="json")

    def load_from_dict(self, data: dict[str, Any]) -> CanvasState:
        """Restore canvas state from serialized dict."""
        state = CanvasState(**data)
        self._states[state.canvas_id] = state
        return state

    # ── Persistence (JSON file via AssetStore-compatible interface) ──

    def save_to_asset_store(self, canvas_id: str, asset_store: Any) -> None:
        """Persist canvas state to an AssetStore-compatible backend.

        The asset_store must have a save_json(key, data) method.
        Canvas state is saved under canvas/{canvas_id}.json.
        """
        canvas = self.get_state(canvas_id)
        if canvas is None:
            return
        key = f"canvas/{canvas_id}.json"
        data = canvas.model_dump(mode="json")
        asset_store.save_json(key, data)

    def load_from_asset_store(self, canvas_id: str, asset_store: Any) -> CanvasState | None:
        """Load canvas state from an AssetStore-compatible backend.

        Returns None if no persisted state exists for this canvas_id.
        """
        key = f"canvas/{canvas_id}.json"
        data = asset_store.load_json(key)
        if data is None:
            return None
        return self.load_from_dict(data)