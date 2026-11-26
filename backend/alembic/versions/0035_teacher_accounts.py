"""Teacher accounts, their classes and class membership.

Additive only. Membership rows carry student_id, so account erasure removes
them, and the erasure guard rejects late inserts for an erased student.
"""
from alembic import op
import sqlalchemy as sa

revision = "0035_teacher_accounts"
down_revision = "0034_grading_call_metering"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "teachers",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("username", sa.Text(), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("display_name", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="active"),
        sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("auth_version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_teachers_username", "teachers", ["username"], unique=True)
    op.create_table(
        "teacher_classes",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("teacher_id", sa.Text(), sa.ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("grade", sa.Text(), nullable=True),
        sa.Column("level", sa.Text(), nullable=False, server_default="standard"),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("teacher_id", "name", name="uq_teacher_class_name"),
    )
    op.create_index("ix_teacher_classes_teacher_id", "teacher_classes", ["teacher_id"])
    op.create_table(
        "teacher_class_members",
        sa.Column("class_id", sa.Text(), sa.ForeignKey("teacher_classes.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("student_id", sa.Text(), sa.ForeignKey("students.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_teacher_class_members_student", "teacher_class_members", ["student_id"])
    op.execute("CREATE TRIGGER reject_erased_student_write BEFORE INSERT OR UPDATE ON teacher_class_members "
               "FOR EACH ROW EXECUTE FUNCTION reject_erased_student_write()")


def downgrade():
    op.drop_table("teacher_class_members")
    op.drop_table("teacher_classes")
    op.drop_table("teachers")
