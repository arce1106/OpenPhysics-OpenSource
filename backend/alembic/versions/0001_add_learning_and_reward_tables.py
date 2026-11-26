"""add_reward_tables

Revision ID: 0001a1b2c3d4
Revises: f3a9c1b2d4e5
Create Date: 2026-05-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0001a1b2c3d4"
down_revision: Union[str, None] = "f3a9c1b2d4e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # learning_events
    op.create_table(
        "learning_events",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("student_id", sa.Text(), nullable=False),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("question_id", sa.Text(), nullable=True),
        sa.Column("knowledge_point_id", sa.Text(), nullable=True),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_learning_events_student", "learning_events", ["student_id"])
    op.create_index("ix_learning_events_type", "learning_events", ["event_type"])

    # student_xp
    op.create_table(
        "student_xp",
        sa.Column("student_id", sa.Text(), nullable=False),
        sa.Column("total_xp", sa.Integer(), server_default="0"),
        sa.Column("level", sa.Integer(), server_default="1"),
        sa.Column("energy", sa.Integer(), server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("student_id"),
    )

    # reward_records
    op.create_table(
        "reward_records",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("student_id", sa.Text(), nullable=False),
        sa.Column("event_id", sa.Text(), nullable=True),
        sa.Column("reward_type", sa.Text(), nullable=False),
        sa.Column("reward_value", sa.Integer(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_reward_records_student", "reward_records", ["student_id"])

    # badges
    op.create_table(
        "badges",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("badge_type", sa.Text(), nullable=False),
        sa.Column("icon_url", sa.Text(), nullable=True),
        sa.Column("condition", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )

    # student_badges
    op.create_table(
        "student_badges",
        sa.Column("student_id", sa.Text(), nullable=False),
        sa.Column("badge_id", sa.Text(), nullable=False),
        sa.Column("earned_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("evidence", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.PrimaryKeyConstraint("student_id", "badge_id"),
        sa.ForeignKeyConstraint(["badge_id"], ["badges.id"]),
    )

    # quests
    op.create_table(
        "quests",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("quest_type", sa.Text(), nullable=False),
        sa.Column("target", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("reward", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("active", sa.Boolean(), server_default="true"),
        sa.PrimaryKeyConstraint("id"),
    )

    # student_quest_progress
    op.create_table(
        "student_quest_progress",
        sa.Column("student_id", sa.Text(), nullable=False),
        sa.Column("quest_id", sa.Text(), nullable=False),
        sa.Column("progress", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("status", sa.Text(), server_default="active"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("student_id", "quest_id"),
        sa.ForeignKeyConstraint(["quest_id"], ["quests.id"]),
    )

    # growth_reports
    op.create_table(
        "growth_reports",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("student_id", sa.Text(), nullable=False),
        sa.Column("report_type", sa.Text(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("metrics", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_growth_reports_student", "growth_reports", ["student_id"])


def downgrade() -> None:
    op.drop_index("ix_growth_reports_student", table_name="growth_reports")
    op.drop_table("growth_reports")
    op.drop_table("student_quest_progress")
    op.drop_table("quests")
    op.drop_table("student_badges")
    op.drop_table("badges")
    op.drop_index("ix_reward_records_student", table_name="reward_records")
    op.drop_table("reward_records")
    op.drop_table("student_xp")
    op.drop_index("ix_learning_events_type", table_name="learning_events")
    op.drop_index("ix_learning_events_student", table_name="learning_events")
    op.drop_table("learning_events")
