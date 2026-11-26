"""Personalized homework can reach named students without assigning the rest of the class."""
from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select

from app.models.student import Student
from app.models.teacher import TeacherAssignment
from app.models.teacher_paper import TeacherPaperAttempt
from app.services.student_service import StudentService
from app.services.teacher_grading_service import TeacherGradingService
from tests.scan_fixtures import to_pdf
from tests.test_teacher_accounts import bearer, build_app, client_for, ready_teacher
from tests.test_teacher_assignments import setup_class
from tests.test_teacher_library import two_classes
from tests.test_teacher_personalized import setup_scope
from tests.test_teacher_scans import FakeRecognizer, copy_pages, scan_app, upload


def request_for(class_id, student_ids):
    return {"title": "指定学生补练", "scope": [{"volume": "必修一"}], "choice_count": 1, "area_count": 0,
            "class_ids": [class_id], "student_ids_by_class": {class_id: student_ids}}


@pytest.mark.asyncio
async def test_targeted_homework_freezes_only_its_recipients_for_app_collection_and_reports(db_session):
    await setup_scope(db_session)
    async with client_for(build_app(db_session)) as client:
        token, class_id, (alice, bob) = await setup_class(db_session, client)
        alice.last_login_at = bob.last_login_at = datetime.now(timezone.utc)
        await db_session.commit()
        response = await client.post('/api/teacher/personalized', headers=bearer(token), json=request_for(class_id, [alice.id]))
        assert response.status_code == 201, response.text
        assignment_id = response.json()['assigned'][0]['id']
        source_id = response.json()['paper']['id']
        detail = (await client.get(f'/api/teacher/assignments/{assignment_id}', headers=bearer(token))).json()
        assert [paper['student_id'] for paper in detail['papers']] == [alice.id]
        source = await db_session.get(TeacherAssignment, source_id)
        assert 'student_ids' not in source.settings
        forbidden = await client.post(f'/api/teacher/assignments/{assignment_id}/papers/{bob.id}/redraft', headers=bearer(token))
        assert forbidden.status_code == 404
        published = await client.post(f'/api/teacher/assignments/{assignment_id}/publish', headers=bearer(token))
        assert published.status_code == 200, published.text
        attempts = (await db_session.execute(select(TeacherPaperAttempt))).scalars().all()
        assert [attempt.student_id for attempt in attempts] == [alice.id]
        assignment = await db_session.get(TeacherAssignment, assignment_id)
        assert set(assignment.roster) == {alice.id}
        overview = (await client.get(f'/api/teacher/assignments/{assignment_id}/collection', headers=bearer(token))).json()
        assert overview['total'] == 1 and [s['student_id'] for s in overview['students']] == [alice.id]
        newcomer = await StudentService(db_session).create_student('newcomer_s', 'pass123', 'Newcomer')
        await client.post(f'/api/admin/teacher-classes/{class_id}/members', json={'username': newcomer.username, "grantor": "school"})
        detail = (await client.get(f'/api/teacher/assignments/{assignment_id}', headers=bearer(token))).json()
        assert [paper['student_id'] for paper in detail['papers']] == [alice.id]
        assignment.results_released_at = datetime.now(timezone.utc)
        await db_session.commit()
        report = await TeacherGradingService(db_session).report(assignment.teacher_id, assignment_id)
        assert report['class_size'] == 1 and [s['student_id'] for s in report['students']] == [alice.id]
        homework = (await client.get(f'/api/teacher/classes/{class_id}/homework', headers=bearer(token))).json()
        assert homework['assignments'][0]['member_count'] == 1
        assert next(s for s in homework['students'] if s['student_id'] == bob.id)['missing'] == []
        library = (await client.get('/api/teacher/assignments', headers=bearer(token))).json()
        assert library[0]['classes'][0]['member_count'] == 1


@pytest.mark.asyncio
async def test_invalid_recipients_are_rejected_before_creating_any_homework(db_session):
    await setup_scope(db_session)
    async with client_for(build_app(db_session)) as client:
        token, class_3, class_5 = await two_classes(db_session, client)
        carol = await db_session.scalar(select(Student).where(Student.username == 'carol_s'))
        before = await db_session.scalar(select(func.count()).select_from(TeacherAssignment))
        for selected in ([], [carol.id], ['missing-student']):
            response = await client.post('/api/teacher/personalized', headers=bearer(token), json=request_for(class_3, selected))
            assert response.status_code == 400, response.text
        invalid = request_for(class_3, [])
        invalid['student_ids_by_class'] = {class_5: [carol.id]}
        assert (await client.post('/api/teacher/personalized', headers=bearer(token), json=invalid)).status_code == 400
        _, other_token = await ready_teacher(client, 'li', '李老师')
        assert (await client.post('/api/teacher/personalized', headers=bearer(other_token),
                                  json=request_for(class_5, [carol.id]))).status_code == 404
        assert await db_session.scalar(select(func.count()).select_from(TeacherAssignment)) == before


@pytest.mark.asyncio
async def test_reusing_settings_can_choose_a_different_student_or_use_a_whole_class(db_session):
    await setup_scope(db_session)
    async with client_for(build_app(db_session)) as client:
        token, class_3, class_5 = await two_classes(db_session, client)
        students = {s.username: s for s in (await db_session.execute(select(Student))).scalars().all()}
        response = await client.post('/api/teacher/personalized', headers=bearer(token),
                                     json=request_for(class_3, [students['alice_s'].id]))
        source_id = response.json()['paper']['id']
        assigned = await client.post(f'/api/teacher/assignments/{source_id}/assign', headers=bearer(token), json={
            'class_ids': [class_3, class_5], 'student_ids_by_class': {class_3: [students['bob_s'].id]},
        })
        assert assigned.status_code == 200, assigned.text
        expected = {class_3: students['bob_s'].id, class_5: students['carol_s'].id}
        for row in assigned.json()['assigned']:
            detail = (await client.get(f"/api/teacher/assignments/{row['id']}", headers=bearer(token))).json()
            assert [paper['student_id'] for paper in detail['papers']] == [expected[row['class_id']]]


@pytest.mark.asyncio
async def test_scan_for_an_unselected_classmate_is_not_collected_or_manually_assigned(db_session, tmp_path):
    await setup_scope(db_session)
    recognizer = FakeRecognizer(['1'])
    async with client_for(scan_app(db_session, tmp_path, recognizer)) as client:
        token, class_id, (alice, bob) = await setup_class(db_session, client)
        for student, number in ((alice, '1'), (bob, '2')):
            await client.put(f'/api/teacher/classes/{class_id}/members/{student.id}/number',
                             headers=bearer(token), json={'student_number': number})
        response = await client.post('/api/teacher/personalized', headers=bearer(token), json=request_for(class_id, [bob.id]))
        assignment_id = response.json()['assigned'][0]['id']
        assert (await client.post(f'/api/teacher/assignments/{assignment_id}/publish', headers=bearer(token))).status_code == 200
        await upload(client, token, assignment_id, to_pdf(copy_pages('1', 1)))
        overview = (await client.get(f'/api/teacher/assignments/{assignment_id}/collection', headers=bearer(token))).json()
        assert overview['collected'] == 0 and overview['total'] == 1
        exception = next(e for e in overview['exceptions'] if e['kind'] == 'first')
        assert exception['issue'] == 'unknown_number'
        assigned = await client.post(f"/api/teacher/scan-pages/{exception['page_id']}/assign", headers=bearer(token),
                                     json={'student_id': alice.id})
        assert assigned.status_code == 400
