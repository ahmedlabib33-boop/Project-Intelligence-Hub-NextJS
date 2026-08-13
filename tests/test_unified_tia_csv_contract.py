from __future__ import annotations

import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from construction_system.controlled_tia import APPROVED_MATRIX_COLUMNS  # noqa: E402
from construction_system.unified_tia_csv import CSV_CONTRACTS, validate_pack, write_template_pack  # noqa: E402


def _write_rows(directory: Path, filename: str, rows: list[dict[str, str]]) -> None:
    contract = next(item for item in CSV_CONTRACTS if item.filename == filename)
    with (directory / filename).open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=contract.columns)
        writer.writeheader()
        writer.writerows(rows)


def _complete_project_pack(directory: Path) -> None:
    write_template_pack(directory)
    project_id = "TIA-TEST-001"
    project_key = "tia-test-project"
    rows = {
        "01_project_metadata.csv": [{
            "project_id": project_id, "project_key": project_key, "project_name": "TIA Test Project",
            "baseline_schedule_name": "BL-01", "baseline_data_date": "2026-01-01", "impacted_update_name": "UPD-01",
            "impacted_data_date": "2026-01-10", "analysis_data_date": "2026-01-10", "prepared_by": "Planner",
            "report_revision": "P01", "report_date": "2026-01-11", "project_finish_milestone_id": "PFIN",
        }],
        "02_source_file_register.csv": [
            {"project_id": project_id, "source_id": "SRC-BL", "source_role": "baseline_xer", "source_file_name": "baseline.xer", "source_relative_path": "source/baseline.xer", "source_status": "available"},
            {"project_id": project_id, "source_id": "SRC-UPD", "source_role": "impacted_xer", "source_file_name": "impacted.xer", "source_relative_path": "source/impacted.xer", "source_status": "available"},
            {"project_id": project_id, "source_id": "SRC-EV", "source_role": "notice", "source_file_name": "notice.pdf", "source_relative_path": "evidence/notice.pdf", "source_status": "available"},
        ],
        "03_native_xer_pair_register.csv": [{"project_id": project_id, "xer_pair_id": "PAIR-01", "event_variant": "EV01-A", "baseline_source_id": "SRC-BL", "impacted_source_id": "SRC-UPD", "data_date": "2026-01-10", "parity_status": "approved"}],
        "04_p6_activity_register.csv": [
            {"project_id": project_id, "schedule_version": "baseline", "activity_id": "A1", "activity_name": "Start", "activity_type": "Task Dependent", "source_id": "SRC-BL"},
            {"project_id": project_id, "schedule_version": "baseline", "activity_id": "A2", "activity_name": "Affected Work", "activity_type": "Task Dependent", "source_id": "SRC-BL"},
            {"project_id": project_id, "schedule_version": "baseline", "activity_id": "PFIN", "activity_name": "Project Finish", "activity_type": "Finish Milestone", "source_id": "SRC-BL"},
            {"project_id": project_id, "schedule_version": "impacted", "activity_id": "A1", "activity_name": "Start", "activity_type": "Task Dependent", "source_id": "SRC-UPD"},
            {"project_id": project_id, "schedule_version": "impacted", "activity_id": "A2", "activity_name": "Affected Work", "activity_type": "Task Dependent", "source_id": "SRC-UPD"},
            {"project_id": project_id, "schedule_version": "impacted", "activity_id": "PFIN", "activity_name": "Project Finish", "activity_type": "Finish Milestone", "source_id": "SRC-UPD"},
        ],
        "05_p6_relationship_register.csv": [{"project_id": project_id, "schedule_version": "baseline", "successor_activity_id": "A2", "predecessor_activity_id": "A1", "relationship_type": "FS", "source_id": "SRC-BL"}],
        "06_delay_event_register.csv": [{"project_id": project_id, "event_id": "EV01", "event_variant": "EV01-A", "event_name": "Late information", "responsible_party": "Employer", "event_start": "2026-01-02", "event_finish": "2026-01-06", "affected_activity_id": "A2", "evidence_reference": "N-001", "source_id": "SRC-EV", "causation_status": "verified", "criticality_status": "verified", "inclusion_in_integrated_eot": "included", "analyst_status": "verified"}],
        "07_fragnet_activity_register.csv": [{"project_id": project_id, "event_variant": "EV01-A", "fragnet_activity_id": "F1", "fragnet_activity_name": "Information approval", "activity_type": "Task Dependent", "original_duration_days": "5", "affected_activity_id": "A2", "source_id": "SRC-EV", "analyst_status": "verified"}],
        "08_fragnet_relationship_register.csv": [{"project_id": project_id, "event_variant": "EV01-A", "successor_activity_id": "A2", "predecessor_activity_id": "F1", "relationship_type": "FS", "source_id": "SRC-EV"}],
        "09_before_after_fragnet_comparison.csv": [{"project_id": project_id, "project_key": project_key, "event_id": "EV01", "event_variant": "EV01-A", "data_date": "2026-01-10", "activity_id": "PFIN", "milestone_activity_name": "Project Finish", "before_forecast_finish": "2026-01-01", "after_forecast_finish": "2026-01-06", "finish_movement_calendar_days": "5", "impact_assessment": "critical", "inclusion_in_integrated_eot": "included", "evidence_reference": "N-001", "verification_status": "approved"}],
        "10_concurrency_entitlement_register.csv": [{"project_id": project_id, "event_variant": "EV01-A", "overlap_id": "OV-01", "affected_activity_id": "A2", "apportionment_method": "No concurrency", "concurrency_adjustment_days": "0", "included_in_adjustment": "included", "entitlement_position": "time only", "evidence_reference": "N-001", "verification_status": "verified"}],
        "11_entitlement_evidence_register.csv": [{"project_id": project_id, "event_variant": "EV01-A", "evidence_id": "E-01", "evidence_type": "Notice", "evidence_reference": "N-001", "notice_status": "timely", "time_bar_status": "complied", "causation_status": "verified", "criticality_status": "verified", "entitlement_status": "under review", "source_id": "SRC-EV", "verification_status": "verified"}],
        "12_delay_event_classification.csv": [{"project_id": project_id, "event_id": "EV01", "activity_id": "A2", "root_cause": "Late information", "delay_type": "Employer", "entitlement_status": "under review", "responsible_party": "Employer", "event_start": "2026-01-02", "event_finish": "2026-01-06", "delay_days": "5", "evidence_reference": "N-001", "source_file": "notice.pdf", "source_row": "1", "analyst_status": "verified"}],
        "13_tia_recovery_scenario.csv": [{"project_id": project_id, "scenario_id": "RCV-01", "scenario_name": "Recovery", "analyst_status": "verified", "activity_id": "A2", "status_date": "2026-01-10", "baseline_progress_percent": "10", "impacted_progress_percent": "5", "recovery_progress_percent": "10", "p6_update_reference": "UPD-01", "evidence_reference": "N-001", "source_file": "recovery.xlsx", "source_row": "1"}],
        "14_controlled_release_register.csv": [{"project_id": project_id, "project_key": project_key, "release_id": "REL-01", "release_status": "submitted", "approval_status": "submitted", "baseline_project_finish": "2026-01-01", "impacted_project_finish": "2026-01-06", "project_finish_milestone_id": "PFIN", "gross_included_event_movement_days": "5", "concurrency_adjustment_days": "0", "integrated_eot_calendar_days": "5", "approved_matrix_reference": "09_before_after_fragnet_comparison.csv", "source_manifest_reference": "submission_manifest.json"}],
        "15_reconciliation_register.csv": [{"project_id": project_id, "reconciliation_id": "RC-01", "issue_type": "Source", "issue_description": "No open issue", "resolution_required": "None", "owner": "Planner", "status": "resolved"}],
        "16_output_artifact_register.csv": [{"project_id": project_id, "release_id": "REL-01", "artifact_id": "ART-01", "artifact_type": "HTML", "artifact_title": "TIA Dashboard", "output_filename": "tia.html", "source_project_id": project_id, "source_report_fingerprint": "abc123", "generated_at": "2026-01-11T10:00:00", "review_status": "reviewed", "publication_status": "not_published"}],
    }
    for filename, file_rows in rows.items():
        _write_rows(directory, filename, file_rows)


