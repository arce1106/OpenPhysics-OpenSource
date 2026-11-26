"""add_reviewed_at_to_student_answers

Revision ID: 6b2a5d9f8c31
Revises: 21b01f3e024c
Create Date: 2026-05-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6b2a5d9f8c31'
down_revision: Union[str, None] = '21b01f3e024c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('student_answers', sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('student_answers', 'reviewed_at')
