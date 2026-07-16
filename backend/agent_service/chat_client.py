"""
Agent Service — Chat API Client

OpenAI-compatible and Anthropic-native API calling layer with fallback chain.
Supports function calling (tools) for OpenAI protocol.
"""

import os
import re
import base64
import logging
import asyncio
from typing import Dict, List, Any, Optional

import httpx

logger = logging.getLogger(__name__)

RETRYABLE_HTTP_STATUS = {408, 409, 425, 429, 500, 502, 503, 504}
DEFAULT_HTTP_RETRY_ATTEMPTS = int(os.getenv("AI_HTTP_RETRY_ATTEMPTS", "3"))


def _retry_after_seconds(resp: httpx.Response) -> float | None:
    value = resp.headers.get("Retry-After")
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        return None


def _http_error_message(provider: str, resp: httpx.Response) -> str:
    body = resp.text[:500]
    return f"{provider} API error (HTTP {resp.status_code}): {body}"


async def post_json_with_retries(
    client: httpx.AsyncClient,
    url: str,
    *,
    headers: Dict[str, str],
    payload: Dict[str, Any],
    provider: str,
    attempts: int = DEFAULT_HTTP_RETRY_ATTEMPTS,
) -> httpx.Response:
    """POST JSON with bounded retries for provider throttling/transient errors."""
    last_resp: httpx.Response | None = None
    for attempt in range(1, max(1, attempts) + 1):
        resp = await client.post(url, headers=headers, json=payload)
        if resp.status_code < 400:
            return resp
        last_resp = resp
        if resp.status_code not in RETRYABLE_HTTP_STATUS or attempt >= attempts:
            break
        retry_after = _retry_after_seconds(resp)
        delay = retry_after if retry_after is not None else min(8.0, 0.8 * (2 ** (attempt - 1)))
        logger.warning(
            "[%s] HTTP %s, retrying in %.1fs (%s/%s)",
            provider,
            resp.status_code,
            delay,
            attempt,
            attempts,
        )
        await asyncio.sleep(delay)
    raise RuntimeError(_http_error_message(provider, last_resp))

# ========================================================
# Model capability detection
# ========================================================

def model_supports_vision(model_name: str) -> bool:
    """Helper to detect if a model natively supports OpenAI-style multimodal image messages."""
    model_lower = model_name.lower()
    if "gpt-4o" in model_lower:
        return True
    if "vision" in model_lower:
        return True
    if any(name in model_lower for name in ("qwen", "doubao-seed", "gemini", "claude-3")):
        return True
    return False


