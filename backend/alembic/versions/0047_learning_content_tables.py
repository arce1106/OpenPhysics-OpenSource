"""Create learning cards and progress tables for a fresh self-hosted database."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0047_learning_content_tables"
down_revision = "0046_class_invitations"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    content_type = postgresql.ENUM("card", "slides", "simulation", "example", name="contenttype", create_type=False)
    content_source = postgresql.ENUM("curated", "ai_generated", name="contentsource", create_type=False)
    content_type.create(bind, checkfirst=True)
    content_source.create(bind, checkfirst=True)
    if not sa.inspect(bind).has_table("learning_contents"):
        op.create_table(
            "learning_contents",
            sa.Column("id", sa.Text(), primary_key=True),
            sa.Column("knowledge_point_id", sa.Text(), sa.ForeignKey("knowledge_points.id"), nullable=False),
            sa.Column("content_type", content_type, nullable=False),
            sa.Column("title", sa.Text(), nullable=False),
            sa.Column("body", postgresql.JSONB(), nullable=False),
            sa.Column("source", content_source, nullable=False, server_default="curated"),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True)),
            sa.UniqueConstraint("knowledge_point_id", "content_type", "version", name="uq_kp_content_version"),
        )
        op.create_index("ix_learning_contents_knowledge_point_id", "learning_contents", ["knowledge_point_id"])
    if not sa.inspect(bind).has_table("learning_progress"):
        op.create_table(
            "learning_progress",
            sa.Column("student_id", sa.Text(), primary_key=True),
            sa.Column("knowledge_point_id", sa.Text(), sa.ForeignKey("knowledge_points.id"), primary_key=True),
            sa.Column("content_id", sa.Text(), sa.ForeignKey("learning_contents.id"), primary_key=True),
            sa.Column("content_type", content_type, primary_key=True),
            sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("time_spent_seconds", sa.Integer(), nullable=False, server_default="0"),
        )
    # Revision 0032 skips absent tables; newly created student progress needs the same erasure guard.
    op.execute("DROP TRIGGER IF EXISTS reject_erased_student_write ON learning_progress")
    op.execute(
        "CREATE TRIGGER reject_erased_student_write BEFORE INSERT OR UPDATE ON learning_progress "
        "FOR EACH ROW EXECUTE FUNCTION reject_erased_student_write()"
    )


def downgrade():
    op.drop_table("learning_progress")
    op.drop_table("learning_contents")
    postgresql.ENUM(name="contentsource").drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="contenttype").drop(op.get_bind(), checkfirst=True)
