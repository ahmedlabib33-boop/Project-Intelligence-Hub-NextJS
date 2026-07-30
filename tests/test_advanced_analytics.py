from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from advanced_analytics import build_advanced_analytics  # noqa: E402


def test_advanced_analytics_is_project_scoped_and_source_backed(tmp_path: Path) -> None:
    activities = []
    for index in range(24):
        activities.append(
            {
                "activity_id": f"A-{index:03d}",
                "activity_name": f"Concrete work area {index}",
                "planned_progress": index / 30,
                "actual_progress": index / 40,
                "total_float_days": index - 12,
                "planned_finish": "1-Jun-26",
                "forecast_finish": f"{1 + (index % 8)}-Jun-26",
                "critical": "Yes" if index % 5 == 0 else "No",
            }
        )
    s_curve = [
        {
            "months": f"1-{month}-26",
            "cumm_monthly_planned": str((index + 1) * 100),
            "cumm_monthly_actual": str((index + 1) * 85),
        }
        for index, month in enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"])
    ]

    result = build_advanced_analytics(
        project_key="test-project",
        rows={"activities": activities, "s_curve": s_curve, "delay_events": [], "risks": []},
        contract_value=1000.0,
        output_dir=tmp_path,
    )

    assert result["scope"] == "selected_project_only"
    assert result["data_profile"]["activity_records"] == 24
    assert result["data_profile"]["s_curve_periods"] == 8
    assert result["activity_anomalies"]["status"] == "ready"
    assert result["s_curve_forecast"]["status"] == "ready"
    assert result["s_curve_chart_url"] == "/data/analytics/test-project-s-curve-analytics.png"
    assert (tmp_path / "test-project-s-curve-analytics.png").exists()
    assert result["model_governance"]["xgboost"]["status"] == "not_trained"
