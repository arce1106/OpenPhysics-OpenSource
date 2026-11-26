"""Rubrics, AI pre-grading runs and reviewed scores for collected paper homework.

Additive only: two new tables and nullable columns on existing teacher tables.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0039_teacher_grading"
down_revision = "0038_teacher_scans"
branch_labels = None
depends_on = None

ITEM_COLUMNS = (
    ("grade_status", sa.Text()), ("max_score", sa.Float()), ("score", sa.Float()),
    ("part_scores", postgresql.JSONB()), ("error_type", sa.Text()), ("first_error", sa.Text()),
    ("feedback", sa.Text()), ("teacher_comment", sa.Text()), ("ai_result", postgresql.JSONB()),
    ("reviewed_at", sa.DateTime(timezone=True)), ("reviewed_by", sa.Text()),
)


def upgrade():
    op.add_column("teacher_assignments", sa.Column("results_released_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("teacher_submissions", sa.Column("total_score", sa.Float(), nullable=True))
    op.add_column("teacher_submissions", sa.Column("graded_at", sa.DateTime(timezone=True), nullable=True))
    for name, column_type in ITEM_COLUMNS:
        op.add_column("teacher_submission_items", sa.Column(name, column_type, nullable=True))
    op.create_table(
        "teacher_grading_runs",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("assignment_id", sa.Text(), sa.ForeignKey("teacher_assignments.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="queued"),
        sa.Column("total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("done", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_teacher_grading_runs_assignment_id", "teacher_grading_runs", ["assignment_id"])
    op.create_table(
        "question_rubrics",
        sa.Column("question_id", sa.Text(), sa.ForeignKey("questions.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("parts", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("total_points", sa.Float(), nullable=False, server_default="0"),
        sa.Column("source", sa.Text(), nullable=False, server_default="ai"),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("drafted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by", sa.Text(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade():
    op.drop_table("question_rubrics")
    op.drop_table("teacher_grading_runs")
    for name, _ in reversed(ITEM_COLUMNS):
        op.drop_column("teacher_submission_items", name)
    op.drop_column("teacher_submissions", "graded_at")
    op.drop_column("teacher_submissions", "total_score")
    op.drop_column("teacher_assignments", "results_released_at")
