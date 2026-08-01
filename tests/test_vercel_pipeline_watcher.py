from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PIPELINE = ROOT / "tools" / "vercel_project_pipeline.ps1"


def test_watcher_tracks_chart_sources_but_ignores_its_own_generated_outputs():
    source = PIPELINE.read_text(encoding="utf-8")

    assert "$chartPayloadPath" in source
    assert "$chartCatalogPath" in source
    assert "$reportArtifactsPath" in source
    assert '11-outputs' in source
    assert "^website/src/generated(/|$)" in source
    assert "website/next-env.d.ts" in source
    assert '(Join-Path $canonicalRoot "projects")' in source
