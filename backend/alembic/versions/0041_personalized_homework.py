"""Personalized homework: one paper per student, and the drafting settings.

Additive only: a nullable settings column on assignments and a new table.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0041_personalized_homework"
down_revision = "0040_drop_teacher_answer_sheets"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("teacher_assignments", sa.Column("settings", postgresql.JSONB(), nullable=True))
    op.create_table(
        "teacher_student_papers",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("assignment_id", sa.Text(), sa.ForeignKey("teacher_assignments.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("student_id", sa.Text(), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("items", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("question_snapshot", postgresql.JSONB(), nullable=True),
        sa.Column("delivery", sa.Text(), nullable=False, server_default="paper"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("assignment_id", "student_id", name="uq_student_paper_assignment_student"),
    )
    op.create_index("ix_teacher_student_papers_student", "teacher_student_papers", ["student_id"])
    op.execute("CREATE TRIGGER reject_erased_student_write BEFORE INSERT OR UPDATE ON teacher_student_papers "
               "FOR EACH ROW EXECUTE FUNCTION reject_erased_student_write()")


def downgrade():
    op.drop_table("teacher_student_papers")
    op.drop_column("teacher_assignments", "settings")
