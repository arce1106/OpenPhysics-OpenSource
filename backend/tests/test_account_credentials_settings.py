"""Password-only account changes preserve identity, isolation and token revocation."""
from datetime import datetime, timedelta, timezone
import pytest
from sqlalchemy import select
from app.models.student import StudentUsernameChange
from app.services.account_security_service import AccountSecurityService
from app.services.student_service import StudentService

async def owner(db):
    students = StudentService(db)
    student = await students.create_student('school_student', 'old-password', '学校设置的显示名')
    return students, AccountSecurityService(students), student

def token(students, student):
    return students.create_access_token(student.id, student.auth_version)

@pytest.mark.asyncio
async def test_username_change_keeps_identity_and_custom_name_and_revokes_old_session(db_session):
    students, security, student = await owner(db_session)
    identity, old_token = student.id, token(students, student)
    result = await security.set_credentials(identity, old_token, '物理学习者', renew_session=True)
    assert result['student']['id'] == identity
    assert result['student']['display_name'] == '学校设置的显示名'
    assert result['access_token'] != old_token
    assert not students.token_matches_auth_version(old_token, student)
    assert (await security.username_quota(identity))['username_changes_remaining'] == 2

@pytest.mark.asyncio
async def test_password_change_requires_current_password_even_with_contact_phone(db_session):
    students, security, student = await owner(db_session)
    student.phone = '19999990001'
    await db_session.commit()
    old_token = token(students, student)
    before = student.password_hash
    for wrong in [None, 'wrong-password']:
        assert await security.set_credentials(student.id, old_token, None, password='new-password', current_password=wrong) == 'invalid_current_password'
        await db_session.refresh(student)
        assert student.password_hash == before
    result = await security.set_credentials(student.id, old_token, None, password='new-password', current_password='old-password', renew_session=True)
    assert result['student']['id'] == student.id
    assert await students.authenticate_student('school_student', 'new-password')
    assert not await students.authenticate_student('school_student', 'old-password')
    assert (await security.username_quota(student.id))['username_changes_remaining'] == 3

@pytest.mark.asyncio
async def test_old_or_other_account_token_cannot_change_credentials(db_session):
    students, security, student = await owner(db_session)
    other = await students.create_student('other_student', 'other-password', '其他学生')
    assert await security.set_credentials(student.id, token(students, other), 'stolen_name') == 'account_unavailable'
    await db_session.refresh(student)
    assert student.username == 'school_student'

@pytest.mark.asyncio
async def test_username_quota_does_not_block_password_change(db_session):
    students, security, student = await owner(db_session)
    for index in range(3):
        assert await security.set_credentials(student.id, token(students, student), f'physics_{index}') is None
    assert await security.set_credentials(student.id, token(students, student), 'physics_four') == 'username_change_limit'
    await db_session.refresh(student)
    assert await security.set_credentials(student.id, token(students, student), None, password='new-password', current_password='old-password') is None
    assert (await security.username_quota(student.id))['username_changes_remaining'] == 0

@pytest.mark.asyncio
async def test_duplicate_or_invalid_name_does_not_consume_quota(db_session):
    students, security, student = await owner(db_session)
    await students.create_student('existing_user', 'other-password', '已有学生')
    for name in ['12345', '一二三四五六七八九', 'bad name']:
        assert await security.set_credentials(student.id, token(students, student), name) == 'invalid_username'
        await db_session.refresh(student)
    assert await security.set_credentials(student.id, token(students, student), 'existing_user') == 'username_taken'
    await db_session.refresh(student)
    assert (await security.username_quota(student.id))['username_changes_remaining'] == 3
    assert students.verify_password('old-password', student.password_hash)
