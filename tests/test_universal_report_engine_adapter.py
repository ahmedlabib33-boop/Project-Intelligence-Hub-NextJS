from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from universal_report_engine_adapter import (  # noqa: E402
    CATALOG_MANIFEST_NAME,
    OUTPUT_FOLDER_NAME,
    ensure_universal_report_engine_catalog,
    is_released_artifact,
    ml_task_catalog,
    report_catalog,
)


def sample_project(project_id: str = "project-001") -> dict[str, object]:
    return {
        "project_id": project_id,
        "project_key": project_id.lower(),
        "project_display_name": "Project One",
        "fingerprint": "project-source-fingerprint",
        "metrics": {"contract_value": 1000000.0},
    }


def test_engine_catalog_reads_real_package_manifest() -> None:
    catalog = report_catalog()
    tasks = ml_task_catalog()

    assert len(catalog) == 30
    assert {item["key"] for item in catalog} >= {"eot", "delay", "executive", "ml_project_controls"}
    assert len(tasks) == 15
    assert any(task["key"] == "event_classification" for task in tasks)


def test_catalog_is_project_scoped_and_does_not_publish_source_paths(tmp_path: Path) -> None:
    project_root = tmp_path / "Project One"
    source_dir = project_root / "01-data" / "import_templates"
    source_dir.mkdir(parents=True)
    (source_dir / "activities.csv").write_text("project_id,activity_id\nproject-001,A-001\n", encoding="utf-8")
    (source_dir / "p6_activity_export.csv").write_text("project_id,activity_id\nproject-001,A-001\n", encoding="utf-8")
    output_dir = tmp_path / "11-outputs" / "Project One"

    payload = ensure_universal_report_engine_catalog(sample_project(), project_root, output_dir, "project-one")

    assert payload["project_id"] == "project-001"
    assert payload["project_key"] == "project-001"
    assert payload["summary"]["catalog_count"] == 30
    assert payload["summary"]["generated_count"] == 0
    assert all(item["status"] == "READY_TO_GENERATE" for item in payload["report_families"])

    persisted = json.loads((output_dir / OUTPUT_FOLDER_NAME / CATALOG_MANIFEST_NAME).read_text(encoding="utf-8"))
    assert persisted["project_id"] == "project-001"
    assert all("path" not in source for source in persisted["source_inventory"])
    assert str(project_root) not in json.dumps(persisted)
    assert "package_path" not in persisted["engine"]


def test_catalog_requires_project_identity(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="project_id and project_key"):
        ensure_universal_report_engine_catalog({}, tmp_path, tmp_path / "outputs", "project")


def test_only_passed_engine_packages_are_releaseable() -> None:
    assert is_released_artifact({"release_status": "PASS"})
    assert is_released_artifact({"release_status": "APPROVED"})
    assert not is_released_artifact({"release_status": "FAIL_VALIDATION_ERROR"})
    assert not is_released_artifact({})
