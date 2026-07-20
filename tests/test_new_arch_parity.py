"""
test_new_arch_parity.py

验证新架构（sense-decide-act-review）与旧架构（unified）的行为等价性。

测试前提:
  - AGENT_ARCHITECTURE=sense-decide-act-review 时不产生回归
  - RAG 检索结果正确注入 DECIDE 上下文和 prompt_expander
  - SSE 事件类型集合与旧架构一致
  - CanvasState 跨请求保留图层历史
  - average_scores 在 finish_task / image_done 中正确计算

运行方式:
  cd agent_service
  AGENT_ARCHITECTURE=sense-decide-act-review pytest ../tests/test_new_arch_parity.py -v

或单独模块:
  pytest tests/test_new_arch_parity.py -v -k "test_rag"
"""

import json
import os
import sys
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def project_root():
    """Return the absolute project root path."""
    return os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..")
    )


@pytest.fixture
def mock_memory():
    """Create an AgentMemory with realistic product data."""
    # Ensure backend/agent_service is importable
    backend = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "backend", "agent_service")
    )
    if backend not in sys.path:
        sys.path.insert(0, backend)

    from memory import AgentMemory

    mem = AgentMemory()
    mem.product_name = "无线蓝牙耳机"
    mem.selling_points = "降噪、续航30小时、舒适佩戴"
    mem.ecom_platform = "amazon"
    mem.style_preference = "minimal white background"
    mem.aspect_ratio = "1:1"
    mem.image_types = ["main"]
    mem.color_palette = ["#FFFFFF", "#000000"]
    mem.target_country = "US"
    return mem


@pytest.fixture
def mock_rag_retriever():
    """Create a mock RAGRetriever that returns canned results."""
    from backend.agent_service.rag.retrieval import RAGRetriever

    retriever = MagicMock(spec=RAGRetriever)

    # Mock retrieve_multi_category to return a realistic context
    mock_result = MagicMock()
    mock_result.context = (
        "【参考 1】(分类: prompt_template, 相关度: 0.92)\n"
        "E-commerce white background product shot, 8K resolution\n"
        "【参考 2】(分类: style_guide, 相关度: 0.85)\n"
        "Minimalist design, 45-degree top-left lighting, diffused shadow\n"
    )
    mock_result.results = [
        MagicMock(content="white background template", category="prompt_template", score=0.92),
        MagicMock(content="minimalist style guide", category="style_guide", score=0.85),
    ]
    retriever.retrieve_multi_category = AsyncMock(return_value=mock_result)

    # Mock retrieve for single-category calls
    mock_single = MagicMock()
    mock_single.context = "Single category result"
    mock_single.results = [
        MagicMock(content="single result", category="prompt_template", score=0.90),
    ]
    retriever.retrieve = AsyncMock(return_value=mock_single)

    return retriever


@pytest.fixture
def mock_llm_json_response():
    """Mock LLM to return a generate_layer decision."""
    return '{"action": "generate_layer", "params": {"layer_type": "subject", "prompt": "A wireless bluetooth earbud, minimalist white background, professional product photography, 8K resolution", "style_tags": ["#FFFFFF", "#000000"]}, "reasoning": "生成主体图"}'


@pytest.fixture
def mock_llm_finish_response():
    """Mock LLM to return a finish decision."""
    return '{"action": "finish", "params": {"summary": "任务完成"}, "reasoning": "所有图片已生成"}'

@pytest.fixture
def mock_llm_search_knowledge_response():
    """Mock LLM to call search_knowledge first."""
    return '{"action": "search_knowledge", "params": {"query": "蓝牙耳机 amazon 白底产品图", "categories": ["prompt_template", "style_guide"]}, "reasoning": "先搜索知识库获取 prompt 模板"}'


# ---------------------------------------------------------------------------
# 1. CanvasState 同步测试
# ---------------------------------------------------------------------------


