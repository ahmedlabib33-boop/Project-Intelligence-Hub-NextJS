from pathlib import Path
import json
import sys

import pytest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from generate_nextjs_website_data import (  # noqa: E402
    build_project_record,
    build_submitted_tia_visuals,
    discover_projects,
    public_safe_payload,
    qualitative_risk_metrics,
    submitted_tia_guide_root,
)


def test_public_payload_removes_workstation_paths_but_preserves_relative_lineage():
    payload = public_safe_payload(
        {
            "project_id": "project-001",
            "file_path": r"C:\\private\\project\\contract.pdf",
            "source_path": "contracts.csv",
            "diagnostic": r"Could not open C:\\private\\project\\contract.pdf",
            "artifacts": [{"url": "/generated/project-001/report.pdf"}],
        }
    )

    assert "file_path" not in payload
    assert payload["source_path"] == "contracts.csv"
    assert "C:\\" not in payload["diagnostic"]
    assert payload["artifacts"][0]["url"] == "/generated/project-001/report.pdf"


def test_discovered_project_payload_is_json_serializable():
    projects = discover_projects()
    if not projects:
        pytest.skip("No project folders are available in this environment.")

    payload = build_project_record(projects[0])

    json.dumps(payload, ensure_ascii=False)


def test_risk_matrix_excludes_closed_records_and_uses_active_probability_impact():
    score, high_count, source = qualitative_risk_metrics(
        [
            {"probability": "high", "time_impact_days": "Yes", "cost_impact": "No", "status": "open"},
            {"probability": "high", "time_impact_days": "Yes", "cost_impact": "Yes", "status": "closed"},
        ]
    )

    assert score == 56.25
    assert high_count == 1
    assert source == "risks.csv:active probability-impact risk matrix"


def test_submitted_tia_guide_is_not_inferred_from_a_project_name(tmp_path):
    project = {
        "project_folder_name": "The BIG - PH01",
        "project_display_name": "ROYA-BIG PROJECT PHASE01",
        "project_id": "big",
    }

    assert submitted_tia_guide_root(tmp_path, project) is None


def test_project_local_submitted_tia_visuals_are_scoped_and_prefer_revised_variants(tmp_path):
    visual_root = tmp_path / "02-delay_analysis" / "submitted_visuals"
    visual_root.mkdir(parents=True)
    (visual_root / "04_Event_Chronology_Timeline.svg").write_text("<svg />", encoding="utf-8")
    (visual_root / "04_Eventnew_Chronology_Timeline.svg").write_text("<svg />", encoding="utf-8")
    (visual_root / "15_EOT_Entitlement_Summary.svg").write_text("<svg />", encoding="utf-8")
    (visual_root / "15_EOT_Entitlement_Summary_Large_Font.svg").write_text("<svg />", encoding="utf-8")
    project = {"project_folder_name": "Project One"}

    payload = build_submitted_tia_visuals(project, tmp_path)

    assert payload["available"] is True
    assert len(payload["visuals"]) == 2
    assert all(item["url"].startswith("/generated/Project-One/tia-submitted-exhibits/") for item in payload["visuals"])
    names = {item["name"] for item in payload["visuals"]}
    assert "04_Eventnew_Chronology_Timeline.svg" in names
    assert "15_EOT_Entitlement_Summary_Large_Font.svg" in names


def test_letters_workspace_uses_streamlit_register_and_inbox_logic_per_project():
    projects = discover_projects()
    big = next((project for project in projects if project.get("project_id") == "The Big -P.01-UP-20-April-26"), None)
    if big is None:
        pytest.skip("The BIG project fixture is not available in this environment.")

    payload = build_project_record(big)
    tables = payload["features"]["letters_intelligence"]["workbook_tables"]
    sheets = {sheet["name"]: sheet for sheet in tables["sheets"]}

    assert tables["source_scope"] == "selected_project_only"
    assert tables["inbox_auto_ingest"] is True
    assert sheets["From Contractor"]["row_count"] > 0
    assert sheets["Issue Threads"]["row_count"] > 0
    for sheet in tables["sheets"]:
        for row in sheet["rows"]:
            assert row["project_id"] == big["project_id"]


def test_delay_analysis_time_impact_is_a_visible_project_feature():
    projects = discover_projects()
    if not projects:
        pytest.skip("No project folders are available in this environment.")

    payload = build_project_record(projects[0])
    delay = payload["features"]["delay_analysis"]

    assert delay["visibility"] == "workspace"
    assert delay["internal_control"]["ui_enabled"] is True
