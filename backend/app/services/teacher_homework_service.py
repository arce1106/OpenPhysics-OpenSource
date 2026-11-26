"""Personalized homework answered in the student app.

Publishing gives every app-delivered student a fixed-paper attempt (TeacherPaperAttempt,
the same machinery as the 高考复习 teacher papers), so the apps answer it with their
existing paper session: answer everything, submit the paper, then each answer is graded
through ordinary practice. Once a student's attempt is complete, their answers are
folded into the teacher's collection as a submission marked ``app``, reviewed and
released with the scanned papers. Practice grading already moved mastery, so release
does not count these answers again.
"""
from __future__ import annotations

import uuid
import copy
import re
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.student import StudentAnswer
from app.models.teacher import TeacherAssignment, TeacherClass, TeacherClassMember, TeacherStudentPaper
from app.models.teacher_paper import TeacherPaperAttempt
from app.models.teacher_scan import TeacherSubmission, TeacherSubmissionItem
from app.services.choice_scoring import normalize_choice_answer
from app.services.grading_reliability import INSTRUCTION_IN_ANSWER_BASIS, PROCESS_CONFLICT_KEY
from app.services.paper_items import is_choice
from app.services.physics_error_types import process_grading_credit
from app.services.question_service import QuestionService

HOMEWORK_CATALOG = "teacher_homework"
ANSWER_PREFIX = "/static/uploads/"


def homework_paper_id(assignment_id: str) -> str:
    return f"homework:{assignment_id}"


async def has_paper_students(db: AsyncSession, assignment: TeacherAssignment) -> bool:
    """Whether anyone answers this homework on paper (so it is printed, scanned and collected)."""
    if assignment.kind != "personalized" and (assignment.settings or {}).get("delivery") != "app":
        return True
    return bool(await db.scalar(select(TeacherStudentPaper.id).where(
        TeacherStudentPaper.assignment_id == assignment.id, TeacherStudentPaper.delivery == "paper").limit(1)))


def _half(value: float) -> float:
    return round(float(value) * 2) / 2


async def open_app_attempts(db: AsyncSession, assignment: TeacherAssignment, papers: list[TeacherStudentPaper]) -> int:
    """One attempt per app-delivered paper, holding that student's frozen questions."""
    from app.services.teacher_paper_service import question_snapshot

    questions = QuestionService(db)
    opened = 0
    for paper in papers:
        if paper.delivery != "app" or not paper.items:
            continue
        existing = await db.scalar(select(TeacherPaperAttempt.id).where(
            TeacherPaperAttempt.student_id == paper.student_id,
            TeacherPaperAttempt.paper_id == homework_paper_id(assignment.id),
        ))
        if existing:
            continue
        snapshot = []
        frozen = {question["id"]: question for question in paper.question_snapshot or []}
        for item in paper.items:
            saved = frozen.get(item["question_id"])
            if saved and saved.get("_app_snapshot"):
                snapshot.append(copy.deepcopy(saved["_app_snapshot"]))
                continue
            question = await questions.get_question(item["question_id"])
            if question is None:
                # The app paper must hold every question on the teacher's copy, or the student would
                # be marked down for one they never saw.
                from app.services.teacher_service import TeacherServiceError

                raise TeacherServiceError(400, f"题目 {item['question_id']} 已不在题库中，请先为该学生换题")
            prepared = question_snapshot(question, route=HOMEWORK_CATALOG)
            if saved:
                # Older saved papers predate complete App snapshots. Their printed
                # question, answer and options remain authoritative on App delivery.
                prepared.update(stem_text=saved["stem_text"], question_type=saved["question_type"],
                                difficulty_tier=saved.get("difficulty_tier"), _answer=saved.get("answer"),
                                _explanation=saved.get("explanation"), options=copy.deepcopy(saved.get("options", [])),
                                _options=[{**option, "targets_misconception": None} for option in saved.get("options", [])],
                                images=[{"id": f"frozen_{index}", "image_path": path, "image_type": None, "description": None}
                                        for index, path in enumerate(saved.get("image_paths", []))])
                if saved.get("primary_kp"):
                    kp_id = saved["primary_kp"]["id"]
                    prepared.update(knowledge_point_ids=[kp_id], target_knowledge_point_id=kp_id,
                                    _labels=[{"label_type": "knowledge_point", "label_id": kp_id, "role": "primary", "confidence": None, "related_kp_id": None}])
            snapshot.append(prepared)
        db.add(TeacherPaperAttempt(
            id=str(uuid.uuid4()), student_id=paper.student_id, paper_id=homework_paper_id(assignment.id),
            catalog_code=HOMEWORK_CATALOG, node_id=assignment.id, title=assignment.title,
            question_ids=[q["id"] for q in snapshot], questions=snapshot, status="in_progress",
        ))
        opened += 1
    return opened


