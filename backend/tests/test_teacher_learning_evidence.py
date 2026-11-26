"""Final teacher facts survive replay and are shared without counting App pre-grades twice."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import delete, select

from app.models.student import StudentAnswer, StudentMastery
from app.models.teacher import TeacherAssignment, TeacherClassMember, TeacherStudentPaper
from app.models.teacher_paper import TeacherPaperAttempt
from app.models.teacher_scan import TeacherSubmission, TeacherSubmissionItem
from app.services.knowledge_mastery_judgment_service import KnowledgeMasteryJudgmentService
from app.services.student_service import CorrectionNotAllowed, StudentService
from app.services.teacher_grading_service import TeacherGradingService
from app.services.teacher_assignment_service import TeacherAssignmentService
from tests.test_teacher_accounts import bearer, build_app, client_for, ready_teacher
from tests.test_teacher_assignments import draft_with, setup_class
from tests.test_teacher_personalized import setup_scope


async def shared_work(db, client):
    await setup_scope(db)
    token, class_id, (alice, bob) = await setup_class(db, client)
    aid, _ = await draft_with(client, token, class_id, [{'question_id': 'm_p1', 'points': 8}])
    assert (await client.post(f'/api/teacher/assignments/{aid}/publish', headers=bearer(token))).status_code == 200
    assignment = await db.get(TeacherAssignment, aid)
    now = datetime.now(timezone.utc)
    db.add(TeacherPaperAttempt(id='teacher_app', student_id=bob.id, paper_id='homework', node_id=aid,
                              catalog_code='teacher_homework', title='App作业', question_ids=['m_p1'],
                              questions=[], status='completed', completed_at=now))
    db.add_all([TeacherSubmission(id='scan', assignment_id=aid, student_id=alice.id, source='scan',
                                  status='recognized', ai_authorized=False, created_at=now),
                TeacherSubmission(id='app', assignment_id=aid, student_id=bob.id, source='app',
                                  status='recognized', ai_authorized=False, created_at=now)])
    await db.flush()
    answer = StudentAnswer(student_id=bob.id, question_id='m_p1', given_answer='原始作答', is_correct=True,
                           teacher_paper_attempt_id='teacher_app', created_at=now,
                           grading_result={'process_score': 100, 'feedback': '初评正确', '_mastery_scope': 'topic_only'})
    db.add(answer)
    for sid in ('scan', 'app'):
        db.add(TeacherSubmissionItem(submission_id=sid, number=1, question_id='m_p1', kind='area',
                                    status='collected', grade_status='confirmed', max_score=8, score=4,
                                    error_type='force_analysis', first_error='遗漏摩擦力', teacher_comment='先重新画受力图'))
    await db.commit()
    return token, class_id, alice, bob, assignment, answer


@pytest.mark.asyncio
async def test_release_shares_the_final_judgment_and_replay_is_idempotent(db_session):
    async with client_for(build_app(db_session)) as client:
        token, class_id, alice, bob, assignment, answer = await shared_work(db_session, client)
        unpublished = await client.get(f'/api/teacher/classes/{class_id}/records', headers=bearer(token), params={'source': 'all'})
        assert unpublished.json()['items'] == []
        teacher_id = assignment.teacher_id
        await TeacherGradingService(db_session).release(teacher_id, assignment.id)
        assert answer.is_correct is False
        assert answer.grading_result['process_score'] == 50
        assert answer.grading_result['_original_grading']['process_score'] == 100
        assert answer.grading_result['_teacher_review']['assignment_id'] == assignment.id
        service = StudentService(db_session)
        for student in (alice, bob):
            mastery = await db_session.get(StudentMastery, (student.id, 'kp_motion'))
            assert mastery.attempts == 1 and mastery.correct_rate == .5
            expected = mastery.mastery
            rebuilt = await service.rebuild_mastery_for_kp(student.id, 'kp_motion')
            assert rebuilt.attempts == 1 and rebuilt.mastery == pytest.approx(expected)
            recent = await KnowledgeMasteryJudgmentService(db_session)._load_recent_answer_stats(student.id, ['kp_motion'])
            assert recent['kp_motion'].total_count == 1 and recent['kp_motion'].correct_count == 0
        with pytest.raises(CorrectionNotAllowed):
            await service.apply_manual_correction(bob.id, answer.id, '改成正确', True)
        # A normal later practice correction must retain the earlier paper evidence.
        practice = StudentAnswer(student_id=alice.id, question_id='m_p1', given_answer='解答', is_correct=False,
                                 created_at=datetime.now(timezone.utc) + timedelta(seconds=1),
                                 grading_result={'process_score': 20})
        db_session.add(practice)
        await db_session.commit()
        await service.apply_manual_correction(alice.id, practice.id, '订正解答', True)
        assert (await db_session.get(StudentMastery, (alice.id, 'kp_motion'))).attempts == 2
        # Both original App and scanned work can be inspected through the class scope.
        base = f'/api/teacher/classes/{class_id}/records'
        records = (await client.get(base, headers=bearer(token), params={'source': 'all', 'kp_id': 'kp_motion'})).json()
        assert {r['source'] for r in records['items']} == {'practice', 'teacher_app', 'teacher_paper'}
        teacher = [r for r in records['items'] if r['source'] != 'practice']
        assert len(teacher) == 2 and all(r['score'] == 4 and r['first_error'] == '遗漏摩擦力' for r in teacher)
        _, other_token = await ready_teacher(client, 'other', '另一位老师')
        assert (await client.get(base, headers=bearer(other_token), params={'source': 'all'})).status_code == 404


@pytest.mark.asyncio
async def test_recommendations_ignore_pending_and_pregrade_then_use_teacher_final(db_session):
    async with client_for(build_app(db_session)) as client:
        _, _, _, bob, assignment, _ = await shared_work(db_session, client)
        service = TeacherAssignmentService(db_session).personalized()
        pool = await service.pool(['kp_motion'])
        db_session.add(StudentAnswer(student_id=bob.id, question_id='m_c1', given_answer='B', is_correct=False,
                                     grading_result={'_pending_confirmation': True, 'error_type': 'calculation'}))
        await db_session.commit()
        evidence = await service.evidence(bob.id, pool)
        assert evidence.wrong == [] and evidence.recent_correct == {}
        await TeacherGradingService(db_session).release(assignment.teacher_id, assignment.id)
        evidence = await service.evidence(bob.id, pool, assignment.teacher_id)
        assert len(evidence.wrong) == 1
        assert evidence.wrong[0].error_type == 'force_analysis'
        assert '第 1 题' in evidence.wrong[0].source
        # Another teacher drafting for the same student learns of the mistake, not of the homework.
        other = (await service.evidence(bob.id, pool, 't_someone_else')).wrong[0]
        assert other.error_type == 'force_analysis' and other.source == '近期作业中'
        assert assignment.title not in other.source


@pytest.mark.asyncio
async def test_released_report_keeps_its_original_cohort_after_transfer(db_session):
    async with client_for(build_app(db_session)) as client:
        token, class_id, alice, _, assignment, _ = await shared_work(db_session, client)
        grading = TeacherGradingService(db_session)
        await grading.release(assignment.teacher_id, assignment.id)
        await db_session.execute(delete(TeacherClassMember).where(TeacherClassMember.class_id == class_id,
                                                                 TeacherClassMember.student_id == alice.id))
        await db_session.commit()
        report = await grading.report(assignment.teacher_id, assignment.id)
        assert report['class_size'] == 2 and report['collected'] == 2
        assert alice.id in {row['student_id'] for row in report['students']}
        response = await client.get(f'/api/teacher/classes/{class_id}/records', headers=bearer(token),
                                    params={'student_id': alice.id, 'source': 'all'})
        assert response.status_code == 404  # No expanded access to a transferred student's live profile.


@pytest.mark.asyncio
async def test_unknown_causes_do_not_make_recurrence_look_better(db_session):
    async with client_for(build_app(db_session)) as client:
        _, _, alice, _, assignment, _ = await shared_work(db_session, client)
        assignment.kind = 'personalized'
        db_session.add(TeacherStudentPaper(id='target', assignment_id=assignment.id, student_id=alice.id,
                                          items=[{'question_id': 'm_p1', 'rule': 'same_error', 'error_type': 'unknown'}],
                                          question_snapshot=assignment.question_snapshot, delivery='paper'))
        await db_session.commit()
        item = await db_session.scalar(select(TeacherSubmissionItem).where(TeacherSubmissionItem.submission_id == 'scan'))
        submission = await db_session.get(TeacherSubmission, 'scan')
        report = await TeacherGradingService(db_session)._same_error_rate(assignment, {alice.id: submission}, {'scan': {1: item}})
        assert report['questions'] == 1 and report['missed_again'] == 1
        assert report['comparable'] == 0 and report['unknown'] == 1 and report['same_cause_rate'] is None


@pytest.mark.asyncio
async def test_practice_uses_the_recorded_target_even_if_the_bank_label_changes(db_session):
    async with client_for(build_app(db_session)) as client:
        token, class_id, alice, _, _, _ = await shared_work(db_session, client)
        db_session.add(StudentAnswer(student_id=alice.id, question_id='m_c1', given_answer='A', is_correct=True,
                                     grading_result={'_evidence_knowledge_point_id': 'kp_fall'}))
        db_session.add(StudentAnswer(student_id=alice.id, question_id='m_c2', given_answer='A', is_correct=True,
                                     grading_result={'_mastery_scope': 'topic_only'}))
        await db_session.commit()
        stats = (await client.get(f'/api/teacher/classes/{class_id}/dashboard', headers=bearer(token))).json()['statistics']
        point = next(p for p in stats['knowledge_points'] if p['kp_id'] == 'kp_fall')
        assert point['practice_count'] == 1
        assert all(p['kp_id'] != 'kp_motion' or p['practice_count'] == 0 for p in stats['knowledge_points'])
        records = (await client.get(f'/api/teacher/classes/{class_id}/records', headers=bearer(token),
                                    params={'kp_id': 'kp_fall'})).json()['items']
        assert len(records) == 1 and records[0]['question']['primary_kp']['id'] == 'kp_fall'


@pytest.mark.asyncio
async def test_teacher_full_marks_replace_the_ai_points_and_its_deduction_note(db_session):
    async with client_for(build_app(db_session)) as client:
        _, _, _, bob, assignment, answer = await shared_work(db_session, client)
        item = (await db_session.scalars(select(TeacherSubmissionItem).where(
            TeacherSubmissionItem.submission_id == 'app'))).one()
        # The AI took a point for a sign convention; the teacher gave full marks.
        item.score, item.teacher_comment = 8, None
        item.first_error, item.feedback = '功的符号前后不一致', '结果正确，但符号表述不严谨，扣1分。'
        item.ai_result = {'score': 7, 'max_score': 8, 'process_score': 88, 'feedback': item.feedback}
        await db_session.commit()
        await TeacherGradingService(db_session).release(assignment.teacher_id, assignment.id)
        final = answer.grading_result
        assert answer.is_correct is True
        assert (final['score'], final['max_score'], final['process_score']) == (8, 8, 100)
        assert final['first_error'] is None
        assert '扣' not in (final['feedback'] or '') and '扣' not in final['next_action']
