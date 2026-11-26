"""Real PostgreSQL coordination, fake providers only; never call a paid model."""

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from app.core.config import settings
from app.models.student import Student, StudentAiExecution, StudentAiUsageLog
from app.services.data_retention_service import cleanup_expired_student_data
from app.services.student_ai_execution_service import StudentAiExecutionService, _tasks
from app.services.student_ai_usage_service import StudentAiUsageService
from fastapi import HTTPException
from sqlalchemy import func, select, text


@pytest_asyncio.fixture
async def setup(db_session, monkeypatch):
    monkeypatch.setattr(settings, "student_ai_daily_limit_enabled", False)
    monkeypatch.setattr(settings, "student_ai_student_concurrency", 3)
    monkeypatch.setattr(settings, "student_ai_global_concurrency", 12)
    monkeypatch.setattr(settings, "student_ai_timeout_seconds", 3)
    monkeypatch.setattr(settings, "student_ai_queue_timeout_seconds", 3)
    for sid in ("qa-a", "qa-b", "qa-c"):
        db_session.add(
            Student(
                id=sid,
                username=sid,
                display_name="QA",
                password_hash="unused",
                status="active",
                account_source="self_registered",
            )
        )
    await db_session.commit()
    service = StudentAiExecutionService(db_session.bind, per_minute_limit=100)
    yield service
    if _tasks:
        await asyncio.gather(*list(_tasks), return_exceptions=True)


async def usage_count(db):
    return await db.scalar(select(func.count()).select_from(StudentAiUsageLog))


@pytest.mark.asyncio
async def test_photo_parser_failure_retries_the_same_submission_then_reuses_its_good_result(setup, db_session):
    calls = 0

    async def provider():
        nonlocal calls
        calls += 1
        if calls == 1:
            raise ValueError("Invalid photo extraction response")
        return {"extracted_answer": "2", "is_correct": True}

    async def request():
        return await setup.run("qa-a", feature="practice.photo_vision_grading",
                               submission_key="same-image", fingerprint={"image": "same"}, operation=provider)

    with pytest.raises(HTTPException) as failed:
        await request()
    assert failed.value.status_code == 503
    assert await usage_count(db_session) == 0
    assert (await request())["extracted_answer"] == "2"
    assert (await request())["extracted_answer"] == "2"
    assert calls == 2
    assert await usage_count(db_session) == 1


@pytest.mark.asyncio
async def test_old_cached_parser_failure_is_retried_once_without_erasing_its_metered_usage(setup, db_session):
    calls = 0

    async def provider():
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.05)
        if calls == 1:
            return {"extracted_answer": "", "is_correct": False, "error_type": "unknown",
                    "feedback": "AI 无法识别图片中的答案，请重新拍照或使用文字输入", "needs_human_review": True}
        return {"extracted_answer": "2", "is_correct": True}

    async def request():
        return await setup.run("qa-a", feature="practice.photo_vision_grading",
                               submission_key="legacy-image", fingerprint="same", operation=provider)

    # Simulate the result an older release incorrectly settled as successful.
    old = await request()
    assert old["extracted_answer"] == "" and await usage_count(db_session) == 1
    results = await asyncio.gather(request(), request(), request())
    assert all(result["extracted_answer"] == "2" for result in results)
    assert calls == 2
    assert await usage_count(db_session) == 2
    rows = (await db_session.scalars(select(StudentAiExecution))).all()
    assert len(rows) == 2
    assert any(r.operation_key.startswith("invalid-photo-response:") and r.result == old for r in rows)
    assert (await request())["extracted_answer"] == "2" and calls == 2


@pytest.mark.asyncio
async def test_genuinely_unreadable_photo_is_not_repeated_for_identical_retries(setup, db_session):
    calls = 0

    async def provider():
        nonlocal calls
        calls += 1
        return {"extracted_answer": "", "feedback": "AI 未能识别出可批改的作答", "needs_human_review": True}

    for _ in range(2):
        await setup.run("qa-a", feature="practice.photo_vision_grading", submission_key="unreadable", operation=provider)
    assert calls == 1
    assert await usage_count(db_session) == 1


