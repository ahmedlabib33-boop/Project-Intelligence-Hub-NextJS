from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from generate_nextjs_website_data import (  # noqa: E402
    build_submitted_tia_visuals,
    qualitative_risk_metrics,
    submitted_tia_guide_root,
)


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
