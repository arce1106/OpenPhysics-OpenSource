import hmac
import time
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.config import settings
from app.services.knowledge_service import KnowledgeService
from app.services.question_service import QuestionNotGradable, QuestionService
from app.services import question_video_service
from app.models.question_video import QuestionVideo
from app.services.ai_service import AIService
from app.services.admin_learning_resource_service import AdminLearningResourceService
from app.services.admin_quality_service import AdminQualityService
from app.services.admin_teaching_service import AdminTeachingService
from app.services.admin_auth_service import AdminAuthService
from app.services.login_attempt_limiter import LoginAttemptLimiter, get_login_limiter
from app.services.learning_video_curation_service import LearningVideoCurationService
from app.services.learning_catalog_service import LearningCatalogService
from app.services.student_service import StudentService
from app.models.knowledge import RelationType
from app.models.question import QualityStatus
from pathlib import Path

from app.services.question_importer import QuestionImporter
from . import schemas

def verify_admin_token(x_admin_token: str | None = Header(default=None)) -> None:
    if not settings.admin_password_hash:
        raise HTTPException(status_code=503, detail="Admin login is not configured")

    if not x_admin_token:
        raise HTTPException(status_code=401, detail="Admin login required")

    username = AdminAuthService.decode_access_token(x_admin_token, settings.admin_auth_secret)
    if username:
        return

    if settings.admin_api_token and hmac.compare_digest(x_admin_token, settings.admin_api_token):
        return

    raise HTTPException(status_code=401, detail="Invalid admin token")


router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    dependencies=[Depends(verify_admin_token)],
)

auth_router = APIRouter(prefix="/api/admin/auth", tags=["admin-auth"])


@auth_router.post("/login", response_model=schemas.AdminLoginResponse)
async def login_admin(
    body: schemas.AdminLoginRequest,
    limiter: LoginAttemptLimiter = Depends(get_login_limiter),
):
    if not settings.admin_password_hash:
        raise HTTPException(status_code=503, detail="Admin login is not configured")
    attempt_key = await limiter.check("admin", body.username)
    if not hmac.compare_digest(body.username.strip(), settings.admin_username):
        raise HTTPException(status_code=401, detail="Invalid admin credentials")
    if not AdminAuthService.verify_password(body.password, settings.admin_password_hash):
        raise HTTPException(status_code=401, detail="Invalid admin credentials")
    await limiter.succeeded(attempt_key)
    return {
        "access_token": AdminAuthService.create_access_token(
            settings.admin_username,
            settings.admin_auth_secret,
            settings.admin_access_token_minutes,
        ),
        "token_type": "bearer",
        "username": settings.admin_username,
    }


@auth_router.get("/me", response_model=schemas.AdminMeResponse)
async def get_admin_me(x_admin_token: str | None = Header(default=None)):
    verify_admin_token(x_admin_token)
    username = AdminAuthService.decode_access_token(x_admin_token or "", settings.admin_auth_secret)
    return {"username": username or settings.admin_username}


def _static_file_for_static_path(image_path: str, static_root: Path) -> Path | None:
    """Resolve a /static/... URL path to a file below static_root."""
    prefix = "/static/"
    if not image_path.startswith(prefix):
        return None

    relative = Path(image_path[len(prefix):])
    if relative.is_absolute() or ".." in relative.parts:
        return None
    return static_root / relative


def get_knowledge_service(db: AsyncSession = Depends(get_db)) -> KnowledgeService:
    return KnowledgeService(db)


def get_question_service(db: AsyncSession = Depends(get_db)) -> QuestionService:
    return QuestionService(db)


def get_ai_service() -> AIService:
    return AIService()


def get_student_service(db: AsyncSession = Depends(get_db)) -> StudentService:
    return StudentService(db)


def get_admin_quality_service(db: AsyncSession = Depends(get_db)) -> AdminQualityService:
    return AdminQualityService(db)


def get_admin_learning_resource_service(
    db: AsyncSession = Depends(get_db),
) -> AdminLearningResourceService:
    return AdminLearningResourceService(db)


def get_learning_video_curation_service(
    db: AsyncSession = Depends(get_db),
) -> LearningVideoCurationService:
    return LearningVideoCurationService(db)


