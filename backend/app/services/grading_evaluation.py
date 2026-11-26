"""Offline accuracy evaluation of the AI grading chain (audit A11).

Run it before changing a grading model, provider or prompt. Each case is a
real or hand-written student answer with a teacher's label; the harness sends
it through the same grading call and the same verdict rules as live grading
(``assess_ai_judgment``) and reports how often the counted verdict is right.

Modes:
- ``replay`` (default, free): scores each case's ``recorded_output`` — a model
  output captured earlier — so rule changes can be checked without any model.
- ``live``: calls the configured providers (paid). Text cases use the text
  grader; cases with an ``image`` use the photo grader.

Export real answers for teachers to label with ``export`` (run where the
database is, e.g. inside the backend container). Exports carry no student
identity; photo cases reference the server-side image path.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable

from app.services.grading_reliability import (
    CHOICE_QUESTION_TYPES,
    PENDING_FLAG,
    PROCESS_CONFLICT_KEY,
    photo_answer_unrecognized,
)
from app.services.physics_error_types import normalize_answer_text

DATASET_VERSION = "grading-eval-v1"
# Advisory release gates; ``--enforce`` turns a miss into a non-zero exit.
TARGETS: dict[str, float] = {
    "counted_accuracy_min": 0.95,
    "false_correct_rate_max": 0.03,
    "needs_review_rate_max": 0.25,
    "unrecognized_rate_max": 0.10,
}

Grader = Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]


def load_eval_cases(path: str | Path) -> list[dict[str, Any]]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if payload.get("version") != DATASET_VERSION:
        raise ValueError("unsupported_grading_eval_dataset")
    cases = payload.get("cases")
    if not isinstance(cases, list) or not cases:
        raise ValueError("grading_eval_requires_cases")
    ids = [case.get("id") for case in cases]
    if len(set(ids)) != len(ids) or not all(ids):
        raise ValueError("grading_eval_case_ids_must_be_unique")
    for case in cases:
        if not str(case.get("correct_answer") or "").strip():
            raise ValueError(f"grading_eval_case_without_answer:{case['id']}")
        if not case.get("question_type"):
            raise ValueError(f"grading_eval_case_without_type:{case['id']}")
    return cases


def is_labeled(case: dict[str, Any]) -> bool:
    return isinstance((case.get("label") or {}).get("is_correct"), bool)


def score_case(case: dict[str, Any], raw: dict[str, Any] | None) -> dict[str, Any]:
    """Apply live grading's verdict rules to one model output and compare with the label."""
    from app.services.adaptive_service import assess_ai_judgment

    question_type = case["question_type"]
    label = case.get("label") or {}
    photo = bool(case.get("image")) or case.get("mode") == "photo"
    result: dict[str, Any] = {
        "id": case["id"],
        "category": case.get("category") or question_type,
        "question_type": question_type,
        "photo": photo,
        "expected": label.get("is_correct"),
        "status": "counted",
        "verdict": None,
        "correct": None,
    }
    if raw is None:
        result["status"] = "skipped"
        return result
    given = (
        normalize_answer_text(raw.get("extracted_answer", "")) if photo else str(case.get("student_answer") or "")
    )
    if photo and photo_answer_unrecognized(question_type, given):
        # Live grading rejects these (422) instead of recording a verdict.
        result["status"] = "unrecognized"
        result["missed_readable"] = label.get("readable", True) is not False
        return result
    if not photo and question_type in CHOICE_QUESTION_TYPES:
        # Typed or tapped options are compared with the key; no model verdict.
        raw = {**raw, "is_correct": None, "confidence": 1.0, "needs_human_review": False}
    assessment = assess_ai_judgment(
        question_type, given, case["correct_answer"], raw, verdict_value=raw.get("is_correct"),
        feedback=str(raw.get("feedback") or ""),
    )
    result["verdict"] = assessment.is_correct
    result["conflict"] = assessment.conflict is not None
    if assessment.pending:
        result["status"] = "pending"
    elif isinstance(result["expected"], bool):
        result["correct"] = assessment.is_correct == result["expected"]
    return result


def _ratio(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator, 4) if denominator else None


