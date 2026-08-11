from pathlib import Path
import json
import sys
import zipfile


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import project_report_artifacts as artifacts  # noqa: E402

ensure_project_report_artifacts = artifacts.ensure_project_report_artifacts


def sample_project() -> dict[str, object]:
    return {
        "project_id": "project-001",
        "project_key": "project-001",
        "project_folder_name": "Project One",
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
        "chart_payloads": {
            "catalog_version": "2026-08-01",
            "charts": [
                {"id": "contracts.planned_vs_actual_cash_flow", "title": "Planned vs Actual Cash Flow", "status": "ready"},
                {"id": "delay.tia_recovery_scenario", "title": "Baseline vs Impacted vs Recovery", "status": "draft"},
            ],
        },
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
    assert manifest["chart_catalog_version"] == "2026-08-01"
    assert manifest["chart_status"] == {
        "contracts.planned_vs_actual_cash_flow": "ready",
        "delay.tia_recovery_scenario": "draft",
    }


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


def test_matching_canonical_html_is_used_without_cross_project_leakage(tmp_path: Path, monkeypatch) -> None:
    canonical_outputs = tmp_path / "canonical-outputs"
    source_dir = canonical_outputs / "Project One"
    source_dir.mkdir(parents=True)
    (source_dir / ".output_manifest.json").write_text(
        json.dumps({"project_id": "project-001", "fingerprint": "legacy-fingerprint"}), encoding="utf-8"
    )
    for _, stem, _ in artifacts.REPORTS:
        (source_dir / f"{stem}.html").write_text(
            "<!doctype html><title>Approved report</title>" + (" source-backed" * 500), encoding="utf-8"
        )
    monkeypatch.setattr(artifacts, "CANONICAL_OUTPUTS_ROOT", canonical_outputs)

    reports = ensure_project_report_artifacts(sample_project(), tmp_path / "published", public_slug="project-one")

    assert all(report["html_origin"] == "canonical_project_html" for report in reports.values())
    assert all(report["source_project_id"] == "project-001" for report in reports.values())
    assert "Approved report" in (tmp_path / "published" / "02_master_dashboard.html").read_text(encoding="utf-8")


def test_mismatched_canonical_html_is_rejected(tmp_path: Path, monkeypatch) -> None:
    canonical_outputs = tmp_path / "canonical-outputs"
    source_dir = canonical_outputs / "Project One"
    source_dir.mkdir(parents=True)
    (source_dir / ".output_manifest.json").write_text(json.dumps({"project_id": "project-999"}), encoding="utf-8")
    for _, stem, _ in artifacts.REPORTS:
        (source_dir / f"{stem}.html").write_text("<html>wrong project</html>" + ("x" * 5000), encoding="utf-8")
    monkeypatch.setattr(artifacts, "CANONICAL_OUTPUTS_ROOT", canonical_outputs)

    reports = ensure_project_report_artifacts(sample_project(), tmp_path / "published", public_slug="project-one")

    assert all(report["html_origin"] == "controlled_fallback" for report in reports.values())
    assert "wrong project" not in (tmp_path / "published" / "02_master_dashboard.html").read_text(encoding="utf-8")
