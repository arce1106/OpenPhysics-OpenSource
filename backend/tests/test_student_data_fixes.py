"""Student data in the teacher app (audit 2026-10-28): what the teacher sees, from when, and for how long."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.student import StudentAnswer, StudentPrivacyConsent
from app.models.teacher import TeacherAssignment, TeacherClass, TeacherClassMember, TeacherClassMembershipEvent
from app.models.teacher_paper import TeacherPaperAttempt
from app.services.class_membership_service import DISCLOSURE_VERSION, ClassMembershipService
from app.services.student_service import StudentService
from app.services.teacher_homework_service import student_homework
from app.services.teacher_paper_service import submit_attempt
from app.services.teacher_service import mask_phone
from tests.test_class_invitations import setup
from tests.test_teacher_accounts import bearer, client_for
from tests.test_teacher_assignments import add_question


def test_phone_numbers_are_masked_for_teachers():
    assert mask_phone("13800138000") == "138****8000"
    assert mask_phone("张三") == "张三" and mask_phone("stu123") == "stu123" and mask_phone(None) is None


@pytest.mark.asyncio
async def test_roster_shows_how_each_student_joined_without_whole_phone_numbers(db_session):
    env = await setup(db_session)
    class_id = env.cls.id
    await ClassMembershipService(db_session).join(env.code, env.student.id, DISCLOSURE_VERSION, "张三")
    phone_account = await StudentService(db_session).create_student("13800138000", "pass123", "13800138000")
    phone_id = phone_account.id
    db_session.add(StudentPrivacyConsent(student_id=phone_id, scope="ios_ai", version="ios-ai-2026-10-11.2", granted=False))
    await db_session.commit()
    async with client_for(env.app) as client:
        # Placing a student by hand needs the school's or a guardian's authorization.
        refused = await client.post(f"/api/admin/teacher-classes/{class_id}/members", json={"username": "13800138000"})
        assert refused.status_code == 422
        added = await client.post(f"/api/admin/teacher-classes/{class_id}/members",
                                  json={"username": "13800138000", "grantor": "guardian"})
        assert added.status_code == 200, added.text
        roster = (await client.get(f"/api/teacher/classes/{class_id}", headers=bearer(env.token))).json()["members"]
    by_id = {m["id"]: m for m in roster}
    assert by_id[env.student.id]["joined_via"] == "invitation" and by_id[env.student.id]["display_name"] == "张三"
    phone = by_id[phone_id]
    assert (phone["username"], phone["display_name"]) == ("138****8000", "138****8000")
    assert phone["joined_via"] == "admin" and phone["student_number"] == "2" and phone["app_ai_declined"] is True
    event = await db_session.scalar(select(TeacherClassMembershipEvent).where(
        TeacherClassMembershipEvent.student_id == phone_id))
    assert event.action == "admin_added" and event.disclosure_version.startswith("admin:guardian:")


@pytest.mark.asyncio
async def test_teacher_sees_practice_from_joining_and_pages_through_it(db_session):
    env = await setup(db_session)
    class_id, student_id = env.cls.id, env.student.id
    await add_question(db_session, "q_c1", "single_choice")
    await add_question(db_session, "q_p1", "problem_solving", answer="v=10 m/s")
    joined_at = datetime.now(timezone.utc) - timedelta(days=5)
    db_session.add(StudentAnswer(student_id=student_id, question_id="q_c1", given_answer="A", is_correct=True,
                                 created_at=joined_at - timedelta(days=30)))  # before joining: the student's own
    for day in range(25):
        db_session.add(StudentAnswer(student_id=student_id, question_id="q_p1", given_answer="v", is_correct=False,
                                     grading_result={"process_score": 75}, created_at=joined_at + timedelta(hours=day)))
    await db_session.commit()
    await ClassMembershipService(db_session).join(env.code, student_id, DISCLOSURE_VERSION, "张三")
    member = await db_session.get(TeacherClassMember, (class_id, student_id))
    member.added_at = joined_at
    await db_session.commit()
    async with client_for(env.app) as client:
        teacher = bearer(env.token)
        base = f"/api/teacher/classes/{class_id}"
        first = (await client.get(f"{base}/records", headers=teacher, params={"student_id": student_id})).json()
        assert len(first["items"]) == 20 and first["has_more"] is True
        assert {item["question"]["id"] for item in first["items"]} == {"q_p1"}
        assert first["items"][0]["credit"] == 0.75
        rest = (await client.get(f"{base}/records", headers=teacher, params={"student_id": student_id, "offset": 20})).json()
        assert len(rest["items"]) == 5 and rest["has_more"] is False
        stats = (await client.get(f"{base}/students/{student_id}/statistics", headers=teacher)).json()
        assert [row["practice_count"] for row in stats["students"]] == [25]

        # Archiving the class stops reading current learning; the roster stays.
        await db_session.execute(TeacherClass.__table__.update().where(TeacherClass.id == class_id)
                                 .values(archived_at=datetime.now(timezone.utc)))
        await db_session.commit()
        db_session.expire_all()  # the shared test session caches the class row
        for path in (f"{base}/dashboard", f"{base}/records", f"{base}/students/{student_id}/statistics"):
            response = await client.get(path, headers=teacher)
            assert response.status_code == 403 and "已归档" in response.json()["detail"]
        assert (await client.get(base, headers=teacher)).status_code == 200


@pytest.mark.asyncio
async def test_students_correct_their_own_name_and_unfinished_app_work_closes_at_release(db_session):
    env = await setup(db_session)
    student_id, class_id = env.student.id, env.cls.id
    async with client_for(env.app) as client:
        assert (await client.put("/api/student/student-name", headers=env.auth, json={"student_name": "张三"})).status_code == 409
        await ClassMembershipService(db_session).join(env.code, student_id, DISCLOSURE_VERSION, "张山")
        renamed = await client.put("/api/student/student-name", headers=env.auth, json={"student_name": " 张三 "})
        assert renamed.status_code == 200 and renamed.json() == {"student_name": "张三"}
        assert (await client.put("/api/student/student-name", headers=env.auth, json={"student_name": "张\n三"})).status_code == 400
    assert (await StudentService(db_session).get_student(student_id)).display_name == "张三"
    assert await db_session.scalar(select(TeacherClassMembershipEvent.id).where(
        TeacherClassMembershipEvent.student_id == student_id, TeacherClassMembershipEvent.action == "renamed"))

    now = datetime.now(timezone.utc)
    db_session.add(TeacherAssignment(id="a_app", class_id=class_id, teacher_id=env.teacher_id, title="App 作业",
                                     status="published", published_at=now, roster={student_id: "1"}, items=[]))
    db_session.add(TeacherPaperAttempt(id="att_app", student_id=student_id, paper_id="homework:a_app",
                                       catalog_code="teacher_homework", node_id="a_app", title="App 作业",
                                       question_ids=["q1"], questions=[], status="in_progress"))
    await db_session.commit()
    assert [h["attempt_id"] for h in await student_homework(db_session, student_id)] == ["att_app"]
    # A disabled teacher would never review it: the unfinished homework waits, hidden and closed.
    from app.models.teacher import Teacher
    await db_session.execute(Teacher.__table__.update().where(Teacher.id == env.teacher_id).values(status="disabled"))
    await db_session.commit()
    assert await student_homework(db_session, student_id) == []
    with pytest.raises(HTTPException) as paused:
        await submit_attempt(db_session, student_id, "att_app")
    assert paused.value.status_code == 409 and "停用" in paused.value.detail
    await db_session.execute(Teacher.__table__.update().where(Teacher.id == env.teacher_id).values(status="active"))
    await db_session.commit()
    db_session.expire_all()
    assert [h["attempt_id"] for h in await student_homework(db_session, student_id)] == ["att_app"]
    await db_session.execute(TeacherAssignment.__table__.update().where(TeacherAssignment.id == "a_app")
                             .values(results_released_at=now))
    await db_session.commit()
    db_session.expire_all()
    assert await student_homework(db_session, student_id) == []
    with pytest.raises(HTTPException) as closed:
        await submit_attempt(db_session, student_id, "att_app")
    assert closed.value.status_code == 409 and "已发布" in closed.value.detail