def summarize(results: list[dict[str, Any]]) -> dict[str, Any]:
    evaluated = [r for r in results if r["status"] != "skipped"]
    counted = [r for r in evaluated if r["status"] == "counted" and isinstance(r["expected"], bool)]
    pending = [r for r in evaluated if r["status"] == "pending"]
    photos = [r for r in evaluated if r["photo"]]
    unrecognized = [r for r in photos if r["status"] == "unrecognized"]
    recognized = [r for r in evaluated if r["status"] != "unrecognized"]
    false_correct = [r for r in counted if r["verdict"] is True and r["expected"] is False]
    false_wrong = [r for r in counted if r["verdict"] is False and r["expected"] is True]
    metrics = {
        "counted_accuracy": _ratio(sum(r["correct"] for r in counted), len(counted)),
        "false_correct_rate": _ratio(len(false_correct), len(counted)),
        "false_wrong_rate": _ratio(len(false_wrong), len(counted)),
        "needs_review_rate": _ratio(len(pending), len(recognized)),
        "process_conflict_rate": _ratio(sum(1 for r in recognized if r.get("conflict")), len(recognized)),
        "unrecognized_rate": _ratio(len(unrecognized), len(photos)),
        "missed_readable_count": sum(1 for r in unrecognized if r.get("missed_readable")),
    }
    gates = {
        "counted_accuracy_min": metrics["counted_accuracy"],
        "false_correct_rate_max": metrics["false_correct_rate"],
        "needs_review_rate_max": metrics["needs_review_rate"],
        "unrecognized_rate_max": metrics["unrecognized_rate"],
    }
    gate_results = {
        name: None if value is None else (value >= TARGETS[name] if name.endswith("_min") else value <= TARGETS[name])
        for name, value in gates.items()
    }
    by_category: dict[str, Counter] = defaultdict(Counter)
    for r in evaluated:
        bucket = by_category[r["category"]]
        bucket["cases"] += 1
        bucket[r["status"]] += 1
        if r["correct"] is True:
            bucket["right"] += 1
        if r["correct"] is False:
            bucket["wrong"] += 1
    return {
        "dataset_version": DATASET_VERSION,
        "case_count": len(results),
        "evaluated_count": len(evaluated),
        "skipped_count": len(results) - len(evaluated),
        "counted_count": len(counted),
        "pending_count": len(pending),
        "unrecognized_count": len(unrecognized),
        "metrics": metrics,
        "targets": TARGETS,
        "gates": gate_results,
        "by_category": {name: dict(counts) for name, counts in sorted(by_category.items())},
        "errors": [
            {"id": r["id"], "category": r["category"], "expected": r["expected"], "verdict": r["verdict"]}
            for r in false_correct + false_wrong
        ],
    }


async def evaluate(cases: list[dict[str, Any]], grader: Grader | None = None, *, concurrency: int = 3) -> dict[str, Any]:
    """Score labeled cases; without a grader, replay each case's recorded output."""
    limit = asyncio.Semaphore(concurrency)

    async def run(case: dict[str, Any]) -> dict[str, Any]:
        if grader is None:
            return score_case(case, case.get("recorded_output"))
        async with limit:
            try:
                raw = await grader(case)
            except Exception as exc:  # noqa: BLE001 - a provider failure is a result, not a crash
                return {**score_case(case, None), "status": "provider_error", "error": type(exc).__name__}
        return {**score_case(case, raw), "raw": raw}

    labeled = [case for case in cases if is_labeled(case)]
    results = list(await asyncio.gather(*(run(case) for case in labeled)))
    report = summarize([r for r in results if r["status"] != "provider_error"])
    report["unlabeled_count"] = len(cases) - len(labeled)
    report["provider_error_count"] = sum(1 for r in results if r["status"] == "provider_error")
    report["case_results"] = results
    return report


def live_grader(dataset_dir: Path) -> Grader:
    """Grade through the production AI service (paid providers)."""
    from app.services.ai_call_budget import ai_call_budget
    from app.core.config import settings
    from app.services.ai_service import AIService

    service = AIService()

    async def grade(case: dict[str, Any]) -> dict[str, Any]:
        with ai_call_budget(settings.student_ai_timeout_seconds, settings.student_ai_max_model_calls):
            if case.get("image"):
                image = Path(case["image"])
                image = image if image.is_absolute() else dataset_dir / image
                return await service.judge_photo_answer(
                    image_base64=base64.b64encode(image.read_bytes()).decode("ascii"),
                    question_stem=case["stem"],
                    correct_answer=case["correct_answer"],
                )
            if case["question_type"] in CHOICE_QUESTION_TYPES:
                return {}
            return await service.judge_text_answer(
                question_stem=case["stem"],
                correct_answer=case["correct_answer"],
                given_answer=case.get("student_answer") or "",
                question_type=case["question_type"],
            )

    return grade


