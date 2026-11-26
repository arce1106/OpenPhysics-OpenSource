"""add student ai usage logs

Revision ID: 0007a7b8c9d0
Revises: 0006f6a7b8c9
Create Date: 2026-06-21
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0007a7b8c9d0"
down_revision: Union[str, None] = '0005e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "student_ai_usage_logs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("student_id", sa.Text(), nullable=False),
        sa.Column("feature", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["student_id"], ["students.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_student_ai_usage_logs_student_id", "student_ai_usage_logs", ["student_id"])
    op.create_index("ix_student_ai_usage_logs_feature", "student_ai_usage_logs", ["feature"])
    op.create_index("ix_student_ai_usage_logs_created_at", "student_ai_usage_logs", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_student_ai_usage_logs_created_at", table_name="student_ai_usage_logs")
    op.drop_index("ix_student_ai_usage_logs_feature", table_name="student_ai_usage_logs")
    op.drop_index("ix_student_ai_usage_logs_student_id", table_name="student_ai_usage_logs")
    op.drop_table("student_ai_usage_logs")
