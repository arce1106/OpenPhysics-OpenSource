from app.services.adaptive_service import AdaptiveService
from app.services.grading_reliability import UngradableQuestion
from app.services.knowledge_service import KnowledgeService, canonical_kp_name
from app.services.learning_state_rules import (
    PRACTICE_RECOMMENDATION_THRESHOLD,
    recommend_learning_action,
    recommend_scope_learning_action,
)
from app.services.question_ordering import ordered_questions_for_student
from app.services.question_service import QuestionService
from app.services.rich_content_render_service import RichContentRenderService
from app.services.reward_service import RewardService
from app.services.student_service import StudentService
from fastapi import APIRouter, Depends, Header, HTTPException
from app.models.question import Question
from app.models.student import StudentAnswer
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from . import schemas
from .dependencies import (
    ensure_student_can_access_kp,
    ensure_student_can_access_question,
    get_adaptive_service,
    get_current_student_id,
    get_diagnostic_attempt_service,
    get_knowledge_service,
    get_question_service,
    get_rich_content_render_service,
    get_reward_service,
    get_student_service,
    include_rendered_requested,
    maybe_enrich_rich_content,
)
from app.services.diagnostic_attempt_service import DiagnosticAttemptService

router = APIRouter()


def _mastery_before_from_payload(
    answers: list[schemas.SubmittedDiagnosticAnswer],
    kp_id: str,
    fallback: float,
) -> float:
    for answer in answers:
        update = answer.mastery_update.get(kp_id)
        if update:
            return update.before
    return fallback


def _diagnostic_mastery_after(
    *,
    correct_count: int,
    total_count: int,
    mastery_before: float,
    mastery_after: float,
) -> float:
    if total_count > 0 and correct_count <= 0 and mastery_after > mastery_before:
        return mastery_before
    return mastery_after


async def _load_submitted_answers(
    adaptive_svc: AdaptiveService,
    student_id: str,
    answers: list[schemas.SubmittedDiagnosticAnswer],
) -> list[tuple[StudentAnswer, Question]]:
    answer_ids = [answer.answer_id for answer in answers]
    if not answer_ids:
        raise HTTPException(status_code=400, detail="No submitted answers provided")

    db = adaptive_svc.db
    result = await db.execute(
        select(StudentAnswer, Question)
        .join(Question, Question.id == StudentAnswer.question_id)
        .where(
            StudentAnswer.student_id == student_id,
            StudentAnswer.id.in_(answer_ids),
        )
        .options(selectinload(Question.labels))
    )
    rows_by_id = {answer.id: (answer, question) for answer, question in result.all()}
    missing_ids = [answer_id for answer_id in answer_ids if answer_id not in rows_by_id]
    if missing_ids:
        raise HTTPException(status_code=400, detail="Submitted answers are invalid")
    return [rows_by_id[answer_id] for answer_id in answer_ids]


async def _scope_kps(
    knowledge_svc: KnowledgeService,
    scope_type: str,
    scope_id: str,
):
    if scope_type == "chapter":
        return await knowledge_svc.get_points_by_chapter(scope_id), scope_id
    if scope_type == "section":
        chapter, section = scope_id.split("||", 1)
        return await knowledge_svc.get_points_by_section(chapter, section), section
    raise HTTPException(status_code=400, detail="Invalid scope_type")


async def _ensure_scope_access(
    student_id: str,
    kps,
    student_svc: StudentService,
) -> None:
    for kp in kps:
        await ensure_student_can_access_kp(student_id, kp.id, student_svc)

