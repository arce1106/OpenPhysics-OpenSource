"""Class statistics distinguish practice, assigned cohorts and released scores, without writes."""
from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select

from app.models.question import QuestionLabel
from app.models.student import StudentAnswer, StudentMastery
from app.models.teacher import TeacherAssignment
from app.models.teacher_paper import TeacherPaperAttempt
from app.models.teacher_scan import TeacherSubmission, TeacherSubmissionItem
from app.services.student_service import StudentService
from tests.test_teacher_accounts import bearer, build_app, client_for, ready_teacher
from tests.test_teacher_assignments import draft_with, setup_class
from tests.test_teacher_personalized import setup_scope


@pytest.mark.asyncio
async def test_statistics_keep_practice_and_homework_separate_and_missing_is_not_zero(db_session):
    await setup_scope(db_session)
    async with client_for(build_app(db_session)) as client:
        token, class_id, (alice, bob) = await setup_class(db_session, client)
        aid, _ = await draft_with(client, token, class_id, [{'question_id': 'm_c1', 'points': 4}])
        assert (await client.post(f'/api/teacher/assignments/{aid}/publish', headers=bearer(token))).status_code == 200
        newcomer = await StudentService(db_session).create_student('new_s', 'pass123', 'New')
        await client.post(f'/api/admin/teacher-classes/{class_id}/members', json={'username': newcomer.username, "grantor": "school"})
        db_session.add_all([
            QuestionLabel(question_id='m_c1', label_type='knowledge_point', label_id='kp_fall', role='次要'),
            StudentAnswer(student_id=alice.id, question_id='m_c1', given_answer='A', is_correct=True),
            StudentAnswer(student_id=alice.id, question_id='m_c2', given_answer='B', is_correct=False),
            StudentAnswer(student_id=alice.id, question_id='m_c3', given_answer='B', is_correct=False,
                          grading_result={'_pending_confirmation': True}),
            StudentMastery(student_id=bob.id, knowledge_point_id='kp_motion', mastery=0, attempts=0),
            TeacherSubmission(id='s_zero', assignment_id=aid, student_id=alice.id, status='recognized', ai_authorized=False, total_score=0),
            TeacherPaperAttempt(id='app_duplicate', student_id=alice.id, paper_id='app_paper', catalog_code='teacher_homework',
                                node_id=aid, title='App作业', question_ids=['m_c1'], questions=[], status='completed',
                                completed_at=datetime.now(timezone.utc)),
        ])
        await db_session.flush()
        db_session.add_all([
            StudentAnswer(student_id=alice.id, question_id='m_c1', given_answer='A', is_correct=True, teacher_paper_attempt_id='app_duplicate'),
            TeacherSubmissionItem(submission_id='s_zero', number=1, question_id='m_c1', kind='choice', status='confirmed', score=0, max_score=4),
        ])
        assignment = await db_session.get(TeacherAssignment, aid)
        assignment.results_released_at = datetime.now(timezone.utc)
        await db_session.commit()
        before = await db_session.scalar(select(func.count()).select_from(TeacherSubmission))
        response = await client.get(f'/api/teacher/classes/{class_id}/dashboard', headers=bearer(token))
        assert response.status_code == 200, response.text
        stats = response.json()['statistics']
        students = {s['student_id']: s for s in stats['students']}
        assert students[alice.id]['practice_count'] == 3
        assert students[alice.id]['practice_graded'] == 2
        assert students[alice.id]['practice_correct_rate'] == .5
        assert students[alice.id]['homework_expected'] == 1
        assert students[alice.id]['homework_submitted'] == 1  # App and scan/import do not double count.
        assert students[alice.id]['homework_rate'] == 0
        assert students[bob.id]['practice_correct_rate'] is None and students[bob.id]['mastery'] is None
        assert students[bob.id]['homework_expected'] == 1 and students[bob.id]['homework_submitted'] == 0
        assert students[bob.id]['homework_rate'] is None
        assert students[newcomer.id]['homework_expected'] == 0
        assert stats['summary'] == {'data_students': 1, 'practice_count': 3, 'released_assignments': 1,
                                    'active_students': 1, 'recent_practice_count': 3, 'recent_days': 7}
        # One performance figure: practice 1 + 0 and the released item 0 / 4, over three questions.
        assert (students[alice.id]['evidence'], students[alice.id]['score']) == (3, round(1 / 3, 4))
        assert students[alice.id]['level'] == 'weak' and students[alice.id]['weak_points'][0]['kp_id'] == 'kp_motion'
        assert [r['code'] for r in students[alice.id]['attention']] == ['weak']
        # Bob missed the released homework and has never studied since joining.
        assert [r['code'] for r in students[bob.id]['attention']] == ['inactive', 'missed']
        assert students[bob.id]['level'] == 'insufficient' and students[bob.id]['score'] is None
        point = next(p for p in stats['knowledge_points'] if p['kp_id'] == 'kp_motion')
        assert point['student_count'] == 1 and point['practice_correct_rate'] == .5 and point['homework_rate'] == 0
        assert await db_session.scalar(select(func.count()).select_from(TeacherSubmission)) == before
        records = (await client.get(f'/api/teacher/classes/{class_id}/records?student_id={alice.id}', headers=bearer(token))).json()
        assert len(records['items']) == 3
        assert any(r['is_correct'] is None for r in records['items'])
        assert all(r['question']['id'] in {'m_c1', 'm_c2', 'm_c3'} for r in records['items'])
        wrong = (await client.get(f'/api/teacher/classes/{class_id}/records?student_id={alice.id}&wrong_only=true', headers=bearer(token))).json()
        assert len(wrong['items']) == 1 and wrong['items'][0]['question']['id'] == 'm_c2'
        secondary = (await client.get(f'/api/teacher/classes/{class_id}/records?kp_id=kp_fall', headers=bearer(token))).json()
        assert secondary['items'] == []
        primary = (await client.get(f'/api/teacher/classes/{class_id}/records?kp_id=kp_motion', headers=bearer(token))).json()
        assert len(primary['items']) == 3
        _, other = await ready_teacher(client, 'other', 'Other')
        assert (await client.get(f'/api/teacher/classes/{class_id}/dashboard', headers=bearer(other))).status_code == 404
        assert (await client.get(f'/api/teacher/classes/{class_id}/records', headers=bearer(other))).status_code == 404
        outsider = await StudentService(db_session).create_student('outsider_s', 'pass123', 'Outsider')
        assert (await client.get(f'/api/teacher/classes/{class_id}/records?student_id={outsider.id}', headers=bearer(token))).status_code == 404


