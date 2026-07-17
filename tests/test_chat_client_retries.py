import asyncio
import os
import sys

import httpx


SERVICE_DIR = os.path.join(os.path.dirname(__file__), "..", "backend", "agent_service")
if SERVICE_DIR not in sys.path:
    sys.path.insert(0, SERVICE_DIR)

import chat_client


def test_post_json_retries_transport_errors(monkeypatch):
    calls = 0

    class FakeClient:
        async def post(self, url, headers, json):
            nonlocal calls
            calls += 1
            request = httpx.Request("POST", url)
            if calls == 1:
                raise httpx.ConnectError("temporary disconnect", request=request)
            return httpx.Response(200, request=request, json={"ok": True})

    async def no_sleep(_delay):
        return None

    monkeypatch.setattr(chat_client.asyncio, "sleep", no_sleep)
    response = asyncio.run(chat_client.post_json_with_retries(
        FakeClient(),
        "https://provider.test/v1/chat",
        headers={},
        payload={},
        provider="test-provider",
        attempts=2,
    ))

    assert response.status_code == 200
    assert calls == 2


def test_structured_response_validation_triggers_provider_fallback(monkeypatch):
    calls = []

    async def fake_call(_messages, _protocol, _api_key, _base_url, model, **_kwargs):
        calls.append(model)
        if model == "primary":
            return {"content": "", "tool_calls": []}
        return {"content": '{"action":"chat","params":{}}', "tool_calls": []}

    monkeypatch.setattr(chat_client, "_call_chat_api", fake_call)

    def validate_json(content):
        import json
        parsed = json.loads(content)
        if not isinstance(parsed, dict):
            raise ValueError("not an object")
        return parsed

    result = asyncio.run(chat_client.execute_chat_with_fallbacks(
        [],
        {"protocol": "openai", "api_key": "a", "base_url": "https://a.test", "model": "primary"},
        [{"protocol": "openai", "api_key": "b", "base_url": "https://b.test", "model": "fallback"}],
        response_validator=validate_json,
    ))

    assert calls == ["primary", "fallback"]
    assert result["action"] == "chat"
