from scripts.check_improvement_flow_ready import (
    CheckResult,
    IMPROVEMENT_REQUIRED_TABLES,
    REQUIRED_TABLES,
    exit_code_for_results,
    format_question_coverage_checks,
    format_required_table_checks,
)


def test_required_table_checks_fail_when_improvement_table_is_missing():
    missing_table = next(iter(IMPROVEMENT_REQUIRED_TABLES))
    existing_tables = REQUIRED_TABLES - {missing_table}

    results = format_required_table_checks(existing_tables)

    assert exit_code_for_results(results) == 1
    assert any(
        result.status == "FAIL"
        and "Required table missing" in result.message
        and result.name == missing_table
        for result in results
    )


def test_question_coverage_warnings_do_not_fail_preflight():
    results = [
        CheckResult("OK", "Database connection"),
        *format_question_coverage_checks(
            total_questions=8,
            approved_questions=3,
            knowledge_point_labeled_questions=2,
        ),
    ]

    assert any(result.status == "WARN" for result in results)
    assert exit_code_for_results(results) == 0