def strip_images_from_messages(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Strips image_url and media blocks, keeping only text parts, to avoid 400 Bad Request on text-only models.

    Preserves tool-related fields (tool_call_id, tool_calls, name) for function calling support.
    """
    clean_messages = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if isinstance(content, list):
            text_parts = []
            for part in content:
                if isinstance(part, dict):
                    if part.get("type") == "text":
                        text_parts.append(part.get("text", ""))
            clean_content = "\n".join(text_parts)
        else:
            clean_content = content

        entry = {"role": role, "content": clean_content}

        # Preserve tool-related fields for function calling
        if "tool_call_id" in msg:
            entry["tool_call_id"] = msg["tool_call_id"]
        if "tool_calls" in msg:
            entry["tool_calls"] = msg["tool_calls"]
        if "name" in msg:
            entry["name"] = msg["name"]

        clean_messages.append(entry)
    return clean_messages

# ========================================================
# Message builders
# ========================================================

def _build_openai_messages(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    result = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        # OpenAI-compatible multimodal endpoints expect content blocks to be
        # forwarded unchanged. Text-only models are handled by
        # strip_images_from_messages() before this builder is called.
        if isinstance(content, list):
            content = [part.copy() if isinstance(part, dict) else part for part in content]

        entry = {"role": role, "content": content}

        if "tool_call_id" in msg:
            entry["tool_call_id"] = msg["tool_call_id"]
        if "tool_calls" in msg:
            entry["tool_calls"] = msg["tool_calls"]
        if "name" in msg and role == "tool":
            entry["name"] = msg["name"]

        result.append(entry)
    return result


def _build_anthropic_messages(messages: List[Dict[str, Any]]) -> tuple:
    system_parts = []
    api_messages = []
    for msg in messages:
        role = msg.get("role", "")
        content = msg.get("content", "")
        if role == "system":
            if isinstance(content, str):
                system_parts.append(content)
            elif isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        system_parts.append(block["text"])
        elif role in ("user", "assistant"):
            if isinstance(content, list):
                text_parts = []
                for block in content:
                    if isinstance(block, dict):
                        if block.get("type") == "text":
                            text_parts.append(block.get("text", ""))
                        elif block.get("type") == "image_url":
                            text_parts.append("[图片数据]")
                content = "\n".join(text_parts)
            api_messages.append({"role": role, "content": content})
    return ("\n\n".join(system_parts), api_messages)

# ========================================================
# Response extraction
# ========================================================

def _extract_response(data: Dict[str, Any], protocol: str) -> Dict[str, Any]:
    """Extract content and tool_calls from API response."""
    if protocol == "anthropic":
        content = data.get("content", [])
        if isinstance(content, list):
            text = "".join(
                block.get("text", "") if isinstance(block, dict) else str(block)
                for block in content
            )
        else:
            text = str(content)
        return {"content": text, "tool_calls": []}
    else:
        choices = data.get("choices", [])
        if not choices:
            raise RuntimeError(f"No choices returned from chat API: {str(data)}")
        msg = choices[0].get("message", {})
        content = msg.get("content", "")
        if isinstance(content, list):
            content = "".join(
                part.get("text", "") if isinstance(part, dict) else str(part)
                for part in content
            )
        tool_calls = msg.get("tool_calls", [])
        return {"content": content or "", "tool_calls": tool_calls}


def _extract_text_from_response(data: Dict[str, Any], protocol: str) -> str:
    """Legacy wrapper: extract only the text content from a response."""
    return _extract_response(data, protocol)["content"]

# ========================================================
# Low-level API calls
# ========================================================

async def _call_anthropic_api(
    messages: List[Dict[str, Any]],
    api_key: str,
    base_url: str,
    model: str,
) -> str:
    system_text, api_messages = _build_anthropic_messages(messages)
    url = f"{base_url.rstrip('/')}/v1/messages"
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
    payload: Dict[str, Any] = {
        "model": model,
        "max_tokens": 4096,
        "messages": api_messages,
    }
    if system_text:
        payload["system"] = system_text

    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=30.0)) as client:
        resp = await post_json_with_retries(
            client,
            url,
            headers=headers,
            payload=payload,
            provider="Anthropic",
        )
        data = resp.json()
        return _extract_text_from_response(data, "anthropic")


async def _call_openai_compatible_api(
    messages: List[Dict[str, Any]],
    api_key: str,
    base_url: str,
    model: str,
    tools: Optional[List[Dict[str, Any]]] = None,
    tool_choice: Optional[str] = None,
    max_tokens: Optional[int] = None,
) -> Dict[str, Any]:
    """Call OpenAI-compatible chat API. Returns {"content": "...", "tool_calls": [...]}."""
    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload: Dict[str, Any] = {
        "model": model,
        "messages": _build_openai_messages(messages),
    }
    if max_tokens:
        payload["max_tokens"] = max_tokens
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = tool_choice or "auto"

    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=30.0)) as client:
        resp = await post_json_with_retries(
            client,
            url,
            headers=headers,
            payload=payload,
            provider="Chat",
        )
        data = resp.json()
        return _extract_response(data, "openai")


async def _call_chat_api(
    messages: List[Dict[str, Any]],
    protocol: str,
    api_key: str,
    base_url: str,
    model: str,
    tools: Optional[List[Dict[str, Any]]] = None,
    tool_choice: Optional[str] = None,
    supports_vision: Optional[bool] = None,
    max_tokens: Optional[int] = None,
) -> Dict[str, Any]:
    """Call chat API. Returns {"content": "...", "tool_calls": [...]}."""
    vision_enabled = model_supports_vision(model) if supports_vision is None else supports_vision
    if protocol == "anthropic" or not vision_enabled:
        messages = strip_images_from_messages(messages)

    if protocol == "anthropic":
        text = await _call_anthropic_api(messages, api_key, base_url, model)
        return {"content": text, "tool_calls": []}
    else:
        return await _call_openai_compatible_api(
            messages, api_key, base_url, model, tools, tool_choice, max_tokens
        )

# ========================================================
# Fallback executors
# ========================================================

async def execute_chat_with_fallbacks(
    messages: List[Dict[str, Any]],
    primary_config: Dict[str, Any],
    fallbacks: List[Dict[str, Any]],
) -> str:
    async def _try_config(config):
        result = await _call_chat_api(
            messages,
            config["protocol"],
            config["api_key"],
            config["base_url"],
            config["model"],
            supports_vision=config.get("supports_vision"),
            max_tokens=config.get("max_tokens"),
        )
        return result["content"]

    primary_error = ""
    # 1. Primary
    try:
        logger.info(f"[Fallback Chat] Invoking primary model: {primary_config['model']} ({primary_config['protocol']})")
        return await _try_config(primary_config)
    except Exception as e1:
        primary_error = str(e1)
        logger.warning(f"[Fallback Chat] Primary model failed: {primary_error}")

    # 2. Bounded configured fallbacks
    for index, fallback in enumerate(fallbacks, start=1):
        if not fallback.get("api_key"):
            continue
        try:
            logger.info(f"[Fallback Chat] Trying Fallback {index}: {fallback['model']} ({fallback['protocol']})")
            return await _try_config(fallback)
        except Exception as fallback_error:
            logger.warning(f"[Fallback Chat] Fallback {index} failed: {str(fallback_error)}")

    raise RuntimeError(f"All chat model attempts failed. Primary error: {primary_error}")


async def execute_chat_with_fallbacks_full(
    messages: List[Dict[str, Any]],
    primary_config: Dict[str, Any],
    fallbacks: List[Dict[str, Any]],
    tools: Optional[List[Dict[str, Any]]] = None,
    tool_choice: Optional[str] = None,
) -> Dict[str, Any]:
    """Like execute_chat_with_fallbacks but returns full response dict with tool_calls."""
    async def _try_config(config):
        return await _call_chat_api(
            messages,
            config["protocol"],
            config["api_key"],
            config["base_url"],
            config["model"],
            tools=tools,
            tool_choice=tool_choice,
            supports_vision=config.get("supports_vision"),
            max_tokens=config.get("max_tokens"),
        )

    primary_error = ""
    # 1. Primary
    try:
        logger.info(f"[Fallback Chat Full] Invoking primary model: {primary_config['model']} ({primary_config['protocol']})")
        return await _try_config(primary_config)
    except Exception as e1:
        primary_error = str(e1)
        logger.warning(f"[Fallback Chat Full] Primary model failed: {primary_error}")

    for index, fallback in enumerate(fallbacks, start=1):
        if not fallback.get("api_key"):
            continue
        try:
            logger.info(f"[Fallback Chat Full] Trying Fallback {index}: {fallback['model']} ({fallback['protocol']})")
            return await _try_config(fallback)
        except Exception as fallback_error:
            logger.warning(f"[Fallback Chat Full] Fallback {index} failed: {str(fallback_error)}")

    raise RuntimeError(f"All chat model attempts failed. Primary error: {primary_error}")

# ========================================================
# Image Generation APIs
# ========================================================

async def call_openai_image_api(prompt: str, size: str, negative_prompt: str, config: Dict[str, Any]) -> str:
    """Issues standard OpenAI Image Generation API request (async)."""
    url = f"{config['base_url'] or 'https://api.openai.com/v1'}/images/generations"
    headers = {
        "Authorization": f"Bearer {config['api_key']}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": config["model"] or "dall-e-3",
        "prompt": f"{prompt}. Negative prompt: {negative_prompt}" if negative_prompt else prompt,
        "n": 1,
        "size": size
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=30.0)) as client:
        resp = await post_json_with_retries(
            client,
            url,
            headers=headers,
            payload=payload,
            provider="OpenAI Image",
        )
        data = resp.json()
        images = data.get("data", [])
        if not images:
            raise RuntimeError(f"No image returned from OpenAI: {str(data)}")
        return images[0].get("url")


async def call_anthropic_svg_generator(prompt: str, negative_prompt: str, config: Dict[str, Any]) -> str:
    """Invokes Anthropic protocol fallback to generate renderable SVG illustration code."""
    system = (
        "You are an SVG designer. Generate a clean, modern, premium-looking Scalable Vector Graphics (SVG) "
        "illustration representing the user's design prompt. "
        "Requirements:\n"
        "1. Output ONLY a valid, self-contained SVG XML code block.\n"
        "2. Do NOT write markdown, do NOT write explanations, do NOT write markdown code blocks (like ```xml).\n"
        "3. Output only the raw <svg>...</svg> content. Ensure it renders correctly with color gradients and vector paths."
    )
    query = f"Create a beautiful SVG graphic representing: '{prompt}'."
    if negative_prompt:
        query += f" Avoid: '{negative_prompt}'."

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": query},
    ]

    response = await _call_chat_api(
        messages,
        config.get("protocol", "anthropic"),
        config["api_key"],
        config["base_url"] or "https://api.anthropic.com",
        config["model"],
    )
    svg_code = response["content"].strip()

    if "```" in svg_code:
        md_match = re.search(r"```(?:xml|svg|html)?\s*(<svg.*?</svg>)\s*```", svg_code, re.DOTALL)
        if md_match:
            svg_code = md_match.group(1)

    if "<svg" in svg_code:
        match = re.search(r"(<svg.*?</svg>)", svg_code, re.DOTALL)
        if match:
            svg_code = match.group(1)

    svg_base64 = base64.b64encode(svg_code.encode("utf-8")).decode("utf-8")
    return f"data:image/svg+xml;base64,{svg_base64}"

# ========================================================
# Fallback Config Loaders
# ========================================================

def get_chat_fallback_configs() -> List[Dict[str, Any]]:
    return [
        {
            "protocol": os.getenv("CHAT_FALLBACK_1_PROTOCOL", "anthropic"),
            "api_key": os.getenv("CHAT_FALLBACK_1_KEY"),
            "base_url": os.getenv("CHAT_FALLBACK_1_URL"),
            "model": os.getenv("CHAT_FALLBACK_1_MODEL", "claude-3-5-sonnet-20240620")
        },
        {
            "protocol": os.getenv("CHAT_FALLBACK_2_PROTOCOL", "openai"),
            "api_key": os.getenv("CHAT_FALLBACK_2_KEY"),
            "base_url": os.getenv("CHAT_FALLBACK_2_URL"),
            "model": os.getenv("CHAT_FALLBACK_2_MODEL", "gpt-4o-mini")
        }
    ]


def get_image_fallback_configs() -> List[Dict[str, Any]]:
    return [
        {
            "protocol": os.getenv("IMAGE_FALLBACK_1_PROTOCOL", "openai"),
            "api_key": os.getenv("IMAGE_FALLBACK_1_KEY"),
            "base_url": os.getenv("IMAGE_FALLBACK_1_URL"),
            "model": os.getenv("IMAGE_FALLBACK_1_MODEL", "dall-e-3")
        },
        {
            "protocol": os.getenv("IMAGE_FALLBACK_2_PROTOCOL", "openai"),
            "api_key": os.getenv("IMAGE_FALLBACK_2_KEY"),
            "base_url": os.getenv("IMAGE_FALLBACK_2_URL"),
            "model": os.getenv("IMAGE_FALLBACK_2_MODEL", "dall-e-2")
        },
        {
            "protocol": os.getenv("IMAGE_FALLBACK_3_PROTOCOL", "anthropic"),
            "api_key": os.getenv("IMAGE_FALLBACK_3_KEY"),
            "base_url": os.getenv("IMAGE_FALLBACK_3_URL"),
            "model": os.getenv("IMAGE_FALLBACK_3_MODEL", "claude-3-5-sonnet-20240620")
        }
    ]
