from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.models.student import (
    GradingOutcome,
    StudentAiUsageLog,
    StudentCaptchaChallenge,
    StudentWebLoginTicket,
)
from app.services.data_retention_service import cleanup_expired_student_data
from app.services.student_service import StudentService


@pytest.mark.asyncio
async def test_cleanup_removes_only_records_older_than_retention_window(db_session, monkeypatch):
    from app.services import data_retention_service

    now = datetime(2026, 7, 10, tzinfo=timezone.utc)
    monkeypatch.setattr(data_retention_service.settings, "ephemeral_auth_retention_days", 7)
    monkeypatch.setattr(data_retention_service.settings, "ai_usage_retention_days", 90)
    student = await StudentService(db_session).create_student(
        "retention_student", "school-pass", "保留期学生"
    )
    old = now - timedelta(days=100)
    recent = now - timedelta(days=1)
    db_session.add_all([
        StudentCaptchaChallenge(id="old-captcha", answer_hash="x", expires_at=old),
        StudentCaptchaChallenge(id="recent-captcha", answer_hash="x", expires_at=recent),
        StudentWebLoginTicket(ticket_hash="old-ticket", student_id=student.id, expires_at=old),
        StudentWebLoginTicket(ticket_hash="recent-ticket", student_id=student.id, expires_at=recent),
        StudentAiUsageLog(student_id=student.id, feature="old", created_at=old),
        StudentAiUsageLog(student_id=student.id, feature="recent", created_at=recent),
        GradingOutcome(source="photo", outcome="unrecognized", created_at=old),
        GradingOutcome(source="photo", outcome="graded", created_at=recent),
    ])
    await db_session.commit()

    deleted = await cleanup_expired_student_data(db_session, now=now)

    assert deleted == {
        "ai_execution_results": 0,
        "captcha_challenges": 1,
        "web_login_tickets": 1,
        "ai_usage_logs": 1,
        "grading_outcomes": 1,
    }
    for model in (
        StudentCaptchaChallenge,
        StudentWebLoginTicket,
        StudentAiUsageLog,
        GradingOutcome,
    ):
        assert await db_session.scalar(select(func.count()).select_from(model)) == 1