@router.post("/diagnose/kp/{kp_id}", response_model=schemas.DiagnoseResponse)
async def diagnose_kp(
    kp_id: str,
    body: schemas.KpDiagnoseRequest,
    student_id: str = Depends(get_current_student_id),
    adaptive_svc: AdaptiveService = Depends(get_adaptive_service),
    knowledge_svc: KnowledgeService = Depends(get_knowledge_service),
    student_svc: StudentService = Depends(get_student_service),
    rich_content_svc: RichContentRenderService = Depends(get_rich_content_render_service),
    include_rendered: bool = False,
    x_openphysics_include_rendered: str | None = Header(default=None, alias="X-OpenPhysics-Include-Rendered"),
):
    """Quick diagnostic for a specific knowledge point (2-3 questions)."""
    await ensure_student_can_access_kp(student_id, kp_id, student_svc)
    kp = await knowledge_svc.get_point(kp_id)
    if not kp:
        raise HTTPException(status_code=404, detail="Knowledge point not found")
    kp_name = canonical_kp_name(kp_id, kp.name)

    session = await adaptive_svc.get_practice_session(
        student_id, target_kp_id=kp_id, count=body.question_count
    )
    session["session_type"] = "kp_diagnostic"
    session["session_objective"] = f"掌握评估「{kp_name}」"
    await maybe_enrich_rich_content(
        rich_content_svc,
        "enrich_questions",
        session.get("questions"),
        include_rendered=include_rendered_requested(include_rendered, x_openphysics_include_rendered),
    )
    return session


@router.post("/diagnose/kp/{kp_id}/feedback", response_model=schemas.KpDiagnosticResult)
async def diagnose_kp_feedback(
    kp_id: str,
    body: schemas.KpDiagnosticFeedbackRequest,
    student_id: str = Depends(get_current_student_id),
    adaptive_svc: AdaptiveService = Depends(get_adaptive_service),
    knowledge_svc: KnowledgeService = Depends(get_knowledge_service),
    student_svc: StudentService = Depends(get_student_service),
    reward_svc: RewardService = Depends(get_reward_service),
):
    """Submit diagnostic answers and get feedback with recommendation."""
    await ensure_student_can_access_kp(student_id, kp_id, student_svc)
    kp = await knowledge_svc.get_point(kp_id)
    if not kp:
        raise HTTPException(status_code=404, detail="Knowledge point not found")
    kp_name = canonical_kp_name(kp_id, kp.name)

    # Get mastery before
    before_mastery = await student_svc.get_mastery(student_id, kp_id)
    mastery_before = before_mastery.mastery if before_mastery else 0.0

    # Submit each answer
    correct_count = 0
    ungradable_count = 0
    for a in body.answers:
        try:
            await ensure_student_can_access_question(student_id, a.question_id, student_svc)
            result = await adaptive_svc.submit_answer(
                student_id,
                a.question_id,
                a.given_answer,
                a.time_spent_ms,
                target_knowledge_point_id=kp_id,
            )
            if result["is_correct"]:
                correct_count += 1
            # Fire reward event
            await reward_svc.record_event(
                student_id, "question_answered",
                question_id=a.question_id,
                knowledge_point_id=kp_id,
                payload={
                    "question_id": a.question_id,
                    "knowledge_point_id": kp_id,
                    "is_correct": result.get("is_correct"),
                    "difficulty": 2,
                    "time_spent_sec": (a.time_spent_ms or 0) // 1000,
                    "kp_name": kp_name,
                },
            )
        except UngradableQuestion:
            ungradable_count += 1  # No standard answer: not scored either way.
        except ValueError:
            pass

    total = len(body.answers) - ungradable_count
    after_mastery = await student_svc.get_mastery(student_id, kp_id)
    mastery_after = after_mastery.mastery if after_mastery else mastery_before
    mastery_after = _diagnostic_mastery_after(
        correct_count=correct_count,
        total_count=total,
        mastery_before=mastery_before,
        mastery_after=mastery_after,
    )

    # Recommendation logic
    recommendation = recommend_learning_action(mastery_after)
    if recommendation == "mastered":
        feedback = f"评估结果：{correct_count}/{total} 正确。你已经很好地掌握了「{kp_name}」，可以直接进入练习或学习下一个知识点。"
    elif recommendation == "practice":
        feedback = f"评估结果：{correct_count}/{total} 正确。你对「{kp_name}」有一定基础，建议通过练习来巩固提升。"
    else:
        feedback = f"评估结果：{correct_count}/{total} 正确。建议先系统学习「{kp_name}」的核心概念和公式，再进行练习。"

    return schemas.KpDiagnosticResult(
        kp_id=kp_id,
        kp_name=kp_name,
        correct_count=correct_count,
        total_count=total,
        mastery_before=mastery_before,
        mastery_after=mastery_after,
        recommendation=recommendation,
        feedback=feedback,
    )