def test_published_and_project_template_packs_are_schema_valid_and_identical() -> None:
    public_pack = ROOT / "website" / "public" / "tia-unified-csv"
    project_template_pack = ROOT / "projects" / "_PROJECT_TEMPLATE" / "02-delay_analysis" / "unified_tia_csv"
    assert validate_pack(public_pack, template_mode=True)["passed"]
    assert validate_pack(project_template_pack, template_mode=True)["passed"]
    for contract in CSV_CONTRACTS:
        assert (public_pack / contract.filename).read_bytes() == (project_template_pack / contract.filename).read_bytes()


def test_unified_matrix_preserves_controlled_submission_matrix_contract() -> None:
    matrix = next(item for item in CSV_CONTRACTS if item.filename == "09_before_after_fragnet_comparison.csv")
    assert matrix.columns == APPROVED_MATRIX_COLUMNS


def test_complete_project_pack_is_ready_for_native_p6_review_and_isolated(tmp_path: Path) -> None:
    _complete_project_pack(tmp_path)
    result = validate_pack(tmp_path, expected_project_id="TIA-TEST-001", expected_project_key="tia-test-project")
    assert result["passed"], result["issues"]
    assert result["readiness"] == "READY_FOR_NATIVE_P6_REVIEW"

    metadata = tmp_path / "01_project_metadata.csv"
    text = metadata.read_text(encoding="utf-8")
    metadata.write_text(text.replace("TIA-TEST-001", "OTHER-001", 1), encoding="utf-8")
    isolated = validate_pack(tmp_path, expected_project_id="TIA-TEST-001", expected_project_key="tia-test-project")
    assert not isolated["passed"]
    assert any(issue["field"] == "project_id" for issue in isolated["issues"])
