import csv
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from project_chart_payloads import build_project_chart_payloads  # noqa: E402


def _write_rows(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    headers = sorted({key for row in rows for key in row})
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)


def _write_header(path: Path, headers: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        csv.DictWriter(handle, fieldnames=headers).writeheader()


def _read_rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def _payload(
    tmp_path: Path,
    *,
    planned=None,
    classifications=None,
    recovery=None,
    payments=None,
    vercel_planned=None,
    vercel_header_only: bool = False,
):
    data_dir = tmp_path / "01-data" / "import_templates"
    delay_dir = tmp_path / "02-delay_analysis" / "steel_delay_tia_templates"
    vercel_dir = tmp_path / "vercel"
    if planned is not None:
        _write_rows(data_dir / "planned_cash_flow.csv", planned)
    if classifications is not None:
        _write_rows(delay_dir / "14-delay_event_classification.csv", classifications)
    if recovery is not None:
        _write_rows(delay_dir / "15-tia_recovery_scenario.csv", recovery)
    if vercel_planned is not None:
        _write_rows(vercel_dir / "planned_cash_flow.csv", vercel_planned)
    elif vercel_header_only:
        _write_header(
            vercel_dir / "planned_cash_flow.csv",
            ["project_id", "period_date", "planned_cash_out", "planned_cumulative_cash_out"],
        )
    return build_project_chart_payloads(
        project_id="P-01",
        project_key="p-01",
        data_dir=data_dir,
        delay_dir=delay_dir,
        payment_rows=payments or [],
        delay_event_rows=[{"event_id": "EV-01", "activity_id": "A-01"}],
        activity_rows=[{"activity_id": "A-01"}],
        read_csv_rows=_read_rows,
        vercel_dir=vercel_dir,
    )


def _chart(payload: dict, chart_id: str) -> dict:
    return next(chart for chart in payload["charts"] if chart["id"] == chart_id)


def test_cash_flow_is_project_scoped_and_never_uses_other_project_rows(tmp_path):
    payload = _payload(
        tmp_path,
        planned=[
            {"project_id": "P-01", "period_date": "2026-01", "planned_cash_out": "100"},
            {"project_id": "P-02", "period_date": "2026-01", "planned_cash_out": "9999"},
        ],
        payments=[
            {"project_id": "P-01", "invoice date": "2026-01-15", "paid_amount": "80"},
            {"project_id": "P-02", "invoice date": "2026-01-15", "paid_amount": "9999"},
        ],
    )

    chart = _chart(payload, "contracts.planned_vs_actual_cash_flow")
    assert chart["status"] == "ready"
    assert chart["labels"] == ["2026-01"]
    assert chart["series"][0]["values"] == [100.0]
    assert chart["series"][2]["values"] == [80.0]
    assert any("does not match" in issue["message"] for issue in chart["validation"])


def test_delay_classification_requires_verified_selected_project_event(tmp_path):
    payload = _payload(
        tmp_path,
        classifications=[
            {
                "project_id": "P-01",
                "event_id": "EV-01",
                "activity_id": "A-01",
                "root_cause": "Late IFC",
                "delay_type": "Excusable",
                "entitlement_status": "Excusable Only",
                "delay_days": "12",
                "analyst_status": "Verified",
            },
            {
                "project_id": "P-01",
                "event_id": "OTHER-PROJECT-EVENT",
                "activity_id": "A-01",
                "root_cause": "Not Allowed",
                "delay_type": "Excusable",
                "entitlement_status": "Excusable Only",
                "delay_days": "99",
                "analyst_status": "Verified",
            },
            {
                "project_id": "P-01",
                "event_id": "EV-01",
                "activity_id": "A-01",
                "root_cause": "Draft Only",
                "delay_type": "Excusable",
                "entitlement_status": "Excusable Only",
                "delay_days": "50",
                "analyst_status": "Draft",
            },
        ],
    )

    pareto = _chart(payload, "delay.root_cause_pareto")
    distribution = _chart(payload, "delay.type_distribution")
    assert pareto["status"] == distribution["status"] == "ready"
    assert pareto["labels"] == ["Late IFC"]
    assert pareto["series"][0]["values"] == [12.0]
    assert distribution["labels"] == ["Excusable"]
    assert any("not present" in issue["message"] for issue in pareto["validation"])


def test_recovery_requires_project_activity_and_marks_draft_not_contractual(tmp_path):
    draft_payload = _payload(
        tmp_path / "draft",
        recovery=[
            {
                "project_id": "P-01",
                "scenario_id": "REC-01",
                "analyst_status": "Draft",
                "activity_id": "A-01",
                "status_date": "2026-01-01",
                "baseline_progress_percent": "20",
                "impacted_progress_percent": "10",
                "recovery_progress_percent": "15",
                "relationship_type": "FS",
            }
        ],
    )
    draft_chart = _chart(draft_payload, "delay.tia_recovery_scenario")
    assert draft_chart["status"] == "draft"
    assert "not a contractual EOT conclusion" in draft_chart["message"]

    verified_payload = _payload(
        tmp_path / "verified",
        recovery=[
            {
                "project_id": "P-01",
                "scenario_id": "REC-02",
                "analyst_status": "Verified",
                "activity_id": "A-01",
                "status_date": "2026-02-01",
                "baseline_progress_percent": "40",
                "impacted_progress_percent": "25",
                "recovery_progress_percent": "38",
                "relationship_type": "SS",
                "p6_update_reference": "UPD-02",
                "evidence_reference": "EV-02",
            },
            {
                "project_id": "P-02",
                "scenario_id": "FOREIGN",
                "analyst_status": "Verified",
                "activity_id": "A-01",
                "status_date": "2026-02-01",
                "baseline_progress_percent": "99",
                "impacted_progress_percent": "99",
                "recovery_progress_percent": "99",
                "p6_update_reference": "UPD-X",
                "evidence_reference": "EV-X",
            },
        ],
    )
    verified_chart = _chart(verified_payload, "delay.tia_recovery_scenario")
    assert verified_chart["status"] == "ready"
    assert verified_chart["scenario"]["scenario_id"] == "REC-02"
    assert verified_chart["series"][0]["values"] == [40.0]


def test_reference_catalogue_publishes_all_36_chart_slots(tmp_path):
    payload = _payload(tmp_path)
    chart_ids = [chart["id"] for chart in payload["charts"]]

    assert len(chart_ids) == 36
    assert len(chart_ids) == len(set(chart_ids))
    assert {chart["status"] for chart in payload["charts"]}.issubset(
        {"ready", "partial", "draft", "awaiting_data"}
    )
    assert all(chart["source_lineage"] for chart in payload["charts"])


def test_canonical_cash_flow_wins_over_legacy_vercel_copy(tmp_path):
    canonical = _payload(
        tmp_path / "preferred",
        planned=[{"project_id": "P-01", "period_date": "2026-01", "planned_cash_out": "100"}],
        vercel_planned=[{"project_id": "P-01", "period_date": "2026-01", "planned_cash_out": "125"}],
    )
    canonical_chart = _chart(canonical, "contracts.planned_vs_actual_cash_flow")
    assert canonical_chart["series"][0]["values"] == [100.0]
    assert canonical_chart["source_lineage"]["files"] == ["planned_cash_flow.csv", "payments.csv"]

    fallback = _payload(
        tmp_path / "fallback",
        planned=[{"project_id": "P-01", "period_date": "2026-01", "planned_cash_out": "100"}],
        vercel_header_only=True,
    )
    fallback_chart = _chart(fallback, "contracts.planned_vs_actual_cash_flow")
    assert fallback_chart["series"][0]["values"] == [100.0]
    assert fallback_chart["source_lineage"]["files"] == ["planned_cash_flow.csv", "payments.csv"]
