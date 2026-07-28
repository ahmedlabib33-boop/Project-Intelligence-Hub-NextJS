from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import sqlite3
from dataclasses import asdict, dataclass
from datetime import datetime
from hashlib import sha256
from pathlib import Path
from typing import Any, Iterable


BOUNDS = {
    "spi": (0.10, 2.00),
    "cpi": (0.20, 3.00),
    "progress": (0.0, 1.0),
}

DEFAULT_BLOCK_FIELDS = {
    "contract_value_zero",
    "spi_out_of_range",
    "cpi_out_of_range",
    "cpi_zero_with_ev",
    "near_zero_ac",
    "letters_duplicate_reference",
}

SUSPICIOUS_FULL_PROGRESS_STATUSES = {"delayed", "critical", "watchlist"}
REF_PATTERN = re.compile(r"[A-Z]{2,}(?:-[A-Z0-9]+)+-LET-\d+", re.IGNORECASE)
DIRECTION_PATTERN = re.compile(r"from\s+(.+?)\s+to\s+(.+)", re.IGNORECASE)


@dataclass
class Issue:
    severity: str
    effective_severity: str
    scope: str
    project_id: str
    project_key: str
    project_display_name: str
    field: str
    message: str


class GuardrailResult:
    def __init__(self, block_mode: bool = False) -> None:
        self.block_mode = block_mode
        self.issues: list[Issue] = []

    def add(
        self,
        severity: str,
        scope: str,
        field_name: str,
        message: str,
        *,
        project: dict[str, Any] | None = None,
        project_id: str = "",
        project_key: str = "",
        project_display_name: str = "",
    ) -> None:
        raw_severity = severity.upper()
        effective = raw_severity if self.block_mode else "WARN"
        self.issues.append(
            Issue(
                severity=raw_severity,
                effective_severity=effective,
                scope=scope,
                project_id=str((project or {}).get("project_id") or project_id or scope or ""),
                project_key=str((project or {}).get("project_key") or project_key or ""),
                project_display_name=str(
                    (project or {}).get("project_display_name")
                    or project_display_name
                    or (project or {}).get("project_folder_name")
                    or scope
                    or ""
                ),
                field=field_name,
                message=message,
            )
        )

    @property
    def has_blocking(self) -> bool:
        return any(issue.effective_severity == "BLOCK" for issue in self.issues)

    @property
    def block_count(self) -> int:
        return sum(1 for issue in self.issues if issue.effective_severity == "BLOCK")

    @property
    def warn_count(self) -> int:
        return sum(1 for issue in self.issues if issue.effective_severity == "WARN")


def safe_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    try:
        number = float(str(value).replace(",", "").replace("%", "").replace("EGP", "").strip())
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return number


def load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        return {}


def issue_severity(field_name: str, default: str = "WARN") -> str:
    return "BLOCK" if field_name in DEFAULT_BLOCK_FIELDS else default


