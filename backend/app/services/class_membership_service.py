"""Invitation acceptance uses the authenticated student and the existing class relation."""
import base64
import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select

from app.core.config import settings
from app.models.student import Student
from app.models.teacher import Teacher, TeacherClass, TeacherClassMember, TeacherClassInvitation, TeacherClassMembershipEvent
from app.services.teacher_service import TeacherServiceError

ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
DISCLOSURE_VERSION = "class-learning-sharing-2026-10-28"
DISCLOSURE = ("加入后，本班老师可查看你入班以来的练习记录（含答题图片）、作业成绩、错因，以及知识点掌握情况，"
              "用于安排教学和练习；入班前的练习记录不向老师展示。你填写的真实姓名会显示给老师，可随时修改。"
              "退出或班级归档后停止共享当前学情，已发布的作业与成绩保留。加入班级不会自动授权第三方 AI 处理。")


def _digest(code):
    return hmac.new(settings.teacher_auth_secret.encode(), f"class-invite:{code}".encode(), hashlib.sha256).hexdigest()


def _cipher():
    key = hashlib.sha256(f"class-invite-encryption:{settings.teacher_auth_secret}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def _invalid():
    return TeacherServiceError(400, "邀请码无效或已过期，请向老师获取新码")


class ClassMembershipService:
    def __init__(self, db):
        self.db = db

    async def locked_class(self, class_id, teacher_id=None):
        stmt = select(TeacherClass).where(TeacherClass.id == class_id)
        if teacher_id is not None:
            stmt = stmt.where(TeacherClass.teacher_id == teacher_id)
        row = await self.db.scalar(stmt.with_for_update().execution_options(populate_existing=True))
        if not row:
            raise TeacherServiceError(404, "班级不存在")
        return row

    async def invitation(self, class_id, teacher_id):
        cls = await self.locked_class(class_id, teacher_id)
        invitation = await self.db.get(TeacherClassInvitation, class_id, populate_existing=True)
        code = None
        if invitation and invitation.enabled and not cls.archived_at and invitation.expires_at > datetime.now(timezone.utc):
            try:
                code = _cipher().decrypt(invitation.encrypted_code.encode()).decode()
            except InvalidToken:
                pass  # A rotated server secret requires a fresh invitation.
        return {"code": code, "enabled": code is not None, "expires_at": invitation.expires_at if invitation else None}

    async def generate(self, class_id, teacher_id):
        cls = await self.locked_class(class_id, teacher_id)
        if cls.archived_at:
            raise TeacherServiceError(409, "归档班级不能邀请学生")
        invitation = await self.db.get(TeacherClassInvitation, class_id, populate_existing=True)
        # Check uniqueness inside the same transaction; the database also enforces it.
        while True:
            code = "".join(secrets.choice(ALPHABET) for _ in range(8))
            digest = _digest(code)
            if not await self.db.scalar(select(TeacherClassInvitation.class_id).where(TeacherClassInvitation.code_hash == digest)):
                break
        values = dict(code_hash=digest, encrypted_code=_cipher().encrypt(code.encode()).decode(),
                      enabled=True, expires_at=datetime.now(timezone.utc) + timedelta(days=3))
        if invitation:
            invitation.version += 1
            for key, value in values.items():
                setattr(invitation, key, value)
        else:
            self.db.add(TeacherClassInvitation(class_id=class_id, version=1, **values))
        await self.db.commit()
        return {"code": code, "enabled": True, "expires_at": values["expires_at"]}

    async def disable(self, class_id, teacher_id):
        await self.locked_class(class_id, teacher_id)
        invitation = await self.db.get(TeacherClassInvitation, class_id, populate_existing=True)
        if invitation:
            invitation.enabled = False
        await self.db.commit()
        return {"code": None, "enabled": False, "expires_at": invitation.expires_at if invitation else None}

    async def _resolve(self, raw):
        code = raw.strip().upper()
        if len(code) != 8 or any(c not in ALPHABET for c in code):
            raise _invalid()
        digest = _digest(code)
        class_id = await self.db.scalar(select(TeacherClassInvitation.class_id).where(TeacherClassInvitation.code_hash == digest))
        if not class_id:
            raise _invalid()
        cls = await self.locked_class(class_id)
        invite = await self.db.get(TeacherClassInvitation, class_id, populate_existing=True)
        teacher = await self.db.scalar(select(Teacher).where(Teacher.id == cls.teacher_id).with_for_update(read=True).execution_options(populate_existing=True))
        if (not invite or invite.code_hash != digest or not invite.enabled or invite.expires_at <= datetime.now(timezone.utc)
                or cls.archived_at or not teacher or teacher.status != "active" or teacher.must_change_password):
            raise _invalid()
        return cls, teacher, invite

    async def _eligible(self, cls, invite, student_id):
        member = await self.db.get(TeacherClassMember, (cls.id, student_id), populate_existing=True)
        if member:
            return member
        removed_version = await self.db.scalar(select(TeacherClassMembershipEvent.invitation_version).where(
            TeacherClassMembershipEvent.class_id == cls.id, TeacherClassMembershipEvent.student_id == student_id,
            TeacherClassMembershipEvent.action == "removed",
        ).order_by(TeacherClassMembershipEvent.invitation_version.desc()).limit(1))
        if removed_version is not None and invite.version <= removed_version:
            raise TeacherServiceError(403, "你已被移出该班级，请联系老师获取重新生成的邀请码")
        return None

    @staticmethod
    def summary(cls, teacher, member=None):
        return {"id": cls.id, "name": cls.name, "grade": cls.grade, "teacher_name": teacher.display_name,
                "student_number": member.student_number if member else None,
                "archived": cls.archived_at is not None, "teacher_active": teacher.status == "active"}

    async def preview(self, code, student_id):
        cls, teacher, invite = await self._resolve(code)
        member = await self._eligible(cls, invite, student_id)
        return {**self.summary(cls, teacher, member), "already_joined": member is not None,
                "disclosure_version": DISCLOSURE_VERSION, "disclosure": DISCLOSURE}

    async def public_preview(self, code):
        """Before signing in: which class and teacher, and what joining shares. No membership facts."""
        cls, teacher, _ = await self._resolve(code)
        found = {"id": cls.id, "name": cls.name, "grade": cls.grade, "teacher_name": teacher.display_name,
                 "disclosure_version": DISCLOSURE_VERSION, "disclosure": DISCLOSURE}
        await self.db.rollback()  # release the row locks taken while resolving
        return found

    async def check_code(self, code):
        """Raise unless the code is a live invitation; used before a code may open registration."""
        await self._resolve(code)
        await self.db.rollback()

    @staticmethod
    def clean_name(student_name):
        name = (student_name or "").strip()
        if not name or len(name) > 40 or not name.isprintable():
            raise TeacherServiceError(400, "请填写学生真实姓名（1—40字）")
        return name

    async def join(self, code, student_id, disclosure_version, student_name=None):
        if disclosure_version != DISCLOSURE_VERSION:
            raise TeacherServiceError(409, "入班说明已更新，请重新查看班级后加入")
        name = self.clean_name(student_name)
        cls, teacher, invite = await self._resolve(code)
        # Match the account erasure guard: no writes can race a disabled/erased account.
        student = await self.db.scalar(select(Student).where(Student.id == student_id).with_for_update().execution_options(populate_existing=True))
        if not student or student.status != "active":
            raise TeacherServiceError(401, "学生账号不可用")
        member = await self._eligible(cls, invite, student_id)
        added = member is None
        if added:
            numbers = set((await self.db.scalars(select(TeacherClassMember.student_number).where(TeacherClassMember.class_id == cls.id))).all())
            number = next((str(i) for i in range(1, 10000) if str(i) not in numbers), None)
            if number is None:
                raise TeacherServiceError(409, "班级学号已用完，请联系老师")
            member = TeacherClassMember(class_id=cls.id, student_id=student_id, student_number=number,
                                        added_at=datetime.now(timezone.utc))
            self.db.add(member)
            self.event(cls.id, student_id, "joined", invite.version, DISCLOSURE_VERSION)
        # Bind the classroom name to the authenticated identity, never find/merge
        # an account by name or replace any existing answer/mastery ownership.
        student.display_name = name
        await self.db.commit()
        return {**self.summary(cls, teacher, member), "added": added, "student_name": student.display_name}

    async def rename(self, student_id, student_name):
        """The student corrects the real name their teachers see; each class keeps a record of it."""
        name = self.clean_name(student_name)
        student = await self.db.scalar(select(Student).where(Student.id == student_id).with_for_update()
                                       .execution_options(populate_existing=True))
        if not student or student.status != "active":
            raise TeacherServiceError(401, "学生账号不可用")
        class_ids = (await self.db.scalars(select(TeacherClassMember.class_id).where(
            TeacherClassMember.student_id == student_id))).all()
        if not class_ids:
            raise TeacherServiceError(409, "加入班级后才需要填写学生姓名")
        if name != student.display_name:
            student.display_name = name
            for class_id in class_ids:
                self.event(class_id, student_id, "renamed")
        await self.db.commit()
        return {"student_name": name}

    async def classes(self, student_id):
        rows = (await self.db.execute(select(TeacherClass, Teacher, TeacherClassMember)
            .join(Teacher, Teacher.id == TeacherClass.teacher_id)
            .join(TeacherClassMember, TeacherClassMember.class_id == TeacherClass.id)
            .where(TeacherClassMember.student_id == student_id).order_by(TeacherClassMember.added_at.desc()))).all()
        return [self.summary(cls, teacher, member) for cls, teacher, member in rows]

    def event(self, class_id, student_id, action, invitation_version=0, disclosure_version=None):
        self.db.add(TeacherClassMembershipEvent(id=str(uuid.uuid4()), class_id=class_id, student_id=student_id,
            action=action, invitation_version=invitation_version, disclosure_version=disclosure_version,
            occurred_at=datetime.now(timezone.utc)))

    async def remove(self, class_id, student_id, *, teacher_id=None, student_leave=False):
        await self.locked_class(class_id, teacher_id)
        member = await self.db.get(TeacherClassMember, (class_id, student_id), populate_existing=True)
        if not member:
            raise TeacherServiceError(404, "该学生不在班级中")
        invite = await self.db.get(TeacherClassInvitation, class_id)
        # An admin removal is also a removal, not a student-initiated departure.
        self.event(class_id, student_id, "left" if student_leave else "removed", invite.version if invite else 0)
        await self.db.delete(member)
        await self.db.commit()
