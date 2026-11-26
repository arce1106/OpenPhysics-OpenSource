"""Coordinate student AI without holding transactions during provider calls."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0028_student_ai_execution"
down_revision = "0027_student_username_changes"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "student_ai_usage_logs", sa.Column("execution_id", sa.Text(), nullable=True)
    )
    op.create_unique_constraint(
        "uq_student_ai_usage_execution", "student_ai_usage_logs", ["execution_id"]
    )
    op.create_index(
        "ix_student_ai_usage_student_time",
        "student_ai_usage_logs",
        ["student_id", "created_at"],
    )
    op.create_table(
        "student_ai_executions",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column(
            "student_id",
            sa.Text(),
            sa.ForeignKey("students.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("operation_key", sa.Text(), nullable=False),
        sa.Column("fingerprint", sa.Text(), nullable=False),
        sa.Column("feature", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("owner", sa.Text(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("result", postgresql.JSONB()),
        sa.Column("error_code", sa.Text()),
        sa.Column("queue_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("provider_ms", sa.Integer()),
        sa.UniqueConstraint(
            "student_id", "operation_key", name="uq_student_ai_operation"
        ),
    )
    op.create_index(
        "ix_ai_execution_active",
        "student_ai_executions",
        ["status", "lease_expires_at"],
    )
    op.create_index(
        "ix_ai_execution_student_started",
        "student_ai_executions",
        ["student_id", "started_at"],
    )
    op.create_index("ix_ai_execution_started", "student_ai_executions", ["started_at"])


def downgrade():
    op.drop_table("student_ai_executions")
    op.drop_index(
        "ix_student_ai_usage_student_time", table_name="student_ai_usage_logs"
    )
    op.drop_constraint(
        "uq_student_ai_usage_execution", "student_ai_usage_logs", type_="unique"
    )
    op.drop_column("student_ai_usage_logs", "execution_id")