async def export_candidates(*, days: int, limit: int) -> dict[str, Any]:
    """Recent AI-graded answers as unlabeled cases, weighted toward the doubtful ones."""
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    from app.core.database import async_session
    from app.models.question import Question
    from app.models.student import StudentAnswer
    from app.services.grading_quality_service import is_ai_graded, waited_for_confirmation

    since = datetime.now(timezone.utc) - timedelta(days=days)
    async with async_session() as db:
        rows = (await db.execute(
            select(StudentAnswer, Question)
            .join(Question, Question.id == StudentAnswer.question_id)
            .options(selectinload(Question.options))
            .where(StudentAnswer.created_at >= since)
            .order_by(StudentAnswer.created_at.desc())
            .limit(limit * 20)
        )).all()
    buckets: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for answer, question in rows:
        grading = answer.grading_result if isinstance(answer.grading_result, dict) else {}
        if not is_ai_graded(grading):
            continue
        original = grading.get("_original_grading") if isinstance(grading.get("_original_grading"), dict) else grading
        bucket = (
            "corrected" if isinstance(grading.get("manual_correction"), dict)
            else "conflict" if isinstance(grading.get(PROCESS_CONFLICT_KEY), dict)
            else "pending" if waited_for_confirmation(grading)
            else "counted_correct" if answer.is_correct else "counted_wrong"
        )
        question_type = getattr(question.question_type, "value", question.question_type)
        buckets[bucket].append({
            "id": f"{bucket}-{len(buckets[bucket]) + 1:03d}",
            "category": f"{question_type}·{bucket}",
            "question_type": question_type,
            "stem": question.stem_text,
            "options": [{"label": o.label, "text": o.text} for o in sorted(question.options, key=lambda o: o.label)]
            if question_type in CHOICE_QUESTION_TYPES else [],
            "correct_answer": question.answer or "",
            "student_answer": original.get("extracted_answer") or answer.given_answer or "",
            "image": original.get("answer_image_path") or None,
            "recorded_output": {
                key: original.get(key)
                for key in ("extracted_answer", "is_correct", "process_score", "step_scores", "confidence",
                            "needs_human_review", "error_type", "feedback")
                if key in original
            } | ({PENDING_FLAG: True} if original.get(PENDING_FLAG) else {}),
            "label": {"is_correct": None, "readable": None, "note": ""},
        })
    # Doubtful answers are where grading goes wrong; keep them over-represented.
    quotas = {"corrected": 0.2, "conflict": 0.1, "pending": 0.2, "counted_wrong": 0.25, "counted_correct": 0.25}
    cases: list[dict[str, Any]] = []
    for bucket, share in quotas.items():
        cases.extend(buckets[bucket][: max(1, round(limit * share))])
    return {
        "version": DATASET_VERSION,
        "privacy": "导出自线上作答，不含学生身份；照片路径仅在服务器上可读，标注后勿外传。",
        "cases": [case for case in cases if case["correct_answer"].strip()][:limit],
    }


async def _main() -> int:
    parser = argparse.ArgumentParser(description="Grading accuracy evaluation")
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run", help="score a labeled dataset")
    run.add_argument("dataset", type=Path)
    run.add_argument("--live", action="store_true", help="call the configured (paid) providers")
    run.add_argument("--enforce", action="store_true", help="exit 1 when a target is missed")
    run.add_argument("--out", type=Path, help="also write the full report with per-case results")
    run.add_argument("--record", type=Path,
                     help="with --live: save the dataset with these model outputs for later free replays")
    export = sub.add_parser("export", help="export recent AI-graded answers for labeling")
    export.add_argument("--days", type=int, default=30)
    export.add_argument("--limit", type=int, default=200)
    export.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    if args.command == "export":
        payload = await export_candidates(days=args.days, limit=args.limit)
        args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"exported={len(payload['cases'])} out={args.out}")
        return 0

    cases = load_eval_cases(args.dataset)
    grader = live_grader(args.dataset.parent) if args.live else None
    report = await evaluate(cases, grader)
    if args.live and args.record:
        raw_by_id = {r["id"]: r["raw"] for r in report["case_results"] if "raw" in r}
        recorded = [{**case, "recorded_output": raw_by_id[case["id"]]} if case["id"] in raw_by_id else case
                    for case in cases]
        payload = json.loads(args.dataset.read_text(encoding="utf-8"))
        args.record.write_text(json.dumps({**payload, "cases": recorded}, ensure_ascii=False, indent=1),
                               encoding="utf-8")
    if args.out:
        args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    public = {key: value for key, value in report.items() if key != "case_results"}
    print(json.dumps(public, ensure_ascii=False, indent=2, sort_keys=True))
    missed = [name for name, passed in report["gates"].items() if passed is False]
    return 1 if args.enforce and missed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
