"""Build a validated, provider-neutral video edit plan for the FFmpeg worker."""

from __future__ import annotations

from agent.models import ActionParams, ActionResult, CanvasState

RATIOS = {"16:9", "9:16", "1:1", "4:5"}


async def plan_video_edit_fn(params: ActionParams, canvas: CanvasState) -> ActionResult:
    extra = params.model_extra or {}
    aspect_ratio = str(extra.get("aspect_ratio") or "9:16")
    if aspect_ratio not in RATIOS:
        aspect_ratio = "9:16"

    raw_clips = extra.get("clips") if isinstance(extra.get("clips"), list) else []
    clips = []
    for index, raw in enumerate(raw_clips[:12]):
        raw = raw if isinstance(raw, dict) else {}
        start = max(0.0, float(raw.get("start") or 0))
        end_value = raw.get("end")
        end = max(0.0, float(end_value)) if end_value not in (None, "") else None
        if end is not None and end <= start:
            return ActionResult(success=False, error=f"第 {index + 1} 个片段的结束时间必须晚于开始时间")
        clips.append({"source_index": int(raw.get("source_index") or index), "start": start, "end": end})

    text = str(extra.get("overlay_text") or "").strip()[:120]
    plan = {
        "aspect_ratio": aspect_ratio,
        "clips": clips,
        "text_overlay": {
            "text": text,
            "position": str(extra.get("text_position") or "bottom"),
            "font_size": min(96, max(18, int(extra.get("font_size") or 42))),
            "color": str(extra.get("font_color") or "FFFFFF").lstrip("#")[:6],
        } if text else None,
        "original_volume": min(2.0, max(0.0, float(extra.get("original_volume", 1)))),
        "music_volume": min(2.0, max(0.0, float(extra.get("music_volume", 0.25)))),
        "fade": bool(extra.get("fade", True)),
        "fps": int(extra.get("fps") or 30),
    }
    return ActionResult(
        success=True,
        data={
            "action": "plan_video_edit",
            "video_edit_plan": plan,
            "requires_video_upload": True,
            "message": "剪辑方案已准备好，请在视频剪辑器中选择源视频后执行。",
        },
    )
