"""Project-neutral CSV contract for controlled Time Impact Analysis inputs.

The contract captures the evidence and calculation controls used by the
project-isolated controlled TIA adapter.  It deliberately validates readiness
and arithmetic reconciliation only: native Primavera P6/XER analysis and the
project's formal approval remain the authority for any EOT conclusion.
"""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable


SCHEMA_VERSION = "1.0.0"
PACK_NAME = "Universal Controlled TIA CSV Pack"


@dataclass(frozen=True)
class CsvContract:
    filename: str
    title: str
    purpose: str
    columns: tuple[str, ...]
    required_fields: tuple[str, ...]
    output_areas: tuple[str, ...]


def _contract(
    filename: str,
    title: str,
    purpose: str,
    columns: str,
    required: str,
    outputs: str,
) -> CsvContract:
    return CsvContract(
        filename=filename,
        title=title,
        purpose=purpose,
        columns=tuple(item.strip() for item in columns.split(",")),
        required_fields=tuple(item.strip() for item in required.split(",") if item.strip()),
        output_areas=tuple(item.strip() for item in outputs.split("|")),
    )


CSV_CONTRACTS: tuple[CsvContract, ...] = (
    _contract(
        "01_project_metadata.csv",
        "Project and Analysis Metadata",
        "One controlled identity and schedule-analysis context for this project.",
        "project_id,project_key,project_name,contract_number,employer,contractor,consultant,baseline_schedule_name,baseline_data_date,impacted_update_name,impacted_data_date,analysis_data_date,prepared_by,report_revision,report_date,calendar_name,contract_time_unit,project_finish_milestone_id",
        "project_id,project_key,project_name,baseline_schedule_name,baseline_data_date,impacted_update_name,impacted_data_date,analysis_data_date,prepared_by,report_revision,report_date,project_finish_milestone_id",
        "Source Integrity|Schedule and CPM|EOT Position",
    ),
    _contract(
        "02_source_file_register.csv",
        "Source File Register",
        "Hashable inventory of the project-local source files used by the TIA.",
        "project_id,source_id,source_role,source_file_name,source_relative_path,source_sha256,file_date,received_date,source_owner,source_status,notes",
        "project_id,source_id,source_role,source_file_name,source_relative_path,source_status",
        "Source Integrity|AI Review and Run Control",
    ),
    _contract(
        "03_native_xer_pair_register.csv",
        "Native XER Pair Register",
        "Baseline and impacted Primavera source pairing for each event variant.",
        "project_id,xer_pair_id,event_variant,baseline_source_id,impacted_source_id,data_date,baseline_schedule_name,impacted_update_name,baseline_project_finish,impacted_project_finish,parity_status,p6_operator,run_reference,notes",
        "project_id,xer_pair_id,event_variant,baseline_source_id,impacted_source_id,data_date,parity_status",
        "Source Integrity|Schedule and CPM",
    ),
    _contract(
        "04_p6_activity_register.csv",
        "P6 Activity Register",
        "Normalized P6 activity records for the baseline, impacted update, or fragnet schedule version.",
        "project_id,schedule_version,activity_id,activity_name,wbs_code,activity_type,calendar_name,baseline_start,baseline_finish,actual_start,actual_finish,remaining_duration_days,total_float_days,free_float_days,is_critical,is_longest_path,physical_percent_complete,source_id,notes",
        "project_id,schedule_version,activity_id,activity_name,activity_type,source_id",
        "Schedule and CPM|Events and Fragnets",
    ),
    _contract(
        "05_p6_relationship_register.csv",
        "P6 Relationship and Lag Register",
        "Normalized predecessor/successor logic supporting CPM and fragnet checks.",
        "project_id,schedule_version,successor_activity_id,predecessor_activity_id,relationship_type,lag_days,source_id,notes",
        "project_id,schedule_version,successor_activity_id,predecessor_activity_id,relationship_type,source_id",
        "Schedule and CPM|Events and Fragnets",
    ),
    _contract(
        "06_delay_event_register.csv",
        "Delay Event and Fragnet Register",
        "Project-specific delay-event facts, affected activity, responsibility, and entitlement controls.",
        "project_id,event_id,event_variant,event_name,event_category,responsible_party,notice_status,event_start,event_finish,claimed_delay_days,affected_activity_id,evidence_reference,source_id,causation_status,criticality_status,inclusion_in_integrated_eot,analyst_status,notes",
        "project_id,event_id,event_variant,event_name,responsible_party,event_start,event_finish,affected_activity_id,evidence_reference,source_id,causation_status,criticality_status,inclusion_in_integrated_eot,analyst_status",
        "Events and Fragnets|Concurrency and Entitlement|EOT Position",
    ),
    _contract(
        "07_fragnet_activity_register.csv",
        "Fragnet Activity Register",
        "Inserted or modelled fragnet activities tied to a single event variant.",
        "project_id,event_variant,fragnet_activity_id,fragnet_activity_name,activity_type,original_duration_days,calendar_name,fragnet_start,fragnet_finish,affected_activity_id,source_id,analyst_status,notes",
        "project_id,event_variant,fragnet_activity_id,fragnet_activity_name,activity_type,original_duration_days,affected_activity_id,source_id,analyst_status",
        "Events and Fragnets|Schedule and CPM",
    ),
    _contract(
        "08_fragnet_relationship_register.csv",
        "Fragnet Relationship Register",
        "Logic links within each event fragnet and to the affected project schedule.",
        "project_id,event_variant,successor_activity_id,predecessor_activity_id,relationship_type,lag_days,source_id,notes",
        "project_id,event_variant,successor_activity_id,predecessor_activity_id,relationship_type,source_id",
        "Events and Fragnets|Schedule and CPM",
    ),
    _contract(
        "09_before_after_fragnet_comparison.csv",
        "Approved Before / After Fragnet Comparison",
        "The controlled matrix used to reconcile float and project-finish movement by event variant.",
        "project_id,project_key,event_id,event_variant,data_date,activity_id,milestone_activity_name,before_total_float_days,before_forecast_finish,after_total_float_days,after_forecast_finish,float_change_days,finish_movement_calendar_days,impact_assessment,inclusion_in_integrated_eot,evidence_reference,verification_status",
        "project_id,project_key,event_id,event_variant,data_date,activity_id,milestone_activity_name,before_forecast_finish,after_forecast_finish,finish_movement_calendar_days,impact_assessment,inclusion_in_integrated_eot,evidence_reference,verification_status",
        "Schedule and CPM|Events and Fragnets|Concurrency and Entitlement|EOT Position",
    ),
    _contract(
        "10_concurrency_entitlement_register.csv",
        "Concurrency and Entitlement Register",
        "Overlap, apportionment, and entitlement evidence; never a substitute for a contractual decision.",
        "project_id,event_variant,overlap_id,contractor_event_id,employer_event_id,affected_activity_id,overlap_start,overlap_finish,overlap_calendar_days,concurrent_delay_days,apportionment_method,concurrency_adjustment_days,included_in_adjustment,entitlement_position,evidence_reference,verification_status,notes",
        "project_id,event_variant,overlap_id,affected_activity_id,apportionment_method,concurrency_adjustment_days,included_in_adjustment,entitlement_position,evidence_reference,verification_status",
        "Concurrency and Entitlement|EOT Position",
    ),
    _contract(
        "11_entitlement_evidence_register.csv",
        "Entitlement Evidence and Notice Register",
        "Notice, time-bar, causation, criticality, compensation, and evidence validation by event.",
        "project_id,event_variant,evidence_id,evidence_type,evidence_reference,document_date,notice_status,time_bar_status,causation_status,criticality_status,compensation_status,entitlement_status,source_id,verification_status,notes",
        "project_id,event_variant,evidence_id,evidence_type,evidence_reference,notice_status,time_bar_status,causation_status,criticality_status,entitlement_status,source_id,verification_status",
        "Source Integrity|Concurrency and Entitlement|EOT Position",
    ),
    _contract(
        "12_delay_event_classification.csv",
        "Delay Event Classification",
        "Chart-ready event classification compatible with the controlled project chart inputs.",
        "project_id,event_id,activity_id,root_cause,delay_type,entitlement_status,responsible_party,event_start,event_finish,delay_days,evidence_reference,source_file,source_sheet,source_row,analyst_status,notes",
        "project_id,event_id,activity_id,root_cause,delay_type,entitlement_status,responsible_party,event_start,event_finish,delay_days,evidence_reference,source_file,source_row,analyst_status",
        "Events and Fragnets|AI Review and Run Control",
    ),
    _contract(
        "13_tia_recovery_scenario.csv",
        "TIA Recovery Scenario",
        "Chart-ready recovery records compatible with the controlled project recovery chart input.",
        "project_id,scenario_id,scenario_name,analyst_status,activity_id,status_date,baseline_progress_percent,impacted_progress_percent,recovery_progress_percent,baseline_finish,impacted_finish,recovery_finish,predecessor_activity_id,successor_activity_id,relationship_type,lag_days,p6_update_reference,evidence_reference,source_file,source_sheet,source_row,notes",
        "project_id,scenario_id,scenario_name,analyst_status,activity_id,status_date,baseline_progress_percent,impacted_progress_percent,recovery_progress_percent,p6_update_reference,evidence_reference,source_file,source_row",
        "Schedule and CPM|AI Review and Run Control",
    ),
    _contract(
        "14_controlled_release_register.csv",
        "Controlled Release Register",
        "Single submitted position and approval control; it must reconcile to the matrix and project-finish dates.",
        "project_id,project_key,release_id,release_status,approval_status,baseline_project_finish,impacted_project_finish,project_finish_milestone_id,gross_included_event_movement_days,concurrency_adjustment_days,integrated_eot_calendar_days,approved_matrix_reference,source_manifest_reference,approval_reference,approved_by,approved_date,notes",
        "project_id,project_key,release_id,release_status,approval_status,baseline_project_finish,impacted_project_finish,project_finish_milestone_id,gross_included_event_movement_days,concurrency_adjustment_days,integrated_eot_calendar_days,approved_matrix_reference,source_manifest_reference",
        "Source Integrity|EOT Position|AI Review and Run Control",
    ),
    _contract(
        "15_reconciliation_register.csv",
        "Reconciliation Register",
        "Historic, source, logic, or arithmetic discrepancies that must be resolved or explicitly excluded.",
        "project_id,reconciliation_id,issue_type,issue_description,historical_value,active_position,resolution_required,owner,status,evidence_reference,notes",
        "project_id,reconciliation_id,issue_type,issue_description,resolution_required,owner,status",
        "Source Integrity|Schedule and CPM|Concurrency and Entitlement|EOT Position",
    ),
    _contract(
        "16_output_artifact_register.csv",
        "Output Artifact Register",
        "HTML, PDF, PPTX, or ZIP publication records tied to the project's controlled release and fingerprint.",
        "project_id,release_id,artifact_id,artifact_type,artifact_title,output_filename,source_project_id,source_report_fingerprint,generated_at,review_status,publication_status,approved_by,approved_date,notes",
        "project_id,release_id,artifact_id,artifact_type,artifact_title,output_filename,source_project_id,source_report_fingerprint,generated_at,review_status,publication_status",
        "AI Review and Run Control|Publication Artifacts",
    ),
)

