"""Drop the per-student PDF answer sheets.

The homework printed from the teacher app is itself the answer sheet and scans are
read from its printed boxes, so the separate QR-coded sheets were never used.
Downgrade restores the empty table as 0036 created it.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0040_drop_teacher_answer_sheets"
down_revision = "0039_teacher_grading"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_table("teacher_answer_sheets")


def downgrade():
    op.create_table(
        "teacher_answer_sheets",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("assignment_id", sa.Text(), sa.ForeignKey("teacher_assignments.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("student_id", sa.Text(), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("layout", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("assignment_id", "student_id", name="uq_answer_sheet_assignment_student"),
    )
    op.create_index("ix_teacher_answer_sheets_student", "teacher_answer_sheets", ["student_id"])
    op.execute("CREATE TRIGGER reject_erased_student_write BEFORE INSERT OR UPDATE ON teacher_answer_sheets "
               "FOR EACH ROW EXECUTE FUNCTION reject_erased_student_write()")
