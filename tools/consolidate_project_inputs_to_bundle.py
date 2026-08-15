"""Consolidate each project's editable CSV sources into one lossless CSV bundle.

The bundle is the only active editable input inside 01-data/import_templates.
All former CSV/JSON inputs are SHA-256 recorded and moved (never deleted) to
the external project-input archive only after round-trip validation succeeds.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from project_input_bundle import BUNDLE_FILENAME, BUNDLE_HEADERS, bundle_table


ENCODINGS = ("utf-8-sig", "utf-8", "cp1256", "cp1252")
SCHEMA = "2026-08-15.lossless-project-input-bundle.v1"


def raw_matrix(path: Path) -> tuple[list[str], list[list[str]]]:
    for encoding in ENCODINGS:
        try:
            with path.open("r", encoding=encoding, newline="") as handle:
                rows = list(csv.reader(handle))
            return (rows[0] if rows else []), (rows[1:] if len(rows) > 1 else [])
        except UnicodeDecodeError:
            continue
    raise ValueError(f"Unsupported CSV encoding: {path}")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def project_inputs(project_root: Path) -> list[Path]:
    data_dir = project_root / "01-data" / "import_templates"
    delay_dir = project_root / "02-delay_analysis" / "unified_tia_csv"
    files: list[Path] = []
    for folder in (data_dir, delay_dir):
        if not folder.exists():
            continue
        for path in folder.rglob("*"):
            if not path.is_file() or path.name in {BUNDLE_FILENAME, "project_input_bundle.staging.csv"}:
                continue
            if path.suffix.lower() == ".csv" or path.name in {".gitkeep", "payment_projection.json"}:
                files.append(path)
    return sorted(files, key=lambda item: item.relative_to(project_root).as_posix().casefold())


def source_key(project_root: Path, path: Path) -> str:
    data_dir = project_root / "01-data" / "import_templates"
    delay_dir = project_root / "02-delay_analysis" / "unified_tia_csv"
    try:
        return "data/" + path.relative_to(data_dir).as_posix()
    except ValueError:
        return "tia/" + path.relative_to(delay_dir).as_posix()


def create_bundle(project_root: Path, sources: list[Path]) -> tuple[Path, list[dict[str, Any]]]:
    target = project_root / "01-data" / "import_templates" / BUNDLE_FILENAME
    target.parent.mkdir(parents=True, exist_ok=True)
    staging = target.with_suffix(".staging.csv")
    inventory: list[dict[str, Any]] = []
    with staging.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=BUNDLE_HEADERS)
        writer.writeheader()
        for path in sources:
            relative = path.relative_to(project_root).as_posix()
            record: dict[str, Any] = {"relative_path": relative, "sha256": sha256(path), "size_bytes": path.stat().st_size}
            if path.suffix.lower() != ".csv":
                record["kind"] = "non_csv"
                inventory.append(record)
                continue
            headers, rows = raw_matrix(path)
            key = source_key(project_root, path)
            record.update({"kind": "csv", "source_scope": key, "headers": len(headers), "rows": len(rows)})
            writer.writerow({
                "bundle_version": SCHEMA,
                "source_scope": key,
                "source_file": relative,
                "row_kind": "schema",
                "row_order": "0",
                "payload_json": json.dumps({"headers": headers, "source_sha256": record["sha256"]}, ensure_ascii=False, separators=(",", ":")),
            })
            for index, row in enumerate(rows, start=1):
                writer.writerow({
                    "bundle_version": SCHEMA,
                    "source_scope": key,
                    "source_file": relative,
                    "row_kind": "data",
                    "row_order": str(index),
                    "payload_json": json.dumps(row, ensure_ascii=False, separators=(",", ":")),
                })
            inventory.append(record)
    return staging, inventory


def validate_round_trip(project_root: Path, sources: list[Path], staging: Path) -> None:
    target = project_root / "01-data" / "import_templates" / BUNDLE_FILENAME
    if target.exists():
        raise ValueError(f"Existing bundle must be moved aside before validation: {target}")
    staging.replace(target)
    try:
        for path in sources:
            if path.suffix.lower() != ".csv":
                continue
            expected = raw_matrix(path)
            actual = bundle_table(path)
            if actual != expected:
                raise ValueError(f"Lossless round-trip mismatch: {path}")
    except Exception:
        target.replace(staging)
        raise


def archive_sources(project_root: Path, sources: list[Path], archive_root: Path) -> list[dict[str, Any]]:
    moved: list[dict[str, Any]] = []
    for path in sources:
        destination = archive_root / path.relative_to(project_root)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            raise ValueError(f"Archive target already exists: {destination}")
        before = sha256(path)
        shutil.move(str(path), str(destination))
        after = sha256(destination)
        if before != after:
            raise ValueError(f"Archive hash mismatch: {path}")
        moved.append({"relative_path": path.relative_to(project_root).as_posix(), "archive_path": str(destination), "sha256": after})
    return moved


def projects(root: Path) -> list[Path]:
    return sorted({path.parent for path in root.rglob("project_manifest.json")}, key=lambda item: item.as_posix().casefold())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--projects-root", type=Path, required=True)
    parser.add_argument("--archive-root", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    run_root = args.archive_root / "maximum-one-input-bundle"
    report: dict[str, Any] = {"schema_version": SCHEMA, "created_at": datetime.now(timezone.utc).isoformat(), "projects": []}
    for project_root in projects(args.projects_root):
        relative_project = project_root.relative_to(args.projects_root)
        sources = project_inputs(project_root)
        if not sources:
            raise ValueError(f"No project inputs found: {project_root}")
        staging, inventory = create_bundle(project_root, sources)
        validate_round_trip(project_root, sources, staging)
        target = project_root / "01-data" / "import_templates" / BUNDLE_FILENAME
        project_report: dict[str, Any] = {"project": relative_project.as_posix(), "bundle": str(target), "bundle_sha256": sha256(target), "source_files": inventory, "active_input_file_count": 1}
        if args.apply:
            project_archive = run_root / relative_project
            project_report["archived"] = archive_sources(project_root, sources, project_archive)
        else:
            target.unlink()
        report["projects"].append(project_report)
    if args.apply:
        run_root.mkdir(parents=True, exist_ok=True)
        (run_root / "INPUT_BUNDLE_MANIFEST.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"projects": len(report["projects"]), "active_input_files_per_project": 1, "applied": args.apply}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())