def get_learning_catalog_service(
    db: AsyncSession = Depends(get_db),
) -> LearningCatalogService:
    return LearningCatalogService(db)


def get_admin_teaching_service(db: AsyncSession = Depends(get_db)) -> AdminTeachingService:
    return AdminTeachingService(db)


# --- Knowledge Points ---


@router.get("/learning-catalogs")
async def list_learning_catalogs(
    svc: LearningCatalogService = Depends(get_learning_catalog_service),
):
    return await svc.list_catalogs(include_disabled=True)


@router.get("/learning-catalogs/{catalog_code}")
async def get_learning_catalog(
    catalog_code: str,
    svc: LearningCatalogService = Depends(get_learning_catalog_service),
):
    catalog = await svc.get_catalog(
        catalog_code,
        include_mappings=True,
        include_disabled=True,
    )
    if not catalog:
        raise HTTPException(status_code=404, detail="Learning catalog not found")
    return catalog


@router.get("/knowledge/points")
async def list_knowledge_points(svc: KnowledgeService = Depends(get_knowledge_service)):
    points = await svc.get_all_points()
    return [{"id": p.id, "name": p.name, "volume": p.volume, "chapter": p.chapter, "section": p.section, "description": p.description, "difficulty": p.difficulty} for p in points]


@router.get("/knowledge/points/with-stats")
async def list_knowledge_points_with_stats(
    knowledge_svc: KnowledgeService = Depends(get_knowledge_service),
    question_svc: QuestionService = Depends(get_question_service),
):
    points = await knowledge_svc.get_all_points()
    counts = await question_svc.get_question_counts_by_kp()
    return [
        {
            "id": p.id,
            "name": p.name,
            "volume": p.volume,
            "chapter": p.chapter,
            "section": p.section,
            "description": p.description,
            "difficulty": p.difficulty,
            "question_count": counts.get(p.id, {}).get("total", 0),
            "tier_counts": {
                "easy": counts.get(p.id, {}).get("easy", 0),
                "moderate_easy": counts.get(p.id, {}).get("moderate_easy", 0),
                "medium": counts.get(p.id, {}).get("medium", 0),
                "moderate_hard": counts.get(p.id, {}).get("moderate_hard", 0),
                "hard": counts.get(p.id, {}).get("hard", 0),
            },
        }
        for p in points
    ]


@router.post("/knowledge/points")
async def create_knowledge_point(body: schemas.KnowledgePointCreate, svc: KnowledgeService = Depends(get_knowledge_service)):
    return await svc.create_point(body.model_dump())


@router.put("/knowledge/points/{kp_id}")
async def update_knowledge_point(kp_id: str, body: schemas.KnowledgePointUpdate, svc: KnowledgeService = Depends(get_knowledge_service)):
    kp = await svc.update_point(kp_id, body.model_dump(exclude_none=True))
    if not kp:
        raise HTTPException(status_code=404, detail="Knowledge point not found")
    return kp


