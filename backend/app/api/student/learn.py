from functools import partial

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse

from app.physics_core.elective2 import (
    build_bounded_magnetic_field_simulation,
    build_left_hand_rule_model_package,
)
from app.services.ai_service import AIService
from app.services.learning_service import LearningService
from app.services.learning_video_curation_service import LearningVideoCurationService
from app.services.knowledge_service import KnowledgeService, canonical_kp_name
from app.services.rich_content_render_service import RichContentRenderService
from app.services.video_recommendation_service import VideoRecommendationService
from app.services.reward_service import RewardService
from app.services.quest_service import QuestService
from app.services.student_ai_usage_service import StudentAiUsageService
from . import schemas
from .dependencies import (
    ensure_student_can_access_kp,
    get_ai_service,
    get_current_student_id,
    get_knowledge_service,
    get_learning_service,
    get_learning_video_curation_service,
    get_quest_service,
    get_rich_content_render_service,
    get_reward_service,
    get_student_ai_usage_service,
    get_student_service,
    get_video_recommendation_service,
    include_rendered_requested,
    maybe_enrich_rich_content,
)
from .helpers import compact_learning_card_context
from app.services.student_service import StudentService

router = APIRouter()

@router.get("/learn/{kp_id}", response_model=schemas.LearnBundleResponse)
async def get_learn_bundle(
    kp_id: str,
    student_id: str = Depends(get_current_student_id),
    learn_svc: LearningService = Depends(get_learning_service),
    knowledge_svc: KnowledgeService = Depends(get_knowledge_service),
    student_svc: StudentService = Depends(get_student_service),
    rich_content_svc: RichContentRenderService = Depends(get_rich_content_render_service),
    include_rendered: bool = False,
    x_openphysics_include_rendered: str | None = Header(default=None, alias="X-OpenPhysics-Include-Rendered"),
):
    """Get all learning content for a KP: card + slides + simulations + progress."""
    await ensure_student_can_access_kp(student_id, kp_id, student_svc)
    kp = await knowledge_svc.get_point(kp_id)
    if not kp:
        raise HTTPException(status_code=404, detail="Knowledge point not found")
    kp_name = canonical_kp_name(kp_id, kp.name)

    contents = await learn_svc.get_content_for_kp(kp_id)
    progress_list = await learn_svc.get_progress(student_id, kp_id)
    consumed_ids = {p.content_id for p in progress_list}

    # Build card
    card = None
    card_content = next((c for c in contents if c.content_type.value == "card"), None)
    if card_content:
        body = card_content.body
        sections = body.get("sections", [])
        card = schemas.KnowledgeCard(
            content_id=card_content.id,
            kp_id=kp_id,
            kp_name=kp_name,
            title=card_content.title,
            sections=[
                schemas.LearnContentSection(
                    type=s.get("type", ""),
                    title=s.get("title", ""),
                    content=s,
                )
                for s in sections
            ],
            source=card_content.source.value if hasattr(card_content.source, "value") else str(card_content.source),
            consumed=card_content.id in consumed_ids,
        )

    # Build slides
    slides = None
    slide_content = next((c for c in contents if c.content_type.value == "slides"), None)
    if slide_content:
        body = slide_content.body
        raw_slides = body.get("slides", [])
        slides = schemas.SlideDeck(
            content_id=slide_content.id,
            kp_id=kp_id,
            title=slide_content.title,
            slides=[
                schemas.SlideItem(
                    type=s.get("type", "content"),
                    title=s.get("title", ""),
                    subtitle=s.get("subtitle"),
                    blocks=[
                        schemas.SlideBlock(type=b.get("type", "text"), content=b)
                        for b in s.get("blocks", [])
                    ],
                    layout=s.get("layout", "content"),
                )
                for s in raw_slides
            ],
            total=len(raw_slides),
            consumed=slide_content.id in consumed_ids,
        )

    # Build simulations
    sim_list: list[schemas.SimulationContent] = []
    for sim_content in [c for c in contents if c.content_type.value == "simulation"]:
        body = sim_content.body
        sim_list.append(schemas.SimulationContent(
            content_id=sim_content.id,
            kp_id=kp_id,
            kp_name=kp_name,
            title=sim_content.title,
            config=body.get("config", {}),
            html=body.get("html", ""),
            consumed=sim_content.id in consumed_ids,
        ))

    # Build examples
    examples: list[dict] = []
    for ex in [c for c in contents if c.content_type.value == "example"]:
        examples.append({
            "content_id": ex.id,
            "title": ex.title,
            "body": ex.body,
            "consumed": ex.id in consumed_ids,
        })

    # Progress summary
    progress: dict[str, dict[str, int]] = {}
    for c in contents:
        ct = c.content_type.value
        if ct not in progress:
            progress[ct] = {"consumed": 0, "total": 0}
        progress[ct]["total"] += 1
    for p in progress_list:
        ct = p.content_type.value if hasattr(p.content_type, "value") else str(p.content_type)
        if ct in progress:
            progress[ct]["consumed"] += 1

    response = schemas.LearnBundleResponse(
        kp_id=kp_id,
        kp_name=kp_name,
        card=card,
        slides=slides,
        simulations=sim_list,
        examples=examples,
        progress=progress,
    )
    enriched = await maybe_enrich_rich_content(
        rich_content_svc,
        "enrich_learn_bundle",
        response,
        include_rendered=include_rendered_requested(include_rendered, x_openphysics_include_rendered),
    )
    if enriched is not None:
        return enriched
    return response


