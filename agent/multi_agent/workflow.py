"""
Multi-Agent — Workflow (DAG)

Defines the multi-agent workflow as a DAG and provides a scheduler
that executes steps respecting their dependencies.
"""

from __future__ import annotations

from typing import Any

# Each step: agent key, list of dependencies (agent keys), whether it's required
# Dependencies mean "must wait for these agents to complete before starting"
WORKFLOW_STEPS: list[dict[str, Any]] = [
    {
        "agent": "requirement_collector",
        "depends_on": [],
        "required": True,
        "description": "从用户输入提取结构化设计需求",
    },
    {
        "agent": "competitor_analyst",
        "depends_on": ["requirement_collector"],
        "required": False,
        "description": "分析同品类商品主图的视觉策略",
    },
    {
        "agent": "prompt_writer",
        "depends_on": ["requirement_collector"],
        "required": True,
        "description": "将需求+竞品洞察+RAG编译为高质量图像prompt",
    },
    {
        "agent": "image_generator",
        "depends_on": ["prompt_writer"],
        "required": True,
        "description": "调用图像生成模型产出候选图",
    },
]


def get_dependency_order(
    enabled_agents: set[str] | None = None,
) -> list[list[str]]:
    """Compute execution order (topological levels) respecting dependencies.

    Returns a list of lists, where each inner list contains agent keys
    that can be executed in parallel at that level.

    Args:
        enabled_agents: If provided, only include these agents.
                       If None, include all agents from WORKFLOW_STEPS.
    """
    if enabled_agents is None:
        enabled_agents = {step["agent"] for step in WORKFLOW_STEPS}

    # Filter to enabled agents
    active_steps = [s for s in WORKFLOW_STEPS if s["agent"] in enabled_agents]

    completed: set[str] = set()
    remaining = set(s["agent"] for s in active_steps)
    levels: list[list[str]] = []

    while remaining:
        level: list[str] = []
        for step in active_steps:
            agent = step["agent"]
            if agent not in remaining:
                continue
            deps = {d for d in step["depends_on"] if d in enabled_agents}
            if deps.issubset(completed):
                level.append(agent)

        if not level:
            # Should not happen for a valid DAG
            break

        levels.append(level)
        for agent in level:
            remaining.discard(agent)
            completed.add(agent)

    return levels


def get_required_agents() -> set[str]:
    """Return the set of required agent keys."""
    return {s["agent"] for s in WORKFLOW_STEPS if s["required"]}


def get_optional_agents() -> set[str]:
    """Return the set of optional agent keys."""
    return {s["agent"] for s in WORKFLOW_STEPS if not s["required"]}
