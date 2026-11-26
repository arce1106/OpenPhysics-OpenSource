from datetime import datetime
from sqlalchemy import Integer, Float, Text, Boolean, ForeignKey, DateTime, Index, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import JSONB
from .base import Base


class StudentMastery(Base):
    __tablename__ = "student_mastery"
    __table_args__ = (
        UniqueConstraint("student_id", "knowledge_point_id", name="uq_student_kp"),
    )

    student_id: Mapped[str] = mapped_column(Text, primary_key=True)
    knowledge_point_id: Mapped[str] = mapped_column(
        Text, ForeignKey("knowledge_points.id"), primary_key=True
    )
    mastery: Mapped[float] = mapped_column(Float, default=0.0)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    correct_rate: Mapped[float] = mapped_column(Float, default=0.0)
    main_misconceptions: Mapped[dict | None] = mapped_column(JSONB)
    last_practiced: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Student(Base):
    __tablename__ = "students"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    username: Mapped[str] = mapped_column(Text, unique=True, index=True, nullable=False)
    phone: Mapped[str | None] = mapped_column(Text, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    auth_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    class_name: Mapped[str | None] = mapped_column(Text)
    grade: Mapped[str | None] = mapped_column(Text)
    account_source: Mapped[str] = mapped_column(Text, default="admin", nullable=False)
    registration_consent: Mapped[dict | None] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(Text, default="active", nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class StudentPrivacyConsent(Base):
    __tablename__ = "student_privacy_consents"
    __table_args__ = (Index("ix_privacy_consent_student_scope_id", "student_id", "scope", "id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[str] = mapped_column(Text, ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    scope: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[str] = mapped_column(Text, nullable=False)
    granted: Mapped[bool] = mapped_column(Boolean, nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # Set for receipts recorded on the student's behalf, e.g. a school's written authorization.
    source: Mapped[str | None] = mapped_column(Text)
    grantor: Mapped[str | None] = mapped_column(Text)
    recorded_by: Mapped[str | None] = mapped_column(Text)


class StudentUsernameChange(Base):
    """Rolling rename quota; never store previous usernames or phone numbers."""
    __tablename__ = "student_username_changes"
    __table_args__ = (Index("ix_student_username_changes_student_time", "student_id", "changed_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[str] = mapped_column(Text, ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class StudentAiUsageLog(Base):
    __tablename__ = "student_ai_usage_logs"
    __table_args__ = (
        UniqueConstraint("execution_id", name="uq_student_ai_usage_execution"),
        Index("ix_student_ai_usage_student_time", "student_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[str] = mapped_column(Text, ForeignKey("students.id"), index=True, nullable=False)
    feature: Mapped[str] = mapped_column(Text, index=True, nullable=False)
    execution_id: Mapped[str | None] = mapped_column(Text)
    # Provider calls this task made; the daily quota counts these, not tasks.
    units: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class GradingOutcome(Base):
    """One photographed question's grading outcome, for quality rates only.

    Deliberately carries no student identity: unrecognised photos are not saved
    as answers, so this is the only place their rate can be measured.
    """
    __tablename__ = "grading_outcomes"
    __table_args__ = (Index("ix_grading_outcomes_created", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(Text, nullable=False)
    question_type: Mapped[str | None] = mapped_column(Text)
    outcome: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class StudentAiExecution(Base):
    """Private, bounded result cache and cross-worker admission ledger, not answer history."""
    __tablename__ = "student_ai_executions"
    __table_args__ = (
        UniqueConstraint("student_id", "operation_key", name="uq_student_ai_operation"),
        Index("ix_ai_execution_active", "status", "lease_expires_at"),
        Index("ix_ai_execution_student_started", "student_id", "started_at"),
        Index("ix_ai_execution_started", "started_at"),
    )
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    student_id: Mapped[str] = mapped_column(Text, ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    operation_key: Mapped[str] = mapped_column(Text, nullable=False)
    fingerprint: Mapped[str] = mapped_column(Text, nullable=False)
    feature: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    owner: Mapped[str] = mapped_column(Text, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    lease_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    result: Mapped[dict | list | str | None] = mapped_column(JSONB)
    error_code: Mapped[str | None] = mapped_column(Text)
    queue_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    provider_ms: Mapped[int | None] = mapped_column(Integer)
    model_calls: Mapped[int | None] = mapped_column(Integer)


class StudentCaptchaChallenge(Base):
    __tablename__ = "student_captcha_challenges"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    answer_hash: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class StudentWebLoginTicket(Base):
    __tablename__ = "student_web_login_tickets"

    ticket_hash: Mapped[str] = mapped_column(Text, primary_key=True)
    student_id: Mapped[str] = mapped_column(Text, ForeignKey("students.id"), index=True, nullable=False)
    auth_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class StudentAnswer(Base):
    __tablename__ = "student_answers"
    __table_args__ = (
        UniqueConstraint(
            "student_id",
            "submission_id",
            "question_id",
            name="uq_student_answer_submission",
        ),
        UniqueConstraint("teacher_paper_attempt_id", "question_id", name="uq_teacher_paper_answer"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[str] = mapped_column(Text, nullable=False)
    question_id: Mapped[str] = mapped_column(Text, ForeignKey("questions.id"), nullable=False)
    teacher_paper_attempt_id: Mapped[str | None] = mapped_column(
        Text, ForeignKey("teacher_paper_attempts.id", name="fk_answer_teacher_paper"), index=True,
    )
    submission_id: Mapped[str | None] = mapped_column(Text, index=True)
    given_answer: Mapped[str | None] = mapped_column(Text)
    is_correct: Mapped[bool] = mapped_column(Boolean, default=False)
    time_spent_ms: Mapped[int | None] = mapped_column(Integer)
    misconception_ids: Mapped[dict | None] = mapped_column(JSONB)
    grading_result: Mapped[dict | None] = mapped_column(JSONB)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class ItemStats(Base):
    __tablename__ = "item_stats"

    question_id: Mapped[str] = mapped_column(
        Text, ForeignKey("questions.id"), primary_key=True
    )
    total_attempts: Mapped[int] = mapped_column(Integer, default=0)
    correct_rate: Mapped[float] = mapped_column(Float, default=0.0)
    avg_time_ms: Mapped[float | None] = mapped_column(Float)
    difficulty_estimate: Mapped[float | None] = mapped_column(Float)
    discrimination: Mapped[float | None] = mapped_column(Float)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
