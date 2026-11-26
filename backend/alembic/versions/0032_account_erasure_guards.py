"""Make erasure terminal and reject late writes from in-flight learning requests."""
from alembic import op
import sqlalchemy as sa

revision = "0032_account_erasure_guards"
down_revision = '0029_question_videos_papers'
branch_labels = None
depends_on = None

# Fixed at migration time. Reject writes after erasure.
PERSONAL_TABLES = (
    "growth_reports", "learning_events", "reward_records", "student_xp",
    "student_ai_executions",
    "student_ai_usage_logs", "student_badges", "student_mastery", "student_quest_progress",
    "student_scope_diagnostic_attempts", "student_username_changes", "student_web_login_tickets",
    "teacher_paper_attempts", "learning_progress", "student_answers", "student_improvement_plans",
    "student_scope_diagnostic_kp_results", "learning_catalog_node_evidence",
    "student_improvement_retest_attempts", "student_improvement_tasks",
)


def upgrade():
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    op.execute("""
    CREATE FUNCTION reject_erased_student_write() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE account_status text;
    BEGIN
      SELECT status INTO account_status FROM students WHERE id = NEW.student_id FOR SHARE;
      IF account_status = 'deleted' THEN
        RAISE EXCEPTION 'account erased' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END $$
    """)
    for table in PERSONAL_TABLES:
        # Some installations never enabled the optional legacy learning_progress table.
        if table not in existing:
            continue
        op.execute(f"CREATE TRIGGER reject_erased_student_write BEFORE INSERT OR UPDATE ON {table} "
                   "FOR EACH ROW EXECUTE FUNCTION reject_erased_student_write()")
    op.execute("""
    CREATE FUNCTION prevent_student_reactivation() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.status = 'deleted' AND (
        NEW.status IS DISTINCT FROM 'deleted' OR NEW.phone IS NOT NULL OR
        NEW.password_hash IS DISTINCT FROM '!deleted' OR
        NEW.username IS DISTINCT FROM OLD.username OR NEW.display_name IS DISTINCT FROM OLD.display_name OR
        NEW.class_name IS NOT NULL OR NEW.grade IS NOT NULL OR NEW.registration_consent IS NOT NULL
      ) THEN
        RAISE EXCEPTION 'erased account cannot be restored' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END $$
    """)
    op.execute("CREATE TRIGGER prevent_student_reactivation BEFORE UPDATE ON students "
               "FOR EACH ROW EXECUTE FUNCTION prevent_student_reactivation()")


def downgrade():
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    for table in PERSONAL_TABLES:
        if table not in existing:
            continue
        op.execute(f"DROP TRIGGER reject_erased_student_write ON {table}")
    op.execute("DROP TRIGGER prevent_student_reactivation ON students")
    op.execute("DROP FUNCTION reject_erased_student_write()")
    op.execute("DROP FUNCTION prevent_student_reactivation()")
