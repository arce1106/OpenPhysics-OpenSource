"""Collected paper homework, teacher AI metering and on-behalf consent receipts.

Additive only. Rows that carry student_id are removed by account erasure and
guarded against late writes for an erased student.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0038_teacher_scans"
down_revision = "0037_class_member_numbers"
branch_labels = None
depends_on = None

GUARDED = ("teacher_scan_pages", "teacher_submissions")


def upgrade():
    for column in ("source", "grantor", "recorded_by"):
        op.add_column("student_privacy_consents", sa.Column(column, sa.Text(), nullable=True))

    op.create_table(
        "teacher_scan_batches",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("assignment_id", sa.Text(), sa.ForeignKey("teacher_assignments.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("teacher_id", sa.Text(), sa.ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("sha256", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="queued"),
        sa.Column("page_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("processed_pages", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("assignment_id", "sha256", name="uq_scan_batch_file"),
    )
    op.create_index("ix_teacher_scan_batches_assignment_id", "teacher_scan_batches", ["assignment_id"])
    op.create_table(
        "teacher_scan_pages",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("batch_id", sa.Text(), sa.ForeignKey("teacher_scan_batches.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("assignment_id", sa.Text(), sa.ForeignKey("teacher_assignments.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("page_index", sa.Integer(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("copy_seq", sa.Integer(), nullable=True),
        sa.Column("student_id", sa.Text(), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=True),
        sa.Column("image_path", sa.Text(), nullable=True),
        sa.Column("recognized_number", sa.Text(), nullable=True),
        sa.Column("number_confidence", sa.Float(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default="ok"),
        sa.Column("issue", sa.Text(), nullable=True),
        sa.Column("layout", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("batch_id", "page_index", name="uq_scan_page_index"),
    )
    op.create_index("ix_teacher_scan_pages_assignment", "teacher_scan_pages", ["assignment_id"])
    op.create_index("ix_teacher_scan_pages_student", "teacher_scan_pages", ["student_id"])
    op.create_table(
        "teacher_submissions",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("assignment_id", sa.Text(), sa.ForeignKey("teacher_assignments.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("student_id", sa.Text(), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("ai_authorized", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("assignment_id", "student_id", name="uq_submission_assignment_student"),
    )
    op.create_index("ix_teacher_submissions_student", "teacher_submissions", ["student_id"])
    op.create_table(
        "teacher_submission_items",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("submission_id", sa.Text(), sa.ForeignKey("teacher_submissions.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("question_id", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("crop_path", sa.Text(), nullable=True),
        sa.Column("recognized_answer", sa.Text(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("answer", sa.Text(), nullable=True),
        sa.Column("is_correct", sa.Boolean(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.UniqueConstraint("submission_id", "number", name="uq_submission_item_number"),
    )
    op.create_table(
        "teacher_ai_calls",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("purpose", sa.Text(), nullable=False),
        sa.Column("image_hash", sa.Text(), nullable=False),
        sa.Column("assignment_id", sa.Text(), nullable=False),
        sa.Column("teacher_id", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("result", postgresql.JSONB(), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("estimated_cost", sa.Float(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_teacher_ai_calls_cache", "teacher_ai_calls", ["purpose", "image_hash"])
    op.create_index("ix_teacher_ai_calls_teacher_created", "teacher_ai_calls", ["teacher_id", "created_at"])
    op.create_index("ix_teacher_ai_calls_assignment", "teacher_ai_calls", ["assignment_id"])
    op.create_index("ix_teacher_ai_calls_created", "teacher_ai_calls", ["created_at"])
    for table in GUARDED:
        op.execute(f"CREATE TRIGGER reject_erased_student_write BEFORE INSERT OR UPDATE ON {table} "
                   "FOR EACH ROW EXECUTE FUNCTION reject_erased_student_write()")


def downgrade():
    op.drop_table("teacher_ai_calls")
    op.drop_table("teacher_submission_items")
    op.drop_table("teacher_submissions")
    op.drop_table("teacher_scan_pages")
    op.drop_table("teacher_scan_batches")
    for column in ("recorded_by", "grantor", "source"):
        op.drop_column("student_privacy_consents", column)
