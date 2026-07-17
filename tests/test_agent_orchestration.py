from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.actions.registry import ACTION_REGISTRY
from agent.canvas.state import CanvasStateManager
from agent.core.loop import SenseDecideActReviewLoop
from agent.models import ActionResult, CanvasState, DesignBrief, EnrichedContext, ReviewResult
from backend.agent_service.memory import AgentMemory


@pytest.mark.asyncio
async def test_creation_request_is_planned_decided_acted_and_reviewed(monkeypatch):
    async def fake_product_set(params, _canvas):
        assert params.model_extra["selling_points"] == "便宜好用"
        assert params.model_extra["product_image"] == "data:image/png;base64,PRODUCT"
        return ActionResult(success=True, data={
            "images": {"detail": "https://example.test/detail.jpg"},
            "prompts": {"detail": "agent-selected detail prompt"},
        })

    monkeypatch.setitem(ACTION_REGISTRY, "generate_product_set", fake_product_set)
    canvas_manager = CanvasStateManager()
    version_tree = MagicMock()
    loop = SenseDecideActReviewLoop(
        action_registry=ACTION_REGISTRY,
        canvas_manager=canvas_manager,
        version_tree=version_tree,
        chat_config={"api_key": "test"},
        vision_config={},
        image_config={"api_key": "image-test"},
        multimodal_config={"api_key": "vision-test"},
    )
    assert loop._review_config["api_key"] == "vision-test"
    memory = AgentMemory(
        product_name="绿色军人小玩具",
        selling_points="便宜好用",
        style_preference="自然场景",
        aspect_ratio="3:4",
        image_types=["detail"],
    )
    brief = DesignBrief(
        subject=memory.product_name,
        selling_points=memory.selling_points,
        style_hint=memory.style_preference,
        aspect_ratio=memory.aspect_ratio,
        image_types=memory.image_types,
        raw_message="再生成一些，卖点是便宜好用",
    )
    loop._sense = AsyncMock(return_value=(brief, EnrichedContext(design_brief=brief), False))
    loop._decide = AsyncMock(return_value={
        "plan": {
            "goal": "继续生成详情页",
            "steps": ["调用商品套图能力", "审查结果"],
            "completion_criteria": ["详情图生成并通过审查"],
        },
        "action": "generate_product_set",
        "params": {"image_types": ["detail"], "selling_points": "便宜好用"},
        "reasoning": "沿用商品身份和风格生成新详情图",
    })
    loop._review = AsyncMock(return_value=ReviewResult(
        passed=True,
        overall_score=90,
        local_score=90,
    ))

    events = [event async for event in loop.run(
        message="再生成一些，卖点是便宜好用",
        memory=memory,
        product_image_base64="data:image/png;base64,PRODUCT",
        canvas_id="agent-orchestration-test",
    )]

    assert loop._decide.await_count == 1
    assert loop._review.await_count == 1
    assert any(event["event"] == "design_plan" for event in events)
    assert any(
        event["event"] == "agent_tool_start" and event["tool"] == "generate_product_set"
        for event in events
    )
    assert any(
        event["event"] == "image_done"
        and event["all_images"] == {"detail": "https://example.test/detail.jpg"}
        for event in events
    )
    assert memory.design_plan["goal"] == "继续生成详情页"


def test_multimodal_endpoint_is_added_to_chat_fallback_chain():
    loop = SenseDecideActReviewLoop(
        action_registry=ACTION_REGISTRY,
        canvas_manager=CanvasStateManager(),
        version_tree=MagicMock(),
        chat_config={"api_key": "chat"},
        vision_config={},
        image_config={"api_key": "image-test"},
        multimodal_config={
            "api_key": "vlm-key",
            "base_url": "https://vlm.test/v1",
            "model": "vlm-model",
        },
    )

    chain = loop._chat_fallback_chain([
        {"protocol": "openai", "api_key": "", "base_url": "https://empty.test", "model": "empty"},
    ])

    assert len(chain) == 1
    assert chain[0]["base_url"] == "https://vlm.test/v1"
    assert chain[0]["model"] == "vlm-model"


