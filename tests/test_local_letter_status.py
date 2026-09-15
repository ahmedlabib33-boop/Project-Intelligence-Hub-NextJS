from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WATCHER = ROOT / "tools" / "watch_local_json.ps1"
MANUAL = ROOT / "UPDATE_LETTERS_LOCAL.bat"
STATUS_ROUTE = ROOT / "website" / "src" / "app" / "api" / "local-letter-status" / "route.ts"
PAGE = ROOT / "website" / "src" / "app" / "page.tsx"


def test_automatic_and_manual_letter_updates_share_a_local_status_contract():
    watcher = WATCHER.read_text(encoding="utf-8-sig")
    manual = MANUAL.read_text(encoding="utf-8-sig")

    assert "local_letter_status.json" in watcher
    assert "-Once" in manual
    assert "watch_local_json.ps1" in manual
    assert "ProjectIntelligenceHubLocalJsonGenerator" in watcher
    for stage in ("watching", "detected", "stabilizing", "processing", "json_ready", "failed"):
        assert f'"{stage}"' in watcher


def test_local_status_is_private_and_drives_browser_refresh():
    route = STATUS_ROUTE.read_text(encoding="utf-8-sig")
    page = PAGE.read_text(encoding="utf-8-sig")

    assert "process.env.VERCEL" in route
    assert "local_letter_status.json" in route
    assert 'fetch("/api/local-letter-status"' in page
    assert 'cache: "no-store"' in page
    assert "LocalLetterProgress" in page
    assert "refreshing" in page

