"""
Agent Service — Configuration & Utility Functions

Image type configs, canvas tools, aspect ratio mapping, JSON cleaning,
and canvas context building utilities.
"""

import json
import re
from typing import Dict, List, Any

# ========================================================
# Tool call helper
# ========================================================

async def tool_call(tool_name: str, args: dict = None):
    """Emit a tool_call SSE event for the frontend to execute a canvas operation."""
    return {"event": "tool_call", "tool": tool_name, "args": args or {}}

# ========================================================
# Image type definitions with prompt generation templates
# ========================================================

IMAGE_TYPE_CONFIGS = {
    "main": {
        "name": "主图",
        "description": "白底/透明底产品主图",
        "prompt_template": (
            "Create a professional e-commerce main product image for '{product_name}'. "
            "Clean white background, studio lighting, product centered and sharp. "
            "High resolution product photography style. "
            "Selling points: {selling_points}."
        )
    },
    "icon": {
        "name": "图标",
        "description": "方形小图标",
        "prompt_template": (
            "Create a square app icon style image for '{product_name}'. "
            "Minimalist design, clean edges, suitable for e-commerce platform icons. "
            "Square crop composition, bold recognizable silhouette."
        )
    },
    "selling_point": {
        "name": "卖点图",
        "description": "标注核心卖点",
        "prompt_template": (
            "Create an e-commerce infographic-style image highlighting key selling points of '{product_name}'. "
            "Clean layout with visual emphasis on features. "
            "Selling points to highlight: {selling_points}. "
            "Product: {product_name}."
        )
    },
    "comparison": {
        "name": "对比图",
        "description": "before/after 或竞品对比",
        "prompt_template": (
            "Create a split-screen comparison image for '{product_name}'. "
            "Left side: ordinary/before state. Right side: enhanced/after state using the product. "
            "Clear visual contrast showing the improvement. "
            "Key difference: {selling_points}."
        )
    },
    "scene_selling": {
        "name": "场景卖点图",
        "description": "使用场景+卖点叠加",
        "prompt_template": (
            "Create a lifestyle scene image showing '{product_name}' in a natural usage environment. "
            "Overlay key selling points as elegant text callouts on the image. "
            "Selling points: {selling_points}. "
            "Style: {style_preference}. "
            "Warm, inviting atmosphere suitable for e-commerce."
        )
    },
    "structure": {
        "name": "结构图",
        "description": "产品拆解/材质细节",
        "prompt_template": (
            "Create a detailed product structure/exploded view image for '{product_name}'. "
            "Show material details, construction layers, or component breakdown. "
            "Clean technical illustration style with labels. "
            "Key material features: {selling_points}."
        )
    },
    "scene_tag": {
        "name": "场景标签图",
        "description": "场景+促销标签",
        "prompt_template": (
            "Create an e-commerce promotional image for '{product_name}' in a lifestyle scene. "
            "Include space for promotional badge/tag overlay. "
            "Style: {style_preference}. "
            "Clean composition with room for text and pricing elements. "
            "Platform: {ecom_platform}, Target country: {target_country}."
        )
    },
    "person_scene": {
        "name": "人物场景图",
        "description": "模特+产品",
        "prompt_template": (
            "Create a professional model photo showcasing '{product_name}'. "
            "Natural pose, model using or presenting the product in a lifestyle setting. "
            "Style: {style_preference}. "
            "E-commerce fashion/lifestyle photography quality. "
            "Clean, aspirational aesthetic."
        )
    }
}

# ========================================================
# Canvas query tool definitions for function calling
# ========================================================

CANVAS_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_canvas_state",
            "description": "获取当前画布上所有图片的信息（类型、URL、位置）。当你需要了解画布上已有哪些图片、它们的布局位置时调用此函数。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_stitch_regions",
            "description": "获取用户在画布上框选的修改区域。当你需要知道用户选中了哪个区域进行修改时调用此函数。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]

# ========================================================
# Aspect Ratio Mapping
# ========================================================

def map_aspect_ratio_to_size(ratio: str) -> str:
    """Map standard aspect ratios to pixel dimensions for Seedream/ARK. Minimum 3686400 pixels required."""
    ratio = ratio.strip()
    if ratio == "16:9":
        return "2560x1440"
    elif ratio == "9:16":
        return "1440x2560"
    elif ratio == "4:3":
        return "2240x1680"
    elif ratio == "3:2":
        return "2400x1600"
    else:
        return "1920x1920"


def map_ratio_for_openai_image(ratio: str) -> str:
    """Map aspect ratio to DALL-E sizes."""
    ratio = ratio.strip()
    if ratio == "16:9":
        return "1792x1024"
    elif ratio == "9:16":
        return "1024x1792"
    elif ratio == "4:3":
        return "1792x1344"
    elif ratio == "3:2":
        return "1792x1195"
    else:
        return "1024x1024"

# ========================================================
# JSON Utilities
# ========================================================

def clean_json_string(text: str) -> str:
    """Extract json block from markdown wrapper, handling nested braces."""
    code_block = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
    if code_block:
        text = code_block.group(1).strip()
    start = text.find("{")
    if start == -1:
        return text.strip()
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[start:i+1]
    return text.strip()

