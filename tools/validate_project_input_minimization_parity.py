"""Verify that input minimization left public project results unchanged.

The baseline is intentionally generated before any move.  This validator
compares user-visible metrics, chart series, workspace rows, and established
report URLs.  It permits only physical source-lineage changes and the new
data-driven SAMCO-PCO report entry.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BEFORE = ROOT / ".validation" / "before-data"
DEFAULT_AFTER = ROOT / "website" / "public" / "data"
METRICS = (
    "contract_value", "paid_amount", "actual_progress", "planned_progress",
    "bac", "pv", "ev", "ac", "spi", "cpi", "delay_days", "status",
)


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _without_physical_lineage(value: Any) -> Any:
    if isinstance(value, list):
        return [_without_physical_lineage(item) for item in value]
    if isinstance(value, dict):
        return {
            key: _without_physical_lineage(item)
            for key, item in value.items()
            if key not in {"source_lineage", "validation", "source_path", "file_path", "path"}
        }
    return value


def _standard_report_urls(payload: dict[str, Any]) -> dict[str, dict[str, str]]:
    artifacts = payload.get("report_artifacts", {})
    if not isinstance(artifacts, dict):
        return {}
    return {
        key: {extension: str(value.get(extension) or "") for extension in ("html", "pdf", "pptx")}
        for key, value in artifacts.items()
        if key in {"executive_dashboard", "master_dashboard", "elite_svg_charts", "linked_executive_dashboard"}
        and isinstance(value, dict)
    }


def validate(before_root: Path, after_root: Path) -> list[str]:
    errors: list[str] = []
    before_projects = before_root / "projects"
    after_projects = after_root / "projects"
    for before_path in sorted(before_projects.glob("*.json")):
        after_path = after_projects / before_path.name
        if not after_path.exists():
            errors.append(f"Missing public project payload after minimization: {before_path.name}")
            continue
        before = read_json(before_path)
        after = read_json(after_path)
        key = before_path.stem
        for metric in METRICS:
            if before.get(metric) != after.get(metric):
                errors.append(f"{key}: metric changed: {metric}")
        if _without_physical_lineage(before.get("chart_payloads")) != _without_physical_lineage(after.get("chart_payloads")):
            errors.append(f"{key}: visible chart payload changed")
        before_workspace = before.get("workspace", {})
        after_workspace = after.get("workspace", {})
        if _without_physical_lineage(before_workspace) != _without_physical_lineage(after_workspace):
            errors.append(f"{key}: workspace table payload changed")
        if _standard_report_urls(before) != _standard_report_urls(after):
            errors.append(f"{key}: established Output Studio report URL changed")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare public project results before and after input minimization.")
    parser.add_argument("--before", type=Path, default=DEFAULT_BEFORE)
    parser.add_argument("--after", type=Path, default=DEFAULT_AFTER)
    args = parser.parse_args()
    errors = validate(args.before.resolve(), args.after.resolve())
    if errors:
        print("FAIL")
        print("\n".join(errors))
        return 1
    print("PASS: public metrics, chart payloads, workspace rows, and established report URLs are unchanged.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
