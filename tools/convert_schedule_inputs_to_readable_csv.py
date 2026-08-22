"""Convert all ten project inputs from JSON envelopes to editable CSV rows.

The project keeps the ten-input limit. Inputs 01-09 preserve every source row
using ``source_table`` and ``source_path``. Input 10 becomes a readable letter
register plus inbox-file table, without retaining opaque JSON in a cell.
"""

from __future__ import annotations

import argparse
import csv
import json
import hashlib
import os
import shutil
import sys
from collections import OrderedDict
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PROJECTS_ROOT = ROOT / "projects"
PROJECT_TEMPLATE = PROJECTS_ROOT / "_PROJECT_TEMPLATE"
DEFAULT_TEMPLATE_ARCHIVE = (
    ROOT.parent / "Project Intelligence Hub NextJS-unneeded files" / "2026-08-22-readable-input-migration"
)
CANONICAL_INPUTS = (
    "01_project_contract.csv",
    "02_schedule_activities.csv",
    "03_schedule_logic.csv",
    "04_progress_evm.csv",
    "05_milestones_scurve.csv",
    "06_delay_events.csv",
    "07_tia_evidence_scenarios.csv",
    "08_commercial_payments_claims.csv",
    "09_risks_rfi_interfaces.csv",
    "10_letters_intelligence.csv",
)

try:
    csv.field_size_limit(sys.maxsize)
except OverflowError:
    csv.field_size_limit(2**31 - 1)


def read_rows(path: Path) -> list[dict[str, str]]:
    for encoding in ("utf-8-sig", "utf-8", "cp1252"):
        try:
            with path.open("r", encoding=encoding, newline="") as handle:
                return list(csv.DictReader(handle))
        except (OSError, UnicodeError, csv.Error):
            continue
    raise RuntimeError(f"Cannot read {path}")


def decode_envelope(path: Path) -> OrderedDict[str, dict[str, Any]]:
    tables: OrderedDict[str, dict[str, Any]] = OrderedDict()
    for record in read_rows(path):
        source_path = str(record.get("source_file") or "").strip()
        if not source_path:
            continue
        table_name = Path(source_path).stem
        table = tables.setdefault(table_name, {"source_path": source_path, "headers": [], "rows": []})
        try:
            payload = json.loads(str(record.get("payload_json") or "null"))
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"Invalid payload_json in {path.name}: {exc}") from exc
        kind = str(record.get("row_kind") or "").strip().casefold()
        if kind == "schema" and isinstance(payload, dict):
            headers = payload.get("headers")
            if isinstance(headers, list):
                table["headers"] = [str(header) for header in headers]
        elif kind == "data" and isinstance(payload, list):
            try:
                row_order = int(str(record.get("row_order") or "0"))
            except ValueError:
                row_order = len(table["rows"]) + 1
            table["rows"].append((row_order, payload))
    return tables


def replace_csv(path: Path, fieldnames: list[str], output_rows: list[dict[str, Any]], dry_run: bool) -> int:
    if dry_run:
        return len(output_rows)
    stat = path.stat()
    temp_path = path.with_suffix(path.suffix + ".readable.tmp")
    with temp_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(output_rows)
    try:
        os.replace(temp_path, path)
    except PermissionError as exc:
        temp_path.unlink(missing_ok=True)
        raise RuntimeError(f"Close '{path.name}' in Excel, then run the conversion again. No input was changed.") from exc
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))
    return len(output_rows)


def write_readable_csv(path: Path, tables: OrderedDict[str, dict[str, Any]], dry_run: bool) -> int:
    headers: list[str] = []
    for table in tables.values():
        for header in table["headers"]:
            if header not in headers:
                headers.append(header)
    fieldnames = ["source_table", "source_path", "row_order", *headers]
    output_rows: list[dict[str, Any]] = []
    for table_name, table in tables.items():
        for row_order, values in sorted(table["rows"], key=lambda item: item[0]):
            row = {
                "source_table": table_name,
                "source_path": table["source_path"],
                "row_order": row_order,
            }
            for index, header in enumerate(table["headers"]):
                row[header] = values[index] if index < len(values) and values[index] is not None else ""
            output_rows.append(row)
    return replace_csv(path, fieldnames, output_rows, dry_run)


