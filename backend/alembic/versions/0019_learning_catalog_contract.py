"""align Gaokao catalog naming and evidence contract

Revision ID: 0019c0d1e2f3
Revises: 0018b9c0d1e2
"""

from typing import Sequence, Union

from alembic import op


revision: str = "0019c0d1e2f3"
down_revision: Union[str, None] = "0018b9c0d1e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE learning_catalogs
        SET name = '高考复习', updated_at = now()
        WHERE code = 'gaokao_review' AND name = '高考物理复习'
        """
    )
    op.execute(
        """
        UPDATE learning_catalogs
        SET config = jsonb_set(
            COALESCE(config, '{}'::jsonb),
            '{mastery_source}',
            '"catalog_topic_evidence"'::jsonb,
            true
        ), updated_at = now()
        WHERE code = 'gaokao_review'
          AND config->>'mastery_source' = 'knowledge_point_aggregation'
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE learning_catalogs
        SET name = '高考物理复习', updated_at = now()
        WHERE code = 'gaokao_review' AND name = '高考复习'
        """
    )
    op.execute(
        """
        UPDATE learning_catalogs
        SET config = jsonb_set(
            COALESCE(config, '{}'::jsonb),
            '{mastery_source}',
            '"knowledge_point_aggregation"'::jsonb,
            true
        ), updated_at = now()
        WHERE code = 'gaokao_review'
          AND config->>'mastery_source' = 'catalog_topic_evidence'
        """
    )