def validate_metric_bounds(project: dict[str, Any], result: GuardrailResult) -> None:
    display_name = str(project.get("project_display_name") or project.get("project_id") or "Unknown project")
    status = str(project.get("status") or "").strip().lower()

    contract_value = safe_float(project.get("contract_value"))
    if contract_value is None:
        result.add("WARN", display_name, "contract_value_missing", "Contract value is missing from generated project JSON.", project=project)
    elif status in {"active", "delayed", "on track", "watchlist", "critical"} and contract_value <= 0:
        result.add(
            issue_severity("contract_value_zero"),
            display_name,
            "contract_value_zero",
            "Contract value is zero or negative while the project is active; verify contract/source cost files.",
            project=project,
        )

    for key in ("actual_progress", "planned_progress"):
        value = safe_float(project.get(key))
        if value is None:
            result.add("WARN", display_name, f"{key}_missing", f"{key} is missing; progress confidence is reduced.", project=project)
            continue
        lo, hi = BOUNDS["progress"]
        if not (lo <= value <= hi):
            result.add("BLOCK", display_name, f"{key}_out_of_range", f"{key}={value} is outside the 0.00 to 1.00 range.", project=project)

    actual_progress = safe_float(project.get("actual_progress"))
    if actual_progress == 1.0 and status in SUSPICIOUS_FULL_PROGRESS_STATUSES:
        result.add(
            "WARN",
            display_name,
            "suspicious_full_progress",
            "Actual progress is exactly 100% while status indicates delay/watchlist; verify source progress mapping.",
            project=project,
        )

    for metric_key in ("spi", "cpi"):
        value = safe_float(project.get(metric_key))
        if value is None:
            result.add("WARN", display_name, f"{metric_key}_missing", f"{metric_key.upper()} is missing.", project=project)
            continue
        lo, hi = BOUNDS[metric_key]
        field_name = f"{metric_key}_out_of_range"
        if not (lo <= value <= hi):
            result.add(
                issue_severity(field_name),
                display_name,
                field_name,
                f"{metric_key.upper()}={value:.2f} is outside plausible range [{lo:.2f}, {hi:.2f}]. Check EV, PV and AC source mapping.",
                project=project,
            )

    ev = safe_float(project.get("ev"))
    ac = safe_float(project.get("ac"))
    pv = safe_float(project.get("pv"))
    cpi = safe_float(project.get("cpi"))
    spi = safe_float(project.get("spi"))

    if ev and (ac is None or ac <= 0):
        result.add("BLOCK", display_name, "actual_cost_missing", "EV exists but AC is missing/zero; CPI cannot be trusted.", project=project)
    elif ev and ac is not None and ac < max(ev * 0.01, 1):
        result.add("BLOCK", display_name, "near_zero_ac", "AC is near-zero compared with EV; inflated CPI risk.", project=project)

    if ev and (pv is None or pv <= 0):
        result.add("BLOCK", display_name, "planned_value_missing", "EV exists but PV is missing/zero; SPI cannot be trusted.", project=project)

    if ev and cpi == 0:
        result.add("BLOCK", display_name, "cpi_zero_with_ev", "CPI is zero while EV exists; verify actual cost and EVM calculation.", project=project)

    if ev and spi == 0:
        result.add("BLOCK", display_name, "spi_zero_with_ev", "SPI is zero while EV exists; verify planned value and EVM calculation.", project=project)


def average(values: Iterable[float | None]) -> float | None:
    valid = [value for value in values if value is not None and math.isfinite(value)]
    if not valid:
        return None
    return sum(valid) / len(valid)


def check_aggregation_consistency(portfolio: dict[str, Any], projects: list[dict[str, Any]], result: GuardrailResult, tolerance: float = 0.05) -> None:
    totals = portfolio.get("totals") or {}
    checks = (
        ("actual_progress", "average_progress"),
        ("spi", "average_spi"),
        ("cpi", "average_cpi"),
    )
    for project_key, totals_key in checks:
        computed = average([safe_float(project.get(project_key)) for project in projects])
        claimed = safe_float(totals.get(totals_key))
        if computed is None or claimed is None:
            continue
        if abs(computed - claimed) / max(abs(computed), 1e-9) > tolerance:
            result.add(
                "WARN",
                "portfolio",
                totals_key,
                f"Portfolio {totals_key}={claimed:.2f} differs from simple project average {computed:.2f}. Confirm weighting method.",
                project_id="portfolio",
                project_key="portfolio",
                project_display_name="Portfolio",
            )


def infer_known_parties(projects_root: Path) -> set[str]:
    parties = {"SAMCO"}
    for folder in projects_root.rglob("*"):
        if not folder.is_dir():
            continue
        match = DIRECTION_PATTERN.search(folder.name)
        if not match:
            continue
        for value in match.groups():
            token = re.sub(r"[^A-Za-z0-9 ]", "", value).strip()
            if token:
                parties.add(token.upper())
    return parties


def closest_party(token: str, known_parties: set[str]) -> str | None:
    cleaned = re.sub(r"[^A-Za-z0-9]", "", token).upper()
    if not cleaned:
        return None

    def edit_distance(a: str, b: str) -> int:
        previous = list(range(len(b) + 1))
        for i, ca in enumerate(a, 1):
            current = [i]
            for j, cb in enumerate(b, 1):
                current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
            previous = current
        return previous[-1]

    best, distance = None, 3
    for party in known_parties:
        compact = re.sub(r"[^A-Za-z0-9]", "", party).upper()
        current = edit_distance(cleaned, compact)
        if current < distance:
            best, distance = party, current
    return best


