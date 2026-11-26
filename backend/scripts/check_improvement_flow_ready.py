from __future__ import annotations

import asyncio
import importlib
import sys
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

MODULES_TO_IMPORT = (
    "app.api.student.diagnostic_attempts",
    "app.api.student.improvement",
    "app.services.diagnostic_attempt_service",
    "app.services.improvement_plan_service",
    "app.models.improvement",
)

REQUIRED_TABLES = {
    "students",
    "knowledge_points",
    "questions",
    "student_scope_diagnostic_attempts",
    "student_scope_diagnostic_kp_results",
    "student_improvement_plans",
    "student_improvement_tasks",
    "student_improvement_retest_attempts",
}

IMPROVEMENT_REQUIRED_TABLES = {
    "student_scope_diagnostic_attempts",
    "student_scope_diagnostic_kp_results",
    "student_improvement_plans",
    "student_improvement_tasks",
    "student_improvement_retest_attempts",
}

LOW_APPROVED_QUESTION_THRESHOLD = 20


@dataclass(frozen=True)
class CheckResult:
    status: str
    message: str
    name: str = ""

    def render(self) -> str:
        return f"[{self.status}] {self.message}"


def exit_code_for_results(results: list[CheckResult]) -> int:
    return 1 if any(result.status == "FAIL" for result in results) else 0


def format_required_table_checks(existing_tables: set[str]) -> list[CheckResult]:
    results: list[CheckResult] = []
    for table_name in sorted(REQUIRED_TABLES):
        if table_name in existing_tables:
            results.append(CheckResult("OK", f"Required table exists: {table_name}", name=table_name))
            continue
        results.append(CheckResult("FAIL", f"Required table missing: {table_name}", name=table_name))
    return results


def format_question_coverage_checks(
    *,
    total_questions: int,
    approved_questions: int,
    knowledge_point_labeled_questions: int,
) -> list[CheckResult]:
    results = [CheckResult("OK", f"Question count: {total_questions}", name="questions")]
    if approved_questions < LOW_APPROVED_QUESTION_THRESHOLD:
        results.append(
            CheckResult(
                "WARN",
                f"Approved question count is low: {approved_questions}",
                name="approved_questions",
            )
        )
    else:
        results.append(
            CheckResult(
                "OK",
                f"Approved question count: {approved_questions}",
                name="approved_questions",
            )
        )

    if knowledge_point_labeled_questions <= 0:
        results.append(
            CheckResult(
                "WARN",
                "No questions with knowledge_point labels were found",
                name="knowledge_point_labeled_questions",
            )
        )
    else:
        results.append(
            CheckResult(
                "OK",
                f"Questions with knowledge_point labels: {knowledge_point_labeled_questions}",
                name="knowledge_point_labeled_questions",
            )
        )
    return results


def check_imports() -> list[CheckResult]:
    failures: list[CheckResult] = []
    for module_name in MODULES_TO_IMPORT:
        try:
            importlib.import_module(module_name)
        except Exception as exc:  # pragma: no cover - exact import error depends on deployment env
            failures.append(
                CheckResult(
                    "FAIL",
                    f"Import failed: {module_name} ({exc.__class__.__name__}: {exc})",
                    name=module_name,
                )
            )
    if failures:
        return failures
    return [CheckResult("OK", "Imported improvement modules")]


async def fetch_existing_tables(conn: AsyncConnection) -> set[str]:
    result = await conn.execute(
        text(
            """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = current_schema()
            """
        )
    )
    return {str(row[0]) for row in result.all()}


async def check_alembic_revision(conn: AsyncConnection, existing_tables: set[str]) -> list[CheckResult]:
    if "alembic_version" not in existing_tables:
        return [CheckResult("WARN", "Alembic version table missing", name="alembic_version")]

    result = await conn.execute(text("SELECT version_num FROM alembic_version ORDER BY version_num"))
    revisions = [str(row[0]) for row in result.all()]
    if not revisions:
        return [CheckResult("WARN", "Alembic version table is empty", name="alembic_version")]
    return [CheckResult("OK", f"Alembic current revision: {', '.join(revisions)}", name="alembic_version")]


