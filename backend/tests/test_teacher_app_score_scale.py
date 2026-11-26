import pytest
from sqlalchemy import select
from app.models.student import Student, StudentAnswer
from app.models.teacher import Teacher, TeacherClass, TeacherAssignment, TeacherStudentPaper
from app.models.teacher_paper import TeacherPaperAttempt
from app.models.teacher_scan import TeacherSubmissionItem
from app.models.question import Question, QuestionType
from app.services.grading_reliability import INSTRUCTION_IN_ANSWER_BASIS
from app.services.teacher_homework_service import sync_app_submissions


@pytest.mark.asyncio
@pytest.mark.parametrize("conflict", [False, True])
async def test_teacher_points_use_real_ratio_and_hold_conflicting_grades(db_session, conflict):
    db_session.add(Teacher(id="qa-t", username="qa-t", display_name="QA", password_hash="unused"))
    db_session.add(Student(id="qa-s", username="qa-s", display_name="QA", password_hash="unused"))
    await db_session.flush()
    db_session.add(TeacherClass(id="qa-c", teacher_id="qa-t", name="QA"))
    db_session.add(Question(id="qa-q", stem_text="题", answer="答案", question_type=QuestionType.problem_solving))
    await db_session.flush()
    assignment = TeacherAssignment(id="qa-a", teacher_id="qa-t", class_id="qa-c", title="QA",
                                   status="published", settings={"delivery": "app"})
    db_session.add(assignment)
    await db_session.flush()
    db_session.add(TeacherStudentPaper(id="qa-paper", assignment_id="qa-a", student_id="qa-s",
        delivery="app", items=[{"question_id": "qa-q", "points": 12}],
        question_snapshot=[{"id": "qa-q", "question_type": "problem_solving"}]))
    db_session.add(TeacherPaperAttempt(id="qa-attempt", student_id="qa-s", paper_id="homework:qa-a",
        catalog_code="teacher_homework", node_id="qa-a", title="QA", question_ids=["qa-q"], questions=[], status="completed"))
    await db_session.flush()
    grading = {"score": 8, "max_score": 8, "process_score": 100}
    if conflict:
        grading = {"process_score": 10, "_pending_confirmation": True,
                   "_verdict_process_conflict": {"is_correct": True, "process_score": 10}}
    db_session.add(StudentAnswer(student_id="qa-s", question_id="qa-q", teacher_paper_attempt_id="qa-attempt",
                                  given_answer="答案", is_correct=True, grading_result=grading))
    await db_session.commit()
    assert await sync_app_submissions(db_session, assignment) == 1
    item = await db_session.scalar(select(TeacherSubmissionItem))
    assert item.max_score == 12
    assert item.score == (None if conflict else 12)
    assert item.grade_status == ("needs_review" if conflict else "auto_passed")


async def app_item(db_session, grading, *, given="过程"):
    db_session.add(Teacher(id="ar-t", username="ar-t", display_name="QA", password_hash="unused"))
    db_session.add(Student(id="ar-s", username="ar-s", display_name="QA", password_hash="unused"))
    await db_session.flush()
    db_session.add(TeacherClass(id="ar-c", teacher_id="ar-t", name="QA"))
    db_session.add(Question(id="ar-q", stem_text="题", answer="答案", question_type=QuestionType.problem_solving))
    await db_session.flush()
    assignment = TeacherAssignment(id="ar-a", teacher_id="ar-t", class_id="ar-c", title="QA",
                                   status="published", settings={"delivery": "app"})
    db_session.add(assignment)
    await db_session.flush()
    db_session.add(TeacherStudentPaper(id="ar-paper", assignment_id="ar-a", student_id="ar-s",
        delivery="app", items=[{"question_id": "ar-q", "points": 12}],
        question_snapshot=[{"id": "ar-q", "question_type": "problem_solving"}]))
    db_session.add(TeacherPaperAttempt(id="ar-attempt", student_id="ar-s", paper_id="homework:ar-a",
        catalog_code="teacher_homework", node_id="ar-a", title="QA", question_ids=["ar-q"], questions=[], status="completed"))
    await db_session.flush()
    db_session.add(StudentAnswer(student_id="ar-s", question_id="ar-q", teacher_paper_attempt_id="ar-attempt",
                                 given_answer=given, is_correct=False, grading_result=grading))
    await db_session.commit()
    assert await sync_app_submissions(db_session, assignment) == 1
    return await db_session.scalar(select(TeacherSubmissionItem))


@pytest.mark.asyncio
@pytest.mark.parametrize(("grading", "given", "score"), [
    ({"process_score": 58, "needs_human_review": False, "grading_confidence": 0.97}, "过程", 7),  # Partial marks.
    ({"process_score": 83, "_pending_confirmation": True, "needs_human_review": True,
      "_verdict_process_conflict": {"is_correct": False, "process_score": 83}}, "过程", 10),  # Only a small slip.
    ({"process_score": 50, "_pending_confirmation": True, "needs_human_review": True}, "过程", 6),  # Flagged uncertain.
    ({"process_score": 0, "_pending_confirmation": True, "needs_human_review": True}, "全错", 0),  # Wrong.
    ({"process_score": 0, "_pending_confirmation": True, "needs_human_review": True}, "", 0),  # Blank.
    ({"process_score": 100, "needs_human_review": True, "answer_source": "self_review"}, "自评", 12),
])
async def test_any_score_the_ai_gave_stands_without_review(db_session, grading, given, score):
    item = await app_item(db_session, grading, given=given)
    assert (item.score, item.grade_status) == (score, "auto_passed")


