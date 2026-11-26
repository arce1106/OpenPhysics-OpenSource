"""Version student credentials without invalidating unchanged legacy sessions."""

from alembic import op
import sqlalchemy as sa

revision = "0024b5c6d7e8"
down_revision = '0019c0d1e2f3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("students", "student_web_login_tickets"):
        op.add_column(table, sa.Column("auth_version", sa.Integer(), server_default="0", nullable=False))


def downgrade() -> None:
    for table in ("student_web_login_tickets", "students"):
        op.drop_column(table, "auth_version")
