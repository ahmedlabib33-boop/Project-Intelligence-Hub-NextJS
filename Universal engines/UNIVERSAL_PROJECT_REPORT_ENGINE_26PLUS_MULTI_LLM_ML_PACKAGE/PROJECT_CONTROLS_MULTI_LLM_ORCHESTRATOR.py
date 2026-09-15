#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PROJECT CONTROLS MULTI-LLM EVIDENCE COUNCIL

Python AI Programming by Eng. Ahmed Labib

Governed advisory layer that can consult Claude, Kimi and DeepSeek against the SAME
traceable evidence packet, compare their structured outputs, detect disagreement and
return a deterministic consensus record.

IMPORTANT GOVERNANCE
--------------------
* This module is advisory only. It never replaces native Primavera P6/XER CPM/TIA.
* It never creates missing evidence, dates, relationships, clauses, notices or entitlement.
* Provider agreement is not proof. Unsupported consensus remains unsupported.
* Contract quotations remain unverified until checked against the signed contract/PDF image.
* API keys are read from environment variables and are never written to artifacts.
* Every artifact carries attribution, provider/model provenance, hashes and governance metadata.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import time
import uuid
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import httpx

ATTRIBUTION = "Python AI Programming by Eng. Ahmed Labib"
AUTHOR = "Eng. Ahmed Labib"
VERSION = "2.0.0"
ROOT = Path(__file__).resolve().parent
GOVERNANCE_PATH = ROOT / "UNIVERSAL_GOVERNANCE_26_RULES_AND_30_REPORT_RULEBOOKS.json"

DEFAULT_MODELS = {
    "claude": os.getenv("PROJECT_CONTROLS_CLAUDE_MODEL", "claude-opus-5"),
    "kimi": os.getenv("PROJECT_CONTROLS_KIMI_MODEL", "kimi-k3"),
    "deepseek": os.getenv("PROJECT_CONTROLS_DEEPSEEK_MODEL", "deepseek-v4-pro"),
}

PROVIDERS = {
    "claude": {
        "provider": "Anthropic",
        "key_env": "ANTHROPIC_API_KEY",
        "endpoint": "https://api.anthropic.com/v1/messages",
        "protocol": "anthropic_messages",
    },
    "kimi": {
        "provider": "Moonshot AI",
        "key_env": "MOONSHOT_API_KEY",
        "endpoint": "https://api.moonshot.ai/v1/chat/completions",
        "protocol": "openai_chat_completions",
    },
    "deepseek": {
        "provider": "DeepSeek",
        "key_env": "DEEPSEEK_API_KEY",
        "endpoint": "https://api.deepseek.com/chat/completions",
        "protocol": "openai_chat_completions",
    },
}

