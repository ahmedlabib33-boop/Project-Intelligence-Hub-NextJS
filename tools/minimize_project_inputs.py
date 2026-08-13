"""Safely reduce project CSV inputs without changing logical Vercel datasets.

This command is intentionally conservative.  It only moves files after a
project-specific proof and records the source and archive SHA-256 values in a
manifest.  When the identical file is already archived, it verifies that hash
before removing only the redundant local copy.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from project_input_contracts import (
    activity_master_eligibility,
    activity_master_path,
    build_payment_projection,
    build_activity_master_rows,
    load_master_table,
    read_csv_rows,
    write_activity_master,
)


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PROJECTS_ROOT = ROOT / "projects"
DEFAULT_ARCHIVE_ROOT = Path(r"D:\Project Intelligence Hub NextJS-unneeded files\2026-08-13_project-input-minimization")
UNUSED_NORMAL_INPUTS = (
    "cost_items.csv",
    "change_orders.csv",
    "Delivered_steel_site.csv",
    "engineering_log.csv",
    "rft_qtys.csv",
    "steel_activities_relationship.csv",
    "steel_delay_status_mployer_free_issue_material.csv",
)
TEMPLATE_MIGRATIONS = (
    ("14-delay_event_classification.csv", "12_delay_event_classification.csv"),
    ("15-tia_recovery_scenario.csv", "13_tia_recovery_scenario.csv"),
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _clean_record(row: dict[str, str]) -> dict[str, str]:
    """Compare meaningful values while ignoring CSV applications' blank columns."""
    return {
        "".join(ch for ch in str(key or "").casefold() if ch.isalnum()): str(value or "").strip()
        for key, value in row.items()
        if key and not str(key).casefold().startswith("unnamed") and str(value or "").strip()
    }


def _records(path: Path) -> list[dict[str, str]]:
    return [record for row in read_csv_rows(path) if (record := _clean_record(row))]


def equivalent_csv(left: Path, right: Path) -> bool:
    """Require exact meaningful row multiset equality, independent of CSV formatting."""
    left_records = sorted(json.dumps(row, ensure_ascii=False, sort_keys=True) for row in _records(left))
    right_records = sorted(json.dumps(row, ensure_ascii=False, sort_keys=True) for row in _records(right))
    return bool(left.exists() and right.exists()) and left_records == right_records


def _project_relative(projects_root: Path, path: Path) -> Path:
    return Path("projects") / path.resolve().relative_to(projects_root.resolve())


def _archive_path(archive_root: Path, projects_root: Path, path: Path) -> Path:
    return archive_root / _project_relative(projects_root, path)


def _move_to_archive(
    *, path: Path, archive_root: Path, projects_root: Path, action: str, manifest: list[dict[str, Any]], apply: bool
) -> None:
    target = _archive_path(archive_root, projects_root, path)
    if not path.exists():
        if target.exists():
            manifest.append({
                "action": action,
                "source": str(path),
                "project_relative_path": _project_relative(projects_root, path).as_posix(),
                "archive": str(target),
                "sha256_archive": sha256(target),
                "status": "already_archived",
            })
        return
    before = sha256(path)
    item = {
        "action": action,
        "source": str(path),
        "project_relative_path": _project_relative(projects_root, path).as_posix(),
        "archive": str(target),
        "sha256_before": before,
        "status": "planned" if not apply else "moved",
    }
    if apply:
        if target.exists() and sha256(target) != before:
            # A controlled source may have been updated after a first clean
            # release was archived.  Preserve both versions instead of
            # overwriting or discarding either one.  The original relative
            # path remains intact below a hash-addressed version directory.
            versioned_target = archive_root / "versions" / before / _project_relative(projects_root, path)
            if versioned_target.exists() and sha256(versioned_target) != before:
                raise RuntimeError(f"Versioned archive collision with a different file: {versioned_target}")
            if not versioned_target.exists():
                versioned_target.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(path), str(versioned_target))
            else:
                path.unlink()
            target = versioned_target
            item["archive"] = str(target)
            item["archive_versioned"] = True
            item["status"] = "moved_to_versioned_archive"
        elif target.exists():
            path.unlink()
            item["status"] = "deduplicated_against_identical_archive"
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(path), str(target))
        if sha256(target) != before:
            raise RuntimeError(f"Archive hash validation failed: {target}")
        item["sha256_archive"] = sha256(target)
    manifest.append(item)