CONTRACT_BY_FILENAME = {contract.filename: contract for contract in CSV_CONTRACTS}

DATE_FIELDS = {
    "baseline_data_date", "impacted_data_date", "analysis_data_date", "report_date", "file_date", "received_date",
    "data_date", "baseline_start", "baseline_finish", "actual_start", "actual_finish", "event_start", "event_finish",
    "fragnet_start", "fragnet_finish", "overlap_start", "overlap_finish", "document_date", "status_date",
    "before_forecast_finish", "after_forecast_finish", "recovery_finish", "approved_date", "generated_at",
    "baseline_project_finish", "impacted_project_finish",
}
NUMERIC_FIELDS = {
    "remaining_duration_days", "total_float_days", "free_float_days", "physical_percent_complete", "lag_days",
    "claimed_delay_days", "original_duration_days", "before_total_float_days", "after_total_float_days",
    "float_change_days", "finish_movement_calendar_days", "overlap_calendar_days", "concurrent_delay_days",
    "concurrency_adjustment_days", "delay_days", "baseline_progress_percent", "impacted_progress_percent",
    "recovery_progress_percent", "gross_included_event_movement_days", "integrated_eot_calendar_days",
}
RELATIONSHIPS = {"FS", "SS", "FF", "SF"}
INCLUSION_VALUES = {"yes", "no", "included", "excluded", "true", "false"}
OPEN_RECONCILIATION = {"open", "in_progress", "pending"}


