from app.services.teacher_paper_service import answer_video_summaries
import datetime

from app.services.adaptive_service import AdaptiveService
from app.services.daily_learning_loop_service import DailyLearningLoopService
from app.services.knowledge_service import KnowledgeService, canonical_kp_name
from app.models.student import StudentAnswer
from app.services.grading_reliability import UngradableQuestion, is_pending_confirmation
from sqlalchemy import select
from app.services.learning_state_rules import STABLE_MASTERY_THRESHOLD
from app.services.physics_error_types import display_process_grading
from app.services.question_service import QuestionService
from app.services.review_center_service import build_review_center
from app.services.review_mistake_utils import (
    choice_misconception_from_option,
    readable_misconception_name,
)
from app.services.reward_service import RewardService
from app.services.rich_content_render_service import RichContentRenderService
from app.services.quest_service import QuestService
from app.services.student_service import StudentService
from app.services.student_learning_state_service import StudentLearningStateService
from fastapi import APIRouter, Depends, Header, HTTPException

from . import schemas
from .dependencies import (
    ensure_student_can_access_question,
    get_adaptive_service,
    get_current_learning_student_id,
    get_current_student_id,
    get_daily_learning_loop_service,
    get_knowledge_service,
    get_question_service,
    get_quest_service,
    get_rich_content_render_service,
    get_reward_service,
    get_student_service,
    get_student_learning_state_service,
    include_rendered_requested,
    maybe_enrich_rich_content,
)
from .history_helpers import (
    attach_inferred_answer_images,
)

router = APIRouter()


def _latest_practiced_scope(mastery_list, kp_map) -> tuple[str | None, str | None]:
    practiced = [
        (m.last_practiced, kp_map.get(m.knowledge_point_id))
        for m in mastery_list
        if m.last_practiced is not None and kp_map.get(m.knowledge_point_id) is not None
    ]
    if practiced:
        _, kp = max(practiced, key=lambda item: item[0])
        return kp.volume, kp.chapter

    evidence = [
        (getattr(m, "attempts", 0), m.mastery, kp_map.get(m.knowledge_point_id))
        for m in mastery_list
        if (getattr(m, "attempts", 0) > 0 or m.mastery > 0) and kp_map.get(m.knowledge_point_id) is not None
    ]
    if not evidence:
        return None, None
    _, _, kp = max(evidence, key=lambda item: (item[0], item[1]))
    return kp.volume, kp.chapter


def _focused_stage_order(stages: list[dict], kp_map, active_volume: str | None, active_chapter: str | None) -> list[dict]:
    if not active_volume:
        return stages

    chapter_stages = [
        stage for stage in stages
        if (kp := kp_map.get(stage["kp_id"]))
        and kp.volume == active_volume
        and (active_chapter is None or kp.chapter == active_chapter)
    ]
    volume_stages = [
        stage for stage in stages
        if (kp := kp_map.get(stage["kp_id"])) and kp.volume == active_volume
    ]

    return chapter_stages + [
        stage for stage in volume_stages
        if stage not in chapter_stages
    ] + [
        stage for stage in stages
        if stage not in chapter_stages and stage not in volume_stages
    ]


_MILESTONE_BY_STATE = (
    ("learning", "完成「{}」达到掌握水平"),
    ("practice", "巩固「{}」达到掌握水平"),
    ("to_learn", "开始同步学习「{}」"),
)


def _next_milestone(states: list[dict], kp_map, active_volume: str | None, active_chapter: str | None) -> str | None:
    """The sync page's recommended point (web ``pickRecommendedKp``): by learning state —
    learning, then practice, then to_learn — in path order, inside the chapter the
    student is working on first, then the rest of the focused path."""
    chapter_states = [
        state for state in states
        if active_volume
        and (kp := kp_map.get(state["kp_id"]))
        and kp.volume == active_volume
        and (active_chapter is None or kp.chapter == active_chapter)
    ]
    for scope in (chapter_states, states):
        for learning_state, template in _MILESTONE_BY_STATE:
            stage = next((state for state in scope if state["learning_state"] == learning_state), None)
            if stage:
                return template.format(stage["kp_name"])
    return None


