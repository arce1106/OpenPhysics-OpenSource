"""add_learning_video_curations

Revision ID: 0003c3d4e5f6
Revises: 0002b2c3d4e5
Create Date: 2026-05-17 22:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0003c3d4e5f6"
down_revision: Union[str, None] = "0002b2c3d4e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    video_type = postgresql.ENUM("lecture", "experiment", name="videocurationtype", create_type=False)
    video_type.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "learning_video_curations",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("knowledge_point_id", sa.Text(), nullable=False),
        sa.Column("video_type", video_type, nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("uploader", sa.Text(), nullable=True),
        sa.Column("duration", sa.Text(), nullable=True),
        sa.Column("cover_url", sa.Text(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("match_focus", sa.Text(), nullable=True),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["knowledge_point_id"], ["knowledge_points.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_learning_video_curations_knowledge_point_id",
        "learning_video_curations",
        ["knowledge_point_id"],
    )
    op.create_index(
        "ix_learning_video_curations_video_type",
        "learning_video_curations",
        ["video_type"],
    )


def downgrade() -> None:
    op.drop_index("ix_learning_video_curations_video_type", table_name="learning_video_curations")
    op.drop_index("ix_learning_video_curations_knowledge_point_id", table_name="learning_video_curations")
    op.drop_table("learning_video_curations")
    sa.Enum(name="videocurationtype").drop(op.get_bind(), checkfirst=True)