def pack_manifest() -> dict[str, Any]:
    return {
        "pack_name": PACK_NAME,
        "schema_version": SCHEMA_VERSION,
        "purpose": "Project-neutral controlled TIA input contract. Native P6/XER analysis and formal approval remain authoritative.",
        "project_isolation_rule": "Populate one pack per project. Every populated row must use the metadata project_id; do not reuse another project's schedule, evidence, EOT, or artifacts.",
        "final_eot_rule": "This pack validates structure and reconciliation only. It does not calculate or approve a contractual EOT.",
        "files": [
            {
                "filename": contract.filename,
                "title": contract.title,
                "purpose": contract.purpose,
                "columns": list(contract.columns),
                "required_fields": list(contract.required_fields),
                "output_areas": list(contract.output_areas),
            }
            for contract in CSV_CONTRACTS
        ],
    }


def _csv_rows(path: Path) -> tuple[list[str], list[dict[str, str]], str | None]:
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream)
            header = [str(value or "").strip() for value in (reader.fieldnames or [])]
            rows = [{str(key or "").strip(): str(value or "").strip() for key, value in row.items()} for row in reader]
            return header, rows, None
    except (OSError, UnicodeDecodeError, csv.Error) as exc:
        return [], [], str(exc)


def _is_iso_date(value: str) -> bool:
    if not value:
        return True
    candidate = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        datetime.fromisoformat(candidate)
        return True
    except ValueError:
        return False


