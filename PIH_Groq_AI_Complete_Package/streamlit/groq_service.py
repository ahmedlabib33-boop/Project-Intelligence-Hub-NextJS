"""
Project Intelligence Hub — Groq Cloud Service (Python / Streamlit)
===================================================================
Save as: src/construction_system/groq_service.py

Prerequisites:
    pip install groq pandas openpyxl

Environment:
    GROQ_API_KEY=gsk_...          (required)
    AI_PROVIDER=groq              (default: groq)
    GROQ_MODEL_PRIMARY=...        (optional)
    GROQ_MODEL_FALLBACK=...       (optional)
"""

import os
import json
import time
import logging
from typing import Optional, Dict, Any, List
from dataclasses import dataclass

import pandas as pd
from groq import Groq
from groq._exceptions import RateLimitError, APIError, APITimeoutError

logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────

GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
AI_PROVIDER = os.environ.get("AI_PROVIDER", "groq").lower()

GROQ_MODEL_PRIMARY = os.environ.get(
    "GROQ_MODEL_PRIMARY",
    "meta-llama/llama-4-maverick-17b-128e-instruct"
)
GROQ_MODEL_FALLBACK = os.environ.get(
    "GROQ_MODEL_FALLBACK",
    "llama-3.1-8b-instant"
)

_groq_client: Optional[Groq] = None


def _get_client() -> Optional[Groq]:
    global _groq_client
    if _groq_client is not None:
        return _groq_client
    if not GROQ_API_KEY:
        logger.warning("GROQ_API_KEY not set.")
        return None
    _groq_client = Groq(api_key=GROQ_API_KEY)
    return _groq_client


# ── Data Classes ────────────────────────────────────────────

@dataclass
class AiResult:
    answer: str
    provider: str
    model: str
    status: str
    error: Optional[str] = None


@dataclass
class ProjectSummary:
    summary: str
    actions: List[str]
    risks: List[str]
    health: str
    provider: str
    model: str
    status: str


@dataclass
class LettersAnalysis:
    themes: List[str]
    critical_letters: List[str]
    action_items: List[str]
    deadlines: List[str]
    provider: str
    model: str
    status: str


@dataclass
class ContractAnalysis:
    summary: str
    key_clauses: List[str]
    claim_exposure: str
    recommendations: List[str]
    provider: str
    model: str
    status: str


@dataclass
class DelayAnalysis:
    delay_events: List[str]
    critical_path_impact: str
    recovery_options: List[str]
    risk_exposure: str
    provider: str
    model: str
    status: str


# ── System Prompts ──────────────────────────────────────────

EXECUTIVE_PROMPT = """You are SAMCO's Executive Project Intelligence Analyst.
You analyze construction project data including EVM (SPI, CPI), delays, risks,
contracts, and correspondence. Answer concisely in executive language.
If data is insufficient, say so honestly. Always cite the data source."""

SUMMARY_PROMPT = """You are SAMCO's Executive Project Intelligence Analyst.
Given project data, generate a structured executive summary.
Respond in JSON with keys: summary, actions, risks, health.
health must be one of: Green, Yellow, Red. Output ONLY valid JSON."""

LETTERS_PROMPT = """You are a construction claims correspondence analyst.
Review project letters and identify: claim-critical correspondence,
missing responses, action items, and deadline risks.
Flag any letter that may trigger notice requirements or time-bar clauses.
Respond in JSON with keys: themes, criticalLetters, actionItems, deadlines.
Output ONLY valid JSON."""

CONTRACT_PROMPT = """You are a FIDIC and construction contract specialist.
Analyze contract clauses, identify claim entitlement, suggest evidence
requirements, and draft professional rebuttal language.
Be precise and reference clause numbers when available.
Respond in JSON with keys: summary, keyClauses, claimExposure, recommendations.
Output ONLY valid JSON."""

DELAY_PROMPT = """You are a construction delay analyst specializing in Time Impact Analysis.
Review delay events, assess critical path impact, and recommend recovery
schedules or acceleration options.
Respond in JSON with keys: delayEvents, criticalPathImpact, recoveryOptions, riskExposure.
Output ONLY valid JSON."""

REBUTTAL_PROMPT = """You are a FIDIC contract specialist drafting a professional claim rebuttal.
Draft a formal response to the following claim. Be precise, reference
applicable clauses, and maintain professional tone."""


