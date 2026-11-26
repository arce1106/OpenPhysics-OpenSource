import asyncio
import logging
import time
import uuid
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.core.config import settings

logger = logging.getLogger("openphysics.api")


@asynccontextmanager
async def app_lifespan(_: FastAPI):
    from app.core.database import async_session
    from app.services.data_retention_service import (
        cleanup_expired_student_data,
        cleanup_student_ai_results_periodically,
    )
    from app.services.seed_badges import seed_badges
    from app.services.seed_learning_catalogs import seed_learning_catalogs

    async with async_session() as db:
        count = await seed_badges(db)
        if count:
            logger.info("Seeded %d badges", count)
        catalog_counts = await seed_learning_catalogs(db)
        if any(catalog_counts.values()):
            logger.info("Seeded learning catalogs: %s", catalog_counts)
        await db.commit()
        deleted = await cleanup_expired_student_data(db)
        if any(deleted.values()):
            logger.info("Cleaned expired student data: %s", deleted)
        from app.services.teacher_scan_service import purge_expired_scans
        purged = await purge_expired_scans(db)
        from app.services.teacher_scan_service import recover_interrupted_work
        recovered = await recover_interrupted_work(db)
        if any(recovered.values()):
            logger.info("Marked interrupted teacher work as failed: %s", recovered)
        if purged:
            logger.info("Purged %d expired homework scan pages", purged)
    ai_cache_cleanup = asyncio.create_task(cleanup_student_ai_results_periodically(async_session))
    try:
        yield
    finally:
        ai_cache_cleanup.cancel()
        with suppress(asyncio.CancelledError):
            await ai_cache_cleanup


def create_app() -> FastAPI:
    app = FastAPI(title="OpenPhysics API", version="0.1.0", lifespan=app_lifespan)

    cors_origins = [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Login-Captcha-Required", "Retry-After"],
    )

    @app.middleware("http")
    async def add_process_time_header(request: Request, call_next):
        start = time.perf_counter()
        request_id = (request.headers.get("X-Request-ID") or "").strip()[:128]
        if not request_id:
            request_id = uuid.uuid4().hex
        response = await call_next(request)
        duration_ms = (time.perf_counter() - start) * 1000
        response.headers["X-Process-Time-Ms"] = f"{duration_ms:.1f}"
        response.headers["X-Request-ID"] = request_id
        if request.url.path.startswith("/static/questions/"):
            response.headers.setdefault("Cache-Control", "public, max-age=604800, immutable")
        elif request.url.path.startswith("/static/"):
            response.headers.setdefault("Cache-Control", "public, max-age=86400")
        elif request.url.path in {"/panes/learning-content", "/panes/learning-content/"}:
            response.headers.setdefault("Cache-Control", "no-cache, no-store, must-revalidate")
        elif request.url.path.startswith("/panes/learning-content/assets/"):
            response.headers.setdefault("Cache-Control", "public, max-age=31536000, immutable")
        if request.url.path.startswith("/api/"):
            level = logging.WARNING if duration_ms >= 500 else logging.INFO
            logger.log(
                level,
                "api_request request_id=%s method=%s path=%s status=%s duration_ms=%.1f",
                request_id,
                request.method,
                request.url.path,
                response.status_code,
                duration_ms,
            )
        return response

    @app.get("/health/live")
    async def liveness():
        return {"status": "alive"}

    @app.get("/health")
    @app.get("/health/ready")
    async def readiness():
        from app.services.health_service import readiness_status

        result = await readiness_status()
        return JSONResponse(result, status_code=200 if result["status"] == "ready" else 503)

    from app.api.admin.router import auth_router as admin_auth_router
    from app.api.admin.router import router as admin_router
    from app.api.admin.rubrics import router as admin_rubrics_router
    from app.api.admin.teachers import router as admin_teachers_router
    from app.api.student.router import router as student_router
    from app.api.teacher.router import auth_router as teacher_auth_router
    from app.api.teacher.router import images_router as teacher_images_router
    from app.api.teacher.router import router as teacher_router

    app.include_router(student_router)
    app.include_router(admin_auth_router)
    app.include_router(admin_router)
    app.include_router(admin_teachers_router)
    app.include_router(admin_rubrics_router)
    app.include_router(teacher_auth_router)
    app.include_router(teacher_router)
    app.include_router(teacher_images_router)

    static_dir = Path(__file__).resolve().parent.parent / "static"
    static_dir.mkdir(parents=True, exist_ok=True)
    questions_dir = static_dir / "questions"
    questions_dir.mkdir(exist_ok=True)
    videos_dir = static_dir / "physics_videos"
    videos_dir.mkdir(exist_ok=True)
    (static_dir / "uploads" / "answers").mkdir(parents=True, exist_ok=True)
    app.mount("/static/questions", StaticFiles(directory=str(questions_dir)), name="question-static")
    app.mount("/static/physics_videos", StaticFiles(directory=str(videos_dir)), name="physics-video-static")

    learning_content_pane_dir = Path(__file__).resolve().parent.parent / "panes" / "learning-content-pane" / "dist"
    if learning_content_pane_dir.exists():
        app.mount(
            "/panes/learning-content",
            StaticFiles(directory=str(learning_content_pane_dir), html=True),
            name="learning-content-pane",
        )

    return app


app = create_app()
