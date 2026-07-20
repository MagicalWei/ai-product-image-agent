"""
Agent action handlers package.

All handlers remain importable for implementation work, while only handlers
that perform a real operation are registered in the global ACTION_REGISTRY.
"""

from agent.actions.handlers.generate_layer import generate_layer_fn
from agent.actions.handlers.inpaint_region import inpaint_region_fn
from agent.actions.handlers.remove_background import remove_background_fn
from agent.actions.handlers.compose import compose_fn
from agent.actions.handlers.upscale import upscale_fn
from agent.actions.handlers.layout_suggest import layout_suggest_fn
from agent.actions.handlers.search_knowledge import search_knowledge_fn
from agent.actions.handlers.style_transfer_batch import style_transfer_batch_fn
from agent.actions.handlers.generate_product_set import generate_product_set_fn
from agent.actions.handlers.plan_video_edit import plan_video_edit_fn
from agent.actions.handlers.plan_viral_replication import plan_viral_replication_fn
from agent.actions.handlers.reverse_image_prompt import reverse_image_prompt_fn
from agent.actions.handlers.generate_video_clip import generate_video_clip_fn
from agent.actions.registry import register_action


def register_all_actions() -> None:
    """Register executable built-in action handlers.

    Placeholder handlers must not be advertised to DECIDE: returning a
    successful ActionResult without producing an asset creates false progress
    and can send the Agent into a repeat loop. The frontend-owned background
    removal and region-composition flows remain available through their
    dedicated UI paths until server-side actions are genuinely implemented.
    """
    register_action("generate_layer", generate_layer_fn)
    register_action("layout_suggest", layout_suggest_fn)
    register_action("search_knowledge", search_knowledge_fn)
    register_action("style_transfer_batch", style_transfer_batch_fn)
    register_action("generate_product_set", generate_product_set_fn)
    register_action("plan_video_edit", plan_video_edit_fn)
    register_action("plan_viral_replication", plan_viral_replication_fn)
    register_action("reverse_image_prompt", reverse_image_prompt_fn)


__all__ = [
    "generate_layer_fn",
    "inpaint_region_fn",
    "remove_background_fn",
    "compose_fn",
    "upscale_fn",
    "layout_suggest_fn",
    "search_knowledge_fn",
    "style_transfer_batch_fn",
    "generate_product_set_fn",
    "plan_video_edit_fn",
    "plan_viral_replication_fn",
    "reverse_image_prompt_fn",
    "generate_video_clip_fn",
    "register_all_actions",
]