def _number(value: str) -> float | None:
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _normalise(value: str) -> str:
    return value.strip().casefold()


def _append_issue(issues: list[dict[str, str]], filename: str, row: int | str, field: str, message: str) -> None:
    issues.append({"file": filename, "row": str(row), "field": field, "message": message})


def _non_empty(rows: Iterable[dict[str, str]], field: str) -> set[str]:
    return {_normalise(row.get(field, "")) for row in rows if row.get(field, "").strip()}


def _validate_cross_references(rows_by_file: dict[str, list[dict[str, str]]], issues: list[dict[str, str]]) -> None:
    source_ids = _non_empty(rows_by_file["02_source_file_register.csv"], "source_id")
    event_variants = _non_empty(rows_by_file["06_delay_event_register.csv"], "event_variant")
    event_ids = _non_empty(rows_by_file["06_delay_event_register.csv"], "event_id")
    activities = {
        (_normalise(row.get("schedule_version", "")), _normalise(row.get("activity_id", "")))
        for row in rows_by_file["04_p6_activity_register.csv"]
        if row.get("activity_id", "").strip()
    }
    all_activity_ids = {activity_id for _, activity_id in activities}

    for filename, rows in rows_by_file.items():
        for row_number, row in enumerate(rows, start=2):
            source_id = _normalise(row.get("source_id", ""))
            if source_id and source_id not in source_ids:
                _append_issue(issues, filename, row_number, "source_id", "Source ID is not present in 02_source_file_register.csv.")
            variant = _normalise(row.get("event_variant", ""))
            if filename not in {"03_native_xer_pair_register.csv", "06_delay_event_register.csv"} and variant and variant not in event_variants:
                _append_issue(issues, filename, row_number, "event_variant", "Event variant is not present in 06_delay_event_register.csv.")
            event_id = _normalise(row.get("event_id", ""))
            if filename == "12_delay_event_classification.csv" and event_id and event_id not in event_ids:
                _append_issue(issues, filename, row_number, "event_id", "Event ID is not present in 06_delay_event_register.csv.")
            activity_id = _normalise(row.get("affected_activity_id", "") or row.get("activity_id", ""))
            if activity_id and filename != "04_p6_activity_register.csv" and activity_id not in all_activity_ids:
                _append_issue(issues, filename, row_number, "activity_id", "Activity ID is not present in 04_p6_activity_register.csv.")

    for filename in ("05_p6_relationship_register.csv", "08_fragnet_relationship_register.csv"):
        for row_number, row in enumerate(rows_by_file[filename], start=2):
            version = _normalise(row.get("schedule_version", ""))
            for field in ("predecessor_activity_id", "successor_activity_id"):
                activity_id = _normalise(row.get(field, ""))
                if filename == "05_p6_relationship_register.csv" and activity_id and (version, activity_id) not in activities:
                    _append_issue(issues, filename, row_number, field, "Relationship activity is not present in the same P6 schedule version.")


