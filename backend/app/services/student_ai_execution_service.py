"""Bounded student AI calls shared by all API workers.

Admission and settlement are short transactions. Provider work never owns a DB
connection. Durable results allow an interrupted HTTP request to be retried
without rerunning a successful model call; answer/mastery writes stay elsewhere.
"""

import asyncio
import copy
import hashlib
import json
import logging
import random
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException
from app.core.ai_client import AIConfigurationError
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
)

from app.core.config import settings
from app.models.student import Student, StudentAiExecution, StudentAiUsageLog
from app.services.ai_call_budget import AiBudgetExhausted, ai_call_budget

# Settlement and the HTTP response need a moment after the last provider call.
_BUDGET_MARGIN_SECONDS = 2.0

# Use Uvicorn's configured INFO handler in production, not an unconfigured root
# logger (whose default WARNING level would silently hide timing measurements).
logger = logging.getLogger("uvicorn.error.student_ai")
_tasks: set[asyncio.Task] = set()
_ADMISSION_LOCK = "SELECT pg_advisory_xact_lock(721442019)"


async def _lock_ledger(db: AsyncSession) -> None:
    await db.execute(text("SET LOCAL lock_timeout = '2s'"))
    await db.execute(text("SET LOCAL statement_timeout = '5s'"))
    await db.execute(text(_ADMISSION_LOCK))


def _retain(task: asyncio.Task) -> None:
    _tasks.add(task)

    def done(completed):
        _tasks.discard(completed)
        if not completed.cancelled():
            completed.exception()  # Retrieve failures even if the HTTP caller disconnected.

    task.add_done_callback(done)


def _failed(code: str) -> HTTPException:
    if code == "not_configured":
        return AIConfigurationError()
    return HTTPException(
        status_code=504 if code == "timeout" else 503,
        detail="AI 处理超时，请稍后重试。"
        if code == "timeout"
        else "AI 暂时未能完成，请稍后重试。",
        headers={"Retry-After": "2"},
    )


def _task_timeout(feature: str) -> float:
    return (settings.student_ai_paper_batch_timeout_seconds
            if feature == "practice.paper_batch_grading" else settings.student_ai_timeout_seconds)


def _legacy_photo_parse_failure(feature: str, result: Any) -> bool:
    """Only the old JSON-parser fallback, not a genuinely unreadable image."""
    return (
        feature == "practice.photo_vision_grading"
        and isinstance(result, dict)
        and result.get("extracted_answer") == ""
        and result.get("feedback") == "AI 无法识别图片中的答案，请重新拍照或使用文字输入"
        and result.get("error_type") == "unknown"
        and result.get("needs_human_review") is True
    )


