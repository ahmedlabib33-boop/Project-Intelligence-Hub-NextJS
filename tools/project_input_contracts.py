"""Canonical project-input contracts used by the Vercel data pipeline.

The module preserves the original logical tables while allowing a validated
project to store its aligned activity inputs in one physical CSV.  It is
deliberately project-local: no fallback project and no public CSV directory is
ever consulted.
"""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from typing import Any, Iterable


ACTIVITY_MASTER_FILENAME = "activity_master.csv"
PAYMENT_PROJECTION_FILENAME = "payment_projection.json"
ACTIVITY_LOGICAL_TABLES = {
    "activities": "activity",
    "evm": "evm",
    "progress_updates": "progress",
}
ALIGNED_ACTIVITY_TABLES = (*ACTIVITY_LOGICAL_TABLES, "p6_activity_export")


def normalize_header(value: str) -> str:
    """Return a comparison-safe header name without changing source values."""
    return re.sub(r"[^a-z0-9]+", "_", str(value or "").casefold()).strip("_")


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    """Read a project CSV with the encodings accepted by the existing pipeline."""
    if not path.exists():
        return []
    for encoding in ("utf-8-sig", "utf-8", "cp1256", "cp1252"):
        try:
            with path.open("r", encoding=encoding, newline="") as handle:
                return [dict(row) for row in csv.DictReader(handle)]
        except UnicodeDecodeError:
            continue
    return []


def read_csv_matrix(path: Path) -> tuple[list[str], list[list[str]]]:
    """Read CSV cells without losing trailing blank columns needed for a UI projection."""
    if not path.exists():
        return [], []
    for encoding in ("utf-8-sig", "utf-8", "cp1256", "cp1252"):
        try:
            with path.open("r", encoding=encoding, newline="") as handle:
                rows = list(csv.reader(handle))
            return (rows[0] if rows else []), (rows[1:] if len(rows) > 1 else [])
        except UnicodeDecodeError:
            continue
    return [], []


def csv_headers(path: Path) -> list[str]:
    if not path.exists():
        return []
    for encoding in ("utf-8-sig", "utf-8", "cp1256", "cp1252"):
        try:
            with path.open("r", encoding=encoding, newline="") as handle:
                return list(csv.DictReader(handle).fieldnames or [])
        except UnicodeDecodeError:
            continue
    return []


def _value_by_normalized_name(row: dict[str, str], normalized_name: str) -> str:
    for key, value in row.items():
        if normalize_header(key) == normalized_name:
            return str(value or "").strip()
    return ""


def activity_key(row: dict[str, str]) -> tuple[str, str] | None:
    """Resolve the mandatory key across P6 and ordinary activity header styles."""
    project_id = _value_by_normalized_name(row, "project_id")
    activity_id = _value_by_normalized_name(row, "activity_id")
    if not project_id or not activity_id:
        return None
    return project_id, activity_id


def activity_source_paths(data_dir: Path, delay_dir: Path) -> dict[str, Path]:
    return {
        "activities": data_dir / "activities.csv",
        "evm": data_dir / "evm.csv",
        "progress_updates": data_dir / "progress_updates.csv",
        "p6_activity_export": delay_dir / "04- p6_activity_export.csv",
    }


def activity_master_path(data_dir: Path) -> Path:
    return data_dir / ACTIVITY_MASTER_FILENAME


def activity_master_eligibility(data_dir: Path, delay_dir: Path) -> tuple[bool, str]:
    """Prove the four physical sources can be represented by one keyed master."""
    source_rows = {name: read_csv_rows(path) for name, path in activity_source_paths(data_dir, delay_dir).items()}
    missing = [name for name, rows in source_rows.items() if not rows]
    if missing:
        return False, f"Missing or header-only aligned source: {', '.join(missing)}"

    reference_keys: set[tuple[str, str]] | None = None
    for name, rows in source_rows.items():
        keys = [activity_key(row) for row in rows]
        if any(key is None for key in keys):
            return False, f"{name} has a row without project_id/activity_id"
        concrete_keys = [key for key in keys if key is not None]
        if len(set(concrete_keys)) != len(concrete_keys):
            return False, f"{name} has duplicate project_id/activity_id keys"
        current = set(concrete_keys)
        if reference_keys is None:
            reference_keys = current
        elif current != reference_keys:
            return False, f"{name} key set does not match the other aligned sources"
    return True, "Exact one-to-one activity key validation passed"


def build_activity_master_rows(data_dir: Path, delay_dir: Path) -> tuple[list[str], list[dict[str, str]]]:
    """Create lossless source-namespaced rows after eligibility has been proven."""
    eligible, reason = activity_master_eligibility(data_dir, delay_dir)
    if not eligible:
        raise ValueError(reason)
    source_paths = activity_source_paths(data_dir, delay_dir)
    source_rows = {name: read_csv_rows(path) for name, path in source_paths.items()}
    source_headers = {name: csv_headers(path) for name, path in source_paths.items()}
    key_order = [activity_key(row) for row in source_rows["activities"]]
    by_key = {
        name: {activity_key(row): (index, row) for index, row in enumerate(rows)}
        for name, rows in source_rows.items()
    }
    columns = ["master_project_id", "master_activity_id"]
    columns.extend(f"master_{prefix}_row_order" for prefix in ACTIVITY_LOGICAL_TABLES.values())
    for logical_name, prefix in ACTIVITY_LOGICAL_TABLES.items():
        columns.extend(f"{prefix}__{header}" for header in source_headers[logical_name])
    master_rows: list[dict[str, str]] = []
    for key in key_order:
        if key is None:
            continue
        record = {"master_project_id": key[0], "master_activity_id": key[1]}
        for logical_name, prefix in ACTIVITY_LOGICAL_TABLES.items():
            source_order, source = by_key[logical_name][key]
            record[f"master_{prefix}_row_order"] = str(source_order)
            for header in source_headers[logical_name]:
                record[f"{prefix}__{header}"] = str(source.get(header, "") or "")
        master_rows.append(record)
    return columns, master_rows


