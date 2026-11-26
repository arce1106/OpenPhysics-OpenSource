"""add isolated learning catalog topic evidence

Revision ID: 0017a8b9c0d1
Revises: 0016f7a8b9c0
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0017a8b9c0d1"
down_revision: Union[str, None] = "0016f7a8b9c0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "learning_catalog_node_evidence",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("student_id", sa.Text(), nullable=False),
        sa.Column(
            "node_id",
            sa.Text(),
            sa.ForeignKey("learning_catalog_nodes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "answer_id",
            sa.Integer(),
            sa.ForeignKey("student_answers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "question_id",
            sa.Text(),
            sa.ForeignKey("questions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "knowledge_point_id",
            sa.Text(),
            sa.ForeignKey("knowledge_points.id", ondelete="SET NULL"),
        ),
        sa.Column("layer", sa.Text(), nullable=False),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "student_id",
            "node_id",
            "answer_id",
            name="uq_learning_catalog_node_evidence_answer",
        ),
        sa.CheckConstraint(
            "layer IN ('diagnostic', 'foundation', 'breakthrough', 'transfer')",
            name="ck_learning_catalog_node_evidence_layer",
        ),
        sa.CheckConstraint(
            "score >= 0 AND score <= 1",
            name="ck_learning_catalog_node_evidence_score",
        ),
    )
    op.create_index(
        "ix_learning_catalog_node_evidence_student_node_created",
        "learning_catalog_node_evidence",
        ["student_id", "node_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_table("learning_catalog_node_evidence")