def _first_actionable_learning_state(states: list[dict]) -> dict | None:
    return next(
        (
            state for state in states
            if state["learning_state"] in ("to_learn", "learning", "practice")
            and state["status"] != "locked"
        ),
        None,
    )


@router.get("/dashboard", response_model=schemas.DashboardResponse)
async def get_dashboard(
    student_id: str = Depends(get_current_student_id),
    student_svc: StudentService = Depends(get_student_service),
    knowledge_svc: KnowledgeService = Depends(get_knowledge_service),
    state_svc: StudentLearningStateService = Depends(get_student_learning_state_service),
    loop_svc: DailyLearningLoopService = Depends(get_daily_learning_loop_service),
):
    """Aggregate diagnosis summary, plan recommendation, motivation, and knowledge map."""
    mastery_list = await student_svc.get_all_mastery(student_id)
    all_kps = await knowledge_svc.get_practicable_points()
    kp_map = {kp.id: kp for kp in all_kps}
    state_context = await state_svc.build_context(student_id, all_kps=all_kps, mastery_list=mastery_list)
    path = state_context["path"]
    active_volume, active_chapter = _latest_practiced_scope(mastery_list, kp_map)
    focused_stages = _focused_stage_order(path["stages"], kp_map, active_volume, active_chapter)
    focused_state_map = state_context["state_map"]
    focused_states = [
        focused_state_map[stage["kp_id"]]
        for stage in focused_stages
        if stage["kp_id"] in focused_state_map
    ]

    # Diagnosis
    total = len(all_kps)
    learning_stats = state_context["stats"]
    mastered = learning_stats["mastered"]
    in_progress = learning_stats["learning"] + learning_stats["practice"]
    locked = learning_stats["locked"] + learning_stats["to_learn"]
    overall = sum(m.mastery for m in mastery_list) / len(mastery_list) if mastery_list else 0.0

    reinforcement_recommendations = await state_svc.get_reinforcement_recommendations(
        student_id,
        limit=3,
        context=state_context,
    )
    weak_points = [
        schemas.WeakPoint(
            kp_id=item["kp_id"],
            kp_name=item["kp_name"],
            mastery=item["mastery"],
        )
        for item in reinforcement_recommendations
    ]

    if not weak_points:
        # Keep the diagnostic panel strict: passive card-study progress is not
        # enough to call something a weak point. Weak points should come from the
        # same evidence-backed recommendation path used by /train.
        weak_points = []

    # Plan — recommend inside the student's recent learning scope first.
    plan = None
    stage = _first_actionable_learning_state(focused_states)
    if stage:
        plan = schemas.PlanRecommendation(
            kp_id=stage["kp_id"],
            kp_name=stage["kp_name"],
            mastery=stage["mastery"],
            reason="延续当前教材进度，优先补齐本章知识点" if active_volume else (
                "建议先开始学习该知识点" if stage["learning_state"] == "to_learn"
                else "正在学习中，继续推进" if stage["learning_state"] == "learning"
                else "练习暴露薄弱，建议先巩固"
            ),
            estimated_questions=5,
            estimated_minutes=15,
        )

    # Motivation
    clearance = await student_svc.get_mistake_clearance_counts(student_id)
    streak_days = await loop_svc.get_streak_days(student_id)
    weekly_mastered = sum(
        1 for m in mastery_list
        if m.mastery >= STABLE_MASTERY_THRESHOLD and m.last_practiced and
        (datetime.datetime.now(datetime.timezone.utc) -
         m.last_practiced).days <= 7
    )

    # Next milestone: the same point the sync page marks "推荐" for this chapter.
    next_milestone = _next_milestone(focused_states, kp_map, active_volume, active_chapter)

    motivation = schemas.MotivationPanel(
        streak_days=streak_days,
        weekly_kps_mastered=weekly_mastered,
        mistake_backlog_count=clearance["total"] - clearance["reviewed"],
        next_milestone=next_milestone,
    )

    diagnosis = schemas.DiagnosisSummary(
        overall_mastery=overall,
        mastered_count=mastered,
        in_progress_count=in_progress,
        locked_count=locked,
        weak_points=weak_points,
    )

    return schemas.DashboardResponse(
        diagnosis=diagnosis,
        plan=plan,
        motivation=motivation,
        knowledge_map=[],
    )