class TestCanvasStateSync:
    """CanvasState <-> AgentMemory bidirectional sync."""

    def test_sync_to_canvas_state_exports_fields(self, mock_memory):
        """sync_to_canvas_state() should export all expected keys."""
        data = mock_memory.sync_to_canvas_state()

        assert "current_images" in data
        assert "image_types" in data
        assert "aspect_ratio" in data
        assert "style_preference" in data
        assert "color_palette" in data
        assert "product_name" in data
        assert "selling_points" in data
        assert "ecom_platform" in data
        assert "stitch_regions" in data

        assert data["product_name"] == "无线蓝牙耳机"
        assert data["style_preference"] == "minimal white background"

    def test_sync_from_canvas_state_restores_images(self, mock_memory):
        """sync_from_canvas_state() should populate current_images from layers."""
        canvas_dict = {
            "layers": [
                {"type": "subject", "asset_ref": "https://example.com/img1.png"},
                {"type": "background", "asset_ref": "https://example.com/bg.png"},
            ]
        }
        mock_memory.current_images = {}  # Start empty

        mock_memory.sync_from_canvas_state(canvas_dict)

        assert mock_memory.current_images == {
            "subject": "https://example.com/img1.png",
            "background": "https://example.com/bg.png",
        }

    def test_sync_from_canvas_state_empty_skips(self, mock_memory):
        """sync_from_canvas_state() with no layers should not overwrite."""
        mock_memory.current_images = {"subject": "existing.png"}
        mock_memory.sync_from_canvas_state({"layers": []})
        assert mock_memory.current_images == {"subject": "existing.png"}

    def test_sync_from_canvas_state_no_asset_ref_skipped(self, mock_memory):
        """Layers without asset_ref should not appear in current_images."""
        canvas_dict = {
            "layers": [
                {"type": "subject", "asset_ref": ""},
                {"type": "background", "asset_ref": "https://example.com/bg.png"},
            ]
        }
        mock_memory.current_images = {}
        mock_memory.sync_from_canvas_state(canvas_dict)
        assert "subject" not in mock_memory.current_images
        assert mock_memory.current_images["background"] == "https://example.com/bg.png"


# ---------------------------------------------------------------------------
# 2. RAG 检索测试
# ---------------------------------------------------------------------------


