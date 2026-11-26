"""add_difficulty_tier_to_questions

Revision ID: 14a720c75c10
Revises: ee6524f770a0
Create Date: 2026-04-28 09:30:40.437030

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '14a720c75c10'
down_revision: Union[str, None] = 'ee6524f770a0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_type WHERE typname = 'difficultytier'
            ) THEN
                CREATE TYPE difficultytier AS ENUM ('foundation', 'reinforcement', 'challenge');
            END IF;
        END
        $$;
    """)
    op.add_column(
        "questions",
        sa.Column("difficulty_tier", sa.Enum("foundation", "reinforcement", "challenge", name="difficultytier"), nullable=True),
    )
    op.create_index("ix_questions_difficulty_tier", "questions", ["difficulty_tier"])


def downgrade() -> None:
    op.drop_index("ix_questions_difficulty_tier", table_name="questions")
    op.drop_column("questions", "difficulty_tier")
    op.execute("DROP TYPE IF EXISTS difficultytier")
