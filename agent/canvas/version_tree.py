"""
Version Tree Manager

Each edit operation produces a new version — never overwrites old versions.
Supports undo (switch to parent) and branching.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from agent.assets.store import AssetStore
from agent.models import CanvasState, VersionNode


class VersionTree:
    """Version tree for canvas state history.

    Persists version nodes via AssetStore (JSON files initially,
    interface designed for future DB migration).
    """

    def __init__(self, storage: AssetStore):
        self._storage = storage
        self._versions: dict[int, VersionNode] = {}
        self._current_version: int | None = None
        self._canvas_id: str | None = None

    # ── Version CRUD ──

    def create_version(
        self,
        canvas: CanvasState,
        description: str = "",
    ) -> CanvasState:
        """Create a new version node from current canvas state.

        The canvas.version field should already be incremented by the
        caller (e.g. CanvasStateManager). This method records the snapshot.
        """
        if self._canvas_id is None:
            self._canvas_id = canvas.canvas_id

        node = VersionNode(
            version=canvas.version,
            parent_version=canvas.parent_version,
            canvas_state=canvas,
            created_at=datetime.now(),
            description=description,
        )

        self._versions[node.version] = node
        self._current_version = node.version

        # Persist
        self._storage.save_json(
            f"versions/{self._canvas_id}/{node.version}.json",
            node.model_dump(mode="json"),
        )

        return canvas

    def get_version(self, version: int) -> CanvasState | None:
        """Get canvas state for a specific version."""
        node = self._versions.get(version)
        if node is not None:
            return node.canvas_state

        # Try loading from storage
        key = f"versions/{self._canvas_id}/{version}.json"
        data = self._storage.load_json(key)
        if data:
            node = VersionNode(**data)
            self._versions[version] = node
            return node.canvas_state
        return None

    def get_current(self) -> CanvasState | None:
        """Get current version's canvas state."""
        if self._current_version is None:
            return None
        return self.get_version(self._current_version)

    def get_history(self) -> list[VersionNode]:
        """Get version chain from root to current, ordered by version."""
        nodes = sorted(self._versions.values(), key=lambda n: n.version)
        return nodes

    def switch_to(self, version: int) -> CanvasState:
        """Switch current pointer to a different version (undo/redo)."""
        canvas = self.get_version(version)
        if canvas is None:
            raise KeyError(f"Version {version} not found")
        self._current_version = version
        return canvas

    def branch_from(self, version: int) -> CanvasState:
        """Create a branch point: get the state at `version` to start a new branch.

        Returns a copy of the canvas state with parent_version set to `version`
        and version reset, ready for the caller to increment and create new versions.
        """
        base = self.get_version(version)
        if base is None:
            raise KeyError(f"Version {version} not found")

        # Return a copy with parent pointing to the branch point
        branched = base.model_copy(update={
            "parent_version": version,
        })
        return branched

    # ── Persistence helpers ──

    def save_index(self) -> None:
        """Save the version index (metadata about all versions)."""
        if not self._canvas_id:
            return
        index = {
            "canvas_id": self._canvas_id,
            "current_version": self._current_version,
            "versions": {
                str(v): {
                    "version": n.version,
                    "parent_version": n.parent_version,
                    "created_at": n.created_at.isoformat(),
                    "description": n.description,
                }
                for v, n in self._versions.items()
            },
        }
        self._storage.save_json(
            f"versions/{self._canvas_id}/_index.json", index
        )

    def load_index(self, canvas_id: str) -> None:
        """Load version index from storage."""
        self._canvas_id = canvas_id
        key = f"versions/{canvas_id}/_index.json"
        data = self._storage.load_json(key)
        if data:
            self._current_version = data.get("current_version")

    @property
    def current_version(self) -> int | None:
        return self._current_version

    @property
    def canvas_id(self) -> str | None:
        return self._canvas_id
