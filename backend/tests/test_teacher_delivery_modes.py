"""A teacher chooses printing or App first; App first still prints for students who never signed in."""
from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select

from app.api.student.router import router as student_router
from app.models.student import StudentAnswer
from app.models.teacher import TeacherAssignment
from app.models.teacher_paper import TeacherPaperAttempt
from app.models.teacher_scan import TeacherSubmission
from app.services.question_service import QuestionService
from app.services.student_service import StudentService
from tests.test_teacher_accounts import bearer, build_app, client_for, ready_teacher
from tests.test_teacher_assignments import setup_bank, setup_class
from tests.test_teacher_personalized import setup_scope


@pytest.mark.asyncio
async def test_whole_class_receives_frozen_app_work_and_submits_once(db_session):
    await setup_bank(db_session)
    app = build_app(db_session)
    app.include_router(student_router)
    async with client_for(app) as client:
        token, class_id, (bob,) = await setup_class(db_session, client, members=('bob_s',))
        bob.last_login_at = datetime.now(timezone.utc)  # uses the App, so the whole class answers there
        await db_session.commit()
        alice = await StudentService(db_session).create_student('alice_other', 'pass123', 'Alice')
        teacher = bearer(token)
        paper_id = (await client.post('/api/teacher/assignments', headers=teacher,
                                      json={'title': 'App 单元测验'})).json()['id']
        await client.put(f'/api/teacher/assignments/{paper_id}', headers=teacher,
                         json={'items': [{'question_id': 'q_c1'}]})
        saved = await client.post(f'/api/teacher/assignments/{paper_id}/save', headers=teacher)
        original_stem = saved.json()['items'][0]['question']['stem_text']
        # Saving fixes both the displayed question and its answer, before assignment.
        await QuestionService(db_session).update_question('q_c1', {'stem_text': '改后的题干', 'answer': 'B'})
        response = await client.post(f'/api/teacher/assignments/{paper_id}/assign', headers=teacher, json={
            'class_ids': [class_id], 'delivery': 'app',
        })
        assert response.status_code == 200, response.text
        assignment_id = response.json()['assigned'][0]['id']
        assignment = await db_session.get(TeacherAssignment, assignment_id)
        assert assignment.settings == {'delivery': 'app'}
        assert set(assignment.roster) == {bob.id}
        assert (await client.get(f'/api/teacher/assignments/{assignment_id}/pdf', headers=teacher)).status_code == 409
        refused = await client.post(f'/api/teacher/assignments/{assignment_id}/scans', headers=teacher,
                                    files={'file': ('scan.pdf', b'%PDF-1.4 x', 'application/pdf')})
        assert refused.status_code == 409 and 'App' in refused.json()['detail']
        attempts = (await db_session.scalars(select(TeacherPaperAttempt))).all()
        assert len(attempts) == 1 and attempts[0].student_id == bob.id
        student = bearer(StudentService.create_access_token(bob.id, bob.auth_version))
        other_student = bearer(StudentService.create_access_token(alice.id, alice.auth_version))
        assert (await client.get('/api/student/teacher-homework', headers=other_student)).json() == []
        attempt_id = attempts[0].id
        assert (await client.post(f'/api/student/teacher-homework/{attempt_id}/session', headers=other_student)).status_code == 404
        session = (await client.post(f'/api/student/teacher-homework/{attempt_id}/session', headers=student)).json()
        question = session['questions'][0]
        assert question['stem_text'] == original_stem
        assert not any(key.startswith('_') or key == 'answer' for key in question)
        await client.post(f'/api/student/teacher-paper-attempts/{attempt_id}/submit', headers=student)
        graded = await client.post('/api/student/practice/submit', headers=student, json={
            'question_id': 'q_c1', 'given_answer': 'A', 'teacher_paper_attempt_id': attempt_id,
        })
        assert graded.status_code == 200, graded.text
        answer = await db_session.scalar(select(StudentAnswer).where(StudentAnswer.teacher_paper_attempt_id == attempt_id))
        assert answer.is_correct  # Grades against A on the saved paper, not B in the bank.
        # Finishing in the App hands the work in at once, before the teacher opens any page.
        handed = (await db_session.scalars(select(TeacherSubmission))).all()
        assert [(h.student_id, h.source) for h in handed] == [(bob.id, 'app')]
        for _ in range(2):
            detail = (await client.get(f'/api/teacher/assignments/{assignment_id}', headers=teacher)).json()
            collection = (await client.get(f'/api/teacher/assignments/{assignment_id}/collection', headers=teacher)).json()
            assert detail['collected'] == collection['collected'] == 1
            assert collection['total'] == 1 and collection['students'][0]['student_id'] == bob.id
            assert collection['students'][0]['submission']['source'] == 'app'
        assert await db_session.scalar(select(func.count()).select_from(TeacherSubmission)) == 1
        _, other_token = await ready_teacher(client, 'li', '李老师')
        assert (await client.get(f'/api/teacher/assignments/{assignment_id}', headers=bearer(other_token))).status_code == 404


