"""Project-scoped advanced analytics for the Next.js data generator.

The module uses the strongest method justified by each project data set. It
never trains a supervised or deep-learning model from thin data and returns an
explicit readiness result when the evidence is insufficient.
"""

from __future__ import annotations

from collections import Counter
from importlib.util import find_spec
import math
import re
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

try:
    from sklearn.ensemble import IsolationForest
except ImportError:  # pragma: no cover - dependency is checked at runtime
    IsolationForest = None  # type: ignore[assignment,misc]

try:
    from statsmodels.tsa.holtwinters import Holt
except ImportError:  # pragma: no cover - optional local enhancement
    Holt = None  # type: ignore[assignment,misc]

try:
    import seaborn as sns
except ImportError:  # pragma: no cover - optional chart styling
    sns = None  # type: ignore[assignment]

try:
    import spacy
except ImportError:  # pragma: no cover - optional NLP enhancement
    spacy = None  # type: ignore[assignment]


ENGINE_VERSION = "1.0"
MIN_ACTIVITY_RECORDS = 20
MIN_S_CURVE_PERIODS = 6
MIN_SUPERVISED_HISTORY = 50
MIN_DEEP_LEARNING_HISTORY = 500


def _normalize_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def _pick(row: dict[str, Any], names: list[str]) -> Any:
    normalized = {_normalize_key(key): value for key, value in row.items()}
    for name in names:
        value = normalized.get(_normalize_key(name))
        if value not in (None, ""):
            return value
    return None


def _number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return number if math.isfinite(number) else None
    match = re.search(r"[-+]?\d+(?:\.\d+)?", str(value).replace(",", ""))
    if not match:
        return None
    try:
        number = float(match.group(0))
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def _percent(value: Any) -> float | None:
    number = _number(value)
    if number is None:
        return None
    if number > 1:
        number /= 100.0
    return min(max(number, 0.0), 1.0)


def _library_status() -> dict[str, dict[str, Any]]:
    packages = {
        "pandas": "pandas",
        "numpy": "numpy",
        "matplotlib": "matplotlib",
        "seaborn": "seaborn",
        "scikit_learn": "sklearn",
        "statsmodels": "statsmodels",
        "spacy": "spacy",
        "xgboost": "xgboost",
        "pytorch": "torch",
        "tensorflow": "tensorflow",
    }
    return {
        name: {"installed": find_spec(module) is not None}
        for name, module in packages.items()
    }