@pytest.mark.asyncio
async def test_unreleased_scores_are_excluded_and_personalized_rates_use_each_papers_full_marks(db_session):
    await setup_scope(db_session)
    async with client_for(build_app(db_session)) as client:
        token, class_id, (alice, bob) = await setup_class(db_session, client)
        created = await client.post('/api/teacher/personalized', headers=bearer(token), json={
            'title': '指定学生补练', 'scope': [{'kp_id': 'kp_motion'}], 'choice_count': 1, 'area_count': 0,
            'class_ids': [class_id], 'student_ids_by_class': {class_id: [alice.id]},
        })
        aid = created.json()['assigned'][0]['id']
        assert (await client.post(f'/api/teacher/assignments/{aid}/publish', headers=bearer(token))).status_code == 200
        assignment = await db_session.get(TeacherAssignment, aid)
        from app.models.teacher import TeacherStudentPaper
        paper = await db_session.scalar(select(TeacherStudentPaper).where(TeacherStudentPaper.assignment_id == aid))
        qid = paper.items[0]['question_id']
        db_session.add(TeacherSubmission(id='personal_a', assignment_id=aid, student_id=alice.id, status='recognized', ai_authorized=False, total_score=3))
        await db_session.flush()
        db_session.add(TeacherSubmissionItem(submission_id='personal_a', number=1, question_id=qid, kind='choice', status='confirmed', score=3, max_score=6))
        await db_session.commit()
        base = f'/api/teacher/classes/{class_id}/dashboard'
        stats = (await client.get(base, headers=bearer(token))).json()['statistics']
        a = next(s for s in stats['students'] if s['student_id'] == alice.id)
        b = next(s for s in stats['students'] if s['student_id'] == bob.id)
        assert a['homework_submitted'] == 1 and a['homework_rate'] is None
        assert b['homework_expected'] == 0 and b['homework_rate'] is None
        assignment.results_released_at = datetime.now(timezone.utc)
        await db_session.commit()
        stats = (await client.get(base, headers=bearer(token))).json()['statistics']
        a = next(s for s in stats['students'] if s['student_id'] == alice.id)
        assert a['homework_rate'] == .5 and a['homework_scored'] == 1
        kp = next(p for p in stats['knowledge_points'] if p['kp_id'] == 'kp_motion')
        assert kp['homework_rate'] == .5 and kp['student_count'] == 1