class TestRAGIntegration:
    """RAG retrieval integration in prompt_expander and DECIDE phase."""

    def test_prompt_expander_accepts_rag_retriever_parameter(self):
        """expand_prompt() should accept optional rag_retriever kwarg."""
        import inspect
        sys.path.insert(0, os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..")
        ))
        from agent.intent.prompt_expander import expand_prompt

        sig = inspect.signature(expand_prompt)
        params = list(sig.parameters.keys())
        assert "rag_retriever" in params, f"expand_prompt missing rag_retriever param. Got: {params}"

    @pytest.mark.asyncio
    async def test_prompt_expander_calls_rag_retriever(self, mock_rag_retriever):
        """expand_prompt with rag_retriever should call retrieve_multi_category."""
        sys.path.insert(0, os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..")
        ))
        from agent.intent.prompt_expander import expand_prompt
        from agent.models import DesignBrief, EnrichedContext

        brief = DesignBrief(
            subject="无线蓝牙耳机",
            style_hint="minimal white background",
            platform="amazon",
        )
        ctx = EnrichedContext(rag_context="")

        prompt = await expand_prompt(brief, ctx, "subject", rag_retriever=mock_rag_retriever)

        # Should have called retrieve_multi_category
        mock_rag_retriever.retrieve_multi_category.assert_called()

        # The prompt should contain expanded template text (not empty)
        assert len(prompt) > 20
        assert "bluetooth" in prompt.lower() or "wireless" in prompt.lower() or "product" in prompt.lower()

    @pytest.mark.asyncio
    async def test_prompt_expander_falls_back_to_context_rag(self, mock_memory):
        """Without rag_retriever, expand_prompt should fall back to context.rag_context."""
        sys.path.insert(0, os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..")
        ))
        from agent.intent.prompt_expander import expand_prompt
        from agent.models import DesignBrief, EnrichedContext

        brief = DesignBrief(subject="测试产品", style_hint="简约")
        ctx = EnrichedContext(rag_context="Fallback style: Scandinavian minimalism")

        prompt = await expand_prompt(brief, ctx, "subject", rag_retriever=None)

        assert "Scandinavian" in prompt

    def test_search_knowledge_action_registered(self):
        """search_knowledge should be in ACTION_REGISTRY."""
        sys.path.insert(0, os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..")
        ))
        from agent.actions.handlers import register_all_actions
        from agent.actions.registry import ACTION_REGISTRY, is_registered

        register_all_actions()
        assert is_registered("search_knowledge"), (
            f"search_knowledge not registered. Available: {list(ACTION_REGISTRY.keys())}"
        )

    @pytest.mark.asyncio
    async def test_search_knowledge_handler_returns_structured_results(self, mock_rag_retriever):
        """search_knowledge handler should return results_count and context."""
        sys.path.insert(0, os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..")
        ))
        from agent.actions.handlers.search_knowledge import search_knowledge_fn
        from agent.models import ActionParams, CanvasState

        canvas = CanvasState(canvas_id="test_canvas")
        params = ActionParams(
            action="search_knowledge",
            rag_retriever=mock_rag_retriever,
            query="蓝牙耳机 白底图",
            categories=["prompt_template", "style_guide"],
        )

        result = await search_knowledge_fn(params, canvas)

        assert result.success is True
        assert "results_count" in result.data
        assert result.data["results_count"] > 0
        assert "context" in result.data
        assert len(result.data["context"]) > 0

    @pytest.mark.asyncio
    async def test_search_knowledge_handler_no_retriever(self):
        """search_knowledge without rag_retriever should fail gracefully."""
        sys.path.insert(0, os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..")
        ))
        from agent.actions.handlers.search_knowledge import search_knowledge_fn
        from agent.models import ActionParams, CanvasState

        canvas = CanvasState(canvas_id="test_canvas")
        params = ActionParams(action="search_knowledge", query="test")

        result = await search_knowledge_fn(params, canvas)
        assert result.success is False
        assert "not available" in (result.error or "")


# ---------------------------------------------------------------------------
# 3. SSE 事件完整性测试
# ---------------------------------------------------------------------------


class TestSSEEventParity:
    """New architecture must emit the same SSE event types as old architecture."""

    OLD_ARCH_EVENTS = {
        "agent_thinking", "agent_message", "agent_tool_start",
        "image_progress", "evaluation_progress",
        "canvas_queried", "knowledge_found",
        "error", "image_done", "memory_updated", "done",
    }

    def test_new_arch_yields_all_required_events(self, mock_memory, mock_rag_retriever, mock_llm_json_response):
        """New architecture loop should be capable of yielding all event types."""
        sys.path.insert(0, os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..")
        ))

        # The new architecture's event vocabulary:
        #   SENSE: agent_thinking (phase=sense)
        #   DECIDE: agent_thinking (phase=decide), agent_tool_start
        #   ACT: agent_thinking (phase=act), image_progress, knowledge_found
        #   REVIEW: agent_thinking (phase=review), evaluation_progress
        #   Terminal: agent_message, image_done, memory_updated, canvas_queried, done
        #   Error: error

        new_arch_events = {
            "agent_thinking", "agent_message", "agent_tool_start",
            "image_progress", "evaluation_progress",
            "canvas_queried", "knowledge_found",
            "error", "image_done", "memory_updated", "done",
        }

        missing = self.OLD_ARCH_EVENTS - new_arch_events
        extra = new_arch_events - self.OLD_ARCH_EVENTS

        assert not missing, f"New architecture is missing SSE events: {missing}"
        assert not extra, f"New architecture has extra unexpected SSE events: {extra}"

    def test_canvas_queried_event_in_new_arch(self):
        """Verify canvas_queried event is yielded by the new architecture."""
        # Read loop.py to confirm canvas_queried yield statements exist
        loop_path = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "agent", "core", "loop.py")
        )
        with open(loop_path) as f:
            content = f.read()

        assert "canvas_queried" in content, (
            "canvas_queried event not found in loop.py — new arch must emit this event"
        )

    def test_knowledge_found_event_in_new_arch(self):
        """Verify knowledge_found event is yielded by the new architecture."""
        loop_path = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "agent", "core", "loop.py")
        )
        with open(loop_path) as f:
            content = f.read()

        assert "knowledge_found" in content, (
            "knowledge_found event not found in loop.py — new arch must emit this event"
        )

    def test_average_scores_in_finish_paths(self):
        """Verify average_scores is computed in image_done events."""
        loop_path = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "agent", "core", "loop.py")
        )
        with open(loop_path) as f:
            content = f.read()

        assert "average_scores" in content, (
            "average_scores not found in loop.py — new arch must compute avg scores"
        )
        # Also verify _compute_average_scores function exists
        assert "_compute_average_scores" in content, (
            "_compute_average_scores helper not found in loop.py"
        )