async def homework_scores(db: AsyncSession, student_id: str, rows) -> dict[str, dict]:
    """Each finished attempt's score on the teacher's scale, also out of 100.

    Released results use the teacher's reviewed total. Until then the app's own grading
    stands in, weighted by the teacher's points for each question. [rows] are
    (attempt, assignment) pairs."""
    done = [(attempt, assignment) for attempt, assignment in rows if attempt.completed_at is not None]
    if not done:
        return {}
    released = [assignment.id for _, assignment in done if assignment.results_released_at is not None]
    totals = {}
    if released:
        # The newest submission wins, as a rescan replaces the earlier one.
        for assignment_id, total, maximum in (await db.execute(
            select(TeacherSubmission.assignment_id, TeacherSubmission.total_score,
                   func.sum(TeacherSubmissionItem.max_score))
            .join(TeacherSubmissionItem, TeacherSubmissionItem.submission_id == TeacherSubmission.id)
            .where(TeacherSubmission.student_id == student_id, TeacherSubmission.assignment_id.in_(released),
                   TeacherSubmission.total_score.is_not(None))
            .group_by(TeacherSubmission.id).order_by(TeacherSubmission.created_at)
        )).all():
            totals[assignment_id] = (float(total), float(maximum or 0))
    graded = [(attempt, assignment) for attempt, assignment in done if assignment.id not in totals]
    if graded:
        papers = dict((await db.execute(select(TeacherStudentPaper.assignment_id, TeacherStudentPaper.items).where(
            TeacherStudentPaper.student_id == student_id,
            TeacherStudentPaper.assignment_id.in_([assignment.id for _, assignment in graded])))).all())
        answers = {}
        for answer in (await db.scalars(select(StudentAnswer).where(
            StudentAnswer.student_id == student_id,
            StudentAnswer.teacher_paper_attempt_id.in_([attempt.id for attempt, _ in graded]),
        ).order_by(StudentAnswer.created_at, StudentAnswer.id))).all():
            answers[(answer.teacher_paper_attempt_id, answer.question_id)] = answer
        for attempt, assignment in graded:
            points = {item["question_id"]: float(item["points"]) for item in papers.get(assignment.id) or []}
            types = {question["id"]: question.get("question_type") for question in attempt.questions or []}
            if not points or any(qid not in points for qid in attempt.question_ids):
                continue
            earned = 0.0
            for qid in attempt.question_ids:
                answer = answers.get((attempt.id, qid))
                if answer is None:
                    continue
                grading = answer.grading_result if isinstance(answer.grading_result, dict) else {}
                credit = None if is_choice(types.get(qid)) else process_grading_credit(grading)
                earned += points[qid] * (credit if credit is not None else float(bool(answer.is_correct)))
            totals[assignment.id] = (_half(earned), sum(points[qid] for qid in attempt.question_ids))
    scores = {}
    for attempt, assignment in done:
        total, maximum = totals.get(assignment.id, (None, 0))
        if total is None or maximum <= 0:
            continue
        scores[attempt.id] = {"score": total, "max_score": maximum,
                              "score_percent": round(100 * max(0.0, min(1.0, total / maximum))),
                              "results_released": assignment.id in released}
    return scores