def check_letters_intelligence(projects_root: Path, result: GuardrailResult, projects_by_folder: dict[str, dict[str, Any]]) -> None:
    if not projects_root.exists():
        result.add("WARN", "letters", "projects_root_missing", f"{projects_root} not found.", project_id="portfolio", project_key="portfolio")
        return
    known_parties = infer_known_parties(projects_root)
    for inbox in projects_root.glob("*/*/07-letters_intelligence/inbox"):
        project_dir = inbox.parent.parent
        project = projects_by_folder.get(project_dir.name, {})
        display = str(project.get("project_display_name") or project_dir.name)
        ref_to_folders: dict[str, set[str]] = {}
        for child in inbox.iterdir():
            if not child.is_dir():
                continue
            match = DIRECTION_PATTERN.search(child.name)
            if not match:
                result.add("WARN", display, "letters_folder_name", f"Inbox folder '{child.name}' does not match 'From X to Y'.", project=project)
            else:
                for raw_party in match.groups():
                    corrected = closest_party(raw_party, known_parties)
                    normalized = re.sub(r"[^A-Za-z0-9]", "", raw_party).upper()
                    if corrected and normalized and corrected.replace(" ", "") != normalized and len(normalized) >= 4:
                        result.add("WARN", display, "letters_party_name", f"'{raw_party.strip()}' may be a typo of '{corrected}'.", project=project)
            for file_path in child.rglob("*"):
                if not file_path.is_file():
                    continue
                for reference in REF_PATTERN.findall(file_path.name):
                    ref_to_folders.setdefault(reference.upper(), set()).add(child.name)
        for reference, folders in ref_to_folders.items():
            if len(folders) > 1:
                result.add(
                    "BLOCK",
                    display,
                    "letters_duplicate_reference",
                    f"Letter reference {reference} appears in multiple folders: {sorted(folders)}.",
                    project=project,
                )


