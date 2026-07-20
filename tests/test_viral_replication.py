import pytest

from agent.actions.handlers.plan_viral_replication import plan_viral_replication_fn
from agent.models import ActionParams, CanvasState
from agent.video_replication import analyze_viral_replication, normalize_replication_blueprint


def test_normalize_replication_blueprint_maps_real_sources_and_marks_missing():
    result = normalize_replication_blueprint(
        {
            "title": "测试复刻",
            "shots": [
                {
                    "reference_start": 0,
                    "reference_end": 2,
                    "target_duration": 2,
                    "purpose": "开场钩子",
                    "product_source_kind": "video",
                    "product_source_index": 0,
                    "product_start": 1,
                    "product_end": 5,
                },
                {
                    "reference_start": 2,
                    "reference_end": 9,
                    "target_duration": 8,
                    "purpose": "细节展示",
                    "product_source_kind": "image",
                    "product_source_index": 3,
                },
            ],
        },
        reference_duration=6,
        product_sources=[{"kind": "video", "duration": 3}, {"kind": "image", "duration": 0}],
    )

    assert result["aspect_ratio"] == "9:16"
    assert result["shots"][0]["product_end"] == 3
    assert result["shots"][1]["reference_end"] == 6
    assert result["shots"][1]["target_duration"] == 6
    assert result["shots"][1]["product_source_kind"] == "missing"
    assert result["mapped_shots"] == 1
    assert result["missing_shots"] == 1


@pytest.mark.asyncio
async def test_plan_viral_replication_requires_confirmation():
    result = await plan_viral_replication_fn(
        ActionParams(action="plan_viral_replication", extra={"strength": "high"}),
        CanvasState(canvas_id="canvas-test", session_id="session-test"),
    )

    assert result.success is True
    plan = result.data["viral_replication_plan"]
    assert plan["mode"] == "viral_structure_replication"
    assert plan["strength"] == "high"
    assert plan["max_reference_duration"] == 60
    assert plan["requires_blueprint_confirmation"] is True


@pytest.mark.asyncio
async def test_analysis_rejects_reference_longer_than_60_seconds_before_model_call():
    with pytest.raises(ValueError, match="60 秒"):
        await analyze_viral_replication(
            reference_frames=[{"timestamp": 0, "image": "data:image/jpeg;base64,abc"}],
            reference_duration=60.1,
            product_sources=[{"kind": "image", "source_index": 0, "frames": []}],
            instruction="",
            strength="medium",
            multimodal_config={"api_key": "unused", "base_url": "unused", "model": "unused"},
        )


def test_blueprint_accepts_shots_after_the_first_15_seconds():
    from agent.video_replication import ReplicationBlueprint

    blueprint = ReplicationBlueprint.model_validate({
        "summary": "一分钟参考视频结构",
        "hook_pattern": "开场展示商品",
        "pacing": "前快后稳",
        "cta_pattern": "结尾行动引导",
        "shots": [{
            "reference_start": 45,
            "reference_end": 55,
            "purpose": "详情展示",
            "motion": "缓慢推进",
            "adapted_copy": "细节清晰",
            "target_duration": 4,
        }],
    })

    assert blueprint.shots[0].reference_end == 55
