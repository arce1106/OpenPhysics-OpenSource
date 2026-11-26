import enum
from datetime import datetime, timezone

from sqlalchemy import Boolean, Enum, ForeignKey, Integer, Text, DateTime, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import JSONB

from .base import Base


class ContentType(str, enum.Enum):
    card = "card"
    slides = "slides"
    simulation = "simulation"
    example = "example"


class ContentSource(str, enum.Enum):
    curated = "curated"
    ai_generated = "ai_generated"


class VideoCurationType(str, enum.Enum):
    lecture = "lecture"
    experiment = "experiment"


class LearningContent(Base):
    __tablename__ = "learning_contents"
    __table_args__ = (
        UniqueConstraint(
            "knowledge_point_id", "content_type", "version",
            name="uq_kp_content_version",
        ),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    knowledge_point_id: Mapped[str] = mapped_column(
        Text, ForeignKey("knowledge_points.id"), nullable=False, index=True
    )
    content_type: Mapped[ContentType] = mapped_column(
        Enum(ContentType), nullable=False
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    body: Mapped[dict] = mapped_column(JSONB, nullable=False)
    source: Mapped[ContentSource] = mapped_column(
        Enum(ContentSource), nullable=False, default=ContentSource.curated
    )
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=func.now()
    )


class LearningProgress(Base):
    __tablename__ = "learning_progress"

    student_id: Mapped[str] = mapped_column(Text, primary_key=True)
    knowledge_point_id: Mapped[str] = mapped_column(
        Text, ForeignKey("knowledge_points.id"), primary_key=True
    )
    content_id: Mapped[str] = mapped_column(
        Text, ForeignKey("learning_contents.id"), primary_key=True
    )
    content_type: Mapped[ContentType] = mapped_column(
        Enum(ContentType), primary_key=True
    )
    consumed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    time_spent_seconds: Mapped[int] = mapped_column(Integer, default=0)


class LearningVideoCuration(Base):
    __tablename__ = "learning_video_curations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    knowledge_point_id: Mapped[str] = mapped_column(
        Text, ForeignKey("knowledge_points.id"), nullable=False, index=True
    )
    video_type: Mapped[VideoCurationType] = mapped_column(
        Enum(VideoCurationType), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    uploader: Mapped[str | None] = mapped_column(Text)
    duration: Mapped[str | None] = mapped_column(Text)
    cover_url: Mapped[str | None] = mapped_column(Text)
    reason: Mapped[str | None] = mapped_column(Text)
    match_focus: Mapped[str | None] = mapped_column(Text)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=func.now()
    )
