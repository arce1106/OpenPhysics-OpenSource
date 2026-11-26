"""Authenticated username and password settings for self-hosted accounts."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.models.student import Student, StudentUsernameChange, StudentWebLoginTicket
from app.services.student_service import StudentService
from app.services.username_policy import valid_username

USERNAME_CHANGE_LIMIT = 3
USERNAME_CHANGE_WINDOW_DAYS = 365


class AccountSecurityService:
    def __init__(self, students: StudentService):
        self.students = students
        self.db = students.db

    async def _finish_change(self, student, renew_session):
        # Snapshot the new version while holding the account lock. Never mint a
        # token by reloading after commit: a concurrent reset may have revoked it.
        await self.db.flush()
        result = None
        if renew_session:
            await self.db.refresh(student)
            result = {"changed": True,
                      "access_token": self.students.create_access_token(student.id, student.auth_version),
                      "token_type": "bearer", "student": self.students.serialize_student(student),
                      "settings": await self.credential_settings(student)}
        await self.db.commit()
        return result

    async def _account(self, *, student_id: str, token: str):
        if self.students.decode_access_token(token) != student_id:
            return None
        statement = select(Student).where(Student.status == "active")
        statement = statement.where(Student.id == student_id)
        student = await self.db.scalar(statement.with_for_update().execution_options(populate_existing=True))
        if student is None or not self.students.token_matches_auth_version(token, student):
            return None
        return student


    async def username_quota(self, student_id: str, *, now: datetime | None = None):
        now = now or datetime.now(timezone.utc)
        changes = list(await self.db.scalars(select(StudentUsernameChange.changed_at).where(
            StudentUsernameChange.student_id == student_id,
            StudentUsernameChange.changed_at > now - timedelta(days=USERNAME_CHANGE_WINDOW_DAYS),
        ).order_by(StudentUsernameChange.changed_at.desc()).limit(USERNAME_CHANGE_LIMIT)))
        remaining = max(0, USERNAME_CHANGE_LIMIT - len(changes))
        return {"username_change_limit": USERNAME_CHANGE_LIMIT,
                "username_change_window_days": USERNAME_CHANGE_WINDOW_DAYS,
                "username_changes_remaining": remaining,
                "username_next_change_at": (changes[-1] + timedelta(days=USERNAME_CHANGE_WINDOW_DAYS)).isoformat()
                    if not remaining else None}

    async def credential_settings(self, student: Student):
        phone = student.phone
        return {"username": student.username,
                "masked_phone": f"{phone[:3]}****{phone[-4:]}" if phone else None,
                "has_password": bool(student.password_hash and not student.password_hash.startswith("!")),
                **await self.username_quota(student.id)}

    async def set_credentials(self, student_id: str, token: str, username: str | None,
                              password: str | None = None,
                              *, current_password: str | None = None, renew_session=False):
        if password is not None and (len(password.strip()) < 6 or len(password) > 128):
            return "invalid_password"
        student = await self._account(student_id=student_id, token=token)
        if not student:
            await self.db.rollback()
            return "account_unavailable"
        username = student.username if username is None else username.strip()
        # Existing account names remain valid; changes follow the public username policy.
        if username != student.username and not valid_username(username):
            await self.db.rollback()
            return "invalid_username"
        renamed = username != student.username
        if not renamed and password is None:
            await self.db.rollback()
            return "no_changes"
        if password is not None and not self.students.verify_password(current_password or "", student.password_hash):
            await self.db.rollback()
            return "invalid_current_password"
        # A username-only edit needs the locked, active account/session above,
        # not another password proof. Adding a password still takes the checks
        # above, even when the same request also renames the account.
        now = datetime.now(timezone.utc)
        if renamed and not (await self.username_quota(student_id, now=now))["username_changes_remaining"]:
            await self.db.rollback()
            return "username_change_limit"
        if await self.db.scalar(select(Student.id).where(Student.username == username, Student.id != student.id)):
            await self.db.rollback()
            return "username_taken"
        # Follow a system-default display name, but preserve every custom name.
        if renamed and student.display_name == student.username:
            student.display_name = username
        student.username = username
        if renamed:
            self.db.add(StudentUsernameChange(student_id=student.id, changed_at=now))
        try:
            if password is not None:
                if not await self.students._rotate_student_credentials(student, password, expected_auth_version=student.auth_version):
                    await self.db.rollback()
                    return "account_unavailable"
            else:
                student.auth_version += 1
                await self.db.execute(delete(StudentWebLoginTicket).where(StudentWebLoginTicket.student_id == student.id))
            return await self._finish_change(student, renew_session)
        except IntegrityError:
            await self.db.rollback()
            return "username_taken"
