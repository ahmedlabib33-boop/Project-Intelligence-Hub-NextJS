#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
UNIVERSAL XER ADAPTIVE ML SCHEDULE ENGINE v3.1.0
Python AI Programming by Eng. Ahmed Labib

Project-agnostic Primavera P6 XER intelligence for any project and any native data date.
The engine recognizes the schedule directly from XER tables, learns activity semantics
from the schedule itself, creates project-local CPM-labelled training scenarios, trains
an ensemble ML surrogate, and optimizes Mitigation / Recovery / Revised scenarios.

No project name, activity ID, building, discipline, or construction-method dictionary is
hardcoded into the decision path. Machine learning is the intelligence/optimization layer.
Deterministic CPM is retained only as the non-negotiable schedule-physics truth layer.
"""
from __future__ import annotations
import argparse, csv, hashlib, json, math, statistics
from collections import Counter, defaultdict
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple
import networkx as nx

AUTHOR = "Python AI Programming by Eng. Ahmed Labib"
ENGINE_NAME = "Universal XER Adaptive ML Schedule Engine"
ENGINE_VERSION = "3.1.0"

DEFAULT_CONFIG = {
    "analysis": {
        "hours_per_day_fallback": 8.0,
        "critical_corridor_float_quantile": 0.12
    },
    "universal_ml": {
        "random_seed": 42,
        "max_activity_clusters": 20,
        "duration_reduction_ratios": [0.08, 0.15, 0.22, 0.30],
        "lag_reduction_ratios": [0.25, 0.50, 0.75],
        "fast_track_overlap_fraction": 0.18,
        "minimum_remaining_duration_days": 1.0,
        "max_universal_candidates": 500,
        "synthetic_training_scenarios": 420,
        "optimizer_population": 42,
        "optimizer_generations": 10,
        "optimizer_max_actions": 18
    }
}

def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")

def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return default if value in (None, "") else float(value)
    except Exception:
        return default

def _parse_dt(value: Any) -> Optional[datetime]:
    if not value: return None
    s=str(value).strip()
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try: return datetime.strptime(s,fmt)
        except ValueError: pass
    return None

def _sha256(path: Path) -> str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()

def _json_dump(path: Path, obj: Any) -> None:
    path.write_text(json.dumps(obj,indent=2,ensure_ascii=False,default=str),encoding='utf-8')

def _write_csv(path: Path, rows: Sequence[Dict[str, Any]]) -> None:
    rows=list(rows)
    if not rows:
        path.write_text('',encoding='utf-8'); return
    headers=[]; seen=set()
    for row in rows:
        for k in row:
            if k not in seen: seen.add(k); headers.append(k)
    with path.open('w',newline='',encoding='utf-8-sig') as f:
        w=csv.DictWriter(f,fieldnames=headers,extrasaction='ignore'); w.writeheader(); w.writerows(rows)

def deep_merge(base: Dict[str,Any], override: Dict[str,Any]) -> Dict[str,Any]:
    out=json.loads(json.dumps(base))
    for k,v in (override or {}).items():
        out[k]=deep_merge(out[k],v) if isinstance(v,dict) and isinstance(out.get(k),dict) else v
    return out

class XERParser:
    def __init__(self,path:Path):
        self.path=Path(path); self.tables=defaultdict(list); self.headers={}; self.encoding='cp1252'
    def parse(self):
        if not self.path.exists(): raise FileNotFoundError(self.path)
        for enc in ('utf-8-sig','cp1252','latin-1'):
            try:
                with self.path.open('r',encoding=enc,errors='strict') as f: f.readline()
                self.encoding=enc; break
            except Exception: pass
        current=None; fields=[]
        with self.path.open('r',encoding=self.encoding,errors='replace') as f:
            for raw in f:
                parts=raw.rstrip('\r\n').split('\t')
                if not parts: continue
                marker=parts[0]
                if marker=='%T' and len(parts)>1: current=parts[1]; fields=[]
                elif marker=='%F' and current: fields=parts[1:]; self.headers[current]=fields
                elif marker=='%R' and current and fields:
                    vals=parts[1:]+['']*max(0,len(fields)-len(parts[1:])); self.tables[current].append(dict(zip(fields,vals)))
        return self

@dataclass
class Candidate:
    candidate_id: str
    action_type: str
    task_id: str
    activity_id: str
    activity_name: str
    wbs_path: str
    category: str
    current_remaining_days: float
    proposed_remaining_days: float
    nominal_reduction_days: float
    individual_shadow_gain_days: float
    confidence: str
    risk: str
    priority_score: float
    strategy: str
    validation: str
    resource_names: str = ""
    relationship: str = ""
    notes: str = ""
    modification: Optional[Dict[str, Any]] = None

    def row(self) -> Dict[str, Any]:
        d = asdict(self)
        d.pop("modification", None)
        return d


class ScheduleModel:
    def __init__(self, parser: XERParser, config: Dict[str, Any], project_hint: Optional[str] = None):
        self.parser = parser
        self.config = config
        self.tables = parser.tables
        self.project = self._select_project(project_hint)
        self.proj_id = self.project.get("proj_id", "")
        self.calendars = {r.get("clndr_id", ""): r for r in self.tables.get("CALENDAR", [])}
        self.hours_per_day = self._resolve_hours_per_day()
        self.wbs_rows = {r.get("wbs_id", ""): r for r in self.tables.get("PROJWBS", []) if r.get("proj_id") == self.proj_id}
        self.tasks = {r.get("task_id", ""): r for r in self.tables.get("TASK", []) if r.get("proj_id") == self.proj_id}
        self.relationships = [r for r in self.tables.get("TASKPRED", []) if r.get("task_id") in self.tasks and r.get("pred_task_id") in self.tasks]
        self.resources = {r.get("rsrc_id", ""): r for r in self.tables.get("RSRC", [])}
        self.assignments = [r for r in self.tables.get("TASKRSRC", []) if r.get("task_id") in self.tasks]
        self.assignments_by_task: Dict[str, List[Dict[str, str]]] = defaultdict(list)
        for r in self.assignments:
            self.assignments_by_task[r.get("task_id", "")].append(r)
        self.activity_codes = {r.get("actv_code_id", ""): r for r in self.tables.get("ACTVCODE", [])}
        self.activity_code_types = {r.get("actv_code_type_id", ""): r for r in self.tables.get("ACTVTYPE", [])}
        self.task_activity_codes: Dict[str, List[Dict[str, str]]] = defaultdict(list)
        for r in self.tables.get("TASKACTV", []):
            if r.get("task_id") in self.tasks:
                self.task_activity_codes[r.get("task_id", "")].append(r)
        self.graph = nx.DiGraph()
        self.graph.add_nodes_from(self.tasks)
        # Primavera can store more than one relationship (for example SS + FF)
        # between the same activity pair. Preserve every native relationship and
        # evaluate the strongest active precedence constraint in shadow CPM.
        for rel in self.relationships:
            u, v = rel.get("pred_task_id"), rel.get("task_id")
            if self.graph.has_edge(u, v):
                self.graph.edges[u, v].setdefault("rels", []).append(rel)
            else:
                self.graph.add_edge(u, v, rels=[rel])
        self.terminal_task_id = self._find_terminal_task()
        self._is_dag = nx.is_directed_acyclic_graph(self.graph)
        self._topological_order = list(nx.topological_sort(self.graph)) if self._is_dag else []
        self.base_durations = self._duration_map()
        self.base_lags = {self._rel_key(r): self._lag_days(r) for r in self.relationships}
        self.base_shadow = self.shadow_cpm()

    def _select_project(self, project_hint: Optional[str]) -> Dict[str, str]:
        projects = self.tables.get("PROJECT", [])
        if not projects:
            raise ValueError("No PROJECT table found in XER")
        counts = Counter(r.get("proj_id") for r in self.tables.get("TASK", []))
        if project_hint:
            h = project_hint.lower()
            matches = [p for p in projects if h in str(p.get("proj_id", "")).lower() or h in p.get("proj_short_name", "").lower()]
            if matches:
                return max(matches, key=lambda p: counts.get(p.get("proj_id"), 0))
        return max(projects, key=lambda p: counts.get(p.get("proj_id"), 0))

    def _resolve_hours_per_day(self) -> float:
        cid = self.project.get("clndr_id")
        cal = next((r for r in self.tables.get("CALENDAR", []) if r.get("clndr_id") == cid), None)
        h = _safe_float(cal.get("day_hr_cnt") if cal else None, 0)
        return h if h > 0 else float(self.config["analysis"].get("hours_per_day_fallback", 8.0))

    def wbs_path(self, wbs_id: str) -> str:
        parts = []
        seen = set()
        wid = wbs_id
        while wid and wid in self.wbs_rows and wid not in seen:
            seen.add(wid)
            row = self.wbs_rows[wid]
            parts.append(row.get("wbs_name") or row.get("wbs_short_name") or wid)
            wid = row.get("parent_wbs_id", "")
        return " > ".join(reversed(parts))

    def resource_names(self, task_id: str) -> List[str]:
        names = []
        for a in self.assignments_by_task.get(task_id, []):
            r = self.resources.get(a.get("rsrc_id", ""), {})
            name = r.get("rsrc_name") or r.get("rsrc_short_name")
            if name and name not in names:
                names.append(name)
        return names

    def task_codes(self, task_id: str) -> List[str]:
        out = []
        for x in self.task_activity_codes.get(task_id, []):
            cv = self.activity_codes.get(x.get("actv_code_id", ""), {})
            ct = self.activity_code_types.get(x.get("actv_code_type_id", ""), {})
            if cv:
                out.append(f"{ct.get('actv_code_type','Code')}={cv.get('short_name') or cv.get('actv_code_name')}")
        return out

    def _find_terminal_task(self) -> str:
        tasks = list(self.tasks.values())
        explicit = [t for t in tasks if "project finish" in (t.get("task_name", "") + " " + t.get("task_code", "")).lower()]
        if explicit:
            return max(explicit, key=lambda t: _parse_dt(t.get("early_end_date")) or datetime.min).get("task_id", "")
        milestones = [t for t in tasks if t.get("task_type") in {"TT_FinMile", "TT_Mile"} and t.get("status_code") != "TK_Complete"]
        if milestones:
            return max(milestones, key=lambda t: _parse_dt(t.get("early_end_date")) or datetime.min).get("task_id", "")
        sinks = [n for n in self.graph.nodes if self.graph.out_degree(n) == 0]
        if sinks:
            return max(sinks, key=lambda tid: _parse_dt(self.tasks[tid].get("early_end_date")) or datetime.min)
        return next(iter(self.tasks))

    def _duration_days(self, task: Dict[str, str]) -> float:
        if task.get("status_code") == "TK_Complete":
            return 0.0
        return max(0.0, _safe_float(task.get("remain_drtn_hr_cnt")) / self.hours_per_day)

    def _duration_map(self) -> Dict[str, float]:
        return {tid: self._duration_days(t) for tid, t in self.tasks.items()}

    def _lag_days(self, rel: Dict[str, str]) -> float:
        return _safe_float(rel.get("lag_hr_cnt")) / self.hours_per_day

    @staticmethod
    def _rel_key(rel: Dict[str, str]) -> str:
        return f"{rel.get('pred_task_id')}->{rel.get('task_id')}|{rel.get('pred_type')}|{rel.get('task_pred_id')}"

    def _edge_weight(self, rel: Dict[str, str], durations: Dict[str, float], lags: Dict[str, float]) -> float:
        pred = rel.get("pred_task_id", "")
        succ = rel.get("task_id", "")
        typ = rel.get("pred_type", "PR_FS")
        lag = lags.get(self._rel_key(rel), self._lag_days(rel))
        dp = durations.get(pred, 0.0)
        ds = durations.get(succ, 0.0)
        if typ == "PR_SS":
            return lag
        if typ == "PR_FF":
            return dp + lag - ds
        if typ == "PR_SF":
            return lag - ds
        return dp + lag

    def shadow_cpm(self, modifications: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        modifications = modifications or {}
        durations = dict(self.base_durations)
        lags = dict(self.base_lags)
        for tid, new_d in modifications.get("durations", {}).items():
            durations[tid] = max(0.0, float(new_d))
        for key, new_l in modifications.get("lags", {}).items():
            lags[key] = float(new_l)

        if not getattr(self, "_is_dag", nx.is_directed_acyclic_graph(self.graph)):
            raise ValueError("Schedule relationship graph contains cycles; shadow CPM requires an acyclic project network")
        topo = getattr(self, "_topological_order", None) or list(nx.topological_sort(self.graph))
        start = {n: 0.0 for n in topo}
        parent: Dict[str, Optional[str]] = {n: None for n in topo}
        parent_rel: Dict[str, Optional[str]] = {n: None for n in topo}
        for u in topo:
            for v in self.graph.successors(u):
                rels = self.graph.edges[u, v].get("rels", [])
                if not rels:
                    continue
                weighted = [(self._edge_weight(rel, durations, lags), rel) for rel in rels]
                edge_weight, controlling_rel = max(weighted, key=lambda x: x[0])
                cand = start[u] + edge_weight
                if cand > start[v] + 1e-9:
                    start[v] = cand
                    parent[v] = u
                    parent_rel[v] = self._rel_key(controlling_rel)
        terminal = self.terminal_task_id
        finish = start.get(terminal, 0.0) + durations.get(terminal, 0.0)
        path = []
        cur: Optional[str] = terminal
        seen = set()
        while cur and cur not in seen:
            seen.add(cur)
            path.append(cur)
            cur = parent.get(cur)
        path.reverse()
        return {
            "terminal_task_id": terminal,
            "network_length_days": round(finish, 3),
            "path_task_ids": path,
            "start_offsets": start,
            "parent": parent,
            "parent_relationship": parent_rel,
            "durations": durations,
            "lags": lags,
        }

    def recovery_need(self) -> Dict[str, Any]:
        t = self.tasks.get(self.terminal_task_id, {})
        forecast = _parse_dt(t.get("early_end_date")) or _parse_dt(self.project.get("scd_end_date"))
        deadline = _parse_dt(t.get("cstr_date")) or _parse_dt(t.get("late_end_date"))
        source = "terminal constraint date" if t.get("cstr_date") else "terminal late finish" if t.get("late_end_date") else "negative total float"
        if forecast and deadline and forecast > deadline:
            return {
                "forecast_finish": forecast.isoformat(sep=" ", timespec="minutes"),
                "required_finish": deadline.isoformat(sep=" ", timespec="minutes"),
                "required_recovery_calendar_days": round((forecast-deadline).total_seconds()/86400, 2),
                "basis": source,
            }
        tf = self.terminal_float_days()
        return {
            "forecast_finish": t.get("early_end_date") or self.project.get("scd_end_date"),
            "required_finish": t.get("late_end_date") or t.get("cstr_date") or "Not evidenced",
            "required_recovery_calendar_days": round(max(0.0, -tf), 2),
            "basis": "negative total float" if tf < 0 else "no evidenced recovery requirement",
        }

    def terminal_float_days(self) -> float:
        return _safe_float(self.tasks.get(self.terminal_task_id, {}).get("total_float_hr_cnt")) / self.hours_per_day

    def critical_corridor_ids(self) -> List[str]:
        cfg = self.config["analysis"]
        incom = [t for t in self.tasks.values() if t.get("status_code") != "TK_Complete"]
        floats = sorted(_safe_float(t.get("total_float_hr_cnt")) / self.hours_per_day for t in incom)
        q = float(cfg.get("critical_corridor_float_quantile", 0.12))
        idx = max(0, min(len(floats)-1, int((len(floats)-1) * q))) if floats else 0
        quantile_cut = floats[idx] if floats else 0.0
        terminal_anc = nx.ancestors(self.graph, self.terminal_task_id) | {self.terminal_task_id}
        shadow_path = set(self.base_shadow.get("path_task_ids", []))
        out = []
        for t in incom:
            tid = t.get("task_id", "")
            tf = _safe_float(t.get("total_float_hr_cnt")) / self.hours_per_day
            driving = t.get("driving_path_flag") == "Y"
            if tid not in terminal_anc:
                continue
            if tid in shadow_path or driving or tf <= quantile_cut:
                out.append(tid)
        return out


    def _individual_gain(self, modification: Dict[str, Any]) -> float:
        trial=self.shadow_cpm(modification)
        return max(0.0, float(self.base_shadow["network_length_days"])-float(trial["network_length_days"]))

# v3 UNIVERSAL ADAPTIVE ML SCHEDULE INTELLIGENCE
# =============================================================================

def schedule_data_date(model: ScheduleModel) -> Optional[datetime]:
    """Resolve the native project data date without any project-specific assumptions."""
    candidates = [
        model.project.get("last_recalc_date"),
        model.project.get("apply_actuals_date"),
        model.project.get("next_data_date"),
        model.project.get("last_tasksum_date"),
    ]
    for value in candidates:
        dt = _parse_dt(value)
        if dt and dt.year > 1900:
            return dt
    actuals = []
    for task in model.tasks.values():
        for key in ("act_end_date", "act_start_date", "restart_date", "reend_date"):
            dt = _parse_dt(task.get(key))
            if dt and dt.year > 1900:
                actuals.append(dt)
    return max(actuals) if actuals else None


def universal_schedule_profile(model: ScheduleModel) -> Dict[str, Any]:
    """Create a project/data-date neutral schedule fingerprint."""
    dd = schedule_data_date(model)
    tasks = list(model.tasks.values())
    status = Counter(t.get("status_code", "UNKNOWN") for t in tasks)
    types = Counter(t.get("task_type", "UNKNOWN") for t in tasks)
    durs = [model._duration_days(t) for t in tasks if model._duration_days(t) > 0]
    tfs = [_safe_float(t.get("total_float_hr_cnt"))/model.hours_per_day for t in tasks if t.get("total_float_hr_cnt") not in (None,"")]
    positive_lags = [model._lag_days(r) for r in model.relationships if model._lag_days(r) > 0]
    assigned = sum(1 for tid in model.tasks if model.assignments_by_task.get(tid))
    constrained = sum(1 for t in tasks if t.get("cstr_type") or t.get("cstr_type2"))
    complete = status.get("TK_Complete", 0)
    active = status.get("TK_Active", 0)
    notstarted = max(0, len(tasks)-complete-active)
    progress_ratio = complete / max(1, len(tasks))
    rec = model.recovery_need()
    return {
        "engine_version": ENGINE_VERSION,
        "project": {
            "proj_id": model.proj_id,
            "project_name": model.project.get("proj_short_name"),
            "data_date": dd.isoformat(sep=" ", timespec="minutes") if dd else None,
            "plan_start": model.project.get("plan_start_date"),
            "scheduled_finish": model.project.get("scd_end_date"),
            "terminal_activity_id": model.tasks.get(model.terminal_task_id,{}).get("task_code"),
            "terminal_activity_name": model.tasks.get(model.terminal_task_id,{}).get("task_name"),
            "hours_per_day": model.hours_per_day,
        },
        "network": {
            "activities": len(tasks),
            "relationships": len(model.relationships),
            "wbs_nodes": len(model.wbs_rows),
            "resource_assignments": len(model.assignments),
            "resource_coverage_pct": round(100*assigned/max(1,len(tasks)),2),
            "constraints": constrained,
            "is_dag": nx.is_directed_acyclic_graph(model.graph),
            "shadow_network_days": model.base_shadow.get("network_length_days"),
            "critical_corridor_count": len(model.critical_corridor_ids()),
        },
        "status": {
            "complete": complete,
            "active": active,
            "not_started_or_other": notstarted,
            "physical_progress_proxy_pct": round(100*progress_ratio,2),
            "status_codes": dict(status),
            "task_types": dict(types),
        },
        "distribution": {
            "remaining_duration_median_days": round(statistics.median(durs),3) if durs else 0.0,
            "remaining_duration_p90_days": round(sorted(durs)[int(0.9*(len(durs)-1))],3) if durs else 0.0,
            "total_float_median_days": round(statistics.median(tfs),3) if tfs else None,
            "positive_lag_count": len(positive_lags),
            "positive_lag_median_days": round(statistics.median(positive_lags),3) if positive_lags else 0.0,
        },
        "recovery_requirement": rec,
        "recognition": {
            "schedule_state": "progress_update" if dd and complete else "planned_or_baseline",
            "has_resources": bool(model.assignments),
            "has_activity_codes": bool(model.task_activity_codes),
            "has_wbs": bool(model.wbs_rows),
            "has_constraints": constrained > 0,
            "method": "native XER structural recognition; no project-specific dictionary required",
        },
    }


def _universal_text(model: ScheduleModel, tid: str) -> str:
    t = model.tasks[tid]
    parts = [
        t.get("task_name", ""), t.get("task_code", ""), model.wbs_path(t.get("wbs_id", "")),
        " ".join(model.resource_names(tid)), " ".join(model.task_codes(tid)),
    ]
    return " | ".join(str(x) for x in parts if x)


def learn_activity_clusters(model: ScheduleModel, max_clusters: int = 24, seed: int = 42) -> Tuple[Dict[str,int], List[Dict[str,Any]], Dict[str,Any]]:
    """Unsupervised semantic clustering. Vocabulary is learned from the uploaded XER itself."""
    try:
        import numpy as np
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.cluster import MiniBatchKMeans
        from sklearn.metrics import silhouette_score
    except Exception:
        return {tid:0 for tid in model.tasks}, [], {"status":"skipped","reason":"scikit-learn unavailable"}
    tids = list(model.tasks)
    texts = [_universal_text(model, tid) for tid in tids]
    if len(tids) < 8:
        return {tid:0 for tid in tids}, [], {"status":"single_cluster","cluster_count":1}
    vec = TfidfVectorizer(lowercase=True, ngram_range=(1,2), min_df=1, max_features=4000, sublinear_tf=True)
    X = vec.fit_transform(texts)
    upper = min(max_clusters, max(2, int(math.sqrt(len(tids))/1.3)), len(tids)-1)
    trials = sorted(set([2,3,4,6,8,12,16,upper]))
    trials = [k for k in trials if 2 <= k <= upper]
    best = None
    sample_n = min(len(tids), 700)
    sample_idx = np.linspace(0, len(tids)-1, sample_n, dtype=int)
    for k in trials:
        km = MiniBatchKMeans(n_clusters=k, random_state=seed, n_init=5, batch_size=min(512,max(64,len(tids))))
        labels = km.fit_predict(X)
        try:
            score = float(silhouette_score(X[sample_idx], labels[sample_idx], metric="cosine")) if len(set(labels[sample_idx])) > 1 else -1.0
        except Exception:
            score = -1.0
        if best is None or score > best[0]:
            best = (score, k, labels, km)
    if best is None:
        return {tid:0 for tid in tids}, [], {"status":"single_cluster","cluster_count":1}
    score,k,labels,km = best
    mapping = {tid:int(labels[i]) for i,tid in enumerate(tids)}
    rows=[]
    terms = vec.get_feature_names_out()
    for cid in range(k):
        members=[tids[i] for i,l in enumerate(labels) if int(l)==cid]
        if not members: continue
        center=km.cluster_centers_[cid]
        top_idx=center.argsort()[-8:][::-1]
        durations=[model._duration_days(model.tasks[tid]) for tid in members if model._duration_days(model.tasks[tid])>0]
        rows.append({
            "cluster_id":cid,
            "activity_count":len(members),
            "top_learned_terms":"; ".join(str(terms[i]) for i in top_idx if center[i]>0),
            "median_remaining_days":round(statistics.median(durations),3) if durations else 0.0,
            "sample_activities":"; ".join(model.tasks[tid].get("task_code","") for tid in members[:8]),
        })
    return mapping, rows, {"status":"trained","cluster_count":k,"silhouette_cosine":round(score,4),"vocabulary_size":len(terms)}


def _path_position(model: ScheduleModel, tid: str) -> float:
    path=model.base_shadow.get("path_task_ids",[])
    if tid in path and len(path)>1:
        return path.index(tid)/(len(path)-1)
    # Normalized topological rank for near-critical nodes.
    try:
        topo=list(nx.topological_sort(model.graph)); return topo.index(tid)/max(1,len(topo)-1)
    except Exception:
        return 0.5


def generate_universal_ml_candidates(model: ScheduleModel, clusters: Dict[str,int], config: Dict[str,Any]) -> List[Candidate]:
    """Generate project-neutral what-if actions from network structure, not construction keywords."""
    ucfg=config.get("universal_ml",{})
    ratios=[float(x) for x in ucfg.get("duration_reduction_ratios",[0.08,0.15,0.22,0.30])]
    lag_ratios=[float(x) for x in ucfg.get("lag_reduction_ratios",[0.25,0.5,0.75])]
    min_d=float(ucfg.get("minimum_remaining_duration_days",1.0))
    max_c=int(ucfg.get("max_universal_candidates",700))
    core=set(model.critical_corridor_ids())
    seq=1; candidates=[]
    # Duration actions: all remaining non-milestone tasks on the controlling/near-critical corridor.
    for tid in core:
        t=model.tasks[tid]; d=model._duration_days(t)
        if d < min_d or t.get("status_code")=="TK_Complete" or t.get("task_type") in {"TT_FinMile","TT_Mile","TT_StartMile"}:
            continue
        rnames=model.resource_names(tid)
        degree=model.graph.in_degree(tid)+model.graph.out_degree(tid)
        pos=_path_position(model,tid)
        for ratio in ratios:
            newd=max(0.25,d*(1-ratio))
            mod={"durations":{tid:newd},"lags":{}}
            gain=model._individual_gain(mod)
            if gain <= 0.001: continue
            conf="high" if rnames else "medium"
            risk="medium" if ratio<=0.22 else "high"
            candidates.append(Candidate(
                candidate_id=f"UML-{seq:04d}",action_type="DURATION_COMPRESSION",task_id=tid,
                activity_id=t.get("task_code",tid),activity_name=t.get("task_name",""),wbs_path=model.wbs_path(t.get("wbs_id","")),
                category=f"learned_cluster_{clusters.get(tid,0)}",current_remaining_days=round(d,3),proposed_remaining_days=round(newd,3),
                nominal_reduction_days=round(d-newd,3),individual_shadow_gain_days=round(gain,3),confidence=conf,risk=risk,
                priority_score=round(gain*100 + (1-pos)*5 + min(10,degree),3),
                strategy="ML candidate: compress remaining duration by a learned what-if ratio; implementation mechanism is selected from actual project resources/work methods during P6 review.",
                validation="Validate productivity, crew/equipment capacity, access, QA/QC, HSE, procurement and calendar feasibility before native P6 implementation.",
                resource_names="; ".join(rnames),notes=f"Project-local semantic cluster {clusters.get(tid,0)}; no project-specific activity dictionary used.",modification=mod,
            )); seq+=1
    # Lag optimization and overlap actions from native relationships.
    for rel in model.relationships:
        p,s=rel.get("pred_task_id",""),rel.get("task_id","")
        if p not in core or s not in core: continue
        lag=model._lag_days(rel); key=model._rel_key(rel)
        tp,ts=model.tasks[p],model.tasks[s]
        if lag>0.01:
            for rr in lag_ratios:
                newlag=lag*(1-rr); mod={"durations":{},"lags":{key:newlag}}; gain=model._individual_gain(mod)
                if gain<=0.001: continue
                candidates.append(Candidate(
                    candidate_id=f"UML-{seq:04d}",action_type="LAG_OPTIMIZATION",task_id=s,activity_id=ts.get("task_code",s),activity_name=ts.get("task_name",""),
                    wbs_path=model.wbs_path(ts.get("wbs_id","")),category=f"learned_cluster_{clusters.get(s,0)}",current_remaining_days=round(model._duration_days(ts),3),
                    proposed_remaining_days=round(model._duration_days(ts),3),nominal_reduction_days=round(lag-newlag,3),individual_shadow_gain_days=round(gain,3),
                    confidence="medium",risk="high" if rr>0.5 else "medium",priority_score=round(gain*90,3),
                    strategy="ML candidate: reduce a positive relationship lag after verifying its physical/contractual basis; prefer replacing hidden waiting time with explicit logic when appropriate.",
                    validation="Do not reduce any mandatory technical, contractual, regulatory or acceptance waiting requirement without project evidence.",
                    relationship=f"{tp.get('task_code')} -> {ts.get('task_code')} ({rel.get('pred_type')}, {lag:.2f}d)",notes="Generated from native relationship statistics.",modification=mod,
                )); seq+=1
        # Generic partial-overlap hypothesis for FS relationships with substantive durations.
        if rel.get("pred_type","PR_FS")=="PR_FS":
            dp,ds=model._duration_days(tp),model._duration_days(ts)
            if dp>=2 and ds>=2:
                overlap=min(dp,ds)*float(ucfg.get("fast_track_overlap_fraction",0.18))
                if overlap>0.25:
                    newlag=lag-overlap; mod={"durations":{},"lags":{key:newlag}}; gain=model._individual_gain(mod)
                    if gain>0.001:
                        candidates.append(Candidate(
                            candidate_id=f"UML-{seq:04d}",action_type="FAST_TRACK_OVERLAP",task_id=s,activity_id=ts.get("task_code",s),activity_name=ts.get("task_name",""),
                            wbs_path=model.wbs_path(ts.get("wbs_id","")),category=f"learned_cluster_{clusters.get(s,0)}",current_remaining_days=round(ds,3),proposed_remaining_days=round(ds,3),
                            nominal_reduction_days=round(overlap,3),individual_shadow_gain_days=round(gain,3),confidence="low",risk="high",priority_score=round(gain*70,3),
                            strategy="ML candidate: test partial workfront release/overlap across this FS handoff.",validation="Approve only when the predecessor/successor are physically divisible and safe to overlap; convert to valid native P6 logic after field review.",
                            relationship=f"{tp.get('task_code')} -> {ts.get('task_code')} (FS)",notes="Algorithmic hypothesis; exact CPM gain calculated, constructability remains a human/P6 control.",modification=mod,
                        )); seq+=1
    # Learned repetitive-cycle candidates: compress slower members of semantically learned clusters toward the lower quartile.
    by_cluster=defaultdict(list)
    for tid,cid in clusters.items():
        if tid in core and model._duration_days(model.tasks[tid])>=min_d and model.tasks[tid].get("status_code")!="TK_Complete": by_cluster[cid].append(tid)
    for cid,members in by_cluster.items():
        if len(members)<4: continue
        vals=sorted(model._duration_days(model.tasks[tid]) for tid in members)
        target=vals[max(0,int(0.25*(len(vals)-1)))]
        mods={}; nominal=0.0
        for tid in members:
            d=model._duration_days(model.tasks[tid])
            if d>target*1.05:
                newd=max(target,d*0.75); mods[tid]=newd; nominal+=d-newd
        if len(mods)<2: continue
        mod={"durations":mods,"lags":{}}; gain=model._individual_gain(mod)
        if gain<=0.001: continue
        sample=model.tasks[next(iter(mods))]
        candidates.append(Candidate(
            candidate_id=f"UML-{seq:04d}",action_type="LEARNED_CYCLE_OPTIMIZATION",task_id=next(iter(mods)),activity_id=f"CLUSTER-{cid}",activity_name=f"Learned repetitive cycle cluster {cid}",
            wbs_path="Multiple WBS locations",category=f"learned_cluster_{cid}",current_remaining_days=round(sum(model._duration_days(model.tasks[x]) for x in mods),3),
            proposed_remaining_days=round(sum(mods.values()),3),nominal_reduction_days=round(nominal,3),individual_shadow_gain_days=round(gain,3),confidence="medium",risk="medium",
            priority_score=round(gain*110+len(mods),3),strategy="Unsupervised cycle learning identified repeated/similar remaining activities. Benchmark slower members toward the learned lower-quartile duration using dedicated crews/workfaces or productivity balancing.",
            validation="Confirm that clustered activities are genuinely comparable in scope, quantities, location, method and resource conditions before adopting the benchmark.",notes=f"{len(mods)} activities changed from a cluster learned directly from this XER.",modification=mod,
        )); seq+=1
    candidates.sort(key=lambda c:(c.individual_shadow_gain_days,c.priority_score),reverse=True)
    return candidates[:max_c]


def _candidate_map(candidates: Sequence[Candidate]) -> Dict[str,Candidate]:
    return {c.candidate_id:c for c in candidates}


def _merge_candidate_set(model: ScheduleModel, chosen: Sequence[Candidate]) -> Optional[Dict[str,Any]]:
    durations={}; lags={}
    for c in chosen:
        mod=c.modification or {}
        for k,v in mod.get("durations",{}).items():
            if k in durations and abs(durations[k]-v)>1e-9: return None
            durations[k]=v
        for k,v in mod.get("lags",{}).items():
            if k in lags and abs(lags[k]-v)>1e-9: return None
            lags[k]=v
    return {"durations":durations,"lags":lags}


def scenario_ml_features(model: ScheduleModel, chosen: Sequence[Candidate]) -> Dict[str,float]:
    gains=[c.individual_shadow_gain_days for c in chosen]
    nom=[c.nominal_reduction_days for c in chosen]
    positions=[_path_position(model,c.task_id) for c in chosen if c.task_id in model.tasks]
    clusters=[c.category for c in chosen]
    types=Counter(c.action_type for c in chosen)
    risks={"low":1.0,"medium":2.0,"high":3.0}
    return {
        "action_count":float(len(chosen)),
        "sum_individual_gain":float(sum(gains)),
        "max_individual_gain":float(max(gains) if gains else 0),
        "mean_individual_gain":float(statistics.mean(gains) if gains else 0),
        "sum_nominal_reduction":float(sum(nom)),
        "mean_nominal_reduction":float(statistics.mean(nom) if nom else 0),
        "duration_actions":float(types.get("DURATION_COMPRESSION",0)),
        "lag_actions":float(types.get("LAG_OPTIMIZATION",0)),
        "fast_track_actions":float(types.get("FAST_TRACK_OVERLAP",0)),
        "cycle_actions":float(types.get("LEARNED_CYCLE_OPTIMIZATION",0)),
        "unique_clusters":float(len(set(clusters))),
        "mean_path_position":float(statistics.mean(positions) if positions else 0.5),
        "min_path_position":float(min(positions) if positions else 0.5),
        "max_path_position":float(max(positions) if positions else 0.5),
        "resource_supported_fraction":float(sum(1 for c in chosen if c.resource_names)/max(1,len(chosen))),
        "mean_risk_score":float(statistics.mean([risks.get(c.risk,2.0) for c in chosen]) if chosen else 0),
    }


def build_project_local_ml_dataset(model: ScheduleModel, candidates: Sequence[Candidate], config: Dict[str,Any], seed: int=42) -> List[Dict[str,Any]]:
    """Self-supervised ML: exact CPM generates labels from the uploaded project itself."""
    import random
    rng=random.Random(seed)
    ucfg=config.get("universal_ml",{})
    samples=int(ucfg.get("synthetic_training_scenarios",900))
    max_actions=min(int(ucfg.get("optimizer_max_actions",20)), max(1,len(candidates)))
    top=list(candidates[:min(len(candidates),250)])
    if not top: return []
    weights=[max(0.05,c.individual_shadow_gain_days) for c in top]
    rows=[]; seen=set()
    # Include all singleton examples.
    pools=[[c] for c in top[:min(len(top),150)]]
    while len(pools)<samples:
        k=rng.randint(1,min(max_actions, 1+int(math.sqrt(len(top)))))
        # Weighted without-replacement via repeated choices then dedupe.
        picked=[]; attempts=0
        while len(picked)<k and attempts<k*10:
            c=rng.choices(top,weights=weights,k=1)[0]; attempts+=1
            if c not in picked: picked.append(c)
        pools.append(picked)
    for chosen in pools:
        key=tuple(sorted(c.candidate_id for c in chosen))
        if key in seen: continue
        seen.add(key)
        mod=_merge_candidate_set(model,chosen)
        if mod is None: continue
        exact=model.base_shadow["network_length_days"]-model.shadow_cpm(mod)["network_length_days"]
        f=scenario_ml_features(model,chosen); f["exact_recovery_days"]=round(float(exact),6); f["scenario_key"]="|".join(key)
        rows.append(f)
    return rows


def train_project_local_surrogate(rows: Sequence[Dict[str,Any]], output_dir: Path, seed: int=42) -> Dict[str,Any]:
    try:
        import numpy as np
        import joblib
        from sklearn.model_selection import train_test_split
        from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
        from sklearn.ensemble import ExtraTreesRegressor, RandomForestRegressor, HistGradientBoostingRegressor, GradientBoostingRegressor, RandomForestClassifier
    except Exception as exc:
        return {"status":"skipped","reason":str(exc),"models":{},"feature_names":[]}
    rows=list(rows)
    if len(rows)<20: return {"status":"insufficient_training_rows","rows":len(rows),"models":{},"feature_names":[]}
    feature_names=[k for k in rows[0] if k not in {"exact_recovery_days","scenario_key"}]
    X=np.asarray([[float(r.get(k,0)) for k in feature_names] for r in rows],dtype=float)
    y=np.asarray([float(r["exact_recovery_days"]) for r in rows],dtype=float)
    Xtr,Xte,ytr,yte=train_test_split(X,y,test_size=0.22,random_state=seed)
    models={
        "extra_trees":ExtraTreesRegressor(n_estimators=450,min_samples_leaf=1,max_features=0.85,n_jobs=-1,random_state=seed),
        "random_forest":RandomForestRegressor(n_estimators=350,min_samples_leaf=1,max_features=0.8,n_jobs=-1,random_state=seed),
        "hist_gradient_boosting":HistGradientBoostingRegressor(max_iter=300,learning_rate=0.05,l2_regularization=0.15,random_state=seed),
        "gradient_boosting":GradientBoostingRegressor(n_estimators=300,learning_rate=0.04,max_depth=3,loss="huber",random_state=seed),
    }
    # Optional state-of-the-art tabular learners when installed.
    try:
        from xgboost import XGBRegressor
        models["xgboost"]=XGBRegressor(n_estimators=500,max_depth=5,learning_rate=0.04,subsample=0.9,colsample_bytree=0.9,objective="reg:squarederror",n_jobs=-1,random_state=seed)
    except Exception: pass
    try:
        from lightgbm import LGBMRegressor
        models["lightgbm"]=LGBMRegressor(n_estimators=500,num_leaves=31,learning_rate=0.04,subsample=0.9,colsample_bytree=0.9,verbosity=-1,random_state=seed)
    except Exception: pass
    try:
        from catboost import CatBoostRegressor
        models["catboost"]=CatBoostRegressor(iterations=500,depth=6,learning_rate=0.04,loss_function="MAE",verbose=False,random_seed=seed)
    except Exception: pass
    metrics={}; fitted={}
    output_dir.mkdir(parents=True,exist_ok=True)
    for name,m in models.items():
        try:
            m.fit(Xtr,ytr)
            import warnings
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                pred=m.predict(Xte)
            mae=float(mean_absolute_error(yte,pred)); rmse=float(math.sqrt(mean_squared_error(yte,pred))); r2=float(r2_score(yte,pred))
            metrics[name]={"mae":round(mae,5),"rmse":round(rmse,5),"r2":round(r2,5)}; fitted[name]=m
            joblib.dump(m,output_dir/f"local_{name}.joblib")
        except Exception as exc:
            metrics[name]={"error":str(exc)}
    good={n:m for n,m in fitted.items() if n in metrics and "mae" in metrics[n]}
    weights={n:1/max(0.001,metrics[n]["mae"]) for n in good}; sw=sum(weights.values()) or 1.0; weights={n:w/sw for n,w in weights.items()}
    # Learn probability that a scenario delivers material recovery; useful as a second decision head.
    cls=None; cls_metric=None
    threshold=max(0.25,float(np.quantile(y,0.45)))
    try:
        yc=(y>=threshold).astype(int)
        if len(set(yc))>1:
            cls=RandomForestClassifier(n_estimators=300,class_weight="balanced",n_jobs=-1,random_state=seed).fit(Xtr,(ytr>=threshold).astype(int))
            cls_metric=float((cls.predict(Xte)==(yte>=threshold).astype(int)).mean()); joblib.dump(cls,output_dir/"local_viability_classifier.joblib")
    except Exception: pass
    manifest={"status":"trained","training_rows":len(rows),"feature_names":feature_names,"models":metrics,"ensemble_weights":weights,"viability_threshold_days":round(threshold,4),"viability_accuracy":round(cls_metric,4) if cls_metric is not None else None}
    _json_dump(output_dir/"local_ml_manifest.json",manifest)
    return {**manifest,"_fitted_models":good,"_classifier":cls}


def _predict_local_surrogate(surrogate: Dict[str,Any], feature: Dict[str,float]) -> Tuple[float,float,float]:
    if not surrogate.get("_fitted_models"): return 0.0,0.0,0.0
    import numpy as np
    names=surrogate["feature_names"]; X=np.asarray([[float(feature.get(k,0)) for k in names]],dtype=float)
    preds=[]
    import warnings
    for n,m in surrogate["_fitted_models"].items():
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                preds.append((n,float(m.predict(X)[0])))
        except Exception: pass
    if not preds: return 0.0,0.0,0.0
    weights=surrogate.get("ensemble_weights",{}); pred=sum(weights.get(n,1/len(preds))*v for n,v in preds)
    spread=statistics.pstdev([v for _,v in preds]) if len(preds)>1 else 0.0
    prob=0.0
    cls=surrogate.get("_classifier")
    if cls is not None:
        try: prob=float(cls.predict_proba(X)[0][1])
        except Exception: prob=0.0
    return max(0.0,pred),spread,prob


def optimize_with_evolutionary_ml(model: ScheduleModel, candidates: Sequence[Candidate], surrogate: Dict[str,Any], config: Dict[str,Any], target_days: Optional[float], seed: int=42) -> Dict[str,Any]:
    import random
    rng=random.Random(seed); ucfg=config.get("universal_ml",{})
    population_size=int(ucfg.get("optimizer_population",90)); generations=int(ucfg.get("optimizer_generations",28)); max_actions=int(ucfg.get("optimizer_max_actions",20)); elite_n=max(4,int(population_size*0.18))
    cand=list(candidates[:min(len(candidates),300)]); cmap=_candidate_map(cand)
    if not cand: return {"selected_actions":[],"estimated_shadow_recovery_days":0.0,"reason":"no effective candidates"}
    def normalize(ids):
        out=[]; seen_d=set(); seen_l=set()
        for cid in ids:
            c=cmap.get(cid)
            if not c: continue
            mod=c.modification or {}; dk=set(mod.get("durations",{})); lk=set(mod.get("lags",{}))
            if dk & seen_d or lk & seen_l: continue
            out.append(cid); seen_d|=dk; seen_l|=lk
            if len(out)>=max_actions: break
        return tuple(sorted(set(out)))
    def random_chrom():
        k=rng.randint(1,min(max_actions,max(1,int(math.sqrt(len(cand)))+2)))
        weights=[max(0.05,c.individual_shadow_gain_days) for c in cand]
        ids=[]
        for _ in range(k*3):
            ids.append(rng.choices(cand,weights=weights,k=1)[0].candidate_id)
            if len(set(ids))>=k: break
        return normalize(ids)
    greedy=normalize([c.candidate_id for c in cand[:max_actions]])
    pop={greedy}
    while len(pop)<population_size: pop.add(random_chrom())
    exact_cache={}; pred_cache={}; learning_trace=[]
    def pred_score(chrom):
        if chrom in pred_cache:
            return pred_cache[chrom]
        chosen=[cmap[x] for x in chrom]; f=scenario_ml_features(model,chosen); pred,spread,prob=_predict_local_surrogate(surrogate,f)
        risk=statistics.mean([{"low":1,"medium":2,"high":3}.get(c.risk,2) for c in chosen]) if chosen else 0
        complexity=0.08*len(chosen)+0.12*risk+0.15*spread
        if target_days:
            short=max(0,target_days-pred); score=pred-1.7*short-complexity+0.25*prob
        else: score=pred-complexity+0.25*prob
        result=(score,pred,spread,prob)
        pred_cache[chrom]=result
        return result
    def exact(chrom):
        if chrom in exact_cache: return exact_cache[chrom]
        chosen=[cmap[x] for x in chrom]; mod=_merge_candidate_set(model,chosen)
        if mod is None: val=-1e9
        else: val=model.base_shadow["network_length_days"]-model.shadow_cpm(mod)["network_length_days"]
        exact_cache[chrom]=float(val); return float(val)
    for gen in range(generations):
        ranked=sorted(((pred_score(ch),ch) for ch in pop),key=lambda x:x[0][0],reverse=True)
        # Exact CPM verification of ML elites = active-learning truth loop.
        for info,ch in ranked[:min(8,len(ranked))]: exact(ch)
        elites=[ch for _,ch in ranked[:elite_n]]
        best_exact=max((exact(ch),ch) for ch in elites)
        learning_trace.append({"generation":gen+1,"population":len(pop),"best_predicted_recovery_days":round(ranked[0][0][1],3),"best_exact_elite_recovery_days":round(best_exact[0],3),"exact_scenarios_verified":len(exact_cache)})
        new=set(elites)
        while len(new)<population_size:
            a,b=rng.sample(elites,2) if len(elites)>=2 else (elites[0],elites[0])
            pool=list(set(a)|set(b)); rng.shuffle(pool); child=list(pool[:rng.randint(1,min(max_actions,max(1,len(pool))))])
            if rng.random()<0.65 and cand: child.append(rng.choice(cand).candidate_id)
            if rng.random()<0.35 and child: child.pop(rng.randrange(len(child)))
            new.add(normalize(child))
        pop=new
    final_ranked=sorted(((pred_score(ch),ch) for ch in pop),key=lambda x:x[0][0],reverse=True)
    finalists=set(ch for _,ch in final_ranked[:20]); finalists.add(greedy)
    evaluated=[]
    for ch in finalists:
        val=exact(ch); chosen=[cmap[x] for x in ch]; f=scenario_ml_features(model,chosen); pred,spread,prob=_predict_local_surrogate(surrogate,f)
        # Exact objective governs final selection.
        risk=sum({"low":1,"medium":2,"high":3}.get(c.risk,2) for c in chosen)
        objective = (-abs(target_days-val)-0.05*len(chosen)-0.03*risk) if target_days else (val-0.05*len(chosen)-0.03*risk)
        evaluated.append((objective,val,ch,pred,spread,prob))
    objective,val,best,pred,spread,prob=max(evaluated,key=lambda x:x[0])
    chosen=[cmap[x] for x in best]; mod=_merge_candidate_set(model,chosen) or {"durations":{},"lags":{}}
    final=model.shadow_cpm(mod)
    selected=[]
    for c in chosen:
        r=c.row(); r["ml_predicted_scenario_recovery_days"]=round(pred,3); selected.append(r)
    return {
        "optimizer":"project-local ensemble surrogate + viability classifier + evolutionary search + exact CPM elite verification",
        "target_recovery_days":target_days,
        "selected_action_count":len(chosen),
        "selected_actions":selected,
        "selected_candidate_ids":list(best),
        "ml_predicted_recovery_days":round(pred,3),
        "ml_prediction_spread_days":round(spread,3),
        "ml_viability_probability":round(prob,4),
        "estimated_shadow_recovery_days":round(val,3),
        "base_shadow_network_days":model.base_shadow["network_length_days"],
        "optimized_shadow_network_days":final["network_length_days"],
        "remaining_recovery_gap_days":round(max(0,(target_days or 0)-val),3) if target_days else None,
        "final_modification":mod,
        "final_shadow_path_activity_ids":[model.tasks[x].get("task_code") for x in final.get("path_task_ids",[])],
        "evolution_trace":learning_trace,
        "exact_scenarios_verified":len(exact_cache),
    }


def revised_schedule_rows(model: ScheduleModel, scenario: Dict[str,Any], clusters: Dict[str,int]) -> List[Dict[str,Any]]:
    from datetime import timedelta
    mod=scenario.get("final_modification",{"durations":{},"lags":{}}); final=model.shadow_cpm(mod)
    rows=[]
    for tid,t in model.tasks.items():
        oldd=model.base_durations.get(tid,0.0); newd=final["durations"].get(tid,oldd)
        baseoff=model.base_shadow["start_offsets"].get(tid,0.0); newoff=final["start_offsets"].get(tid,baseoff); delta=newoff-baseoff
        es=_parse_dt(t.get("early_start_date") or t.get("restart_date") or t.get("target_start_date")); ef=_parse_dt(t.get("early_end_date") or t.get("reend_date") or t.get("target_end_date"))
        pes=es+timedelta(days=delta) if es else None
        pef=pes+timedelta(days=newd) if pes else (ef+timedelta(days=delta-(oldd-newd)) if ef else None)
        rows.append({
            "activity_id":t.get("task_code"),"activity_name":t.get("task_name"),"wbs_path":model.wbs_path(t.get("wbs_id","")),"status":t.get("status_code"),
            "data_date":schedule_data_date(model).isoformat(sep=" ",timespec="minutes") if schedule_data_date(model) else "",
            "current_early_start":t.get("early_start_date"),"current_early_finish":t.get("early_end_date"),"current_remaining_days":round(oldd,3),
            "proposed_remaining_days":round(newd,3),"duration_change_days":round(newd-oldd,3),"proposed_early_start_estimate":pes.isoformat(sep=" ",timespec="minutes") if pes else "",
            "proposed_early_finish_estimate":pef.isoformat(sep=" ",timespec="minutes") if pef else "","start_shift_days":round(delta,3),"learned_cluster":clusters.get(tid,0),
            "native_p6_validation_required":"YES",
        })
    return rows


def p6_change_register(model: ScheduleModel, scenario: Dict[str,Any]) -> List[Dict[str,Any]]:
    mod=scenario.get("final_modification",{}); rows=[]
    for tid,newd in mod.get("durations",{}).items():
        t=model.tasks.get(tid,{})
        rows.append({"change_type":"REMAINING_DURATION","activity_id":t.get("task_code"),"activity_name":t.get("task_name"),"old_value_days":round(model.base_durations.get(tid,0.0),3),"new_value_days":round(float(newd),3),"implementation":"Change only after approved productivity/resource/method validation; then schedule natively in P6."})
    rel_by_key={model._rel_key(r):r for r in model.relationships}
    for key,newlag in mod.get("lags",{}).items():
        r=rel_by_key.get(key,{}); p=model.tasks.get(r.get("pred_task_id",""),{}); s=model.tasks.get(r.get("task_id",""),{})
        rows.append({"change_type":"RELATIONSHIP_LAG","activity_id":f"{p.get('task_code')}->{s.get('task_code')}","activity_name":r.get("pred_type"),"old_value_days":round(model.base_lags.get(key,0.0),3),"new_value_days":round(float(newlag),3),"implementation":"Validate physical/technical basis, update native relationship/lag in controlled P6 copy, then recalculate."})
    return rows


def _resolve_universal_target(model: ScheduleModel, mode: str, target_days: Optional[float], target_date: Optional[str]) -> Optional[float]:
    if target_days is not None: return max(0.0,float(target_days))
    forecast=_parse_dt(model.tasks.get(model.terminal_task_id,{}).get("early_end_date") or model.project.get("scd_end_date"))
    if target_date and forecast:
        td=_parse_dt(target_date)
        if td: return max(0.0,(forecast-td).total_seconds()/86400)
    required=float(model.recovery_need().get("required_recovery_calendar_days",0.0) or 0.0)
    if mode=="recovery": return required if required>0 else None
    if mode=="mitigation":
        return min(30.0,max(5.0,required*0.25)) if required>0 else min(15.0,max(3.0,model.base_shadow["network_length_days"]*0.02))
    return None


def render_universal_report(profile: Dict[str,Any], cluster_meta: Dict[str,Any], candidates: Sequence[Candidate], surrogate: Dict[str,Any], scenario: Dict[str,Any], mode: str) -> str:
    p=profile["project"]; n=profile["network"]; r=profile["recovery_requirement"]
    lines=[AUTHOR,"",f"# Universal XER ML Schedule Intelligence Report — {mode.upper()}","",f"Engine: {ENGINE_NAME} v{ENGINE_VERSION}","",
           "## Schedule Recognition",f"- Project: {p.get('project_name')} ({p.get('proj_id')})",f"- Data Date: {p.get('data_date')}",f"- Activities / Relationships: {n.get('activities')} / {n.get('relationships')}",f"- WBS / Resources: {n.get('wbs_nodes')} WBS nodes / {profile['network'].get('resource_assignments')} assignments",f"- Terminal Milestone: {p.get('terminal_activity_id')} — {p.get('terminal_activity_name')}",f"- Native Forecast Finish: {r.get('forecast_finish')}",f"- Required Finish: {r.get('required_finish')}",f"- Native Recovery Requirement: {r.get('required_recovery_calendar_days')} days","",
           "## Machine Learning Architecture",f"- Activity representation: self-learned TF-IDF semantic/network clustering ({cluster_meta.get('cluster_count')} clusters; silhouette {cluster_meta.get('silhouette_cosine')}).",f"- Candidate learning: {len(candidates)} project-neutral CPM-tested actions generated from native durations, relationships, topology, resources and learned clusters.",f"- Local training rows: {surrogate.get('training_rows',0)} synthetic scenarios labeled by exact shadow CPM.",f"- Ensemble validation: {json.dumps(surrogate.get('models',{}),ensure_ascii=False)}",f"- Evolutionary optimizer verified {scenario.get('exact_scenarios_verified',0)} scenario combinations with exact CPM.","",
           "## Optimized Scenario",f"- Mode: {mode}",f"- Target Recovery: {scenario.get('target_recovery_days')} days",f"- ML Predicted Recovery: {scenario.get('ml_predicted_recovery_days')} days",f"- ML Ensemble Spread: {scenario.get('ml_prediction_spread_days')} days",f"- Exact Shadow-CPM Recovery: {scenario.get('estimated_shadow_recovery_days')} days",f"- Selected Actions: {scenario.get('selected_action_count')}",f"- Remaining Gap: {scenario.get('remaining_recovery_gap_days')} days","",
           "## Governance", "- No project name, activity ID, building, discipline or construction-method dictionary is hardcoded into the ML logic.", "- ML ranks and optimizes; exact CPM determines accepted schedule gain.", "- Proposed revised dates are algorithmic estimates. Calendars, exceptions, constraints, resource leveling and all approved changes must be recalculated in native Primavera P6 before contractual or execution use.", "- Source XER remains unchanged."]
    return "\n".join(lines)


def universal_ml_analyze(xer: Path, output_dir: Path, config: Dict[str,Any], project_hint: Optional[str]=None, mode: str="recovery", target_recovery_days: Optional[float]=None, target_date: Optional[str]=None) -> Dict[str,Any]:
    output_dir.mkdir(parents=True,exist_ok=True)
    parser=XERParser(xer).parse(); model=ScheduleModel(parser,config,project_hint)
    profile=universal_schedule_profile(model)
    clusters,cluster_rows,cluster_meta=learn_activity_clusters(model,max_clusters=int(config.get("universal_ml",{}).get("max_activity_clusters",24)),seed=int(config.get("universal_ml",{}).get("random_seed",42)))
    candidates=generate_universal_ml_candidates(model,clusters,config)
    training=build_project_local_ml_dataset(model,candidates,config,seed=int(config.get("universal_ml",{}).get("random_seed",42)))
    surrogate=train_project_local_surrogate(training,output_dir/"local_ml_models",seed=int(config.get("universal_ml",{}).get("random_seed",42)))
    target=_resolve_universal_target(model,mode,target_recovery_days,target_date)
    scenario=optimize_with_evolutionary_ml(model,candidates,surrogate,config,target,seed=int(config.get("universal_ml",{}).get("random_seed",42)))
    revised=revised_schedule_rows(model,scenario,clusters); changes=p6_change_register(model,scenario)
    _json_dump(output_dir/"schedule_profile.json",profile); _write_csv(output_dir/"learned_activity_clusters.csv",cluster_rows); _json_dump(output_dir/"activity_cluster_model.json",cluster_meta)
    _write_csv(output_dir/"universal_ml_candidates.csv",[c.row() for c in candidates]); _write_csv(output_dir/"project_local_ml_training.csv",training)
    _json_dump(output_dir/"optimized_scenario.json",scenario); _write_csv(output_dir/"REVISED_SCHEDULE_PROPOSAL.csv",revised); _write_csv(output_dir/"P6_CHANGE_REGISTER.csv",changes)
    public_sur={k:v for k,v in surrogate.items() if not k.startswith("_")}; _json_dump(output_dir/"project_local_ml_manifest.json",public_sur)
    report=render_universal_report(profile,cluster_meta,candidates,public_sur,scenario,mode); (output_dir/"UNIVERSAL_SCHEDULE_ML_REPORT.md").write_text(report,encoding="utf-8")
    manifest={"engine":ENGINE_NAME,"version":ENGINE_VERSION,"author":AUTHOR,"source_xer":str(xer),"source_sha256":_sha256(xer),"mode":mode,"generated_at":_now(),"outputs":[p.name for p in output_dir.iterdir()]}; _json_dump(output_dir/"analysis_manifest.json",manifest)
    return {"profile":profile,"clusters":cluster_meta,"candidate_count":len(candidates),"training_rows":len(training),"ml":public_sur,"scenario":scenario,"output_dir":str(output_dir)}



def load_config(path: Optional[Path]) -> Dict[str,Any]:
    if not path: return json.loads(json.dumps(DEFAULT_CONFIG))
    return deep_merge(DEFAULT_CONFIG,json.loads(Path(path).read_text(encoding='utf-8-sig')))

def build_cli() -> argparse.ArgumentParser:
    p=argparse.ArgumentParser(description=ENGINE_NAME)
    p.add_argument('--config',type=Path)
    sub=p.add_subparsers(dest='cmd',required=True)
    u=sub.add_parser('run',help='Recognize any XER and optimize mitigation/recovery/revised scenario')
    u.add_argument('xer',type=Path); u.add_argument('--output',type=Path,default=Path('universal_xer_ml_output'))
    u.add_argument('--project'); u.add_argument('--mode',choices=['mitigation','recovery','revised'],default='recovery')
    u.add_argument('--target-recovery-days',type=float); u.add_argument('--target-date')
    sub.add_parser('selftest')
    w=sub.add_parser('write-config'); w.add_argument('--output',type=Path,default=Path('UNIVERSAL_XER_ADAPTIVE_ML_CONFIG.json'))
    return p

def main(argv: Optional[Sequence[str]]=None) -> int:
    args=build_cli().parse_args(argv); cfg=load_config(args.config)
    if args.cmd=='selftest':
        assert _parse_dt('2026-03-17 00:00') is not None
        print(f'{AUTHOR}\n{ENGINE_NAME} v{ENGINE_VERSION} self-test: PASS'); return 0
    if args.cmd=='write-config':
        _json_dump(args.output,DEFAULT_CONFIG); print(f'{AUTHOR}\nWrote {args.output}'); return 0
    result=universal_ml_analyze(args.xer,args.output,cfg,args.project,args.mode,args.target_recovery_days,args.target_date)
    print(AUTHOR); print(f'Engine: {ENGINE_NAME} v{ENGINE_VERSION}'); print(f'Mode: {args.mode}')
    print(f"Project: {result['profile']['project'].get('project_name')}"); print(f"Data Date: {result['profile']['project'].get('data_date')}")
    print(f"Activities / Relationships: {result['profile']['network'].get('activities')} / {result['profile']['network'].get('relationships')}")
    print(f"Project-local ML training scenarios: {result.get('training_rows')}"); print(f"ML/CPM candidates: {result.get('candidate_count')}")
    print(f"Exact verified recovery: {result['scenario'].get('estimated_shadow_recovery_days')} days"); print(f'Output: {args.output.resolve()}')
    return 0

if __name__=='__main__': raise SystemExit(main())
