"""Released paper homework reaches the student's own records, with the crop of their handwriting."""
import pytest
from sqlalchemy import select

from app.api.student.router import router as student_router
from app.models.student import StudentAnswer, StudentMastery
from app.models.teacher_paper import TeacherPaperAttempt
from app.services.answer_media_service import AnswerMediaService
from app.services.rubric_service import RubricService
from app.services.student_service import StudentService
from app.services.teacher_paper_results import ensure_student_paper_results, paper_results_id
from tests.test_teacher_accounts import bearer, client_for
from tests.test_teacher_grading import RUBRIC_Q_P1, FakeGrader, collected_homework, full_marks, grading_app, partial_marks
from tests.test_teacher_scans import FakeRecognizer


async def released(client, db_session, token, assignment_id):
    base = f"/api/teacher/assignments/{assignment_id}"
    await RubricService(db_session).review("q_p1", parts=RUBRIC_Q_P1, approve=True, note=None, reviewer="admin:t")
    await client.post(f"{base}/grading", headers=bearer(token))
    grade = lambda item, body: client.put(f"/api/teacher/submission-items/{item}/grade", headers=bearer(token), json=body)
    q3 = {e["display_name"]: e for e in (await client.get(f"{base}/review/3", headers=bearer(token))).json()}
    await grade(q3["Bob"]["item_id"], {"part_scores": [{"label": "(1)", "score": 5}, {"label": "(2)", "score": 6}],
                                       "comment": "第二问方向没写"})
    await grade(q3["Carol"]["item_id"], {"part_scores": [{"label": "(1)", "score": 3}, {"label": "(2)", "score": 0}],
                                         "error_type": "equation_setup"})
    await client.post(f"{base}/review/3/confirm-auto", headers=bearer(token))
    q4 = {e["display_name"]: e for e in (await client.get(f"{base}/review/4", headers=bearer(token))).json()}
    for name, score in (("Alice", 8), ("Bob", 6.5), ("Carol", 2)):
        await grade(q4[name]["item_id"], {"score": score})
    collection = (await client.get(f"{base}/collection", headers=bearer(token))).json()
    carol = next(r for r in collection["students"] if r["display_name"] == "Carol")["submission"]["id"]
    for number, answer in ((1, "A"), (2, "C")):
        await client.put(f"/api/teacher/submissions/{carol}/choices/{number}", headers=bearer(token), json={"answer": answer})
    response = await client.post(f"{base}/release", headers=bearer(token))
    assert response.status_code == 204, response.text


