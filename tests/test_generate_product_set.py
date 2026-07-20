import asyncio

from agent.actions.handlers import generate_product_set as module
from agent.models import ActionResult, CanvasState


def test_product_set_uses_product_reference_and_only_requested_types(monkeypatch):
    calls = []

    async def fake_generate(params, _canvas):
        calls.append(params.model_extra)
        return ActionResult(success=True, data={"url": f"https://example.test/{len(calls)}.png"})

    monkeypatch.setattr(module, "generate_layer_fn", fake_generate)
    result = asyncio.run(module.generate_product_set_fn(
        module.ActionParams(
            action="generate_product_set",
            product_image="data:image/png;base64,PRODUCT",
            image_types=["main", "detail"],
            selling_points="防水，耐磨",
            style_preference="自然户外",
            image_model_key="test",
        ),
        CanvasState(canvas_id="product-set-test"),
    ))

    assert result.success is True
    assert set(result.data["images"]) == {"main", "detail"}
    assert all(call["reference_images"] == ["data:image/png;base64,PRODUCT"] for call in calls)
    assert calls[0]["aspect_ratio"] == "1:1"
    assert calls[1]["aspect_ratio"] == "3:4"
    assert calls[1]["size_doubao"] == "1728x2304"


def test_product_set_rejects_missing_types_instead_of_generating_all(monkeypatch):
    calls = []

    async def fake_generate(params, _canvas):
        calls.append(params.model_extra)
        return ActionResult(success=True, data={"url": "https://example.test/unexpected.png"})

    monkeypatch.setattr(module, "generate_layer_fn", fake_generate)
    result = asyncio.run(module.generate_product_set_fn(
        module.ActionParams(
            action="generate_product_set",
            product_image="data:image/png;base64,PRODUCT",
            image_types=[],
            image_model_key="test",
        ),
        CanvasState(canvas_id="missing-product-set-types-test"),
    ))

    assert result.success is False
    assert result.error == "未选择有效的套图类型"
    assert calls == []


def test_product_set_automatically_plans_visual_direction(monkeypatch):
    calls = []

    async def fake_direction(*_args, **_kwargs):
        return {
            "palette": ["深蓝", "银灰"],
            "lighting": "柔和侧光",
            "layout": "主体居中，信息分区清晰",
        }

    async def fake_generate(params, _canvas):
        calls.append(params.model_extra)
        return ActionResult(success=True, data={"url": "https://example.test/main.png"})

    monkeypatch.setattr(module, "_plan_visual_direction", fake_direction)
    monkeypatch.setattr(module, "generate_layer_fn", fake_generate)
    result = asyncio.run(module.generate_product_set_fn(
        module.ActionParams(
            action="generate_product_set",
            product_image="data:image/png;base64,PRODUCT",
            image_types=["main"],
            selling_points="轻巧",
            style_preference="根据商品图可见证据自动确定",
            multimodal_config={"api_key": "test", "base_url": "https://example.test", "model": "vision"},
        ),
        CanvasState(canvas_id="automatic-product-set-test"),
    ))

    assert result.success is True
    assert result.data["visual_direction"]["palette"] == ["深蓝", "银灰"]
    assert "柔和侧光" in result.data["prompts"]["main"]
    assert len(calls) == 1