class StudentAiExecutionService:
    def __init__(
        self,
        bind: AsyncEngine | AsyncConnection,
        *,
        per_minute_limit: int | None = None,
    ):
        self.sessions = async_sessionmaker(bind, expire_on_commit=False)
        self.per_minute_limit = per_minute_limit

    async def _claim(
        self, student_id, feature, key, fingerprint, queue_ms, *, follower
    ):
        # Import here to avoid a circular dependency with the public facade.
        from app.services.student_ai_usage_service import StudentAiUsageService

        async with self.sessions() as db, db.begin():
            await _lock_ledger(db)
            now = datetime.now(timezone.utc)
            student = await db.get(Student, student_id)
            if not student or student.status != "active":
                raise HTTPException(
                    status_code=401, detail="Student account unavailable"
                )
            row = await db.scalar(
                select(StudentAiExecution)
                .where(
                    StudentAiExecution.student_id == student_id,
                    StudentAiExecution.operation_key == key,
                )
                .with_for_update()
            )
            if row:
                if row.fingerprint != fingerprint or row.feature != feature:
                    raise HTTPException(
                        status_code=409,
                        detail="同一次提交的作答内容已变化，请重新提交。",
                    )
                if row.status == "succeeded":
                    if not _legacy_photo_parse_failure(feature, row.result):
                        return "cached", copy.deepcopy(row.result)
                    if follower:
                        # Waiters observe the failure; only a new explicit
                        # request should spend another provider call.
                        raise _failed("provider_error")
                    # Preserve the old execution and metered usage for audit;
                    # a fresh retry gets its own execution and provider budget.
                    # This repairs already-cached parser failures on demand,
                    # without changing answers or mastery.
                    row.operation_key = f"invalid-photo-response:{row.id}"
                    await db.flush()
                    row = None
                if row is not None and row.status == "running" and row.lease_expires_at > now:
                    return "following", None
                if follower:
                    raise _failed(row.error_code or "interrupted")

            active = [
                StudentAiExecution.status == "running",
                StudentAiExecution.lease_expires_at > now,
            ]
            global_count = await db.scalar(
                select(func.count()).select_from(StudentAiExecution).where(*active)
            )
            student_count = await db.scalar(
                select(func.count())
                .select_from(StudentAiExecution)
                .where(*active, StudentAiExecution.student_id == student_id)
            )
            if (
                global_count >= settings.student_ai_global_concurrency
                or student_count >= settings.student_ai_student_concurrency
            ):
                return "queued", None
            usage = StudentAiUsageService(db, per_minute_limit=self.per_minute_limit)
            await usage.ensure_ai_call_allowed(student_id, feature=feature, now=now)
            owner = uuid.uuid4().hex
            if row is None:
                row = StudentAiExecution(
                    id=uuid.uuid4().hex,
                    student_id=student_id,
                    operation_key=key,
                    fingerprint=fingerprint,
                    feature=feature,
                )
                db.add(row)
            row.status = "running"
            row.owner = owner
            row.started_at = now
            # This exceeds the enforced provider deadline, so a live call is not
            # reassigned merely because its HTTP connection went away.
            row.lease_expires_at = now + timedelta(
                seconds=_task_timeout(feature) + 30
            )
            row.finished_at = None
            row.result = None
            row.error_code = None
            row.queue_ms = queue_ms
            row.provider_ms = None
            await db.flush()
            return "owned", (row.id, owner)

    async def _admit(self, student_id, feature, submission_key, fingerprint):
        key = hashlib.sha256(
            f"{feature}:{submission_key or uuid.uuid4().hex}".encode()
        ).hexdigest()
        fingerprint = hashlib.sha256(
            json.dumps(fingerprint, ensure_ascii=False, sort_keys=True).encode()
        ).hexdigest()
        started = time.monotonic()
        follower = False
        poll_interval = 0.1
        while True:
            try:
                state, value = await self._claim(
                    student_id,
                    feature,
                    key,
                    fingerprint,
                    round((time.monotonic() - started) * 1000),
                    follower=follower,
                )
            except DBAPIError as exc:
                if getattr(exc.orig, "sqlstate", None) not in {"55P03", "57014"}:
                    raise
                # Short DB contention is overload, not a provider failure. No
                # model has been started and no transaction remains open here.
                state, value = "queued", None
            if state in {"cached", "owned"}:
                return state, value
            follower = follower or state == "following"
            timeout = (
                _task_timeout(feature) + 5
                if follower
                else settings.student_ai_queue_timeout_seconds
            )
            if time.monotonic() - started >= timeout:
                raise HTTPException(
                    status_code=409 if follower else 429,
                    detail="这份作答仍在处理中，请稍后重试获取结果。"
                    if follower
                    else "AI 正在处理较多作答，请稍后重试。",
                    headers={"Retry-After": "2"},
                )
            # Back off and jitter to avoid a class-wide retry wave contending
            # on the short admission lock several times every second.
            await asyncio.sleep(poll_interval * random.uniform(0.8, 1.2))
            poll_interval = min(1.0, poll_interval * 2)

    async def _finish(self, ticket, *, result=None, error=None, elapsed_ms, model_calls=None):
        for attempt in range(3):
            try:
                return await self._finish_once(
                    ticket, result=result, error=error, elapsed_ms=elapsed_ms,
                    model_calls=model_calls,
                )
            except DBAPIError:
                if attempt == 2:
                    # Do not expose a SQL error containing private result parameters.
                    # Keep the lease on uncertain settlement; never rerun the AI here.
                    logger.error("student_ai_settlement_failed execution=%s", ticket[0])
                    raise _failed("settlement_error") from None
                await asyncio.sleep(0.15 * (attempt + 1))

    async def _finish_once(self, ticket, *, result=None, error=None, elapsed_ms, model_calls=None):
        async with self.sessions() as db, db.begin():
            # Reservation -> successful usage must be observed atomically by
            # admission; otherwise separate COUNT queries can miss that transfer.
            await _lock_ledger(db)
            row = await db.scalar(
                select(StudentAiExecution)
                .where(StudentAiExecution.id == ticket[0])
                .with_for_update()
            )
            if not row or row.owner != ticket[1]:
                raise _failed("interrupted")
            # A commit acknowledgement can be lost after a successful commit.
            # Retrying settlement must not insert a second usage row.
            if row.status == ("failed" if error else "succeeded"):
                return
            if row.status != "running":
                raise _failed("interrupted")
            now = datetime.now(timezone.utc)
            row.status = "failed" if error else "succeeded"
            row.result = None if error else result
            row.error_code = error
            row.finished_at = now
            row.lease_expires_at = now
            row.provider_ms = elapsed_ms
            row.model_calls = model_calls
            if not error:
                db.add(
                    StudentAiUsageLog(
                        student_id=row.student_id,
                        feature=row.feature,
                        execution_id=row.id,
                        # Metered by provider calls; uninstrumented features count once.
                        units=max(1, model_calls or 0),
                        created_at=now,
                    )
                )
        # Log only after durable commit. No identity, answer, prompt or provider error body.
        logger.info(
            "student_ai_call execution=%s feature=%s outcome=%s queue_ms=%s provider_ms=%s model_calls=%s",
            row.id,
            row.feature,
            row.status,
            row.queue_ms,
            elapsed_ms,
            model_calls,
        )

    async def _execute(self, ticket, operation, *, timeout_seconds=None):
        start = time.monotonic()
        timeout_seconds = timeout_seconds or settings.student_ai_timeout_seconds
        # Provider calls share the task deadline, so a slow first provider leaves
        # time for its fallback and the task ends with what it has.
        with ai_call_budget(
            max(1.0, timeout_seconds - _BUDGET_MARGIN_SECONDS),
            settings.student_ai_max_model_calls,
        ) as budget:
            try:
                async with asyncio.timeout(timeout_seconds):
                    result = await operation()
            except BaseException as exc:
                code = (
                    "not_configured"
                    if isinstance(exc, AIConfigurationError)
                    else "timeout"
                    if isinstance(exc, (TimeoutError, AiBudgetExhausted))
                    else "interrupted"
                    if isinstance(exc, asyncio.CancelledError)
                    else "provider_error"
                )
                await asyncio.shield(
                    self._finish(
                        ticket,
                        error=code,
                        elapsed_ms=round((time.monotonic() - start) * 1000),
                        model_calls=budget.calls,
                    )
                )
                if isinstance(exc, asyncio.CancelledError):
                    raise
                raise _failed(code) from exc
        await self._finish(
            ticket, result=result, elapsed_ms=round((time.monotonic() - start) * 1000),
            model_calls=budget.calls,
        )
        return copy.deepcopy(result)

    async def run(
        self,
        student_id: str,
        *,
        feature: str,
        operation: Callable[[], Awaitable[Any]],
        submission_key: str | None = None,
        fingerprint: Any = None,
    ) -> Any:
        state, value = await self._admit(
            student_id, feature, submission_key, fingerprint
        )
        if state == "cached":
            return value
        task = asyncio.create_task(self._execute(value, operation, timeout_seconds=_task_timeout(feature)))
        _retain(task)
        # A dropped HTTP connection does not cancel paid work or discard its result.
        return await asyncio.shield(task)

    async def stream(
        self,
        student_id: str,
        *,
        feature: str,
        operation: Callable[[], AsyncIterator[str]],
    ) -> AsyncIterator[str]:
        _, ticket = await self._admit(student_id, feature, None, None)

        async def generate():
            start = time.monotonic()
            error = "interrupted"
            try:
                async with asyncio.timeout(settings.student_ai_timeout_seconds):
                    async for chunk in operation():
                        yield chunk
                error = None
            except TimeoutError:
                error = "timeout"
                raise _failed(error) from None
            except AIConfigurationError:
                error = "not_configured"
                raise _failed(error) from None
            except Exception:  # noqa: BLE001 - never expose a provider's private error body
                error = "provider_error"
                raise _failed(error) from None
            finally:
                settlement = asyncio.create_task(
                    self._finish(
                        ticket,
                        error=error,
                        elapsed_ms=round((time.monotonic() - start) * 1000),
                    )
                )
                _retain(settlement)
                await asyncio.shield(settlement)

        return generate()
