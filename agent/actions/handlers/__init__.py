"""
Agent actions handlers package

Import all handlers and register them in the global ACTION_REGISTRY.
"""

from agent.actions.handlers.generate_layer import generate_layer_fn
from agent.actions.handlers.inpaint_region import inpaint_region_fn
from agent.actions.handlers.remove_background import remove_background_fn
from agent.actions.handlers.compose import compose_fn
from agent.actions.handlers.upscale import upscale_fn
from agent.actions.handlers.layout_suggest import layout_suggest_fn
from agent.actions.handlers.search_knowledge import search_knowledge_fn
from agent.actions.registry import register_action


def register_all_actions() -> None:
    """Register all built-in action handlers."""
    register_action("generate_layer", generate_layer_fn)
    register_action("inpaint_region", inpaint_region_fn)
    register_action("remove_background", remove_background_fn)
    register_action("compose", compose_fn)
    register_action("upscale", upscale_fn)
    register_action("layout_suggest", layout_suggest_fn)
    register_action("search_knowledge", search_knowledge_fn)


__all__ = [
    "generate_layer_fn",
    "inpaint_region_fn",
    "remove_background_fn",
    "compose_fn",
    "upscale_fn",
    "layout_suggest_fn",
    "search_knowledge_fn",
    "register_all_actions",
]