@pytest.mark.asyncio
async def test_six_questions_have_three_parallel_providers_without_open_transaction(
    setup, db_session
):
    active = peak = 0
    all_started = asyncio.Event()
    release = asyncio.Event()

    async def provider():
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        if active == 3:
            all_started.set()
        await release.wait()
        await asyncio.sleep(0.05)
        active -= 1
        return {"is_correct": True}

    # Separate facades/sessions model separate requests, and two coordinators
    # model separate API workers sharing the same database.
    async def request(index):
        async with setup.sessions() as db:
            await db.get(
                Student, "qa-a"
            )  # Auth/request reads must also release their transaction.
            async def provider_without_request_transaction():
                assert not db.in_transaction()
                return await provider()

            return await StudentAiUsageService(db, per_minute_limit=100).run(
                "qa-a",
                feature="practice.photo_vision_grading",
                submission_key=str(index),
                fingerprint={"image": str(index)},
                operation=provider_without_request_transaction,
            )

    tasks = [asyncio.create_task(request(i)) for i in range(6)]
    await asyncio.wait_for(all_started.wait(), 3)
    try:
        await asyncio.sleep(0.2)
        async with setup.sessions() as monitor:
            idle = await monitor.scalar(
                text(
                    "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() "
                    "AND pid <> pg_backend_pid() AND state = 'idle in transaction' "
                    "AND xact_start < clock_timestamp() - interval '100 milliseconds'"
                )
            )
        # Short admission transactions can be between SQL statements at this
        # instant. Only a transaction spanning the held provider is a leak.
        assert idle == 0
        assert active == 3
    finally:
        release.set()
    assert len(await asyncio.gather(*tasks)) == 6
    assert peak == 3
    assert await usage_count(db_session) == 6


@pytest.mark.asyncio
async def test_global_capacity_is_shared_across_students_and_service_instances(
    setup, monkeypatch
):
    monkeypatch.setattr(settings, "student_ai_global_concurrency", 2)
    other = StudentAiExecutionService(setup.sessions.kw["bind"], per_minute_limit=100)
    active = peak = 0

    async def provider():
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.12)
        active -= 1
        return "ok"

    result = await asyncio.gather(
        *[
            (setup if i % 2 else other).run(
                f"qa-{'abc'[i % 3]}", feature="tutor.hint", operation=provider
            )
            for i in range(6)
        ]
    )
    assert result == ["ok"] * 6
    assert peak == 2


@pytest.mark.asyncio
async def test_retries_share_one_call_and_result_and_usage(setup, db_session):
    calls = 0

    async def provider():
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.1)
        return {"feedback": "QA answer", "items": [1]}

    async def request(student="qa-a", fingerprint="same"):
        return await setup.run(
            student,
            feature="practice.photo",
            submission_key="id-1",
            fingerprint=fingerprint,
            operation=provider,
        )

    results = await asyncio.gather(*[request() for _ in range(6)])
    results[0]["items"].append(2)
    assert (await request())["items"] == [1]
    assert calls == 1
    assert await usage_count(db_session) == 1
    with pytest.raises(HTTPException) as exc:
        await request(fingerprint="changed")
    assert exc.value.status_code == 409
    await request(student="qa-b")
    assert calls == 2


@pytest.mark.asyncio
async def test_disconnected_request_does_not_discard_paid_work(setup, db_session):
    started, release = asyncio.Event(), asyncio.Event()
    calls = 0

    async def provider():
        nonlocal calls
        calls += 1
        started.set()
        await release.wait()
        return {"feedback": "completed after disconnect"}

    async def request():
        return await setup.run(
            "qa-a",
            feature="practice.photo",
            submission_key="disconnect",
            operation=provider,
        )

    original = asyncio.create_task(request())
    await started.wait()
    original.cancel()
    with pytest.raises(asyncio.CancelledError):
        await original
    release.set()
    assert (await request())["feedback"] == "completed after disconnect"
    assert calls == 1
    assert await usage_count(db_session) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["timeout", "error"])