async def student_homework(db: AsyncSession, student_id: str, *, history: bool = False) -> list[dict]:
    """The student's teacher homework, newest first; finished ones stay listed for a week,
    or for good in the [history] list."""
    from app.models.teacher import Teacher

    rows = (await db.execute(
        select(TeacherPaperAttempt, TeacherAssignment, TeacherClass.name, Teacher.status)
        .join(TeacherAssignment, TeacherAssignment.id == TeacherPaperAttempt.node_id)
        .join(Teacher, Teacher.id == TeacherAssignment.teacher_id)
        .join(TeacherClass, TeacherClass.id == TeacherAssignment.class_id)
        .join(TeacherClassMember, (TeacherClassMember.class_id == TeacherAssignment.class_id)
              & (TeacherClassMember.student_id == TeacherPaperAttempt.student_id))
        .where(TeacherPaperAttempt.student_id == student_id, TeacherPaperAttempt.catalog_code == HOMEWORK_CATALOG,
               TeacherAssignment.removed_at.is_(None),
               TeacherClassMember.added_at <= func.coalesce(TeacherAssignment.published_at, TeacherAssignment.created_at))
        .order_by(TeacherPaperAttempt.created_at.desc())
    )).all()
    now = datetime.now(timezone.utc)
    counts = dict((await db.execute(
        select(StudentAnswer.teacher_paper_attempt_id, func.count(func.distinct(StudentAnswer.question_id)))
        .where(StudentAnswer.student_id == student_id,
               StudentAnswer.teacher_paper_attempt_id.in_([attempt.id for attempt, _, _, _ in rows]))
        .group_by(StudentAnswer.teacher_paper_attempt_id)
    )).all()) if rows else {}
    listed = []
    scores = await homework_scores(db, student_id, [(attempt, assignment) for attempt, assignment, _, _ in rows])
    for attempt, assignment, class_name, teacher_status in rows:
        done = attempt.completed_at
        if done is None and teacher_status != "active":
            continue  # The teacher's account is disabled: nobody would review it (owned_attempt refuses it too).
        if not history and done is not None and (now - (done if done.tzinfo else done.replace(tzinfo=timezone.utc))).days > 7:
            continue
        if done is None and assignment.results_released_at is not None:
            continue  # Results are out: unfinished work is closed (owned_attempt refuses it too).
        answered = counts.get(attempt.id, 0)
        listed.append({
            "attempt_id": attempt.id,
            "assignment_id": assignment.id,
            "title": attempt.title,
            "class_name": class_name,
            "question_count": len(attempt.question_ids),
            "graded_count": answered,
            "status": attempt.status,
            "published_at": assignment.published_at.isoformat() if assignment.published_at else None,
            "delivery": "paper" if attempt.paper_id.startswith("homework-paper:") else "app",
            **scores.get(attempt.id, {}),
        })
    return listed


async def homework_attempt(db: AsyncSession, student_id: str, attempt_id: str) -> TeacherPaperAttempt | None:
    return await db.scalar(select(TeacherPaperAttempt).join(TeacherAssignment, TeacherAssignment.id == TeacherPaperAttempt.node_id)
        .join(TeacherClassMember, (TeacherClassMember.class_id == TeacherAssignment.class_id)
              & (TeacherClassMember.student_id == TeacherPaperAttempt.student_id)).where(
        TeacherPaperAttempt.id == attempt_id, TeacherPaperAttempt.student_id == student_id,
        TeacherPaperAttempt.catalog_code == HOMEWORK_CATALOG, TeacherAssignment.removed_at.is_(None),
        TeacherClassMember.added_at <= func.coalesce(TeacherAssignment.published_at, TeacherAssignment.created_at),
    ))


def _relative_upload(path: str | None) -> str | None:
    if isinstance(path, str) and path.startswith(ANSWER_PREFIX) and ".." not in path:
        return path[len(ANSWER_PREFIX):]
    return None


