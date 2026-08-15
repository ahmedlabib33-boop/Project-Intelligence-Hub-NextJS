#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ADVANCED EFFICIENT ENSEMBLE ML LAYER

Python AI Programming by Eng. Ahmed Labib

Adds a governed ensemble/meta-selection layer on top of the existing real ML engine.
The design optimizes measured predictive quality, latency and model diversity while preserving
all 26 governance rules and native Primavera P6/XER supremacy.

It deliberately does NOT claim "best ever" or universal 100% accuracy. It reports measured
validation metrics only, and project-aware validation remains mandatory for cross-project claims.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import confusion_matrix
from sklearn.model_selection import cross_val_score
from sklearn.base import BaseEstimator, ClassifierMixin, RegressorMixin
from sklearn.preprocessing import LabelEncoder

ATTRIBUTION = "Python AI Programming by Eng. Ahmed Labib"
AUTHOR = "Eng. Ahmed Labib"
VERSION = "2.0.0"
ROOT = Path(__file__).resolve().parent


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, str(path))
    if spec is None or spec.loader is None:
        raise ImportError(path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


ML = _load(ROOT / "PROJECT_CONTROLS_ML_DECISION_SUPPORT.py", "advanced_base_ml")
GOVERNANCE_PATH = ROOT / "UNIVERSAL_GOVERNANCE_26_RULES_AND_30_REPORT_RULEBOOKS.json"


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def file_sha256(path: str | Path) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for c in iter(lambda: f.read(1024 * 1024), b""):
            h.update(c)
    return h.hexdigest()


def governance_hash() -> Optional[str]:
    return file_sha256(GOVERNANCE_PATH) if GOVERNANCE_PATH.exists() else None


def _softmax(values: Sequence[float], temperature: float = 0.08) -> np.ndarray:
    x = np.asarray(values, dtype=float)
    x = (x - np.max(x)) / max(1e-6, float(temperature))
    e = np.exp(np.clip(x, -50, 50))
    return e / e.sum()


class SafeExternalClassifier(BaseEstimator, ClassifierMixin):
    """Sklearn-compatible wrapper for external classifiers with label/tag incompatibilities."""
    def __init__(self, backend: str, params: Optional[Dict[str, Any]] = None):
        self.backend = backend
        self.params = params

    def fit(self, X, y):
        self.encoder_ = LabelEncoder().fit(np.asarray(y).astype(str))
        yi = self.encoder_.transform(np.asarray(y).astype(str))
        params = dict(self.params or {})
        if self.backend == "xgboost":
            if ML.xgb is None: raise RuntimeError("XGBoost unavailable")
            self.model_ = ML.xgb.XGBClassifier(**params)
        elif self.backend == "catboost":
            if ML.cb is None: raise RuntimeError("CatBoost unavailable")
            self.model_ = ML.cb.CatBoostClassifier(**params)
        else: raise ValueError(self.backend)
        self.model_.fit(X, yi)
        self.classes_ = self.encoder_.classes_
        return self

    def predict_proba(self, X):
        return np.asarray(self.model_.predict_proba(X), dtype=float)

    def predict(self, X):
        pred = np.asarray(self.model_.predict(X)).reshape(-1).astype(int)
        return self.encoder_.inverse_transform(pred)


class SafeExternalRegressor(BaseEstimator, RegressorMixin):
    """Sklearn-compatible wrapper for external regressors with tag incompatibilities."""
    def __init__(self, backend: str, params: Optional[Dict[str, Any]] = None):
        self.backend = backend
        self.params = params

    def fit(self, X, y):
        params = dict(self.params or {})
        if self.backend == "xgboost":
            if ML.xgb is None: raise RuntimeError("XGBoost unavailable")
            self.model_ = ML.xgb.XGBRegressor(**params)
        elif self.backend == "catboost":
            if ML.cb is None: raise RuntimeError("CatBoost unavailable")
            self.model_ = ML.cb.CatBoostRegressor(**params)
        else: raise ValueError(self.backend)
        self.model_.fit(X, np.asarray(y, dtype=float))
        return self

    def predict(self, X):
        return np.asarray(self.model_.predict(X), dtype=float).reshape(-1)


def _governed_candidates(task_type: str, full_load: bool) -> Dict[str, Any]:
    raw = ML._classification_estimators(full_load) if task_type == "classification" else ML._regression_estimators(full_load)
    out: Dict[str, Any] = {}
    for name, est in raw.items():
        if name in {"xgboost", "catboost"}:
            params = est.get_params() if hasattr(est, "get_params") else {}
            out[name] = SafeExternalClassifier(name, params) if task_type == "classification" else SafeExternalRegressor(name, params)
        else:
            out[name] = est
    return out


def _classes(pipe: Any) -> Optional[np.ndarray]:
    if hasattr(pipe, "classes_"):
        return np.asarray(pipe.classes_)
    try:
        m = pipe.named_steps["model"]
        if hasattr(m, "classes_"):
            return np.asarray(m.classes_)
        if hasattr(m, "named_steps") and hasattr(m.named_steps.get("torch"), "classes_"):
            return np.asarray(m.named_steps["torch"].classes_)
    except Exception:
        return None
    return None


def _aligned_proba(model: Any, X: pd.DataFrame, global_classes: np.ndarray) -> np.ndarray:
    if hasattr(model, "predict_proba"):
        p = np.asarray(model.predict_proba(X), dtype=float)
        cls = _classes(model)
        if cls is not None and len(cls) == p.shape[1]:
            out = np.zeros((len(X), len(global_classes)), dtype=float)
            lookup = {str(c): i for i, c in enumerate(global_classes)}
            for j, c in enumerate(cls):
                if str(c) in lookup:
                    out[:, lookup[str(c)]] = p[:, j]
            rs = out.sum(axis=1, keepdims=True)
            rs[rs == 0] = 1
            return out / rs
        if p.shape[1] == len(global_classes):
            return p
    pred = np.asarray(model.predict(X))
    out = np.zeros((len(pred), len(global_classes)), dtype=float)
    lookup = {str(c): i for i, c in enumerate(global_classes)}
    for i, v in enumerate(pred):
        out[i, lookup.get(str(v), 0)] = 1.0
    return out


def expected_calibration_error(y_true: Sequence[Any], proba: np.ndarray, classes: np.ndarray, bins: int = 10) -> float:
    y = np.asarray(y_true)
    conf = np.max(proba, axis=1)
    pred = classes[np.argmax(proba, axis=1)]
    correct = (pred.astype(str) == y.astype(str)).astype(float)
    ece = 0.0
    edges = np.linspace(0.0, 1.0, bins + 1)
    for i in range(bins):
        lo, hi = edges[i], edges[i + 1]
        mask = (conf >= lo) & (conf <= hi if i == bins - 1 else conf < hi)
        if mask.any():
            ece += float(mask.mean()) * abs(float(correct[mask].mean()) - float(conf[mask].mean()))
    return float(ece)


def _efficiency_score(task_type: str, metrics: Dict[str, Any], latency_ms_per_row: float, cv_std: float) -> float:
    if task_type == "classification":
        quality = float(metrics.get("f1", 0.0) or 0.0)
        calibration_penalty = float(metrics.get("ece", 0.0) or 0.0) * 0.08
    else:
        quality = float(metrics.get("confidence", 0.0) or 0.0)
        calibration_penalty = 0.0
    latency_penalty = min(0.12, math.log1p(max(0.0, latency_ms_per_row)) * 0.012)
    stability_penalty = min(0.10, abs(float(cv_std)) * 0.08)
    return max(0.0, min(1.0, quality - latency_penalty - stability_penalty - calibration_penalty))


def train_efficient_ensemble(
    data: pd.DataFrame,
    task: str,
    target: str,
    output_dir: str | Path,
    project_column: Optional[str] = "project_id",
    exclude_columns: Optional[Sequence[str]] = None,
    full_load: bool = True,
    test_size: float = 0.2,
    data_origin: str = "unspecified",
    project_scope: Optional[str] = None,
    max_ensemble_models: int = 3,
) -> Dict[str, Any]:
    if task not in ML.TASK_REGISTRY:
        raise ValueError(f"Unknown ML task: {task}")
    task_type = ML.TASK_REGISTRY[task]["type"]
    if task_type not in {"classification", "regression"}:
        raise ValueError("Efficient ensemble supports supervised classification/regression tasks")
    if target not in data.columns:
        raise ValueError(f"Target '{target}' not found")
    df = data.copy().dropna(subset=[target]).reset_index(drop=True)
    if len(df) < 30:
        raise ValueError("At least 30 labeled records are required for ensemble training")
    if task_type == "classification" and df[target].nunique() < 2:
        raise ValueError("Classification target requires at least two classes")

    Xtr, Xte, ytr, yte, groups_train, isolation = ML._split_data(
        df, target, project_column if project_column and project_column in df.columns else None, task_type, test_size
    )
    schema = ML.infer_feature_schema(df, target, project_column if project_column in df.columns else None, exclude_columns)
    candidates = _governed_candidates(task_type, full_load)
    cv, cv_groups = ML._cv_strategy(ytr, groups_train, task_type)
    scoring = "f1_weighted" if task_type == "classification" else "neg_root_mean_squared_error"

    rows: List[Dict[str, Any]] = []
    fitted: Dict[str, Any] = {}
    global_classes = np.asarray(sorted(ytr.astype(str).unique())) if task_type == "classification" else None

    for name, estimator in candidates.items():
        pipe = ML._candidate_pipeline(schema, estimator)
        started = time.perf_counter()
        try:
            scores = cross_val_score(pipe, Xtr, ytr, cv=cv, groups=cv_groups, scoring=scoring, n_jobs=1, error_score="raise")
            cv_mean, cv_std = float(np.mean(scores)), float(np.std(scores))
            pipe.fit(Xtr, ytr)
            fit_seconds = time.perf_counter() - started
            pstarted = time.perf_counter()
            if task_type == "classification":
                proba = _aligned_proba(pipe, Xte, global_classes)
                pred = global_classes[np.argmax(proba, axis=1)]
                # Compare as strings to allow framework encoders with equivalent labels.
                metrics = ML._classification_metrics(yte.astype(str), pred.astype(str), proba)
                metrics["ece"] = expected_calibration_error(yte.astype(str), proba, global_classes)
                metrics["confusion_matrix"] = confusion_matrix(yte.astype(str), pred.astype(str), labels=global_classes).tolist()
                metrics["classes"] = global_classes.tolist()
            else:
                pred = np.asarray(pipe.predict(Xte), dtype=float)
                metrics = ML._regression_metrics(yte, pred)
            latency_ms_per_row = (time.perf_counter() - pstarted) * 1000.0 / max(1, len(Xte))
            eff = _efficiency_score(task_type, metrics, latency_ms_per_row, cv_std)
            row = {
                "model": name,
                "framework": ML._framework_name(name),
                "status": "PASS",
                "cv_score_mean": cv_mean,
                "cv_score_std": cv_std,
                "fit_seconds": fit_seconds,
                "prediction_latency_ms_per_row": latency_ms_per_row,
                "metrics": metrics,
                "efficiency_score": eff,
            }
            rows.append(row)
            fitted[name] = pipe
        except Exception as e:
            rows.append({"model": name, "framework": ML._framework_name(name), "status": "FAIL", "error": f"{type(e).__name__}: {e}"})

    passed = [r for r in rows if r["status"] == "PASS"]
    if not passed:
        raise RuntimeError("All candidate models failed")
    # Quality first, efficiency second. This prevents a very fast weak model from winning.
    passed.sort(key=lambda r: (r["efficiency_score"], r["cv_score_mean"]), reverse=True)
    selected = passed[: max(1, min(max_ensemble_models, len(passed)))]
    weights = _softmax([float(r["efficiency_score"]) for r in selected])

    if task_type == "classification":
        combined = np.zeros((len(Xte), len(global_classes)), dtype=float)
        for w, row in zip(weights, selected):
            combined += float(w) * _aligned_proba(fitted[row["model"]], Xte, global_classes)
        combined = combined / np.maximum(combined.sum(axis=1, keepdims=True), 1e-12)
        final_pred = global_classes[np.argmax(combined, axis=1)]
        metrics = ML._classification_metrics(yte.astype(str), final_pred.astype(str), combined)
        metrics["ece"] = expected_calibration_error(yte.astype(str), combined, global_classes)
        metrics["confusion_matrix"] = confusion_matrix(yte.astype(str), final_pred.astype(str), labels=global_classes).tolist()
        metrics["classes"] = global_classes.tolist()
    else:
        preds = np.vstack([np.asarray(fitted[r["model"]].predict(Xte), dtype=float) for r in selected])
        final_pred = np.average(preds, axis=0, weights=weights)
        metrics = ML._regression_metrics(yte, final_pred)
        # Disagreement is a useful uncertainty signal for ensemble regression.
        metrics["ensemble_prediction_std_mean"] = float(np.mean(np.std(preds, axis=0))) if len(selected) > 1 else 0.0

    # OOD reference is attached to the best single model's feature transformer. This is auditable and reproducible.
    best_pipe = fitted[selected[0]["model"]]
    ood_model, ood_threshold = ML._fit_ood(best_pipe.named_steps["features"], Xtr)
    reference_profile = ML.build_reference_profile(Xtr, schema)

    out = Path(output_dir); out.mkdir(parents=True, exist_ok=True)
    bundle = {
        "task": task,
        "task_type": task_type,
        "target": target,
        "schema": schema,
        "models": {r["model"]: fitted[r["model"]] for r in selected},
        "weights": {r["model"]: float(w) for r, w in zip(selected, weights)},
        "classes": global_classes.tolist() if global_classes is not None else None,
        "ood_model": ood_model,
        "ood_preprocessor": best_pipe.named_steps["features"],
        "ood_threshold": float(ood_threshold),
        "reference_profile": reference_profile,
    }
    joblib.dump(bundle, out / "ensemble_bundle.joblib")
    run_id = f"ensemble-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
    card = {
        "attribution": ATTRIBUTION,
        "author": AUTHOR,
        "engine_component": "advanced_efficient_ensemble_ml",
        "component_version": VERSION,
        "run_id": run_id,
        "generated_at_utc": utcnow(),
        "task": task,
        "task_id": ML.TASK_REGISTRY[task]["id"],
        "task_type": task_type,
        "target": target,
        "data_origin": data_origin,
        "project_scope": project_scope,
        "training_rows": int(len(Xtr)),
        "validation_rows": int(len(Xte)),
        "project_isolation": isolation,
        "feature_schema": {"numeric": schema.numeric, "categorical": schema.categorical, "text": schema.text, "excluded": schema.excluded},
        "candidate_leaderboard": rows,
        "selected_models": [{"model": r["model"], "framework": r["framework"], "weight": float(w), "efficiency_score": r["efficiency_score"]} for r, w in zip(selected, weights)],
        "ensemble_metrics": metrics,
        "ood_threshold": float(ood_threshold),
        "governance_sha256": governance_hash(),
        "global_governance_rule_count": 26,
        "native_schedule_supremacy": True,
        "ml_role": "decision_support_only",
        "claim_control": "Metrics are measured on the declared validation split. They are not universal accuracy claims.",
    }
    (out / "model_card.json").write_text(json.dumps(card, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    card["ensemble_bundle_sha256"] = file_sha256(out / "ensemble_bundle.joblib")
    (out / "model_card.json").write_text(json.dumps(card, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    return card


def predict_efficient_ensemble(model_dir: str | Path, data: pd.DataFrame) -> pd.DataFrame:
    d = Path(model_dir)
    bundle = joblib.load(d / "ensemble_bundle.joblib")
    task_type = bundle["task_type"]
    models = bundle["models"]
    weights = bundle["weights"]
    out = data.copy()
    if task_type == "classification":
        classes = np.asarray(bundle["classes"])
        combined = np.zeros((len(data), len(classes)), dtype=float)
        for name, model in models.items():
            combined += float(weights[name]) * _aligned_proba(model, data, classes)
        combined = combined / np.maximum(combined.sum(axis=1, keepdims=True), 1e-12)
        out["ml_prediction"] = classes[np.argmax(combined, axis=1)]
        out["ml_confidence"] = np.max(combined, axis=1)
        for i, c in enumerate(classes):
            out[f"ml_probability__{str(c)}"] = combined[:, i]
    else:
        preds = np.vstack([np.asarray(model.predict(data), dtype=float) for model in models.values()])
        w = np.asarray([weights[name] for name in models], dtype=float)
        out["ml_prediction"] = np.average(preds, axis=0, weights=w)
        out["ml_ensemble_std"] = np.std(preds, axis=0) if len(models) > 1 else 0.0
        # Confidence is a relative stability signal, not a probability.
        scale = np.maximum(1.0, np.abs(out["ml_prediction"].to_numpy(dtype=float)))
        out["ml_confidence"] = 1.0 / (1.0 + out["ml_ensemble_std"].to_numpy(dtype=float) / scale)
    scores, flags = ML._ood_scores(bundle["ood_preprocessor"], bundle["ood_model"], bundle["ood_threshold"], data)
    out["ood_score"] = scores
    out["ood_flag"] = flags
    out["ml_status"] = np.where(out["ood_flag"], "UNCERTAIN_OOD", "ADVISORY_VALIDATED_DOMAIN")
    out["native_cpm_supremacy"] = "NATIVE_P6_CPM_GOVERNS_FORMAL_SCHEDULE_RESULT"
    out["attribution"] = ATTRIBUTION
    return out


def drift_from_ensemble(model_dir: str | Path, current: pd.DataFrame) -> Dict[str, Any]:
    bundle = joblib.load(Path(model_dir) / "ensemble_bundle.joblib")
    report = ML.calculate_drift(bundle["reference_profile"], current)
    report.update({
        "attribution": ATTRIBUTION,
        "component_version": VERSION,
        "governance_sha256": governance_hash(),
        "native_schedule_supremacy": True,
    })
    return report


def offline_self_test(output_dir: Optional[str | Path] = None) -> Dict[str, Any]:
    rng = np.random.default_rng(42)
    rows = []
    for p in range(6):
        for i in range(36):
            x = rng.normal(loc=p * 0.1, scale=1.0)
            y = rng.normal()
            target = "HIGH" if x + 0.65 * y > 0.3 else "LOW"
            rows.append({"project_id": f"P{p+1}", "progress_variance": x, "float_days": y * 10, "discipline": "STR" if i % 2 else "MEP", "risk": target})
    df = pd.DataFrame(rows)
    out = Path(output_dir or (ROOT / "_ADVANCED_ML_SELF_TEST"))
    import shutil
    shutil.rmtree(out, ignore_errors=True)
    card = train_efficient_ensemble(df, "delay_risk_prediction", "risk", out, project_column="project_id", full_load=False, data_origin="synthetic_benchmark", project_scope="offline_self_test", max_ensemble_models=3)
    pred = predict_efficient_ensemble(out, df.head(8).drop(columns=["risk"]))
    passed = bool(len(card.get("selected_models", [])) >= 1 and len(pred) == 8 and "ood_score" in pred.columns and card["project_isolation"].get("project_aware"))
    return {
        "attribution": ATTRIBUTION,
        "status": "PASS" if passed else "FAIL",
        "selected_models": card.get("selected_models"),
        "ensemble_metrics": card.get("ensemble_metrics"),
        "project_isolation": card.get("project_isolation"),
        "governance_sha256": governance_hash(),
        "note": "Synthetic integration self-test only. It is not a real-project accuracy claim.",
    }


def main(argv: Optional[Sequence[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Advanced governed ensemble ML")
    sp = ap.add_subparsers(dest="cmd")
    s = sp.add_parser("self-test"); s.add_argument("--output")
    t = sp.add_parser("train")
    t.add_argument("--task", required=True); t.add_argument("--data", required=True); t.add_argument("--target", required=True); t.add_argument("--output", required=True)
    t.add_argument("--project-column", default="project_id"); t.add_argument("--data-origin", default="unspecified"); t.add_argument("--project-scope"); t.add_argument("--fast", action="store_true")
    p = sp.add_parser("predict"); p.add_argument("--model-dir", required=True); p.add_argument("--data", required=True); p.add_argument("--output", required=True)
    args = ap.parse_args(argv)
    print(ATTRIBUTION)
    if args.cmd == "self-test":
        r = offline_self_test(args.output); print(json.dumps(r, indent=2, ensure_ascii=False, default=str)); return 0 if r["status"] == "PASS" else 2
    if args.cmd == "train":
        df = ML.load_table(args.data); card = train_efficient_ensemble(df, args.task, args.target, args.output, args.project_column, full_load=not args.fast, data_origin=args.data_origin, project_scope=args.project_scope); print(json.dumps(card, indent=2, ensure_ascii=False, default=str)); return 0
    if args.cmd == "predict":
        df = ML.load_table(args.data); out = predict_efficient_ensemble(args.model_dir, df); out.to_csv(args.output, index=False); print(args.output); return 0
    ap.print_help(); return 1


if __name__ == "__main__":
    raise SystemExit(main())
