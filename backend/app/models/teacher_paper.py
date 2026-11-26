"""Durable fixed-paper attempts, independent from temporary playback credentials."""
from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, Index, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from .base import Base


class TeacherPaperAttempt(Base):
    __tablename__ = "teacher_paper_attempts"
    __table_args__ = (
        Index("ix_teacher_paper_student_paper", "student_id", "paper_id", "created_at"),
        Index("uq_teacher_paper_active", "student_id", "paper_id", unique=True,
              postgresql_where=text("status != 'completed'")),
    )
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    student_id: Mapped[str] = mapped_column(Text, ForeignKey("students.id", ondelete="CASCADE"))
    paper_id: Mapped[str] = mapped_column(Text)
    catalog_code: Mapped[str] = mapped_column(Text)
    node_id: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text)
    question_ids: Mapped[list] = mapped_column(JSONB)
    questions: Mapped[list] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(Text, default="in_progress", server_default="in_progress")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
