from types import SimpleNamespace
import asyncio

from agent.core.loop import SenseDecideActReviewLoop
from agent.intent.brief_parser import apply_requirement_reply


def test_compact_chinese_reply_fills_style_and_selling_point_type():
    memory = SimpleNamespace(style_preference="", image_types=[])
    apply_requirement_reply("自然场景，卖点图", memory)
    assert memory.style_preference == "自然场景"
    assert memory.image_types == ["selling_point"]


def test_explicit_type_is_merged_without_duplicates():
    memory = SimpleNamespace(style_preference="自然场景", image_types=["selling_point"])
    apply_requirement_reply("就做自然场景卖点图", memory)
    assert memory.style_preference == "自然场景"
    assert memory.image_types == ["selling_point"]


def test_confirmed_product_reply_does_not_clarify_again_and_keeps_image():
    memory = SimpleNamespace(
        product_name="军事士兵人偶模型",
        product_category="玩具/模型",
        selling_points="经典军事题材造型，配备武器配件，服装细节刻画",
        ecom_platform="",
        target_country="",
        aspect_ratio="1:1",
        image_types=[],
        style_preference="",
        color_palette=[],
        brand_name="",
        current_phase="COLLECTING_INFO",
        last_intent="new_design",
        recent_chat=[],
        build_llm_context=lambda: "已确认商品和卖点",
    )
    loop = SenseDecideActReviewLoop.__new__(SenseDecideActReviewLoop)

    brief, _context, clarification_needed = asyncio.run(
        loop._sense("自然场景，卖点图", memory, "encoded-product-image", None)
    )

    assert clarification_needed is False
    assert brief.style_hint == "自然场景"
    assert brief.image_types == ["selling_point"]
    assert brief.reference_image_refs == ["data:image/png;base64,encoded-product-image"]
