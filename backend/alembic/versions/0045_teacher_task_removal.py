"""Remove homework from active management without erasing learning records."""
from alembic import op
import sqlalchemy as sa

revision = "0045_teacher_task_removal"
down_revision = "0044_teacher_snapshots"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("teacher_assignments", sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column("teacher_assignments", "removed_at")
