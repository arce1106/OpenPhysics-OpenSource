from datetime import datetime, timedelta, timezone

import pytest

from app.models.student import StudentWebLoginTicket
from app.services.student_service import StudentService


@pytest.mark.asyncio
async def test_student_web_login_ticket_is_single_use(db_session):
    svc = StudentService(db_session)
    student = await svc.create_student("android_user", "student-pass", "安卓学生")

    ticket, _ = await svc.create_web_login_ticket(student.id)
    exchanged = await svc.consume_web_login_ticket(ticket)
    reused = await svc.consume_web_login_ticket(ticket)

    assert exchanged is not None
    assert exchanged.id == student.id
    assert reused is None


@pytest.mark.asyncio
async def test_student_web_login_ticket_rejects_expired_ticket(db_session):
    svc = StudentService(db_session)
    student = await svc.create_student("expired_ticket_user", "student-pass", "过期学生")

    ticket, _ = await svc.create_web_login_ticket(student.id)
    stored = await db_session.get(StudentWebLoginTicket, svc.hash_web_login_ticket(ticket))
    assert stored is not None
    stored.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    await db_session.commit()

    assert await svc.consume_web_login_ticket(ticket) is None
