from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.core.config import settings

from app.models.student import StudentAiUsageLog
from app.services.student_ai_usage_service import StudentAiUsageService, daily_ai_limit_for_student
from app.services.student_service import StudentService


@pytest.mark.asyncio
async def test_active_student_respects_configured_daily_ai_limit(db_session, monkeypatch):
    monkeypatch.setattr(settings, "student_ai_daily_limit_enabled", True)
    monkeypatch.setattr(settings, "student_ai_daily_limit", 20)
    monkeypatch.setattr(settings, "student_ai_daily_limit", 20)
    student_svc = StudentService(db_session)
    student = await student_svc.create_student(
        "ai_free_user",
        "school-pass",
        "AI 体验学生",
        account_source="self_registered",
    )
    usage_svc = StudentAiUsageService(db_session, per_minute_limit=100)
    now = datetime(2026, 6, 21, 1, 0, tzinfo=timezone.utc)

    assert daily_ai_limit_for_student(student) == 20

    for index in range(20):
        usage = await usage_svc.ensure_ai_call_allowed(
            student.id,
            feature="tutor_hint",
            now=now + timedelta(seconds=index),
        )
        assert usage["limit"] == 20
        assert usage["used"] == index
        await usage_svc.record_successful_ai_call(
            student.id,
            feature="tutor_hint",
            now=now + timedelta(seconds=index),
        )

    with pytest.raises(HTTPException) as exc:
        await usage_svc.ensure_ai_call_allowed(
            student.id,
            feature="tutor_hint",
            now=now + timedelta(minutes=10),
        )

    assert exc.value.status_code == 429
    assert "今日 AI 使用额度已达上限" in exc.value.detail
    stored_count = await db_session.scalar(
        select(func.count()).select_from(StudentAiUsageLog).where(StudentAiUsageLog.student_id == student.id)
    )
    assert stored_count == 20






@pytest.mark.asyncio
async def test_student_ai_usage_blocks_short_bursts_before_daily_limit(db_session):
    student_svc = StudentService(db_session)
    student = await student_svc.create_student("ai_burst_user", "school-pass", "高频学生")
    usage_svc = StudentAiUsageService(db_session, per_minute_limit=2)
    now = datetime(2026, 6, 21, 1, 0, tzinfo=timezone.utc)

    await usage_svc.ensure_ai_call_allowed(student.id, feature="learn_chat", now=now)
    await usage_svc.record_successful_ai_call(student.id, feature="learn_chat", now=now)
    await usage_svc.ensure_ai_call_allowed(student.id, feature="learn_chat", now=now + timedelta(seconds=10))
    await usage_svc.record_successful_ai_call(
        student.id, feature="learn_chat", now=now + timedelta(seconds=10)
    )

    with pytest.raises(HTTPException) as exc:
        await usage_svc.ensure_ai_call_allowed(student.id, feature="learn_chat", now=now + timedelta(seconds=20))

    assert exc.value.status_code == 429
    assert "AI 请求过于频繁" in exc.value.detail

    usage = await usage_svc.ensure_ai_call_allowed(
        student.id,
        feature="learn_chat",
        now=now + timedelta(seconds=61),
    )
    assert usage["used"] == 2


@pytest.mark.asyncio
async def test_failed_ai_call_check_does_not_consume_quota(db_session):
    student_svc = StudentService(db_session)
    student = await student_svc.create_student("ai_failed_user", "school-pass", "失败调用学生")
    usage_svc = StudentAiUsageService(db_session, per_minute_limit=2)
    now = datetime(2026, 6, 21, 1, 0, tzinfo=timezone.utc)

    first = await usage_svc.ensure_ai_call_allowed(student.id, feature="learn_chat", now=now)
    second = await usage_svc.ensure_ai_call_allowed(
        student.id, feature="learn_chat", now=now + timedelta(seconds=10)
    )
    stored_count = await db_session.scalar(
        select(func.count()).select_from(StudentAiUsageLog).where(
            StudentAiUsageLog.student_id == student.id
        )
    )

    assert first["used"] == 0
    assert second["used"] == 0
    assert stored_count == 0
