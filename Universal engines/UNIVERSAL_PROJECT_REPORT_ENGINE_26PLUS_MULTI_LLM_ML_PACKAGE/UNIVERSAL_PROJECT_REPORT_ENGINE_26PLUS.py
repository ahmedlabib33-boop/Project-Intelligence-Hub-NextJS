#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
UNIVERSAL PROJECT REPORT ENGINE 26+ GOVERNED EDITION

Python AI Programming by Eng. Ahmed Labib

Extension layer over UNIVERSAL_PROJECT_REPORT_ENGINE.py.
Adds:
- 30 independent report families (26 required + 4 additional)
- 32-layer controlled processing architecture
- one universal 26-rule governance layer
- independent report-family rulebooks
- attribution enforcement in reports, manifests, metadata and CLI output
- evidence conflict detection, legacy quarantine, schedule-supremacy gates,
  missing-evidence controls, family-specific validation and release statuses
- compatible analyze_inputs() and generate_report() APIs for the companion
  ChatGPT workflow.

This engine intentionally does not fabricate missing technical/contractual facts.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import shutil
import sys
import tempfile
import zipfile
import hashlib
import platform
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

VERSION = "2.6.0"
ATTRIBUTION = "Python AI Programming by Eng. Ahmed Labib"
AUTHOR = "Eng. Ahmed Labib"
BASE_ENGINE_FILE = "UNIVERSAL_PROJECT_REPORT_ENGINE.py"
GOVERNANCE_FILE = "UNIVERSAL_GOVERNANCE_26_RULES_AND_30_REPORT_RULEBOOKS.json"

ROOT = Path(__file__).resolve().parent