# ── Train BFF ──────────────────────────────────────────────────────────────────


@router.get("/train/start", response_model=schemas.TrainStartResponse)
async def get_train_start(
    student_id: str = Depends(get_current_learning_student_id),
    student_svc: StudentService = Depends(get_student_service),
    state_svc: StudentLearningStateService = Depends(get_student_learning_state_service),
):
    """Get training entry data: recommended KPs, diagnostic status."""
    answers = await student_svc.get_answer_history(student_id, limit=10)
    is_first_time = len(answers) == 0
    has_diagnosed = len(answers) >= 5
    recommendations = await state_svc.get_reinforcement_recommendations(student_id, limit=5)

    return schemas.TrainStartResponse(
        is_first_time=is_first_time,
        has_diagnosed=has_diagnosed,
        recommended_kps=[
            schemas.RecommendedKp(
                kp_id=item["kp_id"],
                kp_name=item["kp_name"],
                mastery=item["mastery"],
                reason=item["reason"],
            )
            for item in recommendations
        ],
    )


@router.post("/train/diagnose", response_model=schemas.DiagnoseResponse)
async def trigger_diagnostic(
    body: schemas.DiagnoseRequest,
    student_id: str = Depends(get_current_learning_student_id),
    adaptive_svc: AdaptiveService = Depends(get_adaptive_service),
    rich_content_svc: RichContentRenderService = Depends(get_rich_content_render_service),
    include_rendered: bool = False,
    x_openphysics_include_rendered: str | None = Header(default=None, alias="X-OpenPhysics-Include-Rendered"),
):
    """Trigger a cross-chapter diagnostic session for a new student."""
    result = await adaptive_svc.run_diagnostic(student_id, body.count)
    await maybe_enrich_rich_content(
        rich_content_svc,
        "enrich_questions",
        result.get("questions"),
        include_rendered=include_rendered_requested(include_rendered, x_openphysics_include_rendered),
    )
    return result


# ── Review BFF ─────────────────────────────────────────────────────────────────


def _review_mistake_payload(student_id: str, answer, question) -> dict:
    grading_result = answer.grading_result if isinstance(answer.grading_result, dict) else None
    if grading_result:
        grading_result = display_process_grading(
            grading_result,
            fallback_answer=answer.given_answer or "",
            fallback_feedback=grading_result.get("feedback", ""),
            question_type=getattr(question, "question_type", None),
        )
    if grading_result:
        grading_result = attach_inferred_answer_images(
            student_id,
            answer.created_at,
            grading_result,
            answer.given_answer,
        )

    misconception = None
    if grading_result:
        error_type = grading_result.get("error_type")
        if error_type and error_type not in {"none", "unknown"}:
            misconception = {
                "id": error_type,
                "name": readable_misconception_name(
                    error_type,
                    grading_result.get("error_type_name"),
                ),
            }
    if not misconception and answer.misconception_ids and len(answer.misconception_ids) > 0:
        misconception_id = answer.misconception_ids[0]
        misconception = {
            "id": misconception_id,
            "name": readable_misconception_name(misconception_id),
        }
    if not misconception:
        misconception = choice_misconception_from_option(question, answer.given_answer)

    return {
        "answer_id": answer.id,
        "question_id": answer.question_id,
        "stem_text": question.stem_text,
        "images": [
            {
                "id": image.id,
                "image_path": image.image_path,
                "image_type": image.image_type,
                "description": image.description,
            }
            for image in (question.images or [])
        ],
        "question_type": question.question_type.value if question.question_type else None,
        "options": [{"label": option.label, "text": option.text} for option in (question.options or [])],
        "given_answer": answer.given_answer,
        "correct_answer": question.answer,
        "explanation": question.explanation,
        "misconception": misconception,
        "process_grading": grading_result,
        "created_at": answer.created_at.isoformat() if answer.created_at else None,
    }


def _compact_review_process_grading(grading: dict | None) -> dict | None:
    if not isinstance(grading, dict):
        return None
    compact = {
        key: grading[key]
        for key in (
            "answer_source",
            "answer_image_path",
            "answer_image_paths",
            "needs_human_review",
            "process_score",
            "score",
            "max_score",
        )
        if key in grading
    }
    return compact or None