async def test_failure_releases_slot_and_followers_do_not_retry_provider(
    setup, db_session, monkeypatch, failure
):
    # The provider-error case must not race a 120 ms timeout on a busy CI runner.
    # Keep the short deadline only for the case that deliberately exercises it.
    monkeypatch.setattr(
        settings, "student_ai_timeout_seconds", 3 if failure == "error" else 0.12
    )
    calls = 0

    async def provider():
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.08 if failure == "error" else 1)
        raise ValueError("provider private error")

    async def request():
        return await setup.run(
            "qa-a",
            feature="practice.photo",
            submission_key="failure",
            operation=provider,
        )

    results = await asyncio.gather(request(), request(), return_exceptions=True)
    assert all(isinstance(result, HTTPException) for result in results)
    assert {result.status_code for result in results} == {
        504 if failure == "timeout" else 503
    }
    assert calls == 1
    assert await usage_count(db_session) == 0
    row = await db_session.scalar(select(StudentAiExecution))
    assert row.status == "failed"
    with pytest.raises(HTTPException):
        await request()  # A new explicit retry is allowed after failure.
    assert calls == 2


@pytest.mark.asyncio
async def test_daily_off_keeps_usage_but_on_reserves_last_quota_atomically(
    setup, db_session, monkeypatch
):
    now = datetime.now(timezone.utc)
    db_session.add_all(
        [
            StudentAiUsageLog(student_id="qa-a", feature="past", created_at=now)
            for _ in range(21)
        ]
    )
    await db_session.commit()

    async def provider():
        await asyncio.sleep(0.1)
        return "ok"

    await setup.run("qa-a", feature="practice.photo", operation=provider)
    assert await usage_count(db_session) == 22
    monkeypatch.setattr(settings, "student_ai_daily_limit_enabled", True)
    monkeypatch.setattr(settings, "student_ai_daily_limit", 23)
    results = await asyncio.gather(
        *[
            setup.run("qa-a", feature="practice.photo", operation=provider)
            for _ in range(3)
        ],
        return_exceptions=True,
    )
    assert results.count("ok") == 1
    assert (
        sum(isinstance(r, HTTPException) and r.status_code == 429 for r in results) == 2
    )
    assert await usage_count(db_session) == 23


@pytest.mark.asyncio
async def test_burst_limit_counts_inflight_reservations(setup):
    setup.per_minute_limit = 1

    async def provider():
        await asyncio.sleep(0.1)
        return "ok"

    results = await asyncio.gather(
        *[
            setup.run("qa-a", feature="practice.photo", operation=provider)
            for _ in range(3)
        ],
        return_exceptions=True,
    )
    assert results.count("ok") == 1
    assert (
        sum(isinstance(r, HTTPException) and r.status_code == 429 for r in results) == 2
    )


@pytest.mark.asyncio
async def test_queue_wait_is_bounded(setup, monkeypatch):
    monkeypatch.setattr(settings, "student_ai_global_concurrency", 1)
    monkeypatch.setattr(settings, "student_ai_queue_timeout_seconds", 0.1)
    started, release = asyncio.Event(), asyncio.Event()

    async def provider():
        started.set()
        await release.wait()
        return "ok"

    first = asyncio.create_task(
        setup.run("qa-a", feature="practice.photo", operation=provider)
    )
    await started.wait()
    try:
        with pytest.raises(HTTPException) as exc:
            await setup.run("qa-b", feature="practice.photo", operation=provider)
        assert exc.value.status_code == 429
        assert exc.value.headers["Retry-After"] == "2"
    finally:
        release.set()
        await first


@pytest.mark.asyncio
async def test_stale_owner_cannot_settle_new_owner_and_cleanup_preserves_active_results(
    setup, db_session
):
    state, first = await setup._claim(
        "qa-a", "practice.photo", "key", "fingerprint", 0, follower=False
    )
    assert state == "owned"
    row = await db_session.get(StudentAiExecution, first[0])
    row.lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    await db_session.commit()
    _, second = await setup._claim(
        "qa-a", "practice.photo", "key", "fingerprint", 0, follower=False
    )
    assert first[1] != second[1]
    with pytest.raises(HTTPException):
        await setup._finish(first, result="stale", elapsed_ms=1)
    await setup._finish(second, result="fresh", elapsed_ms=1)
    assert await usage_count(db_session) == 1
    await db_session.refresh(row)
    row.started_at -= timedelta(days=8)
    await db_session.commit()
    _, active = await setup._claim(
        "qa-b", "practice.photo", "key", "fingerprint", 0, follower=False
    )
    deleted = await cleanup_expired_student_data(db_session)
    assert deleted["ai_execution_results"] == 1
    assert await db_session.get(StudentAiExecution, active[0]) is not None
    assert await usage_count(db_session) == 1
    await setup._finish(active, error="interrupted", elapsed_ms=1)


