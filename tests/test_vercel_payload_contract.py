from pathlib import Path
import json
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from generate_nextjs_website_data import slugify  # noqa: E402


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
        # The four data-gated charts must always be published, even when their
        # project-local templates are still empty. The source-backed workspace
        # charts are additive and vary with the selected project's inputs.
        assert {
            "contracts.planned_vs_actual_cash_flow",
            "delay.root_cause_pareto",
            "delay.type_distribution",
            "delay.tia_recovery_scenario",
        }.issubset(chart_ids)
        assert len(chart_ids) == len(chart_items)
        assert all(
            isinstance(chart.get("source_lineage"), dict)
            and chart.get("status") in {"ready", "partial", "draft", "awaiting_data"}
            for chart in chart_items
        )
        assert payload["features"]["outputs_and_watchers"]["outputs_folder"].endswith(payload["project_folder_name"])
        canonical_tia = payload["features"]["delay_analysis"]["canonical_analysis"]
        assert canonical_tia["status"] in {"ready", "missing", "needs_review"}
        if canonical_tia["status"] == "ready":
            assert "relationship_logic_df" in canonical_tia["tables"]

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
