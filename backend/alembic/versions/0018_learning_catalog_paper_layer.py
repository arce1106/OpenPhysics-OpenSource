"""add learning catalog topic paper layer

Revision ID: 0018b9c0d1e2
Revises: 0017a8b9c0d1
"""

from typing import Sequence, Union

from alembic import op


revision: str = "0018b9c0d1e2"
down_revision: Union[str, None] = "0017a8b9c0d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint(
        "ck_learning_catalog_node_evidence_layer",
        "learning_catalog_node_evidence",
        type_="check",
    )
    op.create_check_constraint(
        "ck_learning_catalog_node_evidence_layer",
        "learning_catalog_node_evidence",
        "layer IN ('diagnostic', 'foundation', 'breakthrough', 'transfer', 'paper')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_learning_catalog_node_evidence_layer",
        "learning_catalog_node_evidence",
        type_="check",
    )
    op.create_check_constraint(
        "ck_learning_catalog_node_evidence_layer",
        "learning_catalog_node_evidence",
        "layer IN ('diagnostic', 'foundation', 'breakthrough', 'transfer')",
    )
