"""add idempotency key to student answers

Revision ID: 0012f3a4b5c6
Revises: 0011e2f3a4b5
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0012f3a4b5c6"
down_revision: Union[str, None] = "0011e2f3a4b5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("student_answers", sa.Column("submission_id", sa.Text(), nullable=True))
    op.create_index(
        "ix_student_answers_submission_id",
        "student_answers",
        ["submission_id"],
        unique=False,
    )
    op.create_unique_constraint(
        "uq_student_answer_submission",
        "student_answers",
        ["student_id", "submission_id", "question_id"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_student_answer_submission", "student_answers", type_="unique")
    op.drop_index("ix_student_answers_submission_id", table_name="student_answers")
    op.drop_column("student_answers", "submission_id")
