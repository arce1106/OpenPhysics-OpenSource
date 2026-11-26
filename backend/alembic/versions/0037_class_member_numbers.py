"""Class-roster student numbers, written by students on paper homework.

Additive only: one nullable column and a partial unique index per class.
"""
from alembic import op
import sqlalchemy as sa

revision = "0037_class_member_numbers"
down_revision = "0036_teacher_assignments"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("teacher_class_members", sa.Column("student_number", sa.Text(), nullable=True))
    op.create_index(
        "uq_teacher_class_member_number", "teacher_class_members", ["class_id", "student_number"],
        unique=True, postgresql_where=sa.text("student_number IS NOT NULL"),
    )


def downgrade():
    op.drop_index("uq_teacher_class_member_number", table_name="teacher_class_members")
    op.drop_column("teacher_class_members", "student_number")
