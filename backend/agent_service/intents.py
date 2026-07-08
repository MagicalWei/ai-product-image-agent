"""
Agent Service — Fine-grained Intent System (Phase 2)

Replaces the coarse 4-intent classifier with a 9-intent system featuring
sub_intents and target_scope for precise routing decisions.
"""

from typing import Dict, Any, Optional

# ========================================================
# Intent definitions
# ========================================================

# Valid intents and their descriptions
INTENT_DEFINITIONS = {
    "chitchat": {
        "description": "闲聊、问候、询问能力、与商品图设计无关",
        "keeps_state": True,
        "needs_product_info": False,
    },
    "new_design": {
        "description": "开始新设计，提供新产品信息",
        "keeps_state": False,
        "needs_product_info": False,
    },
    "quick_generate": {
        "description": "信息齐全，直接生成（跳过信息收集）",
        "keeps_state": False,
        "needs_product_info": True,
    },
    "modify_image": {
        "description": "修改已有图片（改背景/风格/元素）",
        "keeps_state": False,
        "needs_product_info": True,
    },
    "regenerate": {
        "description": "重新生成（换风格重做）",
        "keeps_state": False,
        "needs_product_info": True,
    },
    "add_image_type": {
        "description": "在已有图片集上增加新图片类型",
        "keeps_state": False,
        "needs_product_info": True,
    },
    "update_brand": {
        "description": "记住品牌偏好（颜色、风格等）",
        "keeps_state": True,
        "needs_product_info": False,
    },
    "continue_collecting": {
        "description": "补充信息（Phase 1未完成）",
        "keeps_state": False,
        "needs_product_info": False,
    },
    "ask_question": {
        "description": "询问能力范围",
        "keeps_state": True,
        "needs_product_info": False,
    },
}

# Sub-intents for modify_image
MODIFY_SUB_INTENTS = [
    "change_background",
    "change_style",
    "add_element",
    "remove_element",
    "adjust_composition",
    "other",
]

# Sub-intents for regenerate
REGENERATE_SUB_INTENTS = [
    "same_style_improve",
    "new_style_retry",
    "higher_quality",
]

# Target scopes
TARGET_SCOPES = ["single_image", "all_images"]


def normalize_intent(raw_intent: str) -> str:
    """Normalize intent from LLM output to a valid intent name.

    Maps legacy intents to new ones for backward compatibility.
    """
    raw = raw_intent.strip().lower()

    # Direct match
    if raw in INTENT_DEFINITIONS:
        return raw

    # Legacy intent mapping
    legacy_map = {
        "generate": "new_design",
        "modify": "modify_image",
        "continue": "continue_collecting",
    }
    if raw in legacy_map:
        return legacy_map[raw]

    # Fuzzy match
    for intent in INTENT_DEFINITIONS:
        if intent in raw or raw in intent:
            return intent

    return "new_design"  # safe default


def parse_intent_result(llm_output: str) -> Dict[str, Any]:
    """Parse structured intent JSON from LLM output.

    Handles both old format (single word) and new format (JSON).
    """
    import json
    from config import clean_json_string

    llm_output = llm_output.strip()

    # Try JSON format first
    try:
        cleaned = clean_json_string(llm_output)
        result = json.loads(cleaned)
        return {
            "intent": normalize_intent(result.get("intent", "new_design")),
            "sub_intent": result.get("sub_intent", ""),
            "target_scope": result.get("target_scope", "all_images"),
            "target_image_types": result.get("target_image_types", []),
            "confidence": result.get("confidence", 0.5),
        }
    except (json.JSONDecodeError, ValueError):
        pass

    # Fall back to legacy single-word format
    return {
        "intent": normalize_intent(llm_output),
        "sub_intent": "",
        "target_scope": "all_images",
        "target_image_types": [],
        "confidence": 0.5,
    }


def get_routing_action(intent_result: Dict[str, Any], memory) -> Dict[str, Any]:
    """Determine the routing action based on intent and current memory state.

    Returns a dict with:
      - action: "chitchat" | "collect_info" | "quick_generate" | "modify" |
                "regenerate" | "add_type" | "update_brand" | "ask_question" |
                "continue_collecting" | "new_design"
      - reset_memory: bool
      - skip_info_collection: bool
      - skip_design_planning: bool
    """
    intent = intent_result.get("intent", "new_design")
    sub_intent = intent_result.get("sub_intent", "")
    target_scope = intent_result.get("target_scope", "all_images")
    target_image_types = intent_result.get("target_image_types", [])

    routing = {
        "action": intent,
        "reset_memory": False,
        "skip_info_collection": False,
        "skip_design_planning": False,
        "target_image_types": target_image_types,
        "target_scope": target_scope,
        "sub_intent": sub_intent,
    }

    if intent == "chitchat":
        routing["action"] = "chitchat"
    elif intent == "new_design":
        routing["action"] = "new_design"
        routing["reset_memory"] = True
    elif intent == "quick_generate":
        routing["action"] = "quick_generate"
        routing["skip_info_collection"] = True
    elif intent == "modify_image":
        routing["action"] = "modify"
    elif intent == "regenerate":
        routing["action"] = "regenerate"
        routing["skip_design_planning"] = memory.design_plan is not None
    elif intent == "add_image_type":
        routing["action"] = "add_type"
        routing["skip_info_collection"] = True
    elif intent == "update_brand":
        routing["action"] = "update_brand"
    elif intent == "continue_collecting":
        routing["action"] = "collect_info"
    elif intent == "ask_question":
        routing["action"] = "ask_question"

    return routing
