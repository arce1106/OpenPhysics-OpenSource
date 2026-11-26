"""add optional student profile fields

Revision ID: 0004d4e5f6a7
Revises: 0003_add_learning_video_curations
Create Date: 2026-06-19
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0004d4e5f6a7"
down_revision: Union[str, None] = "0003c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("students", sa.Column("phone", sa.Text(), nullable=True))
    op.add_column("students", sa.Column("grade", sa.Text(), nullable=True))
    op.add_column(
        "students",
        sa.Column("account_source", sa.Text(), nullable=False, server_default="admin"),
    )
    op.create_index(op.f("ix_students_phone"), "students", ["phone"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_students_phone"), table_name="students")
    op.drop_column("students", "account_source")
    op.drop_column("students", "grade")
    op.drop_column("students", "phone")