@pytest.mark.asyncio
async def test_inactive_student_cannot_reuse_results(setup, db_session):
    async def provider():
        return "ok"

    await setup.run(
        "qa-a", feature="practice.photo", submission_key="id", operation=provider
    )
    student = await db_session.get(Student, "qa-a")
    student.status = "disabled"
    await db_session.commit()
    with pytest.raises(HTTPException) as exc:
        await setup.run(
            "qa-a", feature="practice.photo", submission_key="id", operation=provider
        )
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_stream_completion_and_early_close_release_capacity(setup, db_session):
    async def provider():
        yield "first"
        yield "second"

    stream = await setup.stream("qa-a", feature="learn.chat", operation=provider)
    assert [chunk async for chunk in stream] == ["first", "second"]
    assert await usage_count(db_session) == 1
    partial = await setup.stream("qa-a", feature="learn.chat", operation=provider)
    assert await anext(partial) == "first"
    await partial.aclose()
    assert await usage_count(db_session) == 1
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(StudentAiExecution)
            .where(StudentAiExecution.status == "running")
        )
        == 0
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["timeout", "error"])
async def test_stream_failure_releases_slot_without_recording_success(
    setup, db_session, monkeypatch, failure
):
    monkeypatch.setattr(settings, "student_ai_timeout_seconds", 0.05)

    async def provider():
        if failure == "timeout":
            await asyncio.sleep(1)
        raise ValueError("private provider error")
        yield "unreachable"

    stream = await setup.stream("qa-a", feature="learn.chat", operation=provider)
    with pytest.raises(HTTPException) as exc:
        await anext(stream)
    assert exc.value.status_code == (504 if failure == "timeout" else 503)
    assert "private" not in exc.value.detail
    assert await usage_count(db_session) == 0
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(StudentAiExecution)
            .where(StudentAiExecution.status == "running")
        )
        == 0
    )