def _compact_review_groups(groups: list[dict]) -> list[dict]:
    return [
        {
            **group,
            "mistakes": [
                {
                    key: value
                    for key, value in mistake.items()
                    if key
                    in {
                        "answer_id",
                        "lesson_video",
                        "question_id",
                        "stem_text",
                        "stem_rendered",
                        "images",
                        "question_type",
                        "options",
                        "given_answer",
                        "misconception",
                        "created_at",
                    }
                }
                | {"process_grading": _compact_review_process_grading(mistake.get("process_grading"))}
                for mistake in group.get("mistakes") or []
            ],
        }
        for group in groups
    ]


@router.get("/review", response_model=schemas.ReviewResponse)
async def get_review(
    student_id: str = Depends(get_current_student_id),
    group_by: str = "kp",
    summary_only: bool = False,
    student_svc: StudentService = Depends(get_student_service),
    question_svc: QuestionService = Depends(get_question_service),
    knowledge_svc: KnowledgeService = Depends(get_knowledge_service),
    rich_content_svc: RichContentRenderService = Depends(get_rich_content_render_service),
    include_rendered: bool = False,
    x_openphysics_include_rendered: str | None = Header(default=None, alias="X-OpenPhysics-Include-Rendered"),
):
    """Get mistakes grouped by knowledge point or time."""
    from app.services.teacher_paper_results import ensure_student_paper_results
    await ensure_student_paper_results(student_svc.db, student_id)
    mistakes = await student_svc.get_wrong_answers(student_id, limit=100)
    videos = await answer_video_summaries(student_svc.db, mistakes)
    question_ids = [a.question_id for a in mistakes]
    questions = await question_svc.get_questions_by_ids(question_ids)
    q_map = {q.id: q for q in questions}
    all_kps = await knowledge_svc.get_all_points()
    kp_name_cache: dict[str, str] = {kp.id: kp.name for kp in all_kps}

    # Group by knowledge point
    groups: dict[str, dict] = {}
    for a in mistakes:
        q = q_map.get(a.question_id)
        if not q:
            continue
        kp_ids = [lbl.label_id for lbl in q.labels if lbl.label_type == "knowledge_point"]
        kp_id = kp_ids[0] if kp_ids else "unknown"
        if kp_id not in groups:
            kp_name = canonical_kp_name(kp_id, kp_name_cache.get(kp_id))
            groups[kp_id] = {"kp_id": kp_id, "kp_name": kp_name, "mistakes": []}

        groups[kp_id]["mistakes"].append({**_review_mistake_payload(student_id, a, q), "lesson_video": videos.get(a.id)})

    group_list = sorted(groups.values(), key=lambda g: len(g["mistakes"]), reverse=True)
    for group in group_list:
        group["wrong_count"] = len(group["mistakes"])
    clearance = await student_svc.get_mistake_clearance_counts(student_id)
    review_center = build_review_center(group_list)
    await maybe_enrich_rich_content(
        rich_content_svc,
        "enrich_review_group_summaries" if summary_only else "enrich_review_groups",
        group_list,
        include_rendered=include_rendered_requested(include_rendered, x_openphysics_include_rendered),
    )
    response_groups = _compact_review_groups(group_list) if summary_only else group_list

    return schemas.ReviewResponse(
        groups=response_groups,
        clearance_progress=clearance,
        review_center=review_center,
    )


@router.get("/review/{answer_id}", response_model=schemas.ReviewMistake)
async def get_review_mistake(
    answer_id: int,
    student_id: str = Depends(get_current_student_id),
    student_svc: StudentService = Depends(get_student_service),
    question_svc: QuestionService = Depends(get_question_service),
    rich_content_svc: RichContentRenderService = Depends(get_rich_content_render_service),
    include_rendered: bool = False,
    x_openphysics_include_rendered: str | None = Header(default=None, alias="X-OpenPhysics-Include-Rendered"),
):
    """Get the complete content for one student-owned review mistake."""
    answer = await student_svc.get_answer(student_id, answer_id)
    if not answer:
        raise HTTPException(status_code=404, detail="Mistake not found")
    question = await question_svc.get_question(answer.question_id)
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")
    mistake = _review_mistake_payload(student_id, answer, question)
    mistake["lesson_video"] = (await answer_video_summaries(student_svc.db, [answer])).get(answer.id)
    await maybe_enrich_rich_content(
        rich_content_svc,
        "enrich_review_groups",
        [{"mistakes": [mistake]}],
        include_rendered=include_rendered_requested(include_rendered, x_openphysics_include_rendered),
    )
    return schemas.ReviewMistake(**mistake)


