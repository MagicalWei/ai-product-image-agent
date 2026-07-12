"""
Agent Service — Tool Definitions

Agent tools for function calling in the unified agent loop.
"""

from typing import Dict, List, Any

# ========================================================
# Agent Tools (for Unified Agent Loop)
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