@pytest.mark.asyncio
async def test_agent_repairs_missing_action_parameters_instead_of_failing_stream(monkeypatch):
    async def validating_product_set(params, _canvas):
        image_types = params.model_extra.get("image_types") or []
        if not image_types:
            return ActionResult(success=False, error="未选择有效的套图类型")
        return ActionResult(success=True, data={
            "images": {"detail": "https://example.test/repaired-detail.jpg"},
            "prompts": {"detail": "repaired prompt"},
        })

    monkeypatch.setitem(ACTION_REGISTRY, "generate_product_set", validating_product_set)
    loop = SenseDecideActReviewLoop(
        action_registry=ACTION_REGISTRY,
        canvas_manager=CanvasStateManager(),
        version_tree=MagicMock(),
        chat_config={"api_key": "test"},
        vision_config={},
        image_config={"api_key": "image-test"},
        multimodal_config={"api_key": "vision-test"},
    )
    memory = AgentMemory(product_name="玩具", selling_points="便宜好用")
    brief = DesignBrief(
        subject="玩具",
        selling_points="便宜好用",
        image_types=[],
        raw_message="生成商品套图",
    )
    loop._sense = AsyncMock(return_value=(brief, EnrichedContext(design_brief=brief), False))
    loop._decide = AsyncMock(side_effect=[
        {
            "plan": {"goal": "生成详情图", "steps": ["生成"], "completion_criteria": ["有详情图"]},
            "action": "generate_product_set",
            "params": {},
            "reasoning": "首次参数遗漏",
        },
        {
            "action": "generate_product_set",
            "params": {"image_types": ["detail"]},
            "reasoning": "根据 Action 反馈补齐图片类型",
        },
    ])
    loop._review = AsyncMock(return_value=ReviewResult(
        passed=True,
        overall_score=90,
        local_score=90,
    ))

    events = [event async for event in loop.run(
        message="生成商品套图",
        memory=memory,
        product_image_base64="data:image/png;base64,PRODUCT",
        canvas_id="agent-repair-test",
    )]

    assert loop._decide.await_count == 2
    assert any(event["event"] == "action_failed" for event in events)
    assert not any(event["event"] == "error" for event in events)
    assert any(
        event["event"] == "image_done"
        and event["all_images"] == {"detail": "https://example.test/repaired-detail.jpg"}
        for event in events
    )


@pytest.mark.asyncio
async def test_decide_hides_unavailable_style_transfer_and_skips_redundant_image_input():
    loop = SenseDecideActReviewLoop(
        action_registry=ACTION_REGISTRY,
        canvas_manager=CanvasStateManager(),
        version_tree=MagicMock(),
        chat_config={"api_key": "test"},
        vision_config={},
        image_config={"api_key": "image-test"},
        multimodal_config={"api_key": "vision-test"},
    )

    async def fake_decide_call(system_prompt, _context, product_image_base64="", memory=None):
        assert "**style_transfer_batch**" not in system_prompt
        assert product_image_base64 == ""
        assert memory is not None
        return {"action": "generate_product_set", "params": {"image_types": ["detail"]}}

    loop._call_decide_llm = fake_decide_call
    memory = AgentMemory(product_name="士兵人偶", image_types=["detail"])
    brief = DesignBrief(subject="士兵人偶", image_types=["detail"], raw_message="生成一张详情图")
    decision = await loop._decide(
        design_brief=brief,
        enriched_ctx=EnrichedContext(design_brief=brief),
        canvas=CanvasState(canvas_id="tool-capability-test"),
        memory=memory,
        generated_images={},
        retry_counts={},
        last_action="",
        iteration=1,
        product_image_base64="data:image/png;base64,LARGE_PRODUCT_IMAGE",
        has_product_image=True,
        request_hints={"has_style_reference": False, "has_product_image": True},
    )

    assert decision["action"] == "generate_product_set"


@pytest.mark.asyncio
async def test_untyped_reference_attachment_reaches_agent_selected_style_transfer(monkeypatch):
    async def fake_style_transfer(params, _canvas):
        assert params.model_extra["product_image"] == "PRODUCT"
        assert params.model_extra["style_reference_images"] == ["REFERENCE"]
        assert params.model_extra["image_types"] == ["main", "selling_point"]
        return ActionResult(success=True, data={
            "images": {
                "main": "https://example.test/main.jpg",
                "selling_point": "https://example.test/selling.jpg",
            },
            "prompts": {"main": "main prompt", "selling_point": "selling prompt"},
        })

    monkeypatch.setitem(ACTION_REGISTRY, "style_transfer_batch", fake_style_transfer)
    loop = SenseDecideActReviewLoop(
        action_registry=ACTION_REGISTRY,
        canvas_manager=CanvasStateManager(),
        version_tree=MagicMock(),
        chat_config={"api_key": "test"},
        vision_config={},
        image_config={"api_key": "image-test"},
        multimodal_config={"api_key": "vision-test"},
    )
    memory = AgentMemory(product_name="士兵人偶", image_types=["main", "selling_point"])
    brief = DesignBrief(
        subject="士兵人偶",
        image_types=["main", "selling_point"],
        raw_message="根据这个风格做一个主图和卖点图",
    )
    loop._sense = AsyncMock(return_value=(brief, EnrichedContext(design_brief=brief), False))
    loop._decide = AsyncMock(return_value={
        "plan": {"goal": "迁移参考风格", "steps": ["生成"], "completion_criteria": ["两张图"]},
        "action": "style_transfer_batch",
        "params": {"image_types": ["main", "selling_point"]},
        "reasoning": "用户明确要求沿用所附图片的风格",
    })
    loop._review = AsyncMock(return_value=ReviewResult(
        passed=True,
        overall_score=90,
        local_score=90,
    ))

    events = [event async for event in loop.run(
        message="根据这个风格做一个主图和卖点图",
        memory=memory,
        product_image_base64="PRODUCT",
        reference_images=["REFERENCE"],
        canvas_id="untyped-style-reference-test",
    )]

    assert any(
        event["event"] == "agent_tool_start" and event["tool"] == "style_transfer_batch"
        for event in events
    )
    assert any(
        event["event"] == "reference_received" and event["total_count"] == 1
        for event in events
    )
    assert any(
        event["event"] == "image_done"
        and set(event["all_images"]) == {"main", "selling_point"}
        for event in events
    )


