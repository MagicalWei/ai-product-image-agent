"""
Asset Store

Simple JSON-file-based asset persistence. Interface is designed to be
replaceable with a database backend (PostgreSQL, S3) in the future.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


class AssetStore:
    """File-based asset store for version trees, canvas snapshots, etc.

    Uses JSON files stored under agent/assets/data/. Each key maps to a
    file path relative to the data root.
    """

    def __init__(self, root_dir: str | None = None):
        if root_dir is None:
            root_dir = os.path.join(os.path.dirname(__file__), "data")
        self._root = Path(root_dir)
        self._root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        """Resolve a key to a file path. Keys can contain slashes for
        directory structure."""
        # Sanitize: prevent path traversal
        safe_key = key.replace("..", "").lstrip("/")
        return self._root / safe_key

    def save_json(self, key: str, data: dict[str, Any]) -> None:
        """Save a JSON-serializable dict to the given key path."""
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2, default=str)

    def load_json(self, key: str) -> dict[str, Any] | None:
        """Load a JSON dict from the given key path. Returns None if not found."""
        path = self._path(key)
        if not path.exists():
            return None
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    def delete(self, key: str) -> bool:
        """Delete a file. Returns True if it existed."""
        path = self._path(key)
        if path.exists():
            path.unlink()
            return True
        return False

    def list_keys(self, prefix: str = "") -> list[str]:
        """List all stored keys under a prefix."""
        base = self._path(prefix)
        if not base.exists():
            return []
        results = []
        for p in base.rglob("*"):
            if p.is_file():
                rel = p.relative_to(self._root).as_posix()
                results.append(rel)
        return results

    def exists(self, key: str) -> bool:
        """Check if a key exists."""
        return self._path(key).exists()