def _score_untrustworthy(grading: dict) -> bool:
    """Judged correct at a failing process score, or the answer tried to steer the grader.
    Judged wrong with most process credit is a small deduction, not a contradiction."""
    conflict = grading.get(PROCESS_CONFLICT_KEY)
    return (isinstance(conflict, dict) and conflict.get("is_correct") is True
            or grading.get("grading_basis") == INSTRUCTION_IN_ANSWER_BASIS)


def _part_scores(grading: dict, item_score: float | None, maximum: float) -> list[dict] | None:
    """The AI's per-question steps as the teacher's score boxes, when they add up to the paper's."""
    if item_score is None:
        return None
    parts: dict[str, dict] = {}
    for step in grading.get("step_scores") or []:
        number = re.search(r"\d+", str(step.get("name") or "")) if isinstance(step, dict) else None
        if number is None:
            return None
        part = parts.setdefault(f"({number.group()})", {"points": 0.0, "score": 0.0, "reasons": []})
        part["points"] += float(step.get("max_score") or 0)
        part["score"] += float(step.get("score") or 0)
        part["reasons"].append(str(step.get("comment") or ""))
    if (not parts or sum(part["score"] for part in parts.values()) != item_score
            or sum(part["points"] for part in parts.values()) != maximum):
        return None
    return [{"label": label, "points": part["points"], "score": part["score"],
             "reason": " ".join(filter(None, part["reasons"]))[:300]} for label, part in parts.items()]


async def sync_app_submissions(db: AsyncSession, assignment: TeacherAssignment, *,
                               student_ids: list[str] | None = None, commit: bool = True) -> int:
    """Turn each completed app attempt into a teacher submission, once.

    Runs when a student finishes (for that student) and, as a safety net, when the teacher opens
    the homework. A handful of queries whatever the class size."""
    # Released results are final: an attempt finished afterwards is not folded in.
    if (assignment.kind != "personalized" and (assignment.settings or {}).get("delivery") != "app") or assignment.status != "published" or assignment.results_released_at:
        return 0
    query = select(TeacherStudentPaper).where(
        TeacherStudentPaper.assignment_id == assignment.id, TeacherStudentPaper.delivery == "app")
    if student_ids is not None:
        query = query.where(TeacherStudentPaper.student_id.in_(student_ids))
    papers = (await db.execute(query)).scalars().all()
    collected = set((await db.scalars(select(TeacherSubmission.student_id).where(
        TeacherSubmission.assignment_id == assignment.id))).all())
    pending = [paper for paper in papers if paper.student_id not in collected]
    if not pending:
        return 0
    attempts = {attempt.student_id: attempt for attempt in (await db.scalars(select(TeacherPaperAttempt).where(
        TeacherPaperAttempt.student_id.in_([paper.student_id for paper in pending]),
        TeacherPaperAttempt.paper_id == homework_paper_id(assignment.id),
        TeacherPaperAttempt.status == "completed",
    ))).all()}
    if not attempts:
        return 0
    answered: dict[str, dict[str, StudentAnswer]] = {}
    for row in (await db.scalars(select(StudentAnswer).where(
            StudentAnswer.teacher_paper_attempt_id.in_([attempt.id for attempt in attempts.values()])))).all():
        answered.setdefault(row.teacher_paper_attempt_id, {})[row.question_id] = row
    created = 0
    for paper in pending:
        attempt = attempts.get(paper.student_id)
        if attempt is None:
            continue
        answers = answered.get(attempt.id, {})
        snapshot = {q["id"]: q for q in paper.question_snapshot or []}
        submission = TeacherSubmission(
            id=f"sub_{uuid.uuid4().hex}", assignment_id=assignment.id, student_id=paper.student_id,
            status="recognized", ai_authorized=True, source="app",
        )
        # Several pages may fold the same finished paper in at once (they all sync on read):
        # the first one wins, the others find it collected instead of failing.
        try:
            async with db.begin_nested():
                db.add(submission)
                await db.flush()
        except IntegrityError:
            continue
        for number, item in enumerate(paper.items, start=1):
            question = snapshot.get(item["question_id"], {})
            answer = answers.get(item["question_id"])
            points = float(item["points"])
            if is_choice(question.get("question_type")):
                letters = normalize_choice_answer(answer.given_answer, question["question_type"]) if answer else None
                db.add(TeacherSubmissionItem(
                    submission_id=submission.id, number=number, question_id=item["question_id"], kind="choice",
                    answer=letters, recognized_answer=letters, confidence=1.0 if answer else None,
                    is_correct=answer.is_correct if answer else None,
                    status="recognized" if answer else "missing", max_score=points,
                ))
                continue
            grading = answer.grading_result if answer and isinstance(answer.grading_result, dict) else {}
            pending = bool(grading.get("_pending_confirmation") or grading.get("needs_human_review"))
            credit = process_grading_credit(grading) if grading else None
            if credit is None and answer is not None and not pending:
                credit = 1.0 if answer.is_correct else 0.0
            image = _relative_upload(grading.get("answer_image_path"))
            item_score = (_half(points * credit)
                          if credit is not None and not _score_untrustworthy(grading) else None)
            db.add(TeacherSubmissionItem(
                submission_id=submission.id, number=number, question_id=item["question_id"], kind="area",
                crop_path=image, answer=None if image or answer is None else (answer.given_answer or "")[:2000],
                status="collected" if answer else "missing", max_score=points,
                score=item_score, part_scores=_part_scores(grading, item_score, points),
                error_type=grading.get("error_type"), first_error=grading.get("first_error"),
                feedback=grading.get("feedback"),
                ai_result={**grading, "source": "app", "_ai_score": item_score} if answer else None,
                # Any score the AI gave stands, zero and blank included; teachers spot-check and may
                # change it before release. Only an answer with no usable score waits for them.
                grade_status="auto_passed" if item_score is not None else "needs_review",
            ))
        created += 1
    if created:
        await (db.commit() if commit else db.flush())
    return created