@router.post("/diagnose/kp/{kp_id}/submitted-feedback", response_model=schemas.KpDiagnosticResult)
async def diagnose_kp_submitted_feedback(
    kp_id: str,
    body: schemas.SubmittedKpDiagnosticFeedbackRequest,
    student_id: str = Depends(get_current_student_id),
    adaptive_svc: AdaptiveService = Depends(get_adaptive_service),
    knowledge_svc: KnowledgeService = Depends(get_knowledge_service),
    student_svc: StudentService = Depends(get_student_service),
):
    """Summarize already graded diagnostic answers without submitting them again."""
    await ensure_student_can_access_kp(student_id, kp_id, student_svc)
    kp = await knowledge_svc.get_point(kp_id)
    if not kp:
        raise HTTPException(status_code=404, detail="Knowledge point not found")
    kp_name = canonical_kp_name(kp_id, kp.name)

    submitted_rows = await _load_submitted_answers(adaptive_svc, student_id, body.answers)
    kp_rows = [
        (answer, question)
        for answer, question in submitted_rows
        if StudentService.evidence_knowledge_point_id(answer, question, {kp_id}) == kp_id
    ]
    if not kp_rows:
        raise HTTPException(status_code=400, detail="Submitted answers do not match knowledge point")

    current_mastery = await student_svc.get_mastery(student_id, kp_id)
    mastery_after = current_mastery.mastery if current_mastery else 0.0
    mastery_before = _mastery_before_from_payload(body.answers, kp_id, mastery_after)
    correct_count = sum(1 for answer, _ in kp_rows if answer.is_correct)
    total = len(kp_rows)
    mastery_after = _diagnostic_mastery_after(
        correct_count=correct_count,
        total_count=total,
        mastery_before=mastery_before,
        mastery_after=mastery_after,
    )

    recommendation = recommend_learning_action(mastery_after)
    if recommendation == "mastered":
        feedback = f"评估结果：{correct_count}/{total} 正确。你已经很好地掌握了「{kp_name}」，可以进入巩固提升或学习下一个知识点。"
    elif recommendation == "practice":
        feedback = f"评估结果：{correct_count}/{total} 正确。你对「{kp_name}」有一定基础，建议通过练习来巩固提升。"
    else:
        feedback = f"评估结果：{correct_count}/{total} 正确。建议先系统学习「{kp_name}」的核心概念和公式，再进行练习。"

    return schemas.KpDiagnosticResult(
        kp_id=kp_id,
        kp_name=kp_name,
        correct_count=correct_count,
        total_count=total,
        mastery_before=mastery_before,
        mastery_after=mastery_after,
        recommendation=recommendation,
        feedback=feedback,
    )


# ── Scope Diagnostic BFF ─────────────────────────────────────────────────────


