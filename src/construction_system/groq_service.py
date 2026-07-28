from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from typing import Any


DEFAULT_PRIMARY_MODEL = "meta-llama/llama-4-maverick-17b-128e-instruct"
DEFAULT_FALLBACK_MODEL = "llama-3.1-8b-instant"


@dataclass(frozen=True)
class GroqResult:
    answer: str
    provider: str = "groq"
    model: str = ""
    status: str = "error"
    error: str = ""
    latency_ms: int = 0


def _settings() -> dict[str, Any]:
    return {
        "api_key": os.getenv("GROQ_API_KEY", "").strip(),
        "primary_model": os.getenv("GROQ_MODEL_PRIMARY", DEFAULT_PRIMARY_MODEL).strip() or DEFAULT_PRIMARY_MODEL,
        "fallback_model": os.getenv("GROQ_MODEL_FALLBACK", DEFAULT_FALLBACK_MODEL).strip() or DEFAULT_FALLBACK_MODEL,
        "timeout": float(os.getenv("GROQ_TIMEOUT_SECONDS", "18")),
    }


def is_groq_ready() -> bool:
    return bool(_settings()["api_key"])


def _client(api_key: str, timeout: float):
    try:
        from groq import Groq  # type: ignore
    except ImportError as exc:
        raise RuntimeError("Groq SDK is not installed. Add 'groq' to requirements and install dependencies.") from exc
    return Groq(api_key=api_key, timeout=timeout, max_retries=0)


def _public_error(status_code: int | None = None) -> str:
    if status_code == 429:
        return "AI rate limit reached. Please retry shortly."
    if status_code in {401, 403}:
        return "AI provider is not authorized. Check server configuration."
    return "AI service temporarily unavailable. Please retry."


def ask_groq(
    system_prompt: str,
    user_prompt: str,
    *,
    json_mode: bool = False,
    max_tokens: int = 1600,
    temperature: float = 0.25,
) -> GroqResult:
    settings = _settings()
    if not settings["api_key"]:
        return GroqResult(
            answer="AI provider is not configured. Set GROQ_API_KEY.",
            model="none",
            status="error",
            error="GROQ_API_KEY missing",
        )

    started = time.perf_counter()
    last_status: int | None = None
    try:
        client = _client(settings["api_key"], settings["timeout"])
    except Exception as exc:
        return GroqResult(answer=_public_error(), model="none", status="error", error=str(exc)[:300])

    for model in dict.fromkeys([settings["primary_model"], settings["fallback_model"]]):
        try:
            kwargs: dict[str, Any] = {
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt[:14000]},
                ],
                "temperature": temperature,
                "max_tokens": max_tokens,
            }
            if json_mode:
                kwargs["response_format"] = {"type": "json_object"}
            response = client.chat.completions.create(**kwargs)
            answer = (response.choices[0].message.content or "").strip()
            if not answer:
                raise RuntimeError("Empty model response")
            return GroqResult(
                answer=answer,
                model=model,
                status="success",
                latency_ms=int((time.perf_counter() - started) * 1000),
            )
        except Exception as exc:
            last_status = getattr(exc, "status_code", None) or getattr(exc, "status", None)
            if last_status == 429 and model != settings["fallback_model"]:
                continue

    return GroqResult(
        answer=_public_error(last_status),
        model=settings["primary_model"],
        status="error",
        error=_public_error(last_status),
        latency_ms=int((time.perf_counter() - started) * 1000),
    )


def ask_project_ai(question: str, project_context: dict[str, Any] | None = None) -> GroqResult:
    context = json.dumps(project_context or {}, ensure_ascii=False, default=str, indent=2)
    system_prompt = (
        "You are SAMCO's Executive Project Intelligence Analyst. "
        "Use only the provided project context. If data is insufficient, say so. "
        "Do not fabricate dates, costs, EOT days, clauses, or progress."
    )
    user_prompt = f"Project context:\n{context}\n\nQuestion:\n{question[:2000]}"
    return ask_groq(system_prompt, user_prompt)


def check_groq_health() -> dict[str, Any]:
    if not is_groq_ready():
        return {"available": False, "error": "GROQ_API_KEY not configured"}
    result = ask_groq("Return one word only.", "ok", max_tokens=5, temperature=0)
    return {
        "available": result.status == "success",
        "latency_ms": result.latency_ms,
        "model": result.model,
        "error": "" if result.status == "success" else result.error,
    }
