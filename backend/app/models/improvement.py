from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class StudentImprovementPlan(Base):
    __tablename__ = "student_improvement_plans"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    student_id: Mapped[str] = mapped_column(Text, ForeignKey("students.id"), index=True, nullable=False)
    diagnostic_attempt_id: Mapped[str | None] = mapped_column(
        Text,
        ForeignKey("student_scope_diagnostic_attempts.id", ondelete="SET NULL"),
        index=True,
    )
    scope_type: Mapped[str] = mapped_column(Text, nullable=False)
    scope_id: Mapped[str] = mapped_column(Text, index=True, nullable=False)
    scope_name: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, default="diagnosed", nullable=False)
    current_task_id: Mapped[str | None] = mapped_column(Text)
    correct_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    weak_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    source_result: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    tasks: Mapped[list["StudentImprovementTask"]] = relationship(
        back_populates="plan",
        cascade="all, delete-orphan",
        order_by="StudentImprovementTask.priority",
        lazy="selectin",
    )
    retest_attempts: Mapped[list["StudentImprovementRetestAttempt"]] = relationship(
        back_populates="plan",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    diagnostic_attempt: Mapped["StudentScopeDiagnosticAttempt | None"] = relationship(
        back_populates="improvement_plans",
        lazy="selectin",
    )


class StudentScopeDiagnosticAttempt(Base):
    __tablename__ = "student_scope_diagnostic_attempts"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    student_id: Mapped[str] = mapped_column(Text, ForeignKey("students.id"), index=True, nullable=False)
    scope_type: Mapped[str] = mapped_column(Text, nullable=False)
    scope_id: Mapped[str] = mapped_column(Text, index=True, nullable=False)
    scope_name: Mapped[str] = mapped_column(Text, nullable=False)
    diagnostic_type: Mapped[str] = mapped_column(Text, default="scope", nullable=False)
    status: Mapped[str] = mapped_column(Text, default="submitted", nullable=False)
    question_ids: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    answer_ids: Mapped[list[int | str]] = mapped_column(JSONB, default=list, nullable=False)
    result: Mapped[dict | None] = mapped_column(JSONB)
    correct_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    weak_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    weak_kp_ids: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    recommendation: Mapped[str | None] = mapped_column(Text)
    feedback: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    kp_results: Mapped[list["StudentScopeDiagnosticKpResult"]] = relationship(
        back_populates="attempt",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    improvement_plans: Mapped[list[StudentImprovementPlan]] = relationship(
        back_populates="diagnostic_attempt",
        lazy="selectin",
    )


class StudentScopeDiagnosticKpResult(Base):
    __tablename__ = "student_scope_diagnostic_kp_results"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    attempt_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("student_scope_diagnostic_attempts.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    student_id: Mapped[str] = mapped_column(Text, ForeignKey("students.id"), index=True, nullable=False)
    kp_id: Mapped[str] = mapped_column(Text, index=True, nullable=False)
    kp_name: Mapped[str] = mapped_column(Text, nullable=False)
    group_id: Mapped[str | None] = mapped_column(Text)
    group_name: Mapped[str | None] = mapped_column(Text)
    correct_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    mastery_before: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    mastery_after: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    is_weak: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    attempt: Mapped[StudentScopeDiagnosticAttempt] = relationship(back_populates="kp_results")


class StudentImprovementTask(Base):
    __tablename__ = "student_improvement_tasks"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    plan_id: Mapped[str] = mapped_column(
        Text, ForeignKey("student_improvement_plans.id", ondelete="CASCADE"), index=True, nullable=False
    )
    student_id: Mapped[str] = mapped_column(Text, ForeignKey("students.id"), index=True, nullable=False)
    kp_id: Mapped[str] = mapped_column(Text, index=True, nullable=False)
    kp_name: Mapped[str] = mapped_column(Text, nullable=False)
    group_id: Mapped[str | None] = mapped_column(Text)
    group_name: Mapped[str | None] = mapped_column(Text)
    correct_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    mastery_before: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    mastery_after: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    is_weak: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    priority: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(Text, default="pending", nullable=False)
    recommended_action: Mapped[str] = mapped_column(Text, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    practiced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    passed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    plan: Mapped[StudentImprovementPlan] = relationship(back_populates="tasks")


class StudentImprovementRetestAttempt(Base):
    __tablename__ = "student_improvement_retest_attempts"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    plan_id: Mapped[str] = mapped_column(
        Text, ForeignKey("student_improvement_plans.id", ondelete="CASCADE"), index=True, nullable=False
    )
    student_id: Mapped[str] = mapped_column(Text, ForeignKey("students.id"), index=True, nullable=False)
    status: Mapped[str] = mapped_column(Text, default="in_progress", nullable=False)
    question_ids: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    task_results: Mapped[list[dict] | None] = mapped_column(JSONB)
    correct_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    passed_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    needs_retest_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    plan: Mapped[StudentImprovementPlan] = relationship(back_populates="retest_attempts")