@pytest.mark.asyncio
async def test_paper_test_includes_the_whole_class_and_refuses_individual_selection(db_session):
    await setup_bank(db_session)
    async with client_for(build_app(db_session)) as client:
        token, class_id, (alice, bob) = await setup_class(db_session, client)
        teacher = bearer(token)
        paper_id = (await client.post('/api/teacher/assignments', headers=teacher, json={'title': '打印测验'})).json()['id']
        await client.put(f'/api/teacher/assignments/{paper_id}', headers=teacher, json={'items': [{'question_id': 'q_c1'}]})
        for selected in ([], ['unknown-student'], [alice.id]):
            invalid = await client.post(f'/api/teacher/assignments/{paper_id}/assign', headers=teacher, json={
                'class_ids': [class_id], 'student_ids_by_class': {class_id: selected}, 'delivery': 'paper',
            })
            assert invalid.status_code == 400
        invalid = await client.post(f'/api/teacher/assignments/{paper_id}/assign', headers=teacher,
                                    json={'class_ids': [class_id], 'delivery': 'both'})
        assert invalid.status_code == 422
        response = await client.post(f'/api/teacher/assignments/{paper_id}/assign', headers=teacher, json={
            'class_ids': [class_id], 'delivery': 'paper',
        })
        assert response.status_code == 200, response.text
        assignment_id = response.json()['assigned'][0]['id']
        collection = (await client.get(f'/api/teacher/assignments/{assignment_id}/collection', headers=teacher)).json()
        assert collection['total'] == 2 and {s['student_id'] for s in collection['students']} == {alice.id, bob.id}
        assert await db_session.scalar(select(func.count()).select_from(TeacherPaperAttempt)) == 0


@pytest.mark.asyncio
async def test_app_test_prints_for_students_who_never_signed_in(db_session, monkeypatch):
    from unittest.mock import AsyncMock
    monkeypatch.setattr('app.api.teacher.router.render_pdf', AsyncMock(return_value=b'%PDF-1.7\nfixture'))
    await setup_bank(db_session)
    async with client_for(build_app(db_session)) as client:
        token, class_id, (alice, bob) = await setup_class(db_session, client)
        alice.last_login_at = datetime.now(timezone.utc)
        await db_session.commit()
        teacher = bearer(token)
        paper_id = (await client.post('/api/teacher/assignments', headers=teacher, json={'title': 'App 优先'})).json()['id']
        await client.put(f'/api/teacher/assignments/{paper_id}', headers=teacher, json={'items': [{'question_id': 'q_c1'}]})
        await client.post(f'/api/teacher/assignments/{paper_id}/save', headers=teacher)
        response = await client.post(f'/api/teacher/assignments/{paper_id}/assign', headers=teacher,
                                     json={'class_ids': [class_id], 'delivery': 'app'})
        assignment_id = response.json()['assigned'][0]['id']
        detail = (await client.get(f'/api/teacher/assignments/{assignment_id}', headers=teacher)).json()
        assert {p['display_name']: p['delivery'] for p in detail['papers']} == {'Alice': 'app', 'Bob': 'paper'}
        attempts = (await db_session.scalars(select(TeacherPaperAttempt))).all()
        assert [a.student_id for a in attempts] == [alice.id]
        # Bob's copy is printed, scanned and collected like any paper homework.
        assert (await client.get(f'/api/teacher/assignments/{assignment_id}/pdf', headers=teacher)).status_code == 200
        from app.services.teacher_homework_service import has_paper_students
        assert await has_paper_students(db_session, await db_session.get(TeacherAssignment, assignment_id))
        # Before releasing, the teacher sees who has not handed in and who is still answering in the App.
        turn_in = (await client.get(f'/api/teacher/assignments/{assignment_id}/review', headers=teacher)).json()['turn_in']
        assert turn_in == {'expected': 2, 'collected': 0, 'missing': 2, 'app_working': 1, 'app_grading': 0}


@pytest.mark.asyncio
@pytest.mark.parametrize('delivery', ['app', 'paper'])
async def test_personalized_mode_applies_to_every_student_and_survives_redraft(db_session, delivery):
    await setup_scope(db_session)
    async with client_for(build_app(db_session)) as client:
        token, class_id, (alice, bob) = await setup_class(db_session, client)
        alice.last_login_at = datetime.now(timezone.utc)
        await db_session.commit()
        teacher = bearer(token)
        response = await client.post('/api/teacher/personalized', headers=teacher, json={
            'title': '统一交付作业', 'scope': [{'volume': '必修一'}], 'choice_count': 1, 'area_count': 0,
            'class_ids': [class_id], 'delivery': delivery,
        })
        assert response.status_code == 201, response.text
        assignment_id = response.json()['assigned'][0]['id']
        # App first: Alice signs in, Bob never has and gets paper. Printing is everyone on paper.
        app_first = {'Alice': 'app', 'Bob': 'paper'}
        on_paper = {'Alice': 'paper', 'Bob': 'paper'}
        expected = app_first if delivery == 'app' else on_paper
        detail = (await client.get(f'/api/teacher/assignments/{assignment_id}', headers=teacher)).json()
        assert {p['display_name']: p['delivery'] for p in detail['papers']} == expected
        assert detail['settings']['delivery'] == delivery
        redraft = await client.post(f'/api/teacher/assignments/{assignment_id}/papers/{bob.id}/redraft', headers=teacher)
        assert redraft.status_code == 200
        assert {p['display_name']: p['delivery'] for p in redraft.json()['papers']} == expected
        single = await client.put(f'/api/teacher/assignments/{assignment_id}/papers/{alice.id}', headers=teacher,
                                  json={'delivery': 'app'})
        # Printing is for everyone; App first lets the teacher move one student either way.
        assert single.status_code == (200 if delivery == 'app' else 400)
        opposite = 'app' if delivery == 'paper' else 'paper'
        changed = await client.put(f'/api/teacher/assignments/{assignment_id}/papers/delivery', headers=teacher,
                                   json={'delivery': opposite})
        assert changed.status_code == 200
        assert {p['display_name']: p['delivery'] for p in changed.json()['papers']} == (app_first if opposite == 'app' else on_paper)
        assert changed.json()['settings']['delivery'] == opposite
        published = await client.post(f'/api/teacher/assignments/{assignment_id}/publish', headers=teacher)
        assert published.status_code == 200, published.text
        assert await db_session.scalar(select(func.count()).select_from(TeacherPaperAttempt)) == (1 if opposite == 'app' else 0)