# ========================================================
# History Extraction
# ========================================================

def _extract_basic_info_from_history(history: List[Dict[str, str]]) -> Dict[str, str]:
    """Try to extract product_name and selling_points from conversation history using regex."""
    product_name = ""
    selling_points = ""

    for msg in history:
        content = msg.get("content", "")
        name_match = re.search(r"(?:产品名称|产品名|产品)[：:]\s*(.+?)(?:\n|$)", content)
        if name_match and not product_name:
            product_name = name_match.group(1).strip()

        sp_match = re.search(r"(?:卖点|核心卖点|selling points?)[：:]\s*(.+?)(?:\n|$)", content, re.IGNORECASE)
        if sp_match and not selling_points:
            selling_points = sp_match.group(1).strip()

    if not product_name:
        for msg in reversed(history):
            if msg.get("role") == "user":
                content = msg.get("content", "")
                m = re.search(r"(?:生成|制作|设计)(.+?)(?:的|图片|商品图)", content)
                if m:
                    product_name = m.group(1).strip()
                    break
                m = re.search(r"(?:产品|商品)(?:是|叫|为|名称)(.+?)(?:[,，。.!！\n]|$)", content)
                if m:
                    product_name = m.group(1).strip()
                    break

    return {
        "product_name": product_name or "product",
        "selling_points": selling_points or "high quality"
    }

# ========================================================
# Canvas Context Builder
# ========================================================

def _build_canvas_context(inputs: Dict[str, Any]) -> str:
    """Build a canvas state context string for the modify route.

    Injects current_images, stitch_regions, mask_data, and canvas_snapshot
    so the LLM knows what's on the canvas and where the user wants changes.
    """
    parts: List[str] = []

    current_images = inputs.get("current_images", {})
    if current_images and isinstance(current_images, dict):
        parts.append("## 当前画布状态\n")
        parts.append("画布上已有的图片：")
        for img_type, url in current_images.items():
            short_url = url[:100] if isinstance(url, str) and len(url) > 100 else url
            img_label = IMAGE_TYPE_CONFIGS.get(img_type, {}).get("name", img_type)
            parts.append(f"  - {img_label} ({img_type}): {short_url}")
        parts.append("")

    stitch_regions = inputs.get("stitch_regions", [])
    if stitch_regions and isinstance(stitch_regions, list) and len(stitch_regions) > 0:
        parts.append("用户框选的修改区域：")
        for r in stitch_regions:
            if isinstance(r, dict):
                label = r.get("label", r.get("name", ""))
                color = r.get("colorName", r.get("color", ""))
                img_id = r.get("imageId", r.get("image_id", ""))
                parts.append(f"  - {label} ({color}框) 位于图片 {img_id}")
        parts.append("")

    mask_data = inputs.get("mask_data")
    if mask_data:
        parts.append("[用户已提供遮罩数据（mask），表示需要在特定区域进行修改]")
        parts.append("")

    canvas_snapshot = inputs.get("canvas_snapshot")
    if canvas_snapshot:
        parts.append("[已提供画布完整快照（canvas_snapshot），包含了当前画布上所有元素的视觉状态]")
        parts.append("")

    tool_results = inputs.get("tool_results", {})
    if tool_results and isinstance(tool_results, dict):
        parts.append("## 画布查询结果")
        for tool_name, tr in tool_results.items():
            if isinstance(tr, dict):
                result = tr.get("result", tr)
                parts.append(f"- {tool_name}: {json.dumps(result, ensure_ascii=False)[:300]}")
        parts.append("")

    if not parts:
        return ""

    return "\n".join(parts)

# ========================================================
# Brand Context Builder
# ========================================================

def _build_brand_context(brand_memory: Dict[str, Any]) -> str:
    """Build brand memory context string for system prompt."""
    if not brand_memory:
        return ""

    brand_parts = []
    if brand_memory.get("brand_name"):
        brand_parts.append(f"- 品牌名称: {brand_memory['brand_name']}")
    if brand_memory.get("style"):
        brand_parts.append(f"- 品牌风格: {brand_memory['style']}")
    if brand_memory.get("color_palette"):
        brand_parts.append(f"- 品牌色调: {', '.join(brand_memory['color_palette'])}")
    if brand_memory.get("typography"):
        brand_parts.append(f"- 品牌字体偏好: {brand_memory['typography']}")
    if brand_memory.get("product_name"):
        brand_parts.append(f"- 常用产品名称: {brand_memory['product_name']}")
    if brand_memory.get("product_category"):
        brand_parts.append(f"- 产品类别: {brand_memory['product_category']}")
    if brand_memory.get("selling_points"):
        brand_parts.append(f"- 品牌核心卖点: {', '.join(brand_memory['selling_points'])}")

    if not brand_parts:
        return ""

    return (
        "\n\n## 品牌记忆（Brand Memory）\n"
        "以下是用户此前保存的品牌信息，请在生成图片时优先使用这些信息：\n"
        + "\n".join(brand_parts) + "\n"
        "如果当前对话中用户提到的新信息与品牌记忆冲突，以用户最新输入为准。\n"
    )
