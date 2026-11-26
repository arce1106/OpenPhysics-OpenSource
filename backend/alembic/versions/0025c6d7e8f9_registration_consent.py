"""Store minimal versioned self-registration declarations; existing accounts unchanged."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0025c6d7e8f9"
down_revision = "0024b5c6d7e8"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("students", sa.Column("registration_consent", postgresql.JSONB(), nullable=True))


def downgrade():
    op.drop_column("students", "registration_consent")
