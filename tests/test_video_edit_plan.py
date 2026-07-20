import pytest

from agent.actions.handlers.plan_video_edit import plan_video_edit_fn
from agent.models import ActionParams, CanvasState


@pytest.mark.asyncio
async def test_video_edit_plan_is_structured_and_bounded():
    result = await plan_video_edit_fn(
        ActionParams(
            action="plan_video_edit",
            aspect_ratio="9:16",
            clips=[{"source_index": 0, "start": 1, "end": 4}],
            overlay_text="限时新品",
            font_size=200,
        ),
        CanvasState(canvas_id="video-test"),
    )
    assert result.success is True
    plan = result.data["video_edit_plan"]
    assert plan["aspect_ratio"] == "9:16"
    assert plan["clips"][0] == {"source_index": 0, "start": 1.0, "end": 4.0}
    assert plan["text_overlay"]["font_size"] == 96


@pytest.mark.asyncio
async def test_video_edit_plan_rejects_reverse_ranges():
    result = await plan_video_edit_fn(
        ActionParams(action="plan_video_edit", clips=[{"start": 5, "end": 2}]),
        CanvasState(canvas_id="video-test"),
    )
    assert result.success is False
    assert "结束时间" in result.error
