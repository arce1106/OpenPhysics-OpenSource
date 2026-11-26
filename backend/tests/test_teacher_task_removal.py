"""Whole-card removal retains learning evidence and stops active homework."""
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.api.student.router import router as student_router
from app.models.teacher import TeacherAssignment
from app.models.teacher_paper import TeacherPaperAttempt
from app.models.teacher_scan import TeacherScanBatch, TeacherSubmission
from app.services.student_service import StudentService
from app.services.teacher_paper_service import validate_submission
from fastapi import HTTPException
from tests.test_teacher_accounts import bearer, build_app, client_for, ready_teacher
from tests.test_teacher_assignments import setup_bank
from tests.test_teacher_library import two_classes


async def assigned_test(client, teacher, class_ids, *, delivery='paper'):
    source = (await client.post('/api/teacher/assignments', headers=teacher, json={'title': '删除范围测试'})).json()['id']
    url = f'/api/teacher/assignments/{source}'
    await client.put(url, headers=teacher, json={'items': [{'question_id': 'q_c1'}]})
    copies = (await client.post(url + '/assign', headers=teacher,
                               json={'class_ids': class_ids, 'delivery': delivery})).json()['assigned']
    return source, copies


@pytest.mark.asyncio
async def test_removing_source_hides_whole_card_and_retains_released_scores(db_session):
    await setup_bank(db_session)
    async with client_for(build_app(db_session)) as client:
        token, first, second = await two_classes(db_session, client)
        teacher = bearer(token)
        source, copies = await assigned_test(client, teacher, [first, second])
        row_id = next(row['id'] for row in copies if row['class_id'] == first)
        member = (await client.get(f'/api/teacher/classes/{first}', headers=teacher)).json()['members'][0]['id']
        row = await db_session.get(TeacherAssignment, row_id)
        row.results_released_at = datetime.now(timezone.utc)
        db_session.add(TeacherSubmission(id='keep_score', assignment_id=row_id, student_id=member,
                                         status='graded', ai_authorized=False, total_score=4))
        await db_session.commit()
        url = f'/api/teacher/assignments/{source}'
        _, other = await ready_teacher(client, 'other', '另一位老师')
        assert (await client.delete(url + '?scope=task', headers=bearer(other))).status_code == 404
        assert len((await client.get('/api/teacher/assignments', headers=teacher)).json()) == 1
        assert (await client.delete(url + '?scope=task', headers=teacher)).status_code == 204
        assert (await client.delete(url + '?scope=task', headers=teacher)).status_code == 204
        assert (await client.get('/api/teacher/assignments', headers=teacher)).json() == []
        for key in [source, *(copy['id'] for copy in copies)]:
            kept = (await client.get(f'/api/teacher/assignments/{key}', headers=teacher)).json()
            assert kept['removed_at']
        history = (await client.get(f'/api/teacher/classes/{first}/homework', headers=teacher)).json()
        assert history['assignments'][0]['average'] == 4
        assert any(student['scores'].get(row_id) == {'score': 4, 'full': 4} for student in history['students'])
        assert (await client.get(f'/api/teacher/classes/{second}/homework', headers=teacher)).json()['assignments'] == []
        stats = (await client.get(f'/api/teacher/classes/{second}/dashboard', headers=teacher)).json()['statistics']
        assert all(student['homework_expected'] == 0 for student in stats['students'])
        assert await db_session.get(TeacherSubmission, 'keep_score') is not None
        assert (await client.post(url + '/assign', headers=teacher, json={'class_ids': [second]})).status_code == 409
        assert (await client.post(f'/api/teacher/assignments/{row_id}/grading', headers=teacher)).status_code == 409


@pytest.mark.asyncio
async def test_orphan_class_removal_preserves_scans_and_other_work(db_session):
    await setup_bank(db_session)
    async with client_for(build_app(db_session)) as client:
        token, first, second = await two_classes(db_session, client)
        teacher = bearer(token)
        source, copies = await assigned_test(client, teacher, [first, second])
        # Backward-compatible source-only DELETE reproduces the old orphan card.
        await client.delete(f'/api/teacher/assignments/{source}', headers=teacher)
        removed, kept = copies
        db_session.add(TeacherScanBatch(id='keep_scan', assignment_id=removed['id'], teacher_id=(await db_session.get(TeacherAssignment, removed['id'])).teacher_id,
                                       filename='unmatched.pdf', sha256='x', status='failed'))
        await db_session.commit()
        assert (await client.delete(f"/api/teacher/assignments/{removed['id']}?scope=task", headers=teacher)).status_code == 204
        library = (await client.get('/api/teacher/assignments', headers=teacher)).json()
        assert [row['id'] for row in library] == [kept['id']]
        assert await db_session.get(TeacherScanBatch, 'keep_scan') is not None
        upload = await client.post(f"/api/teacher/assignments/{removed['id']}/scans", headers=teacher,
                                   files={'file': ('scan.pdf', b'%PDF-test', 'application/pdf')})
        assert upload.status_code == 409


@pytest.mark.asyncio
async def test_removed_app_work_disappears_and_stale_submit_is_rejected(db_session):
    await setup_bank(db_session)
    app = build_app(db_session)
    app.include_router(student_router)
    async with client_for(app) as client:
        token, first, _ = await two_classes(db_session, client)
        teacher = bearer(token)
        from sqlalchemy import update
        from app.models.student import Student
        await db_session.execute(update(Student).values(last_login_at=datetime.now(timezone.utc)))  # App users
        await db_session.commit()
        source, copies = await assigned_test(client, teacher, [first], delivery='app')
        attempt = (await db_session.scalars(select(TeacherPaperAttempt))).first()
        student = await StudentService(db_session).get_student(attempt.student_id)
        auth = bearer(StudentService.create_access_token(student.id, student.auth_version))
        assert len((await client.get('/api/student/teacher-homework', headers=auth)).json()) == 1
        assert (await client.delete(f'/api/teacher/assignments/{source}?scope=task', headers=teacher)).status_code == 204
        assert (await client.get('/api/student/teacher-homework', headers=auth)).json() == []
        assert (await client.post(f'/api/student/teacher-homework/{attempt.id}/session', headers=auth)).status_code == 404
        assert (await client.post(f'/api/student/teacher-paper-attempts/{attempt.id}/submit', headers=auth)).status_code == 409
        with pytest.raises(HTTPException) as error:
            await validate_submission(db_session, student.id, attempt.id, 'q_c1')
        assert error.value.status_code == 409
        assert await db_session.get(TeacherPaperAttempt, attempt.id) is not None