VALID_POSITIONS = {"SUPPORTED", "NOT_SUPPORTED", "UNCERTAIN", "CONFLICT", "NEUTRAL_ANALYSIS"}


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def file_sha256(path: str | Path) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def governance_hash() -> Optional[str]:
    return file_sha256(GOVERNANCE_PATH) if GOVERNANCE_PATH.exists() else None


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def output_metadata(
    *,
    run_id: str,
    project_id: Optional[str] = None,
    report_family: Optional[str] = None,
    evidence_hashes: Optional[Sequence[str]] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    meta = {
        "attribution": ATTRIBUTION,
        "author": AUTHOR,
        "engine_component": "multi_llm_evidence_council",
        "component_version": VERSION,
        "run_id": run_id,
        "generated_at_utc": utcnow(),
        "project_id": project_id,
        "report_family": report_family,
        "global_governance_rule_count": 26,
        "governance_sha256": governance_hash(),
        "native_schedule_supremacy": True,
        "ml_role": "decision_support_only",
        "llm_role": "evidence_analysis_and_cross_check_only",
        "evidence_sha256": list(evidence_hashes or []),
        "secrets_persisted": False,
    }
    if extra:
        meta.update(extra)
    return meta


def provider_runtime_status() -> Dict[str, Any]:
    rows: Dict[str, Any] = {}
    for key, cfg in PROVIDERS.items():
        present = bool(os.getenv(cfg["key_env"]))
        rows[key] = {
            "provider": cfg["provider"],
            "model": DEFAULT_MODELS[key],
            "protocol": cfg["protocol"],
            "api_key_configured": present,
            "key_environment_variable": cfg["key_env"],
            "status": "CONFIGURED" if present else "MISSING_API_KEY",
        }
    return {
        "attribution": ATTRIBUTION,
        "component_version": VERSION,
        "provider_count": len(rows),
        "all_configured": all(x["api_key_configured"] for x in rows.values()),
        "providers": rows,
        "governance_sha256": governance_hash(),
        "note": "Provider availability is runtime configuration only; it is not evidence quality or model accuracy.",
    }


@dataclass
class ProviderResult:
    provider_key: str
    provider: str
    model: str
    status: str
    latency_seconds: float
    request_sha256: str
    response_sha256: Optional[str]
    usage: Dict[str, Any]
    structured: Dict[str, Any]
    raw_text: str = ""
    error: Optional[str] = None

    def public_dict(self, include_raw: bool = False) -> Dict[str, Any]:
        d = asdict(self)
        if not include_raw:
            d.pop("raw_text", None)
        return d


class DiskCache:
    def __init__(self, root: Optional[str | Path] = None):
        self.root = Path(root or os.getenv("PROJECT_CONTROLS_LLM_CACHE") or (ROOT / "LLM_CACHE")).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def get(self, key: str) -> Optional[Dict[str, Any]]:
        p = self.root / f"{key}.json"
        if not p.exists():
            return None
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return None

    def put(self, key: str, value: Dict[str, Any]) -> None:
        p = self.root / f"{key}.json"
        p.write_text(json.dumps(value, indent=2, ensure_ascii=False, default=str), encoding="utf-8")


SYSTEM_GOVERNANCE = f"""{ATTRIBUTION}
You are an external analytical reviewer inside a governed Project Controls engine.
You must obey these controls:
1. Evidence first. Do not invent missing evidence, activities, dates, logic, clauses, notices, float or entitlement.
2. Native Primavera P6/XER network governs technical schedule calculations. Do not replace native CPM/TIA with an LLM estimate.
3. Event duration is not EOT. Only measured controlling completion movement after valid CPM recalculation can support current time impact.
4. Calendar overlap is not automatically critical/legal concurrency.
5. ML and LLM outputs are decision-support only.
6. Conflicting sources must be flagged, not silently reconciled in favor of a preferred answer.
7. OCR contract wording must not be quoted as verified unless the evidence packet identifies signed-contract/image verification.
8. Distinguish VERIFIED, WEAK, MISSING, CONFLICT and ANALYTICAL information.
9. If the evidence does not support a conclusion, say NOT_SUPPORTED or UNCERTAIN.
10. Output valid JSON only, following the requested schema.
"""


def build_prompt(question: str, evidence_packet: Dict[str, Any], task_context: Optional[Dict[str, Any]] = None) -> str:
    schema = {
        "position": "SUPPORTED | NOT_SUPPORTED | UNCERTAIN | CONFLICT | NEUTRAL_ANALYSIS",
        "confidence": "0.0-1.0; evidence-grounded, not rhetorical certainty",
        "summary": "concise analytical conclusion",
        "findings": [
            {
                "claim": "one claim",
                "status": "VERIFIED | WEAK | MISSING | CONFLICT | ANALYTICAL",
                "evidence_ids": ["IDs exactly present in evidence packet"],
                "confidence": 0.0,
            }
        ],
        "missing_evidence": ["specific missing items"],
        "conflicts": ["specific conflicting values/sources"],
        "native_schedule_position": "what is and is not established by native schedule evidence",
        "contract_position": "what is and is not established contractually; no automatic entitlement",
        "recommended_checks": ["verification steps"],
    }
    payload = {
        "question": question,
        "task_context": task_context or {},
        "evidence_packet": evidence_packet,
        "required_output_schema": schema,
    }
    return SYSTEM_GOVERNANCE + "\nREQUEST:\n" + json.dumps(payload, ensure_ascii=False, default=str)


def _extract_json(text: str) -> Dict[str, Any]:
    text = (text or "").strip()
    if not text:
        raise ValueError("Empty provider response")
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass
    # Remove fenced wrapper if present.
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.S | re.I)
    candidate = fenced.group(1) if fenced else None
    if candidate:
        obj = json.loads(candidate)
        if isinstance(obj, dict):
            return obj
    # Last-resort balanced first/last braces; still validation-gated below.
    i, j = text.find("{"), text.rfind("}")
    if i >= 0 and j > i:
        obj = json.loads(text[i : j + 1])
        if isinstance(obj, dict):
            return obj
    raise ValueError("Provider did not return valid JSON")