@pytest.mark.asyncio
async def test_clarification_memory_keeps_exact_question_for_short_confirmation():
    loop = SenseDecideActReviewLoop(
        action_registry=ACTION_REGISTRY,
        canvas_manager=CanvasStateManager(),
        version_tree=MagicMock(),
        chat_config={"api_key": "test"},
        vision_config={},
        image_config={"api_key": "image-test"},
        multimodal_config={"api_key": "vision-test"},
    )
    memory = AgentMemory(product_name="手机", image_types=["main"])
    brief = DesignBrief(subject="手机", image_types=["main"], raw_message="做主图")
    question = "是否还需要同步生成卖点图？"
    context = EnrichedContext(
        design_brief=brief,
        clarification_questions=[question],
    )
    loop._sense = AsyncMock(return_value=(brief, context, True))

    events = [event async for event in loop.run(
        message="做主图",
        memory=memory,
        product_image_base64="PRODUCT",
        canvas_id="clarification-memory-test",
    )]

    assert any(question in event.get("text", "") for event in events)
    assert question in memory.recent_chat[-1]["content"]


@pytest.mark.asyncio
async def test_region_attachment_reaches_generation_action_without_reasking(monkeypatch):
    async def fake_generate_layer(params, _canvas):
        assert params.model_extra["reference_images"] == ["REGION"]
        assert "只修改矩形框内" in params.prompt
        assert "移除彩色矩形框" in params.prompt
        return ActionResult(success=True, data={
            "url": "https://example.test/edited.jpg",
            "layer_type": "subject",
            "prompt": params.prompt,
        })

    monkeypatch.setitem(ACTION_REGISTRY, "generate_layer", fake_generate_layer)
    loop = SenseDecideActReviewLoop(
        action_registry=ACTION_REGISTRY,
        canvas_manager=CanvasStateManager(),
        version_tree=MagicMock(),
        chat_config={"api_key": "test"},
        vision_config={},
        image_config={"api_key": "image-test"},
        multimodal_config={"api_key": "vision-test"},
    )
    memory = AgentMemory(product_name="手机")
    brief = DesignBrief(subject="手机", raw_message="把框选的字体修改一下")
    loop._sense = AsyncMock()
    loop._call_decide_llm = AsyncMock()
    loop._review = AsyncMock(return_value=ReviewResult(passed=True, overall_score=90, local_score=90))

    events = [event async for event in loop.run(
        message="[[DIRECT_IMAGE_AGENT_REGION]]\n把框选的字体修改一下",
        memory=memory,
        product_image_base64="PRODUCT",
        reference_images=["REGION"],
        canvas_id="region-routing-test",
    )]

    assert any(event.get("tool") == "generate_layer" for event in events)
    assert not any("确认" in event.get("text", "") for event in events)
    assert loop._sense.await_count == 0
    assert loop._call_decide_llm.await_count == 0
    assert any(event.get("event") == "image_done" for event in events)


@pytest.mark.asyncio
async def test_agent_acknowledges_received_region_attachment_without_model_call():
    loop = SenseDecideActReviewLoop(
        action_registry=ACTION_REGISTRY,
        canvas_manager=CanvasStateManager(),
        version_tree=MagicMock(),
        chat_config={"api_key": "test"},
        vision_config={},
        image_config={"api_key": "image-test"},
        multimodal_config={"api_key": "vision-test"},
    )
    loop._sense = AsyncMock()
    loop._decide = AsyncMock()
    memory = AgentMemory(product_name="手机")

    events = [event async for event in loop.run(
        message="[[DIRECT_IMAGE_AGENT_REGION]]\n看到我发你的图片了吗",
        memory=memory,
        product_image_base64="PRODUCT",
        reference_images=["REGION_A", "REGION_B"],
        canvas_id="region-receipt-test",
    )]

    assert loop._sense.await_count == 0
    assert loop._decide.await_count == 0
    assert any("已收到 2 张框选图" in event.get("text", "") for event in events)
