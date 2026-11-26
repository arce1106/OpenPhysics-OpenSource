from app.services.adaptive_service import AdaptiveService
from app.services.answer_media_service import answer_media_service
from app.services.grading_reliability import UngradableQuestion
from .answer_rewards import award_answer_rewards
from app.services.question_service import QuestionService
from app.services.quest_service import QuestService
from app.services.reward_service import RewardService
from app.services.rich_content_render_service import RichContentRenderService
from app.services.student_service import CorrectionNotAllowed, StudentService
from fastapi import APIRouter, Depends, Header, HTTPException

from . import schemas
from .dependencies import (
    ensure_student_can_access_kp,
    ensure_student_can_access_question,
    get_adaptive_service,
    get_current_student_id,
    get_question_service,
    get_quest_service,
    get_rich_content_render_service,
    get_reward_service,
    get_student_service,
    include_rendered_requested,
    maybe_enrich_rich_content,
    student_has_full_learning_access,
)

router = APIRouter()


@router.get("/practice/session", response_model=schemas.PracticeSessionResponse)
async def get_practice_session(
    student_id: str = Depends(get_current_student_id),
    target_kp: str | None = None,
    count: int = 5,
    adaptive_svc: AdaptiveService = Depends(get_adaptive_service),
    student_svc: StudentService = Depends(get_student_service),
    rich_content_svc: RichContentRenderService = Depends(get_rich_content_render_service),
    include_rendered: bool = False,
    x_openphysics_include_rendered: str | None = Header(default=None, alias="X-OpenPhysics-Include-Rendered"),
):
    if target_kp:
        await ensure_student_can_access_kp(student_id, target_kp, student_svc)
    elif not await student_has_full_learning_access(student_id, student_svc):
        raise HTTPException(status_code=401, detail="Student account unavailable")
    session = await adaptive_svc.get_practice_session(student_id, target_kp, count=max(1, min(count, 20)))
    await maybe_enrich_rich_content(
        rich_content_svc,
        "enrich_questions",
        session.get("questions"),
        include_rendered=include_rendered_requested(include_rendered, x_openphysics_include_rendered),
    )
    return session


@router.post("/practice/submit", response_model=schemas.SubmitAnswerResponse)
async def submit_answer(
    body: schemas.SubmitAnswerRequest,
    student_id: str = Depends(get_current_student_id),
    adaptive_svc: AdaptiveService = Depends(get_adaptive_service),
    reward_svc: RewardService = Depends(get_reward_service),
    quest_svc: QuestService = Depends(get_quest_service),
    student_svc: StudentService = Depends(get_student_service),
    rich_content_svc: RichContentRenderService = Depends(get_rich_content_render_service),
    include_rendered: bool = False,
    x_openphysics_include_rendered: str | None = Header(default=None, alias="X-OpenPhysics-Include-Rendered"),
):
    await ensure_student_can_access_question(student_id, body.question_id, student_svc)
    if body.target_knowledge_point_id:
        await ensure_student_can_access_kp(
            student_id,
            body.target_knowledge_point_id,
            student_svc,
        )
    try:
        result = await adaptive_svc.submit_answer(
            student_id,
            body.question_id,
            body.given_answer,
            body.time_spent_ms,
            submission_id=body.submission_id,
            target_knowledge_point_id=body.target_knowledge_point_id,
            **({"topic_context": body.topic_context.model_dump()} if body.topic_context else {}),
            **({"teacher_paper_attempt_id": body.teacher_paper_attempt_id} if body.teacher_paper_attempt_id else {}),
        )
    except UngradableQuestion as e:
        raise HTTPException(status_code=422, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    if result.get("idempotent_replay"):
        await maybe_enrich_rich_content(
            rich_content_svc,
            "enrich_submit_response",
            result,
            include_rendered=include_rendered_requested(include_rendered, x_openphysics_include_rendered),
        )
        return answer_media_service.secure_payload(student_id, result)

    await award_answer_rewards(
        result,
        student_id=student_id,
        question_id=body.question_id,
        question=await adaptive_svc.question_svc.get_question(body.question_id),
        time_spent_ms=body.time_spent_ms,
        reward_svc=reward_svc,
        quest_svc=quest_svc,
    )

    await maybe_enrich_rich_content(
        rich_content_svc,
        "enrich_submit_response",
        result,
        include_rendered=include_rendered_requested(include_rendered, x_openphysics_include_rendered),
    )
    return answer_media_service.secure_payload(student_id, result)


@router.post("/practice/answers/{answer_id}/correct", response_model=schemas.SubmitAnswerResponse)
async def correct_answer_grading(
    answer_id: int,
    body: schemas.ManualCorrectionRequest,
    student_id: str = Depends(get_current_student_id),
    student_svc: StudentService = Depends(get_student_service),
    question_svc: QuestionService = Depends(get_question_service),
    rich_content_svc: RichContentRenderService = Depends(get_rich_content_render_service),
    include_rendered: bool = False,
    x_openphysics_include_rendered: str | None = Header(default=None, alias="X-OpenPhysics-Include-Rendered"),
):
    """Manually correct an AI grading result and rebuild affected mastery."""
    try:
        corrected = await student_svc.apply_manual_correction(
            student_id=student_id,
            answer_id=answer_id,
            corrected_answer=body.corrected_answer,
            is_correct=body.is_correct,
            correction_reason=body.correction_reason,
            error_type=body.error_type,
        )
    except CorrectionNotAllowed as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    question = await question_svc.get_question(corrected["question_id"])
    result = {
        "answer_id": corrected["answer_id"],
        "is_correct": corrected["is_correct"],
        "correct_answer": question.answer if question else "",
        "explanation": question.explanation if question else None,
        "mastery_update": corrected["mastery_update"],
        "detected_misconception": None,
        "needs_intervention": False,
        "ai_feedback": "已按人工纠错结果修正。",
        "extracted_answer": corrected["given_answer"],
        "process_grading": corrected["process_grading"],
    }
    await maybe_enrich_rich_content(
        rich_content_svc,
        "enrich_submit_response",
        result,
        include_rendered=include_rendered_requested(include_rendered, x_openphysics_include_rendered),
    )
    return answer_media_service.secure_payload(student_id, result)


@router.post("/practice/next", response_model=schemas.NextPracticeQuestionResponse)
async def get_next_practice_question(
    body: schemas.NextPracticeQuestionRequest,
    student_id: str = Depends(get_current_student_id),
    adaptive_svc: AdaptiveService = Depends(get_adaptive_service),
    student_svc: StudentService = Depends(get_student_service),
    rich_content_svc: RichContentRenderService = Depends(get_rich_content_render_service),
    include_rendered: bool = False,
    x_openphysics_include_rendered: str | None = Header(default=None, alias="X-OpenPhysics-Include-Rendered"),
):
    if body.target_kp:
        await ensure_student_can_access_kp(student_id, body.target_kp, student_svc)
    elif not await student_has_full_learning_access(student_id, student_svc):
        raise HTTPException(status_code=401, detail="Student account unavailable")
    result = await adaptive_svc.get_next_practice_question(
        student_id=student_id,
        target_kp_id=body.target_kp,
        recent_question_ids=body.recent_question_ids,
        recent_question_types=body.recent_question_types,
    )
    await maybe_enrich_rich_content(
        rich_content_svc,
        "enrich_question",
        result.get("question"),
        include_rendered=include_rendered_requested(include_rendered, x_openphysics_include_rendered),
    )
    return result