def _validate_release_reconciliation(rows_by_file: dict[str, list[dict[str, str]]], issues: list[dict[str, str]]) -> None:
    release_rows = rows_by_file["14_controlled_release_register.csv"]
    if len(release_rows) > 1:
        _append_issue(issues, "14_controlled_release_register.csv", "all", "release_id", "Only one active controlled release row is permitted per pack.")
    if not release_rows:
        return
    release = release_rows[0]
    gross = _number(release.get("gross_included_event_movement_days", ""))
    adjustment = _number(release.get("concurrency_adjustment_days", ""))
    integrated = _number(release.get("integrated_eot_calendar_days", ""))
    if None not in {gross, adjustment, integrated} and abs((gross or 0) - (adjustment or 0) - (integrated or 0)) > 0.000001:
        _append_issue(issues, "14_controlled_release_register.csv", 2, "integrated_eot_calendar_days", "Gross movement less concurrency adjustment must equal integrated EOT days.")
    try:
        baseline = datetime.fromisoformat(release.get("baseline_project_finish", "")).date()
        impacted = datetime.fromisoformat(release.get("impacted_project_finish", "")).date()
        if integrated is not None and abs((impacted - baseline).days - integrated) > 0.000001:
            _append_issue(issues, "14_controlled_release_register.csv", 2, "integrated_eot_calendar_days", "Integrated EOT days must equal the submitted project-finish date movement.")
    except ValueError:
        pass

    included_movements = sum(
        _number(row.get("finish_movement_calendar_days", "")) or 0
        for row in rows_by_file["09_before_after_fragnet_comparison.csv"]
        if _normalise(row.get("inclusion_in_integrated_eot", "")) in {"yes", "included", "true"}
    )
    if gross is not None and rows_by_file["09_before_after_fragnet_comparison.csv"] and abs(included_movements - gross) > 0.000001:
        _append_issue(issues, "14_controlled_release_register.csv", 2, "gross_included_event_movement_days", "Gross included movement must equal the sum of included before/after matrix movements.")

    applied_adjustment = sum(
        _number(row.get("concurrency_adjustment_days", "")) or 0
        for row in rows_by_file["10_concurrency_entitlement_register.csv"]
        if _normalise(row.get("included_in_adjustment", "")) in {"yes", "included", "true"}
    )
    if adjustment is not None and rows_by_file["10_concurrency_entitlement_register.csv"] and abs(applied_adjustment - adjustment) > 0.000001:
        _append_issue(issues, "14_controlled_release_register.csv", 2, "concurrency_adjustment_days", "Concurrency adjustment must equal the sum of included concurrency-register adjustments.")

    open_items = [
        row for row in rows_by_file["15_reconciliation_register.csv"]
        if _normalise(row.get("status", "")) in OPEN_RECONCILIATION
    ]
    if _normalise(release.get("approval_status", "")) == "approved" and open_items:
        _append_issue(issues, "14_controlled_release_register.csv", 2, "approval_status", "Approved release cannot retain open reconciliation items.")


