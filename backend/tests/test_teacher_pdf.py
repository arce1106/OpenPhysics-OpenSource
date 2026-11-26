"""PDF download authorization, print eligibility and isolated renderer boundaries."""
from unittest.mock import AsyncMock

import pytest

from app.services.teacher_pdf_service import allowed_asset
from app.services.question_service import QuestionService
from app.models.teacher import TeacherAssignment
from tests.test_teacher_accounts import bearer, build_app, client_for, ready_teacher
from tests.test_teacher_assignments import setup_bank
from tests.test_teacher_library import two_classes
from tests.test_teacher_personalized import setup_scope


def test_renderer_only_fetches_own_origin_assets_and_never_calls_apis():
    origin = "http://teacher-frontend:5176/"
    assert allowed_asset(origin + "assets/paper.js", origin, "GET")
    assert allowed_asset(origin + "static/questions/1.png", origin, "GET")
    for url, method in (("http://127.0.0.1/", "GET"), ("file:///etc/passwd", "GET"),
                        (origin + "api/teacher/me", "GET"), (origin, "POST"),
                        ("https://example.org/1.png", "GET")):
        assert not allowed_asset(url, origin, method)


@pytest.mark.asyncio
async def test_download_is_an_authenticated_attachment_and_cannot_export_another_teachers_paper(db_session, monkeypatch):
    await setup_bank(db_session)
    render = AsyncMock(return_value=b"%PDF-1.7\nfixture")
    monkeypatch.setattr("app.api.teacher.router.render_pdf", render)
    async with client_for(build_app(db_session)) as client:
        token, class_3, _ = await two_classes(db_session, client)
        _, other = await ready_teacher(client, "li", "李老师")
        paper = (await client.post("/api/teacher/assignments", headers=bearer(token), json={"title": "运动学测验"})).json()
        url = f"/api/teacher/assignments/{paper['id']}/pdf"
        assert (await client.get(url)).status_code == 401
        assert (await client.get(url, headers=bearer(other))).status_code == 404
        assert (await client.get(url, headers=bearer(token))).status_code == 409
        assert render.await_count == 0
        await client.put(f"/api/teacher/assignments/{paper['id']}", headers=bearer(token),
                         json={"items": [{"question_id": "q_c1"}, {"question_id": "q_p1"}]})
        await client.post(f"/api/teacher/assignments/{paper['id']}/save", headers=bearer(token))
        roster = (await client.get(f"/api/teacher/classes/{class_3}", headers=bearer(token))).json()
        numbered = await client.put(f"/api/teacher/classes/{class_3}/members/{roster['members'][0]['id']}/number",
                                    headers=bearer(token), json={"student_number": "1234"})
        assert numbered.status_code == 200
        response = await client.get(url, headers=bearer(token))
        assert response.status_code == 200
        assert response.content.startswith(b"%PDF-")
        assert response.headers["content-type"] == "application/pdf"
        assert response.headers["content-disposition"].startswith("attachment;")
        assert "filename*=UTF-8''" in response.headers["content-disposition"]
        assert response.headers["cache-control"] == "no-store"
        snapshot = render.call_args.args[0]
        assert snapshot['edition'] == 'student'
        assert snapshot["numberBoxes"] == 4
        assert [item["question_id"] for item in snapshot["detail"]["items"]] == ["q_c1", "q_p1"]


@pytest.mark.asyncio
async def test_personalized_pdf_only_contains_paper_delivery_students(db_session, monkeypatch):
    await setup_scope(db_session)
    render = AsyncMock(return_value=b"%PDF-1.7\nfixture")
    monkeypatch.setattr("app.api.teacher.router.render_pdf", render)
    async with client_for(build_app(db_session)) as client:
        token, class_3, _ = await two_classes(db_session, client)
        created = await client.post("/api/teacher/personalized", headers=bearer(token), json={
            "title": "个性化下载", "class_ids": [class_3], "scope": [{"volume": "必修一"}],
            "choice_count": 2, "area_count": 1,
        })
        assert created.status_code == 201, created.text
        assignment = created.json()["assigned"][0]["id"]
        detail = (await client.get(f"/api/teacher/assignments/{assignment}", headers=bearer(token))).json()
        student_id = detail["papers"][0]["student_id"]
        changed = await client.put(f"/api/teacher/assignments/{assignment}/papers/{student_id}",
                                   headers=bearer(token), json={"delivery": "app"})
        assert changed.status_code == 200
        response = await client.get(f"/api/teacher/assignments/{assignment}/pdf", headers=bearer(token))
        assert response.status_code == 200
        papers = render.call_args.args[0]["detail"]["papers"]
        assert len([paper for paper in papers if paper["delivery"] == "paper"]) == 1
        # Once everyone uses the App, "App" leaves nobody to print for.
        from datetime import datetime, timezone
        from sqlalchemy import update
        from app.models.student import Student
        await db_session.execute(update(Student).values(last_login_at=datetime.now(timezone.utc)))
        await db_session.commit()
        await client.put(f"/api/teacher/assignments/{assignment}/papers/delivery",
                         headers=bearer(token), json={"delivery": "app"})
        assert (await client.get(f"/api/teacher/assignments/{assignment}/pdf", headers=bearer(token))).status_code == 409
        assert render.await_count == 1