def _load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, str(path))
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load module from {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


BASE = _load_module(ROOT / BASE_ENGINE_FILE, "universal_project_report_engine_base")
GOVERNANCE = json.loads((ROOT / GOVERNANCE_FILE).read_text(encoding="utf-8"))
REPORT_FAMILIES: Dict[str, Dict[str, Any]] = GOVERNANCE["report_families"]
ALLOWED_REPORT_TYPES = {"auto", "tia", *REPORT_FAMILIES.keys()}

# Preserve convenient public names from the base engine.
Source = BASE.Source
Schedule = BASE.Schedule
Comparison = BASE.Comparison
Event = BASE.Event
Model = BASE.Model
E = BASE.E
Slide = BASE.Slide
THEME = BASE.THEME
W, H = BASE.W, BASE.H


def load_json(path: str | Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def save_json(path: str | Path, value: Any) -> Path:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(value, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    return p


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _emit(value: Any) -> None:
    """CLI output: every user-facing response begins with the required attribution."""
    print(ATTRIBUTION)
    if isinstance(value, (dict, list)):
        print(json.dumps(value, indent=2, ensure_ascii=False, default=str))
    else:
        print(value)


def normalize_report_type(report_type: str) -> str:
    key = (report_type or "auto").strip().lower().replace("-", "_").replace(" ", "_")
    if key == "tia":
        return "eot"
    aliases = {}
    for family, p in REPORT_FAMILIES.items():
        aliases[family] = family
        for alias in p.get("aliases", []):
            aliases[str(alias).lower().replace("-", "_").replace(" ", "_")] = family
    if key == "auto":
        return "auto"
    if key not in aliases:
        raise ValueError(f"Unsupported report type: {report_type}. Allowed: {', '.join(sorted(ALLOWED_REPORT_TYPES))}")
    return aliases[key]


def _corpus(sources: Sequence[Source]) -> str:
    return "\n".join((x.title or "") + "\n" + (x.text or "") for x in sources).lower()


def classify_report_family(sources: Sequence[Source], schedules: Sequence[Schedule]) -> Tuple[str, float, Dict[str, float]]:
    corpus = _corpus(sources)
    scores: Dict[str, float] = {k: 0.0 for k in REPORT_FAMILIES}
    for family, profile in REPORT_FAMILIES.items():
        for phrase in profile.get("keywords", []):
            q = str(phrase).lower()
            count = min(corpus.count(q), 8)
            if count:
                scores[family] += count * (6.0 if " " in q else 3.0)
    if schedules:
        scores["critical_path"] += 4
        scores["progress"] += 3
        scores["forecast_completion"] += 3
        scores["baseline_current"] += 2 if len(schedules) >= 2 else 0
    if any(s.role == "before" for s in schedules) and any(s.role == "after" for s in schedules):
        scores["eot"] += 20
        scores["delay"] += 12
        scores["baseline_current"] += 6
    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    best, best_score = ranked[0]
    second = ranked[1][1] if len(ranked) > 1 else 0.0
    if best_score <= 0:
        return "hybrid", 0.25, scores
    confidence = min(0.99, 0.45 + (best_score - second) / max(best_score, 1.0) * 0.45)
    return best, round(confidence, 2), scores


def _base_type_for(family: str) -> str:
    if family in {"eot", "delay", "progress", "recovery", "variation", "hybrid"}:
        return family
    return "hybrid"


def _clean_context(context: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not context:
        return context
    result = dict(context)
    # Base engine does not know all 30 report types; the governed wrapper applies it later.
    result.pop("report_type", None)
    return result


def _source_warnings(model: Model) -> List[str]:
    out: List[str] = []
    for src in model.sources:
        out.extend(src.warnings)
    out.extend(model.warnings)
    return list(dict.fromkeys(str(x) for x in out if str(x).strip()))


def _legacy_sources(model: Model) -> List[str]:
    return [Path(x.path).name for x in model.sources if "_combined_handoff" in str(x.path).lower()]


def _active_sources(model: Model) -> List[Source]:
    return [x for x in model.sources if "_combined_handoff" not in str(x.path).lower()]


def _labeled_values(model: Model) -> Dict[str, List[Dict[str, str]]]:
    """Extract a controlled set of explicitly labeled values for reconciliation."""
    fields = {
        "data_date": [r"\b(?:data date|status date)\s*[:=\-]\s*([^\n|]{6,35})"],
        "project_finish": [r"\b(?:project finish|forecast finish|expected finish)\s*[:=\-]\s*([^\n|]{6,35})"],
        "planned_progress": [r"\bplanned\s+(?:progress|completion|complete)\s*[:=\-]?\s*(\d+(?:\.\d+)?)\s*%"],
        "actual_progress": [r"\bactual\s+(?:progress|completion|complete)\s*[:=\-]?\s*(\d+(?:\.\d+)?)\s*%"],
        "net_eot_days": [r"\bnet\s+(?:eot|extension|impact)\s*[:=\-]?\s*(\d+(?:\.\d+)?)\s*(?:calendar\s*)?days"],
        "overlap_days": [r"\b(?:overlap|concurrency|concurrent)\s*[:=\-]?\s*(\d+(?:\.\d+)?)\s*(?:calendar\s*)?days"],
    }
    out: Dict[str, List[Dict[str, str]]] = {k: [] for k in fields}
    for src in _active_sources(model):
        text = src.text or ""
        for key, patterns in fields.items():
            for pat in patterns:
                for hit in re.findall(pat, text, re.I):
                    value = hit.strip() if isinstance(hit, str) else str(hit)
                    out[key].append({"value": value, "source": Path(src.path).name})
    return out


def detect_source_conflicts(model: Model) -> List[Dict[str, Any]]:
    conflicts = []
    values = _labeled_values(model)
    for field, rows in values.items():
        unique: Dict[str, List[str]] = {}
        for row in rows:
            key = re.sub(r"\s+", " ", row["value"].strip().lower())
            unique.setdefault(key, []).append(row["source"])
        if len(unique) > 1:
            conflicts.append({
                "field": field,
                "status": "RECONCILIATION_REQUIRED",
                "values": [{"value": k, "sources": sorted(set(v))} for k, v in unique.items()],
            })
    return conflicts


def _scan_visuals(input_files: Sequence[str | Path]) -> Dict[str, Any]:
    visual_exts = {".svg", ".png", ".jpg", ".jpeg", ".webp"}
    stale_tokens = {"old", "obsolete", "superseded", "previous", "archive", "legacy", "rev0", "draft"}
    visuals: List[str] = []
    stale: List[str] = []
    for item in input_files:
        p = Path(item).expanduser()
        candidates: List[Path] = []
        if p.exists() and p.is_dir():
            candidates = [x for x in p.rglob("*") if x.is_file() and x.suffix.lower() in visual_exts]
        elif p.exists() and p.is_file() and p.suffix.lower() in visual_exts:
            candidates = [p]
        for x in candidates:
            visuals.append(str(x))
            name = x.stem.lower()
            if any(tok in name for tok in stale_tokens):
                stale.append(str(x))
    return {"visual_files_found": visuals, "stale_visuals_quarantined": stale}


def _metric_value(model: Model, key: str) -> Any:
    mapping = {
        "planned_progress_pct": model.progress.get("planned"),
        "planned_progress": model.progress.get("planned"),
        "actual_progress_pct": model.progress.get("actual"),
        "actual_progress": model.progress.get("actual"),
        "variance_pct_points": model.progress.get("variance"),
        "spi_proxy": model.progress.get("spi_proxy"),
        "forecast_finish": model.metrics.get("latest_finish"),
        "current_forecast_finish": model.metrics.get("latest_finish"),
        "before_project_finish": model.metrics.get("base_finish"),
        "after_project_finish": model.metrics.get("latest_finish"),
        "gross_impact_days": model.metrics.get("gross_impact_days"),
        "overlap_days": model.metrics.get("overlap_days"),
        "net_eot_days": model.metrics.get("net_eot_days"),
    }
    if key in mapping:
        return mapping[key]
    return model.metrics.get(key)


def assess_family_evidence(model: Model, family: str, input_files: Sequence[str | Path]) -> Dict[str, Any]:
    profile = REPORT_FAMILIES[family]
    active = _active_sources(model)
    conflicts = detect_source_conflicts(model)
    source_warnings = _source_warnings(model)
    legacy = _legacy_sources(model)
    native_xer = [x for x in model.schedules if str(x.path).lower().endswith(".xer")]
    visual_scan = _scan_visuals(input_files)
    metrics = []
    for key in profile.get("required_metrics", []):
        value = _metric_value(model, key)
        metrics.append({"metric": key, "value": value, "status": "ESTABLISHED" if value not in (None, "") else "NOT_ESTABLISHED"})
    established = sum(1 for x in metrics if x["status"] == "ESTABLISHED")
    missing = [x["metric"] for x in metrics if x["status"] != "ESTABLISHED"]

    contract_pdf = [x for x in active if x.kind == "pdf" and re.search(r"contract|conditions|appendix|tender|agreement", (x.title + " " + x.text[:1000]).lower())]
    scanned_contract = [x for x in contract_pdf if any("scanned pdf" in w.lower() or "low-text" in w.lower() for w in x.warnings)]

    reader_fail = [w for w in source_warnings if "reader failed" in w.lower()]
    release = "PASS"
    reasons: List[str] = []
    if reader_fail:
        release = "FAIL_VALIDATION_ERROR"
        reasons.append("One or more evidence readers failed.")
    elif conflicts:
        release = "FAIL_SOURCE_CONFLICT"
        reasons.append("Conflicting explicitly labeled values require reconciliation.")
    elif profile.get("native_schedule_required") and not native_xer:
        release = "DRAFT_NATIVE_SCHEDULE_VERIFICATION_REQUIRED"
        reasons.append("This report family requires native schedule evidence, but no XER was parsed.")
    elif profile.get("contract_verification_relevant") and scanned_contract:
        release = "DRAFT_CONTRACT_VERIFICATION_REQUIRED"
        reasons.append("Contract text appears scanned/low-text and requires signed-PDF image verification before quotation.")
    elif established == 0 and metrics:
        release = "DRAFT_EVIDENCE_INCOMPLETE"
        reasons.append("None of the report family's controlled metrics were established from the submitted evidence.")
    elif source_warnings or missing:
        release = "PASS_WITH_WARNINGS"
        reasons.append("The report may be generated, but unresolved evidence gaps/warnings must remain disclosed.")

    return {
        "report_family": family,
        "report_title": profile["title"],
        "release_status": release,
        "release_reasons": reasons,
        "native_xer_count": len(native_xer),
        "active_source_count": len(active),
        "legacy_sources_quarantined": legacy,
        "source_conflicts": conflicts,
        "source_warnings": source_warnings,
        "controlled_metrics": metrics,
        "missing_metrics": missing,
        "evidence_hierarchy": profile.get("evidence_hierarchy", []),
        "prohibited_inferences": profile.get("prohibited_inferences", []),
        "visual_control": visual_scan,
        "global_rule_count": GOVERNANCE["global_governance_layer"]["rule_count"],
        "pipeline_layer_count": GOVERNANCE["pipeline_layer_count"],
    }



# Compatibility exports used by CHATGPT_PROJECT_REPORT_WORKFLOW_26PLUS.py
collect_inputs = BASE.collect_inputs
read_source = BASE.read_source
source_inventory = BASE.source_inventory

def build_model(src: List[Source], sch: List[Schedule], rtype: str = "auto", context: Optional[Dict[str, Any]] = None) -> Model:
    requested = normalize_report_type(rtype)
    m = BASE.build_model(src, sch, "auto" if requested == "auto" else _base_type_for(requested), _clean_context(context))
    family, conf, scores = classify_report_family(src, sch) if requested == "auto" else (requested, 1.0, {})
    m.report_type = family
    m.title = REPORT_FAMILIES[family]["title"]
    if requested == "auto":
        m.confidence = conf
    m.metrics["governance_engine_version"] = VERSION
    m.metrics["report_family"] = family
    m.metrics["report_family_classification_scores"] = scores
    m.metrics["attribution"] = ATTRIBUTION
    if context:
        for key in ("project_name", "title", "data_date", "period"):
            if context.get(key):
                setattr(m, key, context[key])
    legacy = _legacy_sources(m)
    if legacy:
        m.warnings.append("Legacy quarantine active: _combined_handoff source(s) excluded from governed current-position interpretation: " + ", ".join(legacy))
    m.warnings = list(dict.fromkeys(m.warnings))
    return m

def analyze_inputs(
    input_files: Sequence[str | Path],
    report_type: str = "auto",
    context: Optional[Dict[str, Any]] = None,
    strict: bool = False,
) -> Model:
    requested = normalize_report_type(report_type)
    base_model = BASE.analyze_inputs(
        input_files=input_files,
        report_type="auto" if requested == "auto" else _base_type_for(requested),
        context=_clean_context(context),
        strict=strict,
    )
    family, conf, scores = classify_report_family(base_model.sources, base_model.schedules) if requested == "auto" else (requested, 1.0, {})
    base_model.report_type = family
    base_model.title = REPORT_FAMILIES[family]["title"]
    base_model.confidence = conf if requested == "auto" else base_model.confidence
    base_model.metrics["governance_engine_version"] = VERSION
    base_model.metrics["report_family"] = family
    base_model.metrics["report_family_classification_scores"] = scores
    base_model.metrics["attribution"] = ATTRIBUTION
    if context:
        for key in ("project_name", "title", "data_date", "period"):
            if context.get(key):
                setattr(base_model, key, context[key])
    legacy = _legacy_sources(base_model)
    if legacy:
        base_model.warnings.append("Legacy quarantine active: _combined_handoff source(s) excluded from governed current-position interpretation: " + ", ".join(legacy))
    base_model.warnings = list(dict.fromkeys(base_model.warnings))
    return base_model


# --------------------------- governed slide design ------------------------

def _base_branding(config_path: Optional[str | Path] = None) -> Dict[str, Any]:
    b = BASE.branding(config_path)
    b["prepared_by"] = AUTHOR
    b["footer_right"] = ATTRIBUTION
    return b


class GovernedDesigner:
    def __init__(self, model: Model, family: str, assessment: Dict[str, Any], branding: Dict[str, Any]):
        self.m = model
        self.family = family
        self.p = REPORT_FAMILIES[family]
        self.a = assessment
        self.b = branding
        self.t = THEME

    def base(self, kicker: str, title: str, status: str = "GOVERNED") -> Slide:
        z = Slide(title); a = z.add; t = self.t
        a(E("rect",0,0,W,H,fill=t["bg"],stroke=t["bg"]))
        a(E("rect",0,0,W,100,fill=t["navy"],stroke=t["navy"]))
        a(E("text",42,16,1360,24,kicker.upper(),fs=18,color=t["gold"],bold=True,valign="middle"))
        a(E("text",42,45,1400,42,title,fs=31,color=t["white"],bold=True,valign="middle"))
        a(E("rect",1510,18,370,64,fill="#071F3B",stroke="#8096AE",sw=2,radius=12))
        a(E("text",1525,27,340,22,status,fs=16,color=t["gold"],bold=True,align="center",valign="middle"))
        a(E("text",1525,52,340,20,self.m.data_date or self.m.period or "Evidence-controlled",fs=14,color=t["white"],bold=True,align="center",valign="middle"))
        a(E("rect",0,1016,W,64,fill="#031E39",stroke="#031E39"))
        a(E("text",28,1030,690,26,f"{self.m.project_name} | {self.p['id']}",fs=16,color=t["white"],bold=True,valign="middle"))
        a(E("text",820,1027,1060,30,ATTRIBUTION,fs=17,color=t["gold"],bold=True,align="right",valign="middle"))
        return z

    def header(self, z: Slide, x: float, y: float, w: float, text: str, color: Optional[str] = None):
        c = color or self.t["navy2"]
        z.add(E("rect",x,y,w,44,fill=c,stroke=c,radius=10))
        z.add(E("text",x+14,y+6,w-28,30,text,fs=20,color=self.t["white"],bold=True,valign="middle"))

    def bullets(self, z: Slide, x: float, y: float, w: float, items: Sequence[str], max_items: int = 8, fs: int = 17, gap: int = 60):
        for i, q in enumerate(list(items)[:max_items], 1):
            yy = y + (i-1)*gap
            z.add(E("circle",x,yy,32,32,fill=self.t["navy2"],stroke=self.t["navy2"]))
            z.add(E("text",x,yy+1,32,30,str(i),fs=14,color=self.t["white"],bold=True,align="center",valign="middle"))
            z.add(E("text",x+44,yy-4,w-44,gap-4,str(q),fs=fs,color=self.t["ink"],valign="top"))

    def executive(self) -> Slide:
        z = self.base("UNIVERSAL GOVERNANCE + REPORT-SPECIFIC RULEBOOK", f"{self.p['title'].upper()} — EXECUTIVE CONTROL", self.a["release_status"])
        metrics = [
            ("REPORT FAMILY", self.p["id"], self.family),
            ("GLOBAL RULES", str(GOVERNANCE["global_governance_layer"]["rule_count"]), "preserved"),
            ("PIPELINE LAYERS", str(GOVERNANCE["pipeline_layer_count"]), "controlled"),
            ("SOURCES", str(self.a["active_source_count"]), "active"),
            ("NATIVE XER", str(self.a["native_xer_count"]), "governing schedule"),
            ("RELEASE", self.a["release_status"].replace("_"," "), "validation gate"),
        ]
        cw=(1876-14*5)/6
        for i,(label,val,sub) in enumerate(metrics):
            x=22+i*(cw+14); z.add(E("rect",x,118,cw,92,fill=self.t["white"],stroke=self.t["border"],sw=2,radius=12))
            z.add(E("text",x+12,130,cw-24,18,label,fs=13,color=self.t["muted"],bold=True,align="center"))
            z.add(E("text",x+10,154,cw-20,32,val,fs=15 if label=="RELEASE" else 22,color=self.t["navy"],bold=True,align="center",valign="middle"))
            z.add(E("text",x+10,188,cw-20,16,sub,fs=11,color=self.t["muted"],align="center"))
        self.header(z,22,236,1180,"GOVERNING CHAIN")
        z.add(E("rect",22,282,1180,248,fill=self.t["white"],stroke=self.t["border"],sw=2))
        chain = "  →  ".join(self.p["governing_chain"])
        z.add(E("text",54,318,1116,172,chain,fs=24,color=self.t["navy"],bold=True,align="center",valign="middle"))
        self.header(z,1230,236,648,"RELEASE POSITION")
        z.add(E("rect",1230,282,648,248,fill=self.t["pale_green"] if self.a["release_status"].startswith("PASS") else self.t["pale_orange"],stroke=self.t["green"] if self.a["release_status"].startswith("PASS") else self.t["orange"],sw=3))
        z.add(E("text",1260,316,588,52,self.a["release_status"].replace("_"," "),fs=27,color=self.t["green"] if self.a["release_status"].startswith("PASS") else self.t["orange"],bold=True,align="center",valign="middle"))
        reasons=self.a["release_reasons"] or ["No blocking automated release issue identified. Final professional review still governs formal issue."]
        self.bullets(z,1260,392,560,reasons,max_items=3,fs=16,gap=58)
        self.header(z,22,560,1856,"EVIDENCE-FIRST MANAGEMENT READING")
        z.add(E("rect",22,606,1856,370,fill=self.t["white"],stroke=self.t["border"],sw=2))
        read=[
            f"The report is governed by the universal 26-rule layer plus independent family rulebook {self.p['id']}.",
            "Missing values are left as NOT ESTABLISHED rather than inferred.",
            "Native technical evidence retains precedence over supporting extracts, visuals and ML outputs.",
            f"{len(self.a['source_conflicts'])} source reconciliation issue(s) and {len(self.a['missing_metrics'])} controlled metric gap(s) are currently recorded.",
            "Formal contractual or management conclusions remain subject to the report-family release gates and professional review.",
        ]
        self.bullets(z,52,640,1780,read,max_items=6,fs=19,gap=61)
        return z

    def governance(self) -> Slide:
        z = self.base("UNIVERSAL GOVERNANCE LAYER", "26 GLOBAL RULES — CONTROLLED AND PRESERVED", "GLOBAL RULEBOOK")
        rules = GOVERNANCE["global_governance_layer"]["rules"]
        for col in range(2):
            x=30+col*945; self.header(z,x,124,910,f"GLOBAL RULES {1+col*13:02d}–{13+col*13:02d}")
            z.add(E("rect",x,170,910,810,fill=self.t["white"],stroke=self.t["border"],sw=2))
            for i,rule in enumerate(rules[col*13:(col+1)*13]):
                yy=190+i*59
                z.add(E("text",x+18,yy,72,22,rule["id"],fs=14,color=self.t["gold"],bold=True,valign="middle"))
                z.add(E("text",x+90,yy,790,50,rule["title"]+": "+rule["text"],fs=12.6,color=self.t["ink"],valign="top"))
        return z

    def pipeline(self) -> Slide:
        z=self.base("CONTROLLED PROCESSING ARCHITECTURE", "32-LAYER PROJECT REPORT PIPELINE", "32 LAYERS")
        layers=GOVERNANCE["pipeline_layers"]
        for col in range(4):
            x=24+col*472; self.header(z,x,124,448,f"LAYERS {1+col*8:02d}–{8+col*8:02d}")
            z.add(E("rect",x,170,448,808,fill=self.t["white"],stroke=self.t["border"],sw=2))
            for i,row in enumerate(layers[col*8:(col+1)*8]):
                yy=190+i*94
                z.add(E("circle",x+16,yy+4,34,34,fill=self.t["navy2"],stroke=self.t["navy2"]))
                z.add(E("text",x+16,yy+5,34,31,str(row["layer"]),fs=13,color=self.t["white"],bold=True,align="center",valign="middle"))
                z.add(E("text",x+62,yy,360,24,row["name"],fs=15,color=self.t["navy"],bold=True))
                z.add(E("text",x+62,yy+27,360,56,row["purpose"],fs=12.5,color=self.t["ink"]))
        return z

    def family_rulebook(self) -> Slide:
        z=self.base("INDEPENDENT REPORT-FAMILY RULEBOOK", f"{self.p['id']} — {self.p['title']}", "FAMILY RULEBOOK")
        self.header(z,30,124,900,"REPORT-SPECIFIC RULES")
        z.add(E("rect",30,170,900,805,fill=self.t["white"],stroke=self.t["border"],sw=2))
        self.bullets(z,52,194,850,self.p["rules"],max_items=12,fs=15,gap=61)
        self.header(z,960,124,930,"PROHIBITED INFERENCES")
        z.add(E("rect",960,170,930,356,fill=self.t["pale_red"],stroke=self.t["red"],sw=2))
        self.bullets(z,984,198,870,self.p["prohibited_inferences"],max_items=6,fs=16,gap=58)
        self.header(z,960,548,930,"EVIDENCE HIERARCHY")
        z.add(E("rect",960,594,930,381,fill=self.t["white"],stroke=self.t["border"],sw=2))
        self.bullets(z,984,620,870,self.p["evidence_hierarchy"],max_items=7,fs=16,gap=49)
        return z

    def metrics_and_tables(self) -> Slide:
        z=self.base("REPORT-CONTENT CONTROL", "CONTROLLED METRICS, TABLES AND VISUALS", "CONTENT MATRIX")
        columns=[("CONTROLLED METRICS",self.a["controlled_metrics"]), ("REQUIRED TABLES",self.p["required_tables"]), ("REQUIRED VISUALS",self.p["required_visuals"])]
        for ci,(title,items) in enumerate(columns):
            x=25+ci*630; self.header(z,x,124,600,title)
            z.add(E("rect",x,170,600,806,fill=self.t["white"],stroke=self.t["border"],sw=2))
            if ci==0:
                for i,row in enumerate(items[:13]):
                    yy=190+i*56; status=row["status"]
                    z.add(E("text",x+18,yy,330,44,row["metric"],fs=14,color=self.t["ink"],bold=True,valign="middle"))
                    z.add(E("text",x+350,yy,112,44,str(row["value"]) if row["value"] not in (None,"") else "—",fs=14,color=self.t["navy"],align="center",valign="middle"))
                    z.add(E("text",x+466,yy,112,44,status,fs=11.5,color=self.t["green"] if status=="ESTABLISHED" else self.t["orange"],bold=True,align="center",valign="middle"))
            else:
                self.bullets(z,x+22,196,550,[str(q) for q in items],max_items=12,fs=15,gap=60)
        return z

    def evidence_control(self) -> Slide:
        z=self.base("SOURCE TRACEABILITY & EVIDENCE CONTROL", "EVIDENCE INTEGRITY, CONFLICTS AND GAPS", "EVIDENCE QA")
        self.header(z,26,124,900,"SOURCE / SCHEDULE CONTROL")
        z.add(E("rect",26,170,900,380,fill=self.t["white"],stroke=self.t["border"],sw=2))
        summary=[
            f"Active source files: {self.a['active_source_count']}",
            f"Native XER schedules: {self.a['native_xer_count']}",
            f"Legacy _combined_handoff quarantined: {len(self.a['legacy_sources_quarantined'])}",
            f"Source conflicts requiring reconciliation: {len(self.a['source_conflicts'])}",
            f"Extraction/content warnings: {len(self.a['source_warnings'])}",
            f"Stale visuals quarantined: {len(self.a['visual_control']['stale_visuals_quarantined'])}",
        ]
        self.bullets(z,54,202,840,summary,max_items=8,fs=18,gap=53)
        self.header(z,956,124,938,"MISSING / NOT ESTABLISHED")
        z.add(E("rect",956,170,938,380,fill=self.t["pale_orange"],stroke=self.t["orange"],sw=2))
        missing=self.a["missing_metrics"] or ["No controlled metric gap identified by the automated family assessment."]
        self.bullets(z,982,202,880,missing,max_items=7,fs=17,gap=51)
        self.header(z,26,582,1868,"RECONCILIATION ISSUES")
        z.add(E("rect",26,628,1868,350,fill=self.t["white"],stroke=self.t["border"],sw=2))
        if self.a["source_conflicts"]:
            rows=[]
            for c in self.a["source_conflicts"][:6]:
                vals=" | ".join(v["value"]+" ← "+", ".join(v["sources"][:2]) for v in c["values"][:3])
                rows.append(f"{c['field']}: {vals}")
            self.bullets(z,54,660,1800,rows,max_items=6,fs=16,gap=48)
        else:
            z.add(E("text",70,690,1780,120,"No conflicting explicitly labeled controlled values were automatically detected. This is not a substitute for professional reconciliation of all evidence.",fs=22,color=self.t["green"],bold=True,align="center",valign="middle"))
        return z

    def validation(self) -> Slide:
        z=self.base("VALIDATION-BEFORE-RELEASE", "REPORT-SPECIFIC VALIDATION & RELEASE GATES", self.a["release_status"])
        self.header(z,28,124,906,"VALIDATION CHECKS")
        z.add(E("rect",28,170,906,806,fill=self.t["white"],stroke=self.t["border"],sw=2))
        self.bullets(z,52,196,850,self.p["validation_checks"],max_items=12,fs=16,gap=58)
        self.header(z,960,124,930,"RELEASE GATES")
        z.add(E("rect",960,170,930,530,fill=self.t["white"],stroke=self.t["border"],sw=2))
        self.bullets(z,986,198,870,self.p["release_gate"],max_items=9,fs=17,gap=58)
        c=self.t["green"] if self.a["release_status"].startswith("PASS") else self.t["orange"] if self.a["release_status"].startswith("DRAFT") else self.t["red"]
        z.add(E("rect",960,730,930,246,fill="#FFFFFF",stroke=c,sw=4,radius=14))
        z.add(E("text",990,760,870,32,"AUTOMATED RELEASE STATUS",fs=18,color=self.t["muted"],bold=True,align="center"))
        z.add(E("text",990,808,870,58,self.a["release_status"].replace("_"," "),fs=30,color=c,bold=True,align="center",valign="middle"))
        reason="; ".join(self.a["release_reasons"]) if self.a["release_reasons"] else "No automated blocking condition detected."
        z.add(E("text",1010,876,830,72,reason,fs=16,color=self.t["ink"],align="center",valign="middle"))
        return z

    def build(self) -> List[Slide]:
        slides=[self.executive()]
        # Preserve specialized base views where they are technically meaningful.
        if self.family in {"eot","delay","progress","variation"}:
            original=self.m.report_type
            self.m.report_type=self.family
            try:
                slides += BASE.Designer(self.m,self.b).build()
            finally:
                self.m.report_type=original
        slides += [self.family_rulebook(), self.metrics_and_tables(), self.evidence_control(), self.pipeline(), self.governance(), self.validation()]
        return slides


# --------------------------- package generation ---------------------------

def _governance_validation(slides: List[Slide], assessment: Dict[str, Any]) -> Dict[str, Any]:
    layout = BASE.validate(slides)
    result = {
        "engine_version": VERSION,
        "author": AUTHOR,
        "attribution": ATTRIBUTION,
        "report_family": assessment["report_family"],
        "release_status": assessment["release_status"],
        "layout_validation": layout,
        "source_conflict_count": len(assessment["source_conflicts"]),
        "legacy_quarantine_count": len(assessment["legacy_sources_quarantined"]),
        "missing_metric_count": len(assessment["missing_metrics"]),
        "native_xer_count": assessment["native_xer_count"],
        "global_rule_count": GOVERNANCE["global_governance_layer"]["rule_count"],
        "pipeline_layer_count": GOVERNANCE["pipeline_layer_count"],
        "report_family_count": GOVERNANCE["report_family_count"],
        "status": "PASS" if layout["status"] != "FAIL" else "FAIL_VALIDATION_ERROR",
    }
    if assessment["release_status"].startswith("FAIL"):
        result["status"] = assessment["release_status"]
    elif layout["status"] == "FAIL":
        result["status"] = "FAIL_VALIDATION_ERROR"
    elif assessment["release_status"].startswith("DRAFT"):
        result["status"] = assessment["release_status"]
    elif layout["warnings"] or assessment["release_status"] == "PASS_WITH_WARNINGS":
        result["status"] = "PASS_WITH_WARNINGS"
    return result


def generate_report(
    input_files: Sequence[str | Path],
    output_directory: str | Path,
    report_type: str = "auto",
    config_path: Optional[str | Path] = None,
    context: Optional[Dict[str, Any]] = None,
    context_path: Optional[str | Path] = None,
    strict: bool = False,
    keep_working: bool = False,
) -> Dict[str, Any]:
    if context_path:
        context = load_json(context_path)
    requested = normalize_report_type(report_type)
    model = analyze_inputs(input_files, requested, context, strict=strict)
    family = model.report_type
    assessment = assess_family_evidence(model, family, input_files)

    out = Path(output_directory).expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)
    svgdir=out/'SVG_EDITABLE'; pngdir=out/'PNG_HIGH_RES'; pptdir=out/'POWERPOINT'; pdfdir=out/'PDF_A4_LANDSCAPE'; datadir=out/'PROJECT_INTELLIGENCE'; vdir=out/'VALIDATION'; previewdir=out/'PREVIEW'; htmldir=out/'HTML'; govdir=out/'GOVERNANCE'
    for p in [svgdir,pngdir,pptdir,pdfdir,datadir,vdir,previewdir,htmldir,govdir]: p.mkdir(parents=True, exist_ok=True)

    designer=GovernedDesigner(model,family,assessment,_base_branding(config_path))
    slides=designer.build()
    governed_validation=_governance_validation(slides,assessment)
    if strict and governed_validation["status"].startswith("FAIL"):
        raise RuntimeError("Governed validation failed: "+json.dumps(governed_validation,ensure_ascii=False))

    svgs=[]
    for i,z in enumerate(slides,1):
        p=svgdir/f'{i:02d}_{BASE.slug(z.title)}.svg'; BASE.render_svg(z,p); svgs.append(p)
    editable=pptdir/f'{family.upper()}_Report_EDITABLE.pptx'; BASE.render_ppt(slides,editable)
    pngs=BASE.render_pngs(svgs,pngdir)
    pngppt=pptdir/f'{family.upper()}_Report_PNG.pptx'; BASE.render_png_ppt(pngs,pngppt)
    pdf=pdfdir/f'{family.upper()}_Report_A4_Landscape_FULL_BLEED.pdf'; BASE.render_pdf(pngs,pdf)
    contact=previewdir/f'{family.upper()}_Report_Contact_Sheet.png'; BASE.create_contact_sheet(pngs,contact)
    gallery=htmldir/f'{family.upper()}_Report_Gallery.html'; BASE.create_html_gallery(pngs,gallery)

    project_payload=asdict(model)
    project_payload["author"]=AUTHOR; project_payload["attribution"]=ATTRIBUTION; project_payload["governance_engine_version"]=VERSION
    modelp=save_json(datadir/'project_model.json',project_payload)
    inventory=[]
    for row in BASE.source_inventory(model.sources):
        row["legacy_quarantined"] = "_combined_handoff" in str(row.get("file_name","")).lower()
        inventory.append(row)
    inventoryp=save_json(datadir/'source_inventory.json',inventory)
    assessmentp=save_json(datadir/'report_family_evidence_assessment.json',assessment)
    save_json(govdir/'UNIVERSAL_26_RULES.json', GOVERNANCE["global_governance_layer"])
    save_json(govdir/'REPORT_FAMILY_RULEBOOK.json', {"family":family, **REPORT_FAMILIES[family]})
    save_json(govdir/'32_LAYER_PIPELINE.json', {"pipeline_layer_count":GOVERNANCE["pipeline_layer_count"],"pipeline_layers":GOVERNANCE["pipeline_layers"]})
    save_json(govdir/'FULL_GOVERNANCE_REGISTRY.json', GOVERNANCE)
    valp=save_json(vdir/'governed_validation_report.json', governed_validation)

    summary=(
        f"{ATTRIBUTION}\n"
        f"Engine version: {VERSION}\nAuthor: {AUTHOR}\nProject: {model.project_name}\n"
        f"Report family: {family} — {REPORT_FAMILIES[family]['title']}\n"
        f"Global governance rules: {GOVERNANCE['global_governance_layer']['rule_count']}\n"
        f"Independent report families: {GOVERNANCE['report_family_count']}\n"
        f"Processing layers: {GOVERNANCE['pipeline_layer_count']}\n"
        f"Release status: {assessment['release_status']}\n"
        f"Validation status: {governed_validation['status']}\n"
        f"Native XER schedules: {assessment['native_xer_count']}\n"
        f"Source conflicts: {len(assessment['source_conflicts'])}\n"
        f"Missing controlled metrics: {len(assessment['missing_metrics'])}\n"
        f"Slides: {len(slides)}\n"
    )
    (vdir/'REPORT_GENERATION_SUMMARY.txt').write_text(summary,encoding='utf-8')

    manifestp=out/'ENGINE_RUN_MANIFEST.json'
    manifest={
        "package_identity":"Universal Project Report Engine 26+ Governed Edition",
        "engine_version":VERSION,"base_engine_version":getattr(BASE,"VERSION","unknown"),
        "author":AUTHOR,"attribution":ATTRIBUTION,"generated_at":datetime.now().isoformat(timespec="seconds"),
        "project_name":model.project_name,"report_family":family,"report_title":REPORT_FAMILIES[family]["title"],
        "global_rule_count":GOVERNANCE["global_governance_layer"]["rule_count"],
        "report_family_count":GOVERNANCE["report_family_count"],"pipeline_layer_count":GOVERNANCE["pipeline_layer_count"],
        "release_status":assessment["release_status"],"validation_status":governed_validation["status"],"files":[]
    }
    for f in sorted(out.rglob('*')):
        if f.is_file() and f!=manifestp:
            manifest["files"].append({"path":str(f.relative_to(out)),"size_bytes":f.stat().st_size,"sha256":file_sha256(f)})
    save_json(manifestp,manifest)

    zp=out.parent/f'{out.name}_FULL_PACKAGE.zip'; zp.unlink(missing_ok=True)
    with zipfile.ZipFile(zp,'w',zipfile.ZIP_DEFLATED) as zf:
        for f in out.rglob('*'):
            if f.is_file(): zf.write(f,f.relative_to(out.parent))

    return {
        "status":"completed","engine_version":VERSION,"author":AUTHOR,"attribution":ATTRIBUTION,
        "project_name":model.project_name,"report_family":family,"report_title":REPORT_FAMILIES[family]["title"],
        "release_status":assessment["release_status"],"validation_status":governed_validation["status"],
        "global_rule_count":GOVERNANCE["global_governance_layer"]["rule_count"],
        "report_family_count":GOVERNANCE["report_family_count"],"pipeline_layer_count":GOVERNANCE["pipeline_layer_count"],
        "editable_powerpoint":str(editable),"png_powerpoint":str(pngppt),"pdf":str(pdf),
        "svg_directory":str(svgdir),"png_directory":str(pngdir),"html_gallery":str(gallery),"contact_sheet":str(contact),
        "project_model":str(modelp),"source_inventory":str(inventoryp),"evidence_assessment":str(assessmentp),
        "governance_directory":str(govdir),"validation":str(valp),"manifest":str(manifestp),"package_zip":str(zp),
        "slide_count":len(slides),"warnings":_source_warnings(model),
    }


def list_report_families() -> List[Dict[str, Any]]:
    return [{"key":k,"id":v["id"],"title":v["title"],"native_schedule_required":bool(v.get("native_schedule_required")),"rule_count":len(v.get("rules",[]))} for k,v in REPORT_FAMILIES.items()]


def self_test() -> Dict[str, Any]:
    errors=[]
    if GOVERNANCE.get("global_governance_layer",{}).get("rule_count") != 26: errors.append("Global rule count is not 26")
    if GOVERNANCE.get("report_family_count",0) < 26: errors.append("Report family count is below 26")
    if GOVERNANCE.get("pipeline_layer_count",0) < 26: errors.append("Pipeline layer count is below 26")
    if len(REPORT_FAMILIES) != GOVERNANCE.get("report_family_count"): errors.append("Report-family registry count mismatch")
    if not all(v.get("rules") and v.get("validation_checks") and v.get("release_gate") for v in REPORT_FAMILIES.values()): errors.append("One or more report families lack independent rules/checks/gates")
    return {"status":"PASS" if not errors else "FAIL","engine_version":VERSION,"author":AUTHOR,"attribution":ATTRIBUTION,"global_rules":26,"report_families":len(REPORT_FAMILIES),"pipeline_layers":GOVERNANCE.get("pipeline_layer_count"),"errors":errors}


def main(argv=None) -> int:
    ap=argparse.ArgumentParser(description=f"Universal Project Report Engine 26+ Governed Edition v{VERSION}")
    ap.add_argument('--version',action='version',version=VERSION)
    sp=ap.add_subparsers(dest='cmd',required=True)

    lf=sp.add_parser('list-reports',help='List all governed report families')
    st=sp.add_parser('self-test',help='Validate governance registry and engine architecture')
    gv=sp.add_parser('governance',help='Write the full governance registry to a JSON file')
    gv.add_argument('--output',required=True)

    a=sp.add_parser('analyze',help='Analyze evidence into a normalized project model')
    a.add_argument('--input',nargs='+',required=True); a.add_argument('--output',required=True)
    a.add_argument('--report-type',default='auto',choices=sorted(ALLOWED_REPORT_TYPES)); a.add_argument('--context-json'); a.add_argument('--strict',action='store_true')

    g=sp.add_parser('generate',help='Generate a governed report package')
    g.add_argument('--input',nargs='+',required=True); g.add_argument('--output',required=True)
    g.add_argument('--report-type',default='auto',choices=sorted(ALLOWED_REPORT_TYPES)); g.add_argument('--config'); g.add_argument('--context-json'); g.add_argument('--strict',action='store_true'); g.add_argument('--keep-working',action='store_true')

    args=ap.parse_args(argv)
    if args.cmd=='list-reports': _emit({"report_family_count":len(REPORT_FAMILIES),"reports":list_report_families()}); return 0
    if args.cmd=='self-test': _emit(self_test()); return 0
    if args.cmd=='governance': save_json(args.output,GOVERNANCE); _emit({"status":"completed","output":str(Path(args.output).resolve())}); return 0
    if args.cmd=='analyze':
        context=load_json(args.context_json) if args.context_json else None
        m=analyze_inputs(args.input,args.report_type,context,strict=args.strict)
        payload=asdict(m); payload["author"]=AUTHOR; payload["attribution"]=ATTRIBUTION; payload["governance_engine_version"]=VERSION
        save_json(args.output,payload); _emit({"status":"completed","output":str(Path(args.output).resolve()),"report_family":m.report_type}); return 0
    if args.cmd=='generate':
        result=generate_report(args.input,args.output,args.report_type,args.config,context_path=args.context_json,strict=args.strict,keep_working=args.keep_working)
        _emit(result); return 0
    return 1


if __name__=='__main__':
    raise SystemExit(main())