def file_hash(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def backup_and_snapshot(paths: list[Path], backup_dir: Path, note: str) -> str | None:
    existing = [path for path in paths if path.exists() and path.is_file()]
    if not existing:
        return None
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    snapshot_dir = backup_dir / timestamp
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    manifest = {"timestamp": timestamp, "note": note, "files": []}
    for path in existing:
        target = snapshot_dir / path.name
        shutil.copy2(path, target)
        manifest["files"].append({"source": str(path), "sha256": file_hash(path)})
    (snapshot_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    with (backup_dir / "CHANGELOG.md").open("a", encoding="utf-8") as handle:
        handle.write(f"- {timestamp} - {note} - {len(existing)} file(s) snapshotted\n")
    return str(snapshot_dir)


def init_action_db(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS actions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL,
                project_key TEXT,
                project_display_name TEXT,
                action_text TEXT NOT NULL,
                owner TEXT,
                status TEXT DEFAULT 'Open',
                severity TEXT,
                due_date TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )


def log_blocking_actions(db_path: Path, issues: list[Issue]) -> None:
    init_action_db(db_path)
    now = datetime.now().isoformat(timespec="seconds")
    with sqlite3.connect(db_path) as conn:
        for issue in issues:
            if issue.severity != "BLOCK":
                continue
            action_text = f"[{issue.field}] {issue.message}"
            existing = conn.execute(
                """
                SELECT id FROM actions
                WHERE project_id = ?
                  AND project_key = ?
                  AND action_text = ?
                  AND status = 'Open'
                LIMIT 1
                """,
                (issue.project_id or "portfolio", issue.project_key, action_text),
            ).fetchone()
            if existing:
                conn.execute("UPDATE actions SET severity = ?, updated_at = ? WHERE id = ?", (issue.effective_severity, now, existing[0]))
                continue
            conn.execute(
                """
                INSERT INTO actions
                    (project_id, project_key, project_display_name, action_text, owner, status, severity, due_date, created_at, updated_at)
                VALUES (?, ?, ?, ?, '', 'Open', ?, '', ?, ?)
                """,
                (
                    issue.project_id or "portfolio",
                    issue.project_key,
                    issue.project_display_name,
                    action_text,
                    issue.effective_severity,
                    now,
                    now,
                ),
            )


def write_report(result: GuardrailResult, report_path: Path) -> None:
    report_path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        f"# Guardrail Report - {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        "",
        f"Mode: {'BLOCK enabled' if result.block_mode else 'WARN only'}",
        f"Effective BLOCK issues: {result.block_count}",
        f"Effective WARN issues: {result.warn_count}",
        "",
        "## Issues",
    ]
    if not result.issues:
        lines.append("_No guardrail issues found._")
    for issue in result.issues:
        lines.append(
            f"- **{issue.effective_severity}** [{issue.project_display_name or issue.scope}] "
            f"`{issue.field}` - {issue.message}"
        )
    report_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def summarize(result: GuardrailResult, report_path: Path, snapshot_dir: str | None) -> dict[str, Any]:
    blocks = [issue for issue in result.issues if issue.effective_severity == "BLOCK"]
    warnings = [issue for issue in result.issues if issue.effective_severity == "WARN"]
    status = "Blocked" if blocks else ("Warnings" if warnings else "Passed")
    top_issues = result.issues[:8]
    return {
        "status": status,
        "mode": "BLOCK" if result.block_mode else "WARN",
        "ok": not blocks,
        "block_count": len(blocks),
        "warn_count": len(warnings),
        "issue_count": len(result.issues),
        "report_path": str(report_path).replace("\\", "/"),
        "snapshot_dir": str(snapshot_dir).replace("\\", "/") if snapshot_dir else None,
        "last_checked": datetime.now().isoformat(timespec="seconds"),
        "top_issues": [asdict(issue) for issue in top_issues],
    }


def run_guardrails(
    portfolio_json_path: str | Path,
    projects_json_dir: str | Path,
    projects_root: str | Path = "projects",
    backup_dir: str | Path = "12-logs/_guardrail_backups",
    action_db_path: str | Path = "12-logs/actions.db",
    report_path: str | Path = "12-logs/guardrail_report_latest.md",
    block_on_issues: bool = False,
) -> dict[str, Any]:
    portfolio_path = Path(portfolio_json_path)
    project_json_dir = Path(projects_json_dir)
    root = Path(projects_root)
    result = GuardrailResult(block_mode=block_on_issues)

    projects: list[dict[str, Any]] = []
    if project_json_dir.exists():
        for path in sorted(project_json_dir.glob("*.json")):
            project = load_json(path)
            if project:
                projects.append(project)
                validate_metric_bounds(project, result)
    else:
        result.add("WARN", "pipeline", "projects_json_dir_missing", f"{project_json_dir} not found.", project_id="portfolio", project_key="portfolio")

    portfolio = load_json(portfolio_path) if portfolio_path.exists() else {}
    if portfolio:
        check_aggregation_consistency(portfolio, projects, result)
    else:
        result.add("WARN", "pipeline", "portfolio_json_missing", f"{portfolio_path} not found.", project_id="portfolio", project_key="portfolio")

    projects_by_folder = {str(project.get("project_folder_name") or ""): project for project in projects}
    check_letters_intelligence(root, result, projects_by_folder)

    snapshot_files = [portfolio_path] + sorted(project_json_dir.glob("*.json")) if project_json_dir.exists() else [portfolio_path]
    snapshot_dir = backup_and_snapshot(snapshot_files, Path(backup_dir), "pre-publish guardrail snapshot")
    log_blocking_actions(Path(action_db_path), result.issues)
    write_report(result, Path(report_path))
    return summarize(result, Path(report_path), snapshot_dir)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Project Intelligence Hub data guardrails.")
    parser.add_argument("--portfolio-json", default="website/public/data/portfolio.json")
    parser.add_argument("--projects-json-dir", default="website/public/data/projects")
    parser.add_argument("--projects-root", default="projects")
    parser.add_argument("--backup-dir", default="12-logs/_guardrail_backups")
    parser.add_argument("--action-db", default="12-logs/actions.db")
    parser.add_argument("--report", default="12-logs/guardrail_report_latest.md")
    parser.add_argument("--block-on-issues", action="store_true")
    args = parser.parse_args()
    summary = run_guardrails(
        portfolio_json_path=args.portfolio_json,
        projects_json_dir=args.projects_json_dir,
        projects_root=args.projects_root,
        backup_dir=args.backup_dir,
        action_db_path=args.action_db,
        report_path=args.report,
        block_on_issues=args.block_on_issues,
    )
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    return 1 if args.block_on_issues and not summary["ok"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
