"""Lossless project-input envelopes used by the Vercel generator.

The legacy one-file bundle remains readable for a safe, reversible migration.
Published projects use the ten numbered project-local canonical CSVs instead.
"""
from __future__ import annotations

import csv
import json
import sys
csv.field_size_limit(sys.maxsize)
from functools import lru_cache
from pathlib import Path

BUNDLE_FILENAME = "project_input_bundle.csv"
BUNDLE_HEADERS = ["bundle_version", "source_scope", "source_file", "row_kind", "row_order", "payload_json"]
CANONICAL_INPUT_FILENAMES = (
    "01_project_contract.csv", "02_schedule_activities.csv", "03_schedule_logic.csv",
    "04_progress_evm.csv", "05_milestones_scurve.csv", "06_delay_events.csv",
    "07_tia_evidence_scenarios.csv", "08_commercial_payments_claims.csv",
    "09_risks_rfi_interfaces.csv", "10_letters_intelligence.csv",
)


def _context(path: Path) -> tuple[Path, Path, str] | None:
    candidate = path.resolve()
    for project_root in (candidate.parent, *candidate.parents):
        data_dir = project_root / "01-data" / "import_templates"
        delay_dir = project_root / "02-delay_analysis" / "unified_tia_csv"
        if not data_dir.is_dir():
            continue
        try:
            return data_dir, delay_dir, "data/" + candidate.relative_to(data_dir).as_posix()
        except ValueError:
            pass
        try:
            return data_dir, delay_dir, "tia/" + candidate.relative_to(delay_dir).as_posix()
        except ValueError:
            return None
    return None


@lru_cache(maxsize=128)
def _load_cached(envelope_text: str, stamp: tuple[int, int]) -> dict[str, tuple[list[str], list[list[str]]]]:
    tables: dict[str, tuple[list[str], list[list[str]]]] = {}
    try:
        with Path(envelope_text).open("r", encoding="utf-8-sig", newline="") as handle:
            records = list(csv.DictReader(handle))
    except (OSError, UnicodeDecodeError):
        return tables
    for record in records:
        key = str(record.get("source_scope") or "").strip()
        if not key:
            continue
        try:
            payload = json.loads(record.get("payload_json") or "{}")
        except (TypeError, ValueError):
            continue
        kind = str(record.get("row_kind") or "").strip().lower()
        if kind == "schema" and isinstance(payload, dict):
            headers = [str(value) for value in payload.get("headers") or []]
            _, current_rows = tables.get(key, (headers, []))
            tables[key] = (headers, current_rows)
        elif kind == "data" and isinstance(payload, list):
            headers, current_rows = tables.get(key, ([], []))
            current_rows.append([str(value) if value is not None else "" for value in payload])
            tables[key] = (headers, current_rows)
    return tables


def _source_files(data_dir: Path) -> tuple[Path, ...]:
    return (data_dir / BUNDLE_FILENAME, *(data_dir / name for name in CANONICAL_INPUT_FILENAMES))


def bundle_table(path: Path) -> tuple[list[str], list[list[str]]] | None:
    context = _context(path)
    if not context:
        return None
    data_dir, _delay_dir, key = context
    for source_file in _source_files(data_dir):
        if not source_file.is_file():
            continue
        stat = source_file.stat()
        table = _load_cached(str(source_file.resolve()), (stat.st_mtime_ns, stat.st_size)).get(key)
        if table is not None:
            return table
    return None


def canonical_input_paths(data_dir: Path) -> tuple[Path, ...]:
    return tuple(data_dir / name for name in CANONICAL_INPUT_FILENAMES)


def has_canonical_inputs(data_dir: Path) -> bool:
    return all(path.is_file() for path in canonical_input_paths(data_dir))


def physical_input_path(path: Path) -> Path | None:
    context = _context(path)
    if not context:
        return path if path.exists() else None
    data_dir, _delay_dir, key = context
    for source_file in _source_files(data_dir):
        if not source_file.is_file():
            continue
        stat = source_file.stat()
        if key in _load_cached(str(source_file.resolve()), (stat.st_mtime_ns, stat.st_size)):
            return source_file
    return path if path.exists() else None


def has_bundle_table(path: Path) -> bool:
    return bundle_table(path) is not None


def read_rows(path: Path) -> list[dict[str, str]] | None:
    table = bundle_table(path)
    if table is None:
        return None
    headers, rows = table
    return [dict(zip(headers, row)) for row in rows]


def read_matrix(path: Path) -> tuple[list[str], list[list[str]]] | None:
    return bundle_table(path)


def headers(path: Path) -> list[str] | None:
    table = bundle_table(path)
    return table[0] if table is not None else None
