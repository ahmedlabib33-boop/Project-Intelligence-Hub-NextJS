"""Shared pytest hooks.

Several tests exercise the real project pipelines, which by design refresh tracked
data (project manifests, the controlled-TIA latest run, published S-curve charts).
That is easy to commit by accident, so after a run this lists every tracked file
the run modified. It only reports: it never restores or edits anything, because a
developer may have genuine uncommitted changes in the same files.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAX_LISTED = 40


def _modified_tracked_files() -> set[str]:
    try:
        output = subprocess.run(
            ["git", "status", "--porcelain", "-uno", "-z"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=60,
            check=True,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return set()
    return {entry[3:] for entry in output.split("\0") if len(entry) > 3}


def pytest_sessionstart(session) -> None:
    session.config._tracked_modified_before = _modified_tracked_files()


def pytest_terminal_summary(terminalreporter) -> None:
    before = getattr(terminalreporter.config, "_tracked_modified_before", None)
    if before is None:
        return
    changed = sorted(_modified_tracked_files() - before)
    if not changed:
        return
    terminalreporter.section("tracked files modified by this test run", sep="!")
    terminalreporter.write_line(
        "These tests run the real project pipelines, which regenerate tracked data. "
        "Review before committing; restore a file with: git checkout -- <path>"
    )
    for path in changed[:MAX_LISTED]:
        terminalreporter.write_line(f"  {path}")
    if len(changed) > MAX_LISTED:
        terminalreporter.write_line(f"  ... and {len(changed) - MAX_LISTED} more")
