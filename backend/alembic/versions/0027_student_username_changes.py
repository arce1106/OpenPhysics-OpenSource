"""Track successful username changes for a rolling annual quota."""
from alembic import op
import sqlalchemy as sa

revision = "0027_student_username_changes"
down_revision = "0025c6d7e8f9"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "student_username_changes",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("student_id", sa.Text(), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("changed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_student_username_changes_student_time", "student_username_changes", ["student_id", "changed_at"])


def downgrade():
    op.drop_index("ix_student_username_changes_student_time", table_name="student_username_changes")
    op.drop_table("student_username_changes")