def _copy_to_canonical(source: Path, target: Path, apply: bool) -> None:
    if not apply:
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    if not equivalent_csv(source, target):
        raise RuntimeError(f"Canonical template migration mismatch: {source} -> {target}")


def _archive_unused_normal_inputs(
    data_dir: Path, archive_root: Path, projects_root: Path, manifest: list[dict[str, Any]], apply: bool
) -> None:
    for name in UNUSED_NORMAL_INPUTS:
        _move_to_archive(
            path=data_dir / name,
            archive_root=archive_root,
            projects_root=projects_root,
            action="unused_by_vercel_and_canonical_tia",
            manifest=manifest,
            apply=apply,
        )


def _consolidate_normal_activity_inputs(
    data_dir: Path, delay_dir: Path, archive_root: Path, projects_root: Path, manifest: list[dict[str, Any]], apply: bool
) -> None:
    eligible, reason = activity_master_eligibility(data_dir, delay_dir)
    status = {
        "action": "activity_master_consolidation",
        "project_relative_path": _project_relative(projects_root, data_dir).as_posix(),
        "eligible": eligible,
        "reason": reason,
        "status": "planned" if eligible and not apply else ("applied" if eligible else "retained"),
    }
    manifest.append(status)
    if not eligible:
        return
    headers, master_rows = build_activity_master_rows(data_dir, delay_dir)
    master = activity_master_path(data_dir)
    if apply:
        write_activity_master(master, headers, master_rows)
        for logical_name, file_name in (("activities", "activities.csv"), ("evm", "evm.csv"), ("progress_updates", "progress_updates.csv")):
            original = read_csv_rows(data_dir / file_name)
            rebuilt = load_master_table(master, logical_name)
            if original != rebuilt:
                raise RuntimeError(f"Logical table parity failed for {data_dir / file_name}")
        status["master"] = str(master)
        status["master_sha256"] = sha256(master)
    # P6 remains in the controlled TIA directory.  Its key set is part of the
    # eligibility proof but it is not duplicated or removed across boundaries.
    for file_name in ("activities.csv", "evm.csv", "progress_updates.csv"):
        _move_to_archive(
            path=data_dir / file_name,
            archive_root=archive_root,
            projects_root=projects_root,
            action="consolidated_into_activity_master",
            manifest=manifest,
            apply=apply,
        )


def _migrate_legacy_tia_aliases(
    delay_dir: Path, archive_root: Path, projects_root: Path, manifest: list[dict[str, Any]], apply: bool
) -> None:
    for legacy_name, canonical_name in TEMPLATE_MIGRATIONS:
        legacy = delay_dir / legacy_name
        canonical = delay_dir / canonical_name
        if not legacy.exists() or not canonical.exists():
            continue
        canonical_records = _records(canonical)
        legacy_records = _records(legacy)
        if not equivalent_csv(legacy, canonical):
            if canonical_records or not legacy_records:
                manifest.append({
                    "action": "legacy_tia_alias_retained",
                    "source": str(legacy),
                    "canonical": str(canonical),
                    "reason": "Both sources contain different meaningful records",
                    "status": "retained",
                })
                continue
            _copy_to_canonical(legacy, canonical, apply)
        _move_to_archive(
            path=legacy,
            archive_root=archive_root,
            projects_root=projects_root,
            action=f"migrated_to_{canonical_name}",
            manifest=manifest,
            apply=apply,
        )


def _normalize_tia_contract_dates(delay_dir: Path, manifest: list[dict[str, Any]], apply: bool) -> None:
    """Convert legacy display dates to ISO without changing their calendar meaning."""
    fields_by_file = {
        "12_delay_event_classification.csv": ("event_start", "event_finish"),
        "13_tia_recovery_scenario.csv": ("status_date", "baseline_finish", "impacted_finish", "recovery_finish"),
    }
    formats = ("%d-%b-%y", "%d-%b-%Y", "%d/%m/%Y", "%d/%m/%y", "%Y/%m/%d")
    for filename, fields in fields_by_file.items():
        path = delay_dir / filename
        if not path.exists():
            continue
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            headers = list(reader.fieldnames or [])
            rows = [dict(row) for row in reader]
        changed = 0
        for row in rows:
            for field in fields:
                value = str(row.get(field) or "").strip()
                if not value or len(value) >= 10 and value[:4].isdigit() and value[4:5] == "-":
                    continue
                for date_format in formats:
                    try:
                        normalized = datetime.strptime(value, date_format).date().isoformat()
                    except ValueError:
                        continue
                    if normalized != value:
                        row[field] = normalized
                        changed += 1
                    break
        if changed and apply:
            with path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=headers, extrasaction="ignore")
                writer.writeheader()
                writer.writerows(rows)
        if changed:
            manifest.append({
                "action": "canonical_tia_date_normalization",
                "source": str(path),
                "changed_cells": changed,
                "status": "applied" if apply else "planned",
                "reason": "Legacy display dates normalized to the universal TIA ISO contract",
            })