def _activity_anomalies(activities: list[dict[str, Any]]) -> dict[str, Any]:
    if len(activities) < MIN_ACTIVITY_RECORDS:
        return {
            "status": "insufficient_data",
            "method": "IsolationForest",
            "minimum_activity_records": MIN_ACTIVITY_RECORDS,
            "activity_records": len(activities),
            "message": "At least 20 activity records are required for unsupervised anomaly detection.",
            "flagged_count": 0,
            "items": [],
        }
    if IsolationForest is None:
        return {
            "status": "unavailable",
            "method": "IsolationForest",
            "activity_records": len(activities),
            "message": "scikit-learn is not installed in the analytics runtime.",
            "flagged_count": 0,
            "items": [],
        }

    frame = pd.DataFrame(activities).copy()
    if frame.empty:
        return {"status": "insufficient_data", "method": "IsolationForest", "activity_records": 0, "flagged_count": 0, "items": []}

    frame["activity_id"] = frame.apply(lambda row: str(_pick(row.to_dict(), ["activity_id", "activity id", "id"]) or "N/A"), axis=1)
    frame["activity_name"] = frame.apply(lambda row: str(_pick(row.to_dict(), ["activity_name", "activity name", "name"]) or "Unnamed activity"), axis=1)
    frame["progress_variance"] = frame.apply(
        lambda row: (_percent(_pick(row.to_dict(), ["actual_progress", "physical_percent_complete"])) or 0.0)
        - (_percent(_pick(row.to_dict(), ["planned_progress", "planned percent complete"])) or 0.0),
        axis=1,
    )
    frame["total_float_days"] = frame.apply(lambda row: _number(_pick(row.to_dict(), ["total_float_days", "total float"])), axis=1)
    planned_finish = frame.apply(lambda row: _pick(row.to_dict(), ["planned_finish", "baseline_finish", "bl finish"]), axis=1)
    forecast_finish = frame.apply(lambda row: _pick(row.to_dict(), ["forecast_finish", "current_finish", "finish"]), axis=1)
    frame["finish_variance_days"] = (
        pd.to_datetime(forecast_finish, errors="coerce", dayfirst=True)
        - pd.to_datetime(planned_finish, errors="coerce", dayfirst=True)
    ).dt.days
    frame["critical_flag"] = frame.apply(
        lambda row: 1.0 if str(_pick(row.to_dict(), ["is_critical", "critical", "critical_path"]) or "").strip().lower() in {"yes", "true", "1"} else 0.0,
        axis=1,
    )

    feature_names = ["progress_variance", "total_float_days", "finish_variance_days", "critical_flag"]
    matrix = frame[feature_names].apply(pd.to_numeric, errors="coerce")
    usable = [column for column in matrix.columns if matrix[column].notna().sum() >= 5 and matrix[column].nunique(dropna=True) > 1]
    if len(usable) < 2:
        return {
            "status": "insufficient_signal",
            "method": "IsolationForest",
            "activity_records": len(frame),
            "features_available": usable,
            "message": "At least two varying activity risk signals are required for anomaly detection.",
            "flagged_count": 0,
            "items": [],
        }

    normalized = matrix[usable].copy()
    for column in usable:
        normalized[column] = normalized[column].fillna(normalized[column].median())
    model = IsolationForest(n_estimators=200, contamination="auto", random_state=42)
    labels = model.fit_predict(normalized)
    scores = -model.decision_function(normalized)
    medians = normalized.median()
    mads = (normalized - medians).abs().median().replace(0, np.nan)
    standardized = (normalized - medians) / (mads * 1.4826)
    fallback_std = normalized.std().replace(0, 1.0)
    standardized = standardized.fillna((normalized - normalized.mean()) / fallback_std).fillna(0.0)

    reason_labels = {
        "progress_variance": "material actual-versus-planned progress variance",
        "total_float_days": "unusual total-float position",
        "finish_variance_days": "material forecast-finish variance",
        "critical_flag": "critical-path status differs from comparable activities",
    }
    candidates: list[dict[str, Any]] = []
    for index, label in enumerate(labels):
        if label != -1:
            continue
        row = frame.iloc[index]
        feature = str(standardized.iloc[index].abs().idxmax())
        candidates.append(
            {
                "activity_id": row["activity_id"],
                "activity_name": row["activity_name"],
                "anomaly_score": round(float(scores[index]), 4),
                "reason": reason_labels[feature],
            }
        )
    candidates.sort(key=lambda item: float(item["anomaly_score"]), reverse=True)
    return {
        "status": "ready",
        "method": "scikit-learn IsolationForest",
        "activity_records": len(frame),
        "features_available": usable,
        "flagged_count": len(candidates),
        "items": candidates[:10],
        "message": "Unsupervised outlier screening. Review flagged activities against the schedule and source evidence before acting.",
    }


