"""Released paper homework in the student's own records.

A scanned paper is graded on the teacher side (TeacherSubmissionItem). Once results are
released, each student gets a completed teacher-homework attempt holding one StudentAnswer per
question: the teacher's final score, comment and the crop of their handwriting. That is what
the student apps already show for App homework, so paper work appears in 练习记录, in 错题本
(points lost) and under the homework card, with its image, on every client.

These rows are a view of the teacher's judgment, never new evidence:
- they hang off a ``teacher_homework`` attempt, which mastery replay, recent-evidence
  judgments, teacher statistics and personalized drafting already exclude (the submission
  item is the authoritative fact there);
- ``time_spent_ms`` is 0, so daily-loop and streak counts, which require real answering
  time, do not treat collected paper as App activity;
- nothing touches ItemStats or catalog evidence.
"""
from __future__ import annotations

import copy
import logging
import uuid
from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.student import StudentAnswer
from app.models.teacher import TeacherAssignment, TeacherStudentPaper
from app.models.teacher_paper import TeacherPaperAttempt
from app.models.teacher_scan import TeacherSubmission, TeacherSubmissionItem
from app.services.physics_error_types import error_type_name
from app.services.question_service import QuestionService

logger = logging.getLogger(__name__)

HOMEWORK_CATALOG = "teacher_homework"
PAPER_PREFIX = "homework-paper:"
ANSWER_STATIC_PREFIX = "/static/uploads/"


def paper_results_id(assignment_id: str) -> str:
    return f"{PAPER_PREFIX}{assignment_id}"


def _credit(item: TeacherSubmissionItem) -> float:
    if not item.max_score:
        return 0.0
    return max(0.0, min(1.0, float(item.score or 0) / float(item.max_score)))


async def _snapshot(questions: QuestionService, question_id: str, saved: dict | None) -> dict | None:
    """The question as the student saw it on paper: the frozen copy wins over today's bank."""
    from app.services.teacher_paper_service import question_snapshot

    question = await questions.get_question(question_id)
    if question is None:
        return None
    prepared = question_snapshot(question, route=HOMEWORK_CATALOG)
    if saved:
        prepared.update(stem_text=saved.get("stem_text", prepared.get("stem_text")),
                        question_type=saved.get("question_type", prepared.get("question_type")),
                        _answer=saved.get("answer", prepared.get("_answer")),
                        _explanation=saved.get("explanation", prepared.get("_explanation")))
        if saved.get("options"):
            prepared["options"] = copy.deepcopy(saved["options"])
        if saved.get("primary_kp"):
            kp_id = saved["primary_kp"]["id"]
            prepared.update(knowledge_point_ids=[kp_id], target_knowledge_point_id=kp_id)
    return prepared


def _grading(item: TeacherSubmissionItem, assignment: TeacherAssignment, credit: float) -> dict:
    correct = credit >= 1
    cause = "none" if correct else (item.error_type or "unknown")
    comment = item.teacher_comment or item.feedback or ""
    grading = {
        "is_correct": correct,
        # 0–100, so every client shows a partly right answer as 部分正确 with its score.
        "process_score": round(credit * 100),
        "score": item.score,
        "max_score": item.max_score,
        "error_type": cause,
        "error_type_name": error_type_name(cause),
        "first_error": item.first_error,
        "feedback": comment or ("老师已审核：满分。" if correct else "老师已审核本题。"),
        "next_action": comment,
        "part_scores": item.part_scores,
        "grading_basis": f"纸质作业《{assignment.title}》第 {item.number} 题，老师已审核并发布结果。",
        "confidence_level": "high",
        "needs_human_review": False,
        "answer_source": "teacher_paper",
        "_teacher_paper": {
            "assignment_id": assignment.id, "item_id": item.id, "number": item.number,
            "score": item.score, "max_score": item.max_score,
            "released_at": assignment.results_released_at.isoformat() if assignment.results_released_at else None,
        },
        # The submission item already moved mastery; this row only shows it.
        "_mastery_scope": "topic_only",
        "_mastery_update": {},
    }
    if item.crop_path:
        grading["answer_image_path"] = ANSWER_STATIC_PREFIX + item.crop_path
    return grading


