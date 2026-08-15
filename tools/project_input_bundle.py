"""Lossless one-file project input bundle used by the Vercel generator."""
from __future__ import annotations

import csv
import json
from functools import lru_cache
from pathlib import Path

BUNDLE_FILENAME = "project_input_bundle.csv"
BUNDLE_HEADERS = ["bundle_version", "source_scope", "source_file", "row_kind", "row_order", "payload_json"]


def _context(path: Path) -> tuple[Path, str] | None:
    candidate = path.resolve()
    for project_root in (candidate.parent, *candidate.parents):
        data_dir = project_root / "01-data" / "import_templates"
        delay_dir = project_root / "02-delay_analysis" / "unified_tia_csv"
        if not data_dir.is_dir():
            continue
        try:
            return data_dir / BUNDLE_FILENAME, "data/" + candidate.relative_to(data_dir).as_posix()
        except ValueError:
            pass
        try:
            return data_dir / BUNDLE_FILENAME, "tia/" + candidate.relative_to(delay_dir).as_posix()
        except ValueError:
            return None
    return None

@lru_cache(maxsize=64)
def _load_cached(bundle_text: str, stamp: tuple[int, int]) -> dict[str, tuple[list[str], list[list[str]]]]:
    tables: dict[str, tuple[list[str], list[list[str]]]] = {}
    try:
        with Path(bundle_text).open("r", encoding="utf-8-sig", newline="") as handle:
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


def bundle_table(path: Path) -> tuple[list[str], list[list[str]]] | None:
    context = _context(path)
    if not context:
        return None
    bundle, key = context
    if not bundle.is_file():
        return None
    stat = bundle.stat()
    return _load_cached(str(bundle.resolve()), (stat.st_mtime_ns, stat.st_size)).get(key)


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