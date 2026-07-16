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
