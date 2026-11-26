"""Meter student AI by provider calls and count photo recognition outcomes.

Additive only: two nullable/defaulted columns and one aggregate table without
student identity, so rolling the application back leaves them unused.
"""
from alembic import op
import sqlalchemy as sa

revision = "0034_grading_call_metering"
down_revision = "0033_privacy_consent"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "student_ai_usage_logs",
        sa.Column("units", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column("student_ai_executions", sa.Column("model_calls", sa.Integer(), nullable=True))
    op.create_table(
        "grading_outcomes",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("question_type", sa.Text(), nullable=True),
        sa.Column("outcome", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_grading_outcomes_created", "grading_outcomes", ["created_at"])


def downgrade():
    op.drop_index("ix_grading_outcomes_created", table_name="grading_outcomes")
    op.drop_table("grading_outcomes")
    op.drop_column("student_ai_executions", "model_calls")
    op.drop_column("student_ai_usage_logs", "units")
