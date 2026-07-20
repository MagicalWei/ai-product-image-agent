"""Generate a short video clip from a product image.

The handler lives in the sense-decide-act-review action layer.  It submits an
asynchronous Volcengine Ark content-generation task and polls it until the
provider returns a playable video URL.
"""

from __future__ import annotations

import asyncio
import os
from typing import Any

import httpx

from agent.models import ActionParams, ActionResult, CanvasState


def _extra(params: ActionParams) -> dict[str, Any]:
    return params.model_extra or {}


def _provider_error(response: httpx.Response, fallback: str) -> str:
    try:
        payload = response.json()
    except Exception:
        payload = {}
    detail = payload.get("error") or payload.get("message") or payload.get("detail")
    if isinstance(detail, dict):
        detail = detail.get("message") or detail.get("code")
    return str(detail or fallback)


async def generate_video_clip_fn(
    params: ActionParams,
    _canvas: CanvasState,
) -> ActionResult:
    """Create an image-to-video clip while preserving the product identity."""
    extra = _extra(params)
    image_url = str(extra.get("image_url") or extra.get("image_base64") or "").strip()
    prompt = str(extra.get("prompt") or "").strip()
    api_key = str(extra.get("api_key") or os.getenv("VIDEO_API_KEY") or os.getenv("DOUBAO_API_KEY") or "").strip()
    base_url = str(extra.get("base_url") or os.getenv("VIDEO_API_BASE_URL") or "https://ark.cn-beijing.volces.com/api/v3").rstrip("/")
    model = str(extra.get("model") or os.getenv("VIDEO_MODEL") or "doubao-seedance-1-5-pro-251215").strip()
    ratio = str(extra.get("ratio") or "9:16")
    duration = max(4, min(12, int(round(float(extra.get("duration") or 5)))))
    timeout_seconds = max(60, min(900, int(os.getenv("VIDEO_GENERATION_TIMEOUT_SECONDS", "600"))))

    if not api_key:
        return ActionResult(success=False, error="未配置图生视频模型密钥（VIDEO_API_KEY 或 DOUBAO_API_KEY）")
    if not image_url.startswith(("data:image/", "https://", "http://")):
        return ActionResult(success=False, error="图生视频缺少有效的商品图片")
    if not prompt:
        return ActionResult(success=False, error="图生视频缺少镜头运动描述")

    payload = {
        "model": model,
        "content": [
            {"type": "text", "text": prompt[:1000]},
            {
                "type": "image_url",
                "image_url": {"url": image_url},
                "role": "first_frame",
            },
        ],
        "resolution": "720p",
        "ratio": ratio if ratio in {"16:9", "9:16", "1:1", "4:3", "3:4", "21:9"} else "9:16",
        "duration": duration,
        "generate_audio": False,
        "watermark": False,
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=20.0)) as client:
            created = await client.post(f"{base_url}/contents/generations/tasks", headers=headers, json=payload)
            if created.status_code >= 400:
                return ActionResult(
                    success=False,
                    error=f"图生视频任务创建失败：{_provider_error(created, f'HTTP {created.status_code}')}",
                )
            task_id = str(created.json().get("id") or created.json().get("task_id") or "").strip()
            if not task_id:
                return ActionResult(success=False, error="图生视频服务未返回任务 ID")

            loop = asyncio.get_running_loop()
            deadline = loop.time() + timeout_seconds
            while loop.time() < deadline:
                await asyncio.sleep(3)
                status_response = await client.get(
                    f"{base_url}/contents/generations/tasks/{task_id}", headers=headers,
                )
                if status_response.status_code >= 400:
                    return ActionResult(
                        success=False,
                        error=f"图生视频状态查询失败：{_provider_error(status_response, f'HTTP {status_response.status_code}')}",
                    )
                task = status_response.json()
                status = str(task.get("status") or "").lower()
                if status == "succeeded":
                    video_url = str((task.get("content") or {}).get("video_url") or "").strip()
                    if not video_url:
                        return ActionResult(success=False, error="图生视频任务完成，但没有返回视频文件")
                    return ActionResult(success=True, data={
                        "task_id": task_id,
                        "video_url": video_url,
                        "duration": duration,
                        "model": model,
                    })
                if status in {"failed", "cancelled", "canceled", "expired"}:
                    return ActionResult(
                        success=False,
                        error=f"图生视频生成失败：{_provider_error(status_response, '模型任务执行失败')}",
                    )
            return ActionResult(success=False, error="图生视频生成超时，请稍后重试")
    except httpx.TimeoutException:
        return ActionResult(success=False, error="图生视频服务连接超时，请稍后重试")
    except (httpx.HTTPError, ValueError, TypeError) as error:
        return ActionResult(success=False, error=f"图生视频服务调用失败：{error}")


__all__ = ["generate_video_clip_fn"]
