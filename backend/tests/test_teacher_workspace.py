"""Workspace analysis: real paper positions, recipient scope and released-result boundaries."""
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.models.teacher import TeacherAssignment, TeacherStudentPaper
from app.models.teacher_scan import TeacherSubmission, TeacherSubmissionItem
from tests.test_teacher_accounts import bearer, build_app, client_for, ready_teacher
from tests.test_teacher_assignments import setup_class
from tests.test_teacher_personalized import setup_scope


@pytest.mark.asyncio
async def test_personalized_report_maps_paper_positions_to_actual_questions(db_session):
    await setup_scope(db_session)
    async with client_for(build_app(db_session)) as client:
        token, class_id, (alice, bob) = await setup_class(db_session, client)
        created = await client.post(f'/api/teacher/classes/{class_id}/personalized', headers=bearer(token), json={
            'title': '定向补练', 'scope': [{'kp_id': 'kp_motion'}], 'choice_count': 1, 'area_count': 0,
        })
        assert created.status_code == 201, created.text
        assignment_id = created.json()['id']
        papers = (await db_session.execute(select(TeacherStudentPaper).where(
            TeacherStudentPaper.assignment_id == assignment_id))).scalars().all()
        for paper in papers:
            # Both students have "question 1", but their actual questions and full marks differ.
            paper.items = [{'question_id': 'm_c3' if paper.student_id == alice.id else 'm_c1',
                            'points': 6 if paper.student_id == alice.id else 4, 'box': None, 'rule': 'teacher'}]
            paper.delivery = 'paper'
        await db_session.commit()
        base = f'/api/teacher/assignments/{assignment_id}'
        assert (await client.post(f'{base}/publish', headers=bearer(token))).status_code == 200
        assert (await client.get(f'{base}/report', headers=bearer(token))).status_code == 409
        db_session.add_all([
            TeacherSubmission(id='sub_a', assignment_id=assignment_id, student_id=alice.id, status='recognized', ai_authorized=False, total_score=0),
            TeacherSubmission(id='sub_b', assignment_id=assignment_id, student_id=bob.id, status='recognized', ai_authorized=False, total_score=4),
        ])
        await db_session.flush()
        db_session.add_all([
            TeacherSubmissionItem(submission_id='sub_a', number=1, question_id='m_c3', kind='choice', status='confirmed', answer='', score=0, max_score=6),
            TeacherSubmissionItem(submission_id='sub_b', number=1, question_id='m_c1', kind='choice', status='confirmed', answer='A', score=4, max_score=4),
        ])
        assignment = await db_session.get(TeacherAssignment, assignment_id)
        assignment.results_released_at = datetime.now(timezone.utc)
        await db_session.commit()
        report = (await client.get(f'{base}/report', headers=bearer(token))).json()
        assert report['total_points'] is None and report['average_rate'] == .5
        questions = {q['question_id']: q for q in report['questions']}
        assert questions['m_c3']['kp_id'] == 'kp_motion'
        assert questions['m_c3']['distribution'] == {'未作答': 1}
        students = {s['student_id']: s for s in report['students']}
        a_item, b_item = students[alice.id]['items'][0], students[bob.id]['items'][0]
        assert a_item['number'] == b_item['number'] == 1
        assert a_item['analysis_number'] != b_item['analysis_number']
        assert a_item['analysis_number'] == questions['m_c3']['number']
        assert a_item['score'] == 0 and a_item['max_score'] == 6
        assert students[alice.id]['percent'] == 0 and students[bob.id]['percent'] == 100
        entries = (await client.get(f"{base}/review/{a_item['analysis_number']}", headers=bearer(token))).json()
        assert [e['student_id'] for e in entries] == [alice.id]
        _, other_token = await ready_teacher(client, 'other', '另一老师')
        assert (await client.get(f'{base}/report', headers=bearer(other_token))).status_code == 404
        assert (await client.get(f"{base}/review/{a_item['analysis_number']}", headers=bearer(other_token))).status_code == 404


@pytest.mark.asyncio
async def test_targeted_report_excludes_nonparticipants_and_distinguishes_late(db_session):
    await setup_scope(db_session)
    async with client_for(build_app(db_session)) as client:
        token, class_id, (alice, bob) = await setup_class(db_session, client)
        response = await client.post('/api/teacher/personalized', headers=bearer(token), json={
            'title': '指定学生', 'scope': [{'kp_id': 'kp_motion'}], 'choice_count': 1, 'area_count': 0,
            'class_ids': [class_id], 'student_ids_by_class': {class_id: [alice.id]},
        })
        assignment_id = response.json()['assigned'][0]['id']
        base = f'/api/teacher/assignments/{assignment_id}'
        assert (await client.post(f'{base}/publish', headers=bearer(token))).status_code == 200
        # A stale, inconsistent submission for an excluded classmate cannot affect the cohort.
        db_session.add_all([
            TeacherSubmission(id='late_a', assignment_id=assignment_id, student_id=alice.id, status='manual', ai_authorized=False, total_score=None),
            TeacherSubmission(id='excluded_b', assignment_id=assignment_id, student_id=bob.id, status='manual', ai_authorized=False, total_score=100),
        ])
        assignment = await db_session.get(TeacherAssignment, assignment_id)
        assignment.results_released_at = datetime.now(timezone.utc)
        await db_session.commit()
        report = (await client.get(f'{base}/report', headers=bearer(token))).json()
        assert report['class_size'] == 1 and report['collected'] == 0 and report['late'] == 1
        assert report['highest'] is None
        assert [s['student_id'] for s in report['students']] == [alice.id]
        assert report['students'][0]['late'] is True
