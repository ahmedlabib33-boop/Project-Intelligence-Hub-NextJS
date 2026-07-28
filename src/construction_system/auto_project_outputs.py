"""Automatic HTML report output management for discovered projects."""

from __future__ import annotations

import hashlib
import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


AUTO_HTML_REPORTS = (
    "01_executive_dashboard.html",
    "02_master_dashboard.html",
    "03_elite_svg_charts.html",
    "04_linked_executive_dashboard.html",
)
REPORT_BUILDER_VERSION = "2026-07-20-elite-svg-colors-v4"


@dataclass(frozen=True)
class AutoOutputResult:
    project_id: str
    project_name: str
    output_dir: Path
    refreshed: bool
    reason: str
    files: tuple[str, ...]


def safe_folder_name(value: Any) -> str:
    text = str(value or "").strip()
    cleaned = "".join(ch if ch not in '<>:"/\\|?*' else "_" for ch in text).strip(" .")
    return cleaned or "Project"


def project_output_dir(root_outputs_dir: Path, project_record: dict[str, Any]) -> Path:
    folder_name = safe_folder_name(project_record.get("project_folder_name") or Path(str(project_record.get("project_dir", "Project"))).name)
    return root_outputs_dir / folder_name


def clean_root_outputs(root_outputs_dir: Path, valid_project_folder_names: set[str]) -> None:
    """Keep only project-named folders in root 11-outputs."""
    root_outputs_dir.mkdir(parents=True, exist_ok=True)
    for child in root_outputs_dir.iterdir():
        if child.is_dir() and child.name in valid_project_folder_names:
            continue
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink(missing_ok=True)


def _fingerprint_file(path: Path, root: Path, digest: hashlib._Hash) -> None:
    try:
        stat = path.stat()
    except OSError:
        return
    relative = path.relative_to(root).as_posix()
    digest.update(relative.encode("utf-8", errors="replace"))
    digest.update(str(stat.st_size).encode("ascii"))
    digest.update(str(stat.st_mtime_ns).encode("ascii"))


def project_data_fingerprint(project_dir: Path) -> str:
    """Fingerprint user/project data, excluding generated outputs and logs."""
    digest = hashlib.sha256()
    excluded = {"11-outputs", "12-logs", "__pycache__", ".pytest_cache"}
    if not project_dir.exists():
        return digest.hexdigest()
    for path in sorted(project_dir.rglob("*"), key=lambda item: item.as_posix().casefold()):
        if not path.is_file():
            continue
        if any(part in excluded for part in path.parts):
            continue
        if path.name.startswith(".output_manifest"):
            continue
        _fingerprint_file(path, project_dir, digest)
    return digest.hexdigest()


def _read_manifest(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
        return loaded if isinstance(loaded, dict) else {}
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {}


def _write_manifest(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _remove_unexpected_output_items(output_dir: Path) -> None:
    allowed = set(AUTO_HTML_REPORTS) | {".output_manifest.json"}
    for child in output_dir.iterdir():
        if child.name in allowed:
            continue
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink(missing_ok=True)


def _remove_old_auto_reports(output_dir: Path) -> None:
    for file_name in AUTO_HTML_REPORTS:
        (output_dir / file_name).unlink(missing_ok=True)


def refresh_project_outputs(
    project_records: list[dict[str, Any]],
    root_outputs_dir: Path,
    report_builder: Callable[[dict[str, Any]], dict[str, str]],
) -> list[AutoOutputResult]:
    """Create/update project-owned HTML outputs under the root output library."""
    valid_names = {
        safe_folder_name(record.get("project_folder_name") or Path(str(record.get("project_dir", "Project"))).name)
        for record in project_records
    }
    clean_root_outputs(root_outputs_dir, valid_names)

    results: list[AutoOutputResult] = []
    for record in project_records:
        project_id = str(record.get("project_id") or "").strip()
        project_name = str(record.get("project_name") or record.get("project_display_name") or project_id or "Project").strip()
        project_dir = Path(str(record.get("project_dir", "")))
        output_dir = project_output_dir(root_outputs_dir, record)
        output_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = output_dir / ".output_manifest.json"
        _remove_unexpected_output_items(output_dir)
        fingerprint = project_data_fingerprint(project_dir)
        manifest = _read_manifest(manifest_path)
        expected_files_exist = all((output_dir / file_name).exists() for file_name in AUTO_HTML_REPORTS)
        unchanged = (
            manifest.get("fingerprint") == fingerprint
            and manifest.get("report_builder_version") == REPORT_BUILDER_VERSION
            and expected_files_exist
        )

        if unchanged:
            results.append(AutoOutputResult(project_id, project_name, output_dir, False, "unchanged", AUTO_HTML_REPORTS))
            continue

        html_reports = report_builder(record)
        for file_name in AUTO_HTML_REPORTS:
            html = html_reports.get(file_name, "")
            (output_dir / file_name).write_text(str(html or ""), encoding="utf-8")
        _write_manifest(
            manifest_path,
            {
                "project_id": project_id,
                "project_name": project_name,
                "project_folder_name": output_dir.name,
                "fingerprint": fingerprint,
                "report_builder_version": REPORT_BUILDER_VERSION,
                "files": list(AUTO_HTML_REPORTS),
            },
        )
        results.append(AutoOutputResult(project_id, project_name, output_dir, True, "refreshed", AUTO_HTML_REPORTS))
    return results