@router.post("/review/retry/{answer_id}", response_model=schemas.RetryResponse)
async def retry_similar(
    answer_id: int,
    student_id: str = Depends(get_current_student_id),
    adaptive_svc: AdaptiveService = Depends(get_adaptive_service),
    student_svc: StudentService = Depends(get_student_service),
    rich_content_svc: RichContentRenderService = Depends(get_rich_content_render_service),
    include_rendered: bool = False,
    x_openphysics_include_rendered: str | None = Header(default=None, alias="X-OpenPhysics-Include-Rendered"),
    exclude_question_ids: str | None = None,
):
    """Get a similar question to re-practice after a mistake."""
    answer = await student_svc.get_answer(student_id, answer_id)
    if not answer:
        raise HTTPException(status_code=404, detail="Mistake not found")
    await ensure_student_can_access_question(student_id, answer.question_id, student_svc)
    exclusions = _review_question_exclusions(exclude_question_ids)
    question = await adaptive_svc.get_similar_question(
        student_id, answer_id, **({"exclude_question_ids": exclusions} if exclusions else {}),
    )
    if question:
        try:
            await ensure_student_can_access_question(student_id, question["id"], student_svc)
        except HTTPException as exc:
            if exc.status_code != 402:
                raise
            question = None
    await maybe_enrich_rich_content(
        rich_content_svc,
        "enrich_question",
        question,
        include_rendered=include_rendered_requested(include_rendered, x_openphysics_include_rendered),
    )
    return schemas.RetryResponse(question=question)


@router.post("/review/{answer_id}/complete")
async def complete_review(
    answer_id: int,
    body: schemas.CompleteReviewRequest | None = None,
    student_id: str = Depends(get_current_student_id),
    adaptive_svc: AdaptiveService = Depends(get_adaptive_service),
    student_svc: StudentService = Depends(get_student_service),
    reward_svc: RewardService = Depends(get_reward_service),
    quest_svc: QuestService = Depends(get_quest_service),
):
    """Close a mistake once the student has answered a variation of it correctly.

    The retry is the given ``retry_answer_id`` or, for clients that send no
    body, the latest qualifying answer after the mistake. Without one, nothing
    is cleared and ``detail`` says why (audit A14).
    """
    answer = await student_svc.get_answer(student_id, answer_id)
    if not answer:
        raise HTTPException(status_code=404, detail="Mistake not found")
    await ensure_student_can_access_question(student_id, answer.question_id, student_svc)
    if answer.reviewed_at is not None:
        return {"cleared": True}

    retry_answer = None
    if body is not None and body.retry_answer_id is not None:
        retry_answer = await student_svc.get_answer(student_id, body.retry_answer_id)
        if not retry_answer:
            raise HTTPException(status_code=404, detail="Retry answer not found")
        await ensure_student_can_access_question(
            student_id, retry_answer.question_id, student_svc
        )
    retry, reason = await _qualifying_review_retry(
        student_id, answer, retry_answer=retry_answer,
        adaptive_svc=adaptive_svc, student_svc=student_svc,
    )
    if retry is None:
        return {"cleared": False, "detail": reason}
    retry_grading = retry.grading_result if isinstance(retry.grading_result, dict) else {}
    cleared = await _clear_mistake_with_retry(
        {
            "is_correct": True,
            "mastery_update": retry_grading.get("_mastery_update", {}),
            "detected_misconception": None,
        },
        retry,
        student_id=student_id,
        answer_id=answer_id,
        student_svc=student_svc,
        reward_svc=reward_svc,
        quest_svc=quest_svc,
    )
    return {"cleared": cleared}


