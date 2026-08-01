"""Build source-backed chart payloads for one isolated project."""

from __future__ import annotations

import json
import math
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "config" / "chart_catalog.json"
VALID_DELAY_TYPES = {"excusable", "non-excusable", "concurrent", "unclassified"}
VALID_ENTITLEMENTS = {"compensable", "excusable only", "non-compensable", "unresolved"}
VALID_RELATIONSHIPS = {"FS", "SS", "FF", "SF"}
DATE_FORMATS = ("%Y-%m-%d", "%Y-%m", "%d-%b-%y", "%d-%b-%Y", "%d/%m/%Y", "%m/%d/%Y")


def _normalize(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())


def _value(row: dict[str, Any], *names: str) -> Any:
    lowered = {_normalize(key): value for key, value in row.items()}
    for name in names:
        result = lowered.get(_normalize(name))
        if result not in (None, ""):
            return result
    return None


def _number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(float(value)) else None
    match = re.search(r"[-+]?\d+(?:\.\d+)?", str(value).replace(",", ""))
    if not match:
        return None
    try:
        result = float(match.group(0))
    except ValueError:
        return None
    return result if math.isfinite(result) else None


def _percent(value: Any) -> float | None:
    number = _number(value)
    if number is None:
        return None
    number = number * 100 if 0 <= number <= 1 else number
    return number if 0 <= number <= 100 else None