def validate_structured(obj: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
    warnings: List[str] = []
    out = dict(obj or {})
    pos = str(out.get("position", "UNCERTAIN")).upper()
    if pos not in VALID_POSITIONS:
        warnings.append(f"Invalid position '{pos}' converted to UNCERTAIN")
        pos = "UNCERTAIN"
    out["position"] = pos
    try:
        c = float(out.get("confidence", 0.0))
    except Exception:
        c = 0.0
    out["confidence"] = max(0.0, min(1.0, c))
    out["summary"] = str(out.get("summary", "")).strip()
    for key in ["findings", "missing_evidence", "conflicts", "recommended_checks"]:
        if not isinstance(out.get(key), list):
            out[key] = []
            warnings.append(f"{key} was not a list")
    clean_findings = []
    for f in out["findings"]:
        if not isinstance(f, dict):
            continue
        fc = f.get("confidence", 0.0)
        try:
            fc = max(0.0, min(1.0, float(fc)))
        except Exception:
            fc = 0.0
        status = str(f.get("status", "ANALYTICAL")).upper()
        if status not in {"VERIFIED", "WEAK", "MISSING", "CONFLICT", "ANALYTICAL"}:
            status = "ANALYTICAL"
        ev = f.get("evidence_ids", [])
        if not isinstance(ev, list):
            ev = []
        clean_findings.append({
            "claim": str(f.get("claim", "")).strip(),
            "status": status,
            "evidence_ids": [str(x) for x in ev],
            "confidence": fc,
        })
    out["findings"] = clean_findings
    out["native_schedule_position"] = str(out.get("native_schedule_position", "")).strip()
    out["contract_position"] = str(out.get("contract_position", "")).strip()
    out["validation_warnings"] = warnings
    return out, warnings


class MultiLLMOrchestrator:
    def __init__(
        self,
        *,
        timeout_seconds: float = 90.0,
        retries: int = 2,
        cache: bool = True,
        cache_root: Optional[str | Path] = None,
        max_concurrency: int = 3,
    ):
        self.timeout_seconds = timeout_seconds
        self.retries = max(0, int(retries))
        self.cache = DiskCache(cache_root) if cache else None
        self.sem = asyncio.Semaphore(max(1, int(max_concurrency)))

    async def _post(self, provider_key: str, prompt: str, max_tokens: int = 1800) -> ProviderResult:
        cfg = PROVIDERS[provider_key]
        model = DEFAULT_MODELS[provider_key]
        api_key = os.getenv(cfg["key_env"])
        request_obj = {
            "provider": provider_key,
            "model": model,
            "prompt_sha256": sha256_text(prompt),
            "max_tokens": max_tokens,
        }
        request_sha = sha256_text(canonical_json(request_obj))
        cache_key = sha256_text(canonical_json({**request_obj, "prompt": prompt}))
        if self.cache:
            cached = self.cache.get(cache_key)
            if cached:
                pr = ProviderResult(**cached)
                pr.status = "CACHED"
                return pr
        if not api_key:
            return ProviderResult(provider_key, cfg["provider"], model, "MISSING_API_KEY", 0.0, request_sha, None, {}, {}, error=f"{cfg['key_env']} is not configured")

        if cfg["protocol"] == "anthropic_messages":
            headers = {
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }
            payload = {
                "model": model,
                "max_tokens": max_tokens,
                "temperature": 0,
                "messages": [{"role": "user", "content": prompt}],
            }
        else:
            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            payload = {
                "model": model,
                "temperature": 0,
                "messages": [
                    {"role": "system", "content": SYSTEM_GOVERNANCE},
                    {"role": "user", "content": prompt.replace(SYSTEM_GOVERNANCE, "", 1).lstrip()},
                ],
                "stream": False,
            }
            if provider_key == "kimi":
                payload["reasoning_effort"] = os.getenv("PROJECT_CONTROLS_KIMI_REASONING", "high")
            if provider_key == "deepseek":
                payload["thinking"] = {"type": "enabled"}
                payload["reasoning_effort"] = os.getenv("PROJECT_CONTROLS_DEEPSEEK_REASONING", "high")

        last_error: Optional[str] = None
        started = time.perf_counter()
        async with self.sem:
            for attempt in range(self.retries + 1):
                try:
                    async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                        r = await client.post(cfg["endpoint"], headers=headers, json=payload)
                    if r.status_code == 429 or 500 <= r.status_code < 600:
                        retry_after = r.headers.get("retry-after")
                        if attempt < self.retries:
                            await asyncio.sleep(float(retry_after) if retry_after and retry_after.replace(".", "", 1).isdigit() else (1.5 * (2**attempt)))
                            continue
                    r.raise_for_status()
                    data = r.json()
                    if provider_key == "claude":
                        blocks = data.get("content", [])
                        text = "\n".join(str(b.get("text", "")) for b in blocks if isinstance(b, dict) and b.get("type") == "text")
                        usage = data.get("usage", {}) or {}
                    else:
                        choices = data.get("choices", []) or []
                        text = str((((choices[0] if choices else {}).get("message") or {}).get("content")) or "")
                        usage = data.get("usage", {}) or {}
                    structured, _ = validate_structured(_extract_json(text))
                    latency = time.perf_counter() - started
                    result = ProviderResult(provider_key, cfg["provider"], model, "PASS", latency, request_sha, sha256_text(text), usage, structured, raw_text=text)
                    if self.cache:
                        self.cache.put(cache_key, asdict(result))
                    return result
                except Exception as e:
                    last_error = f"{type(e).__name__}: {e}"
                    if attempt < self.retries:
                        await asyncio.sleep(1.5 * (2**attempt))
        return ProviderResult(provider_key, cfg["provider"], model, "ERROR", time.perf_counter() - started, request_sha, None, {}, {}, error=last_error)

    @staticmethod
    def route(mode: str, *, risk_level: str = "medium", conflict_count: int = 0, ml_confidence: Optional[float] = None) -> Tuple[str, List[str]]:
        mode = (mode or "auto").lower()
        risk = (risk_level or "medium").lower()
        if mode == "auto":
            if risk in {"high", "contractual", "critical"} or conflict_count > 0 or (ml_confidence is not None and ml_confidence < 0.70):
                mode = "assurance"
            elif risk in {"medium", "moderate"}:
                mode = "balanced"
            else:
                mode = "fast"
        if mode == "fast":
            preferred = os.getenv("PROJECT_CONTROLS_FAST_LLM", "kimi").lower()
            return mode, [preferred if preferred in PROVIDERS else "kimi"]
        if mode in {"balanced", "assurance"}:
            return mode, ["claude", "kimi", "deepseek"]
        raise ValueError("mode must be auto, fast, balanced, or assurance")

    async def analyze(
        self,
        *,
        question: str,
        evidence_packet: Dict[str, Any],
        task_context: Optional[Dict[str, Any]] = None,
        mode: str = "auto",
        risk_level: str = "medium",
        conflict_count: int = 0,
        ml_confidence: Optional[float] = None,
        project_id: Optional[str] = None,
        report_family: Optional[str] = None,
        evidence_hashes: Optional[Sequence[str]] = None,
        include_raw: bool = False,
    ) -> Dict[str, Any]:
        run_id = f"llm-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
        routed_mode, provider_keys = self.route(mode, risk_level=risk_level, conflict_count=conflict_count, ml_confidence=ml_confidence)
        prompt = build_prompt(question, evidence_packet, task_context)
        results = await asyncio.gather(*(self._post(k, prompt) for k in provider_keys))
        consensus = deterministic_consensus(results)
        reviews: List[ProviderResult] = []
        if routed_mode == "assurance" and sum(r.status in {"PASS", "CACHED"} for r in results) >= 2:
            review_packet = {
                "question": question,
                "original_evidence_packet": evidence_packet,
                "anonymous_candidate_analyses": [r.structured for r in results if r.status in {"PASS", "CACHED"}],
                "instruction": "Audit the candidate analyses only against the supplied evidence. Identify unsupported claims, missed conflicts and schedule/contract governance violations. Do not add new facts.",
            }
            review_prompt = build_prompt("Cross-review the candidate analyses for evidence fidelity and governance compliance.", review_packet, {"phase": "cross_review"})
            reviews = list(await asyncio.gather(*(self._post(k, review_prompt) for k in provider_keys)))
            consensus["assurance_review"] = deterministic_consensus(reviews)
            if consensus["assurance_review"].get("conflict_count", 0) > 0:
                consensus["release_treatment"] = "RECONCILIATION_REQUIRED"
        metadata = output_metadata(
            run_id=run_id,
            project_id=project_id,
            report_family=report_family,
            evidence_hashes=evidence_hashes,
            extra={
                "mode_requested": mode,
                "mode_executed": routed_mode,
                "risk_level": risk_level,
                "provider_keys": provider_keys,
                "prompt_sha256": sha256_text(prompt),
                "question_sha256": sha256_text(question),
            },
        )
        return {
            "attribution": ATTRIBUTION,
            "metadata": metadata,
            "provider_results": [r.public_dict(include_raw) for r in results],
            "cross_review_results": [r.public_dict(include_raw) for r in reviews],
            "consensus": consensus,
            "governing_control": "Native Primavera P6/XER CPM/TIA remains governing. Multi-LLM agreement is advisory and cannot manufacture entitlement or missing evidence.",
        }


def _evidence_ids(result: ProviderResult) -> set[str]:
    ids: set[str] = set()
    for f in result.structured.get("findings", []) if isinstance(result.structured, dict) else []:
        for x in f.get("evidence_ids", []) if isinstance(f, dict) else []:
            ids.add(str(x))
    return ids


def deterministic_consensus(results: Sequence[ProviderResult]) -> Dict[str, Any]:
    ok = [r for r in results if r.status in {"PASS", "CACHED"} and r.structured]
    failed = [r.provider_key for r in results if r not in ok]
    if not ok:
        return {
            "status": "NO_PROVIDER_RESULT",
            "position": "UNCERTAIN",
            "consensus_confidence": 0.0,
            "agreement_score": 0.0,
            "provider_count": 0,
            "failed_or_missing_providers": failed,
            "conflict_count": 0,
            "release_treatment": "EVIDENCE_REVIEW_REQUIRED",
        }
    positions = [str(r.structured.get("position", "UNCERTAIN")) for r in ok]
    counts = {p: positions.count(p) for p in sorted(set(positions))}
    majority = max(counts, key=lambda k: (counts[k], k))
    top_count = counts[majority]
    tied = sum(1 for v in counts.values() if v == top_count) > 1
    agreement = top_count / len(ok)
    if tied or majority in {"CONFLICT", "UNCERTAIN"}:
        position = "CONFLICT" if len(set(positions)) > 1 else majority
    else:
        position = majority
    confidences = [float(r.structured.get("confidence", 0.0) or 0.0) for r in ok]
    base_conf = sum(confidences) / len(confidences)
    # Evidence overlap is not treated as truth, but poor citation consistency reduces confidence.
    evidence_sets = [_evidence_ids(r) for r in ok]
    if len(evidence_sets) <= 1:
        evidence_agreement = 1.0 if evidence_sets and evidence_sets[0] else 0.5
    else:
        union = set().union(*evidence_sets)
        inter = set(evidence_sets[0]).intersection(*evidence_sets[1:]) if evidence_sets else set()
        evidence_agreement = len(inter) / len(union) if union else 0.5
    consensus_conf = min(base_conf, 0.25 + 0.75 * agreement) * (0.75 + 0.25 * evidence_agreement)
    provider_conflicts: List[str] = []
    if len(set(positions)) > 1:
        provider_conflicts.append("Providers returned different evidence positions: " + ", ".join(f"{r.provider_key}={r.structured.get('position')}" for r in ok))
    embedded_conflicts = []
    missing = []
    for r in ok:
        embedded_conflicts.extend(str(x) for x in r.structured.get("conflicts", []) or [])
        missing.extend(str(x) for x in r.structured.get("missing_evidence", []) or [])
    conflicts = list(dict.fromkeys(provider_conflicts + embedded_conflicts))
    missing = list(dict.fromkeys(missing))
    treatment = "ADVISORY_ONLY"
    if conflicts:
        treatment = "RECONCILIATION_REQUIRED"
    elif position in {"UNCERTAIN", "CONFLICT", "NOT_SUPPORTED"}:
        treatment = "EVIDENCE_REVIEW_REQUIRED"
    return {
        "status": "PASS" if not conflicts else "PASS_WITH_CONFLICTS",
        "position": position,
        "position_votes": counts,
        "provider_count": len(ok),
        "failed_or_missing_providers": failed,
        "agreement_score": round(agreement, 6),
        "evidence_reference_agreement": round(evidence_agreement, 6),
        "consensus_confidence": round(max(0.0, min(1.0, consensus_conf)), 6),
        "conflict_count": len(conflicts),
        "conflicts": conflicts,
        "missing_evidence": missing,
        "release_treatment": treatment,
        "critical_note": "Provider consensus is not contractual or CPM proof. Evidence and native schedule remain governing.",
    }


def consensus_to_ml_features(report: Dict[str, Any]) -> Dict[str, float]:
    """Convert advisory consensus to optional numeric decision-support features.

    These are NEVER ground truth and must never be used to overwrite native schedule results.
    """
    c = report.get("consensus", report)
    position = str(c.get("position", "UNCERTAIN"))
    return {
        "llm_advisory_agreement_score": float(c.get("agreement_score", 0.0) or 0.0),
        "llm_advisory_consensus_confidence": float(c.get("consensus_confidence", 0.0) or 0.0),
        "llm_advisory_conflict_count": float(c.get("conflict_count", 0) or 0),
        "llm_advisory_evidence_agreement": float(c.get("evidence_reference_agreement", 0.0) or 0.0),
        "llm_advisory_supported": 1.0 if position == "SUPPORTED" else 0.0,
        "llm_advisory_uncertain_or_conflict": 1.0 if position in {"UNCERTAIN", "CONFLICT"} else 0.0,
    }


def offline_self_test() -> Dict[str, Any]:
    samples = [
        ProviderResult("claude", "Anthropic", "test", "PASS", .1, "a", "b", {}, {"position": "SUPPORTED", "confidence": .84, "findings": [{"claim": "A", "status": "VERIFIED", "evidence_ids": ["SRC-001"], "confidence": .8}], "missing_evidence": [], "conflicts": []}),
        ProviderResult("kimi", "Moonshot AI", "test", "PASS", .1, "a", "b", {}, {"position": "SUPPORTED", "confidence": .80, "findings": [{"claim": "A", "status": "VERIFIED", "evidence_ids": ["SRC-001"], "confidence": .8}], "missing_evidence": [], "conflicts": []}),
        ProviderResult("deepseek", "DeepSeek", "test", "PASS", .1, "a", "b", {}, {"position": "UNCERTAIN", "confidence": .65, "findings": [{"claim": "A", "status": "WEAK", "evidence_ids": ["SRC-001"], "confidence": .6}], "missing_evidence": ["Native XER"], "conflicts": []}),
    ]
    c = deterministic_consensus(samples)
    return {
        "attribution": ATTRIBUTION,
        "status": "PASS" if c["position"] == "SUPPORTED" and c["provider_count"] == 3 and c["agreement_score"] > .66 else "FAIL",
        "provider_count": 3,
        "consensus": c,
        "governance_sha256": governance_hash(),
        "note": "Offline synthetic parser/consensus self-test only; no external provider claim is made.",
    }


def _load_json(path: str | Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def main(argv: Optional[Sequence[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Governed Claude + Kimi + DeepSeek evidence council")
    sp = ap.add_subparsers(dest="cmd")
    sp.add_parser("status")
    sp.add_parser("self-test")
    a = sp.add_parser("analyze")
    a.add_argument("--question", required=True)
    a.add_argument("--evidence-json", required=True)
    a.add_argument("--context-json")
    a.add_argument("--mode", default="auto", choices=["auto", "fast", "balanced", "assurance"])
    a.add_argument("--risk-level", default="medium")
    a.add_argument("--output", required=True)
    a.add_argument("--project-id")
    a.add_argument("--report-family")
    args = ap.parse_args(argv)
    print(ATTRIBUTION)
    if args.cmd == "status":
        print(json.dumps(provider_runtime_status(), indent=2, ensure_ascii=False))
        return 0
    if args.cmd == "self-test":
        r = offline_self_test(); print(json.dumps(r, indent=2, ensure_ascii=False)); return 0 if r["status"] == "PASS" else 2
    if args.cmd == "analyze":
        packet = _load_json(args.evidence_json)
        context = _load_json(args.context_json) if args.context_json else None
        result = asyncio.run(MultiLLMOrchestrator().analyze(question=args.question, evidence_packet=packet, task_context=context, mode=args.mode, risk_level=args.risk_level, project_id=args.project_id, report_family=args.report_family))
        Path(args.output).write_text(json.dumps(result, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
        print(args.output)
        return 0
    ap.print_help(); return 1


if __name__ == "__main__":
    raise SystemExit(main())
