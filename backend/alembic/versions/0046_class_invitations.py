"""Teacher invitation codes and student membership receipts (additive)."""
from alembic import op
import sqlalchemy as sa

revision = "0046_class_invitations"
down_revision = "0045_teacher_task_removal"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "teacher_class_invitations",
        sa.Column("class_id", sa.Text(), sa.ForeignKey("teacher_classes.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("code_hash", sa.Text(), nullable=False, unique=True),
        sa.Column("encrypted_code", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "teacher_class_membership_events",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("class_id", sa.Text(), sa.ForeignKey("teacher_classes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_id", sa.Text(), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("invitation_version", sa.Integer(), nullable=False),
        sa.Column("disclosure_version", sa.Text()),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_class_membership_events_student", "teacher_class_membership_events", ["class_id", "student_id", "occurred_at"])
    op.execute("CREATE TRIGGER reject_erased_student_write BEFORE INSERT OR UPDATE ON teacher_class_membership_events "
               "FOR EACH ROW EXECUTE FUNCTION reject_erased_student_write()")


def downgrade():
    op.drop_table("teacher_class_membership_events")
    op.drop_table("teacher_class_invitations")
