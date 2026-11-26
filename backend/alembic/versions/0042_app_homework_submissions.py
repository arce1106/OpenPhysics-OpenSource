"""Submissions answered in the student app, beside scanned ones.

Additive only: a source column on teacher submissions, "scan" for existing rows.
"""
from alembic import op
import sqlalchemy as sa

revision = "0042_app_homework_submissions"
down_revision = "0041_personalized_homework"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("teacher_submissions", sa.Column("source", sa.Text(), nullable=False, server_default="scan"))


def downgrade():
    op.drop_column("teacher_submissions", "source")