async def mirror_submission(db: AsyncSession, assignment: TeacherAssignment, submission: TeacherSubmission) -> bool:
    """One student's released paper as a completed homework attempt. Idempotent."""
    if submission.source != "scan" or submission.total_score is None or not assignment.results_released_at:
        return False
    paper_id = paper_results_id(assignment.id)
    if await db.scalar(select(TeacherPaperAttempt.id).where(
            TeacherPaperAttempt.student_id == submission.student_id, TeacherPaperAttempt.paper_id == paper_id)):
        return False
    items = list((await db.scalars(select(TeacherSubmissionItem).where(
        TeacherSubmissionItem.submission_id == submission.id,
    ).order_by(TeacherSubmissionItem.number))).all())
    if assignment.kind == "personalized":
        paper = await db.scalar(select(TeacherStudentPaper).where(
            TeacherStudentPaper.assignment_id == assignment.id, TeacherStudentPaper.student_id == submission.student_id))
        frozen = {q["id"]: q for q in (paper.question_snapshot if paper else None) or []}
    else:
        frozen = {q["id"]: q for q in assignment.question_snapshot or []}
    questions = QuestionService(db)
    snapshot, rows = [], []
    for item in items:
        if item.max_score is None or item.score is None:
            continue
        prepared = await _snapshot(questions, item.question_id, frozen.get(item.question_id))
        if prepared is None:
            continue  # A question that has left the bank cannot be shown or practised again.
        snapshot.append(prepared)
        rows.append(item)
    if not rows:
        return False
    # Shown when the results came out, so a released paper appears at the top of the student's records.
    observed = assignment.results_released_at or submission.created_at
    attempt = TeacherPaperAttempt(
        id=str(uuid.uuid4()), student_id=submission.student_id, paper_id=paper_id,
        catalog_code=HOMEWORK_CATALOG, node_id=assignment.id, title=assignment.title,
        question_ids=[q["id"] for q in snapshot], questions=snapshot, status="completed",
        created_at=observed, submitted_at=observed, completed_at=assignment.results_released_at,
    )
    db.add(attempt)
    await db.flush()
    for item in rows:
        credit = _credit(item)
        grading = _grading(item, assignment, credit)
        db.add(StudentAnswer(
            student_id=submission.student_id, question_id=item.question_id, teacher_paper_attempt_id=attempt.id,
            given_answer=item.answer if item.kind == "choice" else None,
            is_correct=credit >= 1, time_spent_ms=0,
            misconception_ids=[grading["error_type"]] if grading["error_type"] not in {"none", "unknown"} else [],
            grading_result=grading, created_at=observed,
        ))
    return True


async def mirror_paper_results(db: AsyncSession, assignment: TeacherAssignment) -> int:
    """Every collected paper of a released homework, into its student's records."""
    submissions = (await db.scalars(select(TeacherSubmission).where(
        TeacherSubmission.assignment_id == assignment.id, TeacherSubmission.source == "scan",
        TeacherSubmission.total_score.is_not(None),
    ))).all()
    mirrored = 0
    for submission in submissions:
        mirrored += await mirror_submission(db, assignment, submission)
    return mirrored


async def ensure_student_paper_results(db: AsyncSession, student_id: str) -> int:
    """Papers released before this existed (or while it failed) reach the student on their next visit.

    Best effort: a failure here must never keep the student from their history or mistakes.
    """
    if db is None or not hasattr(db, "execute"):
        return 0
    try:
        return await _backfill(db, student_id)
    except Exception:  # noqa: BLE001 - reading the records matters more than the backfill
        logger.exception("paper results backfill failed for student %s", student_id)
        await db.rollback()
        return 0


async def _backfill(db: AsyncSession, student_id: str) -> int:
    missing = (await db.execute(
        select(TeacherSubmission, TeacherAssignment)
        .join(TeacherAssignment, TeacherAssignment.id == TeacherSubmission.assignment_id)
        .where(TeacherSubmission.student_id == student_id, TeacherSubmission.source == "scan",
               TeacherSubmission.total_score.is_not(None), TeacherAssignment.results_released_at.is_not(None),
               ~exists().where(TeacherPaperAttempt.student_id == student_id,
                               TeacherPaperAttempt.paper_id == func_concat(TeacherAssignment.id)))
    )).all()
    mirrored = 0
    for submission, assignment in missing:
        mirrored += await mirror_submission(db, assignment, submission)
    if mirrored:
        await db.commit()
    return mirrored


def answered_in_app():
    """Excludes the copies of released paper results: the student answered those on paper, so they
    are not App activity (weekly counts, streak-like checks)."""
    from sqlalchemy import func as sql
    return sql.coalesce(StudentAnswer.grading_result['answer_source'].astext, '') != 'teacher_paper'


def func_concat(column):
    from sqlalchemy import literal

    return literal(PAPER_PREFIX) + column
