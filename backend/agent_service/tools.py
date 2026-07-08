"""
Agent Service — Tool Definitions

Canvas tools and Agent tools for function calling.
Includes tool execution functions for the ReAct agent loop.
"""

from typing import Dict, List, Any, Optional

# ========================================================
# Canvas Query Tools (for modify intent + ReAct loop)
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
# Agent Tools (for True ReAct Agent Loop — Phase 3)
# ========================================================

AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "generate_image",
            "description": "生成单张电商商品图。需要指定图片类型和英文prompt。",
            "parameters": {
                "type": "object",
                "properties": {
                    "image_type": {
                        "type": "string",
                        "description": "图片类型key，如 main, icon, selling_point, comparison, scene_selling, structure, scene_tag, person_scene",
                        "enum": ["main", "icon", "selling_point", "comparison", "scene_selling", "structure", "scene_tag", "person_scene"],
                    },
                    "prompt": {
                        "type": "string",
                        "description": "英文生图prompt，80-150词",
                    },
                },
                "required": ["image_type", "prompt"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "evaluate_image",
            "description": "评估已生成图片的质量，返回评分和修改建议。",
            "parameters": {
                "type": "object",
                "properties": {
                    "image_type": {
                        "type": "string",
                        "description": "要评估的图片类型key",
                    },
                },
                "required": ["image_type"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_canvas",
            "description": "查询当前画布状态（已有哪些图片、用户框选的修改区域）。在修改已有图片前应调用此函数。",
            "parameters": {
                "type": "object",
                "properties": {},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_knowledge",
            "description": "搜索RAG知识库获取prompt模板和风格指南，用于优化生图prompt。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索查询，描述需要什么类型的知识",
                    },
                    "categories": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "搜索的知识类别，可选: prompt_template, style_guide, platform_rules, copywriting",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_plan",
            "description": "根据评估反馈更新设计方案。当图片评估不通过需要调整设计方向时调用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "changes": {
                        "type": "string",
                        "description": "设计方案的变更描述",
                    },
                },
                "required": ["changes"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "finish_task",
            "description": "所有图片生成完毕，完成任务。当所有需要的图片都达到质量标准后调用此函数。",
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {
                        "type": "string",
                        "description": "任务完成摘要，列出生成的图片类型和最终评分",
                    },
                },
                "required": ["summary"],
            },
        },
    },
]

# ========================================================
# Tool Execution Helpers
# ========================================================

async def execute_canvas_tool(
    tool_name: str,
    current_images: Dict[str, str],
    stitch_regions: List[Dict[str, Any]],
    canvas_snapshot: str,
    mask_data: Any,
) -> Dict[str, Any]:
    """Execute a canvas query tool locally and return the result."""
    if tool_name == "get_canvas_state":
        return {
            "current_images": current_images,
            "canvas_snapshot": canvas_snapshot,
        }
    elif tool_name == "get_stitch_regions":
        return {
            "stitch_regions": stitch_regions,
            "mask_data": mask_data,
        }
    else:
        return {"error": f"Unknown canvas tool: {tool_name}"}