@router.delete("/knowledge/points/{kp_id}")
async def delete_knowledge_point(kp_id: str, svc: KnowledgeService = Depends(get_knowledge_service)):
    ok = await svc.delete_point(kp_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Knowledge point not found")
    return {"deleted": True}


@router.get("/knowledge/relations")
async def list_relations(svc: KnowledgeService = Depends(get_knowledge_service)):
    relations = await svc.get_relations()
    return [{"id": r.id, "source_id": r.source_id, "target_id": r.target_id, "relation_type": r.relation_type.value, "reason": r.reason} for r in relations]


@router.post("/knowledge/relations")
async def create_relation(body: schemas.RelationCreate, svc: KnowledgeService = Depends(get_knowledge_service)):
    return await svc.create_relation(body.source_id, body.target_id, RelationType(body.relation_type), body.reason)


@router.delete("/knowledge/relations/{rel_id}")
async def delete_relation(rel_id: int, svc: KnowledgeService = Depends(get_knowledge_service)):
    ok = await svc.delete_relation(rel_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Relation not found")
    return {"deleted": True}


# --- Questions ---

def _parse_quality_status(status: str | None) -> QualityStatus | None:
    if not status:
        return None
    try:
        return QualityStatus(status)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"未知的题目状态：{status}") from None


async def _questions_with_videos(svc: QuestionService, questions: list) -> list[dict]:
    videos = await question_video_service.all_video_summaries(svc.db, [q.id for q in questions])
    return [{**jsonable_encoder(q), "has_video": videos.get(q.id, {}).get("status") == "approved",
             "video": videos.get(q.id)} for q in questions]


@router.get("/questions")
async def list_questions(
    status: str | None = None,
    kp_id: str | None = None,
    volume: str | None = None,
    chapter: str | None = None,
    section: str | None = None,
    difficulty_tier: str | None = None,
    search: str | None = None,
    question_type: str | None = None,
    has_video: bool | None = None,
    limit: int = 20,
    offset: int = 0,
    svc: QuestionService = Depends(get_question_service),
):
    qs = _parse_quality_status(status)
    questions = await svc.list_questions(
        status=qs,
        kp_id=kp_id,
        difficulty_tier=difficulty_tier,
        search=search,
        question_type=question_type,
        volume=volume,
        chapter=chapter,
        section=section,
        limit=limit,
        offset=offset,
        has_video=has_video,
    )
    return await _questions_with_videos(svc, questions)


@router.get("/questions/paged")
async def list_questions_paged(
    status: str | None = None,
    kp_id: str | None = None,
    volume: str | None = None,
    chapter: str | None = None,
    section: str | None = None,
    difficulty_tier: str | None = None,
    search: str | None = None,
    question_type: str | None = None,
    has_video: bool | None = None,
    page: int = 1,
    page_size: int = 20,
    svc: QuestionService = Depends(get_question_service),
):
    safe_page = max(1, page)
    safe_page_size = max(1, min(page_size, 100))
    offset = (safe_page - 1) * safe_page_size
    qs = _parse_quality_status(status)
    items = await svc.list_questions(
        status=qs,
        kp_id=kp_id,
        difficulty_tier=difficulty_tier,
        search=search,
        question_type=question_type,
        volume=volume,
        chapter=chapter,
        section=section,
        limit=safe_page_size,
        offset=offset,
        has_video=has_video,
    )
    total = await svc.count_questions(
        status=qs,
        kp_id=kp_id,
        difficulty_tier=difficulty_tier,
        search=search,
        question_type=question_type,
        volume=volume,
        chapter=chapter,
        section=section,
        has_video=has_video,
    )
    return {
        "items": await _questions_with_videos(svc, items),
        "total": total,
        "page": safe_page,
        "page_size": safe_page_size,
    }


@router.get("/quality/report")
async def get_quality_report(
    volume: str | None = None,
    chapter: str | None = None,
    section: str | None = None,
    kp_id: str | None = None,
    svc: AdminQualityService = Depends(get_admin_quality_service),
):
    return await svc.build_report(volume=volume, chapter=chapter, section=section, kp_id=kp_id)


@router.get("/learning/resources")
async def get_learning_resources(
    volume: str | None = None,
    chapter: str | None = None,
    section: str | None = None,
    kp_id: str | None = None,
    svc: AdminLearningResourceService = Depends(get_admin_learning_resource_service),
):
    return await svc.build_report(volume=volume, chapter=chapter, section=section, kp_id=kp_id)


@router.get("/learning/videos")
async def list_learning_videos(
    kp_id: str,
    svc: LearningVideoCurationService = Depends(get_learning_video_curation_service),
):
    return [svc.to_dict(item) for item in await svc.list_for_kp(kp_id)]


@router.post("/learning/videos")
async def create_learning_video(
    body: schemas.LearningVideoCurationCreate,
    svc: LearningVideoCurationService = Depends(get_learning_video_curation_service),
):
    item = await svc.create(body.model_dump())
    return svc.to_dict(item)


@router.put("/learning/videos/{video_id}")
async def update_learning_video(
    video_id: int,
    body: schemas.LearningVideoCurationUpdate,
    svc: LearningVideoCurationService = Depends(get_learning_video_curation_service),
):
    item = await svc.update(video_id, body.model_dump(exclude_unset=True))
    if not item:
        raise HTTPException(status_code=404, detail="Video curation not found")
    return svc.to_dict(item)


@router.delete("/learning/videos/{video_id}")
async def delete_learning_video(
    video_id: int,
    svc: LearningVideoCurationService = Depends(get_learning_video_curation_service),
):
    ok = await svc.delete(video_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Video curation not found")
    return {"deleted": True}


@router.get("/teaching/dashboard")
async def get_teaching_dashboard(
    class_name: str | None = None,
    limit: int = 20,
    svc: AdminTeachingService = Depends(get_admin_teaching_service),
):
    return await svc.build_dashboard(class_name=class_name, limit=max(1, min(limit, 100)))


@router.get("/teaching/insights")
async def get_teaching_insights(
    class_id: str | None = None,
    include_internal: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """Where students learn badly, for content work: weak knowledge points and questions that go wrong."""
    from app.services.admin_content_insights_service import AdminContentInsightsService

    service = AdminContentInsightsService(db)
    return {**await service.build(class_id=class_id or None, include_internal=include_internal),
            "classes": await service.classes()}


@router.get("/teaching/students")
async def get_teaching_students(
    class_name: str | None = None,
    limit: int = 100,
    svc: AdminTeachingService = Depends(get_admin_teaching_service),
):
    return await svc.list_students(class_name=class_name, limit=max(1, min(limit, 200)))


@router.get("/teaching/weak-points")
async def get_teaching_weak_points(
    class_name: str | None = None,
    limit: int = 20,
    svc: AdminTeachingService = Depends(get_admin_teaching_service),
):
    return await svc.list_weak_points(class_name=class_name, limit=max(1, min(limit, 100)))


@router.get("/teaching/hot-mistakes")
async def get_teaching_hot_mistakes(
    class_name: str | None = None,
    limit: int = 20,
    svc: AdminTeachingService = Depends(get_admin_teaching_service),
):
    return await svc.list_hot_mistakes(class_name=class_name, limit=max(1, min(limit, 100)))


@router.get("/questions/{question_id}")
async def get_question(
    question_id: str,
    svc: QuestionService = Depends(get_question_service),
):
    q = await svc.get_question(question_id)
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")
    return (await _questions_with_videos(svc, [q]))[0]


@router.post("/questions/{question_id}/video")
async def upload_question_video(
    question_id: str,
    file: UploadFile = File(...),
    title: str = Form(default="本题视频讲解", max_length=160),
    db: AsyncSession = Depends(get_db),
):
    try:
        video = await question_video_service.upload_video(db, question_id, file, title)
        return question_video_service.admin_video_summary(video)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from None
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from None
    except (RuntimeError, TimeoutError):
        raise HTTPException(status_code=503, detail="视频检查暂未完成，请稍后重试") from None


@router.put("/questions/{question_id}/video/status")
async def review_question_video(
    question_id: str,
    body: schemas.QuestionVideoReview,
    db: AsyncSession = Depends(get_db),
):
    try:
        video = await question_video_service.set_video_status(db, question_id, body.status)
        return question_video_service.admin_video_summary(video)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from None
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from None


@router.post("/questions/{question_id}/video/preview")
async def preview_question_video(question_id: str, db: AsyncSession = Depends(get_db)):
    from app.services.teacher_paper_service import _sign

    video = await db.scalar(select(QuestionVideo).where(QuestionVideo.question_id == question_id))
    if video is None or not (question_video_service.MEDIA_DIR / video.filename).is_file():
        raise HTTPException(status_code=404, detail="视频暂不可用")
    token = _sign({"kind": "media", "filename": video.filename, "expires": int(time.time()) + 7200})
    return {"video_url": "/api/student/question-videos/media?" + urlencode({"token": token})}


@router.post("/questions")
async def create_question(body: schemas.QuestionCreate, svc: QuestionService = Depends(get_question_service)):
    try:
        return await svc.create_question(body.model_dump())
    except QuestionNotGradable as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.put("/questions/{question_id}")
async def update_question(question_id: str, body: dict, svc: QuestionService = Depends(get_question_service)):
    has_children = any(k in body for k in ("options", "labels", "images", "formulas"))
    try:
        if has_children:
            q = await svc.update_children(question_id, body)
        else:
            q = await svc.update_question(question_id, body)
    except QuestionNotGradable as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")
    return q


@router.put("/questions/{question_id}/review")
async def review_question(question_id: str, body: schemas.QuestionReview, svc: QuestionService = Depends(get_question_service)):
    try:
        q = await svc.review_question(question_id, QualityStatus(body.status))
    except QuestionNotGradable as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")
    return {"id": q.id, "quality_status": q.quality_status.value}


@router.delete("/questions/{question_id}")
async def delete_question(
    question_id: str,
    svc: QuestionService = Depends(get_question_service),
):
    usage = await svc.question_usage(question_id)
    if usage is None:
        raise HTTPException(status_code=404, detail="Question not found")
    if usage:
        # Student answers keep a hard foreign key to the question, and papers list
        # question ids in JSON. Removing it would fail or leave dangling ids.
        parts = "、".join(f"{label} {count} 条" for label, count in usage.items())
        raise HTTPException(
            status_code=409,
            detail=f"这道题已被使用（{parts}），不能删除。请把审核状态改为“已退役”，学生端将不再出现。",
        )
    ok = await svc.delete_question(question_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Question not found")
    return {"deleted": True}


@router.delete("/questions/{question_id}/images/{image_id}")
async def delete_question_image(
    question_id: str,
    image_id: str,
    svc: QuestionService = Depends(get_question_service),
):
    path = await svc.delete_question_image(question_id, image_id)
    if not path:
        raise HTTPException(status_code=404, detail="Image not found")
    # Delete physical file
    try:
        static_root = Path(__file__).resolve().parent.parent.parent.parent / "static"
        file_path = _static_file_for_static_path(path, static_root)
        if file_path and file_path.exists():
            file_path.unlink()
    except Exception:
        pass
    return {"deleted": True, "image_id": image_id}


@router.put("/questions/{question_id}/images/{image_id}")
async def update_question_image(
    question_id: str,
    image_id: str,
    body: schemas.ImageUpdateRequest,
    svc: QuestionService = Depends(get_question_service),
):
    img = await svc.update_question_image(question_id, image_id, body.model_dump(exclude_unset=True))
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    return {
        "id": img.id,
        "image_path": img.image_path,
        "image_type": img.image_type,
        "description": img.description,
        "extracted_structure": img.extracted_structure,
    }


@router.post("/questions/batch-import")
async def batch_import_questions(
    body: schemas.BatchImportRequest,
    q_svc: QuestionService = Depends(get_question_service),
):
    importer = QuestionImporter(q_svc)
    image_dir = Path(body.image_dir) if body.image_dir else None
    results = await importer.import_questions(body.questions, image_dir)
    created = sum(1 for r in results if r.action == "created")
    updated = sum(1 for r in results if r.action == "updated")
    errors = [{"id": r.question_id, "error": r.error} for r in results if not r.success]
    return schemas.BatchImportResponse(
        total=len(results),
        created=created,
        updated=updated,
        errors=errors,
    )


# --- Students ---

@router.get("/students")
async def list_students(
    student_svc: StudentService = Depends(get_student_service),
):
    students = await student_svc.list_students()
    return [student_svc.serialize_student(student) for student in students]


@router.post("/students")
async def create_student(
    body: schemas.StudentCreateRequest,
    student_svc: StudentService = Depends(get_student_service),
):
    if await student_svc.get_student_by_username(body.username):
        raise HTTPException(status_code=409, detail="Student username already exists")
    student = await student_svc.create_student(
        username=body.username,
        password=body.password,
        display_name=body.display_name or body.username,
        class_name=body.class_name,
        status=body.status,
    )
    return student_svc.serialize_student(student)


@router.put("/students/{student_id}")
async def update_student(
    student_id: str,
    body: schemas.StudentUpdateRequest,
    student_svc: StudentService = Depends(get_student_service),
):
    student = await student_svc.update_student(
        student_id=student_id,
        display_name=body.display_name,
        class_name=body.class_name,
        status=body.status,
    )
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    return student_svc.serialize_student(student)


@router.post("/students/{student_id}/reset-password")
async def reset_student_password(
    student_id: str,
    body: schemas.StudentPasswordResetRequest,
    student_svc: StudentService = Depends(get_student_service),
):
    student = await student_svc.reset_student_password(student_id, body.password)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    return {"reset": True, "student": student_svc.serialize_student(student)}


@router.post("/students/{student_id}/reset-account")
async def reset_student_account(
    student_id: str,
    body: schemas.StudentAccountResetRequest,
    student_svc: StudentService = Depends(get_student_service),
):
    if body.confirm != "RESET":
        raise HTTPException(status_code=400, detail="Invalid reset confirmation")
    result = await student_svc.reset_student_account(student_id)
    if not result:
        raise HTTPException(status_code=404, detail="Student not found")
    return {
        "reset": True,
        "student": student_svc.serialize_student(result["student"]),
        "deleted": result["deleted"],
    }


# --- AI Operations ---

@router.post("/ai/generate-questions")
async def ai_generate_questions(
    body: schemas.GenerateQuestionsRequest,
    ai_svc: AIService = Depends(get_ai_service),
    knowledge_svc: KnowledgeService = Depends(get_knowledge_service),
    question_svc: QuestionService = Depends(get_question_service),
):
    kps = []
    for kp_id in body.knowledge_point_ids:
        kp = await knowledge_svc.get_point(kp_id)
        if kp:
            kps.append({"id": kp.id, "name": kp.name, "description": kp.description})
    if not kps:
        raise HTTPException(status_code=400, detail="No valid knowledge points found")

    result = await ai_svc.generate_questions(
        knowledge_points=kps,
        difficulty=body.difficulty,
        question_type=body.question_type,
        physics_models=body.physics_models,
        count=body.count,
    )
    return result


@router.post("/ai/label-question")
async def ai_label_question(
    body: schemas.LabelQuestionRequest,
    ai_svc: AIService = Depends(get_ai_service),
    question_svc: QuestionService = Depends(get_question_service),
    knowledge_svc: KnowledgeService = Depends(get_knowledge_service),
):
    q = await question_svc.get_question(body.question_id)
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")
    kps = await knowledge_svc.get_all_points()
    kp_list = [{"id": kp.id, "name": kp.name, "description": kp.description} for kp in kps]
    return await ai_svc.label_question({"stem_text": q.stem_text, "options": [{"text": o.text} for o in q.options]}, kp_list)


@router.post("/ai/diagnose")
async def ai_diagnose_student(
    body: schemas.DiagnoseRequest,
    ai_svc: AIService = Depends(get_ai_service),
    db: AsyncSession = Depends(get_db),
):
    from app.services.student_service import StudentService
    svc = StudentService(db)
    answers = await svc.get_answer_history(body.student_id, limit=20)
    mastery = await svc.get_all_mastery(body.student_id)
    answer_dicts = [{"question_id": a.question_id, "is_correct": a.is_correct} for a in answers]
    mastery_dicts = [{"knowledge_point_id": m.knowledge_point_id, "mastery": m.mastery} for m in mastery]
    return await ai_svc.diagnose_student(answer_dicts, mastery_dicts)


@router.put("/questions/{question_id}/labels")
async def update_question_labels(
    question_id: str,
    body: schemas.LabelUpdateRequest,
    svc: QuestionService = Depends(get_question_service),
):
    labels_data = [lbl.model_dump() for lbl in body.labels]
    q = await svc.update_question_labels(question_id, labels_data)
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")
    return {"id": q.id, "labels": len(q.labels)}


@router.post("/questions/batch-review")
async def batch_review_questions(
    body: schemas.BatchReviewRequest,
    svc: QuestionService = Depends(get_question_service),
):
    updated = 0
    errors = []
    for qid in body.question_ids:
        try:
            q = await svc.review_question(qid, QualityStatus(body.status))
            if q:
                updated += 1
            else:
                errors.append({"id": qid, "error": "Not found"})
        except Exception as e:
            errors.append({"id": qid, "error": str(e)})
    return {"updated": updated, "errors": errors}