def write_activity_master(path: Path, headers: Iterable[str], rows: Iterable[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(headers), extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def _master_prefix(logical_name: str) -> str | None:
    return ACTIVITY_LOGICAL_TABLES.get(logical_name)


def load_master_table(path: Path, logical_name: str) -> list[dict[str, str]]:
    """Rebuild an original logical table exactly from namespaced master columns."""
    prefix = _master_prefix(logical_name)
    if prefix is None:
        return []
    marker = f"{prefix}__"
    ordered_rows: list[tuple[int, dict[str, str]]] = []
    for master_row in read_csv_rows(path):
        row = {
            header[len(marker):]: value
            for header, value in master_row.items()
            if header.startswith(marker)
        }
        if row:
            try:
                order = int(master_row.get(f"master_{prefix}_row_order", "0"))
            except (TypeError, ValueError):
                order = len(ordered_rows)
            ordered_rows.append((order, row))
    return [row for _, row in sorted(ordered_rows, key=lambda item: item[0])]


def load_logical_rows(data_dir: Path, delay_dir: Path, logical_name: str) -> list[dict[str, str]]:
    """Return the legacy logical table from its master, otherwise its original CSV."""
    master = activity_master_path(data_dir)
    if logical_name in ACTIVITY_LOGICAL_TABLES and master.exists():
        return load_master_table(master, logical_name)
    if logical_name == "p6_activity_export":
        return read_csv_rows(delay_dir / "04- p6_activity_export.csv")
    return read_csv_rows(data_dir / f"{logical_name}.csv")


def logical_source_path(data_dir: Path, delay_dir: Path, logical_name: str) -> Path:
    """Expose lineage without manufacturing a duplicate physical CSV."""
    if logical_name in ACTIVITY_LOGICAL_TABLES and activity_master_path(data_dir).exists():
        return activity_master_path(data_dir)
    if logical_name == "p6_activity_export":
        return delay_dir / "04- p6_activity_export.csv"
    return data_dir / f"{logical_name}.csv"


def payment_projection_path(data_dir: Path) -> Path:
    return data_dir / PAYMENT_PROJECTION_FILENAME


def build_payment_projection(original_path: Path, canonical_tia_path: Path, data_dir: Path) -> dict[str, Any]:
    """Save a schema-only lossless projection before archiving a duplicate payment CSV."""
    target_headers, target_rows = read_csv_matrix(original_path)
    source_headers, source_rows = read_csv_matrix(canonical_tia_path)
    if not target_headers or not source_headers or len(target_rows) != len(source_rows):
        raise ValueError("Payment projection requires matching non-empty source matrices")
    mappings: list[int] = []
    for index, header in enumerate(target_headers):
        target_values = [row[index] if index < len(row) else "" for row in target_rows]
        candidates = [
            source_index
            for source_index in range(len(source_headers))
            if [row[source_index] if source_index < len(row) else "" for row in source_rows] == target_values
        ]
        if not candidates:
            raise ValueError(f"Payment projection cannot reproduce original column {header!r}")
        matching_header = [candidate for candidate in candidates if normalize_header(source_headers[candidate]) == normalize_header(header)]
        mappings.append((matching_header or candidates)[0])
    payload = {
        "schema_version": "2026-08-13.payment-projection.v1",
        "logical_table": "payments",
        "canonical_source": "02-delay_analysis/unified_tia_csv/08- payments.csv",
        "target_headers": target_headers,
        "source_column_indexes": mappings,
    }
    payment_projection_path(data_dir).write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return payload


def load_payment_rows(data_dir: Path, delay_dir: Path) -> list[dict[str, str]]:
    """Return the original logical payment table from its canonical TIA source."""
    normal = data_dir / "payments.csv"
    if normal.exists():
        return read_csv_rows(normal)
    projection_file = payment_projection_path(data_dir)
    canonical = delay_dir / "08- payments.csv"
    if not projection_file.exists():
        return read_csv_rows(canonical)
    try:
        projection = json.loads(projection_file.read_text(encoding="utf-8"))
        headers = list(projection["target_headers"])
        indexes = [int(value) for value in projection["source_column_indexes"]]
    except (OSError, ValueError, TypeError, KeyError):
        return read_csv_rows(canonical)
    _, source_rows = read_csv_matrix(canonical)
    return [
        {header: row[source_index] if source_index < len(row) else "" for header, source_index in zip(headers, indexes)}
        for row in source_rows
    ]
