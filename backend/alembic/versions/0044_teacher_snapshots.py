"""Freeze what a published homework was collected and graded against.

``roster``: each student's number when the homework went out, so renumbering a class later
never sends a scanned paper to someone else. ``rubric_snapshot``: the scoring rubrics in
force when grading began, so an administrator approving one mid-review does not change how
that homework is scored.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0044_teacher_snapshots"
down_revision = "0043_teacher_assignment_library"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("teacher_assignments", sa.Column("roster", JSONB(), nullable=True))
    op.add_column("teacher_assignments", sa.Column("rubric_snapshot", JSONB(), nullable=True))


def downgrade():
    op.drop_column("teacher_assignments", "rubric_snapshot")
    op.drop_column("teacher_assignments", "roster")
