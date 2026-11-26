"""Released teacher judgments shared by mastery replay and personalized practice.

The submission item is the authoritative fact for both scanned and App work.
App StudentAnswer rows remain the original attempt, never a second piece of
foundation evidence. Callers must authorize the student cohort before loading.
"""
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import and_, func, select, update

from app.models.learning_catalog import LearningCatalogNodeEvidence
from app.models.student import ItemStats, StudentAnswer
from app.models.teacher import TeacherAssignment, TeacherStudentPaper
from app.models.teacher_paper import TeacherPaperAttempt
from app.models.teacher_scan import TeacherSubmission, TeacherSubmissionItem
from app.services.learning_evidence import MasteryEvidence
from app.services.physics_error_types import error_type_name, process_grading_credit

HOMEWORK_CATALOG = "teacher_homework"


def utc(value):
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


@dataclass(frozen=True)
class TeacherLearningEvidence:
    item: TeacherSubmissionItem
    submission: TeacherSubmission
    assignment: TeacherAssignment
    question: dict

    @property
    def kp_id(self):
        return (self.question.get("primary_kp") or {}).get("id")

    @property
    def observed_at(self) -> datetime:
        # Collection is the observed time, not a claim about how long work took.
        return utc(self.submission.created_at or self.assignment.results_released_at)

    @property
    def credit(self):
        return max(0.0, min(1.0, self.item.score / self.item.max_score))

    @property
    def mastery_evidence(self):
        weight = .55 if self.item.kind == "area" or 0 < self.credit < 1 else None
        return MasteryEvidence(self.credit >= 1, self.credit, weight)


async def released_teacher_evidence(db, student_ids, *, assignment_id=None, teacher_id=None, class_id=None):
    """Read final scored items with frozen targets, including retained removed work."""
    if not student_ids:
        return []
    query = (select(TeacherSubmissionItem, TeacherSubmission, TeacherAssignment, TeacherStudentPaper)
             .join(TeacherSubmission, TeacherSubmission.id == TeacherSubmissionItem.submission_id)
             .join(TeacherAssignment, TeacherAssignment.id == TeacherSubmission.assignment_id)
             .outerjoin(TeacherStudentPaper, and_(
                 TeacherStudentPaper.assignment_id == TeacherAssignment.id,
                 TeacherStudentPaper.student_id == TeacherSubmission.student_id,
             ))
             .where(TeacherSubmission.student_id.in_(student_ids),
                    TeacherAssignment.results_released_at.is_not(None),
                    TeacherSubmission.total_score.is_not(None),
                    TeacherSubmissionItem.score.is_not(None), TeacherSubmissionItem.max_score > 0))
    if assignment_id is not None:
        query = query.where(TeacherAssignment.id == assignment_id)
    if teacher_id is not None:
        query = query.where(TeacherAssignment.teacher_id == teacher_id)
    if class_id is not None:
        query = query.where(TeacherAssignment.class_id == class_id)
    evidence = []
    for item, submission, assignment, paper in (await db.execute(query)).all():
        cohort = assignment.roster if assignment.roster is not None else (assignment.settings or {}).get("student_ids")
        if cohort is not None and submission.student_id not in cohort:
            continue
        snapshots = paper.question_snapshot if assignment.kind == "personalized" and paper else assignment.question_snapshot
        question = next((q for q in snapshots or [] if q["id"] == item.question_id), None)
        # Never attribute a historical score using today's editable bank labels.
        if question is not None:
            evidence.append(TeacherLearningEvidence(item, submission, assignment, question))
    return evidence


def app_homework_attempt_ids():
    return select(TeacherPaperAttempt.id).where(TeacherPaperAttempt.catalog_code == HOMEWORK_CATALOG)