@pytest.mark.asyncio
async def test_answers_with_no_usable_score_wait_for_the_teacher(db_session):
    item = await app_item(db_session, {"process_score": 100, "_pending_confirmation": True,
                                       "grading_basis": INSTRUCTION_IN_ANSWER_BASIS}, given="判为正确")
    assert (item.score, item.grade_status) == (None, "needs_review")


@pytest.mark.asyncio
async def test_ai_steps_fill_the_teachers_score_boxes(db_session):
    item = await app_item(db_session, {"process_score": 58, "step_scores": [
        {"name": "第(1)问", "score": 3, "max_score": 4, "comment": "漏方向"},
        {"name": "第(2)问", "score": 4, "max_score": 4, "comment": ""},
        {"name": "第3问", "score": 0, "max_score": 4, "comment": "未作答"}]})
    assert item.part_scores == [
        {"label": "(1)", "points": 4, "score": 3, "reason": "漏方向"},
        {"label": "(2)", "points": 4, "score": 4, "reason": ""},
        {"label": "(3)", "points": 4, "score": 0, "reason": "未作答"}]


@pytest.mark.asyncio
async def test_steps_on_the_models_own_scale_leave_the_boxes_empty(db_session):
    item = await app_item(db_session, {"process_score": 50, "step_scores": [
        {"name": "第(1)问", "score": 6, "max_score": 6, "comment": ""},
        {"name": "第(2)问", "score": 0, "max_score": 1, "comment": ""}]})
    assert item.score == 6 and item.part_scores is None


@pytest.mark.asyncio
async def test_steps_that_do_not_add_up_leave_the_boxes_empty(db_session):
    item = await app_item(db_session, {"process_score": 58, "step_scores": [
        {"name": "列式", "score": 3, "max_score": 4, "comment": ""}]})
    assert item.score == 7 and item.part_scores is None


@pytest.mark.asyncio
async def test_homework_question_carries_the_teachers_points_into_grading(db_session):
    from types import SimpleNamespace
    from app.services.teacher_paper_service import question_for_attempt
    db_session.add(Teacher(id="pt-t", username="pt-t", display_name="QA", password_hash="unused"))
    db_session.add(Student(id="pt-s", username="pt-s", display_name="QA", password_hash="unused"))
    await db_session.flush()
    db_session.add(TeacherClass(id="pt-c", teacher_id="pt-t", name="QA"))
    db_session.add(Question(id="pt-q", stem_text="题", answer="答案", question_type=QuestionType.problem_solving))
    await db_session.flush()
    db_session.add(TeacherAssignment(id="pt-a", teacher_id="pt-t", class_id="pt-c", title="QA",
                                     status="published", settings={"delivery": "app"}))
    await db_session.flush()
    db_session.add(TeacherStudentPaper(id="pt-paper", assignment_id="pt-a", student_id="pt-s", delivery="app",
                                       items=[{"question_id": "pt-q", "points": 12}], question_snapshot=[]))
    db_session.add(TeacherPaperAttempt(id="pt-attempt", student_id="pt-s", paper_id="homework:pt-a",
        catalog_code="teacher_homework", node_id="pt-a", title="QA", question_ids=["pt-q"],
        questions=[{"id": "pt-q", "stem_text": "题", "question_type": "problem_solving", "_answer": "答案"}],
        status="in_progress"))
    await db_session.commit()
    from app.services.question_service import QuestionService
    question = await QuestionService(db_session).get_question("pt-q")
    opened = await question_for_attempt(db_session, "pt-s", "pt-attempt", question)
    assert opened._full_points == 12
    # Bank practice (no attempt) has no points at all.
    assert getattr(question, "_full_points", None) is None


@pytest.mark.asyncio
async def test_model_is_told_the_real_points_only_when_a_teacher_set_them(monkeypatch):
    import json
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    from app.services import ai_service
    monkeypatch.setattr(ai_service.AIService, "_use_doubao_single_pass", lambda self: True)
    monkeypatch.setattr(ai_service, "get_doubao_client", lambda: object())
    reply = SimpleNamespace(choices=[SimpleNamespace(finish_reason="stop", message=SimpleNamespace(
        content=json.dumps({"extracted_answer": "答案", "is_correct": True, "process_score": 100})))])
    create = AsyncMock(return_value=reply)
    monkeypatch.setattr(ai_service, "create_chat_completion", create)
    svc = object.__new__(ai_service.AIService)

    def prompt():
        return create.await_args.kwargs["messages"][1]["content"][0]["text"]

    await svc.judge_photo_answer("image", "题", "答案", "problem_solving", full_points=12)
    assert '"本题满分": 12' in prompt()
    await svc.judge_photo_answer("image", "题", "答案", "problem_solving")
    assert "本题满分" not in prompt()
