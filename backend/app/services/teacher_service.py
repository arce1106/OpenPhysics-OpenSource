"""Teacher accounts, classes and membership.

Administrators create teachers and classes; students can accept a teacher's invitation.
Teachers only ever reach students through a class
they own.
"""
import re
import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.student import Student
from app.models.teacher import CLASS_LEVELS, Teacher, TeacherAssignment, TeacherClass, TeacherClassMember
from app.services.teacher_auth_service import TeacherAuthService, TeacherTokenClaims

TEACHER_STATUSES = ("active", "disabled")
MAX_NUMBER_DIGITS = 4


PHONE_LIKE = re.compile(r"1[3-9][0-9]{9}")


def mask_phone(text: str | None) -> str | None:
    """Older self-registered accounts used the phone number as their account name (and often as
    their display name). Teachers never see it whole."""
    if text and PHONE_LIKE.fullmatch(text.strip()):
        value = text.strip()
        return f"{value[:3]}****{value[-4:]}"
    return text


class TeacherServiceError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _clean(value: str | None, field: str, *, max_length: int = 32, required: bool = True) -> str | None:
    text = (value or "").strip()
    if not text:
        if required:
            raise TeacherServiceError(400, f"{field}不能为空")
        return None
    if len(text) > max_length:
        raise TeacherServiceError(400, f"{field}不能超过 {max_length} 个字符")
    return text


def _check_password(password: str) -> None:
    problem = TeacherAuthService.password_problem(password)
    if problem:
        raise TeacherServiceError(400, problem)


def _check_level(level: str) -> str:
    if level not in CLASS_LEVELS:
        raise TeacherServiceError(400, f"班级层次只能是 {', '.join(CLASS_LEVELS)}")
    return level


