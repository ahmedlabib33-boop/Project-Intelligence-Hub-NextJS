"""Validate the generated Next.js data against the project-scoped Streamlit source model.

The script reads each project folder independently. It never writes source CSV/XLSX
files and fails when a generated website record disagrees with the matching project
source totals.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from generate_nextjs_website_data import (  # noqa: E402
    discover_projects,
    qualitative_risk_metrics,
    read_csv_rows,
    safe_float,
    safe_percent,
    sum_column,
    summed_delay_days,
)


DATA_ROOT = ROOT / "website" / "public" / "data" / "projects"
REPORT_PATH = ROOT / "12-logs" / "vercel_streamlit_pipeline_audit_latest.md"
PAGE_PATH = ROOT / "website" / "src" / "app" / "page.tsx"
STREAMLIT_DASHBOARD_PATH = ROOT.parent / "one drive data" / "OneDrive" / "Documents" / "Project Intelligence Hub" / "dashboard.py"

PUBLIC_METRICS = (
    "contract_value",
    "paid_amount",
    "spent_amount",
    "remaining_value",
    "planned_progress",
    "actual_progress",
    "bac",
    "pv",
    "ev",
    "ac",
    "spi",
    "cpi",
    "risk_score",
    "high_risk_count",
    "delay_days",
    "claims_exposure",
    "claimed_days",
    "activity_count",
    "milestone_count",
)

REQUIRED_PROJECT_TABS = (
    "Overview",
    "WBS",
    "Activities",
    "Milestones",
    "S-Curve",
    "EVM Analysis",
    "Analytics Intelligence",
    "Contracts",
    "Letters Intelligence",
    "Risks",
    "Contract & Claims Intelligence Center",
    "Technical Advisor",
    "Conference",
    "Output Studio",
)

INTERNAL_PROJECT_TAB = "Delay Analysis - Time Impact Analysis"

REQUIRED_WORKSPACE_TABLES = (
    "projects",
    "wbs",
    "activities",
    "milestones",
    "s_curve",
    "evm",
    "contracts",
    "payments",
    "risks",
    "delay_events",
)

REQUIRED_CHART_INPUTS = {
    "01-data/import_templates/planned_cash_flow.csv": "project_id",
    "02-delay_analysis/steel_delay_tia_templates/14-delay_event_classification.csv": "project_id",
    "02-delay_analysis/steel_delay_tia_templates/15-tia_recovery_scenario.csv": "project_id",
}

REQUIRED_SOURCE_CHART_IDS = {
    "contracts.planned_vs_actual_cash_flow",
    "delay.root_cause_pareto",
    "delay.type_distribution",
    "delay.tia_recovery_scenario",
}


def close_enough(actual: Any, expected: float | None) -> bool:
    if expected is None:
        return actual is None
    if actual is None:
        return False
    try:
        return math.isclose(float(actual), float(expected), rel_tol=1e-9, abs_tol=0.05)
    except (TypeError, ValueError):
        return False


def expected_source_metrics(data_dir: Path) -> dict[str, float | None]:
    rows = {
        "projects": read_csv_rows(data_dir / "projects.csv"),
        "payments": read_csv_rows(data_dir / "payments.csv"),
        "evm": read_csv_rows(data_dir / "evm.csv"),
        "risks": read_csv_rows(data_dir / "risks.csv"),
        "claims": read_csv_rows(data_dir / "claims.csv"),
        "delay_events": read_csv_rows(data_dir / "delay_events.csv"),
    }
    project_row = rows["projects"][0] if rows["projects"] else {}
    contract_value = safe_float(project_row.get("contract_value"))
    planned_progress = safe_percent(project_row.get("planned_progress_percent"))
    actual_progress = safe_percent(project_row.get("actual_progress_percent"))
    risk_score, high_risk_count, _ = qualitative_risk_metrics(rows["risks"])
    return {
        "contract_value": contract_value,
        "paid_amount": sum_column(rows["payments"], ["paid_amount", "paid amount", "paid", "payment_amount", "amount"]),
        "bac": sum_column(rows["evm"], ["bac", "budget_at_completion"]),
        "pv": sum_column(rows["evm"], ["pv", "planned_value", "planned value"]),
        "ev": sum_column(rows["evm"], ["ev", "earned_value", "earned value"]),
        "ac": sum_column(rows["evm"], ["ac", "actual_cost", "actual cost"]),
        "planned_progress": planned_progress,
        "actual_progress": actual_progress,
        "risk_score": risk_score,
        "high_risk_count": float(high_risk_count),
        "delay_days": summed_delay_days(rows["delay_events"]),
        "claims_exposure": sum_column(rows["claims"], ["claim_amount", "claimed_amount", "amount", "eot_exposure", "exposure"]),
        "claimed_days": sum_column(rows["claims"], ["claimed_days", "claim_days", "eot_days", "claimed duration"]),
    }


def validate_project_workspace_surface(
    project_key: str,
    output: dict[str, Any],
    project_path: Path,
    errors: list[str],
    checks: list[str],
) -> None:
    """Verify feature payloads are complete and remain inside one project boundary."""
    for relative_path, required_column in REQUIRED_CHART_INPUTS.items():
        input_path = project_path / relative_path
        if not input_path.exists():
            errors.append(f"{project_key}: project chart input template is missing: {relative_path}")
            continue
        header = input_path.read_text(encoding="utf-8-sig", errors="replace").splitlines()
        columns = {column.strip().casefold() for column in header[0].split(",")} if header else set()
        if required_column.casefold() not in columns:
            errors.append(f"{project_key}: project chart input is missing required {required_column}: {relative_path}")

    chart_payloads = output.get("chart_payloads")
    if not isinstance(chart_payloads, dict):
        errors.append(f"{project_key}: project-scoped chart payload is missing")
    else:
        if chart_payloads.get("project_id") != output.get("project_id") or chart_payloads.get("project_key") != output.get("project_key"):
            errors.append(f"{project_key}: project-scoped chart payload identity does not match selected project")
        charts = chart_payloads.get("charts")
        chart_ids = {str(item.get("id")) for item in charts if isinstance(item, dict)} if isinstance(charts, list) else set()
        if not REQUIRED_SOURCE_CHART_IDS.issubset(chart_ids):
            errors.append(f"{project_key}: source chart catalogue is missing required data-gated entries")
        elif len(chart_ids) != len(charts):
            errors.append(f"{project_key}: source chart catalogue contains duplicate chart IDs")
        elif any(
            chart.get("status") not in {"ready", "partial", "draft", "awaiting_data"}
            or not isinstance(chart.get("source_lineage"), dict)
            for chart in charts
            if isinstance(chart, dict)
        ):
            errors.append(f"{project_key}: source chart payload has an invalid status or missing lineage")
        else:
            checks.append(f"{project_key}: project-scoped source chart inputs and payload are isolated")

    features = output.get("features")
    if not isinstance(features, dict):
        errors.append(f"{project_key}: complete project workspace payload is missing")
        return

    overview = features.get("overview")
    tables = overview.get("workspace_tables") if isinstance(overview, dict) else None
    if not isinstance(tables, dict):
        errors.append(f"{project_key}: workspace source tables are missing")
    else:
        for table_name in REQUIRED_WORKSPACE_TABLES:
            table = tables.get(table_name)
            if not isinstance(table, dict):
                errors.append(f"{project_key}: workspace table '{table_name}' is missing")
                continue
            source_path = project_path / "01-data" / "import_templates" / f"{table_name}.csv"
            expected_rows = len(read_csv_rows(source_path))
            if int(table.get("row_count") or 0) != expected_rows:
                errors.append(f"{project_key}: workspace table '{table_name}' does not match selected-project source rows")

    letters = features.get("letters_intelligence")
    if not isinstance(letters, dict) or not isinstance(letters.get("workbook_tables"), dict):
        errors.append(f"{project_key}: Letters Intelligence workbook payload is missing")

    delay = features.get("delay_analysis")
    if not isinstance(delay, dict):
        errors.append(f"{project_key}: Delay TIA payload is missing")
    else:
        templates = delay.get("templates")
        full_templates = delay.get("template_tables")
        if not isinstance(templates, list) or not isinstance(full_templates, list):
            errors.append(f"{project_key}: Delay TIA template table payload is incomplete")
        elif len(templates) != len(full_templates):
            errors.append(f"{project_key}: Delay TIA template table count differs from template inventory")
        if not isinstance(delay.get("schedule_workspace_tables"), dict):
            errors.append(f"{project_key}: Delay TIA MEP and baseline schedule payload is missing")
        canonical = delay.get("canonical_analysis")
        if not isinstance(canonical, dict):
            errors.append(f"{project_key}: canonical TIA analysis payload is missing")
        elif canonical.get("status") == "ready":
            canonical_tables = canonical.get("tables")
            if not isinstance(canonical_tables, dict) or "relationship_logic_df" not in canonical_tables:
                errors.append(f"{project_key}: canonical TIA analysis did not publish relationship logic evidence")

    four_pipeline = features.get("four_pipeline")
    if not isinstance(four_pipeline, dict):
        errors.append(f"{project_key}: four-pipeline project assessment is missing")
    else:
        if four_pipeline.get("project_id") != output.get("project_id") or four_pipeline.get("project_key") != output.get("project_key"):
            errors.append(f"{project_key}: four-pipeline assessment identity is not project-isolated")
        if "project_folder_path" in four_pipeline:
            errors.append(f"{project_key}: public four-pipeline payload exposes a local folder path")
        if four_pipeline.get("assessment_profile") not in {"evidence_backed", "qualified", "readiness_only"}:
            errors.append(f"{project_key}: four-pipeline assessment has an invalid readiness profile")
        for source in four_pipeline.get("source_inventory", []):
            if not isinstance(source, dict) or source.get("project_id") != output.get("project_id"):
                errors.append(f"{project_key}: four-pipeline source lineage includes another project's record")
                break
        else:
            checks.append(f"{project_key}: four-pipeline assessment and source lineage are project-isolated")

    claims = features.get("contract_claims")
    if not isinstance(claims, dict):
        errors.append(f"{project_key}: Contract & Claims payload is missing")
    else:
        if not isinstance(claims.get("knowledge_base"), dict):
            errors.append(f"{project_key}: project-only Contract & Claims knowledge base payload is missing")
        if not isinstance(claims.get("clause_library_tables"), dict):
            errors.append(f"{project_key}: contract clause library workbook payload is missing")
        controls = claims.get("controlled_assessment")
        if not isinstance(controls, dict) or not isinstance(controls.get("controls"), dict):
            errors.append(f"{project_key}: controlled contract/evidence assessment is missing")
        else:
            project_controls = controls["controls"]
            if project_controls.get("project_id") != output.get("project_id") or project_controls.get("project_key") != output.get("project_key"):
                errors.append(f"{project_key}: controlled contract/evidence assessment is not project-isolated")
            else:
                records = list(project_controls.get("clause_controls") or []) + list(project_controls.get("evidence_ledger") or [])
                if any(isinstance(record, dict) and record.get("project_id") != output.get("project_id") for record in records):
                    errors.append(f"{project_key}: controlled contract/evidence assessment includes another project's record")
                else:
                    checks.append(f"{project_key}: contract clauses and evidence mappings are project-isolated")

    reports = output.get("reports")
    expected_reports = {"executive_dashboard", "master_dashboard", "elite_svg_charts", "linked_executive_dashboard"}
    if not isinstance(reports, dict) or not expected_reports.issubset(reports):
        errors.append(f"{project_key}: Output Studio report links are incomplete")
    artifacts = output.get("report_artifacts")
    if not isinstance(artifacts, dict) or not expected_reports.issubset(artifacts):
        errors.append(f"{project_key}: Output Studio artifact manifest is incomplete")
    else:
        for report_key in expected_reports:
            artifact = artifacts.get(report_key)
            if not isinstance(artifact, dict):
                errors.append(f"{project_key}: {report_key} artifact is invalid")
                continue
            for extension in ("html", "pdf", "pptx"):
                url = artifact.get(extension)
                if not isinstance(url, str) or not url.startswith("/generated/"):
                    errors.append(f"{project_key}: {report_key} {extension} download URL is missing")
                    continue
                target = ROOT / "website" / "public" / url.lstrip("/")
                if not target.exists() or target.stat().st_size == 0:
                    errors.append(f"{project_key}: {report_key} {extension} artifact is missing or empty")

    if not str(output.get("project_id") or "").strip() or not str(output.get("project_key") or "").strip():
        errors.append(f"{project_key}: project identity is missing from generated payload")

    if not any(error.startswith(f"{project_key}:") for error in errors):
        checks.append(f"{project_key}: all project workspace tabs have selected-project source payloads")


def validate_workspace_tab_catalog(errors: list[str], checks: list[str]) -> None:
    """Keep the Vercel workspace tab set aligned with the retained Streamlit controls."""
    if not PAGE_PATH.exists():
        errors.append("website project workspace page is missing")
        return
    page_source = PAGE_PATH.read_text(encoding="utf-8")
    tabs_start = page_source.find("const workspaceTabs")
    tabs_end = page_source.find("] as const;", tabs_start)
    tab_catalog = page_source[tabs_start:tabs_end] if tabs_start >= 0 and tabs_end > tabs_start else ""
    missing = [tab for tab in REQUIRED_PROJECT_TABS if f'"{tab}"' not in tab_catalog]
    if missing:
        errors.append(f"Next.js project workspace is missing tabs: {', '.join(missing)}")
    else:
        checks.append(f"Next.js project workspace exposes {len(REQUIRED_PROJECT_TABS)} visible project-control tabs")
    if (
        'const INTERNAL_TIA_SURFACE_ENABLED = false;' not in page_source
        or 'visibleWorkspaceTabs.map((tab)' not in page_source
        or INTERNAL_PROJECT_TAB not in tab_catalog
    ):
        errors.append("Next.js workspace does not preserve the full internal Delay Analysis - Time Impact Analysis control")
    else:
        checks.append("Delay Analysis - Time Impact Analysis remains internal and is not rendered as a public project tab")
    hidden_legacy = [tab for tab in ("Delays", "Time Impact") if f'"{tab}"' in tab_catalog]
    if hidden_legacy:
        errors.append(f"Next.js workspace still exposes legacy compatibility tabs: {', '.join(hidden_legacy)}")


def validate_streamlit_tia_catalog(errors: list[str], checks: list[str]) -> None:
    """Ensure legacy delay screens are consolidated rather than merely hidden."""
    if not STREAMLIT_DASHBOARD_PATH.exists():
        errors.append("canonical Streamlit dashboard.py is missing")
        return
    source = STREAMLIT_DASHBOARD_PATH.read_text(encoding="utf-8", errors="replace")
    catalog_match = re.search(
        r"PROJECT_HUB_SLIDE_NAMES\s*=\s*(\[[\s\S]*?\n\])",
        source,
    )
    catalog = catalog_match.group(1) if catalog_match else ""
    if not catalog:
        errors.append("Streamlit project slide catalog could not be located")
        return
    exposed_legacy = [label for label in ("Delays", "Time Impact") if f'"{label}"' in catalog]
    if exposed_legacy:
        errors.append(f"Streamlit project slide catalog still exposes legacy TIA tabs: {', '.join(exposed_legacy)}")
    elif '"Delay Analysis - Time Impact Analysis"' not in catalog:
        errors.append("Streamlit project slide catalog is missing consolidated Delay Analysis - Time Impact Analysis")
    else:
        checks.append("Streamlit consolidates legacy Delays and Time Impact under Delay Analysis - Time Impact Analysis")


def validate_advanced_analytics_output(
    project_key: str,
    output: dict[str, Any],
    expected_counts: dict[str, int],
    errors: list[str],
    checks: list[str],
) -> None:
    analytics = output.get("advanced_analytics")
    if not isinstance(analytics, dict):
        errors.append(f"{project_key}: advanced analytics payload is missing")
        return
    if analytics.get("scope") != "selected_project_only":
        errors.append(f"{project_key}: advanced analytics scope is not project-isolated")
    profile = analytics.get("data_profile", {})
    if profile.get("activity_records") != expected_counts["activities"]:
        errors.append(f"{project_key}: advanced analytics activity count does not match selected-project source")
    if profile.get("s_curve_periods") != expected_counts["s_curve"]:
        errors.append(f"{project_key}: advanced analytics S-curve count does not match selected-project source")
    anomalies = analytics.get("activity_anomalies", {})
    if anomalies.get("status") == "ready" and int(anomalies.get("flagged_count") or 0) > 10:
        errors.append(f"{project_key}: advanced analytics anomaly review queue exceeds 10 records")
    forecast = analytics.get("s_curve_forecast", {})
    if expected_counts["s_curve"] >= 6 and forecast.get("status") not in {"ready", "outside_horizon", "source_inconsistent", "insufficient_data"}:
        errors.append(f"{project_key}: advanced analytics forecast returned an unknown status")
    chart_url = analytics.get("s_curve_chart_url")
    if chart_url:
        expected_chart = ROOT / "website" / "public" / str(chart_url).lstrip("/")
        if not expected_chart.exists():
            errors.append(f"{project_key}: advanced analytics chart asset is missing")
    governance = analytics.get("model_governance", {})
    for model_name in ("xgboost", "pytorch", "tensorflow"):
        model = governance.get(model_name, {})
        if model.get("records_available") != profile.get("labelled_historical_outcome_records"):
            errors.append(f"{project_key}: {model_name} governance does not use selected-project history")
    if not any(error.startswith(f"{project_key}:") for error in errors):
        checks.append(f"{project_key}: advanced analytics is project-scoped, source-backed, and governed")


def fetch_public_json(public_url: str, relative_path: str) -> dict[str, Any]:
    """Read a cache-busted JSON artifact from the deployed Vercel site."""
    url = f"{public_url.rstrip('/')}/{relative_path.lstrip('/')}?{urlencode({'pipeline_check': datetime.now().timestamp()})}"
    request = Request(
        url,
        headers={
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "User-Agent": "Project-Intelligence-Hub-Pipeline-Validator/1.0",
        },
    )
    try:
        with urlopen(request, timeout=30) as response:  # nosec B310 - URL is an explicit CLI argument.
            return json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
        raise RuntimeError(f"{url}: {error}") from error


def fetch_public_page(public_url: str) -> None:
    request = Request(
        public_url.rstrip("/") + "/",
        headers={"Cache-Control": "no-cache", "User-Agent": "Project-Intelligence-Hub-Pipeline-Validator/1.0"},
    )
    try:
        with urlopen(request, timeout=30) as response:  # nosec B310 - URL is an explicit CLI argument.
            body = response.read(512).decode("utf-8", errors="replace")
            if not body.strip():
                raise RuntimeError("empty HTTP response")
    except (HTTPError, URLError, TimeoutError, RuntimeError) as error:
        raise RuntimeError(f"{public_url}: {error}") from error


def validate_public_delivery(
    public_url: str,
    local_portfolio: dict[str, Any] | None,
    local_projects: list[dict[str, Any]],
    checks: list[str],
    errors: list[str],
) -> None:
    """Verify public artifacts match the generated project-isolated data."""
    try:
        fetch_public_page(public_url)
        checks.append("public Vercel application is reachable")
        public_portfolio = fetch_public_json(public_url, "data/portfolio.json")
    except RuntimeError as error:
        errors.append(f"public Vercel application cannot be verified: {error}")
        return

    if local_portfolio is None:
        errors.append("public Vercel parity cannot run because local portfolio.json is missing")
        return

    local_keys = {str(item.get("project_key")) for item in local_portfolio.get("projects", [])}
    public_keys = {str(item.get("project_key")) for item in public_portfolio.get("projects", [])}
    if public_keys != local_keys:
        errors.append("public portfolio project list does not match local generated portfolio")
    else:
        checks.append("public portfolio project list matches local generated portfolio")

    for metric in ("contract_value", "paid_amount", "spent_amount", "remaining_value", "claims_exposure"):
        if not close_enough(public_portfolio.get("totals", {}).get(metric), local_portfolio.get("totals", {}).get(metric)):
            errors.append(f"public portfolio {metric} does not match local generated portfolio")
        else:
            checks.append(f"public portfolio {metric} matches local generated portfolio")

    for local_project in local_projects:
        project_key = str(local_project.get("project_key"))
        try:
            public_project = fetch_public_json(public_url, f"data/projects/{project_key}.json")
        except RuntimeError as error:
            errors.append(f"{project_key}: public project JSON cannot be verified: {error}")
            continue

        if public_project.get("project_id") != local_project.get("project_id"):
            errors.append(f"{project_key}: public project_id does not match local generated project")
            continue
        for metric in PUBLIC_METRICS:
            local_value = local_project.get(metric)
            public_value = public_project.get(metric)
            if isinstance(local_value, (int, float)) or isinstance(public_value, (int, float)):
                if not close_enough(public_value, local_value):
                    errors.append(f"{project_key}: public {metric} does not match local generated project")
            elif public_value != local_value:
                errors.append(f"{project_key}: public {metric} does not match local generated project")

        local_sources = local_project.get("metric_sources", {})
        public_sources = public_project.get("metric_sources", {})
        if public_sources != local_sources:
            errors.append(f"{project_key}: public metric source traceability does not match local generated project")
        else:
            checks.append(f"{project_key}: public project data and traceability match local generation")
        if public_project.get("advanced_analytics") != local_project.get("advanced_analytics"):
            errors.append(f"{project_key}: public advanced analytics does not match the selected-project local result")
        else:
            checks.append(f"{project_key}: public advanced analytics matches the selected-project local result")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate Streamlit project source data against generated and deployed Next.js artifacts.")
    parser.add_argument(
        "--public-url",
        help="Optional deployed Vercel base URL. When provided, public JSON must match local generated JSON.",
    )
    args = parser.parse_args(argv)
    errors: list[str] = []
    checks: list[str] = []
    project_keys: set[str] = set()
    generated_projects: list[dict[str, Any]] = []
    portfolio: dict[str, Any] | None = None

    validate_workspace_tab_catalog(errors, checks)
    validate_streamlit_tia_catalog(errors, checks)

    for project in discover_projects():
        project_key = str(project["project_key"])
        if project_key in project_keys:
            errors.append(f"{project_key}: duplicate generated project key")
            continue
        project_keys.add(project_key)
        output_path = DATA_ROOT / f"{project_key}.json"
        if not output_path.exists():
            errors.append(f"{project_key}: generated project JSON is missing")
            continue
        output = json.loads(output_path.read_text(encoding="utf-8"))
        generated_projects.append(output)
        expected = expected_source_metrics(Path(project["path"]) / "01-data" / "import_templates")

        if output.get("project_id") != project["project_id"]:
            errors.append(f"{project_key}: project_id does not match the discovered project manifest")
        else:
            checks.append(f"{project_key}: project identity isolated")

        for metric, expected_value in expected.items():
            actual = output.get(metric)
            if expected_value is None:
                continue
            if not close_enough(actual, expected_value):
                errors.append(f"{project_key}: {metric} generated={actual!r}, source={expected_value!r}")
            else:
                checks.append(f"{project_key}: {metric} matches source")

        expected_counts = {
            "activities": len(read_csv_rows(Path(project["path"]) / "01-data" / "import_templates" / "activities.csv")),
            "milestones": len(read_csv_rows(Path(project["path"]) / "01-data" / "import_templates" / "milestones.csv")),
            "risks": len(read_csv_rows(Path(project["path"]) / "01-data" / "import_templates" / "risks.csv")),
            "claims": len(read_csv_rows(Path(project["path"]) / "01-data" / "import_templates" / "claims.csv")),
            "delay_events": len(read_csv_rows(Path(project["path"]) / "01-data" / "import_templates" / "delay_events.csv")),
            "s_curve": len(read_csv_rows(Path(project["path"]) / "01-data" / "import_templates" / "s_curve.csv")),
        }
        for dataset, expected_count in expected_counts.items():
            if output.get("source_files", {}).get(dataset) != expected_count:
                errors.append(f"{project_key}: {dataset} source row count is not project-scoped")

        for metric in ("contract_value", "paid_amount", "bac", "pv", "ev", "ac", "risk_score", "delay_days", "claims_exposure"):
            if expected.get(metric) not in (None, 0) and not output.get("metric_sources", {}).get(metric, {}).get("source"):
                errors.append(f"{project_key}: {metric} is missing source traceability")
        validate_project_workspace_surface(project_key, output, Path(project["path"]), errors, checks)
        validate_advanced_analytics_output(project_key, output, expected_counts, errors, checks)

    portfolio_path = DATA_ROOT.parent / "portfolio.json"
    if not portfolio_path.exists():
        errors.append("portfolio.json is missing")
    else:
        portfolio = json.loads(portfolio_path.read_text(encoding="utf-8"))
        totals = portfolio.get("totals", {})
        portfolio_keys = {str(item.get("project_key")) for item in portfolio.get("projects", [])}
        if portfolio_keys != project_keys:
            errors.append("portfolio project list does not match discovered project folders")
        else:
            checks.append("portfolio project list matches discovered project folders")
        for metric in ("contract_value", "paid_amount", "spent_amount", "remaining_value", "claims_exposure"):
            expected_total = sum(float(item.get(metric) or 0) for item in generated_projects)
            if not close_enough(totals.get(metric), expected_total):
                errors.append(f"portfolio {metric} generated={totals.get(metric)!r}, projects total={expected_total!r}")
            else:
                checks.append(f"portfolio {metric} matches isolated project totals")
        if any("features" in item for item in portfolio.get("projects", [])):
            errors.append("portfolio.json contains full project feature payloads instead of lightweight summaries")
        else:
            checks.append("portfolio is lightweight; full tab data is loaded only after project selection")

    if args.public_url:
        validate_public_delivery(args.public_url, portfolio, generated_projects, checks, errors)

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    report = [
        "# Vercel / Streamlit Pipeline Audit",
        "",
        f"Generated: {datetime.now().isoformat(timespec='seconds')}",
        f"Projects checked: {len(project_keys)}",
        f"Public deployment checked: {args.public_url or 'No'}",
        f"Status: {'PASS' if not errors else 'FAIL'}",
        "",
        "## Checks",
        *[f"- PASS: {item}" for item in checks],
        "",
        "## Failures",
        *([f"- FAIL: {item}" for item in errors] if errors else ["- None"]),
    ]
    REPORT_PATH.write_text("\n".join(report) + "\n", encoding="utf-8")
    for item in errors:
        print(f"FAIL {item}")
    print(f"{'PASS' if not errors else 'FAIL'}: {len(checks)} checks; {len(errors)} failures.")
    print(f"Report: {REPORT_PATH}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
