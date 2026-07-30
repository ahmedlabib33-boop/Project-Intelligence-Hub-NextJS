from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from generate_nextjs_website_data import qualitative_risk_metrics, submitted_tia_guide_root  # noqa: E402


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