class TeacherService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # --- Accounts ---

    async def create_teacher(self, username: str, display_name: str, password: str) -> Teacher:
        username = _clean(username, "用户名")
        if any(ch.isspace() for ch in username):
            raise TeacherServiceError(400, "用户名不能包含空格")
        _check_password(password)
        if await self._teacher_by_username(username):
            raise TeacherServiceError(409, "该教师用户名已存在")
        teacher = Teacher(
            id=f"t_{uuid.uuid4().hex}",
            username=username,
            password_hash=TeacherAuthService.hash_password(password),
            display_name=_clean(display_name, "姓名"),
            must_change_password=True,
        )
        self.db.add(teacher)
        await self.db.commit()
        await self.db.refresh(teacher)
        return teacher

    async def list_teachers(self) -> list[Teacher]:
        result = await self.db.execute(select(Teacher).order_by(Teacher.created_at, Teacher.username))
        return list(result.scalars().all())

    async def get_teacher(self, teacher_id: str) -> Teacher:
        teacher = await self.db.get(Teacher, teacher_id)
        if not teacher:
            raise TeacherServiceError(404, "教师不存在")
        return teacher

    async def update_teacher(
        self, teacher_id: str, *, display_name: str | None = None, status: str | None = None,
    ) -> Teacher:
        teacher = await self.get_teacher(teacher_id)
        if display_name is not None:
            teacher.display_name = _clean(display_name, "姓名")
        if status is not None and status != teacher.status:
            if status not in TEACHER_STATUSES:
                raise TeacherServiceError(400, "状态只能是 active 或 disabled")
            teacher.status = status
            teacher.auth_version += 1
        await self.db.commit()
        await self.db.refresh(teacher)
        return teacher

    async def reset_password(self, teacher_id: str, password: str) -> Teacher:
        teacher = await self.get_teacher(teacher_id)
        _check_password(password)
        teacher.password_hash = TeacherAuthService.hash_password(password)
        teacher.must_change_password = True
        teacher.auth_version += 1
        await self.db.commit()
        await self.db.refresh(teacher)
        return teacher

    async def authenticate(self, username: str, password: str) -> Teacher | None:
        teacher = await self._teacher_by_username(username.strip())
        if not teacher or teacher.status != "active":
            return None
        if not TeacherAuthService.verify_password(password, teacher.password_hash):
            return None
        teacher.last_login_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(teacher)
        return teacher

    async def teacher_for_token(self, claims: TeacherTokenClaims) -> Teacher | None:
        teacher = await self.db.get(Teacher, claims.teacher_id)
        if not teacher or teacher.status != "active" or teacher.auth_version != claims.auth_version:
            return None
        return teacher

    async def change_password(self, teacher: Teacher, current_password: str, new_password: str) -> Teacher:
        if not TeacherAuthService.verify_password(current_password, teacher.password_hash):
            raise TeacherServiceError(400, "当前密码不正确")
        if current_password == new_password:
            raise TeacherServiceError(400, "新密码不能与当前密码相同")
        _check_password(new_password)
        teacher.password_hash = TeacherAuthService.hash_password(new_password)
        teacher.must_change_password = False
        teacher.auth_version += 1
        await self.db.commit()
        await self.db.refresh(teacher)
        return teacher

    async def _teacher_by_username(self, username: str) -> Teacher | None:
        result = await self.db.execute(select(Teacher).where(Teacher.username == username))
        return result.scalar_one_or_none()

    # --- Classes ---

    async def create_class(
        self, teacher_id: str, name: str, grade: str | None = None, level: str = "standard",
    ) -> TeacherClass:
        await self.get_teacher(teacher_id)
        name = _clean(name, "班级名称")
        if await self._class_by_name(teacher_id, name):
            raise TeacherServiceError(409, "该教师已有同名班级")
        teacher_class = TeacherClass(
            id=f"c_{uuid.uuid4().hex}",
            teacher_id=teacher_id,
            name=name,
            grade=_clean(grade, "年级", required=False),
            level=_check_level(level),
        )
        self.db.add(teacher_class)
        await self.db.commit()
        await self.db.refresh(teacher_class)
        return teacher_class

    async def update_class(
        self,
        class_id: str,
        *,
        name: str | None = None,
        grade: str | None = None,
        level: str | None = None,
        archived: bool | None = None,
    ) -> TeacherClass:
        teacher_class = await self.get_class(class_id)
        if name is not None:
            name = _clean(name, "班级名称")
            existing = await self._class_by_name(teacher_class.teacher_id, name)
            if existing and existing.id != teacher_class.id:
                raise TeacherServiceError(409, "该教师已有同名班级")
            teacher_class.name = name
        if grade is not None:
            teacher_class.grade = _clean(grade, "年级", required=False)
        if level is not None:
            teacher_class.level = _check_level(level)
        if archived is not None:
            teacher_class.archived_at = datetime.now(timezone.utc) if archived else None
        await self.db.commit()
        await self.db.refresh(teacher_class)
        return teacher_class

    async def get_class(self, class_id: str) -> TeacherClass:
        teacher_class = await self.db.get(TeacherClass, class_id)
        if not teacher_class:
            raise TeacherServiceError(404, "班级不存在")
        return teacher_class

    async def get_owned_class(self, teacher_id: str, class_id: str) -> TeacherClass:
        """Another teacher's class is reported as missing, not forbidden."""
        teacher_class = await self.db.get(TeacherClass, class_id)
        if not teacher_class or teacher_class.teacher_id != teacher_id:
            raise TeacherServiceError(404, "班级不存在")
        return teacher_class

    async def list_classes(self, teacher_ids: list[str], *, include_archived: bool = True) -> list[TeacherClass]:
        if not teacher_ids:
            return []
        query = select(TeacherClass).where(TeacherClass.teacher_id.in_(teacher_ids))
        if not include_archived:
            query = query.where(TeacherClass.archived_at.is_(None))
        result = await self.db.execute(query.order_by(TeacherClass.created_at, TeacherClass.name))
        return list(result.scalars().all())

    async def member_counts(self, class_ids: list[str]) -> dict[str, int]:
        if not class_ids:
            return {}
        result = await self.db.execute(
            select(TeacherClassMember.class_id, func.count())
            .join(Student, Student.id == TeacherClassMember.student_id)
            .where(TeacherClassMember.class_id.in_(class_ids), Student.status != "deleted")
            .group_by(TeacherClassMember.class_id)
        )
        return {class_id: count for class_id, count in result.all()}

    async def _class_by_name(self, teacher_id: str, name: str) -> TeacherClass | None:
        result = await self.db.execute(
            select(TeacherClass).where(TeacherClass.teacher_id == teacher_id, TeacherClass.name == name)
        )
        return result.scalar_one_or_none()

    # --- Membership ---

    async def list_members(self, class_id: str) -> list[Student]:
        result = await self.db.execute(
            select(Student)
            .join(TeacherClassMember, TeacherClassMember.student_id == Student.id)
            .where(TeacherClassMember.class_id == class_id, Student.status != "deleted")
            .order_by(Student.display_name, Student.username)
        )
        return list(result.scalars().all())

    async def add_member(self, class_id: str, username: str, *, grantor: str = "school",
                         recorded_by: str | None = None) -> tuple[Student, bool]:
        """Place an existing active student account into a class on a school's or guardian's
        authorization, recorded like an invitation acceptance. Repeats are no-ops."""
        from app.services.class_membership_service import ClassMembershipService
        if grantor not in {"school", "guardian"}:
            raise TeacherServiceError(400, "请选择授权方：学校或监护人")
        memberships = ClassMembershipService(self.db)
        await memberships.locked_class(class_id)
        username = _clean(username, "学生用户名", max_length=64)
        result = await self.db.execute(select(Student).where(Student.username == username))
        student = result.scalar_one_or_none()
        if not student or student.status == "deleted":
            raise TeacherServiceError(404, "没有这个学生账号")
        if student.status != "active":
            raise TeacherServiceError(400, "该学生账号已停用，不能加入班级")
        numbers = set((await self.db.scalars(select(TeacherClassMember.student_number).where(
            TeacherClassMember.class_id == class_id))).all())
        number = next((str(i) for i in range(1, 10000) if str(i) not in numbers), None)
        inserted = await self.db.execute(
            insert(TeacherClassMember)
            .values(class_id=class_id, student_id=student.id, student_number=number)
            .on_conflict_do_nothing(index_elements=["class_id", "student_id"])
        )
        if inserted.rowcount:
            memberships.event(class_id, student.id, "admin_added",
                              disclosure_version=f"admin:{grantor}:{recorded_by or 'admin'}")
        await self.db.commit()
        return student, bool(inserted.rowcount)

    async def membership_facts(self, class_id: str) -> dict[str, dict]:
        """How each current member came in, and when."""
        from app.models.teacher import TeacherClassMembershipEvent
        joined = {}
        rows = (await self.db.execute(
            select(TeacherClassMembershipEvent.student_id, TeacherClassMembershipEvent.action)
            .where(TeacherClassMembershipEvent.class_id == class_id,
                   TeacherClassMembershipEvent.action.in_(["joined", "admin_added"]))
            .order_by(TeacherClassMembershipEvent.occurred_at)
        )).all()
        for student_id, action in rows:
            joined[student_id] = "invitation" if action == "joined" else "admin"
        added = dict((await self.db.execute(select(TeacherClassMember.student_id, TeacherClassMember.added_at)
                                            .where(TeacherClassMember.class_id == class_id))).all())
        return {student_id: {"joined_via": joined.get(student_id), "joined_at": when}
                for student_id, when in added.items()}

    async def assignment_members(self, assignment: TeacherAssignment, *, historical: bool = False) -> list[Student]:
        """Each assignment reaches only its chosen students, frozen at publication."""
        if historical and assignment.roster is not None and assignment.results_released_at:
            return list((await self.db.scalars(select(Student).where(
                Student.id.in_(assignment.roster), Student.status == "active",
            ))).all())
        members = await self.list_members(assignment.class_id)
        selected = (assignment.settings or {}).get("student_ids")
        if assignment.status != "draft" and assignment.roster is not None:
            selected = assignment.roster
        if selected is None:
            return members
        wanted = set(selected)
        return [student for student in members if student.id in wanted]

    @staticmethod
    def recipient_count(assignment: TeacherAssignment, class_size: int) -> int:
        if assignment.status != "draft" and assignment.roster is not None:
            return len(assignment.roster)
        selected = (assignment.settings or {}).get("student_ids")
        if selected is not None:
            return len(set(selected))
        return class_size

    async def member_numbers(self, class_id: str) -> dict[str, str | None]:
        result = await self.db.execute(
            select(TeacherClassMember.student_id, TeacherClassMember.student_number)
            .where(TeacherClassMember.class_id == class_id)
        )
        return dict(result.all())

    async def roster_snapshot(self, class_id: str) -> dict[str, str | None]:
        """Every current member's number, as a homework going out now will be collected by."""
        numbers = await self.member_numbers(class_id)
        return {student.id: numbers.get(student.id) for student in await self.list_members(class_id)}

    async def set_member_number(self, class_id: str, student_id: str, number: str | None) -> None:
        """Numbers are short digit strings, unique within the class; None clears one."""
        from app.services.class_membership_service import ClassMembershipService
        await ClassMembershipService(self.db).locked_class(class_id)
        member = await self.db.get(TeacherClassMember, (class_id, student_id), populate_existing=True)
        if not member:
            raise TeacherServiceError(404, "该学生不在这个班级")
        number = (number or "").strip() or None
        if number is not None:
            if not number.isdigit() or len(number) > MAX_NUMBER_DIGITS:
                raise TeacherServiceError(400, f"学号只能是 1 到 {MAX_NUMBER_DIGITS} 位数字")
            number = number.lstrip("0") or "0"
            taken = await self.db.execute(
                select(TeacherClassMember.student_id).where(
                    TeacherClassMember.class_id == class_id,
                    TeacherClassMember.student_number == number,
                    TeacherClassMember.student_id != student_id,
                )
            )
            if taken.first():
                raise TeacherServiceError(409, f"学号 {number} 已被本班其他学生使用")
        member.student_number = number
        await self.db.commit()

    async def auto_number(self, class_id: str) -> int:
        """Give members without a number the next free numbers, in roster order."""
        from app.services.class_membership_service import ClassMembershipService
        await ClassMembershipService(self.db).locked_class(class_id)
        numbers = await self.member_numbers(class_id)
        used = {int(value) for value in numbers.values() if value}
        assigned = 0
        candidate = 1
        for student in await self.list_members(class_id):
            if numbers.get(student.id):
                continue
            while candidate in used:
                candidate += 1
            member = await self.db.get(TeacherClassMember, (class_id, student.id))
            member.student_number = str(candidate)
            used.add(candidate)
            assigned += 1
        await self.db.commit()
        return assigned

    async def remove_member(self, class_id: str, student_id: str) -> None:
        from app.services.class_membership_service import ClassMembershipService
        await ClassMembershipService(self.db).remove(class_id, student_id)

    # --- Learning signals ---

    async def class_signals(self, class_id: str) -> dict:
        """The class statistics: learning from joining on, names masked. (The admin console's all-time
        signals are not sent: they predate joining and carried account names.)"""
        students = await self.list_members(class_id)
        from app.services.teacher_statistics_service import TeacherStatisticsService
        return {'statistics': await TeacherStatisticsService(self.db).build(class_id, students)}