def _s_curve_forecast(s_curve: list[dict[str, Any]], contract_value: float | None) -> tuple[dict[str, Any], pd.DataFrame]:
    frame = pd.DataFrame(s_curve).copy()
    if frame.empty or len(frame) < MIN_S_CURVE_PERIODS:
        return (
            {
                "status": "insufficient_data",
                "minimum_periods": MIN_S_CURVE_PERIODS,
                "periods_available": len(frame),
                "message": "At least six dated S-curve periods are required for a trend forecast.",
            },
            pd.DataFrame(),
        )
    frame["date"] = frame.apply(lambda row: _pick(row.to_dict(), ["months", "month", "date", "period"]), axis=1)
    frame["planned"] = frame.apply(lambda row: _number(_pick(row.to_dict(), ["cumm_monthly_planned", "cumulative_planned", "planned_cumulative"])), axis=1)
    frame["actual"] = frame.apply(lambda row: _number(_pick(row.to_dict(), ["cumm_monthly_actual", "cumulative_actual", "actual_cumulative"])), axis=1)
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce", dayfirst=True)
    frame = frame.dropna(subset=["date", "actual"]).sort_values("date").drop_duplicates(subset=["date"], keep="last")
    if len(frame) < MIN_S_CURVE_PERIODS:
        return (
            {
                "status": "insufficient_data",
                "minimum_periods": MIN_S_CURVE_PERIODS,
                "periods_available": len(frame),
                "message": "The S-curve needs six valid dated actual periods after data cleaning.",
            },
            frame,
        )

    target = contract_value if contract_value and contract_value > 0 else float(frame["planned"].max() or 0)
    if target <= 0:
        return ({"status": "insufficient_data", "periods_available": len(frame), "message": "No valid completion-value target is available."}, frame)

    actual_values = frame["actual"].to_numpy(dtype=float)
    method = "numpy linear trend fallback"
    forecast_values: np.ndarray
    try:
        if Holt is None:
            raise RuntimeError("statsmodels unavailable")
        fitted = Holt(actual_values, damped_trend=True, initialization_method="estimated").fit(optimized=True)
        forecast_values = np.asarray(fitted.forecast(24), dtype=float)
        method = "statsmodels damped Holt trend"
    except Exception:
        recent = min(6, len(actual_values))
        x = np.arange(recent, dtype=float)
        slope, intercept = np.polyfit(x, actual_values[-recent:], 1)
        forecast_values = intercept + slope * np.arange(recent, recent + 24, dtype=float)

    forecast_values = np.maximum.accumulate(np.maximum(forecast_values, 0.0))
    last_date = pd.Timestamp(frame["date"].iloc[-1])
    completion_index = next((index for index, value in enumerate(forecast_values, start=1) if value >= target), None)
    projected_date = (last_date + pd.DateOffset(months=completion_index)).date().isoformat() if completion_index else None
    trend_delta = float(actual_values[-1] - actual_values[max(0, len(actual_values) - 2)]) if len(actual_values) > 1 else 0.0
    forecast_frame = pd.DataFrame(
        {
            "date": [last_date + pd.DateOffset(months=index) for index in range(1, len(forecast_values) + 1)],
            "forecast": forecast_values,
        }
    )
    return (
        {
            "status": "ready",
            "method": method,
            "periods_available": len(frame),
            "current_actual_value": round(float(actual_values[-1]), 2),
            "current_planned_value": round(float(frame["planned"].dropna().iloc[-1]), 2) if frame["planned"].notna().any() else None,
            "completion_target_value": round(target, 2),
            "recent_period_change": round(trend_delta, 2),
            "projected_completion_date": projected_date,
            "months_to_target": completion_index,
            "message": "Trend projection only. Confirm against the accepted programme, actual updates, resource plan, and TIA before making contractual decisions.",
        },
        pd.concat([frame[["date", "planned", "actual"]], forecast_frame], ignore_index=True, sort=False),
    )


def _render_s_curve_chart(project_key: str, curve: pd.DataFrame, forecast: dict[str, Any], output_dir: Path) -> str | None:
    if curve.empty or not {"date", "actual"}.issubset(curve.columns):
        return None
    try:
        output_dir.mkdir(parents=True, exist_ok=True)
        if sns is not None:
            sns.set_theme(style="darkgrid", context="notebook")
        figure, axis = plt.subplots(figsize=(11, 5.5), dpi=140)
        actual = curve.dropna(subset=["actual"])
        planned = curve.dropna(subset=["planned"])
        projected = curve.dropna(subset=["forecast"])
        if not planned.empty:
            axis.plot(planned["date"], planned["planned"], color="#63a8ff", linewidth=2.1, label="Cumulative planned")
        axis.plot(actual["date"], actual["actual"], color="#39d7d2", linewidth=2.5, label="Cumulative actual")
        if not projected.empty:
            axis.plot(projected["date"], projected["forecast"], color="#d6a23a", linewidth=2.0, linestyle="--", label="Trend projection")
        target = forecast.get("completion_target_value")
        if isinstance(target, (int, float)):
            axis.axhline(target, color="#fb7185", linewidth=1.2, linestyle=":", label="Completion value target")
        axis.set_title("S-Curve Trend and Indicative Completion Projection", loc="left", fontweight="bold")
        axis.set_xlabel("Period")
        axis.set_ylabel("Cumulative value")
        axis.legend(frameon=False, loc="upper left")
        figure.tight_layout()
        output = output_dir / f"{project_key}-s-curve-analytics.png"
        figure.savefig(output, bbox_inches="tight", facecolor="white")
        plt.close(figure)
        return f"/data/analytics/{output.name}"
    except Exception:
        return None