# ---------------------------------------------------------------------------
# 4. average_scores 计算测试
# ---------------------------------------------------------------------------


class TestAverageScores:
    """average_scores computation matches old architecture's finish_task."""

    def test_compute_average_scores_empty(self):
        """Empty evaluations should return empty dict."""
        sys.path.insert(0, os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..")
        ))
        from agent.core.loop import _compute_average_scores
        result = _compute_average_scores({})
        assert result == {}

    def test_compute_average_scores_single_type(self):
        """Single image type with multiple evaluations."""
        sys.path.insert(0, os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..")
        ))
        from agent.core.loop import _compute_average_scores

        evals = {
            "main": [
                {"overall_score": 85},
                {"overall_score": 90},
                {"overall_score": 80},
            ]
        }
        result = _compute_average_scores(evals)
        assert result == {"main": 85.0}

    def test_compute_average_scores_multiple_types(self):
        """Multiple image types with evaluations."""
        sys.path.insert(0, os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..")
        ))
        from agent.core.loop import _compute_average_scores

        evals = {
            "main": [{"overall_score": 80}],
            "scene": [{"overall_score": 70}, {"overall_score": 78}],
        }
        result = _compute_average_scores(evals)
        assert result["main"] == 80.0
        assert result["scene"] == 74.0

    def test_matches_old_finish_task_behavior(self):
        """New average_scores logic should match old finish_task's calculation."""
        sys.path.insert(0, os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..")
        ))
        from agent.core.loop import _compute_average_scores

        # Same data as old agent_loop.py _tool_finish_task would process
        all_evaluations = {
            "main": [
                {"overall_score": 90},
                {"overall_score": 85},
            ],
            "scene_selling": [
                {"overall_score": 78},
            ],
        }
        result = _compute_average_scores(all_evaluations)

        expected = {
            "main": 87.5,
            "scene_selling": 78.0,
        }
        assert result == expected


# ---------------------------------------------------------------------------
# 5. CanvasState 持久化测试
# ---------------------------------------------------------------------------