# ── Core Functions ──────────────────────────────────────────

def ask_ai(question: str, project_context: Optional[Dict] = None) -> AiResult:
    client = _get_client()
    if not client:
        return _fallback("AI provider not configured.")

    context_str = ""
    if project_context:
        context_str = f"Project Context:
{json.dumps(project_context, indent=2)}

"

    user_prompt = f"{context_str}Question: {question}"

    for model in [GROQ_MODEL_PRIMARY, GROQ_MODEL_FALLBACK]:
        try:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": EXECUTIVE_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.3,
                max_tokens=2048,
            )
            answer = response.choices[0].message.content.strip()
            return AiResult(answer=answer, provider="groq", model=model, status="success")
        except RateLimitError:
            time.sleep(2)
            continue
        except Exception as e:
            logger.error(f"Groq error on {model}: {e}")
            continue

    return _fallback("AI service temporarily unavailable. Please retry.")


def summarize_project(project_data: Dict[str, Any]) -> ProjectSummary:
    client = _get_client()
    if not client:
        return ProjectSummary(
            summary="AI provider not configured.", actions=[], risks=[],
            health="Unknown", provider="fallback", model="none", status="error"
        )

    result = _call_json(SUMMARY_PROMPT, json.dumps(project_data, indent=2))
    if result.status != "success":
        return ProjectSummary(
            summary=result.answer, actions=[], risks=[], health="Unknown",
            provider=result.provider, model=result.model, status=result.status
        )

    try:
        d = json.loads(result.answer)
        return ProjectSummary(
            summary=d.get("summary", ""),
            actions=d.get("actions", []),
            risks=d.get("risks", []),
            health=d.get("health", "Unknown"),
            provider=result.provider,
            model=result.model,
            status="success"
        )
    except json.JSONDecodeError:
        return ProjectSummary(
            summary=result.answer, actions=[], risks=[], health="Unknown",
            provider=result.provider, model=result.model, status="partial"
        )


def analyze_letters(letters_df: Optional[pd.DataFrame] = None,
                    letters_summary: Optional[Dict] = None) -> LettersAnalysis:
    client = _get_client()
    if not client:
        return LettersAnalysis(
            themes=[], critical_letters=[], action_items=[], deadlines=[],
            provider="fallback", model="none", status="error"
        )

    if letters_df is not None and not letters_df.empty:
        context = letters_df.head(50).to_json(orient="records", indent=2)
    elif letters_summary:
        context = json.dumps(letters_summary, indent=2)
    else:
        context = "No letters data available."

    result = _call_json(LETTERS_PROMPT, context)
    return _parse_letters(result)


def analyze_contracts(contract_data: Optional[Dict] = None,
                     clause_query: str = "") -> ContractAnalysis:
    client = _get_client()
    if not client:
        return ContractAnalysis(
            summary="AI provider not configured.", key_clauses=[],
            claim_exposure="Unknown", recommendations=[],
            provider="fallback", model="none", status="error"
        )

    if contract_data:
        context = json.dumps(contract_data, indent=2)
        if clause_query:
            context += f"

Specific Query: {clause_query}"
    else:
        context = "No contract data available."

    result = _call_json(CONTRACT_PROMPT, context)
    return _parse_contract(result)


def analyze_delays(delay_data: Optional[Dict] = None,
                   tia_df: Optional[pd.DataFrame] = None) -> DelayAnalysis:
    client = _get_client()
    if not client:
        return DelayAnalysis(
            delay_events=[], critical_path_impact="AI provider not configured.",
            recovery_options=[], risk_exposure="Unknown",
            provider="fallback", model="none", status="error"
        )

    if tia_df is not None and not tia_df.empty:
        context = tia_df.head(50).to_json(orient="records", indent=2)
    elif delay_data:
        context = json.dumps(delay_data, indent=2)
    else:
        context = "No delay data available."

    result = _call_json(DELAY_PROMPT, context)
    return _parse_delay(result)


def draft_claim_rebuttal(claim_data: Dict[str, Any]) -> AiResult:
    client = _get_client()
    if not client:
        return _fallback("AI provider not configured.")

    prompt = f"Claim Data:
{json.dumps(claim_data, indent=2)}