@pytest.mark.asyncio
async def test_released_paper_shows_in_history_and_mistakes_with_scores_and_crops(db_session, tmp_path, monkeypatch):
    recognizer, grader = FakeRecognizer([]), FakeGrader([full_marks(), partial_marks()])
    app = grading_app(db_session, tmp_path, recognizer, grader)
    app.include_router(student_router)
    async with client_for(app) as client:
        token, assignment_id, students = await collected_homework(client, db_session, recognizer)
        await released(client, db_session, token, assignment_id)
        bob = students["bob_s"]
        mastery_before = {(m.student_id, m.knowledge_point_id): m.mastery
                          for m in (await db_session.scalars(select(StudentMastery))).all()}

        rows = (await db_session.scalars(select(StudentAnswer).where(StudentAnswer.student_id == bob.id)
                                         .order_by(StudentAnswer.id))).all()
        assert len(rows) == 4 and all(row.time_spent_ms == 0 for row in rows)
        # Dated when the results came out, so they lead the student's records; never App activity.
        from app.models.teacher import TeacherAssignment
        from app.services.teacher_paper_results import answered_in_app
        released_at = (await db_session.get(TeacherAssignment, assignment_id)).results_released_at
        assert all(row.created_at == released_at for row in rows)
        assert not (await db_session.scalars(select(StudentAnswer.id).where(
            StudentAnswer.student_id == bob.id, answered_in_app()))).all()
        attempt = await db_session.get(TeacherPaperAttempt, rows[0].teacher_paper_attempt_id)
        assert (attempt.paper_id, attempt.catalog_code, attempt.status) == (
            paper_results_id(assignment_id), "teacher_homework", "completed")
        by_question = {row.question_id: row for row in rows}
        partial = by_question["q_p1"].grading_result
        # 11 of 12 is not "wrong": it is a score, shown as partly right everywhere.
        assert (partial["score"], partial["max_score"], partial["process_score"]) == (11.0, 12.0, 92)
        assert by_question["q_p1"].is_correct is False and partial["feedback"] == "第二问方向没写"
        assert partial["answer_image_path"].startswith("/static/uploads/answers/" + bob.id + "/teacher/")
        # Mirroring again (a later visit) adds nothing, and mastery is the teacher release's alone.
        assert await ensure_student_paper_results(db_session, bob.id) == 0
        after = {(m.student_id, m.knowledge_point_id): m.mastery
                 for m in (await db_session.scalars(select(StudentMastery))).all()}
        assert after == mastery_before

        student = bearer(StudentService.create_access_token(bob.id, bob.auth_version))
        history = (await client.get("/api/student/history/answers", headers=student)).json()
        assert {item["question_id"] for item in history} == set(by_question)
        item = next(item for item in history if item["question_id"] == "q_p1")
        assert item["process_grading"]["process_score"] == 92
        assert (item["process_grading"]["score"], item["process_grading"]["max_score"]) == (11.0, 12.0)
        assert item["process_grading"]["answer_source"] == "teacher_paper"
        choice = next(item for item in history if item["question_id"] == "q_c2")
        assert choice["process_grading"]["max_score"] == 4.0
        image = item["process_grading"]["answer_image_path"]
        assert image.startswith(f"/api/student/answer-images/{bob.id}/teacher__")
        review = (await client.get("/api/student/review", headers=student)).json()
        mistakes = [m for group in review["groups"] for m in group["mistakes"]]
        assert {m["question_id"] for m in mistakes} == {q for q, row in by_question.items() if not row.is_correct}
        assert next(m for m in mistakes if m["question_id"] == "q_p1")["process_grading"]["score"] == 11.0
        homework = (await client.get("/api/student/teacher-homework", headers=student)).json()
        assert [(h["status"], h["question_count"]) for h in homework] == [("completed", 4)]

        # The teacher's per-question figures read each paper once, not again through its copies,
        # and the copies are teacher judgments, never counted as AI grading.
        from app.models.teacher_scan import TeacherSubmissionItem
        from app.services.grading_quality_service import is_ai_graded
        items = (await db_session.scalars(select(TeacherSubmissionItem).where(TeacherSubmissionItem.question_id == "q_p1"))).all()
        expected = round(sum(min(i.score / i.max_score, 1) for i in items) / len(items), 4)
        detail = (await client.get(f"/api/teacher/assignments/{assignment_id}", headers=bearer(token))).json()
        q_p1 = next(i["question"] for i in detail["items"] if i["question_id"] == "q_p1")
        assert (q_p1["class_attempted"], q_p1["class_correct_rate"]) == (len(items), expected)
        assert not is_ai_graded(by_question["q_p1"].grading_result)
        session = await client.post(f"/api/student/teacher-homework/{homework[0]['attempt_id']}/session", headers=student)
        assert session.status_code == 200 and len(session.json()["answers"]) == 4


def test_crop_links_resolve_only_inside_the_owners_teacher_folder(tmp_path):
    media = AnswerMediaService(secret="s" * 32, static_dir=tmp_path, ttl_seconds=60)
    crop = tmp_path / "uploads" / "answers" / "s_1" / "teacher" / "a_1" / "sub_x_q03.jpg"
    crop.parent.mkdir(parents=True)
    crop.write_bytes(b"jpg")
    url = media.create_url("s_1", "/static/uploads/answers/s_1/teacher/a_1/sub_x_q03.jpg", now=1000)
    filename = url.split("/")[-1].split("?")[0]
    assert filename == "teacher__a_1__sub_x_q03.jpg"
    signature = url.split("signature=")[1]
    assert media.resolve("s_1", filename, 1060, signature, now=1000) == crop
    # Someone else's crop is never signed, and a forged path cannot climb out.
    assert media.create_url("s_2", "/static/uploads/answers/s_1/teacher/a_1/sub_x_q03.jpg") .startswith("/static/")
    assert media.resolve("s_1", "teacher__..__x.jpg", 1060, media._signature("s_1", "teacher__..__x.jpg", 1060), now=1000) is None