def _archive_verified_cross_folder_duplicates(
    data_dir: Path, delay_dir: Path, archive_root: Path, projects_root: Path, manifest: list[dict[str, Any]], apply: bool
) -> None:
    pairs = (
        ("payments.csv", "08- payments.csv"),
        ("ifc_conflict.csv", "07- ifc_conflict.csv"),
        ("rfi_ status.csv", "09- rfi_status.csv"),
    )
    for normal_name, tia_name in pairs:
        source = data_dir / normal_name
        canonical = delay_dir / tia_name
        if equivalent_csv(source, canonical):
            if normal_name == "payments.csv" and apply:
                build_payment_projection(source, canonical, data_dir)
            _move_to_archive(
                path=source,
                archive_root=archive_root,
                projects_root=projects_root,
                action=f"duplicate_of_tia_{tia_name}",
                manifest=manifest,
                apply=apply,
            )
        elif normal_name == "payments.csv":
            archived_source = _archive_path(archive_root, projects_root, source)
            if archived_source.exists() and equivalent_csv(archived_source, canonical) and apply:
                build_payment_projection(archived_source, canonical, data_dir)
                manifest.append({
                    "action": "payment_projection_reconciled",
                    "source": str(archived_source),
                    "canonical": str(canonical),
                    "projection": str(data_dir / "payment_projection.json"),
                    "status": "applied",
                })
                continue
            manifest.append({
                "action": "cross_folder_source_retained",
                "source": str(source),
                "canonical": str(canonical),
                "reason": "Semantic CSV equivalence was not proven",
                "status": "retained",
            })
        else:
            manifest.append({
                "action": "cross_folder_source_retained",
                "source": str(source),
                "canonical": str(canonical),
                "reason": "Semantic CSV equivalence was not proven",
                "status": "retained",
            })


def minimize(projects_root: Path, archive_root: Path, apply: bool) -> dict[str, Any]:
    manifest: list[dict[str, Any]] = []
    project_manifests = sorted(projects_root.rglob("project_manifest.json"))
    for project_manifest in project_manifests:
        project_root = project_manifest.parent
        data_dir = project_root / "01-data" / "import_templates"
        delay_dir = project_root / "02-delay_analysis" / "unified_tia_csv"
        _consolidate_normal_activity_inputs(data_dir, delay_dir, archive_root, projects_root, manifest, apply)
        _archive_verified_cross_folder_duplicates(data_dir, delay_dir, archive_root, projects_root, manifest, apply)
        _migrate_legacy_tia_aliases(delay_dir, archive_root, projects_root, manifest, apply)
        _normalize_tia_contract_dates(delay_dir, manifest, apply)
        _archive_unused_normal_inputs(data_dir, archive_root, projects_root, manifest, apply)
    result = {
        "schema_version": "2026-08-13.project-input-minimization.v1",
        "created_at_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "mode": "apply" if apply else "audit",
        "projects_root": str(projects_root),
        "archive_root": str(archive_root),
        "entries": manifest,
    }
    if apply:
        archive_root.mkdir(parents=True, exist_ok=True)
        (archive_root / "ARCHIVE_MANIFEST.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Safely minimize validated project CSV inputs.")
    parser.add_argument("--projects-root", type=Path, default=DEFAULT_PROJECTS_ROOT)
    parser.add_argument("--archive-root", type=Path, default=DEFAULT_ARCHIVE_ROOT)
    parser.add_argument("--apply", action="store_true", help="Move only validated redundant inputs to the archive.")
    parser.add_argument("--output", type=Path, help="Optional JSON audit output path.")
    args = parser.parse_args()
    result = minimize(args.projects_root.resolve(), args.archive_root.resolve(), args.apply)
    rendered = json.dumps(result, indent=2, ensure_ascii=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered)
    return 0


if __name__ == "__main__":
    sys.exit(main())
