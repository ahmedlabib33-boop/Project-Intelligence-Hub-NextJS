"""Regression test for a _text()/_int_value() bug: a legitimately zero
submitted value (no concurrency adjustment, a zero-day EOT, zero gross
event movement) must not be reported as a reconciliation failure.

``_text`` used to normalise any falsy Python value -- not just ``None`` --
to "", which made ``_int_value(0)`` return ``None`` instead of ``0``. That
turned an honest "0 days" submission into a fabricated RECONCILIATION_
REQUIRED result purely because of how the value was spelled in JSON.
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from construction_system.controlled_tia import CONDITIONAL_RESULT, build_controlled_tia_snapshot  # noqa: E402


def _write_zero_day_submission(project_dir: Path, project_id: str, project_key: str) -> None:
    release_dir = project_dir / "release"
    release_dir.mkdir(parents=True)

    archive_path = release_dir / "release.zip"
    archive_path.write_bytes(b"synthetic-archive-for-zero-value-regression-test")
    archive_sha256 = hashlib.sha256(archive_path.read_bytes()).hexdigest()

    matrix_path = release_dir / "approved_before_after_fragnet_comparison.csv"
    header = [
        "project_id", "project_key", "event_id", "event_variant", "data_date",
        "activity_id", "milestone_activity_name", "before_total_float_days",
        "before_forecast_finish", "after_total_float_days", "after_forecast_finish",
        "float_change_days", "finish_movement_calendar_days", "impact_assessment",
        "inclusion_in_integrated_eot", "evidence_reference", "verification_status",
    ]
    row = [
        project_id, project_key, "EV99", "EV99-ZERO", "2027-01-01",
        "KD-MS-1050", "Project Finish", "0",
        "2027-06-01", "0", "2027-06-01",
        "0", "0", "No demonstrated impact",
        "included", "TEST-EV99", "not_recorded",
    ]
    matrix_path.write_text(",".join(header) + "\n" + ",".join(row) + "\n", encoding="utf-8")

    (release_dir / "ev99.png").write_bytes(b"synthetic-event-exhibit-image")

    manifest = {
        "project_id": project_id,
        "project_key": project_key,
        "archive": {"file": "release.zip", "sha256": archive_sha256},
        "submitted_eot_position": {
            "project_finish_milestone_id": "KD-MS-1050",
            "ground_works_milestone_id": "KD-MS-1040",
            "baseline_project_finish": "2027-06-01",
            "impacted_project_finish": "2027-06-01",
            "included_event_variants": ["EV99-ZERO"],
            "gross_included_event_movement_days": 0,
            "concurrency_adjustment_days": 0,
            "integrated_eot_calendar_days": 0,
        },
        "event_exhibits": [
            {"event_id": "EV99", "file": "ev99.png", "display_order": 0},
        ],
    }
    (release_dir / "submission_manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    (project_dir / "project_manifest.json").write_text(json.dumps({
        "project_id": project_id,
        "approved_tia_release": {
            "active": True,
            "source_type": "approved_eot_submission_archive",
            "source_path": "release",
        },
    }), encoding="utf-8")


def test_a_zero_day_submission_is_not_reported_as_a_reconciliation_failure(tmp_path: Path) -> None:
    project_id, project_key = "ZERO-EOT-001", "zero-eot-001"
    project_dir = tmp_path / "Zero EOT Project"
    project_dir.mkdir()
    _write_zero_day_submission(project_dir, project_id, project_key)

    snapshot = build_controlled_tia_snapshot({
        "project_id": project_id,
        "project_key": project_key,
        "project_dir": str(project_dir),
    })

    assert snapshot["status"] == CONDITIONAL_RESULT, snapshot["source_integrity"]["validation_findings"]
    assert snapshot["source_integrity"]["validation_findings"] == []
    assert snapshot["eot_position"]["integrated_eot_calendar_days"] == 0
    assert snapshot["concurrency_and_entitlement"]["gross_included_event_movement_days"] == 0
    assert snapshot["concurrency_and_entitlement"]["concurrency_adjustment_days"] == 0

    exhibits = snapshot["events_and_fragnets"]["event_exhibits"]
    assert len(exhibits) == 1
    # Explicitly submitted display_order: 0 must survive, not fall back to
    # the loop index (the "_int_value(...) or index" bug).
    assert exhibits[0]["display_order"] == 0
