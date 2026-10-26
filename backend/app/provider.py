"""OpenAI-compatible chat/tool protocol, with a bounded response and no retries."""
import time

import httpx

from .agent_tools import ToolRejected, strict_json, tool_definitions


def request_message(settings, messages, deadline):
    remaining = min(settings.model_timeout, deadline - time.monotonic())
    if remaining <= 0:
        raise TimeoutError("Workflow time budget exceeded")
    with httpx.Client(timeout=httpx.Timeout(remaining, connect=min(5, remaining)), follow_redirects=False, trust_env=False) as client:
        with client.stream(
            "POST", settings.model_url.rstrip("/") + "/chat/completions",
            headers={"Authorization": f"Bearer {settings.model_key}"},
            json={"model": settings.model_name, "temperature": 0, "max_tokens": 1800,
                  "messages": messages, "tools": tool_definitions(), "tool_choice": "auto"},
        ) as response:
            response.raise_for_status()
            chunks, size = [], 0
            for chunk in response.iter_bytes():
                size += len(chunk)
                if size > 128_000:
                    raise ToolRejected("RESPONSE_SIZE_EXCEEDED", "模型响应超过大小预算，已停止自动建议。")
                if time.monotonic() > deadline:
                    raise TimeoutError("Model response exceeded execution budget")
                chunks.append(chunk)
    try:
        payload = strict_json(b"".join(chunks))
        if not isinstance(payload, dict):
            raise ValueError("Expected an object")
        choices = payload["choices"]
        if not isinstance(choices, list) or len(choices) != 1:
            raise ValueError("Expected one choice")
        choice = choices[0]
        if not isinstance(choice, dict):
            raise ValueError("Expected a choice object")
        message = choice["message"]
        if not isinstance(message, dict) or message.get("refusal"):
            raise ValueError("Invalid or refused response")
        if choice.get("finish_reason") in ("length", "content_filter"):
            raise ValueError("Incomplete response")
        usage = payload.get("usage") or {}
        if not isinstance(usage, dict):
            usage = {}
        # Preserve reported token counts only. Never estimate or label them as cost.
        usage = {key: usage[key] for key in ("prompt_tokens", "completion_tokens", "total_tokens") if type(usage.get(key)) is int and usage[key] >= 0}
        return message, usage
    except (ValueError, KeyError, TypeError):
        raise ToolRejected("INVALID_PROVIDER_RESPONSE", "模型返回不完整或协议不合法，已停止自动建议。") from None
