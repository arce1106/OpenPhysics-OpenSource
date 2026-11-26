"""initial_all_tables

Revision ID: c7c6d6545046
Revises:
Create Date: 2026-04-26 22:32:04.398758

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'c7c6d6545046'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # PostgreSQL requires enum types to exist before tables reference them.
    # create_type=True lets SQLAlchemy manage enum creation automatically.
    relation_type_enum = sa.Enum(
        "prerequisite_of", "part_of", "confused_with",
        "applied_to", "uses_formula", "uses_model", "has_misconception",
        name="relationtype",
    )
    question_type_enum = sa.Enum(
        "conceptual_judgment", "calculation", "graph_analysis",
        name="questiontype",
    )
    quality_status_enum = sa.Enum(
        "draft", "pending_review", "approved", "calibrating", "retired",
        name="qualitystatus",
    )
    question_source_enum = sa.Enum(
        "ai_generated", "human", "curated",
        name="questionsource",
    )

    # knowledge_points
    op.create_table(
        "knowledge_points",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("chapter", sa.Text(), nullable=True),
        sa.Column("section", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("difficulty", sa.Float(), nullable=False, server_default="0.0"),
        sa.PrimaryKeyConstraint("id"),
    )

    # knowledge_relations
    op.create_table(
        "knowledge_relations",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("source_id", sa.Text(), nullable=False),
        sa.Column("target_id", sa.Text(), nullable=False),
        sa.Column(
            "relation_type",
            relation_type_enum,
            nullable=False,
        ),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["source_id"], ["knowledge_points.id"]),
        sa.ForeignKeyConstraint(["target_id"], ["knowledge_points.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    # misconceptions
    op.create_table(
        "misconceptions",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("related_kp_ids", postgresql.JSONB(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )

    # questions
    op.create_table(
        "questions",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("stem_text", sa.Text(), nullable=False),
        sa.Column("answer", sa.Text(), nullable=True),
        sa.Column("explanation", sa.Text(), nullable=True),
        sa.Column("question_type", question_type_enum, nullable=True),
        sa.Column("difficulty", sa.Float(), nullable=True),
        sa.Column("source", question_source_enum, nullable=True),
        sa.Column(
            "quality_status",
            quality_status_enum,
            nullable=False,
            server_default="draft",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    # question_options
    op.create_table(
        "question_options",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("question_id", sa.Text(), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("is_correct", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("targets_misconception", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    # question_labels
    op.create_table(
        "question_labels",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("question_id", sa.Text(), nullable=False),
        sa.Column("label_type", sa.Text(), nullable=False),
        sa.Column("label_id", sa.Text(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False, server_default="primary"),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("source", sa.Text(), nullable=False, server_default="ai"),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    # question_formulas
    op.create_table(
        "question_formulas",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("question_id", sa.Text(), nullable=False),
        sa.Column("latex", sa.Text(), nullable=False),
        sa.Column("formula_role", sa.Text(), nullable=True),
        sa.Column("knowledge_point_id", sa.Text(), nullable=True),
        sa.Column("variables", postgresql.JSONB(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    # question_images
    op.create_table(
        "question_images",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("question_id", sa.Text(), nullable=False),
        sa.Column("image_path", sa.Text(), nullable=False),
        sa.Column("image_type", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("extracted_structure", postgresql.JSONB(), nullable=True),
        sa.Column("related_knowledge_points", postgresql.JSONB(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    # student_mastery
    op.create_table(
        "student_mastery",
        sa.Column("student_id", sa.Text(), nullable=False),
        sa.Column("knowledge_point_id", sa.Text(), nullable=False),
        sa.Column("mastery", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("confidence", sa.Float(), nullable=False, server_default="1.0"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("correct_rate", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("main_misconceptions", postgresql.JSONB(), nullable=True),
        sa.Column("last_practiced", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["knowledge_point_id"], ["knowledge_points.id"]),
        sa.PrimaryKeyConstraint("student_id", "knowledge_point_id"),
        sa.UniqueConstraint("student_id", "knowledge_point_id", name="uq_student_kp"),
    )

    # student_answers
    op.create_table(
        "student_answers",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("student_id", sa.Text(), nullable=False),
        sa.Column("question_id", sa.Text(), nullable=False),
        sa.Column("given_answer", sa.Text(), nullable=True),
        sa.Column("is_correct", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("time_spent_ms", sa.Integer(), nullable=True),
        sa.Column("misconception_ids", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    # item_stats
    op.create_table(
        "item_stats",
        sa.Column("question_id", sa.Text(), nullable=False),
        sa.Column("total_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("correct_rate", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("avg_time_ms", sa.Float(), nullable=True),
        sa.Column("difficulty_estimate", sa.Float(), nullable=True),
        sa.Column("discrimination", sa.Float(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"]),
        sa.PrimaryKeyConstraint("question_id"),
    )


def downgrade() -> None:
    op.drop_table("item_stats")
    op.drop_table("student_answers")
    op.drop_table("student_mastery")
    op.drop_table("question_images")
    op.drop_table("question_formulas")
    op.drop_table("question_labels")
    op.drop_table("question_options")
    op.drop_table("questions")
    op.drop_table("misconceptions")
    op.drop_table("knowledge_relations")
    op.drop_table("knowledge_points")

    op.execute("DROP TYPE IF EXISTS questionsource CASCADE")
    op.execute("DROP TYPE IF EXISTS qualitystatus CASCADE")
    op.execute("DROP TYPE IF EXISTS questiontype CASCADE")
    op.execute("DROP TYPE IF EXISTS relationtype CASCADE")
