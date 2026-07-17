from agent.canvas.identity import build_agent_canvas_id


def test_canvas_identity_is_isolated_by_session_even_for_same_product():
    assert build_agent_canvas_id("session-a", "手机") != build_agent_canvas_id("session-b", "手机")


def test_canvas_identity_has_deterministic_legacy_fallback():
    assert build_agent_canvas_id("", "手机") == build_agent_canvas_id("", "手机")
    assert build_agent_canvas_id("", "") is None
