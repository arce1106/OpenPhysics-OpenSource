from fastapi import APIRouter, Depends, Header, HTTPException

from app.services.adaptive_service import AdaptiveService
from app.services.learning_catalog_service import (
    TOPIC_LAYER_NAMES,
    LearningCatalogService,
)
from app.services.rich_content_render_service import RichContentRenderService
from app.services.teacher_paper_service import (
    resolve_video, submit_attempt, question_video,
)
from fastapi.responses import FileResponse
from app.services.student_access_policy import StudentAccessPolicy
from app.services.student_service import StudentService
from app.services.teacher_homework_service import homework_attempt

from . import schemas
from .dependencies import (
    get_adaptive_service,
    get_current_learning_student_id,
    get_current_student_id,
    get_learning_catalog_service,
    get_rich_content_render_service,
    include_rendered_requested,
    maybe_enrich_rich_content,
)


router = APIRouter()


@router.get(
    "/learning-catalogs/{catalog_code}",
    response_model=schemas.LearningCatalogResponse,
)
async def get_learning_catalog(
    catalog_code: str,
    _student_id: str = Depends(get_current_student_id),
    catalog_svc: LearningCatalogService = Depends(get_learning_catalog_service),
):
    catalog = await catalog_svc.get_catalog(catalog_code)
    if not catalog:
        raise HTTPException(status_code=404, detail="Learning catalog not found")
    return catalog


@router.get(
    "/learning-catalogs/{catalog_code}/resume",
    response_model=schemas.LearningCatalogResumeResponse,
)
async def get_learning_catalog_resume(
    catalog_code: str,
    student_id: str = Depends(get_current_student_id),
    catalog_svc: LearningCatalogService = Depends(get_learning_catalog_service),
):
    resume = await catalog_svc.get_resume_topic(student_id, catalog_code)
    if resume is None:
        raise HTTPException(status_code=404, detail="Learning catalog not found")
    return resume


@router.get(
    "/learning-catalogs/{catalog_code}/nodes/{node_id}/overview",
    response_model=schemas.LearningCatalogTopicOverviewResponse,
)
async def get_learning_catalog_topic_overview(
    catalog_code: str,
    node_id: str,
    student_id: str = Depends(get_current_student_id),
    catalog_svc: LearningCatalogService = Depends(get_learning_catalog_service),
):
    overview = await catalog_svc.get_topic_overview(
        student_id,
        catalog_code,
        node_id,
    )
    if not overview:
        raise HTTPException(status_code=404, detail="Learning catalog topic not found")
    return overview


@router.post(
    "/learning-catalogs/{catalog_code}/nodes/{node_id}/evidence",
    response_model=schemas.LearningCatalogTopicOverviewResponse,
)
async def record_learning_catalog_topic_evidence(
    catalog_code: str,
    node_id: str,
    body: schemas.LearningCatalogTopicEvidenceRequest,
    student_id: str = Depends(get_current_learning_student_id),
    catalog_svc: LearningCatalogService = Depends(get_learning_catalog_service),
):
    try:
        recorded = await catalog_svc.record_topic_answer(
            student_id,
            catalog_code,
            node_id,
            answer_id=body.answer_id,
            layer=body.layer,
        )
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    if recorded is None:
        raise HTTPException(status_code=404, detail="Learning catalog topic not found")

    overview = await catalog_svc.get_topic_overview(
        student_id,
        catalog_code,
        node_id,
    )
    if not overview:
        raise HTTPException(status_code=404, detail="Learning catalog topic not found")
    return overview


@router.post(
    "/learning-catalogs/{catalog_code}/nodes/{node_id}/session",
    response_model=schemas.PracticeSessionResponse,
)
async def start_learning_catalog_topic_session(
    catalog_code: str,
    node_id: str,
    body: schemas.LearningCatalogTopicSessionRequest,
    student_id: str = Depends(get_current_learning_student_id),
    catalog_svc: LearningCatalogService = Depends(get_learning_catalog_service),
    adaptive_svc: AdaptiveService = Depends(get_adaptive_service),
    rich_content_svc: RichContentRenderService = Depends(
        get_rich_content_render_service
    ),
    include_rendered: bool = False,
    x_openphysics_include_rendered: str | None = Header(
        default=None,
        alias="X-OpenPhysics-Include-Rendered",
    ),
):
    questions = await catalog_svc.get_topic_questions(
        student_id, catalog_code, node_id, layer=body.layer, count=body.question_count,
    )
    if questions is None:
        raise HTTPException(status_code=404, detail="Learning catalog topic not found")
    if not questions:
        raise HTTPException(
            status_code=404,
            detail="No approved questions available for this topic layer",
        )

    overview = await catalog_svc.get_topic_overview(
        student_id,
        catalog_code,
        node_id,
    )
    if not overview:
        raise HTTPException(status_code=404, detail="Learning catalog topic not found")

    serialized_questions = [
        adaptive_svc._serialize_question(
            question,
            route=f"{catalog_code}_{body.layer}",
        )
        for question in questions
    ]
    for serialized in serialized_questions:
        serialized["topic_context"] = {"catalog_code": catalog_code, "node_id": node_id, "layer": body.layer}
    await maybe_enrich_rich_content(
        rich_content_svc,
        "enrich_questions",
        serialized_questions,
        include_rendered=include_rendered_requested(
            include_rendered,
            x_openphysics_include_rendered,
        ),
    )

    return {
        "student_id": student_id,
        "session_type": f"{catalog_code}_{body.layer}",
        "strategy": f"{catalog_code}_{body.layer}",
        "session_objective": f"{TOPIC_LAYER_NAMES[body.layer]}「{overview['title']}」",
        "session_structure": {
            "phases": [
                {
                    "phase": body.layer,
                    "question_indices": list(range(len(serialized_questions))),
                }
            ],
            "total": len(serialized_questions),
        },
        "learner_profile": None,
        "questions": serialized_questions,
    }


@router.api_route("/question-videos/media", methods=["GET", "HEAD"], include_in_schema=False)
async def get_teacher_paper_media(token: str):
    try:
        path = resolve_video(token)
    except PermissionError as error:
        raise HTTPException(status_code=403, detail=str(error))
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error))
    return FileResponse(path, media_type="video/mp4", headers={"Cache-Control": "private, no-store"})


@router.post("/teacher-paper-attempts/{attempt_id}/submit", response_model=schemas.TeacherPaperResponse)
async def submit_teacher_paper_attempt(
    attempt_id: str,
    student_id: str = Depends(get_current_student_id),
    catalog_svc: LearningCatalogService = Depends(get_learning_catalog_service),
):
    # Teacher homework checks assignment ownership; other papers require an active account.
    if await homework_attempt(catalog_svc.db, student_id, attempt_id) is None:
        await StudentAccessPolicy(StudentService(catalog_svc.db)).ensure_full_learning_access(student_id)
    return await submit_attempt(catalog_svc.db, student_id, attempt_id)


@router.post("/questions/{question_id}/lesson-video")
async def get_question_lesson_video(
    question_id: str, body: schemas.QuestionLessonVideoRequest,
    student_id: str = Depends(get_current_learning_student_id),
    catalog_svc: LearningCatalogService = Depends(get_learning_catalog_service),
):
    return await question_video(catalog_svc.db, student_id, question_id, body.answer_id)
