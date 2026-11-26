import enum
from sqlalchemy import Integer, Float, Text, ForeignKey, Enum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import JSONB
from .base import Base


class RelationType(str, enum.Enum):
    prerequisite_of = "prerequisite_of"
    part_of = "part_of"
    confused_with = "confused_with"
    applied_to = "applied_to"
    uses_formula = "uses_formula"
    uses_model = "uses_model"
    has_misconception = "has_misconception"


class KnowledgePoint(Base):
    __tablename__ = "knowledge_points"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    chapter: Mapped[str | None] = mapped_column(Text)
    section: Mapped[str | None] = mapped_column(Text)
    volume: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    difficulty: Mapped[float] = mapped_column(Float, default=0.0)

    # Relationships as source
    outgoing_relations: Mapped[list["KnowledgeRelation"]] = relationship(
        foreign_keys="KnowledgeRelation.source_id", back_populates="source", lazy="selectin"
    )


class KnowledgeRelation(Base):
    __tablename__ = "knowledge_relations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_id: Mapped[str] = mapped_column(Text, ForeignKey("knowledge_points.id"), nullable=False)
    target_id: Mapped[str] = mapped_column(Text, ForeignKey("knowledge_points.id"), nullable=False)
    relation_type: Mapped[RelationType] = mapped_column(Enum(RelationType), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)

    source: Mapped["KnowledgePoint"] = relationship(foreign_keys=[source_id], back_populates="outgoing_relations", lazy="selectin")


class Misconception(Base):
    __tablename__ = "misconceptions"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    related_kp_ids: Mapped[dict | None] = mapped_column(JSONB)
