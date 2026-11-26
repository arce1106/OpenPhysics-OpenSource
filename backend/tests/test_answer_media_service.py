from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient

from app.main import create_app
from app.services.answer_media_service import AnswerMediaService
from app.services.answer_media_service import answer_media_service


def test_answer_media_service_replaces_owned_static_path_with_signed_url(tmp_path):
    answer_dir = tmp_path / "uploads" / "answers" / "student-1"
    answer_dir.mkdir(parents=True)
    image = answer_dir / "answer.png"
    image.write_bytes(b"png")
    service = AnswerMediaService(secret="test-secret", static_dir=tmp_path, ttl_seconds=60)

    url = service.create_url("student-1", "/static/uploads/answers/student-1/answer.png", now=100)
    parsed = urlparse(url)
    query = parse_qs(parsed.query)

    assert parsed.path == "/api/student/answer-images/student-1/answer.png"
    assert query["expires"] == ["160"]
    assert service.resolve(
        "student-1",
        "answer.png",
        int(query["expires"][0]),
        query["signature"][0],
        now=100,
    ) == image


def test_answer_media_service_does_not_sign_another_students_path(tmp_path):
    service = AnswerMediaService(secret="test-secret", static_dir=tmp_path)

    path = "/static/uploads/answers/student-2/answer.png"

    assert service.create_url("student-1", path, now=100) == path


def test_answer_media_service_rejects_expired_or_tampered_urls(tmp_path):
    answer_dir = tmp_path / "uploads" / "answers" / "student-1"
    answer_dir.mkdir(parents=True)
    (answer_dir / "answer.png").write_bytes(b"png")
    service = AnswerMediaService(secret="test-secret", static_dir=tmp_path, ttl_seconds=60)
    parsed = urlparse(service.create_url(
        "student-1",
        "/static/uploads/answers/student-1/answer.png",
        now=100,
    ))
    query = parse_qs(parsed.query)

    assert service.resolve(
        "student-1", "answer.png", 160, query["signature"][0], now=161
    ) is None
    assert service.resolve(
        "student-1", "answer.png", 160, "tampered", now=100
    ) is None


def test_answer_media_service_secures_nested_grading_image_fields(tmp_path):
    service = AnswerMediaService(secret="test-secret", static_dir=tmp_path, ttl_seconds=60)

    result = service.secure_payload("student-1", {
        "process_grading": {
            "answer_image_path": "/static/uploads/answers/student-1/answer.png",
            "answer_image_paths": ["/static/uploads/answers/student-1/page.png"],
        },
    })

    assert result["process_grading"]["answer_image_path"].startswith(
        "/api/student/answer-images/student-1/answer.png?"
    )
    assert result["process_grading"]["answer_image_paths"][0].startswith(
        "/api/student/answer-images/student-1/page.png?"
    )


def test_signed_answer_image_route_serves_file_and_old_static_route_is_closed(tmp_path, monkeypatch):
    answer_dir = tmp_path / "uploads" / "answers" / "student-1"
    answer_dir.mkdir(parents=True)
    (answer_dir / "answer.png").write_bytes(b"private-answer")
    monkeypatch.setattr(answer_media_service, "static_dir", tmp_path)
    monkeypatch.setattr(answer_media_service, "secret", b"test-secret")
    signed_url = answer_media_service.create_url(
        "student-1",
        "/static/uploads/answers/student-1/answer.png",
    )
    client = TestClient(create_app())

    signed_response = client.get(signed_url)
    old_static_response = client.get("/static/uploads/answers/student-1/answer.png")

    assert signed_response.status_code == 200
    assert signed_response.content == b"private-answer"
    assert signed_response.headers["cache-control"].startswith("private")
    assert old_static_response.status_code == 404
