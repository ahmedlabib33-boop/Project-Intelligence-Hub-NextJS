"""Schema 1's "LLM Worker (Async Task)" box.

Registers the ``llm_task`` job type with the orchestration core engine
(``orchestration.py``). A caller enqueues a prompt, the worker claims it and
calls out to the existing Groq/OpenAI gateways -- Schema 1's "External API"
box -- and writes the answer back onto the job row. No new prompt logic
lives here; this only gives existing LLM calls a durable, retryable, audited
home instead of a bare synchronous function call.
"""

from __future__ import annotations

from typing import Any

from .groq_service import ask_groq
from .orchestration import register_handler


@register_handler("llm_task")
def run_llm_task(payload: dict[str, Any]) -> dict[str, Any]:
    system_prompt = str(payload.get("system_prompt") or "").strip()
    user_prompt = str(payload.get("user_prompt") or "").strip()
    if not system_prompt or not user_prompt:
        raise ValueError("llm_task payload requires non-empty 'system_prompt' and 'user_prompt'.")

    result = ask_groq(
        system_prompt,
        user_prompt,
        json_mode=bool(payload.get("json_mode", False)),
        max_tokens=int(payload.get("max_tokens", 1600)),
        temperature=float(payload.get("temperature", 0.25)),
    )
    if result.status != "success":
        raise RuntimeError(result.error or result.answer)
    return {
        "provider": result.provider,
        "model": result.model,
        "answer": result.answer,
        "latency_ms": result.latency_ms,
    }
