"""Collected paper homework: uploaded scans, their pages, each student's copy, and AI metering."""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class TeacherScanBatch(Base):
    """One uploaded file; the same file uploaded twice for an assignment is one batch."""

    __tablename__ = "teacher_scan_batches"
    __table_args__ = (UniqueConstraint("assignment_id", "sha256", name="uq_scan_batch_file"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    assignment_id: Mapped[str] = mapped_column(
        Text, ForeignKey("teacher_assignments.id", ondelete="CASCADE"), index=True, nullable=False,
    )
    teacher_id: Mapped[str] = mapped_column(Text, ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False)
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    sha256: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, default="queued", server_default="queued", nullable=False)
    page_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    processed_pages: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class TeacherScanPage(Base):
    """A scanned page; first pages carry the student number, continuation pages follow them."""

    __tablename__ = "teacher_scan_pages"
    __table_args__ = (
        UniqueConstraint("batch_id", "page_index", name="uq_scan_page_index"),
        Index("ix_teacher_scan_pages_assignment", "assignment_id"),
        Index("ix_teacher_scan_pages_student", "student_id"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    batch_id: Mapped[str] = mapped_column(
        Text, ForeignKey("teacher_scan_batches.id", ondelete="CASCADE"), nullable=False,
    )
    assignment_id: Mapped[str] = mapped_column(
        Text, ForeignKey("teacher_assignments.id", ondelete="CASCADE"), nullable=False,
    )
    page_index: Mapped[int] = mapped_column(Integer, nullable=False)
    # blank | first | continuation
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    copy_seq: Mapped[int | None] = mapped_column(Integer)
    student_id: Mapped[str | None] = mapped_column(Text, ForeignKey("students.id", ondelete="CASCADE"))
    image_path: Mapped[str | None] = mapped_column(Text)
    recognized_number: Mapped[str | None] = mapped_column(Text)
    number_confidence: Mapped[float | None] = mapped_column(Float)
    # ok | exception | ignored
    status: Mapped[str] = mapped_column(Text, default="ok", server_default="ok", nullable=False)
    issue: Mapped[str | None] = mapped_column(Text)
    layout: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TeacherSubmission(Base):
    """One student's collected copy of an assignment."""

    __tablename__ = "teacher_submissions"
    __table_args__ = (
        UniqueConstraint("assignment_id", "student_id", name="uq_submission_assignment_student"),
        Index("ix_teacher_submissions_student", "student_id"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    assignment_id: Mapped[str] = mapped_column(
        Text, ForeignKey("teacher_assignments.id", ondelete="CASCADE"), nullable=False,
    )
    student_id: Mapped[str] = mapped_column(Text, ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    # recognized | needs_review | manual
    status: Mapped[str] = mapped_column(Text, nullable=False)
    ai_authorized: Mapped[bool] = mapped_column(Boolean, nullable=False)
    # scan: a collected paper; app: answered in the student app (teacher_homework_service).
    source: Mapped[str] = mapped_column(Text, default="scan", server_default="scan", nullable=False)
    total_score: Mapped[float | None] = mapped_column(Float)
    graded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )


class TeacherSubmissionItem(Base):
    """One question on a collected copy: a choice answer or a cropped answer area."""

    __tablename__ = "teacher_submission_items"
    __table_args__ = (UniqueConstraint("submission_id", "number", name="uq_submission_item_number"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    submission_id: Mapped[str] = mapped_column(
        Text, ForeignKey("teacher_submissions.id", ondelete="CASCADE"), nullable=False,
    )
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    question_id: Mapped[str] = mapped_column(Text, nullable=False)
    # choice | area
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    crop_path: Mapped[str | None] = mapped_column(Text)
    recognized_answer: Mapped[str | None] = mapped_column(Text)
    confidence: Mapped[float | None] = mapped_column(Float)
    answer: Mapped[str | None] = mapped_column(Text)
    is_correct: Mapped[bool | None] = mapped_column(Boolean)
    # recognized | needs_review | manual | collected | missing | confirmed
    status: Mapped[str] = mapped_column(Text, nullable=False)
    # Grading of answer areas: ungraded | manual | needs_review | auto_passed | confirmed
    grade_status: Mapped[str | None] = mapped_column(Text)
    max_score: Mapped[float | None] = mapped_column(Float)
    score: Mapped[float | None] = mapped_column(Float)
    # [{"label", "points", "score", "reason"}]
    part_scores: Mapped[list | None] = mapped_column(JSONB)
    error_type: Mapped[str | None] = mapped_column(Text)
    first_error: Mapped[str | None] = mapped_column(Text)
    feedback: Mapped[str | None] = mapped_column(Text)
    teacher_comment: Mapped[str | None] = mapped_column(Text)
    ai_result: Mapped[dict | None] = mapped_column(JSONB)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewed_by: Mapped[str | None] = mapped_column(Text)


class TeacherAiCall(Base):
    """Metered AI call made for a teacher's assignment; its result also serves as a cache."""

    __tablename__ = "teacher_ai_calls"
    __table_args__ = (
        Index("ix_teacher_ai_calls_cache", "purpose", "image_hash"),
        Index("ix_teacher_ai_calls_teacher_created", "teacher_id", "created_at"),
        Index("ix_teacher_ai_calls_assignment", "assignment_id"),
        Index("ix_teacher_ai_calls_created", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    purpose: Mapped[str] = mapped_column(Text, nullable=False)
    image_hash: Mapped[str] = mapped_column(Text, nullable=False)
    assignment_id: Mapped[str] = mapped_column(Text, nullable=False)
    teacher_id: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    result: Mapped[dict | None] = mapped_column(JSONB)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    estimated_cost: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TeacherGradingRun(Base):
    """One AI pre-grading pass over an assignment's collected answer areas."""

    __tablename__ = "teacher_grading_runs"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    assignment_id: Mapped[str] = mapped_column(
        Text, ForeignKey("teacher_assignments.id", ondelete="CASCADE"), index=True, nullable=False,
    )
    status: Mapped[str] = mapped_column(Text, default="queued", server_default="queued", nullable=False)
    total: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    done: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class QuestionRubric(Base):
    """Scoring points for a bank question, drafted by AI and approved by an administrator.

    Points are relative: a paper that gives the question a different total scales them.
    """

    __tablename__ = "question_rubrics"

    question_id: Mapped[str] = mapped_column(
        Text, ForeignKey("questions.id", ondelete="CASCADE"), primary_key=True,
    )
    # drafting | draft | approved | rejected | failed
    status: Mapped[str] = mapped_column(Text, nullable=False)
    # [{"label": "(1)", "points": 6, "criteria": ["写出 v=v0+at 得 2 分", ...]}]
    parts: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]", nullable=False)
    total_points: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)
    source: Mapped[str] = mapped_column(Text, default="ai", server_default="ai", nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    drafted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewed_by: Mapped[str | None] = mapped_column(Text)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