@router.post("/diagnose/scope", response_model=schemas.DiagnoseResponse)
async def diagnose_scope(
    body: schemas.ScopeDiagnoseRequest,
    student_id: str = Depends(get_current_student_id),
    adaptive_svc: AdaptiveService = Depends(get_adaptive_service),
    knowledge_svc: KnowledgeService = Depends(get_knowledge_service),
    question_svc: QuestionService = Depends(get_question_service),
    student_svc: StudentService = Depends(get_student_service),
    rich_content_svc: RichContentRenderService = Depends(get_rich_content_render_service),
    include_rendered: bool = False,
    x_openphysics_include_rendered: str | None = Header(default=None, alias="X-OpenPhysics-Include-Rendered"),
):
    """Start a diagnostic covering all KPs in a chapter or section."""
    # Collect KP IDs in scope
    if body.scope_type == "chapter":
        kps = await knowledge_svc.get_points_by_chapter(body.scope_id)
    elif body.scope_type == "section":
        chapter, section = body.scope_id.split("||", 1)
        kps = await knowledge_svc.get_points_by_section(chapter, section)
    else:
        raise HTTPException(status_code=400, detail="Invalid scope_type")

    if not kps:
        raise HTTPException(status_code=404, detail="No knowledge points found in scope")
    await _ensure_scope_access(student_id, kps, student_svc)

    # Distribute questions across KPs (1-2 per KP, cap at question_count)
    kp_count = len(kps)
    per_kp = max(1, body.question_count // kp_count)
    questions = []
    seen_question_ids: set[str] = set()
    question_target_kp_ids: dict[str, str] = {}
    for i, kp in enumerate(kps):
        if len(questions) >= body.question_count:
            break
        qs = await question_svc.get_questions_by_knowledge_point(kp.id, limit=per_kp)
        for question in qs:
            if question.id in seen_question_ids:
                continue
            seen_question_ids.add(question.id)
            questions.append(question)
            question_target_kp_ids[question.id] = kp.id
            if len(questions) >= body.question_count:
                break
    questions = ordered_questions_for_student(questions)[:body.question_count]

    # Build response without session_structure (scope diagnostic is flat, no phases)
    result = {
        "session_type": "scope_diagnostic",
        "strategy": "scope_diagnostic",
        "session_objective": f"{'本章掌握评估' if body.scope_type == 'chapter' else '本节掌握评估'}「{body.scope_id}」— {len(kps)} 个知识点",
        "questions": [
            adaptive_svc._serialize_question(
                q,
                route="scope_diagnostic",
                target_knowledge_point_id=question_target_kp_ids.get(q.id),
            )
            for q in questions
        ],
    }
    await maybe_enrich_rich_content(
        rich_content_svc,
        "enrich_questions",
        result.get("questions"),
        include_rendered=include_rendered_requested(include_rendered, x_openphysics_include_rendered),
    )
    return result


@router.post("/diagnose/scope/feedback", response_model=schemas.ScopeDiagnosticResult)
async def diagnose_scope_feedback(
    body: schemas.ScopeDiagnosticFeedbackRequest,
    student_id: str = Depends(get_current_student_id),
    adaptive_svc: AdaptiveService = Depends(get_adaptive_service),
    knowledge_svc: KnowledgeService = Depends(get_knowledge_service),
    student_svc: StudentService = Depends(get_student_service),
    reward_svc: RewardService = Depends(get_reward_service),
    attempt_svc: DiagnosticAttemptService = Depends(get_diagnostic_attempt_service),
):
    """Submit scope diagnostic answers and get per-KP breakdown."""
    # Determine scope name
    if body.scope_type == "chapter":
        kps = await knowledge_svc.get_points_by_chapter(body.scope_id)
        scope_name = body.scope_id
    elif body.scope_type == "section":
        chapter, section = body.scope_id.split("||", 1)
        kps = await knowledge_svc.get_points_by_section(chapter, section)
        scope_name = section
    else:
        raise HTTPException(status_code=400, detail="Invalid scope_type")
    await _ensure_scope_access(student_id, kps, student_svc)

    # Map question_id -> kp_id by matching questions to KPs via labels
    kp_results: dict[str, dict] = {}
    q_to_kp: dict[str, str] = {}

    for kp in kps:
        kp_results[kp.id] = {
            "kp_id": kp.id,
            "kp_name": canonical_kp_name(kp.id, kp.name),
            "correct_count": 0,
            "total_count": 0,
            "mastery_before": 0.0,
            "mastery_after": 0.0,
        }

    # Get mastery before for all KPs in scope
    mastery_before_map: dict[str, float] = {}
    for kp_id in kp_results:
        m = await student_svc.get_mastery(student_id, kp_id)
        mastery_before_map[kp_id] = m.mastery if m else 0.0
        kp_results[kp_id]["mastery_before"] = mastery_before_map[kp_id]

    # Submit answers and assign to KPs
    from app.models.question import Question
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    # Fetch questions with labels eagerly loaded
    q_ids = [a.question_id for a in body.answers]
    db = adaptive_svc.db
    result = await db.execute(
        select(Question)
        .where(Question.id.in_(q_ids))
        .options(selectinload(Question.labels))
    )
    questions = {q.id: q for q in result.scalars().all()}

    correct_count = 0
    ungradable_count = 0
    submitted_answer_ids: list[int | str] = []
    submitted_question_ids: list[str] = []
    for a in body.answers:
        q = questions.get(a.question_id)
        if not q:
            continue
        submitted_question_ids.append(a.question_id)

        # Use the explicit session target when supplied; legacy clients fall back
        # to the primary knowledge-point label inside the requested scope.
        try:
            kp_id = adaptive_svc.resolve_target_knowledge_point_id(
                q,
                a.target_knowledge_point_id,
                allowed_ids=set(kp_results),
            )
        except ValueError:
            continue
        if kp_id and kp_id in kp_results:
            kp_results[kp_id]["total_count"] += 1

        try:
            await ensure_student_can_access_question(student_id, a.question_id, student_svc)
            submit_result = await adaptive_svc.submit_answer(
                student_id,
                a.question_id,
                a.given_answer,
                a.time_spent_ms,
                target_knowledge_point_id=kp_id,
            )
            if submit_result.get("answer_id") is not None:
                submitted_answer_ids.append(submit_result["answer_id"])
            if submit_result["is_correct"]:
                correct_count += 1
                if kp_id and kp_id in kp_results:
                    kp_results[kp_id]["correct_count"] += 1
            # Fire reward event
            await reward_svc.record_event(
                student_id, "question_answered",
                question_id=a.question_id,
                knowledge_point_id=kp_id,
                payload={
                    "question_id": a.question_id,
                    "knowledge_point_id": kp_id,
                    "is_correct": submit_result.get("is_correct"),
                    "difficulty": 2,
                    "time_spent_sec": (a.time_spent_ms or 0) // 1000,
                    "kp_name": kp_results[kp_id]["kp_name"] if kp_id and kp_id in kp_results else "",
                },
            )
        except UngradableQuestion:
            # No standard answer: not scored either way.
            ungradable_count += 1
            if kp_id and kp_id in kp_results:
                kp_results[kp_id]["total_count"] -= 1
        except ValueError:
            pass

    # Get mastery after for all KPs that were tested
    weak_kp_ids: list[str] = []
    for kp_id in kp_results:
        m = await student_svc.get_mastery(student_id, kp_id)
        mastery_after = m.mastery if m else kp_results[kp_id]["mastery_before"]
        kp_results[kp_id]["mastery_after"] = _diagnostic_mastery_after(
            correct_count=kp_results[kp_id]["correct_count"],
            total_count=kp_results[kp_id]["total_count"],
            mastery_before=kp_results[kp_id]["mastery_before"],
            mastery_after=mastery_after,
        )
        if (
            kp_results[kp_id]["total_count"] > 0
            and kp_results[kp_id]["mastery_after"] < PRACTICE_RECOMMENDATION_THRESHOLD
        ):
            weak_kp_ids.append(kp_id)

    total = len(body.answers) - ungradable_count
    kp_result_list = [
        schemas.ScopeKpResult(**r) for r in kp_results.values() if r["total_count"] > 0
    ]

    # Overall recommendation
    tested_masteries = [r.mastery_after for r in kp_result_list]
    recommendation = recommend_scope_learning_action(tested_masteries)

    prefix = "本章掌握评估" if body.scope_type == "chapter" else "本节掌握评估"
    if recommendation == "mastered":
        feedback = f"{prefix}结果：{correct_count}/{total} 正确。你对「{scope_name}」掌握得很好！"
    elif recommendation == "practice":
        weak_desc = f"，其中 {len(weak_kp_ids)} 个知识点比较薄弱" if weak_kp_ids else ""
        feedback = f"{prefix}结果：{correct_count}/{total} 正确。你基本掌握了「{scope_name}」{weak_desc}，建议针对薄弱点练习。"
    else:
        weak_desc = f"，其中 {len(weak_kp_ids)} 个知识点需要重点学习" if weak_kp_ids else ""
        feedback = f"{prefix}结果：{correct_count}/{total} 正确。建议先系统学习「{scope_name}」的核心概念{weak_desc}。"

    scope_result = schemas.ScopeDiagnosticResult(
        scope_type=body.scope_type,
        scope_id=body.scope_id,
        scope_name=scope_name,
        kp_results=kp_result_list,
        correct_count=correct_count,
        total_count=total,
        weak_kp_ids=weak_kp_ids,
        recommendation=recommendation,
        feedback=feedback,
    )
    attempt = await attempt_svc.create_from_scope_result(
        student_id,
        scope_result,
        question_ids=submitted_question_ids,
        answer_ids=submitted_answer_ids,
    )
    scope_result.diagnostic_attempt_id = attempt.id
    return scope_result


@router.post("/diagnose/scope/submitted-feedback", response_model=schemas.ScopeDiagnosticResult)
async def diagnose_scope_submitted_feedback(
    body: schemas.SubmittedScopeDiagnosticFeedbackRequest,
    student_id: str = Depends(get_current_student_id),
    adaptive_svc: AdaptiveService = Depends(get_adaptive_service),
    knowledge_svc: KnowledgeService = Depends(get_knowledge_service),
    student_svc: StudentService = Depends(get_student_service),
    attempt_svc: DiagnosticAttemptService = Depends(get_diagnostic_attempt_service),
):
    """Summarize already graded scope diagnostic answers without submitting them again."""
    kps, scope_name = await _scope_kps(knowledge_svc, body.scope_type, body.scope_id)
    if not kps:
        raise HTTPException(status_code=404, detail="No knowledge points found in scope")
    await _ensure_scope_access(student_id, kps, student_svc)

    kp_results: dict[str, dict] = {
        kp.id: {
            "kp_id": kp.id,
            "kp_name": canonical_kp_name(kp.id, kp.name),
            "correct_count": 0,
            "total_count": 0,
            "mastery_before": 0.0,
            "mastery_after": 0.0,
        }
        for kp in kps
    }
    submitted_rows = await _load_submitted_answers(adaptive_svc, student_id, body.answers)

    correct_count = 0
    total = 0
    for answer, question in submitted_rows:
        kp_id = StudentService.evidence_knowledge_point_id(answer, question, set(kp_results))
        if kp_id not in kp_results:
            continue
        total += 1
        kp_results[kp_id]["total_count"] += 1
        if answer.is_correct:
            correct_count += 1
            kp_results[kp_id]["correct_count"] += 1

    if total == 0:
        raise HTTPException(status_code=400, detail="Submitted answers do not match scope")

    weak_kp_ids: list[str] = []
    for kp_id, row in kp_results.items():
        if row["total_count"] <= 0:
            continue
        mastery = await student_svc.get_mastery(student_id, kp_id)
        mastery_after = mastery.mastery if mastery else 0.0
        row["mastery_before"] = _mastery_before_from_payload(body.answers, kp_id, mastery_after)
        row["mastery_after"] = _diagnostic_mastery_after(
            correct_count=row["correct_count"],
            total_count=row["total_count"],
            mastery_before=row["mastery_before"],
            mastery_after=mastery_after,
        )
        if row["mastery_after"] < PRACTICE_RECOMMENDATION_THRESHOLD:
            weak_kp_ids.append(kp_id)

    kp_result_list = [
        schemas.ScopeKpResult(**row)
        for row in kp_results.values()
        if row["total_count"] > 0
    ]
    recommendation = recommend_scope_learning_action([row.mastery_after for row in kp_result_list])

    prefix = "本章掌握评估" if body.scope_type == "chapter" else "本节掌握评估"
    if recommendation == "mastered":
        feedback = f"{prefix}结果：{correct_count}/{total} 正确。你对「{scope_name}」掌握得很好！"
    elif recommendation == "practice":
        weak_desc = f"，其中 {len(weak_kp_ids)} 个知识点比较薄弱" if weak_kp_ids else ""
        feedback = f"{prefix}结果：{correct_count}/{total} 正确。你基本掌握了「{scope_name}」{weak_desc}，建议针对薄弱点练习。"
    else:
        weak_desc = f"，其中 {len(weak_kp_ids)} 个知识点需要重点学习" if weak_kp_ids else ""
        feedback = f"{prefix}结果：{correct_count}/{total} 正确。建议先系统学习「{scope_name}」的核心概念{weak_desc}。"

    scope_result = schemas.ScopeDiagnosticResult(
        scope_type=body.scope_type,
        scope_id=body.scope_id,
        scope_name=scope_name,
        kp_results=kp_result_list,
        correct_count=correct_count,
        total_count=total,
        weak_kp_ids=weak_kp_ids,
        recommendation=recommendation,
        feedback=feedback,
    )
    attempt = await attempt_svc.create_from_scope_result(
        student_id,
        scope_result,
        question_ids=[answer.question_id for answer, _ in submitted_rows],
        answer_ids=[answer.id for answer, _ in submitted_rows],
    )
    scope_result.diagnostic_attempt_id = attempt.id
    return scope_result
