from pathlib import Path
import json
import sys
import zipfile


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from project_report_artifacts import ensure_project_report_artifacts  # noqa: E402


def sample_project() -> dict[str, object]:
    return {
        "project_id": "project-001",
        "project_key": "project-001",
        "project_display_name": "Project One",
        "sector": "Buildings",
        "status": "Active",
        "contract_value": 1000000.0,
        "paid_amount": 250000.0,
        "actual_progress": 0.25,
        "planned_progress": 0.30,
        "bac": 1000000.0,
        "pv": 300000.0,
        "ev": 250000.0,
        "ac": 275000.0,
        "spi": 0.83,
        "cpi": 0.91,
        "delay_assessment": "Indicative only",
        "last_updated": "2026-08-01T00:00:00",
        "fingerprint": "source-fingerprint-001",
    }


def test_report_artifacts_are_project_scoped_and_reused_when_unchanged(tmp_path: Path) -> None:
    output_dir = tmp_path / "Project One"
    reports = ensure_project_report_artifacts(sample_project(), output_dir, public_slug="project-one")

    assert set(reports) == {"executive_dashboard", "master_dashboard", "elite_svg_charts", "linked_executive_dashboard"}
    for artifact in reports.values():
        for extension in ("html", "pdf", "pptx"):
            file_name = artifact["files"][extension]["name"]
            generated = output_dir / file_name
            assert generated.exists()
            assert generated.stat().st_size > 0
            assert artifact[extension].startswith("/generated/project-one/")
            if extension == "pdf":
                assert generated.read_bytes().startswith(b"%PDF")
            if extension == "pptx":
                with zipfile.ZipFile(generated) as presentation:
                    assert "[Content_Types].xml" in presentation.namelist()

    original_mtime = (output_dir / "01_executive_dashboard.pdf").stat().st_mtime_ns
    repeated = ensure_project_report_artifacts(sample_project(), output_dir, public_slug="project-one")
    assert repeated == reports
    assert (output_dir / "01_executive_dashboard.pdf").stat().st_mtime_ns == original_mtime

    manifest = json.loads((output_dir / ".report_manifest.json").read_text(encoding="utf-8"))
    assert manifest["project_id"] == "project-001"
    assert manifest["project_fingerprint"] == "source-fingerprint-001"


def test_changed_project_regenerates_without_rewriting_another_project(tmp_path: Path) -> None:
    first = sample_project()
    second = {**sample_project(), "project_id": "project-002", "project_key": "project-002", "project_display_name": "Project Two", "fingerprint": "source-fingerprint-002"}
    first_dir = tmp_path / "Project One"
    second_dir = tmp_path / "Project Two"
    ensure_project_report_artifacts(first, first_dir, public_slug="project-one")
    ensure_project_report_artifacts(second, second_dir, public_slug="project-two")
    second_mtime = (second_dir / "01_executive_dashboard.pdf").stat().st_mtime_ns

    changed_first = {**first, "fingerprint": "source-fingerprint-001-updated", "actual_progress": 0.40}
    ensure_project_report_artifacts(changed_first, first_dir, public_slug="project-one")

    assert (first_dir / "01_executive_dashboard.pdf").stat().st_mtime_ns > 0
    assert (second_dir / "01_executive_dashboard.pdf").stat().st_mtime_ns == second_mtime