async def check_question_coverage(conn: AsyncConnection, existing_tables: set[str]) -> list[CheckResult]:
    if "questions" not in existing_tables:
        return [CheckResult("WARN", "Question coverage skipped because questions table is missing")]
    if "question_labels" not in existing_tables:
        return [CheckResult("WARN", "Question coverage skipped because question_labels table is missing")]

    try:
        count_result = await conn.execute(
            text(
                """
                SELECT
                    (SELECT COUNT(*) FROM questions) AS total_questions,
                    (SELECT COUNT(*) FROM questions WHERE quality_status = 'approved') AS approved_questions,
                    (
                        SELECT COUNT(DISTINCT q.id)
                        FROM questions q
                        JOIN question_labels ql ON ql.question_id = q.id
                        WHERE ql.label_type = 'knowledge_point'
                    ) AS knowledge_point_labeled_questions
                """
            )
        )
        counts = count_result.mappings().one()
        results = format_question_coverage_checks(
            total_questions=int(counts["total_questions"]),
            approved_questions=int(counts["approved_questions"]),
            knowledge_point_labeled_questions=int(counts["knowledge_point_labeled_questions"]),
        )

        if "knowledge_points" in existing_tables:
            chapter_result = await conn.execute(
                text(
                    """
                    SELECT
                        COALESCE(kp.chapter, '未标章节') AS chapter,
                        COALESCE(kp.section, '未标小节') AS section,
                        COUNT(DISTINCT q.id) AS approved_count
                    FROM questions q
                    JOIN question_labels ql ON ql.question_id = q.id
                    JOIN knowledge_points kp ON kp.id = ql.label_id
                    WHERE q.quality_status = 'approved'
                      AND ql.label_type = 'knowledge_point'
                    GROUP BY kp.chapter, kp.section
                    ORDER BY approved_count DESC, chapter, section
                    LIMIT 5
                    """
                )
            )
            chapter_rows = chapter_result.mappings().all()
            if chapter_rows:
                summary = "; ".join(
                    f"{row['chapter']} / {row['section']}: {row['approved_count']}"
                    for row in chapter_rows
                )
                results.append(CheckResult("OK", f"Top approved question coverage: {summary}"))
        return results
    except SQLAlchemyError as exc:
        return [CheckResult("WARN", f"Question coverage check unavailable: {exc.__class__.__name__}: {exc}")]


async def run_database_checks() -> list[CheckResult]:
    from app.core.config import settings

    engine = create_async_engine(settings.database_url, echo=False)
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
            results: list[CheckResult] = [CheckResult("OK", "Database connection")]
            existing_tables = await fetch_existing_tables(conn)
            results.extend(await check_alembic_revision(conn, existing_tables))
            results.extend(format_required_table_checks(existing_tables))
            results.extend(await check_question_coverage(conn, existing_tables))
            return results
    except Exception as exc:
        return [CheckResult("FAIL", f"Database connection failed: {exc.__class__.__name__}: {exc}")]
    finally:
        await engine.dispose()


async def run_preflight() -> list[CheckResult]:
    results = check_imports()
    results.extend(await run_database_checks())
    return results


def print_results(results: list[CheckResult]) -> None:
    for result in results:
        print(result.render())
    if exit_code_for_results(results) == 0:
        if any(result.status == "WARN" for result in results):
            print("[DONE] Improvement flow preflight passed with warnings")
        else:
            print("[DONE] Improvement flow preflight passed")
    else:
        print("[DONE] Improvement flow preflight failed")


def main() -> int:
    results = asyncio.run(run_preflight())
    print_results(results)
    return exit_code_for_results(results)


if __name__ == "__main__":
    raise SystemExit(main())
