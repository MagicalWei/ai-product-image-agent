"""
Agent Service — Configuration & Utility Functions

Image type configs, aspect ratio mapping, JSON cleaning,
and brand context building utilities.
"""

import json
import re
from typing import Dict, List, Any

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
