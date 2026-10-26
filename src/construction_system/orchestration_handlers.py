"""Domain job handlers for the orchestration core engine (Schema 1).

Each handler is a thin wrapper around an existing, already-governed
computation -- it must never reimplement or relax that computation's rules
(e.g. controlled_tia's refusal to fabricate an EOT position). Importing this
module has the side effect of registering its handlers via
``orchestration.register_handler``.
"""

from __future__ import annotations

from typing import Any

from .orchestration import register_handler


@register_handler("tia_refresh")
def run_tia_refresh(payload: dict[str, Any]) -> dict[str, Any]:
    """Wraps ``controlled_tia.refresh_controlled_tia_run`` -- Delay Analysis /
    Time Impact Analysis -- so a refresh becomes a durable, retryable,
    audited job instead of a bare function call. The returned snapshot is
    unchanged; this handler adds no new schedule logic."""
    from .controlled_tia import refresh_controlled_tia_run

    project = payload.get("project")
    if not isinstance(project, dict):
        raise ValueError("tia_refresh payload requires a 'project' object.")
    return refresh_controlled_tia_run(project, approve=bool(payload.get("approve", False)))
