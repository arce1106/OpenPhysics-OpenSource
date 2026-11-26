"""add reusable learning catalogs and topic mappings

Revision ID: 0016f7a8b9c0
Revises: 0012f3a4b5c6
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0016f7a8b9c0"
down_revision: Union[str, None] = "0012f3a4b5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "learning_catalogs",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "config",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("code", name="uq_learning_catalogs_code"),
    )
    op.create_table(
        "learning_catalog_nodes",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column(
            "catalog_id",
            sa.Text(),
            sa.ForeignKey("learning_catalogs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "parent_id",
            sa.Text(),
            sa.ForeignKey("learning_catalog_nodes.id", ondelete="CASCADE"),
        ),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("node_type", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "config",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.UniqueConstraint(
            "catalog_id",
            "code",
            name="uq_learning_catalog_nodes_catalog_code",
        ),
        sa.CheckConstraint(
            "node_type IN ('volume', 'chapter', 'section', 'knowledge_point', 'block', 'topic')",
            name="ck_learning_catalog_nodes_type",
        ),
    )
    op.create_index(
        "ix_learning_catalog_nodes_catalog_parent_order",
        "learning_catalog_nodes",
        ["catalog_id", "parent_id", "sort_order"],
    )
    op.create_table(
        "learning_catalog_node_knowledge_points",
        sa.Column(
            "node_id",
            sa.Text(),
            sa.ForeignKey("learning_catalog_nodes.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "knowledge_point_id",
            sa.Text(),
            sa.ForeignKey("knowledge_points.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("role", sa.Text(), nullable=False, server_default="core"),
        sa.Column("weight", sa.Float(), nullable=False, server_default="1"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint(
            "role IN ('core', 'supporting')",
            name="ck_learning_catalog_node_kps_role",
        ),
    )
    op.create_index(
        "ix_learning_catalog_node_kps_kp_node",
        "learning_catalog_node_knowledge_points",
        ["knowledge_point_id", "node_id"],
    )
    op.create_table(
        "learning_catalog_node_label_rules",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "node_id",
            sa.Text(),
            sa.ForeignKey("learning_catalog_nodes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("label_type", sa.Text(), nullable=False),
        sa.Column("label_id", sa.Text(), nullable=False),
        sa.Column("action", sa.Text(), nullable=False, server_default="include"),
        sa.Column("weight", sa.Float(), nullable=False, server_default="1"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint(
            "node_id",
            "label_type",
            "label_id",
            "action",
            name="uq_learning_catalog_node_label_rule",
        ),
        sa.CheckConstraint(
            "action IN ('include', 'exclude')",
            name="ck_learning_catalog_node_label_rules_action",
        ),
    )
    op.create_index(
        "ix_learning_catalog_node_label_rules_lookup",
        "learning_catalog_node_label_rules",
        ["label_type", "label_id", "node_id"],
    )
    op.create_table(
        "learning_catalog_node_question_overrides",
        sa.Column(
            "node_id",
            sa.Text(),
            sa.ForeignKey("learning_catalog_nodes.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "question_id",
            sa.Text(),
            sa.ForeignKey("questions.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("action", sa.Text(), nullable=False, server_default="include"),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("note", sa.Text()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "action IN ('include', 'exclude')",
            name="ck_learning_catalog_node_question_overrides_action",
        ),
    )
    op.create_index(
        "ix_learning_catalog_node_question_overrides_question",
        "learning_catalog_node_question_overrides",
        ["question_id", "node_id"],
    )
    op.create_index(
        "ix_question_labels_type_label_question",
        "question_labels",
        ["label_type", "label_id", "question_id"],
    )
    op.create_index(
        "ix_question_labels_question_id",
        "question_labels",
        ["question_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_question_labels_question_id", table_name="question_labels")
    op.drop_index(
        "ix_question_labels_type_label_question",
        table_name="question_labels",
    )
    op.drop_table("learning_catalog_node_question_overrides")
    op.drop_table("learning_catalog_node_label_rules")
    op.drop_table("learning_catalog_node_knowledge_points")
    op.drop_table("learning_catalog_nodes")
    op.drop_table("learning_catalogs")
