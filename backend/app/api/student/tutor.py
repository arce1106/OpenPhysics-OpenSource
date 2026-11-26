from functools import partial

from app.services.ai_service import AIService
from app.services.question_service import QuestionService
from app.services.rich_content_render_service import RichContentRenderService
from fastapi import APIRouter, Depends, Header, HTTPException

from . import schemas
from .dependencies import (
    ensure_student_can_access_question,
    get_ai_service,
    get_current_student_id,
    get_question_service,
    get_rich_content_render_service,
    get_student_ai_usage_service,
    get_student_service,
    include_rendered_requested,
    maybe_enrich_rich_content,
)
from app.services.student_ai_usage_service import StudentAiUsageService
from app.services.student_service import StudentService

router = APIRouter()

@router.post("/tutor/hint", response_model=schemas.TutorHintResponse)
async def get_tutor_hint(
    body: schemas.TutorHintRequest,
    student_id: str = Depends(get_current_student_id),
    question_svc: QuestionService = Depends(get_question_service),
    student_svc: StudentService = Depends(get_student_service),
    ai_svc: AIService = Depends(get_ai_service),
    ai_usage_svc: StudentAiUsageService = Depends(get_student_ai_usage_service),
    rich_content_svc: RichContentRenderService = Depends(get_rich_content_render_service),
    include_rendered: bool = False,
    x_openphysics_include_rendered: str | None = Header(default=None, alias="X-OpenPhysics-Include-Rendered"),
):
    """Generate an AI-powered tutoring hint, Socratic question, or scaffold."""
    await ensure_student_can_access_question(student_id, body.question_id, student_svc)
    question = await question_svc.get_question(body.question_id)
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    if body.hint_type == "socratic":
        generate = ai_svc.generate_socratic_question
    elif body.hint_type == "scaffold":
        generate = ai_svc.generate_scaffold
    else:
        generate = ai_svc.generate_hint
    text = await ai_usage_svc.run(
        student_id,
        feature=f"tutor.{body.hint_type}",
        operation=partial(generate,
            question_stem=question.stem_text,
            correct_answer=question.answer or "",
            given_answer=body.given_answer,
            explanation=question.explanation,
            process_grading=body.process_grading,
        ),
    )

    payload = {"hint_type": body.hint_type, "text": text}
    enriched = await maybe_enrich_rich_content(
        rich_content_svc,
        "enrich_tutor_payload",
        payload,
        include_rendered=include_rendered_requested(include_rendered, x_openphysics_include_rendered),
    )
    if enriched is not None:
        return enriched
    return payload


@router.post("/tutor/question-chat", response_model=schemas.QuestionTutorChatResponse)
async def question_tutor_chat(
    body: schemas.QuestionTutorChatRequest,
    student_id: str = Depends(get_current_student_id),
    question_svc: QuestionService = Depends(get_question_service),
    student_svc: StudentService = Depends(get_student_service),
    ai_svc: AIService = Depends(get_ai_service),
    ai_usage_svc: StudentAiUsageService = Depends(get_student_ai_usage_service),
    rich_content_svc: RichContentRenderService = Depends(get_rich_content_render_service),
    include_rendered: bool = False,
    x_openphysics_include_rendered: str | None = Header(default=None, alias="X-OpenPhysics-Include-Rendered"),
):
    """Continue a bounded tutoring conversation for one answered question."""
    await ensure_student_can_access_question(student_id, body.question_id, student_svc)
    question = await question_svc.get_question(body.question_id)
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    text = await ai_usage_svc.run(
        student_id,
        feature="tutor.question_chat",
        operation=partial(ai_svc.question_tutor_chat,
            question_stem=question.stem_text,
            correct_answer=question.answer or "",
            given_answer=body.given_answer,
            message=body.message,
            explanation=question.explanation,
            process_grading=body.process_grading,
            history=[item.model_dump() for item in body.history],
        ),
    )
    payload = {"text": text}
    enriched = await maybe_enrich_rich_content(
        rich_content_svc,
        "enrich_tutor_payload",
        payload,
        include_rendered=include_rendered_requested(include_rendered, x_openphysics_include_rendered),
    )
    if enriched is not None:
        return enriched
    return payload


# ── Learn BFF ──────────────────────────────────────────────────────────────────
