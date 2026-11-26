"""add_grading_result_to_student_answers

Revision ID: f3a9c1b2d4e5
Revises: 8c1d5e6f7a20
Create Date: 2026-05-11 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "f3a9c1b2d4e5"
down_revision: Union[str, None] = "8c1d5e6f7a20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "student_answers",
        sa.Column(
            "grading_result",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("student_answers", "grading_result")
