"""add streak and activity tracking to student_xp

Revision ID: 0002b2c3d4e5
Revises: 0001a1b2c3d4
Create Date: 2026-05-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0002b2c3d4e5"
down_revision: Union[str, None] = "0001a1b2c3d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("student_xp", sa.Column("streak_days", sa.Integer(), server_default="0"))
    op.add_column("student_xp", sa.Column("last_activity_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("student_xp", "last_activity_date")
    op.drop_column("student_xp", "streak_days")
