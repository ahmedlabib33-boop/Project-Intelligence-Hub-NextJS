"""Validate the generated Next.js data against the project-scoped Streamlit source model.

The script reads each project folder independently. It never writes source CSV/XLSX
files and fails when a generated website record disagrees with the matching project
source totals.
"""

from __future__ import annotations

import argparse
import json
import math
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
        }
        for dataset, expected_count in expected_counts.items():
            if output.get("source_files", {}).get(dataset) != expected_count:
                errors.append(f"{project_key}: {dataset} source row count is not project-scoped")

        for metric in ("contract_value", "paid_amount", "bac", "pv", "ev", "ac", "risk_score", "delay_days", "claims_exposure"):
            if expected.get(metric) not in (None, 0) and not output.get("metric_sources", {}).get(metric, {}).get("source"):
                errors.append(f"{project_key}: {metric} is missing source traceability")

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
