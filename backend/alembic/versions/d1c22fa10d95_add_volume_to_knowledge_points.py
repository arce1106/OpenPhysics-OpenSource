"""add_volume_to_knowledge_points

Revision ID: d1c22fa10d95
Revises: c7c6d6545046
Create Date: 2026-04-27 01:31:30.485929

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd1c22fa10d95'
down_revision: Union[str, None] = 'c7c6d6545046'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('knowledge_points', sa.Column('volume', sa.Text(), nullable=True))
    op.execute("UPDATE knowledge_points SET volume = '必修 第一册'")


def downgrade() -> None:
    op.drop_column('knowledge_points', 'volume')