@pytest.mark.asyncio
async def test_teacher_edition_uses_frozen_explanation_and_is_scoped_to_the_teacher(db_session, monkeypatch):
    await setup_bank(db_session)
    original = '根据速度定义，$v=\\frac{x}{t}$。'
    await QuestionService(db_session).update_question('q_c1', {'explanation': original})
    render = AsyncMock(return_value=b'%PDF-1.7\nfixture')
    monkeypatch.setattr('app.api.teacher.router.render_pdf', render)
    async with client_for(build_app(db_session)) as client:
        token, class_id, _ = await two_classes(db_session, client)
        teacher = bearer(token)
        _, other = await ready_teacher(client, 'li', '李老师')
        source_id = (await client.post('/api/teacher/assignments', headers=teacher, json={'title': '含解析试卷'})).json()['id']
        await client.put(f'/api/teacher/assignments/{source_id}', headers=teacher, json={'items': [{'question_id': 'q_c1'}]})
        await client.post(f'/api/teacher/assignments/{source_id}/save', headers=teacher)
        source = await db_session.get(TeacherAssignment, source_id)
        assert source.question_snapshot[0]['explanation'] == original
        # Previous saved papers kept the original explanation in their App snapshot.
        source.question_snapshot = [{key: value for key, value in q.items() if key != 'explanation'} for q in source.question_snapshot]
        await db_session.commit()
        await QuestionService(db_session).update_question('q_c1', {'explanation': '题库里后改的解析'})
        detail = (await client.get(f'/api/teacher/assignments/{source_id}', headers=teacher)).json()
        assert detail['items'][0]['question']['explanation'] == original
        url = f'/api/teacher/assignments/{source_id}/pdf?edition=teacher'
        assert (await client.get(url)).status_code == 401
        assert (await client.get(url, headers=bearer(other))).status_code == 404
        assert (await client.get(f'/api/teacher/assignments/{source_id}/pdf?edition=other', headers=teacher)).status_code == 422
        response = await client.get(url, headers=teacher)
        assert response.status_code == 200
        assert render.call_args.args[0]['edition'] == 'teacher'
        assert render.call_args.args[0]['detail']['items'][0]['question']['explanation'] == original
        assert '%E6%95%99%E5%B8%88%E7%89%88' in response.headers['content-disposition']
        # App first: these students never signed in, so they get it on paper and the printout stays available.
        assigned = await client.post(f'/api/teacher/assignments/{source_id}/assign', headers=teacher,
                                     json={'class_ids': [class_id], 'delivery': 'app'})
        assignment_id = assigned.json()['assigned'][0]['id']
        base = f'/api/teacher/assignments/{assignment_id}/pdf'
        assert (await client.get(base, headers=teacher)).status_code == 200
        assert (await client.get(base + '?edition=teacher', headers=teacher)).status_code == 200


@pytest.mark.asyncio
async def test_missing_historical_explanation_does_not_read_a_new_bank_explanation(db_session):
    await setup_bank(db_session)
    async with client_for(build_app(db_session)) as client:
        token, _, _ = await two_classes(db_session, client)
        teacher = bearer(token)
        source_id = (await client.post('/api/teacher/assignments', headers=teacher, json={'title': '旧试卷'})).json()['id']
        await client.put(f'/api/teacher/assignments/{source_id}', headers=teacher, json={'items': [{'question_id': 'q_c1'}]})
        await client.post(f'/api/teacher/assignments/{source_id}/save', headers=teacher)
        source = await db_session.get(TeacherAssignment, source_id)
        source.question_snapshot = [{key: value for key, value in q.items() if key not in {'explanation', '_app_snapshot'}} for q in source.question_snapshot]
        await db_session.commit()
        await QuestionService(db_session).update_question('q_c1', {'explanation': '后来的解析'})
        detail = (await client.get(f'/api/teacher/assignments/{source_id}', headers=teacher)).json()
        assert detail['items'][0]['question']['explanation'] is None