@router.get("/learn/{kp_id}/content")
async def get_learn_content(
    kp_id: str,
    type: str = "card",
    student_id: str = Depends(get_current_student_id),
    learn_svc: LearningService = Depends(get_learning_service),
    student_svc: StudentService = Depends(get_student_service),
    rich_content_svc: RichContentRenderService = Depends(get_rich_content_render_service),
    include_rendered: bool = False,
    x_openphysics_include_rendered: str | None = Header(default=None, alias="X-OpenPhysics-Include-Rendered"),
):
    """Get a specific content type for a KP."""
    await ensure_student_can_access_kp(student_id, kp_id, student_svc)
    content = await learn_svc.get_content_by_type(kp_id, type)
    if not content:
        raise HTTPException(status_code=404, detail=f"No {type} content found")
    enriched = await maybe_enrich_rich_content(
        rich_content_svc,
        "enrich_learning_content",
        content.body,
        include_rendered=include_rendered_requested(include_rendered, x_openphysics_include_rendered),
    )
    if enriched is not None:
        return enriched
    return content.body


@router.get("/learn/{kp_id}/videos", response_model=schemas.VideoRecommendationResponse)
async def get_learn_videos(
    kp_id: str,
    student_id: str = Depends(get_current_student_id),
    knowledge_svc: KnowledgeService = Depends(get_knowledge_service),
    student_svc: StudentService = Depends(get_student_service),
    video_svc: VideoRecommendationService = Depends(get_video_recommendation_service),
    video_curation_svc: LearningVideoCurationService = Depends(get_learning_video_curation_service),
):
    """Recommend Bilibili learning videos for the current knowledge point."""
    await ensure_student_can_access_kp(student_id, kp_id, student_svc)
    kp = await knowledge_svc.get_point(kp_id)
    if not kp:
        raise HTTPException(status_code=404, detail="Knowledge point not found")
    kp_name = canonical_kp_name(kp_id, kp.name)
    db_curations = await video_curation_svc.recommendation_maps(kp_id)
    result = await video_svc.recommend(
        kp_id=kp_id,
        kp_name=kp_name,
        volume=kp.volume,
        chapter=kp.chapter,
        section=kp.section,
        limit=5,
        curated_videos=db_curations["lecture"] or None,
        curated_experiment_videos=db_curations["experiment"] or None,
    )
    return schemas.VideoRecommendationResponse(
        kp_id=kp_id,
        kp_name=kp_name,
        query=result["query"],
        items=result["items"],
        experiment=result.get("experiment"),
        experiments=result.get("experiments") or ([result["experiment"]] if result.get("experiment") else []),
        fallback=result["fallback"],
    )


