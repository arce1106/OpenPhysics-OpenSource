"""add student web login tickets

Revision ID: 0008b8c9d0e1
Revises: 0007a7b8c9d0
Create Date: 2026-06-21
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0008b8c9d0e1"
down_revision: Union[str, None] = "0007a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "student_web_login_tickets",
        sa.Column("ticket_hash", sa.Text(), nullable=False),
        sa.Column("student_id", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["student_id"], ["students.id"]),
        sa.PrimaryKeyConstraint("ticket_hash"),
    )
    op.create_index("ix_student_web_login_tickets_student_id", "student_web_login_tickets", ["student_id"])
    op.create_index("ix_student_web_login_tickets_expires_at", "student_web_login_tickets", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_student_web_login_tickets_expires_at", table_name="student_web_login_tickets")
    op.drop_index("ix_student_web_login_tickets_student_id", table_name="student_web_login_tickets")
    op.drop_table("student_web_login_tickets")
