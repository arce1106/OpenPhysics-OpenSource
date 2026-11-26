"""Offline grading evaluation harness (audit A11): free replay, same rules as live grading."""
from pathlib import Path

import pytest

from app.services.grading_evaluation import evaluate, load_eval_cases, score_case

SEED = Path(__file__).parent / "fixtures" / "grading_eval_seed_v1.json"


def _case(**overrides):
    case = {"id": "c", "question_type": "problem_solving", "stem": "求加速度", "correct_answer": "a=3 m/s²",
            "student_answer": "a=3 m/s²", "label": {"is_correct": True, "readable": True}}
    return {**case, **overrides}


def test_seed_dataset_is_labeled_and_covers_the_main_traps():
    cases = load_eval_cases(SEED)
    assert len(cases) >= 30
    assert all(isinstance(case["label"]["is_correct"], bool) for case in cases)
    labels = [case["label"]["is_correct"] for case in cases]
    assert 0.3 < sum(labels) / len(labels) < 0.7  # both verdicts well represented
    categories = {case["category"] for case in cases}
    assert {"填空·刹车陷阱", "填空·方向符号", "解答·多小问", "防注入", "实验·单位错误"} <= categories


def test_dataset_rejects_cases_without_a_standard_answer(tmp_path):
    path = tmp_path / "bad.json"
    path.write_text('{"version": "grading-eval-v1", "cases": [{"id": "x", "question_type": "fill_in_blank", '
                    '"correct_answer": " "}]}', encoding="utf-8")
    with pytest.raises(ValueError, match="without_answer"):
        load_eval_cases(path)


def test_scoring_uses_the_live_verdict_rules():
    counted = score_case(_case(), {"is_correct": True, "process_score": 90, "confidence": 0.9})
    assert counted["status"] == "counted" and counted["correct"] is True
    conflict = score_case(_case(), {"is_correct": True, "process_score": 30, "confidence": 0.9})
    assert conflict["status"] == "pending" and conflict["conflict"] is True
    doubtful = score_case(_case(), {"is_correct": True, "confidence": 0.2})
    assert doubtful["status"] == "pending"
    unreadable = score_case(_case(image="a.jpg"), {"extracted_answer": "", "is_correct": False})
    assert unreadable["status"] == "unrecognized" and unreadable["missed_readable"] is True
    choice = score_case(_case(question_type="multiple_choice", correct_answer="AC", student_answer="CA"), {})
    assert choice["status"] == "counted" and choice["verdict"] is True


@pytest.mark.asyncio
async def test_report_metrics_and_gates():
    cases = [
        _case(id="right", recorded_output={"is_correct": True, "process_score": 100}),
        _case(id="false-correct", label={"is_correct": False}, recorded_output={"is_correct": True, "process_score": 90}),
        _case(id="false-wrong", recorded_output={"is_correct": False, "process_score": 20}),
        _case(id="pending", recorded_output={"is_correct": True, "needs_human_review": True}),
        _case(id="photo-miss", image="p.jpg", recorded_output={"extracted_answer": ""}),
        _case(id="unlabeled", label={"is_correct": None}, recorded_output={"is_correct": True}),
        _case(id="no-recording"),
    ]
    report = await evaluate(cases)
    metrics = report["metrics"]
    assert report["unlabeled_count"] == 1
    assert report["skipped_count"] == 1
    assert report["counted_count"] == 3
    assert metrics["counted_accuracy"] == pytest.approx(1 / 3, abs=1e-3)
    assert metrics["false_correct_rate"] == pytest.approx(1 / 3, abs=1e-3)
    assert metrics["needs_review_rate"] == 0.25
    assert metrics["unrecognized_rate"] == 1.0
    assert report["gates"]["false_correct_rate_max"] is False
    assert {error["id"] for error in report["errors"]} == {"false-correct", "false-wrong"}


@pytest.mark.asyncio
async def test_live_mode_reports_provider_failures_without_crashing():
    async def flaky(case):
        if case["id"] == "down":
            raise TimeoutError
        return {"is_correct": True, "process_score": 100}

    report = await evaluate([_case(id="ok"), _case(id="down")], flaky)
    assert report["provider_error_count"] == 1
    assert report["counted_count"] == 1
