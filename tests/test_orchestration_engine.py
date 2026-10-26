from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from construction_system import orchestration as orch  # noqa: E402


@pytest.fixture()
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "orchestration_test.db"


@pytest.fixture(autouse=True)
def _reset_handlers():
    """Handlers are a module-level registry; keep tests isolated from each
    other and from whatever the real app modules register on import."""
    saved = dict(orch._HANDLERS)
    orch._HANDLERS.clear()
    yield
    orch._HANDLERS.clear()
    orch._HANDLERS.update(saved)


def test_enqueue_creates_queued_job_with_audit_event(db_path: Path) -> None:
    job_id = orch.enqueue_job("demo_task", {"n": 1}, db_path=db_path)
    job = orch.get_job(job_id, db_path=db_path)
    assert job is not None
    assert job.status == orch.STATUS_QUEUED
    assert job.payload == {"n": 1}
    assert job.attempts == 0

    events = orch.job_events(job_id, db_path=db_path)
    assert [event["event"] for event in events] == ["ENQUEUED"]


def test_claim_next_job_returns_none_when_empty(db_path: Path) -> None:
    assert orch.claim_next_job(db_path=db_path) is None


def test_claim_next_job_is_fifo_and_marks_running(db_path: Path) -> None:
    first = orch.enqueue_job("demo_task", {"order": 1}, db_path=db_path)
    orch.enqueue_job("demo_task", {"order": 2}, db_path=db_path)

    claimed = orch.claim_next_job(db_path=db_path)
    assert claimed is not None
    assert claimed.id == first
    assert claimed.status == orch.STATUS_RUNNING
    assert claimed.attempts == 1


def test_claim_next_job_filters_by_job_type(db_path: Path) -> None:
    orch.enqueue_job("type_a", {}, db_path=db_path)
    wanted = orch.enqueue_job("type_b", {}, db_path=db_path)

    claimed = orch.claim_next_job(["type_b"], db_path=db_path)
    assert claimed is not None
    assert claimed.id == wanted


def test_claim_next_job_never_double_claims_same_row(db_path: Path) -> None:
    orch.enqueue_job("demo_task", {}, db_path=db_path)
    first = orch.claim_next_job(db_path=db_path)
    second = orch.claim_next_job(db_path=db_path)
    assert first is not None
    assert second is None


def test_complete_job_stores_result_and_audit_event(db_path: Path) -> None:
    job_id = orch.enqueue_job("demo_task", {}, db_path=db_path)
    orch.claim_next_job(db_path=db_path)
    orch.complete_job(job_id, {"answer": 42}, db_path=db_path)

    job = orch.get_job(job_id, db_path=db_path)
    assert job is not None
    assert job.status == orch.STATUS_DONE
    assert job.result == {"answer": 42}
    assert job.finished_at is not None

    events = [event["event"] for event in orch.job_events(job_id, db_path=db_path)]
    assert events == ["ENQUEUED", "CLAIMED", "COMPLETED"]


def test_fail_job_retries_until_max_attempts_then_fails(db_path: Path) -> None:
    job_id = orch.enqueue_job("demo_task", {}, max_attempts=2, db_path=db_path)

    orch.claim_next_job(db_path=db_path)
    orch.fail_job(job_id, "boom-1", db_path=db_path)
    job = orch.get_job(job_id, db_path=db_path)
    assert job is not None
    assert job.status == orch.STATUS_QUEUED  # attempt 1 of 2, retried

    orch.claim_next_job(db_path=db_path)
    orch.fail_job(job_id, "boom-2", db_path=db_path)
    job = orch.get_job(job_id, db_path=db_path)
    assert job is not None
    assert job.status == orch.STATUS_FAILED  # attempt 2 of 2, exhausted
    assert job.error == "boom-2"


def test_fail_job_without_retry_fails_immediately(db_path: Path) -> None:
    job_id = orch.enqueue_job("demo_task", {}, max_attempts=5, db_path=db_path)
    orch.claim_next_job(db_path=db_path)
    orch.fail_job(job_id, "no handler", retry=False, db_path=db_path)

    job = orch.get_job(job_id, db_path=db_path)
    assert job is not None
    assert job.status == orch.STATUS_FAILED


def test_run_worker_once_dispatches_to_registered_handler(db_path: Path) -> None:
    calls: list[dict] = []

    @orch.register_handler("demo_task")
    def handler(payload: dict) -> dict:
        calls.append(payload)
        return {"doubled": payload["n"] * 2}

    job_id = orch.enqueue_job("demo_task", {"n": 3}, db_path=db_path)
    finished = orch.run_worker_once(db_path=db_path)

    assert finished is not None
    assert finished.id == job_id
    assert finished.status == orch.STATUS_DONE
    assert finished.result == {"doubled": 6}
    assert calls == [{"n": 3}]


def test_run_worker_once_with_missing_handler_fails_without_retry(db_path: Path) -> None:
    job_id = orch.enqueue_job("no_such_task", {}, db_path=db_path)
    finished = orch.run_worker_once(db_path=db_path)

    assert finished is not None
    assert finished.id == job_id
    assert finished.status == orch.STATUS_FAILED
    assert "No orchestration handler" in (finished.error or "")


def test_run_worker_once_retries_on_handler_exception(db_path: Path) -> None:
    attempts: list[int] = []

    @orch.register_handler("flaky_task")
    def handler(payload: dict) -> dict:
        attempts.append(1)
        if len(attempts) < 2:
            raise RuntimeError("transient failure")
        return {"ok": True}

    orch.enqueue_job("flaky_task", {}, max_attempts=3, db_path=db_path)

    first_pass = orch.run_worker_once(db_path=db_path)
    assert first_pass is not None
    assert first_pass.status == orch.STATUS_QUEUED  # requeued for retry

    second_pass = orch.run_worker_once(db_path=db_path)
    assert second_pass is not None
    assert second_pass.status == orch.STATUS_DONE
    assert second_pass.result == {"ok": True}
    assert len(attempts) == 2


def test_drain_queue_processes_all_jobs_in_order(db_path: Path) -> None:
    processed_order: list[int] = []

    @orch.register_handler("demo_task")
    def handler(payload: dict) -> dict:
        processed_order.append(payload["n"])
        return {"n": payload["n"]}

    for n in range(5):
        orch.enqueue_job("demo_task", {"n": n}, db_path=db_path)

    processed = orch.drain_queue(db_path=db_path)
    assert len(processed) == 5
    assert processed_order == [0, 1, 2, 3, 4]
    assert all(job.status == orch.STATUS_DONE for job in processed)
    assert orch.claim_next_job(db_path=db_path) is None


def test_drain_queue_respects_limit(db_path: Path) -> None:
    @orch.register_handler("demo_task")
    def handler(payload: dict) -> dict:
        return {}

    for _ in range(5):
        orch.enqueue_job("demo_task", {}, db_path=db_path)

    processed = orch.drain_queue(limit=2, db_path=db_path)
    assert len(processed) == 2
    assert len(orch.list_jobs(status=orch.STATUS_QUEUED, db_path=db_path)) == 3


def test_list_jobs_filters_by_status_and_type(db_path: Path) -> None:
    orch.enqueue_job("type_a", {}, db_path=db_path)
    orch.enqueue_job("type_b", {}, db_path=db_path)

    only_a = orch.list_jobs(job_type="type_a", db_path=db_path)
    assert len(only_a) == 1
    assert only_a[0].job_type == "type_a"

    queued_only = orch.list_jobs(status=orch.STATUS_QUEUED, db_path=db_path)
    assert len(queued_only) == 2