@pytest.mark.asyncio
async def test_facade_refuses_to_commit_pending_user_changes(setup, db_session):
    student = await db_session.get(Student, "qa-a")
    student.display_name = "uncommitted change"

    async def provider():
        pytest.fail("must not call provider")

    with pytest.raises(RuntimeError, match="pending database mutations"):
        await StudentAiUsageService(db_session).run(
            "qa-a", feature="practice.photo", operation=provider
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_metrics_do_not_log_private_input_or_result(setup, caplog):
    async def provider():
        return {"feedback": "PRIVATE RESULT"}

    with caplog.at_level("INFO", logger="uvicorn.error.student_ai"):
        await setup.run(
            "qa-a",
            feature="practice.photo",
            fingerprint="PRIVATE INPUT",
            operation=provider,
        )
    assert "provider_ms=" in caplog.text
    assert "queue_ms=" in caplog.text
    assert "qa-a" not in caplog.text
    assert "PRIVATE" not in caplog.text


@pytest.mark.asyncio
async def test_settlement_retry_after_lost_ack_does_not_repeat_usage(
    setup, db_session, monkeypatch
):
    from sqlalchemy.exc import DBAPIError

    original = setup._finish_once
    attempts = 0

    async def uncertain_settlement(*args, **kwargs):
        nonlocal attempts
        attempts += 1
        await original(*args, **kwargs)
        if attempts == 1:
            raise DBAPIError("commit", {}, OSError("lost acknowledgement"))

    monkeypatch.setattr(setup, "_finish_once", uncertain_settlement)

    async def provider():
        return "ok"

    assert await setup.run("qa-a", feature="practice.photo", operation=provider) == "ok"
    assert attempts == 2
    assert await usage_count(db_session) == 1


@pytest.mark.asyncio
async def test_periodic_cache_cleanup_runs_without_restart(setup, db_session):
    from app.services.data_retention_service import (
        cleanup_student_ai_results_periodically,
    )

    async def provider():
        return "old result"

    await setup.run("qa-a", feature="practice.photo", operation=provider)
    row = await db_session.scalar(select(StudentAiExecution))
    row.started_at -= timedelta(days=8)
    await db_session.commit()
    worker = asyncio.create_task(
        cleanup_student_ai_results_periodically(setup.sessions, interval_seconds=0.01)
    )
    try:
        for _ in range(100):
            async with setup.sessions() as check:
                remaining = await check.scalar(
                    select(func.count()).select_from(StudentAiExecution)
                )
            if remaining == 0:
                break
            await asyncio.sleep(0.02)
        assert remaining == 0
    finally:
        worker.cancel()
        with pytest.raises(asyncio.CancelledError):
            await worker
    assert await usage_count(db_session) == 1


@pytest.mark.asyncio
async def test_reservation_to_usage_transition_uses_admission_lock(
    setup, db_session, monkeypatch
):
    from app.services import student_ai_execution_service as module

    _, ticket = await setup._claim(
        "qa-a", "practice.photo", "key", "hash", 0, follower=False
    )
    locked = []
    original = module._lock_ledger

    async def track_lock(db):
        await original(db)
        locked.append(True)

    monkeypatch.setattr(module, "_lock_ledger", track_lock)
    await setup._finish(ticket, result="ok", elapsed_ms=1)
    assert locked == [True]
    assert await usage_count(db_session) == 1


@pytest.mark.asyncio
async def test_account_reset_invalidates_cached_ai_results(setup, db_session, tmp_path):
    from app.services.student_service import StudentService

    async def provider():
        return "private answer"

    await setup.run(
        "qa-a", feature="practice.photo", submission_key="id", operation=provider
    )
    result = await StudentService(
        db_session, answer_upload_root=tmp_path
    ).reset_student_account("qa-a")
    assert result["deleted"]["student_ai_executions"] == 1
    assert (
        await db_session.scalar(select(func.count()).select_from(StudentAiExecution))
        == 0
    )
    assert (
        await usage_count(db_session) == 1
    )  # Cost history is not reset by clearing learning records.


@pytest.mark.asyncio
@pytest.mark.parametrize("photo", [True, False])
async def test_real_grading_pipeline_retries_do_not_duplicate_answers_or_mastery(
    setup, db_session, monkeypatch, tmp_path, photo
):
    import io

    from app.api.student import answer_grading
    from app.models.student import StudentAnswer, StudentMastery
    from app.services.adaptive_service import AdaptiveService
    from app.services.knowledge_service import KnowledgeService
    from app.services.question_service import QuestionService
    from starlette.datastructures import Headers, UploadFile

    await KnowledgeService(db_session).create_point(
        {"id": "kp_ai_qa", "name": "并发批改"}
    )
    await QuestionService(db_session).create_question(
        {
            "id": "q_ai_qa",
            "stem_text": "填写物体的速度",
            "answer": "2",
            "explanation": "速度为2",
            "question_type": "fill_in_blank",
            "difficulty": 2.0,
            "source": "human",
            "labels": [
                {
                    "label_type": "knowledge_point",
                    "label_id": "kp_ai_qa",
                    "role": "主要",
                }
            ],
            "options": [],
            "formulas": [],
            "images": [],
        }
    )
    # Route uploads go into a disposable fixture directory, never the real media tree.
    monkeypatch.setattr(
        answer_grading, "__file__", str(tmp_path / "app/api/student/answer_grading.py")
    )
    calls = 0

    class Ai:
        async def judge_photo_answer(self, **kwargs):
            nonlocal calls
            calls += 1
            await asyncio.sleep(0.1)
            return {"is_correct": True, "feedback": "正确", "extracted_answer": "2"}

        judge_answer = judge_photo_answer

    async def request():
        async with setup.sessions() as db:
            usage = StudentAiUsageService(db, per_minute_limit=100)
            adaptive = AdaptiveService(db, ai_usage_svc=usage)
            adaptive.ai_svc = Ai()
            if not photo:
                return await adaptive.submit_answer(
                    "qa-a",
                    "q_ai_qa",
                    "2",
                    1000,
                    submission_id="repeat-1",
                    target_knowledge_point_id="kp_ai_qa",
                )
            return await answer_grading._submit_image_answer(
                image=UploadFile(
                    io.BytesIO(b"fake-image"),
                    filename="qa.jpg",
                    headers=Headers({"content-type": "image/jpeg"}),
                ),
                question_id="q_ai_qa",
                student_id="qa-a",
                time_spent_ms=1000,
                submission_id="repeat-1",
                target_knowledge_point_id="kp_ai_qa",
                adaptive_svc=adaptive,
                ai_svc=Ai(),
                question_svc=QuestionService(db),
                source="photo",
                ai_usage_svc=usage,
            )

    responses = await asyncio.gather(request(), request(), request())
    assert len({r["answer_id"] for r in responses}) == 1
    assert calls == 1
    assert await usage_count(db_session) == 1
    assert await db_session.scalar(select(func.count()).select_from(StudentAnswer)) == 1
    mastery = await db_session.scalar(select(StudentMastery))
    assert mastery.attempts == 1


class _FakeCompletions:
    def __init__(self, owner):
        self.owner = owner

    async def create(self, **kwargs):
        self.owner.requests.append(kwargs)
        return "reply"


class _FakeChat:
    def __init__(self, owner):
        self.completions = _FakeCompletions(owner)


class _FakeProviderClient:
    """Records the per-call options the budget sets; never reaches a network."""

    def __init__(self):
        self.requests = []
        self.options = []
        self.chat = _FakeChat(self)

    def with_options(self, **options):
        self.options.append(options)
        return self


@pytest.mark.asyncio
async def test_daily_quota_is_metered_by_provider_calls(setup, db_session, monkeypatch):
    from app.services.ai_call_budget import create_chat_completion

    monkeypatch.setattr(settings, "student_ai_timeout_seconds", 30)
    monkeypatch.setattr(settings, "student_ai_paper_batch_timeout_seconds", 30)
    client = _FakeProviderClient()

    async def worksheet_with_fallbacks():
        for _ in range(3):
            await create_chat_completion(client, "deepseek", 45, model="m", messages=[])
        return "graded"

    assert await setup.run("qa-a", feature="practice.paper_batch_grading",
                           operation=worksheet_with_fallbacks) == "graded"
    log = await db_session.scalar(select(StudentAiUsageLog).where(StudentAiUsageLog.student_id == "qa-a"))
    assert log.units == 3
    execution = await db_session.scalar(select(StudentAiExecution).where(StudentAiExecution.id == log.execution_id))
    assert execution.model_calls == 3
    # Each call is bounded by what is left of the task and never retried by the SDK.
    assert all(option["max_retries"] == 0 and option["timeout"] <= 30 for option in client.options)

    async def uninstrumented():
        return "hint"

    await setup.run("qa-a", feature="tutor.hint", operation=uninstrumented)
    usage = await StudentAiUsageService(db_session).ensure_ai_call_allowed("qa-a", feature="x")
    assert usage["used"] == 4  # 3 calls + a task without metered calls counts once

    monkeypatch.setattr(settings, "student_ai_daily_limit_enabled", True)
    monkeypatch.setattr(settings, "student_ai_daily_limit", 4)
    with pytest.raises(HTTPException) as blocked:
        await setup.run("qa-a", feature="tutor.hint", operation=uninstrumented)
    assert blocked.value.status_code == 429


@pytest.mark.asyncio
async def test_spent_budget_ends_the_task_as_a_timeout(setup, db_session, monkeypatch):
    from app.services.ai_call_budget import create_chat_completion

    monkeypatch.setattr(settings, "student_ai_timeout_seconds", 30)
    monkeypatch.setattr(settings, "student_ai_max_model_calls", 2)
    client = _FakeProviderClient()

    async def runaway_fallbacks():
        for _ in range(5):
            await create_chat_completion(client, "deepseek", 45, model="m", messages=[])

    with pytest.raises(HTTPException) as failed:
        await setup.run("qa-b", feature="practice.paper_batch_grading", operation=runaway_fallbacks)
    assert failed.value.status_code == 504
    assert len(client.requests) == 2
    execution = await db_session.scalar(select(StudentAiExecution).where(StudentAiExecution.student_id == "qa-b"))
    assert execution.status == "failed" and execution.model_calls == 2