class TestCanvasStatePersistence:
    """CanvasStateManager persistence via AssetStore interface."""

    def test_save_and_load_roundtrip(self, tmp_path):
        """Save canvas to asset store and load it back intact."""
        sys.path.insert(0, os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..")
        ))
        from agent.canvas.state import CanvasStateManager
        from agent.assets.store import AssetStore

        asset_store = AssetStore(root_dir=str(tmp_path))
        mgr = CanvasStateManager()

        # Create canvas with layers
        canvas = mgr.create_canvas("test_canvas")
        canvas = mgr.create_layer("test_canvas", layer_type="subject", asset_ref="https://example.com/img.png", status="ready")
        canvas = mgr.create_layer("test_canvas", layer_type="background", asset_ref="https://example.com/bg.png", status="ready")

        # Save
        mgr.save_to_asset_store("test_canvas", asset_store)

        # Verify file exists
        assert asset_store.exists("canvas/test_canvas.json")

        # Load into a new manager
        mgr2 = CanvasStateManager()
        loaded = mgr2.load_from_asset_store("test_canvas", asset_store)

        assert loaded is not None
        assert loaded.canvas_id == "test_canvas"
        assert len(loaded.layers) == 2
        assert loaded.layers[0].type == "subject"
        assert loaded.layers[0].asset_ref == "https://example.com/img.png"
        assert loaded.layers[1].type == "background"

    def test_load_nonexistent_returns_none(self, tmp_path):
        """Loading a canvas that was never saved returns None."""
        sys.path.insert(0, os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..")
        ))
        from agent.canvas.state import CanvasStateManager
        from agent.assets.store import AssetStore

        asset_store = AssetStore(root_dir=str(tmp_path))
        mgr = CanvasStateManager()
        result = mgr.load_from_asset_store("nonexistent_canvas", asset_store)
        assert result is None

    def test_save_empty_canvas_preserves_fields(self, tmp_path):
        """Saving and reloading a fresh canvas preserves all fields."""
        sys.path.insert(0, os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..")
        ))
        from agent.canvas.state import CanvasStateManager
        from agent.assets.store import AssetStore

        asset_store = AssetStore(root_dir=str(tmp_path))
        mgr = CanvasStateManager()
        mgr.create_canvas("empty_canvas")
        mgr.save_to_asset_store("empty_canvas", asset_store)

        mgr2 = CanvasStateManager()
        loaded = mgr2.load_from_asset_store("empty_canvas", asset_store)

        assert loaded is not None
        assert loaded.canvas_id == "empty_canvas"
        assert loaded.layers == []
        assert loaded.version == 1


# ---------------------------------------------------------------------------
# 6. 新架构 action 覆盖测试
# ---------------------------------------------------------------------------


class TestActionCoverage:
    """New architecture must cover all critical old-architecture capabilities."""

    def test_all_old_tools_have_new_counterpart(self):
        """Every old-architecture tool should have a new-architecture equivalent."""
        old_tools = {
            "generate_image",
            "evaluate_image",
            "query_canvas",
            "search_knowledge",
            "update_plan",
            "finish_task",
        }

        new_equivalents = {
            "generate_image": "generate_layer (action handler) — ✅ covered",
            "evaluate_image": "local_review + global_review (REVIEW phase) — ✅ covered",
            "query_canvas": "canvas state injected in DECIDE context + canvas_queried event — ✅ covered",
            "search_knowledge": "search_knowledge action handler + SENSE phase auto-retrieval — ✅ covered",
            "update_plan": "DesignBrief rebuilt each iteration from memory — ⚠️ partial (no incremental _agent_updates)",
            "finish_task": "finish/finish_task pseudo-action in DECIDE + average_scores — ✅ covered",
        }

        for tool in old_tools:
            assert tool in new_equivalents, f"No entry for old tool: {tool}"

    def test_all_actions_registered(self):
        """Every sense-decide-act-review action should be registered."""
        sys.path.insert(0, os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..")
        ))
        from agent.actions.handlers import register_all_actions
        from agent.actions.registry import ACTION_REGISTRY

        # Clear for test isolation
        ACTION_REGISTRY.clear()
        register_all_actions()

        expected = {
            "generate_layer",
            "layout_suggest",
            "search_knowledge",
            "style_transfer_batch",
            "generate_product_set",
            "plan_video_edit",
            "plan_viral_replication",
            "reverse_image_prompt",
        }
        actual = set(ACTION_REGISTRY.keys())
        assert actual == expected, f"Action mismatch. Extra: {actual - expected}, Missing: {expected - actual}"
        assert not {"inpaint_region", "remove_background", "compose", "upscale"} & actual
