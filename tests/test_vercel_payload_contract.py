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
        assert payload["features"]["outputs_and_watchers"]["outputs_folder"].endswith(payload["project_folder_name"])
        canonical_tia = payload["features"]["delay_analysis"]["canonical_analysis"]
        assert canonical_tia["status"] in {"ready", "missing", "needs_review"}
        if canonical_tia["status"] == "ready":
            assert "relationship_logic_df" in canonical_tia["tables"]

        for report_key, artifact in payload["report_artifacts"].items():
            assert report_key in payload["reports"]
            for extension in ("html", "pdf", "pptx"):
                assert artifact[extension].startswith(f"/generated/{project_slug}/")
                artifact_path = ROOT / "website" / "public" / artifact[extension].lstrip("/")
                assert artifact_path.exists()
                assert artifact_path.stat().st_size > 0
