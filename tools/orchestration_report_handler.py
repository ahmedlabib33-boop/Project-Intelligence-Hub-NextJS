"""Registers the "report_generate" job type with the orchestration core
engine (Schema 1) -- the Output Report Engine's entry into the same queue
used by the Delay Analysis / TIA refresh job.

Importing this module has the side effect of registering the handler.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parent.parent
_SRC = _ROOT / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from construction_system.orchestration import register_handler  # noqa: E402

from project_report_artifacts import ensure_project_report_artifacts  # noqa: E402


@register_handler("report_generate")
def run_report_generate(payload: dict[str, Any]) -> dict[str, Any]:
    """Wraps ``ensure_project_report_artifacts`` so one project's HTML/PDF/
    PPTX report build becomes a durable, retryable, audited job. Output
    (files on disk, manifest contents) is unchanged from a direct call."""
    project = payload.get("project")
    output_dir = payload.get("output_dir")
    if not isinstance(project, dict) or not output_dir:
        raise ValueError("report_generate payload requires 'project' and 'output_dir'.")
    reports = ensure_project_report_artifacts(project, Path(output_dir), payload.get("public_slug"))
    return reports
