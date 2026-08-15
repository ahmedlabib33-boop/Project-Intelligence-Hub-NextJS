from pathlib import Path
import json
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from generate_nextjs_website_data import slugify  # noqa: E402


REFERENCE_CHART_IDS = {
    "overview.schedule_performance_s_curve", "overview.overall_completion_gauge",
    "overview.activity_status", "overview.discipline_health", "overview.earned_value_trend",
    "overview.performance_indices", "wbs.progress_distribution", "wbs.duration_breakdown",
    "activities.status_distribution", "activities.critical_path", "activities.float_distribution",
    "activities.monthly_completion", "activities.responsible_party_workload",
    "milestones.schedule_health", "milestones.variance_trend", "milestones.type_breakdown",
    "s_curve.master", "s_curve.discipline", "s_curve.variance", "evm.burnup",
    "evm.variance_waterfall", "evm.spi_trend", "evm.cpi_trend", "contracts.payment_history",
    "contracts.planned_vs_actual_cash_flow", "contracts.payment_status", "contracts.variations",
    "risks.category", "risks.status", "risks.trend", "risks.mitigation_effectiveness",
    "delay.events_timeline", "delay.root_cause_pareto", "delay.type_distribution",
    "delay.monthly_accumulation", "delay.tia_recovery_scenario",
}


def test_generated_project_payloads_keep_identity_tia_and_artifacts_scoped() -> None:
    payload_dir = ROOT / "website" / "public" / "data" / "projects"
    payloads = [json.loads(path.read_text(encoding="utf-8")) for path in sorted(payload_dir.glob("*.json"))]

    assert payloads, "Run the project data generator before the project payload contract test."
    project_ids = {payload["project_id"] for payload in payloads}
    assert len(project_ids) == len(payloads)

    for payload in payloads:
        project_slug = slugify(payload["project_folder_name"])
        assert payload["project_key"]
        charts = payload.get("chart_payloads")
        assert isinstance(charts, dict)
        assert charts.get("project_id") == payload["project_id"]
        assert charts.get("project_key") == payload["project_key"]
        chart_items = charts.get("charts", [])
        chart_ids = {chart.get("id") for chart in chart_items}
        assert chart_ids == REFERENCE_CHART_IDS
        assert len(chart_items) == 36
        assert len(chart_ids) == len(chart_items)
        assert all(
            isinstance(chart.get("source_lineage"), dict)
            and chart.get("status") in {"ready", "partial", "draft", "awaiting_data"}
            for chart in chart_items
        )
        assert payload["features"]["outputs_and_watchers"]["outputs_folder"].endswith(payload["project_folder_name"])
        controlled_tia = payload["features"]["delay_analysis"]["controlled_tia"]
        assert controlled_tia["project_id"] == payload["project_id"]
        assert controlled_tia["project_key"] == payload["project_key"]
        assert controlled_tia["status"] in {
            "SETUP_REQUIRED",
            "CONDITIONAL_RESULT",
            "RECONCILIATION_REQUIRED",
            "READY_AND_CALCULATED",
        }
        assert controlled_tia["workflow_tabs"] == [
            "Time Impact Methodology",
            "Schedule and CPM",
            "Events and Fragnets",
            "Concurrency and Entitlement",
            "EOT Position",
            "AI Review and Run Control",
        ]
        if payload["project_id"] != "The Big -P.01-UP-20-April-26":
            assert controlled_tia["status"] == "SETUP_REQUIRED"

        event_exhibits = controlled_tia.get("events_and_fragnets", {}).get("event_exhibits", [])
        if payload["project_id"] == "The Big -P.01-UP-20-April-26":
            assert [item.get("event_id") for item in event_exhibits] == ["EV01", "EV02", "EV03", "EV04"]
        else:
            assert event_exhibits == []
        for exhibit in event_exhibits:
            assert exhibit["project_id"] == payload["project_id"]
            assert exhibit["project_key"] == payload["project_key"]
            assert exhibit["url"].startswith(f"/generated/{project_slug}/tia-controlled-event-exhibits/")
            assert "source_relative_path" not in exhibit
            exhibit_path = ROOT / "website" / "public" / exhibit["url"].lstrip("/")
            assert exhibit_path.exists()
            assert exhibit_path.stat().st_size > 0

        view_exhibits = controlled_tia.get("view_exhibits", [])
        if payload["project_id"] == "The Big -P.01-UP-20-April-26":
            assert [item.get("view") for item in view_exhibits] == [
                "Time Impact Methodology",
                "Concurrency and Entitlement",
                "EOT Position",
            ]
        else:
            assert view_exhibits == []
        for exhibit in view_exhibits:
            assert exhibit["project_id"] == payload["project_id"]
            assert exhibit["project_key"] == payload["project_key"]
            assert exhibit["url"].startswith(f"/generated/{project_slug}/tia-controlled-view-exhibits/")
            exhibit_path = ROOT / "website" / "public" / exhibit["url"].lstrip("/")
            assert exhibit_path.exists()
            assert exhibit_path.stat().st_size > 0

        submitted_visuals = payload["features"]["delay_analysis"].get("submitted_visuals", {})
        if submitted_visuals.get("available"):
            assert submitted_visuals.get("visuals")
            for visual in submitted_visuals["visuals"]:
                assert visual["url"].startswith(f"/generated/{project_slug}/tia-submitted-exhibits/")
                visual_path = ROOT / "website" / "public" / visual["url"].lstrip("/")
                assert visual_path.exists()
                assert visual_path.stat().st_size > 0

        for report_key, artifact in payload["report_artifacts"].items():
            if report_key == "tia_governed_assessment":
                # The assessment is retained for a future recalled analysis but
                # deliberately kept off the live workspace and Output Studio.
                assert report_key not in payload["reports"]
                assert artifact.get("source_scope") == "selected_project_only"
            else:
                assert report_key in payload["reports"]
            for extension in ("html", "pdf", "pptx"):
                assert artifact[extension].startswith(f"/generated/{project_slug}/")
                artifact_path = ROOT / "website" / "public" / artifact[extension].lstrip("/")
                assert artifact_path.exists()
                assert artifact_path.stat().st_size > 0
