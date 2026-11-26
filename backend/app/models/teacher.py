"""Teacher accounts, the classes they teach and the papers they set.

Teachers are created by the administrator and only see students in their classes.
"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base

CLASS_LEVELS = ("advanced", "standard", "foundation")


class Teacher(Base):
    __tablename__ = "teachers"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    username: Mapped[str] = mapped_column(Text, unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, default="active", server_default="active", nullable=False)
    must_change_password: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true", nullable=False,
    )
    # Bumped on password change, reset or disable so earlier tokens stop working.
    auth_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TeacherClass(Base):
    __tablename__ = "teacher_classes"
    __table_args__ = (UniqueConstraint("teacher_id", "name", name="uq_teacher_class_name"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    teacher_id: Mapped[str] = mapped_column(
        Text, ForeignKey("teachers.id", ondelete="CASCADE"), index=True, nullable=False,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    grade: Mapped[str | None] = mapped_column(Text)
    level: Mapped[str] = mapped_column(Text, default="standard", server_default="standard", nullable=False)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TeacherClassMember(Base):
    __tablename__ = "teacher_class_members"
    __table_args__ = (
        Index("ix_teacher_class_members_student", "student_id"),
        Index("uq_teacher_class_member_number", "class_id", "student_number", unique=True,
              postgresql_where=text("student_number IS NOT NULL")),
    )

    class_id: Mapped[str] = mapped_column(
        Text, ForeignKey("teacher_classes.id", ondelete="CASCADE"), primary_key=True,
    )
    student_id: Mapped[str] = mapped_column(
        Text, ForeignKey("students.id", ondelete="CASCADE"), primary_key=True,
    )
    # The number students write on paper homework so a scan can be matched to them.
    student_number: Mapped[str | None] = mapped_column(Text)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TeacherClassInvitation(Base):
    __tablename__ = "teacher_class_invitations"

    class_id: Mapped[str] = mapped_column(Text, ForeignKey("teacher_classes.id", ondelete="CASCADE"), primary_key=True)
    code_hash: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    encrypted_code: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class TeacherClassMembershipEvent(Base):
    __tablename__ = "teacher_class_membership_events"
    __table_args__ = (Index("ix_class_membership_events_student", "class_id", "student_id", "occurred_at"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    class_id: Mapped[str] = mapped_column(Text, ForeignKey("teacher_classes.id", ondelete="CASCADE"), nullable=False)
    student_id: Mapped[str] = mapped_column(Text, ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    action: Mapped[str] = mapped_column(Text, nullable=False)
    invitation_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    disclosure_version: Mapped[str | None] = mapped_column(Text)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class TeacherAssignment(Base):
    """A paper a teacher sets for one class. Items are editable only while drafting;
    publishing freezes them together with a snapshot of each question."""

    __tablename__ = "teacher_assignments"
    __table_args__ = (Index("ix_teacher_assignments_class_created", "class_id", "created_at"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    teacher_id: Mapped[str] = mapped_column(
        Text, ForeignKey("teachers.id", ondelete="CASCADE"), index=True, nullable=False,
    )
    # None: the teacher's own paper (a test) or settings (a personalized homework), not tied to a
    # class. Assigning it creates one row per class with source_id pointing back here.
    class_id: Mapped[str | None] = mapped_column(
        Text, ForeignKey("teacher_classes.id", ondelete="CASCADE"), nullable=True,
    )
    source_id: Mapped[str | None] = mapped_column(
        Text, ForeignKey("teacher_assignments.id", ondelete="SET NULL"), index=True,
    )
    # test: one paper for the whole class; personalized: one paper per student (TeacherStudentPaper).
    kind: Mapped[str] = mapped_column(Text, default="test", server_default="test", nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, default="draft", server_default="draft", nullable=False)
    # [{"question_id", "points", "box"}] in paper order.
    items: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]", nullable=False)
    question_snapshot: Mapped[list | None] = mapped_column(JSONB)
    # Personalized homework: the drafting scope and question counts the teacher chose.
    settings: Mapped[dict | None] = mapped_column(JSONB)
    # {student_id: student number or None} as the class stood when the homework went out:
    # scans are matched by these numbers, whatever the roster says later.
    roster: Mapped[dict | None] = mapped_column(JSONB)
    # {question_id: approved rubric parts or None}, frozen when grading begins.
    rubric_snapshot: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Set once, when reviewed scores are locked and written into students' mastery.
    results_released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Removed from active management; retain frozen work and learning evidence.
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class TeacherStudentPaper(Base):
    """One student's own paper in a personalized homework, drafted from their answers
    and reviewed by the teacher. Publishing freezes the items with a question snapshot."""

    __tablename__ = "teacher_student_papers"
    __table_args__ = (
        UniqueConstraint("assignment_id", "student_id", name="uq_student_paper_assignment_student"),
        Index("ix_teacher_student_papers_student", "student_id"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    assignment_id: Mapped[str] = mapped_column(
        Text, ForeignKey("teacher_assignments.id", ondelete="CASCADE"), nullable=False,
    )
    student_id: Mapped[str] = mapped_column(Text, ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    # [{"question_id", "points", "box", "area_mm", "print_layout", "rule", "reason"}] in paper order.
    items: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]", nullable=False)
    question_snapshot: Mapped[list | None] = mapped_column(JSONB)
    # app: answered in the student app; paper: printed and scanned.
    delivery: Mapped[str] = mapped_column(Text, default="paper", server_default="paper", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