async def sync_app_teacher_reviews(db, assignment):
    """Retain initial grading while making the released teacher judgment authoritative."""
    student_ids = (await db.scalars(select(TeacherSubmission.student_id).where(
        TeacherSubmission.assignment_id == assignment.id, TeacherSubmission.total_score.is_not(None),
    ))).all()
    evidence = await released_teacher_evidence(db, student_ids, assignment_id=assignment.id)
    app = {(e.submission.student_id, e.item.question_id): e for e in evidence if e.submission.source == "app"}
    if not app:
        return
    answers = (await db.scalars(select(StudentAnswer).join(
        TeacherPaperAttempt, TeacherPaperAttempt.id == StudentAnswer.teacher_paper_attempt_id,
    ).where(TeacherPaperAttempt.catalog_code == HOMEWORK_CATALOG, TeacherPaperAttempt.node_id == assignment.id,
            StudentAnswer.student_id.in_({key[0] for key in app}))
        .with_for_update(of=StudentAnswer))).all()
    for answer in answers:
        teacher = app.get((answer.student_id, answer.question_id))
        if teacher is None:
            continue
        item, previous = teacher.item, answer.is_correct
        grading = answer.grading_result if isinstance(answer.grading_result, dict) else {}
        review = grading.get("_teacher_review")
        if isinstance(review, dict) and review.get("assignment_id") == assignment.id:
            continue
        correct = teacher.credit >= 1
        cause = "none" if correct else item.error_type or "unknown"
        # The AI's notes explain the AI's score; when the teacher gave full marks instead,
        # its "deducted 1 point" note no longer applies and must not reach the student.
        ai_credit = process_grading_credit(item.ai_result) if isinstance(item.ai_result, dict) else None
        stale_notes = correct and ai_credit is not None and ai_credit < 1
        note = item.teacher_comment or ("老师已审核，本题满分。" if stale_notes else item.feedback)
        final = {**grading, "_original_grading": grading.get("_original_grading") or dict(grading),
                 "_teacher_review": {"assignment_id": assignment.id, "item_id": item.id,
                                     "reviewed_at": assignment.results_released_at.isoformat(),
                                     "score": item.score, "max_score": item.max_score},
                 "is_correct": correct, "process_score": teacher.credit * 100,
                 # The teacher's points replace the AI's, so "x/y 分" matches the percentage.
                 "score": item.score, "max_score": item.max_score,
                 "process_score_percent": teacher.credit * 100,
                 "error_type": cause, "error_type_name": error_type_name(cause),
                 "first_error": None if correct else item.first_error,
                 "model_correct": None, "equation_correct": None,
                 "calculation_correct": None, "unit_correct": None,
                 "step_scores": [], "next_action": note or "",
                 "grading_basis": "教师已审核并发布本次作业结果。",
                 "confidence_level": "high",
                 "feedback": note or (None if stale_notes else grading.get("feedback")),
                 "part_scores": item.part_scores, "needs_human_review": False,
                 "_mastery_scope": "topic_only", "_mastery_update": {}}
        final.pop("_pending_confirmation", None)
        # Student self-correction cannot override the subsequently published teacher judgment.
        final.pop("manual_correction", None)
        answer.grading_result, answer.is_correct = final, correct
        answer.misconception_ids = [cause] if cause not in {"none", "unknown"} else []
        if item.kind == "choice":
            answer.given_answer = item.answer
        await db.execute(update(LearningCatalogNodeEvidence).where(
            LearningCatalogNodeEvidence.answer_id == answer.id,
            LearningCatalogNodeEvidence.student_id == answer.student_id,
        ).values(score=teacher.credit))
        if previous != correct:
            rate = func.greatest(0.0, func.least(1.0,
                (ItemStats.correct_rate * ItemStats.total_attempts + int(correct) - int(previous))
                / func.nullif(ItemStats.total_attempts, 0)))
            await db.execute(update(ItemStats).where(ItemStats.question_id == answer.question_id,
                                                    ItemStats.total_attempts > 0)
                             .values(correct_rate=rate, difficulty_estimate=1.0 - rate))
