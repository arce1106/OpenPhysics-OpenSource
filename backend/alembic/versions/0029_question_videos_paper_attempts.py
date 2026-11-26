"""Question videos and durable fixed-paper submissions."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
revision = "0029_question_videos_papers"
down_revision = "0028_student_ai_execution"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("question_videos",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("question_id", sa.Text(), sa.ForeignKey("questions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("sha256", sa.Text(), nullable=False),
        sa.Column("duration_seconds", sa.Integer(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="approved"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index("ix_question_videos_question_id", "question_videos", ["question_id"], unique=True)
    op.create_table("teacher_paper_attempts",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("student_id", sa.Text(), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("paper_id", sa.Text(), nullable=False),
        sa.Column("catalog_code", sa.Text(), nullable=False),
        sa.Column("node_id", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("question_ids", postgresql.JSONB(), nullable=False),
        sa.Column("questions", postgresql.JSONB(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="in_progress"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("submitted_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)))
    op.create_index("ix_teacher_paper_student_paper", "teacher_paper_attempts", ["student_id", "paper_id", "created_at"])
    op.create_index("uq_teacher_paper_active", "teacher_paper_attempts", ["student_id", "paper_id"], unique=True,
                    postgresql_where=sa.text("status != 'completed'"))
    op.add_column("student_answers", sa.Column("teacher_paper_attempt_id", sa.Text(), nullable=True))
    op.create_foreign_key("fk_answer_teacher_paper", "student_answers", "teacher_paper_attempts", ["teacher_paper_attempt_id"], ["id"])
    op.create_index("ix_student_answers_teacher_paper_attempt_id", "student_answers", ["teacher_paper_attempt_id"])
    op.create_unique_constraint("uq_teacher_paper_answer", "student_answers", ["teacher_paper_attempt_id", "question_id"])


def downgrade():
    op.drop_constraint("uq_teacher_paper_answer", "student_answers", type_="unique")
    op.drop_index("ix_student_answers_teacher_paper_attempt_id", table_name="student_answers")
    op.drop_constraint("fk_answer_teacher_paper", "student_answers", type_="foreignkey")
    op.drop_column("student_answers", "teacher_paper_attempt_id")
    op.drop_table("teacher_paper_attempts")
    op.drop_table("question_videos")
