"""Stable identity helpers for persisted Agent canvas state."""

from __future__ import annotations

import hashlib


def build_agent_canvas_id(session_id: str = "", product_name: str = "") -> str | None:
    """Build an isolated canvas key, preferring the conversation session ID."""
    stable_source = (session_id or "").strip()
    if stable_source:
        return f"canvas_session_{stable_source}"
    legacy_source = (product_name or "").strip()
    if not legacy_source:
        return None
    digest = hashlib.sha256(legacy_source.encode("utf-8")).hexdigest()[:20]
    return f"canvas_legacy_{digest}"
