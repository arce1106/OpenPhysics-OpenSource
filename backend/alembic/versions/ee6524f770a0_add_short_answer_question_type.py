"""add_short_answer_question_type

Revision ID: ee6524f770a0
Revises: d1c22fa10d95
Create Date: 2026-04-27 18:00:15.791649

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ee6524f770a0'
down_revision: Union[str, None] = 'd1c22fa10d95'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_enum
                WHERE enumtypid = 'questiontype'::regtype
                  AND enumlabel = 'short_answer'
            ) THEN
                ALTER TYPE questiontype ADD VALUE 'short_answer';
            END IF;
        END
        $$;
    """)


def downgrade() -> None:
    # PostgreSQL does not support removing values from enum types.
    # The downgrade intentionally leaves 'short_answer' in the enum.
    pass
