from urllib.parse import parse_qs, urlparse

import pytest

import app.services.student_service as student_module
from app.services.answer_media_service import AnswerMediaService
from app.services.student_service import StudentService


@pytest.mark.asyncio
async def test_default_account_reset_removes_real_media_and_invalidates_old_url(db_session, tmp_path, monkeypatch):
    media = AnswerMediaService(static_dir=tmp_path / "static", secret="synthetic-media-secret")
    monkeypatch.setattr(student_module, "AnswerMediaService", lambda: media)
    service = StudentService(db_session)
    student = await service.create_student("cleanup-target", "synthetic-password", "Synthetic")
    other = await service.create_student("cleanup-preserve", "synthetic-password", "Synthetic")
    target = media.static_dir / "uploads" / "answers" / student.id / "synthetic.jpg"
    preserved = media.static_dir / "uploads" / "answers" / other.id / "synthetic.jpg"
    for path in (target, preserved):
        path.parent.mkdir(parents=True)
        path.write_bytes(b"synthetic-image")
    url = media.create_url(student.id, f"/static/uploads/answers/{student.id}/synthetic.jpg", now=100)
    query = parse_qs(urlparse(url).query)
    resolve = lambda: media.resolve(student.id, "synthetic.jpg", int(query["expires"][0]), query["signature"][0], now=101)
    assert resolve() == target
    assert await service.reset_student_account(student.id) is not None
    assert not target.exists()
    assert preserved.read_bytes() == b"synthetic-image"
    assert resolve() is None
    assert await service.get_student(other.id) is not None