def _technical_topics(rows: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    texts: list[str] = []
    for dataset, fields in {
        "activities": ["activity_name", "activity name"],
        "risks": ["risk_title", "risk title"],
        "delay_events": ["Activity Name", "Primary Event ID", "reason for delay"],
    }.items():
        for row in rows.get(dataset, []):
            value = _pick(row, fields)
            if value:
                texts.append(str(value))

    tokens: list[str] = []
    method = "regex keyword extraction"
    if spacy is not None and texts:
        try:
            nlp = spacy.blank("en")
            document = nlp(" ".join(texts))
            tokens = [token.text.lower() for token in document if token.is_alpha and not token.is_stop and len(token.text) > 2]
            method = "spaCy normalized keyword extraction"
        except Exception:
            tokens = []
    if not tokens:
        tokens = [token.lower() for token in re.findall(r"[A-Za-z]{3,}", " ".join(texts))]
    stop = {"the", "and", "for", "with", "from", "below", "above", "works", "work", "project", "activity"}
    frequencies = Counter(token for token in tokens if token not in stop)
    return {
        "status": "ready" if texts else "insufficient_data",
        "method": method,
        "source_text_records": len(texts),
        "topics": [{"term": term, "count": count} for term, count in frequencies.most_common(12)],
    }


def _model_governance(history_records: int) -> dict[str, Any]:
    libraries = _library_status()
    supervised_ready = history_records >= MIN_SUPERVISED_HISTORY
    deep_ready = history_records >= MIN_DEEP_LEARNING_HISTORY
    return {
        "libraries": libraries,
        "xgboost": {
            "status": "eligible" if supervised_ready and libraries["xgboost"]["installed"] else "not_trained",
            "minimum_labelled_records": MIN_SUPERVISED_HISTORY,
            "records_available": history_records,
            "reason": "Requires labelled historic outcomes such as verified delay days, cost variance, or completion performance.",
        },
        "pytorch": {
            "status": "eligible" if deep_ready and libraries["pytorch"]["installed"] else "not_trained",
            "minimum_labelled_records": MIN_DEEP_LEARNING_HISTORY,
            "records_available": history_records,
            "reason": "Requires a large, validated labelled data set and an approved model-governance process.",
        },
        "tensorflow": {
            "status": "eligible" if deep_ready and libraries["tensorflow"]["installed"] else "not_trained",
            "minimum_labelled_records": MIN_DEEP_LEARNING_HISTORY,
            "records_available": history_records,
            "reason": "Requires a large, validated labelled data set and an approved model-governance process.",
        },
    }


def build_advanced_analytics(
    *,
    project_key: str,
    rows: dict[str, list[dict[str, Any]]],
    contract_value: float | None,
    output_dir: Path,
) -> dict[str, Any]:
    """Build strictly project-scoped, source-backed analytics for one project."""
    anomalies = _activity_anomalies(rows.get("activities", []))
    forecast, curve = _s_curve_forecast(rows.get("s_curve", []), contract_value)
    chart_url = _render_s_curve_chart(project_key, curve, forecast, output_dir)
    topics = _technical_topics(rows)
    historical_outcomes = rows.get("historical_outcomes", [])
    return {
        "engine_version": ENGINE_VERSION,
        "scope": "selected_project_only",
        "data_profile": {
            "activity_records": len(rows.get("activities", [])),
            "s_curve_periods": len(rows.get("s_curve", [])),
            "delay_event_records": len(rows.get("delay_events", [])),
            "risk_records": len(rows.get("risks", [])),
            "labelled_historical_outcome_records": len(historical_outcomes),
        },
        "activity_anomalies": anomalies,
        "s_curve_forecast": forecast,
        "s_curve_chart_url": chart_url,
        "technical_topics": topics,
        "model_governance": _model_governance(len(historical_outcomes)),
        "disclaimer": "Analytics are decision-support indicators generated from the selected project files. They do not replace accepted programme updates, Primavera P6 recalculation, contractual interpretation, or engineering review.",
    }