def _date(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def _month(value: Any) -> str | None:
    parsed = _date(value)
    return parsed.strftime("%Y-%m") if parsed else None


def _catalog() -> tuple[str, dict[str, dict[str, Any]]]:
    try:
        payload = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return "unavailable", {}
    entries = payload.get("charts", []) if isinstance(payload, dict) else []
    return str(payload.get("version", "unversioned")), {str(item.get("id")): item for item in entries if isinstance(item, dict) and item.get("id")}


def _chart(
    definition: dict[str, Any],
    *,
    status: str,
    message: str,
    labels: list[str] | None = None,
    series: list[dict[str, Any]] | None = None,
    source_files: list[str] | None = None,
    validation: list[dict[str, str]] | None = None,
    scenario: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "id": definition.get("id"),
        "tab": definition.get("tab"),
        "title": definition.get("title"),
        "type": definition.get("type"),
        "status": status,
        "message": message,
        "labels": labels or [],
        "series": series or [],
        "source_lineage": {
            "files": source_files or list(definition.get("sources", [])),
            "required_columns": list(definition.get("required_columns", [])),
        },
        "validation": validation or [],
        "scenario": scenario or None,
    }


def _project_rows(
    rows: Iterable[dict[str, Any]], project_id: str, file_name: str
) -> tuple[list[tuple[int, dict[str, Any]]], list[dict[str, str]]]:
    accepted: list[tuple[int, dict[str, Any]]] = []
    issues: list[dict[str, str]] = []
    expected = project_id.casefold()
    for source_row, row in enumerate(rows, start=2):
        row_project_id = str(_value(row, "project_id") or "").strip()
        if not row_project_id:
            issues.append({"file": file_name, "source_row": str(source_row), "field": "project_id", "message": "Missing project_id; row was not used."})
        elif row_project_id.casefold() != expected:
            issues.append({"file": file_name, "source_row": str(source_row), "field": "project_id", "message": "Project ID does not match the selected project; row was not used."})
        else:
            accepted.append((source_row, row))
    return accepted, issues


def _payment_by_month(rows: Iterable[dict[str, Any]], project_id: str) -> tuple[dict[str, float], dict[str, float], list[dict[str, str]]]:
    paid: dict[str, float] = defaultdict(float)
    certified: dict[str, float] = defaultdict(float)
    accepted, issues = _project_rows(rows, project_id, "payments.csv")
    for source_row, row in accepted:
        period = _month(_value(row, "invoice date", "date of cash cheque receipt", "period_date", "date"))
        if not period:
            issues.append({"file": "payments.csv", "source_row": str(source_row), "field": "invoice date", "message": "A valid payment date is required for cash-flow charting."})
            continue
        paid_value = _number(_value(row, "paid amount", "paid_amount", "paid", "payment_amount"))
        certified_value = _number(_value(row, "certified amount", "certified_amount", "certified"))
        if paid_value is not None:
            paid[period] += paid_value
        if certified_value is not None:
            certified[period] += certified_value
    return dict(paid), dict(certified), issues


def _cash_flow(definition: dict[str, Any], project_id: str, planned_rows: list[dict[str, Any]], payment_rows: list[dict[str, Any]]) -> dict[str, Any]:
    accepted, issues = _project_rows(planned_rows, project_id, "planned_cash_flow.csv")
    planned: dict[str, float] = defaultdict(float)
    for source_row, row in accepted:
        period = _month(_value(row, "period_date"))
        value = _number(_value(row, "planned_cash_out"))
        if not period or value is None:
            issues.append({"file": "planned_cash_flow.csv", "source_row": str(source_row), "field": "period_date/planned_cash_out", "message": "Valid period_date and planned_cash_out are required."})
            continue
        planned[period] += value
    paid, certified, payment_issues = _payment_by_month(payment_rows, project_id)
    issues.extend(payment_issues)
    if not planned:
        return _chart(definition, status="awaiting_data", message="Add project-matched planned cash-flow periods to activate this chart.", validation=issues)
    labels = sorted(set(planned) | set(paid) | set(certified))
    return _chart(
        definition,
        status="ready" if paid or certified else "partial",
        message="Planned values are compared with selected-project certified and paid payment records." if paid or certified else "Planned cash-flow is available; no dated selected-project payment record was matched.",
        labels=labels,
        series=[
            {"label": "Planned cash out", "color": "#d6a23a", "values": [planned.get(label) for label in labels]},
            {"label": "Certified", "color": "#63a8ff", "values": [certified.get(label) for label in labels]},
            {"label": "Paid", "color": "#39d7d2", "values": [paid.get(label) for label in labels]},
        ],
        validation=issues,
    )


def _delay_event_index(rows: Iterable[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        event_id = str(_value(row, "Primary Event ID", "event_id", "event reference") or "").strip()
        if event_id:
            result[event_id.casefold()] = row
    return result


def _classifications(
    definition_by_id: dict[str, dict[str, Any]], project_id: str, classification_rows: list[dict[str, Any]], delay_rows: list[dict[str, Any]]
) -> tuple[dict[str, Any], dict[str, Any]]:
    root_definition = definition_by_id["delay.root_cause_pareto"]
    type_definition = definition_by_id["delay.type_distribution"]
    accepted, issues = _project_rows(classification_rows, project_id, "14-delay_event_classification.csv")
    event_index = _delay_event_index(delay_rows)
    causes: dict[str, float] = defaultdict(float)
    types: dict[str, float] = defaultdict(float)
    valid_count = 0
    for source_row, row in accepted:
        status = str(_value(row, "analyst_status") or "").strip().casefold()
        if status != "verified":
            issues.append({"file": "14-delay_event_classification.csv", "source_row": str(source_row), "field": "analyst_status", "message": "Only Verified classifications are used for delay charts."})
            continue
        event_id = str(_value(row, "event_id") or "").strip()
        matching_event = event_index.get(event_id.casefold())
        activity_id = str(_value(row, "activity_id") or "").strip()
        if not event_id or matching_event is None:
            issues.append({"file": "14-delay_event_classification.csv", "source_row": str(source_row), "field": "event_id", "message": "Event ID is not present in this selected project's delay_events.csv."})
            continue
        event_activity = str(_value(matching_event, "Activity ID", "activity_id") or "").strip()
        if activity_id and event_activity and activity_id.casefold() != event_activity.casefold():
            issues.append({"file": "14-delay_event_classification.csv", "source_row": str(source_row), "field": "activity_id", "message": "Activity ID does not match the linked selected-project delay event."})
            continue
        cause = str(_value(row, "root_cause") or "").strip()
        delay_type = str(_value(row, "delay_type") or "").strip()
        entitlement = str(_value(row, "entitlement_status") or "").strip()
        delay_days = _number(_value(row, "delay_days"))
        if not cause or delay_days is None or delay_days < 0:
            issues.append({"file": "14-delay_event_classification.csv", "source_row": str(source_row), "field": "root_cause/delay_days", "message": "Root cause and a non-negative delay_days value are required."})
            continue
        if delay_type.casefold() not in VALID_DELAY_TYPES or entitlement.casefold() not in VALID_ENTITLEMENTS:
            issues.append({"file": "14-delay_event_classification.csv", "source_row": str(source_row), "field": "delay_type/entitlement_status", "message": "Delay type or entitlement status is outside the approved controlled values."})
            continue
        causes[cause] += delay_days
        types[delay_type] += delay_days
        valid_count += 1
    if not valid_count:
        message = "Add Verified classifications linked to selected-project delay events to activate delay root-cause and type charts."
        return _chart(root_definition, status="awaiting_data", message=message, validation=issues), _chart(type_definition, status="awaiting_data", message=message, validation=issues)
    cause_labels = [label for label, _ in sorted(causes.items(), key=lambda item: (-item[1], item[0].casefold()))]
    type_labels = [label for label, _ in sorted(types.items(), key=lambda item: (-item[1], item[0].casefold()))]
    return (
        _chart(root_definition, status="ready", message="Verified selected-project delay classifications only.", labels=cause_labels, series=[{"label": "Delay days", "color": "#fb7185", "values": [causes[label] for label in cause_labels]}], validation=issues),
        _chart(type_definition, status="ready", message="Verified selected-project delay classifications only.", labels=type_labels, series=[{"label": "Delay days", "color": "#a78bfa", "values": [types[label] for label in type_labels]}], validation=issues),
    )


def _recovery(definition: dict[str, Any], project_id: str, recovery_rows: list[dict[str, Any]], activity_rows: list[dict[str, Any]]) -> dict[str, Any]:
    accepted, issues = _project_rows(recovery_rows, project_id, "15-tia_recovery_scenario.csv")
    activity_ids = {str(_value(row, "activity_id", "Activity ID") or "").strip().casefold() for row in activity_rows}
    scenarios: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for source_row, row in accepted:
        scenario_id = str(_value(row, "scenario_id") or "").strip()
        activity_id = str(_value(row, "activity_id") or "").strip()
        date = _date(_value(row, "status_date"))
        status = str(_value(row, "analyst_status") or "").strip().casefold()
        values = [_percent(_value(row, field)) for field in ("baseline_progress_percent", "impacted_progress_percent", "recovery_progress_percent")]
        relationship = str(_value(row, "relationship_type") or "").strip().upper()
        if not scenario_id or not activity_id or not date or any(value is None for value in values):
            issues.append({"file": "15-tia_recovery_scenario.csv", "source_row": str(source_row), "field": "scenario/activity/status_date/progress", "message": "Scenario ID, Activity ID, status date, and all three progress values are required."})
            continue
        if activity_id.casefold() not in activity_ids:
            issues.append({"file": "15-tia_recovery_scenario.csv", "source_row": str(source_row), "field": "activity_id", "message": "Activity ID is not present in this selected project's activities.csv."})
            continue
        if status not in {"draft", "verified"}:
            issues.append({"file": "15-tia_recovery_scenario.csv", "source_row": str(source_row), "field": "analyst_status", "message": "Analyst status must be Draft or Verified."})
            continue
        if relationship and relationship not in VALID_RELATIONSHIPS:
            issues.append({"file": "15-tia_recovery_scenario.csv", "source_row": str(source_row), "field": "relationship_type", "message": "Relationship type must be FS, SS, FF, or SF when supplied."})
            continue
        if status == "verified" and (not str(_value(row, "p6_update_reference") or "").strip() or not str(_value(row, "evidence_reference") or "").strip()):
            issues.append({"file": "15-tia_recovery_scenario.csv", "source_row": str(source_row), "field": "p6_update_reference/evidence_reference", "message": "Verified recovery rows require P6 update and evidence references."})
            continue
        scenarios[scenario_id].append({"date": date, "status": status, "values": values, "activity_id": activity_id})
    if not scenarios:
        return _chart(definition, status="awaiting_data", message="Add a project-matched P6 recovery scenario to activate this chart.", validation=issues)
    ranked = sorted(
        scenarios.items(),
        key=lambda item: (any(row["status"] == "verified" for row in item[1]), max(row["date"] for row in item[1]), item[0]),
        reverse=True,
    )
    scenario_id, scenario_rows = ranked[0]
    scenario_rows.sort(key=lambda row: row["date"])
    verified = all(row["status"] == "verified" for row in scenario_rows)
    labels = [row["date"].strftime("%Y-%m-%d") for row in scenario_rows]
    return _chart(
        definition,
        status="ready" if verified else "draft",
        message="Verified P6-supported recovery scenario." if verified else "Draft recovery scenario. It is not a contractual EOT conclusion.",
        labels=labels,
        series=[
            {"label": "Baseline", "color": "#63a8ff", "values": [row["values"][0] for row in scenario_rows]},
            {"label": "Impacted", "color": "#fb7185", "values": [row["values"][1] for row in scenario_rows]},
            {"label": "Recovery", "color": "#39d7d2", "values": [row["values"][2] for row in scenario_rows]},
        ],
        validation=issues,
        scenario={"scenario_id": scenario_id, "analyst_status": "Verified" if verified else "Draft", "activity_count": len({row["activity_id"] for row in scenario_rows})},
    )


def _reference_chart(
    *, chart_id: str, tab: str, title: str, chart_type: str, labels: list[str], series: list[dict[str, Any]],
    source_files: list[str], message: str, status: str = "ready",
) -> dict[str, Any]:
    """Create a project-local chart payload using the SAMCO reference chart schema."""
    return {
        "id": chart_id,
        "tab": tab,
        "title": title,
        "type": chart_type,
        "status": status,
        "message": message,
        "labels": labels,
        "series": series,
        "source_lineage": {"files": source_files, "required_columns": ["project_id"]},
        "validation": [],
        "scenario": None,
    }


def _workspace_rows(rows: list[dict[str, Any]], project_id: str) -> list[dict[str, Any]]:
    accepted, _ = _project_rows(rows, project_id, "workspace source")
    return [row for _, row in accepted]


def _group_numeric(rows: list[dict[str, Any]], label_fields: tuple[str, ...], value_fields: tuple[str, ...]) -> tuple[list[str], list[float]]:
    totals: dict[str, float] = defaultdict(float)
    for row in rows:
        label = str(_value(row, *label_fields) or "").strip()
        value = _number(_value(row, *value_fields))
        if label and value is not None:
            totals[label] += value
    labels = [label for label, _ in sorted(totals.items(), key=lambda item: (-item[1], item[0].casefold()))]
    return labels, [round(totals[label], 4) for label in labels]


def _group_count(rows: list[dict[str, Any]], label_fields: tuple[str, ...]) -> tuple[list[str], list[float]]:
    """Count selected-project records by a real categorical field."""
    totals: dict[str, float] = defaultdict(float)
    for row in rows:
        label = str(_value(row, *label_fields) or "").strip()
        if label:
            totals[label] += 1
    labels = [label for label, _ in sorted(totals.items(), key=lambda item: (-item[1], item[0].casefold()))]
    return labels, [totals[label] for label in labels]


def _workspace_reference_charts(
    project_id: str,
    rows: dict[str, list[dict[str, Any]]],
    metrics: dict[str, Any],
) -> list[dict[str, Any]]:
    """Build all chart families that have real selected-project source values."""
    charts: list[dict[str, Any]] = []
    activities = _workspace_rows(rows.get("activities", []), project_id)
    wbs = _workspace_rows(rows.get("wbs", []), project_id)
    milestones = _workspace_rows(rows.get("milestones", []), project_id)
    s_curve = _workspace_rows(rows.get("s_curve", []), project_id)
    evm = _workspace_rows(rows.get("evm", []), project_id)
    contracts = _workspace_rows(rows.get("contracts", []), project_id)
    payments = _workspace_rows(rows.get("payments", []), project_id)
    risks = _workspace_rows(rows.get("risks", []), project_id)
    delays = _workspace_rows(rows.get("delay_events", []), project_id)

    if activities:
        labels, values = _group_count(activities, ("responsible_party",))
        if labels:
            charts.append(_reference_chart(chart_id="activities.responsible_party_workload", tab="Activities", title="Responsible Party Workload", chart_type="horizontal_bar", labels=labels, series=[{"label": "Activities", "color": "#06b6d4", "values": values}], source_files=["activities.csv"], message="Selected-project activities grouped by responsible party."))
        status_labels, status_values = _group_numeric(activities, ("actual_progress",), ("planned_weight",))
        complete = sum(1 for row in activities if (_percent(_value(row, "actual_progress")) or 0) >= 99.99)
        started = sum(1 for row in activities if 0 < (_percent(_value(row, "actual_progress")) or 0) < 99.99)
        not_started = sum(1 for row in activities if (_percent(_value(row, "actual_progress")) or 0) <= 0)
        charts.append(_reference_chart(chart_id="activities.status_distribution", tab="Activities", title="Activity Status Distribution", chart_type="doughnut", labels=["Complete", "In progress", "Not started"], series=[{"label": "Activities", "color": "#06b6d4", "values": [complete, started, not_started]}], source_files=["activities.csv"], message="Status derived from selected-project actual progress values."))
        critical = sum(1 for row in activities if str(_value(row, "is_critical") or "").strip().casefold() in {"yes", "true", "1", "y"})
        near_critical = sum(1 for row in activities if (_number(_value(row, "total_float_days")) or 999999) <= 10 and str(_value(row, "is_critical") or "").strip().casefold() not in {"yes", "true", "1", "y"})
        charts.append(_reference_chart(chart_id="activities.critical_path", tab="Activities", title="Critical Path Activities", chart_type="doughnut", labels=["Critical", "Near critical", "Normal float"], series=[{"label": "Activities", "color": "#f43f5e", "values": [critical, near_critical, max(0, len(activities) - critical - near_critical)]}], source_files=["activities.csv"], message="Criticality and float are read only from the selected-project activity register."))

    if wbs:
        labels, values = _group_numeric(wbs, ("wbs_name", "wbs_code"), ("performance_%_complete", "schedule_%_complete"))
        if labels:
            charts.append(_reference_chart(chart_id="wbs.progress_distribution", tab="WBS", title="WBS Progress Distribution", chart_type="bar", labels=labels, series=[{"label": "Performance %", "color": "#06b6d4", "values": values}], source_files=["wbs.csv"], message="Selected-project WBS performance values."))
        labels, values = _group_numeric(wbs, ("wbs_name", "wbs_code"), ("bl_project_duration", "remaining_duration"))
        if labels:
            charts.append(_reference_chart(chart_id="wbs.duration_breakdown", tab="WBS", title="WBS Duration Breakdown", chart_type="horizontal_bar", labels=labels, series=[{"label": "Duration days", "color": "#8b5cf6", "values": values}], source_files=["wbs.csv"], message="Selected-project baseline or remaining WBS durations."))

    if milestones:
        health: dict[str, float] = defaultdict(float)
        types: dict[str, float] = defaultdict(float)
        variance_by_date: list[tuple[str, float]] = []
        for row in milestones:
            actual, forecast, planned = _date(_value(row, "actual_date")), _date(_value(row, "forecast_date")), _date(_value(row, "planned_date"))
            if actual:
                health["Complete"] += 1
            elif forecast and planned and forecast > planned:
                health["Delayed"] += 1
            else:
                health["On track"] += 1
            milestone_type = str(_value(row, "milestone_contractual_type") or "Unclassified").strip()
            types[milestone_type] += 1
            if forecast and planned:
                variance_by_date.append((planned.strftime("%Y-%m-%d"), round((forecast - planned).total_seconds() / 86400, 2)))
        charts.append(_reference_chart(chart_id="milestones.schedule_health", tab="Milestones", title="Milestone Schedule Health", chart_type="doughnut", labels=list(health), series=[{"label": "Milestones", "color": "#10b981", "values": list(health.values())}], source_files=["milestones.csv"], message="Selected-project milestone actual and forecast dates."))
        charts.append(_reference_chart(chart_id="milestones.type_breakdown", tab="Milestones", title="Milestone Type Breakdown", chart_type="bar", labels=list(types), series=[{"label": "Milestones", "color": "#8b5cf6", "values": list(types.values())}], source_files=["milestones.csv"], message="Selected-project contractual milestone classifications."))
        if variance_by_date:
            variance_by_date.sort()
            charts.append(_reference_chart(chart_id="milestones.variance_trend", tab="Milestones", title="Milestone Variance Trend", chart_type="line", labels=[item[0] for item in variance_by_date], series=[{"label": "Forecast variance days", "color": "#f43f5e", "values": [item[1] for item in variance_by_date]}], source_files=["milestones.csv"], message="Forecast minus planned dates from selected-project milestones."))

    if s_curve:
        curve_points = []
        for row in s_curve:
            period = str(_value(row, "months", "month", "period") or "").strip()
            planned, actual, invoiced = (_number(_value(row, field)) for field in ("cumm_monthly_planned", "cumm_monthly_actual", "cumm_monthly_invoiced"))
            if period and any(value is not None for value in (planned, actual, invoiced)):
                curve_points.append((period, planned, actual, invoiced))
        if curve_points:
            charts.append(_reference_chart(chart_id="scurve.master", tab="S-Curve", title="Master S-Curve", chart_type="line", labels=[item[0] for item in curve_points], series=[{"label": "Planned", "color": "#3b82f6", "values": [item[1] for item in curve_points]}, {"label": "Actual", "color": "#06b6d4", "values": [item[2] for item in curve_points]}, {"label": "Invoiced", "color": "#f59e0b", "values": [item[3] for item in curve_points]}], source_files=["s_curve.csv"], message="Cumulative selected-project planned, actual, and invoiced progress." , status="ready"))
            charts.append(_reference_chart(chart_id="scurve.variance", tab="S-Curve", title="Progress Variance Over Time", chart_type="bar", labels=[item[0] for item in curve_points], series=[{"label": "Actual less planned", "color": "#f43f5e", "values": [round((item[2] or 0) - (item[1] or 0), 4) if item[1] is not None and item[2] is not None else None for item in curve_points]}], source_files=["s_curve.csv"], message="Selected-project actual less planned cumulative progress."))

    if evm:
        by_period: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
        for row in evm:
            period = str(_value(row, "period", "date") or "").strip()
            if not period:
                continue
            for field, name in (("PV", "PV"), ("EV", "EV"), ("AC", "AC")):
                value = _number(_value(row, field))
                if value is not None:
                    by_period[period][name] += value
        if by_period:
            labels = sorted(by_period)
            charts.append(_reference_chart(chart_id="evm.burnup", tab="EVM Analysis", title="EVM Burn-Up", chart_type="line", labels=labels, series=[{"label": "PV", "color": "#f59e0b", "values": [by_period[label].get("PV") for label in labels]}, {"label": "EV", "color": "#06b6d4", "values": [by_period[label].get("EV") for label in labels]}, {"label": "AC", "color": "#f43f5e", "values": [by_period[label].get("AC") for label in labels]}], source_files=["evm.csv"], message="Period-based selected-project EVM values."))
        metric_labels = ["BAC", "PV", "EV", "AC", "EAC"]
        metric_values = [_number(metrics.get(key.lower())) for key in metric_labels]
        if any(value is not None for value in metric_values):
            charts.append(_reference_chart(chart_id="evm.variance_waterfall", tab="EVM Analysis", title="EVM Variance Waterfall", chart_type="bar", labels=metric_labels, series=[{"label": "EGP", "color": "#8b5cf6", "values": metric_values}], source_files=["evm.csv", "projects.csv"], message="Selected-project EVM totals and forecast."))

    if payments:
        dated: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
        status: dict[str, float] = defaultdict(float)
        for row in payments:
            period = _month(_value(row, "invoice date", "date of cash cheque receipt"))
            if period:
                for field, name in (("certified amount", "Certified"), ("paid amount", "Paid")):
                    value = _number(_value(row, field))
                    if value is not None:
                        dated[period][name] += value
            payment_status = str(_value(row, "payment status") or "Unclassified").strip()
            status[payment_status] += 1
        if dated:
            labels = sorted(dated)
            charts.append(_reference_chart(chart_id="contracts.payment_history", tab="Contracts", title="Payment History", chart_type="bar", labels=labels, series=[{"label": "Certified", "color": "#3b82f6", "values": [dated[label].get("Certified") for label in labels]}, {"label": "Paid", "color": "#10b981", "values": [dated[label].get("Paid") for label in labels]}], source_files=["payments.csv"], message="Dated selected-project certified and paid payment records."))
        if status:
            charts.append(_reference_chart(chart_id="contracts.payment_status", tab="Contracts", title="Payment Status Breakdown", chart_type="doughnut", labels=list(status), series=[{"label": "Payment records", "color": "#10b981", "values": list(status.values())}], source_files=["payments.csv"], message="Selected-project payment status records."))

    if contracts:
        original = sum(value or 0 for value in (_number(_value(row, "original_value", "contract_value")) for row in contracts))
        approved = sum(value or 0 for value in (_number(_value(row, "approved_variations")) for row in contracts))
        pending = sum(value or 0 for value in (_number(_value(row, "pending_variations")) for row in contracts))
        charts.append(_reference_chart(chart_id="contracts.variations", tab="Contracts", title="Contract vs Variations", chart_type="bar", labels=["Original", "Approved variations", "Pending variations", "Current total"], series=[{"label": "EGP", "color": "#f59e0b", "values": [original, approved, pending, original + approved + pending]}], source_files=["contracts.csv"], message="Selected-project contract value and variation fields."))

    if risks:
        labels, values = _group_numeric(risks, ("risk_category",), ("time_impact_days", "cost_impact"))
        if labels:
            charts.append(_reference_chart(chart_id="risks.category", tab="Risks", title="Risk Category Breakdown", chart_type="bar", labels=labels, series=[{"label": "Recorded impact", "color": "#f43f5e", "values": values}], source_files=["risks.csv"], message="Selected-project risk categories using available impact values."))
        statuses: dict[str, float] = defaultdict(float)
        for row in risks:
            statuses[str(_value(row, "status") or "Unclassified").strip()] += 1
        charts.append(_reference_chart(chart_id="risks.status", tab="Risks", title="Risk Status", chart_type="doughnut", labels=list(statuses), series=[{"label": "Risk records", "color": "#f43f5e", "values": list(statuses.values())}], source_files=["risks.csv"], message="Selected-project risk status records."))

    if delays:
        labels, values = _group_numeric(delays, ("Primary Event ID", "Activity Name"), ("Delayed duration after overlap", "Delayed duration"))
        if labels:
            charts.append(_reference_chart(chart_id="delay.events_timeline", tab="Delay Analysis - Time Impact Analysis", title="Delay Events Timeline", chart_type="bar", labels=labels, series=[{"label": "Indicative delay days", "color": "#f43f5e", "values": values}], source_files=["delay_events.csv"], message="Selected-project delay event durations. These are not a final EOT conclusion."))
    return charts


def build_project_chart_payloads(
    *,
    project_id: str,
    project_key: str,
    data_dir: Path,
    delay_dir: Path,
    payment_rows: list[dict[str, Any]],
    delay_event_rows: list[dict[str, Any]],
    activity_rows: list[dict[str, Any]],
    read_csv_rows: Any,
    workspace_rows: dict[str, list[dict[str, Any]]] | None = None,
    project_metrics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Return only project-owned, data-gated chart datasets and validation findings."""
    version, definitions = _catalog()
    required_ids = (
        "contracts.planned_vs_actual_cash_flow",
        "delay.root_cause_pareto",
        "delay.type_distribution",
        "delay.tia_recovery_scenario",
    )
    missing_definitions = [chart_id for chart_id in required_ids if chart_id not in definitions]
    if missing_definitions:
        return {"catalog_version": version, "project_id": project_id, "project_key": project_key, "charts": [], "validation": [{"file": "chart_catalog.json", "source_row": "", "field": "id", "message": f"Missing chart definitions: {', '.join(missing_definitions)}"}]}
    planned_rows = read_csv_rows(data_dir / "planned_cash_flow.csv")
    classification_rows = read_csv_rows(delay_dir / "14-delay_event_classification.csv")
    recovery_rows = read_csv_rows(delay_dir / "15-tia_recovery_scenario.csv")
    cash = _cash_flow(definitions[required_ids[0]], project_id, planned_rows, payment_rows)
    root_cause, delay_type = _classifications(definitions, project_id, classification_rows, delay_event_rows)
    recovery = _recovery(definitions[required_ids[3]], project_id, recovery_rows, activity_rows)
    charts = [cash, root_cause, delay_type, recovery]
    charts.extend(_workspace_reference_charts(project_id, workspace_rows or {"activities": activity_rows, "payments": payment_rows, "delay_events": delay_event_rows}, project_metrics or {}))
    validation = [issue for chart in charts for issue in chart.get("validation", [])]
    return {
        "catalog_version": version,
        "project_id": project_id,
        "project_key": project_key,
        "charts": charts,
        "ready_count": sum(chart["status"] == "ready" for chart in charts),
        "draft_count": sum(chart["status"] == "draft" for chart in charts),
        "awaiting_count": sum(chart["status"] == "awaiting_data" for chart in charts),
        "validation": validation,
    }
