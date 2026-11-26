"""Keep minimal, versioned consent receipts and erase them with the account."""
from alembic import op
import sqlalchemy as sa

revision = "0033_privacy_consent"
down_revision = "0032_account_erasure_guards"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("student_privacy_consents",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("student_id", sa.Text(), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("scope", sa.Text(), nullable=False),
        sa.Column("version", sa.Text(), nullable=False),
        sa.Column("granted", sa.Boolean(), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index("ix_privacy_consent_student_scope_id", "student_privacy_consents", ["student_id", "scope", "id"])
    op.execute("CREATE TRIGGER reject_erased_student_write BEFORE INSERT OR UPDATE ON student_privacy_consents "
               "FOR EACH ROW EXECUTE FUNCTION reject_erased_student_write()")


def downgrade():
    op.drop_table("student_privacy_consents")
