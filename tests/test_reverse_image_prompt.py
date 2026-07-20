import pytest

from agent.actions.handlers.reverse_image_prompt import _normalize, reverse_image_prompt_fn
from agent.models import ActionParams, CanvasState


def test_reverse_prompt_normalization_is_bounded_and_ratio_safe():
    result = _normalize({
        "subject": "商品主体",
        "recommended_ratio": "2:3",
        "color_palette": ["蓝色"] * 12,
        "prompt_cn": "商业商品摄影",
        "visible_evidence": ["居中构图"],
    })
    assert result["recommended_ratio"] == "1:1"
    assert len(result["color_palette"]) == 8
    assert result["prompt_cn"] == "商业商品摄影"
    assert result["visible_evidence"] == ["居中构图"]


@pytest.mark.asyncio
async def test_reverse_prompt_rejects_non_image_input_before_model_call():
    result = await reverse_image_prompt_fn(
        ActionParams(action="reverse_image_prompt", image_base64="not-an-image"),
        CanvasState(canvas_id="toolbox-test"),
    )
    assert result.success is False
    assert "有效的图片" in result.error