def validate_pack(
    input_dir: Path,
    *,
    template_mode: bool = False,
    expected_project_id: str | None = None,
    expected_project_key: str | None = None,
) -> dict[str, Any]:
    """Validate one pack without reading any other project's data.

    ``template_mode`` validates an empty template copy. A populated pack is
    structurally and arithmetically checked, but its returned readiness state
    is deliberately not an entitlement or an approved EOT determination.
    """
    issues: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []
    rows_by_file: dict[str, list[dict[str, str]]] = {}
    files: list[dict[str, Any]] = []
    for contract in CSV_CONTRACTS:
        path = input_dir / contract.filename
        record = {"file": contract.filename, "exists": path.is_file(), "rows": 0, "status": "missing"}
        files.append(record)
        if not path.is_file():
            _append_issue(issues, contract.filename, "header", "file", "Required contract file is missing.")
            rows_by_file[contract.filename] = []
            continue
        header, rows, read_error = _csv_rows(path)
        record["rows"] = len(rows)
        record["status"] = "ready" if header == list(contract.columns) else "schema_error"
        rows_by_file[contract.filename] = rows
        if read_error:
            _append_issue(issues, contract.filename, "header", "file", f"CSV could not be read: {read_error}")
            continue
        if header != list(contract.columns):
            _append_issue(issues, contract.filename, "header", "columns", "Header must exactly match the published contract, including order.")
            continue
        for row_number, row in enumerate(rows, start=2):
            for field in contract.required_fields:
                if not row.get(field, "").strip():
                    _append_issue(issues, contract.filename, row_number, field, "Required field is blank.")
            for field, value in row.items():
                if not value:
                    continue
                if field in DATE_FIELDS and not _is_iso_date(value):
                    _append_issue(issues, contract.filename, row_number, field, "Use ISO date/time format (YYYY-MM-DD or ISO 8601).")
                if field in NUMERIC_FIELDS and _number(value) is None:
                    _append_issue(issues, contract.filename, row_number, field, "Use a numeric value without units or commas.")
                if field == "relationship_type" and value.upper() not in RELATIONSHIPS:
                    _append_issue(issues, contract.filename, row_number, field, "Relationship type must be FS, SS, FF, or SF.")
                if field in {"inclusion_in_integrated_eot", "included_in_adjustment"} and _normalise(value) not in INCLUSION_VALUES:
                    _append_issue(issues, contract.filename, row_number, field, "Use Yes/No or Included/Excluded.")

    metadata_rows = rows_by_file.get("01_project_metadata.csv", [])
    metadata = metadata_rows[0] if len(metadata_rows) == 1 else {}
    if not template_mode and len(metadata_rows) != 1:
        _append_issue(issues, "01_project_metadata.csv", "all", "project_id", "A populated pack must contain exactly one project metadata row.")
    project_id = metadata.get("project_id", "")
    project_key = metadata.get("project_key", "")
    if expected_project_id and project_id and project_id != expected_project_id:
        _append_issue(issues, "01_project_metadata.csv", 2, "project_id", "Project ID does not match the expected selected project.")
    if expected_project_key and project_key and project_key != expected_project_key:
        _append_issue(issues, "01_project_metadata.csv", 2, "project_key", "Project key does not match the expected selected project.")

    if not template_mode and project_id:
        for filename, rows in rows_by_file.items():
            for row_number, row in enumerate(rows, start=2):
                if row.get("project_id", "") != project_id:
                    _append_issue(issues, filename, row_number, "project_id", "Row project_id must exactly match 01_project_metadata.csv.")
                if "project_key" in row and row.get("project_key", "") and row.get("project_key") != project_key:
                    _append_issue(issues, filename, row_number, "project_key", "Row project_key must exactly match 01_project_metadata.csv.")
        _validate_cross_references(rows_by_file, issues)
        _validate_release_reconciliation(rows_by_file, issues)

    populated = sum(1 for rows in rows_by_file.values() if rows)
    if template_mode:
        readiness = "TEMPLATE_READY" if not issues else "TEMPLATE_SCHEMA_ERROR"
    elif issues:
        readiness = "INPUT_VALIDATION_FAILED"
    elif populated < 10:
        readiness = "INPUT_INCOMPLETE"
        warnings.append({"file": "pack", "row": "all", "field": "coverage", "message": "The pack is structurally valid but does not yet cover enough controlled TIA areas for review."})
    else:
        readiness = "READY_FOR_NATIVE_P6_REVIEW"

    return {
        "pack_name": PACK_NAME,
        "schema_version": SCHEMA_VERSION,
        "input_dir": str(input_dir),
        "project_id": project_id or None,
        "project_key": project_key or None,
        "template_mode": template_mode,
        "readiness": readiness,
        "passed": not issues,
        "files": files,
        "issues": issues,
        "warnings": warnings,
        "control_note": "Validation does not calculate or approve a contractual EOT. Native P6/XER analysis, project evidence, reconciliation, and formal approval remain required.",
    }


