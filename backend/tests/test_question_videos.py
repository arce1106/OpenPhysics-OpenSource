import io
import json
import subprocess

import httpx
import pytest
from fastapi import FastAPI, UploadFile
from sqlalchemy import select

from app.api.admin.router import router, verify_admin_token
from app.core.database import get_db
from app.models.question import QualityStatus, Question
from app.models.question_video import QuestionVideo
from app.services import question_video_service as videos
from app.services.question_service import QuestionService


def question(qid):
    return Question(id=qid, stem_text=qid, quality_status=QualityStatus.approved)


@pytest.fixture
def valid_mp4(tmp_path):
    path = tmp_path / "recording.mp4"
    subprocess.run([
        "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=white:s=128x128:d=1",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(path),
    ], check=True)
    return path.read_bytes()


@pytest.mark.asyncio
async def test_admin_filter_counts_only_published_videos_and_preserves_pagination(db_session):
    db_session.add_all([question(qid) for qid in ("a", "b", "c")])
    await db_session.flush()
    db_session.add_all([QuestionVideo(
        id=qid, question_id=qid, title=qid, filename=qid + ".mp4", sha256="a" * 64,
        duration_seconds=12, status=status,
    ) for qid, status in (("a", "approved"), ("b", "draft"))])
    await db_session.commit()
    service = QuestionService(db_session)
    assert [q.id for q in await service.list_questions(has_video=True)] == ["a"]
    assert await service.count_questions(has_video=True) == 1
    assert [q.id for q in await service.list_questions(has_video=False, limit=1, offset=1)] == ["b"]
    assert await service.count_questions(has_video=False) == 2
    assert await service.count_questions() == 3


@pytest.mark.asyncio
async def test_upload_validates_actual_media_and_replacement_requires_publish(db_session, monkeypatch, tmp_path, valid_mp4):
    monkeypatch.setattr(videos, "MEDIA_DIR", tmp_path / "private")
    db_session.add(question("q-test"))
    await db_session.commit()
    with pytest.raises(ValueError, match="有效的 MP4"):
        await videos.upload_video(db_session, "q-test", UploadFile(filename="fake.mp4", file=io.BytesIO(b"not a video")), "讲解")
    assert await db_session.scalar(select(QuestionVideo)) is None
    uploaded = await videos.upload_video(db_session, "q-test", UploadFile(filename="../../lesson.mp4", file=io.BytesIO(valid_mp4)), "首次讲解")
    assert uploaded.status == "draft" and uploaded.duration_seconds == 1
    assert uploaded.filename.startswith("question-video-") and "/" not in uploaded.filename
    assert (videos.MEDIA_DIR / uploaded.filename).read_bytes() == valid_mp4
    assert await videos.approved_videos(db_session, ["q-test"]) == {}
    await videos.set_video_status(db_session, "q-test", "approved")
    assert "q-test" in await videos.approved_videos(db_session, ["q-test"])
    original_id = uploaded.id
    replaced = await videos.upload_video(db_session, "q-test", UploadFile(filename="lesson.mp4", file=io.BytesIO(valid_mp4)), "重新录制")
    assert replaced.id == original_id and replaced.status == "draft"
    assert replaced.title == "重新录制"
    monkeypatch.setattr(videos, "MAX_UPLOAD_BYTES", 20)
    with pytest.raises(ValueError, match="512 MB"):
        await videos.upload_video(db_session, "q-test", UploadFile(filename="lesson.mp4", file=io.BytesIO(valid_mp4)), "超限")
    assert not list(videos.MEDIA_DIR.glob(".upload-*"))
    await db_session.refresh(replaced)
    assert replaced.title == "重新录制"


@pytest.mark.asyncio
async def test_video_admin_routes_require_auth_and_expose_only_safe_metadata(db_session, monkeypatch, tmp_path, valid_mp4):
    monkeypatch.setattr(videos, "MEDIA_DIR", tmp_path / "private")
    db_session.add(question("q-api"))
    await db_session.commit()
    app = FastAPI()
    app.include_router(router)

    async def db_override():
        yield db_session

    app.dependency_overrides[get_db] = db_override
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        denied = await client.post("/api/admin/questions/q-api/video", files={"file": ("lesson.mp4", valid_mp4)})
        assert denied.status_code in (401, 503)
        app.dependency_overrides[verify_admin_token] = lambda: None
        result = await client.post("/api/admin/questions/q-api/video", files={"file": ("lesson.mp4", valid_mp4)}, data={"title": "讲解"})
        assert result.status_code == 200
        assert result.json()["status"] == "draft"
        assert not {"filename", "sha256", "video_url"} & result.json().keys()
        assert (await client.get("/api/admin/questions/paged", params={"has_video": "true"})).json()["total"] == 0
        approved = await client.put("/api/admin/questions/q-api/video/status", json={"status": "approved"})
        assert approved.status_code == 200
        listing = (await client.get("/api/admin/questions/paged", params={"has_video": "true"})).json()
        assert listing["total"] == 1 and listing["items"][0]["has_video"] is True
        assert listing["items"][0]["video"]["status"] == "approved"
        detail = (await client.get("/api/admin/questions/q-api")).json()
        assert detail["has_video"] and detail["video"]["title"] == "讲解"
        preview = (await client.post("/api/admin/questions/q-api/video/preview")).json()
        assert preview["video_url"].startswith("/api/student/question-videos/media?token=")
        invalid = await client.put("/api/admin/questions/q-api/video/status", json={"status": "invalid"})
        assert invalid.status_code == 422
