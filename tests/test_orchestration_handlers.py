from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "tools"))

from construction_system import orchestration as orch  # noqa: E402
from construction_system import orchestration_handlers  # noqa: E402,F401 (registers tia_refresh)
from construction_system import orchestration_llm_worker  # noqa: E402,F401 (registers llm_task)
from construction_system.groq_service import GroqResult  # noqa: E402


@pytest.fixture()
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "orchestration_handlers_test.db"


def test_tia_refresh_handler_rejects_non_dict_project(db_path: Path) -> None:
    with pytest.raises(ValueError, match="'project' object"):
        orchestration_handlers.run_tia_refresh({"project": "not-a-dict"})


def test_tia_refresh_handler_wraps_refresh_controlled_tia_run() -> None:
    fake_snapshot = {"status": "SETUP_REQUIRED", "project_id": "p1"}
    with patch("construction_system.controlled_tia.refresh_controlled_tia_run", return_value=fake_snapshot) as mocked:
        result = orchestration_handlers.run_tia_refresh({"project": {"project_id": "p1"}, "approve": True})
    mocked.assert_called_once_with({"project_id": "p1"}, approve=True)
    assert result == fake_snapshot


def test_tia_refresh_runs_end_to_end_through_the_queue(db_path: Path) -> None:
    fake_snapshot = {"status": "READY_AND_CALCULATED", "project_id": "p1", "run_id": "abc123"}
    with patch("construction_system.controlled_tia.refresh_controlled_tia_run", return_value=fake_snapshot):
        job_id = orch.enqueue_job("tia_refresh", {"project": {"project_id": "p1"}}, db_path=db_path)
        [finished] = orch.drain_queue(job_types=["tia_refresh"], db_path=db_path)

    assert finished.id == job_id
    assert finished.status == orch.STATUS_DONE
    assert finished.result == fake_snapshot


def test_llm_task_handler_requires_prompts() -> None:
    with pytest.raises(ValueError, match="system_prompt"):
        orchestration_llm_worker.run_llm_task({"user_prompt": "hi"})


def test_llm_task_handler_calls_groq_and_returns_answer() -> None:
    success = GroqResult(answer="hello", provider="groq", model="test-model", status="success", latency_ms=12)
    with patch("construction_system.orchestration_llm_worker.ask_groq", return_value=success) as mocked:
        result = orchestration_llm_worker.run_llm_task(
            {"system_prompt": "system", "user_prompt": "user", "max_tokens": 100}
        )
    mocked.assert_called_once()
    assert result == {"provider": "groq", "model": "test-model", "answer": "hello", "latency_ms": 12}


def test_llm_task_handler_raises_on_groq_error() -> None:
    failure = GroqResult(answer="AI service temporarily unavailable. Please retry.", status="error", error="boom")
    with patch("construction_system.orchestration_llm_worker.ask_groq", return_value=failure):
        with pytest.raises(RuntimeError, match="boom"):
            orchestration_llm_worker.run_llm_task({"system_prompt": "s", "user_prompt": "u"})


def test_report_generate_handler_wraps_ensure_project_report_artifacts(tmp_path: Path) -> None:
    import orchestration_report_handler  # noqa: F401 (registers report_generate as a side effect)

    fake_reports = {"executive_dashboard": {"html": "/generated/p1/exec.html"}}
    with patch("orchestration_report_handler.ensure_project_report_artifacts", return_value=fake_reports) as mocked:
        result = orchestration_report_handler.run_report_generate(
            {"project": {"project_id": "p1"}, "output_dir": str(tmp_path), "public_slug": "p1"}
        )
    mocked.assert_called_once()
    assert result == fake_reports


def test_report_generate_handler_requires_project_and_output_dir() -> None:
    import orchestration_report_handler  # noqa: F401

    with pytest.raises(ValueError, match="output_dir"):
        orchestration_report_handler.run_report_generate({"project": {"id": "p1"}})


def test_generator_tia_wrapper_matches_direct_engine_call_for_real_project() -> None:
    """No mocks: the orchestration-backed wrapper in
    generate_nextjs_website_data.py must return exactly what a direct call
    to controlled_tia.refresh_controlled_tia_run returns for the same real
    project -- the job queue must be a transparent pass-through, never a
    reinterpretation of the TIA engine's result."""
    import generate_nextjs_website_data as generator
    from construction_system.controlled_tia import refresh_controlled_tia_run

    the_big = {
        "project_id": "The Big -P.01-UP-20-April-26",
        "project_key": "the-big-p-01-up-20-april-26",
        "project_dir": str(ROOT / "projects" / "Buildings" / "The BIG - PH01"),
    }
    if not Path(the_big["project_dir"]).exists():
        pytest.skip("The BIG project fixture is not available in this environment.")

    direct = refresh_controlled_tia_run(the_big)
    via_wrapper = generator.build_controlled_tia_snapshot(the_big)
    assert via_wrapper == direct
