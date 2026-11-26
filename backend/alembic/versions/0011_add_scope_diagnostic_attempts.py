"""add scope diagnostic attempts

Revision ID: 0011e2f3a4b5
Revises: 0010d1e2f3a4
Create Date: 2026-06-27
"""

import json
from typing import Sequence, Union
from uuid import uuid4

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0011e2f3a4b5"
down_revision: Union[str, None] = "0010d1e2f3a4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "student_scope_diagnostic_attempts",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("student_id", sa.Text(), nullable=False),
        sa.Column("scope_type", sa.Text(), nullable=False),
        sa.Column("scope_id", sa.Text(), nullable=False),
        sa.Column("scope_name", sa.Text(), nullable=False),
        sa.Column("diagnostic_type", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("question_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("answer_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("correct_count", sa.Integer(), nullable=False),
        sa.Column("total_count", sa.Integer(), nullable=False),
        sa.Column("weak_count", sa.Integer(), nullable=False),
        sa.Column("weak_kp_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("recommendation", sa.Text(), nullable=True),
        sa.Column("feedback", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["student_id"], ["students.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_student_scope_diagnostic_attempts_student_id", "student_scope_diagnostic_attempts", ["student_id"])
    op.create_index("ix_student_scope_diagnostic_attempts_scope_id", "student_scope_diagnostic_attempts", ["scope_id"])

    op.create_table(
        "student_scope_diagnostic_kp_results",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("attempt_id", sa.Text(), nullable=False),
        sa.Column("student_id", sa.Text(), nullable=False),
        sa.Column("kp_id", sa.Text(), nullable=False),
        sa.Column("kp_name", sa.Text(), nullable=False),
        sa.Column("group_id", sa.Text(), nullable=True),
        sa.Column("group_name", sa.Text(), nullable=True),
        sa.Column("correct_count", sa.Integer(), nullable=False),
        sa.Column("total_count", sa.Integer(), nullable=False),
        sa.Column("mastery_before", sa.Float(), nullable=False),
        sa.Column("mastery_after", sa.Float(), nullable=False),
        sa.Column("is_weak", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["attempt_id"], ["student_scope_diagnostic_attempts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["student_id"], ["students.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_student_scope_diagnostic_kp_results_attempt_id", "student_scope_diagnostic_kp_results", ["attempt_id"])
    op.create_index("ix_student_scope_diagnostic_kp_results_student_id", "student_scope_diagnostic_kp_results", ["student_id"])
    op.create_index("ix_student_scope_diagnostic_kp_results_kp_id", "student_scope_diagnostic_kp_results", ["kp_id"])

    op.add_column("student_improvement_plans", sa.Column("diagnostic_attempt_id", sa.Text(), nullable=True))
    op.create_index("ix_student_improvement_plans_diagnostic_attempt_id", "student_improvement_plans", ["diagnostic_attempt_id"])
    op.create_foreign_key(
        "fk_student_improvement_plans_diagnostic_attempt_id",
        "student_improvement_plans",
        "student_scope_diagnostic_attempts",
        ["diagnostic_attempt_id"],
        ["id"],
        ondelete="SET NULL",
    )
    _backfill_attempts_from_plans()


def downgrade() -> None:
    op.drop_constraint(
        "fk_student_improvement_plans_diagnostic_attempt_id",
        "student_improvement_plans",
        type_="foreignkey",
    )
    op.drop_index("ix_student_improvement_plans_diagnostic_attempt_id", table_name="student_improvement_plans")
    op.drop_column("student_improvement_plans", "diagnostic_attempt_id")
    op.drop_index("ix_student_scope_diagnostic_kp_results_kp_id", table_name="student_scope_diagnostic_kp_results")
    op.drop_index("ix_student_scope_diagnostic_kp_results_student_id", table_name="student_scope_diagnostic_kp_results")
    op.drop_index("ix_student_scope_diagnostic_kp_results_attempt_id", table_name="student_scope_diagnostic_kp_results")
    op.drop_table("student_scope_diagnostic_kp_results")
    op.drop_index("ix_student_scope_diagnostic_attempts_scope_id", table_name="student_scope_diagnostic_attempts")
    op.drop_index("ix_student_scope_diagnostic_attempts_student_id", table_name="student_scope_diagnostic_attempts")
    op.drop_table("student_scope_diagnostic_attempts")


def _backfill_attempts_from_plans() -> None:
    bind = op.get_bind()
    plans = bind.execute(sa.text(
        """
        SELECT id, student_id, scope_type, scope_id, scope_name, correct_count, total_count,
               weak_count, source_result, created_at
        FROM student_improvement_plans
        WHERE source_result IS NOT NULL AND diagnostic_attempt_id IS NULL
        """
    )).mappings().all()
    for plan in plans:
        source_result = plan["source_result"] or {}
        attempt_id = uuid4().hex
        weak_kp_ids = source_result.get("weak_kp_ids") or []
        kp_results = source_result.get("kp_results") or []
        bind.execute(sa.text(
            """
            INSERT INTO student_scope_diagnostic_attempts (
                id, student_id, scope_type, scope_id, scope_name, diagnostic_type, status,
                question_ids, answer_ids, result, correct_count, total_count, weak_count,
                weak_kp_ids, recommendation, feedback, created_at, submitted_at
            ) VALUES (
                :id, :student_id, :scope_type, :scope_id, :scope_name, 'scope', 'submitted',
                CAST(:question_ids AS jsonb), CAST(:answer_ids AS jsonb), CAST(:result AS jsonb),
                :correct_count, :total_count, :weak_count, CAST(:weak_kp_ids AS jsonb),
                :recommendation, :feedback, :created_at, :submitted_at
            )
            """
        ), {
            "id": attempt_id,
            "student_id": plan["student_id"],
            "scope_type": plan["scope_type"] or source_result.get("scope_type") or "chapter",
            "scope_id": plan["scope_id"] or source_result.get("scope_id") or "",
            "scope_name": plan["scope_name"] or source_result.get("scope_name") or plan["scope_id"] or "",
            "question_ids": "[]",
            "answer_ids": "[]",
            "result": json.dumps(source_result),
            "correct_count": plan["correct_count"] or source_result.get("correct_count") or 0,
            "total_count": plan["total_count"] or source_result.get("total_count") or 0,
            "weak_count": plan["weak_count"] if plan["weak_count"] is not None else len(weak_kp_ids),
            "weak_kp_ids": json.dumps(weak_kp_ids),
            "recommendation": source_result.get("recommendation"),
            "feedback": source_result.get("feedback"),
            "created_at": plan["created_at"],
            "submitted_at": plan["created_at"],
        })
        for item in kp_results:
            bind.execute(sa.text(
                """
                INSERT INTO student_scope_diagnostic_kp_results (
                    id, attempt_id, student_id, kp_id, kp_name, group_id, group_name,
                    correct_count, total_count, mastery_before, mastery_after, is_weak
                ) VALUES (
                    :id, :attempt_id, :student_id, :kp_id, :kp_name, NULL, NULL,
                    :correct_count, :total_count, :mastery_before, :mastery_after, :is_weak
                )
                """
            ), {
                "id": uuid4().hex,
                "attempt_id": attempt_id,
                "student_id": plan["student_id"],
                "kp_id": item.get("kp_id") or "",
                "kp_name": item.get("kp_name") or "",
                "correct_count": item.get("correct_count") or 0,
                "total_count": item.get("total_count") or 0,
                "mastery_before": item.get("mastery_before") or 0.0,
                "mastery_after": item.get("mastery_after") or 0.0,
                "is_weak": (item.get("kp_id") or "") in set(weak_kp_ids),
            })
        bind.execute(sa.text(
            """
            UPDATE student_improvement_plans
            SET diagnostic_attempt_id = :attempt_id
            WHERE id = :plan_id
            """
        ), {"attempt_id": attempt_id, "plan_id": plan["id"]})