@pytest.mark.asyncio
async def test_partial_credit_counts_and_thin_evidence_is_not_a_level(db_session):
    await setup_scope(db_session)
    async with client_for(build_app(db_session)) as client:
        token, class_id, (alice, bob) = await setup_class(db_session, client)
        # Alice: 11/12-style partial credit counts as 0.9, not as wrong; three answers make a level.
        db_session.add_all([
            StudentAnswer(student_id=alice.id, question_id='m_c1', given_answer='v', is_correct=False, grading_result={'process_score': 90}),
            StudentAnswer(student_id=alice.id, question_id='m_c2', given_answer='A', is_correct=True),
            StudentAnswer(student_id=alice.id, question_id='m_c3', given_answer='A', is_correct=True),
            # Bob: one right answer is not "已掌握".
            StudentAnswer(student_id=bob.id, question_id='m_c1', given_answer='A', is_correct=True),
        ])
        await db_session.commit()
        stats = (await client.get(f'/api/teacher/classes/{class_id}/dashboard', headers=bearer(token))).json()['statistics']
        rows = {s['student_id']: s for s in stats['students']}
        assert rows[alice.id]['score'] == round(2.9 / 3, 4) and rows[alice.id]['level'] == 'mastered'
        assert rows[alice.id]['practice_correct_rate'] == round(2 / 3, 4)  # the plain count stays available
        assert rows[alice.id]['strong_points'][0]['kp_id'] == 'kp_motion' and rows[alice.id]['attention'] == []
        assert rows[bob.id]['evidence'] == 1 and rows[bob.id]['level'] == 'insufficient'
        point = next(p for p in stats['knowledge_points'] if p['kp_id'] == 'kp_motion')
        assert point['evidence'] == 4 and point['level'] == 'mastered' and point['weak_students'] == 0
        assert stats['thresholds'] == {'min_evidence': 3, 'mastered': 0.85, 'developing': 0.6}


@pytest.mark.asyncio
async def test_homework_counts_by_points_as_marked_and_bigger_papers_weigh_more(db_session):
    await setup_scope(db_session)
    async with client_for(build_app(db_session)) as client:
        token, class_id, (alice, bob) = await setup_class(db_session, client)
        now = datetime.now(timezone.utc)

        async def released(items, scores):
            aid, _ = await draft_with(client, token, class_id, [{'question_id': q, 'points': p} for q, p in items])
            assert (await client.post(f'/api/teacher/assignments/{aid}/publish', headers=bearer(token))).status_code == 200
            sid = f's_{aid[-8:]}'
            db_session.add(TeacherSubmission(id=sid, assignment_id=aid, student_id=alice.id, status='recognized',
                                             ai_authorized=False, total_score=sum(scores)))
            await db_session.flush()
            db_session.add_all([TeacherSubmissionItem(submission_id=sid, number=n, question_id=q, kind='choice', status='confirmed',
                                                      score=score, max_score=p)
                                for n, ((q, p), score) in enumerate(zip(items, scores), start=1)])
            (await db_session.get(TeacherAssignment, aid)).results_released_at = now
            await db_session.commit()

        # Two 3-point questions right, the 12-point one wrong: 6 / 18 on the paper, not 2 of 3 questions.
        await released([('m_c1', 3), ('m_c2', 3), ('m_c3', 12)], [3, 3, 0])
        stats = (await client.get(f'/api/teacher/classes/{class_id}/dashboard', headers=bearer(token))).json()['statistics']
        a = next(s for s in stats['students'] if s['student_id'] == alice.id)
        assert a['homework_rate'] == round(6 / 18, 4)
        assert (a['evidence'], a['score'], a['level']) == (3, round(6 / 18, 4), 'weak')
        point = next(p for p in stats['knowledge_points'] if p['kp_id'] == 'kp_motion')
        assert point['score'] == point['homework_rate'] == round(6 / 18, 4)

        # A full-marks 4-point quiz moves the homework rate by its points, not as one paper of two.
        await released([('m_c1', 4)], [4])
        stats = (await client.get(f'/api/teacher/classes/{class_id}/dashboard', headers=bearer(token))).json()['statistics']
        a = next(s for s in stats['students'] if s['student_id'] == alice.id)
        assert a['homework_rate'] == round(10 / 22, 4)  # not (6/18 + 4/4) / 2
