from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class LearningCatalog(Base):
    """A reusable learning directory, such as sync learning or Gaokao review."""

    __tablename__ = "learning_catalogs"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    code: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class LearningCatalogNode(Base):
    """A tree node inside a learning catalog."""

    __tablename__ = "learning_catalog_nodes"
    __table_args__ = (
        UniqueConstraint("catalog_id", "code", name="uq_learning_catalog_nodes_catalog_code"),
        CheckConstraint(
            "node_type IN ('volume', 'chapter', 'section', 'knowledge_point', 'block', 'topic')",
            name="ck_learning_catalog_nodes_type",
        ),
        Index(
            "ix_learning_catalog_nodes_catalog_parent_order",
            "catalog_id",
            "parent_id",
            "sort_order",
        ),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    catalog_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("learning_catalogs.id", ondelete="CASCADE"),
        nullable=False,
    )
    parent_id: Mapped[str | None] = mapped_column(
        Text,
        ForeignKey("learning_catalog_nodes.id", ondelete="CASCADE"),
    )
    code: Mapped[str] = mapped_column(Text, nullable=False)
    node_type: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)


class LearningCatalogNodeKnowledgePoint(Base):
    """Curated expansion from a broad catalog node to canonical fine-grained KPs."""

    __tablename__ = "learning_catalog_node_knowledge_points"
    __table_args__ = (
        CheckConstraint(
            "role IN ('core', 'supporting')",
            name="ck_learning_catalog_node_kps_role",
        ),
        Index(
            "ix_learning_catalog_node_kps_kp_node",
            "knowledge_point_id",
            "node_id",
        ),
    )

    node_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("learning_catalog_nodes.id", ondelete="CASCADE"),
        primary_key=True,
    )
    knowledge_point_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("knowledge_points.id", ondelete="CASCADE"),
        primary_key=True,
    )
    role: Mapped[str] = mapped_column(Text, nullable=False, default="core")
    weight: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class LearningCatalogNodeLabelRule(Base):
    """Include or exclude questions through the existing multidimensional labels."""

    __tablename__ = "learning_catalog_node_label_rules"
    __table_args__ = (
        UniqueConstraint(
            "node_id",
            "label_type",
            "label_id",
            "action",
            name="uq_learning_catalog_node_label_rule",
        ),
        CheckConstraint(
            "action IN ('include', 'exclude')",
            name="ck_learning_catalog_node_label_rules_action",
        ),
        Index(
            "ix_learning_catalog_node_label_rules_lookup",
            "label_type",
            "label_id",
            "node_id",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    node_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("learning_catalog_nodes.id", ondelete="CASCADE"),
        nullable=False,
    )
    label_type: Mapped[str] = mapped_column(Text, nullable=False)
    label_id: Mapped[str] = mapped_column(Text, nullable=False)
    action: Mapped[str] = mapped_column(Text, nullable=False, default="include")
    weight: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class LearningCatalogNodeQuestionOverride(Base):
    """Teacher-curated question inclusion/exclusion that wins over mapping rules."""

    __tablename__ = "learning_catalog_node_question_overrides"
    __table_args__ = (
        CheckConstraint(
            "action IN ('include', 'exclude')",
            name="ck_learning_catalog_node_question_overrides_action",
        ),
        Index(
            "ix_learning_catalog_node_question_overrides_question",
            "question_id",
            "node_id",
        ),
    )

    node_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("learning_catalog_nodes.id", ondelete="CASCADE"),
        primary_key=True,
    )
    question_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("questions.id", ondelete="CASCADE"),
        primary_key=True,
    )
    action: Mapped[str] = mapped_column(Text, nullable=False, default="include")
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class LearningCatalogNodeEvidence(Base):
    """A graded answer attributed to one catalog topic and review layer."""

    __tablename__ = "learning_catalog_node_evidence"
    __table_args__ = (
        UniqueConstraint(
            "student_id",
            "node_id",
            "answer_id",
            name="uq_learning_catalog_node_evidence_answer",
        ),
        CheckConstraint(
            "layer IN ('diagnostic', 'foundation', 'breakthrough', 'transfer', 'paper')",
            name="ck_learning_catalog_node_evidence_layer",
        ),
        CheckConstraint(
            "score >= 0 AND score <= 1",
            name="ck_learning_catalog_node_evidence_score",
        ),
        Index(
            "ix_learning_catalog_node_evidence_student_node_created",
            "student_id",
            "node_id",
            "created_at",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[str] = mapped_column(Text, nullable=False)
    node_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("learning_catalog_nodes.id", ondelete="CASCADE"),
        nullable=False,
    )
    answer_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("student_answers.id", ondelete="CASCADE"),
        nullable=False,
    )
    question_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("questions.id", ondelete="CASCADE"),
        nullable=False,
    )
    knowledge_point_id: Mapped[str | None] = mapped_column(
        Text,
        ForeignKey("knowledge_points.id", ondelete="SET NULL"),
    )
    layer: Mapped[str] = mapped_column(Text, nullable=False)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