def write_template_pack(destination: Path) -> list[Path]:
    """Write deterministic empty templates and human-readable contract files."""
    destination.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for contract in CSV_CONTRACTS:
        path = destination / contract.filename
        with path.open("w", encoding="utf-8", newline="") as stream:
            csv.writer(stream).writerow(contract.columns)
        written.append(path)

    manifest_path = destination / "UNIFIED_TIA_CSV_MANIFEST.json"
    manifest_path.write_text(json.dumps(pack_manifest(), indent=2) + "\n", encoding="utf-8")
    written.append(manifest_path)

    coverage_path = destination / "UNIFIED_TIA_OUTPUT_COVERAGE.csv"
    with coverage_path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(("controlled_output", "required_unified_csvs", "validation_gate", "authority"))
        writer.writerows((
            ("Source Integrity", "01,02,03,11,14", "Project identity, source register, XER pair lineage, evidence references, release record", "Project-local source files and release manifest"),
            ("Schedule and CPM", "03,04,05,07,08,09", "Native XER pairing, logic links, before/after CPM and float reconciliation", "Native Primavera P6/XER"),
            ("Events and Fragnets", "06,07,08,09,12", "Event, affected activity, fragnet links, evidence and matrix consistency", "Project-local event and fragnet evidence"),
            ("Concurrency and Entitlement", "06,09,10,11,15", "Overlap adjustment, notice, entitlement, evidence, unresolved reconciliation", "Contract and project evidence; formal decision required"),
            ("EOT Position", "09,10,14,15", "Gross less concurrency equals integrated days; date movement reconciliation", "Approved project-local submission and P6 verification"),
            ("Publication Artifacts", "14,16", "Artifact source project, release, fingerprint, review and publication status", "Generated project-specific report artifact manifest"),
        ))
    written.append(coverage_path)

    readme_path = destination / "README.md"
    readme_path.write_text(
        "# Universal Controlled TIA CSV Pack\n\n"
        f"Schema version: `{SCHEMA_VERSION}`\n\n"
        "This is an empty, project-neutral input contract for the controlled Time Impact Analysis workflow. "
        "It is designed to carry the same evidence gates and reconciliation logic as the governed The BIG TIA release, "
        "without carrying any The BIG data into another project.\n\n"
        "## Safe use\n\n"
        "1. Copy this entire folder into only the new project's `02-delay_analysis/unified_tia_csv` directory.\n"
        "2. Populate all rows with that project's own P6/XER exports, evidence, contract notices, fragnets, and approvals.\n"
        "3. Do not copy another project's activity IDs, XER pairs, EOT days, source hashes, evidence references, or report artifacts.\n"
        "4. Validate before review:\n\n"
        "```powershell\n"
        "python tools/validate_unified_tia_csv.py --input-dir <project>\\02-delay_analysis\\unified_tia_csv --expected-project-id <project_id> --expected-project-key <project_key>\n"
        "```\n\n"
        "A passing result means the CSV input is structurally complete enough for native P6 review; it does **not** calculate, approve, or establish a contractual EOT. "
        "The project's native P6/XER analysis, entitlement evidence, reconciliation closure, and formal approval remain the authority.\n\n"
        "See `UNIFIED_TIA_OUTPUT_COVERAGE.csv` for the input-to-output controls and `UNIFIED_TIA_CSV_MANIFEST.json` for the exact schema.\n",
        encoding="utf-8",
    )
    written.append(readme_path)
    return written