Draft a professional rebuttal."

    for model in [GROQ_MODEL_PRIMARY, GROQ_MODEL_FALLBACK]:
        try:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": REBUTTAL_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.3,
                max_tokens=4096,
            )
            answer = response.choices[0].message.content.strip()
            return AiResult(answer=answer, provider="groq", model=model, status="success")
        except Exception as e:
            logger.error(f"Draft error on {model}: {e}")
            continue

    return _fallback("Unable to draft rebuttal at this time.")


def check_groq_health() -> Dict[str, Any]:
    client = _get_client()
    if not client:
        return {"available": False, "error": "GROQ_API_KEY not configured"}

    try:
        start = time.time()
        client.chat.completions.create(
            model=GROQ_MODEL_FALLBACK,
            messages=[{"role": "user", "content": "Say ok"}],
            max_tokens=5,
            temperature=0,
        )
        latency = int((time.time() - start) * 1000)
        return {"available": True, "latency_ms": latency, "model": GROQ_MODEL_FALLBACK}
    except Exception as e:
        return {"available": False, "error": str(e)}


# ── Internal Helpers ──────────────────────────────────────

def _call_json(system_prompt: str, user_prompt: str) -> AiResult:
    client = _get_client()
    if not client:
        return _fallback("AI provider not configured.")

    for model in [GROQ_MODEL_PRIMARY, GROQ_MODEL_FALLBACK]:
        try:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.2,
                max_tokens=4096,
                response_format={"type": "json_object"},
            )
            answer = response.choices[0].message.content.strip()
            return AiResult(answer=answer, provider="groq", model=model, status="success")
        except RateLimitError:
            time.sleep(2)
            continue
        except Exception as e:
            logger.error(f"JSON call error on {model}: {e}")
            continue

    return _fallback("AI service temporarily unavailable.")


def _fallback(message: str) -> AiResult:
    return AiResult(answer=message, provider="fallback", model="rule-based", status="error")


def _parse_letters(result: AiResult) -> LettersAnalysis:
    if result.status != "success":
        return LettersAnalysis(
            themes=[], critical_letters=[], action_items=[result.answer], deadlines=[],
            provider=result.provider, model=result.model, status=result.status
        )
    try:
        d = json.loads(result.answer)
        return LettersAnalysis(
            themes=d.get("themes", []),
            critical_letters=d.get("criticalLetters", []),
            action_items=d.get("actionItems", []),
            deadlines=d.get("deadlines", []),
            provider=result.provider,
            model=result.model,
            status="success"
        )
    except json.JSONDecodeError:
        return LettersAnalysis(
            themes=[], critical_letters=[], action_items=[result.answer], deadlines=[],
            provider=result.provider, model=result.model, status="partial"
        )


def _parse_contract(result: AiResult) -> ContractAnalysis:
    if result.status != "success":
        return ContractAnalysis(
            summary=result.answer, key_clauses=[], claim_exposure="Unknown",
            recommendations=[], provider=result.provider, model=result.model, status=result.status
        )
    try:
        d = json.loads(result.answer)
        return ContractAnalysis(
            summary=d.get("summary", ""),
            key_clauses=d.get("keyClauses", []),
            claim_exposure=d.get("claimExposure", "Unknown"),
            recommendations=d.get("recommendations", []),
            provider=result.provider,
            model=result.model,
            status="success"
        )
    except json.JSONDecodeError:
        return ContractAnalysis(
            summary=result.answer, key_clauses=[], claim_exposure="Unknown",
            recommendations=[], provider=result.provider, model=result.model, status="partial"
        )


def _parse_delay(result: AiResult) -> DelayAnalysis:
    if result.status != "success":
        return DelayAnalysis(
            delay_events=[], critical_path_impact=result.answer,
            recovery_options=[], risk_exposure="Unknown",
            provider=result.provider, model=result.model, status=result.status
        )
    try:
        d = json.loads(result.answer)
        return DelayAnalysis(
            delay_events=d.get("delayEvents", []),
            critical_path_impact=d.get("criticalPathImpact", ""),
            recovery_options=d.get("recoveryOptions", []),
            risk_exposure=d.get("riskExposure", "Unknown"),
            provider=result.provider,
            model=result.model,
            status="success"
        )
    except json.JSONDecodeError:
        return DelayAnalysis(
            delay_events=[], critical_path_impact=result.answer,
            recovery_options=[], risk_exposure="Unknown",
            provider=result.provider, model=result.model, status="partial"
        )