# Marks the retry answer that closed a mistake, so one retry closes one mistake.
REVIEW_RETRY_USED_KEY = "_cleared_mistake_id"
REVIEW_RETRY_SCAN_LIMIT = 30
NO_REVIEW_RETRY_DETAIL = "做对一道这道错题的变式题后，才能完成复盘。"


async def _qualifying_review_retry(
    student_id: str,
    mistake,
    *,
    retry_answer=None,
    adaptive_svc: AdaptiveService,
    student_svc: StudentService,
):
    """(retry answer, None) when one may close the mistake, else (None, reason).

    A retry qualifies when it was answered after the mistake, is correct and not
    waiting for confirmation, has not closed another mistake, and is the same
    question or one of its variations (same knowledge point or physics model).
    """
    original = await adaptive_svc.question_svc.get_question(mistake.question_id)
    if retry_answer is not None:
        candidates = [retry_answer]
    else:
        candidates = list((await student_svc.db.scalars(
            select(StudentAnswer)
            .where(
                StudentAnswer.student_id == student_id,
                StudentAnswer.id > mistake.id,
                StudentAnswer.is_correct == True,  # noqa: E712 - SQL comparison
            )
            .order_by(StudentAnswer.id.desc())
            .limit(REVIEW_RETRY_SCAN_LIMIT)
        )).all())
    reason = NO_REVIEW_RETRY_DETAIL
    for candidate in candidates:
        grading = candidate.grading_result if isinstance(candidate.grading_result, dict) else {}
        used_for = grading.get(REVIEW_RETRY_USED_KEY)
        if candidate.id <= mistake.id:
            problem = "需要在这道错题之后重新作答，才能完成复盘。"
        elif not candidate.is_correct:
            problem = "变式题还没有做对，做对后才能完成复盘。"
        elif is_pending_confirmation(grading):
            problem = "这次作答的批改还待确认，确认后才能完成复盘。"
        elif used_for is not None and used_for != mistake.id:
            problem = "这次作答已经用于完成另一道错题的复盘。"
        elif not adaptive_svc.is_review_retry_for(
            original, await adaptive_svc.question_svc.get_question(candidate.question_id)
        ):
            problem = "这道题与原错题的知识点和物理模型都不同，不能用来完成复盘。"
        else:
            return candidate, None
        if retry_answer is not None:
            reason = problem
    return None, reason


def _review_question_exclusions(raw: str | None) -> set[str]:
    if not raw:
        return set()
    ids = {item.strip() for item in raw.split(",") if item.strip()}
    if len(raw) > 8000 or len(ids) > 200:
        raise HTTPException(status_code=400, detail="Too many excluded questions")
    return ids


@router.get("/review/variations/{answer_id}", response_model=schemas.VariationResponse)
async def get_review_variations(
    answer_id: int,
    student_id: str = Depends(get_current_student_id),
    adaptive_svc: AdaptiveService = Depends(get_adaptive_service),
    student_svc: StudentService = Depends(get_student_service),
    rich_content_svc: RichContentRenderService = Depends(get_rich_content_render_service),
    include_rendered: bool = False,
    x_openphysics_include_rendered: str | None = Header(default=None, alias="X-OpenPhysics-Include-Rendered"),
    exclude_question_ids: str | None = None,
):
    """Get targeted variation questions after a mistake."""
    answer = await student_svc.get_answer(student_id, answer_id)
    if not answer:
        raise HTTPException(status_code=404, detail="Mistake not found")
    await ensure_student_can_access_question(student_id, answer.question_id, student_svc)
    variations = []
    exclusions = _review_question_exclusions(exclude_question_ids)
    variation_candidates = await adaptive_svc.get_variation_questions(
        student_id, answer_id, limit=1,
        **({"exclude_question_ids": exclusions} if exclusions else {}),
    )
    for item in variation_candidates[:1]:
        question = item.get("question") or {}
        try:
            await ensure_student_can_access_question(student_id, question.get("id"), student_svc)
        except HTTPException as exc:
            if exc.status_code != 402:
                raise
            continue
        variations.append({
            **item,
            "title": "做变式题",
            "reason": "做对这道变式题即可完成本题复盘。",
        })
    await maybe_enrich_rich_content(
        rich_content_svc,
        "enrich_variations",
        variations,
        include_rendered=include_rendered_requested(include_rendered, x_openphysics_include_rendered),
    )
    return schemas.VariationResponse(variations=variations)


