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
