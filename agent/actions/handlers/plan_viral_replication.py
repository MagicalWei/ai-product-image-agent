"""Open the viral-structure replication workbench through an Agent action."""

from agent.models import ActionParams, ActionResult, CanvasState


async def plan_viral_replication_fn(params: ActionParams, canvas: CanvasState) -> ActionResult:
    extra = params.extra or {}
    strength = str(extra.get("strength") or "medium")
    if strength not in {"light", "medium", "high"}:
        strength = "medium"
    return ActionResult(
        success=True,
        data={
            "action": "plan_viral_replication",
            "viral_replication_plan": {
                "mode": "viral_structure_replication",
                "aspect_ratio": "9:16",
                "strength": strength,
                "max_reference_duration": 60,
                "requires_blueprint_confirmation": True,
            },
            "message": "爆款结构复刻工作台已准备好，请上传参考视频和新商品素材。",
        },
    )