async def _clear_mistake_with_retry(
    result: dict,
    retry_answer,
    *,
    student_id: str,
    answer_id: int,
    student_svc: StudentService,
    reward_svc: RewardService,
    quest_svc: QuestService,
) -> bool:
    """Close the mistake with a qualifying retry, once, and reward the correction."""
    if not result.get("is_correct"):
        return False
    original_answer = await student_svc.get_answer(student_id, answer_id)
    if not original_answer:
        return False
    if original_answer.reviewed_at is not None:
        return True
    question_id = retry_answer.question_id
    grading = retry_answer.grading_result if isinstance(retry_answer.grading_result, dict) else {}
    retry_answer.grading_result = {**grading, REVIEW_RETRY_USED_KEY: answer_id}
    cleared = await student_svc.mark_mistake_reviewed(student_id, answer_id)
    if not cleared:
        await student_svc.db.rollback()
        return False
    mu = result.get("mastery_update", {})
    first_kp = next(iter(mu.keys()), None)
    await reward_svc.record_event(
        student_id, "question_corrected",
        question_id=question_id,
        knowledge_point_id=first_kp,
        payload={"answer_id": answer_id, "kp_name": mu.get(first_kp, {}).get("name", "")},
    )
    await quest_svc.update_quest_progress(
        student_id, kp_id=first_kp, event_type="question_corrected"
    )
    misconception = result.get("detected_misconception")
    if misconception:
        await reward_svc.record_event(
            student_id, "misconception_fixed",
            question_id=question_id,
            knowledge_point_id=first_kp,
            payload={
                "misconception_name": misconception.get("name", ""),
                "misconception_id": misconception.get("id", ""),
            },
        )
    return cleared


@router.post("/review/retry/{answer_id}/submit", response_model=schemas.ReviewRetrySubmitResponse)
async def submit_review_retry(
    answer_id: int,
    body: schemas.ReviewRetrySubmitRequest,
    student_id: str = Depends(get_current_student_id),
    adaptive_svc: AdaptiveService = Depends(get_adaptive_service),
    student_svc: StudentService = Depends(get_student_service),
    reward_svc: RewardService = Depends(get_reward_service),
    quest_svc: QuestService = Depends(get_quest_service),
    rich_content_svc: RichContentRenderService = Depends(get_rich_content_render_service),
    include_rendered: bool = False,
    x_openphysics_include_rendered: str | None = Header(default=None, alias="X-OpenPhysics-Include-Rendered"),
):
    """Submit a retry question and clear the original mistake only after a correct retry."""
    answer = await student_svc.get_answer(student_id, answer_id)
    if not answer:
        raise HTTPException(status_code=404, detail="Mistake not found")
    await ensure_student_can_access_question(student_id, answer.question_id, student_svc)
    await ensure_student_can_access_question(student_id, body.question_id, student_svc)
    try:
        result = await adaptive_svc.submit_answer(
            student_id,
            body.question_id,
            body.given_answer,
            body.time_spent_ms,
            submission_id=body.submission_id,
            target_knowledge_point_id=body.target_knowledge_point_id,
        )
    except UngradableQuestion as e:
        raise HTTPException(status_code=422, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    cleared = False
    retry_answer = await student_svc.get_answer(student_id, result["answer_id"]) if result.get("answer_id") else None
    if result.get("is_correct") and retry_answer is not None:
        retry, _ = await _qualifying_review_retry(
            student_id, answer, retry_answer=retry_answer,
            adaptive_svc=adaptive_svc, student_svc=student_svc,
        )
        if retry is not None:
            cleared = await _clear_mistake_with_retry(
                result,
                retry,
                student_id=student_id,
                answer_id=answer_id,
                student_svc=student_svc,
                reward_svc=reward_svc,
                quest_svc=quest_svc,
            )
    result["cleared"] = cleared
    await maybe_enrich_rich_content(
        rich_content_svc,
        "enrich_submit_response",
        result,
        include_rendered=include_rendered_requested(include_rendered, x_openphysics_include_rendered),
    )
    return result
