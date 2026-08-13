"""Project-isolated adapter for the Universal Project Report Engine package.

The package is a local, controlled report-production tool.  This adapter keeps
its runs inside the owning project's output folder and publishes only artifact
metadata to the Next.js data generator.  It deliberately does not expose a
local FastAPI server or raw project source documents to Vercel.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
ENGINE_ROOT = (
    ROOT
    / "Universal engines"
    / "UNIVERSAL_PROJECT_REPORT_ENGINE_26PLUS_MULTI_LLM_ML_PACKAGE"
)
ENGINE_MANIFEST = ENGINE_ROOT / "PACKAGE_MANIFEST.json"
ENGINE_OUTPUT_MANIFEST = ENGINE_ROOT / "OUTPUT_STUDIO_MODULE_MANIFEST.json"
ML_TASK_MANIFEST = ENGINE_ROOT / "ML_TASK_REGISTRY.json"
PORTABLE_CATALOG_ROOT = ROOT / "tools" / "universal_report_engine_catalog"
PORTABLE_ENGINE_MANIFEST = PORTABLE_CATALOG_ROOT / "PACKAGE_MANIFEST.json"
PORTABLE_OUTPUT_MANIFEST = PORTABLE_CATALOG_ROOT / "OUTPUT_STUDIO_MODULE_MANIFEST.json"
PORTABLE_ML_TASK_MANIFEST = PORTABLE_CATALOG_ROOT / "ML_TASK_REGISTRY.json"
OUTPUT_FOLDER_NAME = "universal-report-engine"
CATALOG_MANIFEST_NAME = "universal_report_engine_manifest.json"
FAMILY_MANIFEST_NAME = "pih_universal_report_artifact.json"
RELEASED_STATUSES = frozenset({"PASS", "READY", "RELEASED", "APPROVED"})

SOURCE_EXTENSIONS = {".csv", ".xlsx", ".xls", ".xlsm", ".xer", ".pdf", ".docx", ".doc", ".json"}
IGNORED_SOURCE_PARTS = {
    ".git",
    ".venv",
    "venv",
    "__pycache__",
    "node_modules",
    "11-outputs",
    "outputs",
    "reports",
    "slides",
    "exports",
    "logs",
    "vercel",
    ".sync_state",
}


def _read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return default


def _catalog_path(primary: Path, portable: Path) -> Path:
    """Use the local engine manifest when installed, otherwise its public catalogue."""
    return primary if primary.exists() else portable


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(value, indent=2, ensure_ascii=True)
    if path.exists():
        try:
            if path.read_text(encoding="utf-8") == content:
                return
        except OSError:
            pass
    path.write_text(content, encoding="utf-8")


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _safe_slug(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-").lower() or "report"


def _require_project_identity(project: dict[str, Any]) -> tuple[str, str]:
    project_id = str(project.get("project_id") or "").strip()
    project_key = str(project.get("project_key") or "").strip()
    if not project_id or not project_key:
        raise ValueError("Universal Report Engine requires project_id and project_key.")
    return project_id, project_key


def engine_metadata() -> dict[str, Any]:
    """Read package metadata without importing or executing the engine."""
    package = _read_json(_catalog_path(ENGINE_MANIFEST, PORTABLE_ENGINE_MANIFEST), {})
    wrapper_path = ENGINE_ROOT / "UNIVERSAL_PROJECT_REPORT_ENGINE_26PLUS_ML.py"
    wrapper_version = None
    if wrapper_path.exists():
        match = re.search(r'^VERSION\s*=\s*["\']([^"\']+)', wrapper_path.read_text(encoding="utf-8", errors="ignore"), re.M)
        wrapper_version = match.group(1) if match else None
    return {
        "available": ENGINE_ROOT.exists(),
        # The engine is local-only. Its Windows path must never be emitted into
        # the generated payload consumed by the public Vercel application.
        "runtime_location": "local controlled runtime",
        "package_name": package.get("package_name", "Universal Project Report Engine"),
        "package_version": package.get("version"),
        "wrapper_version": wrapper_version,
        "author": package.get("author", "Eng. Ahmed Labib"),
        "attribution": package.get("attribution"),
        "rules": package.get("rules_count"),
        "report_families": package.get("report_families_count"),
        "layers": package.get("layers_count"),
        "capability_note": (
            "Runs locally against the active project's controlled source files. "
            "The public Vercel site displays generated artifacts only."
        ),
    }


def report_catalog() -> list[dict[str, Any]]:
    """Return the package report catalogue as data, not a hard-coded UI list."""
    manifest = _read_json(_catalog_path(ENGINE_OUTPUT_MANIFEST, PORTABLE_OUTPUT_MANIFEST), {})
    raw_catalog = (manifest.get("report_catalog") or manifest.get("reports") or []) if isinstance(manifest, dict) else []
    catalog: list[dict[str, Any]] = []
    for item in raw_catalog:
        if not isinstance(item, dict) or not item.get("key"):
            continue
        catalog.append(
            {
                "key": str(item["key"]),
                "title": str(item.get("title") or item["key"].replace("_", " ").title()),
                "summary": str(
                    item.get("summary")
                    or item.get("description")
                    or f"Controlled report family with {item.get('rule_count', 'configured')} validation rules."
                ),
                "native_schedule_required": bool(item.get("native_schedule_required", False)),
                "requires": list(item.get("requires") or (["Native schedule / XER", "relationship logic"] if item.get("native_schedule_required") else ["Project-local source evidence"])),
            }
        )
    return catalog


def ml_task_catalog() -> list[dict[str, Any]]:
    manifest = _read_json(_catalog_path(ML_TASK_MANIFEST, PORTABLE_ML_TASK_MANIFEST), {})
    tasks = manifest.get("tasks", []) if isinstance(manifest, dict) else []
    result: list[dict[str, Any]] = []
    if isinstance(tasks, dict):
        for key, task in tasks.items():
            if isinstance(task, dict):
                result.append({"key": key, "title": task.get("title") or task.get("id") or key.replace("_", " ").title(), "description": task.get("description")})
    elif isinstance(tasks, list):
        for task in tasks:
            if isinstance(task, dict):
                result.append({"key": task.get("key"), "title": task.get("title"), "description": task.get("description")})
    return result


def _is_allowed_source(path: Path, project_root: Path) -> bool:
    if path.suffix.lower() not in SOURCE_EXTENSIONS:
        return False
    try:
        relative_parts = {part.lower() for part in path.resolve().relative_to(project_root.resolve()).parts}
    except ValueError:
        return False
    return not bool(relative_parts & IGNORED_SOURCE_PARTS)


def collect_project_sources(project_root: Path) -> list[dict[str, Any]]:
    """Collect only files owned by this project; output/report folders are excluded."""
    project_root = project_root.resolve()
    if not project_root.exists():
        return []
    sources: list[dict[str, Any]] = []
    for path in sorted(project_root.rglob("*")):
        if not path.is_file() or not _is_allowed_source(path, project_root):
            continue
        try:
            relative_path = path.relative_to(project_root).as_posix()
            sources.append(
                {
                    "path": str(path),
                    "relative_path": relative_path,
                    "extension": path.suffix.lower(),
                    "size_bytes": path.stat().st_size,
                    "sha256": _sha256_file(path),
                }
            )
        except OSError:
            continue
    return sources


def _source_fingerprint(project: dict[str, Any], sources: Iterable[dict[str, Any]]) -> str:
    project_id, project_key = _require_project_identity(project)
    digest = hashlib.sha256()
    digest.update(project_id.encode("utf-8"))
    digest.update(project_key.encode("utf-8"))
    digest.update(str(project.get("source_fingerprint") or project.get("fingerprint") or "").encode("utf-8"))
    for source in sources:
        digest.update(str(source.get("relative_path", "")).encode("utf-8"))
        digest.update(str(source.get("sha256", "")).encode("utf-8"))
    return digest.hexdigest()


def _has_schedule_evidence(sources: Iterable[dict[str, Any]]) -> bool:
    for source in sources:
        name = str(source.get("relative_path", "")).lower()
        if name.endswith(".xer") or any(token in name for token in ("p6", "activity", "relationship", "schedule")):
            return True
    return False


def _artifact_url(public_slug: str, relative_path: str | None) -> str | None:
    if not relative_path:
        return None
    clean_relative = Path(relative_path).as_posix().lstrip("/")
    return f"/generated/{public_slug}/{clean_relative}"


def is_released_artifact(manifest: dict[str, Any]) -> bool:
    """Return true only for a project-bound report package that passed release."""
    return str(manifest.get("release_status") or "").upper() in RELEASED_STATUSES


def _family_status(
    item: dict[str, Any],
    sources: list[dict[str, Any]],
    source_fingerprint: str,
    project_id: str,
    public_slug: str,
    output_dir: Path,
) -> dict[str, Any]:
    family_dir = output_dir / OUTPUT_FOLDER_NAME / str(item["key"])
    artifact_manifest_path = family_dir / FAMILY_MANIFEST_NAME
    artifact_manifest = _read_json(artifact_manifest_path, {})
    same_project = artifact_manifest.get("project_id") == project_id
    same_fingerprint = artifact_manifest.get("source_fingerprint") == source_fingerprint
    artifacts = artifact_manifest.get("artifacts", {}) if isinstance(artifact_manifest, dict) else {}
    if same_project and same_fingerprint and artifacts:
        release_status = str(artifact_manifest.get("release_status") or "").upper()
        if release_status in RELEASED_STATUSES:
            status = "GENERATED"
            detail = "Generated and released from the active project source fingerprint."
        else:
            status = "DRAFT_REVIEW_REQUIRED"
            detail = (
                "A local draft package exists, but its validation/release gate did not pass. "
                "Use it only for internal review until the stated source gaps are resolved."
            )
    elif same_project and artifacts:
        status = "STALE"
        detail = "Project source files changed after this package was generated. Regenerate locally before relying on it."
    elif not sources:
        status = "MISSING_EVIDENCE"
        detail = "No eligible project-local source files were found for this report family."
    elif item.get("native_schedule_required") and not _has_schedule_evidence(sources):
        status = "MISSING_SCHEDULE_EVIDENCE"
        detail = "A native XER or project schedule/relationship source is required before generation."
    else:
        status = "READY_TO_GENERATE"
        detail = "Source files are available. Generate this controlled package locally to publish its artifacts."
    public_artifacts = (
        {
            key: _artifact_url(public_slug, value) if isinstance(value, str) else None
            for key, value in artifacts.items()
        }
        if status == "GENERATED"
        else {}
    )
    return {
        **item,
        "status": status,
        "detail": detail,
        "artifacts": public_artifacts,
        "generated_at": artifact_manifest.get("generated_at") if same_project else None,
        "release_status": artifact_manifest.get("release_status") if same_project else None,
        "validation_status": artifact_manifest.get("validation_status") if same_project else None,
    }


def ensure_universal_report_engine_catalog(
    project: dict[str, Any], project_root: Path, output_dir: Path, public_slug: str
) -> dict[str, Any]:
    """Write a project-owned catalogue; it never generates a report implicitly."""
    project_id, project_key = _require_project_identity(project)
    sources = collect_project_sources(project_root)
    fingerprint = _source_fingerprint(project, sources)
    catalog = [
        _family_status(item, sources, fingerprint, project_id, public_slug, output_dir)
        for item in report_catalog()
    ]
    generated_count = sum(item["status"] == "GENERATED" for item in catalog)
    payload = {
        "project_id": project_id,
        "project_key": project_key,
        "source_fingerprint": fingerprint,
        "source_scope": "active project folder only",
        "source_file_count": len(sources),
        "source_inventory": [{key: value for key, value in item.items() if key != "path"} for item in sources],
        "engine": engine_metadata(),
        "report_families": catalog,
        "summary": {
            "catalog_count": len(catalog),
            "generated_count": generated_count,
            "draft_review_count": sum(item["status"] == "DRAFT_REVIEW_REQUIRED" for item in catalog),
            "ready_count": sum(item["status"] == "READY_TO_GENERATE" for item in catalog),
            "blocked_count": sum(item["status"].startswith("MISSING") for item in catalog),
        },
        "ml_capability": {
            "task_count": len(ml_task_catalog()),
            "tasks": ml_task_catalog(),
            "status": "LOCAL_CONTROLLED_EXECUTION",
            "detail": (
                "ML tasks are available only when a project-approved, source-backed model is supplied locally. "
                "No browser prediction or synthetic ML result is published."
            ),
            "ai_governance": (
                "Groq remains the application AI advisor. The package multi-provider council is not activated "
                "unless its providers and approvals are configured locally."
            ),
        },
        "updated_at": _timestamp(),
    }
    _write_json(output_dir / OUTPUT_FOLDER_NAME / CATALOG_MANIFEST_NAME, payload)
    return payload


def _load_engine_module() -> Any:
    if not ENGINE_ROOT.exists():
        raise RuntimeError(f"Universal Report Engine package was not found: {ENGINE_ROOT}")
    root_text = str(ENGINE_ROOT)
    if root_text not in sys.path:
        sys.path.insert(0, root_text)
    return importlib.import_module("UNIVERSAL_PROJECT_REPORT_ENGINE_26PLUS_ML")


def _relative_to_output(path_value: str | Path | None, output_dir: Path) -> str | None:
    if not path_value:
        return None
    try:
        return Path(path_value).resolve().relative_to(output_dir.resolve()).as_posix()
    except (OSError, ValueError):
        return None


def generate_report_family(
    project: dict[str, Any],
    project_root: Path,
    output_dir: Path,
    report_key: str,
    *,
    force: bool = False,
) -> dict[str, Any]:
    """Run one controlled local engine package and bind it to the active project only."""
    project_id, project_key = _require_project_identity(project)
    item = next((candidate for candidate in report_catalog() if candidate["key"] == report_key), None)
    if not item:
        raise ValueError(f"Unknown Universal Report Engine report family: {report_key}")
    sources = collect_project_sources(project_root)
    fingerprint = _source_fingerprint(project, sources)
    if not sources:
        raise ValueError("No project-local evidence files are available for report generation.")
    if item.get("native_schedule_required") and not _has_schedule_evidence(sources):
        raise ValueError("This report family requires a project-local native schedule or schedule relationship source.")

    family_root = output_dir / OUTPUT_FOLDER_NAME / report_key
    family_manifest_path = family_root / FAMILY_MANIFEST_NAME
    existing = _read_json(family_manifest_path, {})
    if (
        not force
        and existing.get("project_id") == project_id
        and existing.get("source_fingerprint") == fingerprint
        and existing.get("artifacts")
    ):
        return existing

    run_id = f"run-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{fingerprint[:10]}"
    run_dir = family_root / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    context = {
        "project_id": project_id,
        "project_key": project_key,
        "project_name": project.get("project_display_name") or project.get("name") or project_key,
        "project_root": str(project_root),
        "source_fingerprint": fingerprint,
        "source_scope": "active project only",
        "report_family": report_key,
        "governance": {
            "decision_support_only": True,
            "native_schedule_supremacy": True,
            "no_cross_project_data": True,
            "no_unverified_ml_conclusions": True,
        },
        "project_summary": {
            "metrics": project.get("metrics", {}),
            "data_quality": project.get("data_quality", {}),
            "last_updated": project.get("last_updated"),
        },
    }
    context_path = run_dir / "PIH_PROJECT_CONTEXT.json"
    _write_json(context_path, context)
    module = _load_engine_module()
    result = module.generate_report(
        [entry["path"] for entry in sources],
        str(run_dir),
        report_type=report_key,
        context=context,
        strict=False,
        keep_working=False,
        run_ml_framework_test=False,
    )
    artifact_keys = {
        "html": result.get("html_gallery"),
        "pdf": result.get("pdf"),
        "pptx": result.get("editable_powerpoint"),
        "png_pptx": result.get("png_powerpoint"),
        "package_zip": result.get("package_zip"),
        "engine_manifest": result.get("manifest"),
        "validation": result.get("validation"),
        "project_model": result.get("project_model"),
        "source_inventory": result.get("source_inventory"),
        "evidence_assessment": result.get("evidence_assessment"),
    }
    artifact_manifest = {
        "project_id": project_id,
        "project_key": project_key,
        "report_key": report_key,
        "source_fingerprint": fingerprint,
        "generated_at": _timestamp(),
        "release_status": result.get("release_status"),
        "validation_status": result.get("validation_status"),
        "run_id": run_id,
        "artifacts": {
            key: relative
            for key, value in artifact_keys.items()
            if (relative := _relative_to_output(value, output_dir)) is not None
        },
    }
    _write_json(family_manifest_path, artifact_manifest)
    return artifact_manifest


def _load_project_json(path: Path) -> dict[str, Any]:
    project = _read_json(path, {})
    if not isinstance(project, dict):
        raise ValueError(f"Project payload is invalid: {path}")
    return project


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate project-isolated Universal Report Engine artifacts.")
    parser.add_argument("--project-json", type=Path, required=True, help="Generated selected-project JSON payload.")
    parser.add_argument("--project-root", type=Path, required=True, help="Owning project folder.")
    parser.add_argument("--output-dir", type=Path, required=True, help="Owning 11-outputs project folder.")
    parser.add_argument("--report", default="all", help="Report family key or 'all'.")
    parser.add_argument("--force", action="store_true", help="Generate a new controlled run even if fingerprint is unchanged.")
    args = parser.parse_args()

    project = _load_project_json(args.project_json)
    _require_project_identity(project)
    catalog = ensure_universal_report_engine_catalog(project, args.project_root, args.output_dir, project["project_key"])
    requested = [entry["key"] for entry in catalog["report_families"]] if args.report == "all" else [args.report]
    failures: list[str] = []
    for report_key in requested:
        try:
            result = generate_report_family(project, args.project_root, args.output_dir, report_key, force=args.force)
            print(f"GENERATED {report_key}: {result.get('release_status') or 'completed'}")
        except Exception as exc:  # controlled CLI outcome, no source modification
            failures.append(f"{report_key}: {exc}")
            print(f"BLOCKED {report_key}: {exc}")
    ensure_universal_report_engine_catalog(project, args.project_root, args.output_dir, project["project_key"])
    if failures:
        print("Some report families were not generated. Review project-local evidence and validation manifests.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
