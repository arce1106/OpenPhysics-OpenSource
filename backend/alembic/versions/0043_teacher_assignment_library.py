"""Papers and personalized settings belong to the teacher; each class gets its own copy.

A row without a class is the teacher's paper (a class test) or settings (a personalized
homework). Assigning it creates a class row pointing back through source_id, so the
existing collect, review and report flows keep working per class.

Existing data: class test drafts become papers; every other class row gets a paper or
settings row of its own and points to it.
"""
import uuid

from alembic import op
import sqlalchemy as sa

revision = "0043_teacher_assignment_library"
down_revision = "0042_app_homework_submissions"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("teacher_assignments", "class_id", existing_type=sa.Text(), nullable=True)
    op.add_column("teacher_assignments", sa.Column(
        "source_id", sa.Text(), sa.ForeignKey("teacher_assignments.id", ondelete="SET NULL"), nullable=True,
    ))
    op.create_index("ix_teacher_assignments_source", "teacher_assignments", ["source_id"])
    op.create_index("ix_teacher_assignments_teacher_created", "teacher_assignments", ["teacher_id", "created_at"])

    bind = op.get_bind()
    bind.execute(sa.text(
        "UPDATE teacher_assignments SET class_id = NULL WHERE kind = 'test' AND status = 'draft'"
    ))
    rows = bind.execute(sa.text(
        "SELECT id, teacher_id, kind, title, items, settings, created_at FROM teacher_assignments "
        "WHERE class_id IS NOT NULL AND source_id IS NULL"
    )).mappings().all()
    for row in rows:
        source_id = f"a_{uuid.uuid4().hex}"
        bind.execute(sa.text(
            "INSERT INTO teacher_assignments (id, teacher_id, class_id, kind, title, status, items, settings, "
            "created_at, updated_at) VALUES (:id, :teacher_id, NULL, :kind, :title, 'draft', "
            "CAST(:items AS JSONB), CAST(:settings AS JSONB), :created_at, :created_at)"
        ), {
            "id": source_id, "teacher_id": row["teacher_id"], "kind": row["kind"], "title": row["title"],
            # A personalized homework keeps only its settings; each class drafts its own papers.
            "items": "[]" if row["kind"] == "personalized" else _json(row["items"]),
            "settings": _json(row["settings"]) if row["settings"] is not None else None,
            "created_at": row["created_at"],
        })
        bind.execute(sa.text("UPDATE teacher_assignments SET source_id = :source WHERE id = :id"),
                     {"source": source_id, "id": row["id"]})


def _json(value) -> str:
    import json

    return json.dumps(value, ensure_ascii=False)


def downgrade():
    # Rows without a class cannot go back under the old NOT NULL rule: papers never assigned are dropped.
    op.execute("DELETE FROM teacher_assignments WHERE class_id IS NULL")
    op.drop_index("ix_teacher_assignments_teacher_created", table_name="teacher_assignments")
    op.drop_index("ix_teacher_assignments_source", table_name="teacher_assignments")
    op.drop_column("teacher_assignments", "source_id")
    op.alter_column("teacher_assignments", "class_id", existing_type=sa.Text(), nullable=False)
