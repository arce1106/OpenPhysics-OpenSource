"""add student improvement plans

Revision ID: 0009c9d0e1f2
Revises: 0008b8c9d0e1
Create Date: 2026-06-27
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0009c9d0e1f2"
down_revision: Union[str, None] = "0008b8c9d0e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "student_improvement_plans",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("student_id", sa.Text(), nullable=False),
        sa.Column("scope_type", sa.Text(), nullable=False),
        sa.Column("scope_id", sa.Text(), nullable=False),
        sa.Column("scope_name", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("current_task_id", sa.Text(), nullable=True),
        sa.Column("correct_count", sa.Integer(), nullable=False),
        sa.Column("total_count", sa.Integer(), nullable=False),
        sa.Column("weak_count", sa.Integer(), nullable=False),
        sa.Column("source_result", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["student_id"], ["students.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_student_improvement_plans_student_id", "student_improvement_plans", ["student_id"])
    op.create_index("ix_student_improvement_plans_scope_id", "student_improvement_plans", ["scope_id"])

    op.create_table(
        "student_improvement_tasks",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("plan_id", sa.Text(), nullable=False),
        sa.Column("student_id", sa.Text(), nullable=False),
        sa.Column("kp_id", sa.Text(), nullable=False),
        sa.Column("kp_name", sa.Text(), nullable=False),
        sa.Column("group_id", sa.Text(), nullable=True),
        sa.Column("group_name", sa.Text(), nullable=True),
        sa.Column("correct_count", sa.Integer(), nullable=False),
        sa.Column("total_count", sa.Integer(), nullable=False),
        sa.Column("mastery_before", sa.Float(), nullable=False),
        sa.Column("mastery_after", sa.Float(), nullable=False),
        sa.Column("is_weak", sa.Boolean(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("recommended_action", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("practiced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("passed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["plan_id"], ["student_improvement_plans.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["student_id"], ["students.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_student_improvement_tasks_plan_id", "student_improvement_tasks", ["plan_id"])
    op.create_index("ix_student_improvement_tasks_student_id", "student_improvement_tasks", ["student_id"])
    op.create_index("ix_student_improvement_tasks_kp_id", "student_improvement_tasks", ["kp_id"])


def downgrade() -> None:
    op.drop_index("ix_student_improvement_tasks_kp_id", table_name="student_improvement_tasks")
    op.drop_index("ix_student_improvement_tasks_student_id", table_name="student_improvement_tasks")
    op.drop_index("ix_student_improvement_tasks_plan_id", table_name="student_improvement_tasks")
    op.drop_table("student_improvement_tasks")
    op.drop_index("ix_student_improvement_plans_scope_id", table_name="student_improvement_plans")
    op.drop_index("ix_student_improvement_plans_student_id", table_name="student_improvement_plans")
    op.drop_table("student_improvement_plans")
