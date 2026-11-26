import pytest

from app.services.student_service import StudentService


@pytest.mark.asyncio
async def test_student_can_change_password_with_current_password(db_session):
    svc = StudentService(db_session)
    student = await svc.create_student("change_pwd", "old-pass", "change_pwd")

    changed = await svc.change_student_password("change_pwd", "old-pass", "new-pass")

    assert changed is not None
    assert changed.id == student.id
    assert StudentService.verify_password("new-pass", changed.password_hash)
    assert not StudentService.verify_password("old-pass", changed.password_hash)


@pytest.mark.asyncio
async def test_student_cannot_change_password_with_wrong_current_password(db_session):
    svc = StudentService(db_session)
    student = await svc.create_student("change_pwd_wrong", "old-pass", "change_pwd_wrong")

    changed = await svc.change_student_password("change_pwd_wrong", "wrong-pass", "new-pass")
    unchanged = await svc.get_student(student.id)

    assert changed is None
    assert unchanged is not None
    assert StudentService.verify_password("old-pass", unchanged.password_hash)
