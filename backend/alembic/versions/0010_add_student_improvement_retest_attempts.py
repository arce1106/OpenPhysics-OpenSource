"""add student improvement retest attempts

Revision ID: 0010d1e2f3a4
Revises: 0009c9d0e1f2
Create Date: 2026-06-27
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0010d1e2f3a4"
down_revision: Union[str, None] = "0009c9d0e1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "student_improvement_retest_attempts",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("plan_id", sa.Text(), nullable=False),
        sa.Column("student_id", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("question_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("task_results", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("correct_count", sa.Integer(), nullable=False),
        sa.Column("total_count", sa.Integer(), nullable=False),
        sa.Column("passed_count", sa.Integer(), nullable=False),
        sa.Column("needs_retest_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["plan_id"], ["student_improvement_plans.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["student_id"], ["students.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_student_improvement_retest_attempts_plan_id",
        "student_improvement_retest_attempts",
        ["plan_id"],
    )
    op.create_index(
        "ix_student_improvement_retest_attempts_student_id",
        "student_improvement_retest_attempts",
        ["student_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_student_improvement_retest_attempts_student_id",
        table_name="student_improvement_retest_attempts",
    )
    op.drop_index(
        "ix_student_improvement_retest_attempts_plan_id",
        table_name="student_improvement_retest_attempts",
    )
    op.drop_table("student_improvement_retest_attempts")