async def sync_finished_attempt(db: AsyncSession, attempt: TeacherPaperAttempt) -> None:
    """A student just finished an App homework: hand it in to the teacher now. Best effort —
    the teacher's pages fold in anything this misses, and the student's answer never fails for it."""
    if attempt.catalog_code != HOMEWORK_CATALOG or not attempt.paper_id.startswith("homework:"):
        return
    assignment = await db.get(TeacherAssignment, attempt.node_id)
    if assignment is None or assignment.removed_at:
        return
    try:
        async with db.begin_nested():
            await sync_app_submissions(db, assignment, student_ids=[attempt.student_id], commit=False)
    except Exception:  # noqa: BLE001
        import logging
        logging.getLogger(__name__).exception("folding finished App homework %s failed", attempt.id)


async def sync_open_homework(db: AsyncSession, assignments: list[TeacherAssignment]) -> None:
    """Fold finished app papers into the open App homework that has any, so turn-in counts are
    current wherever they are shown. One query finds which ones; most lists need none."""
    open_ids = [a.id for a in assignments if a.status == "published" and not a.results_released_at]
    if not open_ids:
        return
    waiting = set((await db.scalars(select(TeacherPaperAttempt.node_id).where(
        TeacherPaperAttempt.catalog_code == HOMEWORK_CATALOG, TeacherPaperAttempt.node_id.in_(open_ids),
        TeacherPaperAttempt.status == "completed", TeacherPaperAttempt.paper_id.like("homework:%"),
        ~select(TeacherSubmission.id).where(
            TeacherSubmission.assignment_id == TeacherPaperAttempt.node_id,
            TeacherSubmission.student_id == TeacherPaperAttempt.student_id,
        ).exists(),
    ).distinct())).all())
    for assignment in assignments:
        if assignment.id in waiting:
            await sync_app_submissions(db, assignment)
