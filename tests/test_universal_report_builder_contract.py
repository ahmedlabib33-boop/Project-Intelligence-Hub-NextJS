from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUILDER = ROOT / "website" / "src" / "components" / "UniversalReportBuilder.tsx"
PAGE = ROOT / "website" / "src" / "app" / "page.tsx"


def test_browser_report_builder_is_bound_to_the_active_project_only() -> None:
    source = BUILDER.read_text(encoding="utf-8")
    page = PAGE.read_text(encoding="utf-8")

    assert "projectRows(project)" in source
    assert "[project]" in source
    assert "project.project_key" in source
    assert "project={project}" in page
    assert "fetch(" not in source
    assert "portfolio" not in source.lower()


def test_browser_report_builder_uses_form_and_csv_values_in_the_download() -> None:
    source = BUILDER.read_text(encoding="utf-8")

    assert "parseCsv(csvText)" in source
    assert "form.projectName" in source
    assert "form.projectId" in source
    assert "form.reportingPeriod" in source
    assert "form.preparedBy" in source
    assert 'await pptx.writeFile({ fileName })' in source
