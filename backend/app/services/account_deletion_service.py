"""Erase account-owned data and retain a non-login tombstone."""
import shutil
from datetime import datetime, timezone

from sqlalchemy import delete, inspect

from app.models import Base
from app.services.account_security_service import AccountSecurityService
from app.services.answer_file_guard import answer_file_guard


class AccountDeletionService(AccountSecurityService):
    async def erase(self, student_id: str, token: str, *, password: str | None,
                    code: str | None = None) -> bool:
        student = await self._account(student_id=student_id, token=token)
        if student is None:
            await self.db.rollback()
            return False
        if code is not None or not password or not self.students.verify_password(password, student.password_hash):
            await self.db.rollback()
            return False

        marked = False
        try:
            now = datetime.now(timezone.utc)
            student.status = "deleted"
            student.auth_version += 1
            student.username = f"deleted_{student.id}"
            student.password_hash = "!deleted"
            student.phone = None
            student.display_name = "已注销账号"
            student.class_name = student.grade = student.registration_consent = None
            student.account_source = "deleted"
            student.last_login_at = None
            await self.db.flush()

            # Remove student-owned records in reverse foreign-key order.
            # Tables without a student FK (answers, mastery, rewards, evidence) are included.
            connection = await self.db.connection()
            existing = set(await connection.run_sync(lambda sync: inspect(sync).get_table_names()))
            for table in reversed(Base.metadata.sorted_tables):
                if "student_id" in table.c and table.name in existing:
                    await self.db.execute(delete(table).where(table.c.student_id == student_id))

            with answer_file_guard(self.students.answer_upload_root, student_id, erasing=True) as marker:
                target = self.students.answer_upload_root / student_id
                if target.is_symlink():
                    target.unlink()
                elif target.exists():
                    shutil.rmtree(target) if target.is_dir() else target.unlink()
                marker.touch(mode=0o600)
                marked = True
            # Do not claim success if media cleanup failed. Retrying is safe.
            await self.db.commit()
            return True
        except Exception:
            await self.db.rollback()
            if marked:
                with answer_file_guard(self.students.answer_upload_root, student_id, erasing=True) as marker:
                    marker.unlink(missing_ok=True)
            raise
