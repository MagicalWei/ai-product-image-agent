"""
Action Registry

Central registry for all agent actions. Actions are registered by name
and called via uniform handler signature:
    async def handler(params: ActionParams, canvas: CanvasState) -> ActionResult

The decide phase only selects from registered actions.
"""

from __future__ import annotations

from typing import Protocol

from agent.models import ActionParams, ActionResult, CanvasState


class ActionHandler(Protocol):
    """Protocol for action handler functions."""

    async def __call__(
        self,
        params: ActionParams,
        canvas: CanvasState,
    ) -> ActionResult: ...


# Global action registry
ACTION_REGISTRY: dict[str, ActionHandler] = {}


def register_action(name: str, handler: ActionHandler) -> None:
    """Register an action handler in the global registry."""
    ACTION_REGISTRY[name] = handler


def get_action(name: str) -> ActionHandler:
    """Get a registered action handler. Raises KeyError if not found."""
    if name not in ACTION_REGISTRY:
        raise KeyError(
            f"Action '{name}' not found in registry. "
            f"Available: {list(ACTION_REGISTRY.keys())}"
        )
    return ACTION_REGISTRY[name]


def list_actions() -> list[str]:
    """List all registered action names."""
    return list(ACTION_REGISTRY.keys())


def is_registered(name: str) -> bool:
    """Check if an action name is registered."""
    return name in ACTION_REGISTRY
