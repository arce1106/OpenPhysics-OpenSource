from app.services.teacher_paper_service import answer_video_summaries
from app.services.teacher_paper_results import ensure_student_paper_results
from app.services.knowledge_service import KnowledgeService, canonical_kp_name
from app.services.physics_error_types import display_process_grading
from app.services.question_service import QuestionService
from app.services.rich_content_render_service import RichContentRenderService
from app.services.student_service import StudentService
from fastapi import APIRouter, Depends, Header

from .dependencies import (
    get_current_student_id,
    get_knowledge_service,
    get_question_service,
    get_rich_content_render_service,
    get_student_service,
    include_rendered_requested,
    maybe_enrich_rich_content,
)
from .history_helpers import (
    attach_inferred_answer_images,
    parse_history_boundary,
    prefer_paper_image_history_answers,
)

router = APIRouter()


@router.get("/progress/overview")
async def get_progress_overview(
    student_id: str = Depends(get_current_student_id),
    student_svc: StudentService = Depends(get_student_service),
    knowledge_svc: KnowledgeService = Depends(get_knowledge_service),
):
    mastery_list = await student_svc.get_all_mastery(student_id)
    all_kps = await knowledge_svc.get_all_points()
    kp_map = {kp.id: kp for kp in all_kps}

    return [
        {
            "knowledge_point_id": m.knowledge_point_id,
            "knowledge_point_name": canonical_kp_name(
                m.knowledge_point_id,
                kp_map[m.knowledge_point_id].name if m.knowledge_point_id in kp_map else None,
            ),
            "mastery": m.mastery,
            "attempts": m.attempts,
            "correct_rate": m.correct_rate,
            "last_practiced": m.last_practiced.isoformat() if m.last_practiced else None,
        }
        for m in mastery_list
    ]


@router.get("/progress/kp/{kp_id}")
async def get_kp_progress(
    kp_id: str,
    student_id: str = Depends(get_current_student_id),
    student_svc: StudentService = Depends(get_student_service),
):
    mastery = await student_svc.get_mastery(student_id, kp_id)
    if not mastery:
        return {"knowledge_point_id": kp_id, "mastery": 0.0, "attempts": 0, "correct_rate": 0.0}
    return {
        "knowledge_point_id": mastery.knowledge_point_id,
        "mastery": mastery.mastery,
        "attempts": mastery.attempts,
        "correct_rate": mastery.correct_rate,
        "last_practiced": mastery.last_practiced.isoformat() if mastery.last_practiced else None,
    }


@router.get("/history/answers")
async def get_answer_history(
    student_id: str = Depends(get_current_student_id),
    limit: int = 50,
    offset: int = 0,
    from_date: str | None = None,
    to_date: str | None = None,
    student_svc: StudentService = Depends(get_student_service),
    question_svc: QuestionService = Depends(get_question_service),
    knowledge_svc: KnowledgeService = Depends(get_knowledge_service),
    rich_content_svc: RichContentRenderService = Depends(get_rich_content_render_service),
    include_rendered: bool = False,
    x_openphysics_include_rendered: str | None = Header(default=None, alias="X-OpenPhysics-Include-Rendered"),
):
    await ensure_student_paper_results(student_svc.db, student_id)
    from_dt = parse_history_boundary(from_date, end=False)
    to_dt = parse_history_boundary(to_date, end=True)
    answers = await student_svc.get_answer_history(
        student_id,
        max(1, min(limit, 100)),
        max(0, offset),
        from_dt,
        to_dt,
    )
    answers = prefer_paper_image_history_answers(answers)
    videos = await answer_video_summaries(student_svc.db, answers)
    question_ids = [a.question_id for a in answers]
    questions = await question_svc.get_questions_by_ids(question_ids) if question_ids else []
    q_map = {q.id: q for q in questions}
    all_kps = await knowledge_svc.get_all_points()
    kp_name_cache: dict[str, str] = {kp.id: kp.name for kp in all_kps}

    items = []
    for a in answers:
        q = q_map.get(a.question_id)
        process_grading = dict(a.grading_result) if isinstance(a.grading_result, dict) else None
        if process_grading:
            process_grading = display_process_grading(
                process_grading,
                fallback_answer=a.given_answer or "",
                fallback_feedback=process_grading.get("feedback", ""),
                question_type=q.question_type if q else None,
            )
        process_grading = attach_inferred_answer_images(student_id, a.created_at, process_grading, a.given_answer)
        items.append({
            "id": a.id,
            "lesson_video": videos.get(a.id),
            "question_id": a.question_id,
            "stem_text": q.stem_text if q else "",
            "question_type": q.question_type.value if q and q.question_type else None,
            "options": (
                [{"label": o.label, "text": o.text} for o in sorted(q.options or [], key=lambda opt: opt.label)]
                if q
                else []
            ),
            "images": (
                [
                    {
                        "id": img.id,
                        "image_path": img.image_path,
                        "image_type": img.image_type,
                        "description": img.description,
                    }
                    for img in (q.images or [])
                ]
                if q
                else []
            ),
            "knowledge_points": (
                [
                    {
                        "id": lbl.label_id,
                        "name": canonical_kp_name(lbl.label_id, kp_name_cache.get(lbl.label_id)),
                    }
                    for lbl in (q.labels or [])
                    if lbl.label_type == "knowledge_point"
                ]
                if q
                else []
            ),
            "given_answer": a.given_answer,
            "is_correct": a.is_correct,
            "correct_answer": q.answer if q else None,
            "explanation": q.explanation if q else None,
            "process_grading": process_grading,
            "reviewed_at": a.reviewed_at.isoformat() if a.reviewed_at else None,
            "time_spent_ms": a.time_spent_ms,
            "created_at": a.created_at.isoformat() if a.created_at else None,
        })
    await maybe_enrich_rich_content(
        rich_content_svc,
        "enrich_history_items",
        items,
        include_rendered=include_rendered_requested(include_rendered, x_openphysics_include_rendered),
    )
    return items


@router.get("/history/mistakes")
async def get_mistakes(
    student_id: str = Depends(get_current_student_id),
    limit: int = 20,
    student_svc: StudentService = Depends(get_student_service),
    question_svc: QuestionService = Depends(get_question_service),
    rich_content_svc: RichContentRenderService = Depends(get_rich_content_render_service),
    include_rendered: bool = False,
    x_openphysics_include_rendered: str | None = Header(default=None, alias="X-OpenPhysics-Include-Rendered"),
):
    await ensure_student_paper_results(student_svc.db, student_id)
    answers = await student_svc.get_wrong_answers(student_id, limit)
    videos = await answer_video_summaries(student_svc.db, answers)
    question_ids = [a.question_id for a in answers]
    questions = await question_svc.get_questions_by_ids(question_ids)
    q_map = {q.id: q for q in questions}
    items = [
        {
            "id": a.id,
            "lesson_video": videos.get(a.id),
            "question_id": a.question_id,
            "stem_text": q_map[a.question_id].stem_text if a.question_id in q_map else None,
            "given_answer": a.given_answer,
            "correct_answer": q_map[a.question_id].answer if a.question_id in q_map else None,
            "explanation": q_map[a.question_id].explanation if a.question_id in q_map else None,
            "created_at": a.created_at.isoformat() if a.created_at else None,
        }
        for a in answers
    ]
    await maybe_enrich_rich_content(
        rich_content_svc,
        "enrich_history_items",
        items,
        include_rendered=include_rendered_requested(include_rendered, x_openphysics_include_rendered),
    )
    return items
