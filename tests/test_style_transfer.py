import asyncio

from agent.actions.handlers import style_transfer_batch as module
from agent.models import ActionResult, CanvasState


def test_style_transfer_keeps_product_first_and_creates_three_distinct_outputs(monkeypatch):
    calls = []

    async def fake_analysis(_image, _config):
        return {"dominant_colors": ["navy", "gold"], "lighting": "soft rim light"}

    async def fake_generate(params, _canvas):
        calls.append(params.model_extra)
        image_type = ["main", "selling_point", "detail"][len(calls) - 1]
        return ActionResult(success=True, data={"url": f"https://example.test/{image_type}.png"})

    monkeypatch.setattr(module, "_analyze_style", fake_analysis)
    monkeypatch.setattr(module, "generate_layer_fn", fake_generate)
    result = asyncio.run(module.style_transfer_batch_fn(
        module.ActionParams(
            action="style_transfer_batch",
            product_image="data:image/png;base64,PRODUCT",
            style_reference_images=["data:image/png;base64,STYLE"],
            product_name="新产品",
            selling_points="耐用，轻巧",
            image_model_key="test",
            multimodal_config={"api_key": "test"},
        ),
        CanvasState(canvas_id="style-transfer-test"),
    ))

    assert result.success is True
    assert set(result.data["images"]) == {"main", "selling_point", "detail"}
    assert all(call["reference_images"] == [
        "data:image/png;base64,PRODUCT",
        "data:image/png;base64,STYLE",
    ] for call in calls)
    assert "authoritative NEW PRODUCT" in calls[0]["prompt"]
    assert calls[2]["aspect_ratio"] == "3:4"
