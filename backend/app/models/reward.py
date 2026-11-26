from datetime import datetime, date
from sqlalchemy import Integer, Text, Boolean, ForeignKey, DateTime, Date, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import JSONB
from .base import Base


class LearningEvent(Base):
    __tablename__ = "learning_events"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    student_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    question_id: Mapped[str | None] = mapped_column(Text)
    knowledge_point_id: Mapped[str | None] = mapped_column(Text)
    payload: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class StudentXp(Base):
    __tablename__ = "student_xp"

    student_id: Mapped[str] = mapped_column(Text, primary_key=True)
    total_xp: Mapped[int] = mapped_column(Integer, default=0)
    level: Mapped[int] = mapped_column(Integer, default=1)
    energy: Mapped[int] = mapped_column(Integer, default=0)
    streak_days: Mapped[int] = mapped_column(Integer, default=0)
    last_activity_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class RewardRecord(Base):
    __tablename__ = "reward_records"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    student_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    event_id: Mapped[str | None] = mapped_column(Text)
    reward_type: Mapped[str] = mapped_column(Text, nullable=False)
    reward_value: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Badge(Base):
    __tablename__ = "badges"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    badge_type: Mapped[str] = mapped_column(Text, nullable=False)
    icon_url: Mapped[str | None] = mapped_column(Text)
    condition: Mapped[dict | None] = mapped_column(JSONB)


class StudentBadge(Base):
    __tablename__ = "student_badges"

    student_id: Mapped[str] = mapped_column(Text, primary_key=True)
    badge_id: Mapped[str] = mapped_column(Text, ForeignKey("badges.id"), primary_key=True)
    earned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    evidence: Mapped[dict | None] = mapped_column(JSONB)


class Quest(Base):
    __tablename__ = "quests"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    quest_type: Mapped[str] = mapped_column(Text, nullable=False)
    target: Mapped[dict | None] = mapped_column(JSONB)
    reward: Mapped[dict | None] = mapped_column(JSONB)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class StudentQuestProgress(Base):
    __tablename__ = "student_quest_progress"

    student_id: Mapped[str] = mapped_column(Text, primary_key=True)
    quest_id: Mapped[str] = mapped_column(Text, ForeignKey("quests.id"), primary_key=True)
    progress: Mapped[dict | None] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(Text, default="active")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class GrowthReport(Base):
    __tablename__ = "growth_reports"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    student_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    report_type: Mapped[str | None] = mapped_column(Text)
    start_date: Mapped[datetime | None] = mapped_column(Date)
    end_date: Mapped[datetime | None] = mapped_column(Date)
    summary: Mapped[str | None] = mapped_column(Text)
    metrics: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