def decode_letters_snapshot(path: Path) -> tuple[list[str], list[dict[str, Any]]]:
    snapshot_record = next((row for row in read_rows(path) if str(row.get("row_kind") or "").casefold() == "snapshot"), None)
    if snapshot_record is None:
        return ["record_type", "sheet_name", "row_order", "file_name", "relative_path", "extension", "size_kb", "modified"], []
    try:
        snapshot = json.loads(str(snapshot_record.get("payload_json") or "null"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid letters snapshot in {path.name}: {exc}") from exc
    if not isinstance(snapshot, dict):
        raise RuntimeError(f"Letters snapshot in {path.name} is not an object.")

    output_rows: list[dict[str, Any]] = []
    columns: list[str] = ["record_type", "sheet_name", "row_order", "file_name", "relative_path", "extension", "size_kb", "modified"]
    inbox_files = snapshot.get("inbox_files")
    if isinstance(inbox_files, list):
        for row_order, source in enumerate(inbox_files, start=1):
            if not isinstance(source, dict):
                continue
            output_rows.append({
                "record_type": "inbox_file",
                "sheet_name": "Inbox Files",
                "row_order": row_order,
                "file_name": source.get("name") or "",
                "relative_path": source.get("relative_path") or "",
                "extension": source.get("extension") or "",
                "size_kb": source.get("size_kb") or "",
                "modified": source.get("modified") or "",
            })

    tables = snapshot.get("workbook_tables")
    sheets = tables.get("sheets") if isinstance(tables, dict) else []
    if isinstance(sheets, list):
        for source_sheet in sheets:
            if not isinstance(source_sheet, dict):
                continue
            sheet_name = str(source_sheet.get("name") or "Letters Register")
            for column in source_sheet.get("columns", []):
                column_name = str(column)
                if column_name not in columns:
                    columns.append(column_name)
            source_rows = source_sheet.get("rows")
            if not isinstance(source_rows, list):
                continue
            for row_order, source_row in enumerate(source_rows, start=1):
                if not isinstance(source_row, dict):
                    continue
                row = {"record_type": "letter_register", "sheet_name": sheet_name, "row_order": row_order}
                row.update({str(key): value if value is not None else "" for key, value in source_row.items()})
                output_rows.append(row)
    return columns, output_rows


def input_is_readable(path: Path) -> bool:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        header = next(csv.reader(handle), [])
    columns = {str(column).strip().casefold() for column in header}
    return {"source_table", "source_path", "row_order"}.issubset(columns) or {"record_type", "sheet_name", "row_order"}.issubset(columns)


def csv_fieldnames(path: Path) -> list[str]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return [str(name) for name in (csv.DictReader(handle).fieldnames or [])]


def ensure_inputs_are_writable(paths: list[Path]) -> None:
    locked: list[str] = []
    for path in paths:
        try:
            with path.open("r+b"):
                pass
        except PermissionError:
            locked.append(path.name)
    if locked:
        names = ", ".join(f"'{name}'" for name in locked)
        raise RuntimeError(f"Close {names} in Excel before conversion. No inputs were changed.")


def find_projects() -> list[Path]:
    return [
        path.parent.parent.parent
        for path in PROJECTS_ROOT.rglob("01-data/import_templates/02_schedule_activities.csv")
        if path.parent.parent.parent.name != PROJECT_TEMPLATE.name
    ]


def readable_fieldnames(path: Path) -> list[str]:
    """Return editable field names from either a readable input or its envelope."""
    if input_is_readable(path):
        return csv_fieldnames(path)
    if path.name == "10_letters_intelligence.csv":
        columns, _ = decode_letters_snapshot(path)
        return columns
    tables = decode_envelope(path)
    headers: list[str] = ["source_table", "source_path", "row_order"]
    for table in tables.values():
        for header in table["headers"]:
            if header not in headers:
                headers.append(header)
    return headers


def normalize_readable_columns(projects: list[Path], dry_run: bool) -> None:
    """Give every project the same editable header contract without changing rows.

    Empty original bundles have no schema record. They must still show the
    normal domain columns in Excel, rather than only internal source metadata.
    """
    union_by_input: dict[str, list[str]] = {}
    for input_name in CANONICAL_INPUTS:
        fields: list[str] = []
        for project in [*projects, PROJECT_TEMPLATE]:
            path = project / "01-data" / "import_templates" / input_name
            for field in readable_fieldnames(path):
                if field not in fields:
                    fields.append(field)
        union_by_input[input_name] = fields

    for project in projects:
        data_dir = project / "01-data" / "import_templates"
        for input_name in CANONICAL_INPUTS:
            path = data_dir / input_name
            existing = csv_fieldnames(path)
            target = union_by_input[input_name]
            if existing == target:
                continue
            rows = read_rows(path)
            replace_csv(path, target, rows, dry_run)
            state = "WOULD NORMALIZE" if dry_run else "NORMALIZED"
            print(f"{state} {project.name} / {input_name}: {len(existing)} to {len(target)} editable columns")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def prepare_future_project_template(dry_run: bool, archive_root: Path) -> None:
    """Make the copyable project template use only the ten editable CSV contracts.

    Headers are the union of the active project contracts, so the template never
    forces a new project to use an opaque payload_json envelope. Old template
    files are moved, never deleted, and each move is hash-recorded.
    """
    projects = find_projects()
    if not projects:
        raise RuntimeError("Cannot create the future-project template: no active canonical project inputs were found.")
    target_dir = PROJECT_TEMPLATE / "01-data" / "import_templates"
    target_paths = [target_dir / name for name in CANONICAL_INPUTS]
    legacy_paths = [
        path for path in target_dir.glob("*.csv")
        if path.name not in CANONICAL_INPUTS
    ]

    fieldnames_by_input: dict[str, list[str]] = {}
    for input_name in CANONICAL_INPUTS:
        fields: list[str] = []
        for project in projects:
            candidate = project / "01-data" / "import_templates" / input_name
            for field in readable_fieldnames(candidate):
                if field not in fields:
                    fields.append(field)
        if not fields:
            raise RuntimeError(f"Cannot derive editable columns for {input_name}.")
        fieldnames_by_input[input_name] = fields

    if dry_run:
        print(f"WOULD PREPARE template with {len(target_paths)} editable canonical inputs")
        for path in legacy_paths:
            print(f"WOULD ARCHIVE template legacy input: {path.name}")
        return

    target_dir.mkdir(parents=True, exist_ok=True)
    for path in target_paths:
        with path.open("w", encoding="utf-8-sig", newline="") as handle:
            csv.DictWriter(handle, fieldnames=fieldnames_by_input[path.name]).writeheader()

    archive_base = archive_root / "projects" / "_PROJECT_TEMPLATE" / "01-data" / "import_templates"
    archive_base.mkdir(parents=True, exist_ok=True)
    records: list[dict[str, str]] = []
    for path in legacy_paths:
        destination = archive_base / path.name
        if destination.exists():
            raise RuntimeError(
                f"Archive destination already exists: {destination}. "
                "No template input was moved; choose a new archive directory."
            )
        else:
            source_hash = sha256(path)
            shutil.move(str(path), str(destination))
            if sha256(destination) != source_hash:
                raise RuntimeError(f"Archive hash verification failed for {path.name}")
        records.append({
            "original_relative_path": str(path.relative_to(ROOT)),
            "archive_path": str(destination),
            "sha256": sha256(destination),
        })
    register = archive_root / "template_input_archive_sha256.csv"
    with register.open("w", encoding="utf-8", newline="") as handle:
        csv.DictWriter(handle, fieldnames=["original_relative_path", "archive_path", "sha256"]).writeheader()
        csv.DictWriter(handle, fieldnames=["original_relative_path", "archive_path", "sha256"]).writerows(records)
    print(f"PREPARED template with {len(target_paths)} editable canonical inputs; archived {len(records)} legacy template CSVs")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", action="append", default=[], help="Project folder name to convert; default is every project.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--prepare-template", action="store_true", help="Create a header-only, ten-input template for future projects and archive its legacy CSV inputs.")
    parser.add_argument("--template-archive", default=str(DEFAULT_TEMPLATE_ARCHIVE), help="Archive directory used only with --prepare-template.")
    args = parser.parse_args()
    selected = {name.casefold() for name in args.project}
    if args.prepare_template:
        prepare_future_project_template(args.dry_run, Path(args.template_archive).resolve())
        return 0
    projects = [path for path in find_projects() if not selected or path.name.casefold() in selected]
    if not projects:
        raise RuntimeError("No matching project inputs found.")
    # A five-project migration must be all-or-nothing at the preflight stage:
    # never convert one project and then discover an Excel lock in another.
    project_inputs = {
        project: [project / "01-data" / "import_templates" / input_name for input_name in CANONICAL_INPUTS]
        for project in projects
    }
    locked_by_project: list[str] = []
    for project, input_paths in project_inputs.items():
        try:
            ensure_inputs_are_writable(input_paths)
        except RuntimeError as exc:
            locked_by_project.append(f"{project.name}: {exc}")
    if locked_by_project:
        raise RuntimeError("All-project conversion was not started.\n" + "\n".join(locked_by_project))
    for project in projects:
        data_dir = project / "01-data" / "import_templates"
        for input_name in CANONICAL_INPUTS:
            path = data_dir / input_name
            if input_is_readable(path):
                print(f"UNCHANGED {project.name} / {input_name}: already readable")
                continue
            if input_name == "10_letters_intelligence.csv":
                columns, rows = decode_letters_snapshot(path)
                count = replace_csv(path, columns, rows, args.dry_run)
                state = "WOULD CONVERT" if args.dry_run else "CONVERTED"
                print(f"{state} {project.name} / {input_name}: {count} editable letter and inbox rows")
                continue
            tables = decode_envelope(path)
            count = write_readable_csv(path, tables, args.dry_run)
            state = "WOULD CONVERT" if args.dry_run else "CONVERTED"
            print(f"{state} {project.name} / {input_name}: {count} editable rows, {len(tables)} source tables")
    normalize_readable_columns(projects, args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
