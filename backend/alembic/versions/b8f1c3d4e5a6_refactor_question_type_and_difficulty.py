"""refactor_question_type_and_difficulty_tier

Revision ID: b8f1c3d4e5a6
Revises: 14a720c75c10
Create Date: 2026-05-02 10:00:00.000000

Replace question_type enum (4 values) with 9 proper Chinese physics types.
Replace difficulty_tier enum (3 values) with 5 standard difficulty levels.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b8f1c3d4e5a6'
down_revision: Union[str, None] = '14a720c75c10'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Detach columns from old enums by converting to text
    op.execute("ALTER TABLE questions ALTER COLUMN question_type TYPE text")
    op.execute("ALTER TABLE questions ALTER COLUMN difficulty_tier TYPE text")

    # 2. Set existing values to NULL (old types don't map cleanly to new taxonomy)
    op.execute("UPDATE questions SET question_type = NULL, difficulty_tier = NULL")

    # 3. Drop old enum types
    op.execute("DROP TYPE IF EXISTS questiontype")
    op.execute("DROP TYPE IF EXISTS difficultytier")

    # 4. Create new enums
    op.execute("""
        CREATE TYPE questiontype AS ENUM (
            'single_choice',
            'multiple_choice',
            'true_false',
            'fill_in_blank',
            'knowledge_fill_in_blank',
            'experiment',
            'graph_construction',
            'problem_solving',
            'comprehensive'
        )
    """)
    op.execute("""
        CREATE TYPE difficultytier AS ENUM (
            'easy',
            'moderate_easy',
            'medium',
            'moderate_hard',
            'hard'
        )
    """)

    # 5. Convert columns to new enum types
    op.execute(
        "ALTER TABLE questions ALTER COLUMN question_type "
        "TYPE questiontype USING question_type::questiontype"
    )
    op.execute(
        "ALTER TABLE questions ALTER COLUMN difficulty_tier "
        "TYPE difficultytier USING difficulty_tier::difficultytier"
    )


def downgrade() -> None:
    # Convert back to text, drop new enums, recreate old enums, convert back
    op.execute("ALTER TABLE questions ALTER COLUMN question_type TYPE text")
    op.execute("ALTER TABLE questions ALTER COLUMN difficulty_tier TYPE text")
    op.execute("UPDATE questions SET question_type = NULL, difficulty_tier = NULL")
    op.execute("DROP TYPE IF EXISTS questiontype")
    op.execute("DROP TYPE IF EXISTS difficultytier")
    op.execute("""
        CREATE TYPE questiontype AS ENUM (
            'conceptual_judgment',
            'calculation',
            'graph_analysis',
            'short_answer'
        )
    """)
    op.execute("""
        CREATE TYPE difficultytier AS ENUM (
            'foundation',
            'reinforcement',
            'challenge'
        )
    """)
    op.execute(
        "ALTER TABLE questions ALTER COLUMN question_type "
        "TYPE questiontype USING question_type::questiontype"
    )
    op.execute(
        "ALTER TABLE questions ALTER COLUMN difficulty_tier "
        "TYPE difficultytier USING difficulty_tier::difficultytier"
    )
