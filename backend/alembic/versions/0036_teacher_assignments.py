"""Teacher papers and per-student printed answer sheets.

Additive only. Answer sheets carry student_id, so account erasure removes them,
and the erasure guard rejects late inserts for an erased student.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0036_teacher_assignments"
down_revision = "0035_teacher_accounts"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "teacher_assignments",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("teacher_id", sa.Text(), sa.ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("class_id", sa.Text(), sa.ForeignKey("teacher_classes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False, server_default="test"),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="draft"),
        sa.Column("items", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("question_snapshot", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_teacher_assignments_teacher_id", "teacher_assignments", ["teacher_id"])
    op.create_index("ix_teacher_assignments_class_created", "teacher_assignments", ["class_id", "created_at"])
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


def downgrade():
    op.drop_table("teacher_answer_sheets")
    op.drop_table("teacher_assignments")