@router.get("/learn/{kp_id}/simulation", response_model=schemas.PhysicsSimulationResponse)
async def get_learn_simulation(
    kp_id: str,
    student_id: str = Depends(get_current_student_id),
    knowledge_svc: KnowledgeService = Depends(get_knowledge_service),
    student_svc: StudentService = Depends(get_student_service),
):
    """Return an authoritative backend-generated physics simulation for a KP."""
    await ensure_student_can_access_kp(student_id, kp_id, student_svc)
    kp = await knowledge_svc.get_point(kp_id)
    if not kp:
        raise HTTPException(status_code=404, detail="Knowledge point not found")
    kp_name = canonical_kp_name(kp_id, kp.name)

    simulation = None
    if kp_id.startswith(("x2c1s1k02", "x2c1s2k02", "x2c1s2k03")):
        simulation = build_left_hand_rule_model_package()
    elif kp_id.startswith("x2c1s3k05"):
        simulation = build_bounded_magnetic_field_simulation()

    return schemas.PhysicsSimulationResponse(
        kp_id=kp_id,
        kp_name=kp_name,
        simulation=simulation,
    )


@router.post("/learn/{kp_id}/complete", response_model=schemas.LearnCompleteResponse)
async def complete_learn(
    kp_id: str,
    body: schemas.LearnCompleteRequest,
    student_id: str = Depends(get_current_student_id),
    learn_svc: LearningService = Depends(get_learning_service),
    reward_svc: RewardService = Depends(get_reward_service),
    quest_svc: QuestService = Depends(get_quest_service),
    student_svc: StudentService = Depends(get_student_service),
):
    """Mark learning content as consumed and apply BKT update."""
    await ensure_student_can_access_kp(student_id, body.kp_id, student_svc)
    before_mastery = await learn_svc.get_mastery_for_kp(student_id, body.kp_id)
    before = before_mastery.mastery if before_mastery else 0.0

    await learn_svc.mark_content_consumed(
        student_id, body.kp_id, body.content_id,
        body.content_type, body.time_spent_seconds,
    )
    updated = await learn_svc.record_learning_completion(student_id, body.kp_id)
    after = updated.mastery if updated else before

    # Fire learning reward
    await reward_svc.record_event(
        student_id, "lesson_completed",
        knowledge_point_id=body.kp_id,
        payload={"content_type": body.content_type},
    )
    await quest_svc.update_quest_progress(
        student_id, kp_id=body.kp_id, event_type="lesson_completed"
    )

    return schemas.LearnCompleteResponse(
        success=True,
        mastery_update={body.kp_id: {
            "before": before,
            "after": after,
            "name": canonical_kp_name(body.kp_id),
        }},
    )


@router.post("/learn/chat")
async def learn_chat(
    body: schemas.LearnChatRequest,
    student_id: str = Depends(get_current_student_id),
    knowledge_svc: KnowledgeService = Depends(get_knowledge_service),
    learn_svc: LearningService = Depends(get_learning_service),
    ai_svc: AIService = Depends(get_ai_service),
    student_svc: StudentService = Depends(get_student_service),
    ai_usage_svc: StudentAiUsageService = Depends(get_student_ai_usage_service),
):
    """AI conversational tutoring with SSE streaming."""
    await ensure_student_can_access_kp(student_id, body.kp_id, student_svc)
    kp = await knowledge_svc.get_point(body.kp_id)
    if not kp:
        raise HTTPException(status_code=404, detail="Knowledge point not found")
    kp_name = canonical_kp_name(body.kp_id, kp.name)

    # Get card content for context
    card = await learn_svc.get_content_by_type(body.kp_id, "card")
    card_context = compact_learning_card_context(card.body if card else None)

    stream = await ai_usage_svc.stream(
        student_id, feature="learn.chat",
        operation=partial(ai_svc.stream_learning_chat,
            kp_name=kp_name,
            kp_description=kp.description or "",
            kp_chapter=kp.chapter or "",
            card_context=card_context,
            message=body.message,
            history=[h.model_dump() for h in body.history],
        ),
    )

    return StreamingResponse(
        stream,
        media_type="text/event-stream",
    )


# ── Directory BFF ──────────────────────────────────────────────────────────────
