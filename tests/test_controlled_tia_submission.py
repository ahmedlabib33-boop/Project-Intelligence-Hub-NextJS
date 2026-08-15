"""Regression controls for the ROYA The BIG approved EOT submission register."""

from __future__ import annotations

import json
from pathlib import Path

from construction_system.controlled_tia import CONDITIONAL_RESULT, SETUP_REQUIRED, build_controlled_tia_snapshot


ROOT = Path(__file__).resolve().parents[1]
THE_BIG = ROOT / "projects" / "Buildings" / "The BIG - PH01"
THE_BIG_ID = "The Big -P.01-UP-20-April-26"
THE_BIG_KEY = "the-big-p-01-up-20-april-26"


def the_big_project() -> dict[str, str]:
    return {"project_id": THE_BIG_ID, "project_key": THE_BIG_KEY, "project_dir": str(THE_BIG)}


def test_the_big_submission_matrix_is_the_active_position() -> None:
    snapshot = build_controlled_tia_snapshot(the_big_project())

    assert snapshot["status"] == CONDITIONAL_RESULT
    assert snapshot["approval_status"] == "submitted_position_pending_p6_verification"
    assert len(snapshot["schedule_cpm"]["approved_matrix"]) == 12

    position = snapshot["eot_position"]
    assert position["project_finish_milestone_id"] == "KD-MS-1050"
    assert position["ground_works_milestone_id"] == "KD-MS-1040"
    assert position["baseline_project_finish"] == "2027-05-12"
    assert position["impacted_project_finish"] == "2027-09-15"
    assert position["integrated_eot_calendar_days"] == 126

    concurrency = snapshot["concurrency_and_entitlement"]
    assert concurrency["gross_included_event_movement_days"] == 188
    assert concurrency["concurrency_adjustment_days"] == 62
    assert concurrency["integrated_eot_calendar_days"] == 126
    movements = {row["event_variant"]: row["project_finish_movement_calendar_days"] for row in concurrency["event_positions"]}
    assert movements["EV01-BATCH02"] == 117
    assert movements["EV02"] == 71
    assert movements["EV01-BATCH03"] == 37


def test_the_big_event_mapping_exhibits_are_evidence_only_and_project_scoped() -> None:
    snapshot = build_controlled_tia_snapshot(the_big_project())
    exhibits = snapshot["events_and_fragnets"]["event_exhibits"]

    assert [exhibit["event_id"] for exhibit in exhibits] == ["EV01", "EV02", "EV03", "EV04"]
    assert all(exhibit["project_id"] == THE_BIG_ID for exhibit in exhibits)
    assert all(exhibit["project_key"] == THE_BIG_KEY for exhibit in exhibits)
    assert all(exhibit["source_file"].endswith(".png") for exhibit in exhibits)
    assert all("mapping exhibit" in exhibit["evidence_use"].lower() for exhibit in exhibits)
    assert snapshot["eot_position"]["integrated_eot_calendar_days"] == 126


def test_the_big_view_exhibits_are_project_scoped_and_match_the_public_workflow() -> None:
    snapshot = build_controlled_tia_snapshot(the_big_project())
    exhibits = snapshot["view_exhibits"]

    assert snapshot["workflow_tabs"][0] == "Time Impact Methodology"
    assert [exhibit["view"] for exhibit in exhibits] == [
        "Time Impact Methodology",
        "Concurrency and Entitlement",
        "EOT Position",
    ]
    assert all(exhibit["project_id"] == THE_BIG_ID for exhibit in exhibits)
    assert all(exhibit["project_key"] == THE_BIG_KEY for exhibit in exhibits)
    assert all(exhibit["source_file"].endswith(".svg") for exhibit in exhibits)


def test_historic_values_are_reconciliation_only() -> None:
    snapshot = build_controlled_tia_snapshot(the_big_project())
    active = json.dumps({
        "eot": snapshot["eot_position"],
        "concurrency": snapshot["concurrency_and_entitlement"],
        "charts": snapshot["charts"],
    })

    assert "131 calendar days" not in active
    assert "164 calendar days" not in active
    assert "76 calendar days" not in active
    reconciliation = {item["id"]: item for item in snapshot["reconciliation_items"]}
    assert reconciliation["HIST-131"]["active_position"] == "126 calendar days"
    assert reconciliation["HIST-164"]["active_position"] == "126 calendar days"
    assert reconciliation["HIST-EV02-76"]["active_position"] == "71 calendar days"


def test_project_without_submission_never_receives_the_big_data(tmp_path: Path) -> None:
    other_project = tmp_path / "Other Project"
    other_project.mkdir()
    (other_project / "project_manifest.json").write_text(json.dumps({
        "project_id": "OTHER-001",
        "project_display_name": "Other Project",
        "project_folder_name": "Other Project",
        "status": "Active",
    }), encoding="utf-8")

    snapshot = build_controlled_tia_snapshot({
        "project_id": "OTHER-001",
        "project_key": "other-project",
        "project_dir": str(other_project),
    })

    assert snapshot["status"] == SETUP_REQUIRED
    assert snapshot["eot_position"]["label"] == "Not available"
    assert snapshot["schedule_cpm"]["xer_pairs"] == []
    assert snapshot["events_and_fragnets"]["event_exhibits"] == []
    assert snapshot["view_exhibits"] == []
