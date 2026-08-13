from __future__ import annotations

"""Move active Delay TIA CSVs into the per-project unified workspace.

The migration is intentionally non-destructive: legacy CSVs are moved, never
rewritten; standard registers are added only where a source is available.
"""

import argparse
import csv
import hashlib
import re
import shutil
import sys
from pathlib import Path


STANDARD_FILES = (
    "01_project_metadata.csv",
    "02_source_file_register.csv",
    "03_native_xer_pair_register.csv",
    "04_p6_activity_register.csv",
    "05_p6_relationship_register.csv",
    "06_delay_event_register.csv",
    "07_fragnet_activity_register.csv",
    "08_fragnet_relationship_register.csv",
    "09_before_after_fragnet_comparison.csv",
    "10_concurrency_entitlement_register.csv",
    "11_entitlement_evidence_register.csv",
    "12_delay_event_classification.csv",
    "13_tia_recovery_scenario.csv",
    "14_controlled_release_register.csv",
    "15_reconciliation_register.csv",
    "16_output_artifact_register.csv",
)


def read_rows(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    for encoding in ("utf-8-sig", "utf-8", "cp1256", "cp1252"):
        try:
            with path.open("r", encoding=encoding, newline="") as handle:
                reader = csv.DictReader(handle)
                return list(reader.fieldnames or []), list(reader)
        except UnicodeDecodeError:
            continue
    return [], []


def write_rows(path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def header_only(path: Path) -> bool:
    _, rows = read_rows(path)
    return not rows


def first_value(row: dict[str, str], *names: str) -> str:
    normalized = {re.sub(r"[^a-z0-9]+", "", key.lower()): value for key, value in row.items()}
    for name in names:
        value = normalized.get(re.sub(r"[^a-z0-9]+", "", name.lower()), "")
        if value:
            return value
    return ""


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def project_key(delay_dir: Path) -> str:
    return re.sub(r"[^a-z0-9]+", "-", delay_dir.parent.name.lower()).strip("-")


def copy_standard_templates(template_dir: Path, target_dir: Path) -> None:
    for name in STANDARD_FILES:
        source = template_dir / name
        target = target_dir / name
        if not source.exists():
            raise FileNotFoundError(f"Missing standard TIA template: {source}")
        if not target.exists():
            shutil.copy2(source, target)


def reset_standard_headers(root: Path, target_dir: Path) -> None:
    """Rebuild only the generated contract files; never touch raw source CSVs."""
    sys.path.insert(0, str(root / "src"))
    from construction_system.unified_tia_csv import CSV_CONTRACTS

    for contract in CSV_CONTRACTS:
        write_rows(target_dir / contract.filename, list(contract.columns), [])


def write_if_empty(path: Path, rows: list[dict[str, str]]) -> None:
    fields, _ = read_rows(path)
    if header_only(path) and rows:
        write_rows(path, fields, rows)


def hydrate_standard_registers(unified_dir: Path, key: str) -> None:
    metadata_source = unified_dir / "01-project_metadata_template.csv"
    if metadata_source.exists():
        _, source_rows = read_rows(metadata_source)
        if source_rows:
            source = source_rows[0]
            write_if_empty(unified_dir / "01_project_metadata.csv", [{
                "project_id": first_value(source, "project_id"),
                "project_key": key,
                "project_name": first_value(source, "Project Name"),
                "contract_number": first_value(source, "Contract No"),
                "employer": first_value(source, "Employer"),
                "contractor": first_value(source, "Contractor"),
                "consultant": first_value(source, "Consultant"),
                "baseline_schedule_name": first_value(source, "Baseline Name"),
                "analysis_data_date": first_value(source, "Data Date"),
                "impacted_update_name": first_value(source, "Impacted Update Name"),
                "prepared_by": first_value(source, "Prepared By"),
                "report_revision": first_value(source, "Report Revision"),
                "report_date": first_value(source, "Report Date"),
            }])

    legacy_sources = [
        path for path in sorted(unified_dir.glob("*.csv"))
        if path.name not in STANDARD_FILES
    ]
    source_rows = [{
        "project_id": first_value(read_rows(path)[1][0], "project_id") if read_rows(path)[1] else "",
        "source_id": f"SRC-{index:03d}",
        "source_role": "active_tia_source",
        "source_file_name": path.name,
        "source_relative_path": f"02-delay_analysis/unified_tia_csv/{path.name}",
        "source_sha256": sha256(path),
        "source_status": "active",
    } for index, path in enumerate(legacy_sources, start=1)]
    write_if_empty(unified_dir / "02_source_file_register.csv", source_rows)

    p6_source = unified_dir / "04- p6_activity_export.csv"
    if p6_source.exists():
        _, source_rows = read_rows(p6_source)
        write_if_empty(unified_dir / "04_p6_activity_register.csv", [{
            "project_id": first_value(row, "project_id"),
            "schedule_version": "impacted_update",
            "activity_id": first_value(row, "Activity ID"),
            "activity_name": first_value(row, "Activity Name"),
            "wbs_code": first_value(row, "WBS"),
            "baseline_start": first_value(row, "Baseline Start"),
            "baseline_finish": first_value(row, "Baseline Finish"),
            "actual_start": first_value(row, "Actual Start"),
            "actual_finish": first_value(row, "Actual Finish"),
            "remaining_duration_days": first_value(row, "Remaining Duration"),
            "total_float_days": first_value(row, "Total Float"),
            "free_float_days": first_value(row, "Free Float"),
            "is_critical": first_value(row, "Critical"),
            "is_longest_path": first_value(row, "Longest Path"),
            "physical_percent_complete": first_value(row, "Physical % Complete"),
            "source_id": "SRC-P6-ACTIVITY",
        } for row in source_rows])

    event_source = unified_dir / "12_delay_event_classification.csv"
    if event_source.exists():
        _, source_rows = read_rows(event_source)
        write_if_empty(unified_dir / "06_delay_event_register.csv", [{
            "project_id": first_value(row, "project_id"),
            "event_id": first_value(row, "event_id"),
            "event_name": first_value(row, "event_id", "root_cause"),
            "event_category": first_value(row, "delay_type"),
            "responsible_party": first_value(row, "responsible_party"),
            "event_start": first_value(row, "event_start"),
            "event_finish": first_value(row, "event_finish"),
            "claimed_delay_days": first_value(row, "delay_days"),
            "affected_activity_id": first_value(row, "activity_id"),
            "evidence_reference": first_value(row, "evidence_reference"),
            "causation_status": first_value(row, "root_cause"),
            "inclusion_in_integrated_eot": first_value(row, "entitlement_status"),
            "analyst_status": first_value(row, "analyst_status"),
        } for row in source_rows])
        target = unified_dir / "12_delay_event_classification.csv"
        if header_only(target):
            shutil.copy2(event_source, target)

    recovery_source = unified_dir / "13_tia_recovery_scenario.csv"
    if recovery_source.exists() and header_only(unified_dir / "13_tia_recovery_scenario.csv"):
        shutil.copy2(recovery_source, unified_dir / "13_tia_recovery_scenario.csv")

    concurrency_source = unified_dir / "11-concurrency_matrix_template.updated.csv"
    if concurrency_source.exists():
        _, source_rows = read_rows(concurrency_source)
        write_if_empty(unified_dir / "10_concurrency_entitlement_register.csv", [{
            "project_id": first_value(row, "project_id"),
            "overlap_id": f"CONC-{index:03d}",
            "contractor_event_id": first_value(row, "Primary Event ID"),
            "affected_activity_id": first_value(row, "Activity ID"),
            "overlap_start": first_value(row, "Overlap Start"),
            "overlap_finish": first_value(row, "Overlap Finish"),
            "concurrent_delay_days": first_value(row, "Concurrent delay"),
            "evidence_reference": "11-concurrency_matrix_template.updated.csv",
        } for index, row in enumerate(source_rows, start=1)])

    clause_source = unified_dir / "06- contract_library.csv"
    if clause_source.exists():
        _, source_rows = read_rows(clause_source)
        write_if_empty(unified_dir / "11_entitlement_evidence_register.csv", [{
            "project_id": first_value(row, "project_id"),
            "evidence_id": f"CLAUSE-{index:03d}",
            "evidence_type": "contract_clause",
            "evidence_reference": first_value(row, "Clause / Topic", "Location"),
            "notice_status": first_value(row, "Notice / Time Bar"),
            "compensation_status": first_value(row, "Money Impact"),
            "entitlement_status": first_value(row, "Who Holds Leverage"),
            "source_id": "SRC-CONTRACT-LIBRARY",
            "verification_status": "source_recorded",
        } for index, row in enumerate(source_rows, start=1)])


def migrate(root: Path, *, reset_generated_registers: bool = False) -> list[Path]:
    projects_root = root / "projects"
    template_dir = projects_root / "_PROJECT_TEMPLATE" / "02-delay_analysis" / "unified_tia_csv"
    if not template_dir.exists():
        raise FileNotFoundError(f"Missing template source: {template_dir}")

    migrated: list[Path] = []
    for delay_dir in sorted(projects_root.rglob("02-delay_analysis")):
        legacy_dir = delay_dir / "steel_delay_tia_templates"
        unified_dir = delay_dir / "unified_tia_csv"
        if legacy_dir.exists():
            unified_dir.mkdir(exist_ok=True)
            for source in sorted(legacy_dir.iterdir()):
                if source.name == ".gitkeep":
                    source.unlink()
                    continue
                target = unified_dir / source.name
                if target.exists():
                    raise FileExistsError(f"Refusing to overwrite existing file: {target}")
                shutil.move(str(source), str(target))
            legacy_dir.rmdir()
        if not unified_dir.exists():
            raise FileNotFoundError(f"No TIA CSV folder for {delay_dir}")
        placeholder = unified_dir / ".gitkeep"
        if placeholder.exists():
            placeholder.unlink()
        copy_standard_templates(template_dir, unified_dir)
        if reset_generated_registers:
            reset_standard_headers(root, unified_dir)
        migrated.append(unified_dir)
    return migrated


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--reset-generated-registers", action="store_true")
    args = parser.parse_args()
    for folder in migrate(args.root.resolve(), reset_generated_registers=args.reset_generated_registers):
        print(f"Unified TIA CSV ready: {folder}")
