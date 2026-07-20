import pytest

from agent.actions.handlers import generate_video_clip as module
from agent.models import ActionParams, CanvasState


class FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class FakeClient:
    def __init__(self, *args, **kwargs):
        self.polls = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, url, headers, json):
        assert url.endswith('/contents/generations/tasks')
        assert json['content'][1]['role'] == 'first_frame'
        assert json['duration'] == 5
        return FakeResponse(200, {'id': 'task-1'})

    async def get(self, url, headers):
        self.polls += 1
        if self.polls == 1:
            return FakeResponse(200, {'status': 'running'})
        return FakeResponse(200, {
            'status': 'succeeded',
            'content': {'video_url': 'https://example.com/generated.mp4'},
        })


@pytest.mark.asyncio
async def test_generate_video_clip_polls_until_video_is_ready(monkeypatch):
    monkeypatch.setenv('VIDEO_API_KEY', 'test-key')
    monkeypatch.setattr(module.httpx, 'AsyncClient', FakeClient)

    async def no_wait(_seconds):
        return None

    monkeypatch.setattr(module.asyncio, 'sleep', no_wait)
    result = await module.generate_video_clip_fn(
        ActionParams(
            action='generate_video_clip',
            image_base64='data:image/png;base64,AAAA',
            prompt='镜头缓慢向商品推进',
            duration=5,
            ratio='9:16',
        ),
        CanvasState(canvas_id='video-test'),
    )
    assert result.success is True
    assert result.data['video_url'] == 'https://example.com/generated.mp4'
    assert result.data['task_id'] == 'task-1'


@pytest.mark.asyncio
async def test_generate_video_clip_reports_missing_configuration(monkeypatch):
    monkeypatch.delenv('VIDEO_API_KEY', raising=False)
    monkeypatch.delenv('DOUBAO_API_KEY', raising=False)
    result = await module.generate_video_clip_fn(
        ActionParams(
            action='generate_video_clip',
            image_base64='data:image/png;base64,AAAA',
            prompt='轻微运动',
        ),
        CanvasState(canvas_id='video-test'),
    )
    assert result.success is False
    assert '密钥' in result.error
