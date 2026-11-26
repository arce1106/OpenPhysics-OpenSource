"""Rubrics, AI pre-grading, review by question, release and report (teacher app P1c)."""
import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import select, text

from app.api.admin.rubrics import router as admin_rubrics_router
from app.api.teacher.router import get_grading_runner, get_grading_service, get_rubric_runner
from app.models.student import StudentMastery
from app.models.teacher_scan import QuestionRubric, TeacherAiCall
from app.services.rubric_service import RubricError, RubricService, clean_parts, scaled_parts
from app.services.teacher_ai_service import AiReading, TeacherAiService
from app.services.teacher_grading_service import TeacherGradingService, choice_score, criteria_score, release_choice_mastery
from tests.scan_fixtures import to_pdf
from tests.test_teacher_accounts import bearer, client_for
from tests.test_teacher_scans import (
    FakeRecognizer, authorize, copy_pages, published_homework, scan_app, upload,
)

RUBRIC_Q_P1 = [
    {"label": "(1)", "points": 4, "criteria": ["写出 $v=v_0+at$ 得 2 分", "结果正确得 2 分"]},
    {"label": "(2)", "points": 6, "criteria": ["判断方向得 2 分", "两个时刻速度各 2 分"]},
]


class FakeDrafter:
    def __init__(self):
        self.calls: list[dict] = []

    async def draft(self, question: dict) -> AiReading:
        self.calls.append(question)
        return AiReading({"parts": RUBRIC_Q_P1}, input_tokens=900, output_tokens=200)


class FakeGrader:
    """Grades in call order; records which crops were sent."""

    def __init__(self, results: list[list[dict]]):
        self.results = list(results)
        self.calls: list[tuple[int, list[int]]] = []

    async def grade(self, images: list[bytes], questions: list[dict]) -> AiReading:
        self.calls.append((len(images), [q["number"] for q in questions]))
        return AiReading({"results": self.results.pop(0)}, input_tokens=2500, output_tokens=400)


def grading_app(db_session, tmp_path, recognizer, grader, drafter=None):
    app = scan_app(db_session, tmp_path, recognizer)
    app.include_router(admin_rubrics_router)

    def service():
        return TeacherGradingService(db_session, TeacherAiService(db_session, recognizer), grader, root=tmp_path)

    async def run(run_id: str):
        await service().process_run(run_id)

    app.dependency_overrides[get_grading_service] = service
    app.dependency_overrides[get_grading_runner] = lambda: run
    if drafter is not None:
        async def draft(question_points):
            rubrics = RubricService(db_session, drafter)
            for question_id, points in question_points:
                await rubrics.draft(question_id, default_points=points)
        app.dependency_overrides[get_rubric_runner] = lambda: draft
    return app


def test_rubric_parts_are_validated_and_scaled():
    assert sum(p["points"] for p in scaled_parts(RUBRIC_Q_P1, 12)) == 12
    assert [p["points"] for p in scaled_parts(RUBRIC_Q_P1, 12)] == [5.0, 7.0]
    assert [p["points"] for p in scaled_parts(RUBRIC_Q_P1, 5)] == [2.0, 3.0]
    for bad in ([], [{"label": "(1)", "points": 0.3, "criteria": ["x"]}],
                [{"label": "(1)", "points": 2, "criteria": []}],
                [{"label": "(1)", "points": 2, "criteria": ["a"]}, {"label": "(1)", "points": 2, "criteria": ["b"]}]):
        with pytest.raises(RubricError):
            clean_parts(bad)


def test_choice_scoring_gives_half_marks_for_a_correct_subset():
    assert choice_score("single_choice", "B", "B", 4) == 4
    assert choice_score("single_choice", "B", "C", 4) == 0
    assert choice_score("multiple_choice", "ACD", "ACD", 6) == 6
    assert choice_score("multiple_choice", "ACD", "AC", 6) == 3
    # 高考 rule: one wrong option voids the answer, even beside correct ones.
    assert choice_score("multiple_choice", "ACD", "AB", 6) == 0
    assert choice_score("multiple_choice", "ACD", "ACDB", 6) == 0
    assert choice_score("multiple_choice", "ACD", "", 6) == 0
    assert choice_score("multiple_choice", "AC", "C", 5) == 2.5
    assert choice_score("multiple_choice", "ACD", "AB", 6) == 0
    assert choice_score("multiple_choice", "ACD", "", 6) == 0
    assert choice_score("single_choice", "", "A", 4) is None


@pytest.mark.asyncio
async def test_publishing_drafts_missing_rubrics_and_operators_can_still_maintain_them(db_session, tmp_path):
    drafter = FakeDrafter()
    async with client_for(grading_app(db_session, tmp_path, FakeRecognizer([]), FakeGrader([]), drafter)) as client:
        await published_homework(client, db_session)
        rubrics = (await db_session.execute(select(QuestionRubric).order_by(QuestionRubric.question_id))).scalars().all()
        assert [(r.question_id, r.status) for r in rubrics] == [("q_p1", "draft"), ("q_x1", "draft")]
        assert {call["满分"] for call in drafter.calls} == {12.0, 8.0}
        metered = (await db_session.execute(select(TeacherAiCall).where(TeacherAiCall.purpose == "rubric_draft"))).scalars().all()
        assert len(metered) == 2 and all(call.teacher_id == "platform" for call in metered)

        listed = await client.get("/api/admin/rubrics", params={"status": "draft"})
        assert listed.json()["total"] == 2 and listed.json()["items"][0]["question"]["stem_text"]

        bad = await client.put("/api/admin/rubrics/q_p1", json={
            "approve": True, "parts": [{"label": "(1)", "points": 0.3, "criteria": ["x"]}],
        })
        assert bad.status_code == 400
        approved = await client.put("/api/admin/rubrics/q_p1", json={"approve": True, "parts": RUBRIC_Q_P1})
        assert approved.json()["status"] == "approved" and approved.json()["total_points"] == 10
        rejected = await client.put("/api/admin/rubrics/q_x1", json={"approve": False, "note": "采分点不完整"})
        assert rejected.json()["status"] == "rejected"
        redraft = await client.post("/api/admin/rubrics/q_x1/draft")
        assert redraft.status_code == 202
        assert (await db_session.get(QuestionRubric, "q_x1")).status == "draft"


async def collected_homework(client, db_session, recognizer):
    """Three collected copies: Alice and Bob authorized, Carol not."""
    token, class_id, assignment_id, students, numbers = await published_homework(client, db_session)
    await authorize(client, class_id, [students["alice_s"], students["bob_s"]])
    recognizer.numbers = [numbers["alice_s"], numbers["bob_s"], numbers["carol_s"]]
    recognizer.choices = [{1: "A", 2: "A"}, {1: "A", 2: "B"}]
    pdf = to_pdf(copy_pages(numbers["alice_s"], 1) + copy_pages(numbers["bob_s"], 10) + copy_pages(numbers["carol_s"], 20))
    await upload(client, token, assignment_id, pdf)
    return token, assignment_id, students


def full_marks():
    return [
        {"number": 3, "parts": [{"label": "(1)", "score": 5, "reason": "公式与结果正确"},
                                {"label": "(2)", "score": 7, "reason": "方向和两个时刻都正确"}],
         "score": 12, "error_type": "none", "feedback": "很好", "confidence": 0.95, "needs_human_review": False},
        {"number": 4, "parts": [], "score": 8, "error_type": "none", "feedback": "完整", "confidence": 0.95},
    ]


def partial_marks():
    return [
        {"number": 3, "parts": [{"label": "(1)", "score": 5, "reason": "正确"},
                                {"label": "(2)", "score": 3.2, "reason": "漏了方向"}],
         "score": 8, "error_type": "unit_direction", "first_error": "没有说明速度方向",
         "feedback": "注意矢量方向", "confidence": 0.9},
        {"number": 4, "parts": [], "score": 9, "error_type": "calculation", "confidence": 0.3, "needs_human_review": True},
    ]


@pytest.mark.asyncio
async def test_pre_grading_review_release_and_report(db_session, tmp_path):
    recognizer, grader = FakeRecognizer([]), FakeGrader([full_marks(), partial_marks()])
    async with client_for(grading_app(db_session, tmp_path, recognizer, grader)) as client:
        token, assignment_id, students = await collected_homework(client, db_session, recognizer)
        await RubricService(db_session).review("q_p1", parts=RUBRIC_Q_P1, approve=True, note=None, reviewer="admin:t")
        base = f"/api/teacher/assignments/{assignment_id}"

        assert (await client.get(f"{base}/report", headers=bearer(token))).status_code == 409
        started = await client.post(f"{base}/grading", headers=bearer(token))
        assert started.status_code == 202 and started.json()["total"] == 2
        # Only authorized students' answer areas reach AI; Carol waits for the teacher.
        assert grader.calls == [(2, [3, 4]), (2, [3, 4])]
        assert (await client.post(f"{base}/grading", headers=bearer(token))).status_code == 400

        review = (await client.get(f"{base}/review", headers=bearer(token))).json()
        assert review["run"]["status"] == "done" and review["run"]["done"] == 2
        q3, q4 = review["questions"][2], review["questions"][3]
        assert (q3["rubric_status"], [p["points"] for p in q3["rubric_parts"]]) == ("approved", [5.0, 7.0])
        assert (q3["auto_passed"], q3["pending"]) == (1, 2)
        assert (q4["rubric_status"], q4["rubric_parts"], q4["pending"]) == ("drafting", None, 3)
        assert review["questions"][0]["distribution"] == {"A": 2, "未作答": 1}

        entries = {e["display_name"]: e for e in (await client.get(f"{base}/review/3", headers=bearer(token))).json()}
        assert entries["Alice"]["grade_status"] == "auto_passed" and entries["Alice"]["score"] == 12
        assert entries["Bob"]["grade_status"] == "needs_review" and entries["Bob"]["score"] == 8
        assert entries["Bob"]["part_scores"][1] == {"label": "(2)", "points": 7.0, "score": 3.0, "reason": "漏了方向"}
        assert entries["Bob"]["error_type_name"] == "单位或方向错误"
        assert entries["Carol"]["grade_status"] == "manual" and entries["Carol"]["image_url"]

        grade = lambda item, body: client.put(f"/api/teacher/submission-items/{item}/grade", headers=bearer(token), json=body)
        assert (await grade(entries["Bob"]["item_id"], {"part_scores": [{"label": "(1)", "score": 5}, {"label": "(2)", "score": 7.5}]})).status_code == 400
        assert (await grade(entries["Bob"]["item_id"], {"score": 10})).status_code == 400
        assert (await grade(entries["Bob"]["item_id"], {"part_scores": [{"label": "(1)", "score": 5}, {"label": "(2)", "score": 4}],
                                                        "error_type": "bogus"})).status_code == 400
        assert (await grade(entries["Bob"]["item_id"], {"part_scores": [{"label": "(1)", "score": 5}, {"label": "(2)", "score": 4}],
                                                        "comment": "方向说明不完整"})).status_code == 204
        assert (await grade(entries["Carol"]["item_id"], {"part_scores": [{"label": "(1)", "score": 3}, {"label": "(2)", "score": 0}],
                                                          "error_type": "equation_setup"})).status_code == 204
        confirmed = await client.post(f"{base}/review/3/confirm-auto", headers=bearer(token))
        assert confirmed.json() == {"confirmed": 1}

        q4_entries = {e["display_name"]: e for e in (await client.get(f"{base}/review/4", headers=bearer(token))).json()}
        assert (await grade(q4_entries["Alice"]["item_id"], {"score": 8})).status_code == 204
        assert (await grade(q4_entries["Bob"]["item_id"], {"score": 8.5})).status_code == 400
        assert (await grade(q4_entries["Bob"]["item_id"], {"score": 6.5})).status_code == 204
        blocked = await client.post(f"{base}/release", headers=bearer(token))
        assert blocked.status_code == 409 and "1 份作答" in blocked.json()["detail"] and "2 道选择题" in blocked.json()["detail"]

        assert (await grade(q4_entries["Carol"]["item_id"], {"score": 2})).status_code == 204
        collection = (await client.get(f"{base}/collection", headers=bearer(token))).json()
        carol_submission = next(r for r in collection["students"] if r["display_name"] == "Carol")["submission"]["id"]
        for number, answer in ((1, "A"), (2, "C")):
            await client.put(f"/api/teacher/submissions/{carol_submission}/choices/{number}", headers=bearer(token),
                             json={"answer": answer})
        released = await client.post(f"{base}/release", headers=bearer(token))
        assert released.status_code == 204
        assert (await client.post(f"{base}/release", headers=bearer(token))).status_code == 409
        assert (await grade(q4_entries["Bob"]["item_id"], {"score": 8})).status_code == 409

        report = (await client.get(f"{base}/report", headers=bearer(token))).json()
        csv_response = await client.get(f"{base}/report.csv", headers=bearer(token))

    totals = {row["display_name"]: row["total"] for row in report["students"]}
    # Every choice key is "A". Alice: A,A -> 8, 12 + 8; Bob: A,B -> 4, 9 + 6.5; Carol: A,C -> 4, 3 + 2.
    assert totals == {"Alice": 28.0, "Bob": 19.5, "Carol": 9.0}
    assert report["total_points"] == 28 and report["collected"] == 3 and report["class_size"] == 3
    assert report["average"] == 18.83 and report["highest"] == 28 and report["lowest"] == 9
    by_number = {q["number"]: q for q in report["questions"]}
    assert by_number[1]["rate"] == 1.0 and by_number[2]["rate"] == 0.3333
    assert [(p["label"], p["rate"]) for p in by_number[3]["parts"]] == [("(1)", 0.8667), ("(2)", 0.5238)]
    assert {e["name"] for e in report["errors"]} == {"单位或方向错误", "方程建立错误", "数学处理错误"}
    assert [a["display_name"] for a in report["attention"]] == ["Carol"]
    assert csv_response.text.startswith("﻿学号,姓名,总分,与平均分差,第1题")
    assert "Carol" in csv_response.text and "attachment" in csv_response.headers["content-disposition"]

    mastery = (await db_session.execute(select(StudentMastery).where(StudentMastery.knowledge_point_id == "kp_motion"))).scalars().all()
    assert {m.student_id for m in mastery} == {s.id for s in students.values()}
    assert all(m.attempts == 4 for m in mastery)
    # Evidence accumulates: the strongest paper ends highest, and no single item overwrites the rest.
    by_student = {m.student_id: m.mastery for m in mastery}
    assert by_student[students["alice_s"].id] > by_student[students["bob_s"].id] > by_student[students["carol_s"].id]
    assert by_student[students["carol_s"].id] != pytest.approx(2 / 8)


@pytest.mark.asyncio
async def test_failed_or_capped_grading_goes_to_review(db_session, tmp_path):
    class Broken:
        calls = 0

        async def grade(self, images, questions):
            Broken.calls += 1
            raise RuntimeError("provider down")

    recognizer = FakeRecognizer([])
    async with client_for(grading_app(db_session, tmp_path, recognizer, Broken())) as client:
        token, assignment_id, _ = await collected_homework(client, db_session, recognizer)
        await client.post(f"/api/teacher/assignments/{assignment_id}/grading", headers=bearer(token))
        review = (await client.get(f"/api/teacher/assignments/{assignment_id}/review", headers=bearer(token))).json()
        entries = (await client.get(f"/api/teacher/assignments/{assignment_id}/review/3", headers=bearer(token))).json()
    assert review["run"]["status"] == "done" and "失败" in review["run"]["error"]
    assert {e["grade_status"] for e in entries} == {"needs_review", "manual"}
    # Each of the two authorized students was tried twice before falling back to the teacher.
    assert Broken.calls == 4


@pytest.mark.asyncio
async def test_another_teacher_cannot_grade_or_read_reports(db_session, tmp_path):
    recognizer = FakeRecognizer([])
    async with client_for(grading_app(db_session, tmp_path, recognizer, FakeGrader([full_marks(), full_marks()]))) as client:
        token, assignment_id, _ = await collected_homework(client, db_session, recognizer)
        from tests.test_teacher_accounts import ready_teacher
        _, other = await ready_teacher(client, "li", "李老师")
        base = f"/api/teacher/assignments/{assignment_id}"
        for method, path in (("post", "/grading"), ("get", "/review"), ("get", "/review/3"),
                             ("post", "/review/3/confirm-auto"), ("post", "/release"), ("get", "/report")):
            response = await getattr(client, method)(f"{base}{path}", headers=bearer(other))
            assert response.status_code == 404, path
        entries = (await client.get(f"{base}/review/3", headers=bearer(token))).json()
        foreign = await client.put(f"/api/teacher/submission-items/{entries[0]['item_id']}/grade",
                                   headers=bearer(other), json={"score": 1})
        assert foreign.status_code == 404


@pytest.mark.asyncio
async def test_grading_migration_downgrades_and_upgrades(db_session):
    spec = importlib.util.spec_from_file_location(
        "grading_migration", Path(__file__).resolve().parents[1] / "alembic/versions/0039_teacher_grading.py",
    )
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    def run(connection, step):
        with Operations.context(MigrationContext.configure(connection)):
            step()
        tables = {row[0] for row in connection.execute(text(
            "SELECT table_name FROM information_schema.tables WHERE table_name IN ('question_rubrics', 'teacher_grading_runs')"
        ))}
        columns = {row[0] for row in connection.execute(text(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'teacher_submission_items'"
        ))}
        return tables, "part_scores" in columns

    connection = await db_session.connection()
    assert await connection.run_sync(lambda c: run(c, migration.downgrade)) == (set(), False)
    assert await connection.run_sync(lambda c: run(c, migration.upgrade)) == (
        {"question_rubrics", "teacher_grading_runs"}, True,
    )
    await db_session.commit()


@pytest.mark.asyncio
async def test_grading_stops_calling_ai_at_the_assignment_cap(db_session, tmp_path, monkeypatch):
    from app.core.config import settings

    # Collecting used 5 calls (3 numbers, 2 choice strips); a cap of 2 per student leaves room for one more.
    monkeypatch.setattr(settings, "teacher_ai_calls_per_student", 2)
    recognizer, grader = FakeRecognizer([]), FakeGrader([full_marks(), full_marks()])
    async with client_for(grading_app(db_session, tmp_path, recognizer, grader)) as client:
        token, assignment_id, _ = await collected_homework(client, db_session, recognizer)
        await client.post(f"/api/teacher/assignments/{assignment_id}/grading", headers=bearer(token))
        review = (await client.get(f"/api/teacher/assignments/{assignment_id}/review", headers=bearer(token))).json()
        entries = (await client.get(f"/api/teacher/assignments/{assignment_id}/review/4", headers=bearer(token))).json()
    assert len(grader.calls) == 1
    assert "上限" in review["run"]["error"]
    errors = sorted(e["ai_error"] or "" for e in entries if e["ai_authorized"])
    assert errors[0] == "" and "上限" in errors[1]


@pytest.mark.asyncio
async def test_released_choices_move_mastery_like_practice():
    calls = []

    class Students:
        async def update_mastery(self, student_id, kp, correct, commit):
            calls.append(("tracing", student_id, kp, correct))

        async def update_mastery_with_score(self, student_id, kp, credit, evidence_weight, commit):
            calls.append(("score", student_id, kp, credit, evidence_weight))

    for credit in (1.0, 0.0, 0.5):
        await release_choice_mastery(Students(), "s_1", "kp_motion", credit)
    assert calls == [("tracing", "s_1", "kp_motion", True), ("tracing", "s_1", "kp_motion", False),
                     ("score", "s_1", "kp_motion", 0.5, 0.55)]


def test_part_scores_follow_the_criteria_the_model_found_met():
    steps = ["换算 $v_0=10\\,\\mathrm{m/s}$ 得 2 分", "写出 $v=v_0+at$ 得 1 分", "结果 $24\\,\\mathrm{m/s}$ 得 1 分"]
    assert criteria_score(steps, [False, True, True], 4, 4) == 2
    # Scaled to the points this paper gives the part, in half points.
    assert criteria_score(steps, [True, True, False], 6, 4) == 4.5
    # Alternatives are not additive (2 + 1 + 0 is not the part's 2 points): the model's score stands.
    choices = ["选 A、C 得 2 分", "只选 A 或只选 C 得 1 分", "错选得 0 分"]
    assert criteria_score(choices, [False, True, False], 2, 2) is None
    assert criteria_score(steps, [True, True], 4, 4) is None
    assert criteria_score(steps, ["yes", True, True], 4, 4) is None
    assert criteria_score(["两个时刻速度各 2 分"], [True], 4, 4) is None


@pytest.mark.asyncio
async def test_a_failed_pre_grading_call_is_tried_once_more(db_session, tmp_path):
    class FlakyGrader(FakeGrader):
        failed = False

        async def grade(self, images, questions):
            if not self.failed:
                self.failed = True
                self.calls.append((len(images), [q["number"] for q in questions]))
                raise TimeoutError("provider timed out")
            return await super().grade(images, questions)

    recognizer, grader = FakeRecognizer([]), FlakyGrader([full_marks(), partial_marks()])
    async with client_for(grading_app(db_session, tmp_path, recognizer, grader)) as client:
        token, assignment_id, _ = await collected_homework(client, db_session, recognizer)
        await client.post(f"/api/teacher/assignments/{assignment_id}/grading", headers=bearer(token))
        review = (await client.get(f"/api/teacher/assignments/{assignment_id}/review", headers=bearer(token))).json()
        entries = (await client.get(f"/api/teacher/assignments/{assignment_id}/review/3", headers=bearer(token))).json()
    assert len(grader.calls) == 3 and review["run"]["error"] is None
    assert sorted(e["score"] for e in entries if e["ai_authorized"]) == [8, 12]


def test_a_reworded_prompt_is_not_answered_from_the_cache(monkeypatch):
    import app.services.teacher_ai_service as ai_module
    before = TeacherAiService.digest("choices", b"crop")
    monkeypatch.setitem(ai_module._CACHED_PROMPTS, "choices", ai_module.CHOICES_PROMPT + "（改）")
    assert TeacherAiService.digest("choices", b"crop") != before


@pytest.mark.asyncio
async def test_ai_drafts_grade_by_part_at_once_and_teachers_confirm_the_shared_rubric(db_session, tmp_path):
    """No approval queue: an AI draft grades by part (and passes sure full marks) right away; a
    teacher corrects it while reviewing, for every teacher and, if nothing was graded by hand yet,
    for this homework too."""
    recognizer, grader, drafter = FakeRecognizer([]), FakeGrader([full_marks(), partial_marks()]), FakeDrafter()
    app = grading_app(db_session, tmp_path, recognizer, grader)

    def service():
        return TeacherGradingService(db_session, TeacherAiService(db_session, recognizer), grader, root=tmp_path,
                                     rubric_drafter=drafter)

    async def run(run_id: str):
        await service().process_run(run_id)

    app.dependency_overrides[get_grading_service] = service
    app.dependency_overrides[get_grading_runner] = lambda: run
    async with client_for(app) as client:
        token, assignment_id, students = await collected_homework(client, db_session, recognizer)
        await RubricService(db_session, drafter).draft("q_p1", default_points=12)  # an unconfirmed AI draft
        broken = await db_session.get(QuestionRubric, "q_x1")
        broken.status = "failed"  # a draft that never came through is drafted before pre-grading
        await db_session.commit()
        base = f"/api/teacher/assignments/{assignment_id}"
        assert (await client.post(f"{base}/grading", headers=bearer(token))).status_code == 202

        review = (await client.get(f"{base}/review", headers=bearer(token))).json()
        q3, q4 = review["questions"][2], review["questions"][3]
        assert (q3["rubric_status"], [p["points"] for p in q3["rubric_parts"]]) == ("draft", [5.0, 7.0])
        assert q3["auto_passed"] == 1 and q3["rubric_applies_here"] is True and q3["rubric_confirmed_by"] is None
        assert q4["rubric_status"] == "draft" and q4["rubric_parts"]

        # A teacher corrects question 3: shared from now on, and this homework's AI grades are redone.
        corrected = [{"label": "(1)", "points": 6, "criteria": ["写出公式得 3 分", "结果得 3 分"]},
                     {"label": "(2)", "points": 6, "criteria": ["方向得 2 分", "两个时刻各 2 分"]}]
        saved = await client.put(f"{base}/review/3/rubric", headers=bearer(token), json={"parts": corrected})
        assert saved.status_code == 200 and saved.json() == {"applied": True, "regrade": 2}
        shared = await db_session.get(QuestionRubric, "q_p1")
        assert shared.status == "approved" and shared.reviewed_by.startswith("teacher:")
        review = (await client.get(f"{base}/review", headers=bearer(token))).json()
        q3 = review["questions"][2]
        assert [p["points"] for p in q3["rubric_parts"]] == [6.0, 6.0] and q3["rubric_confirmed_by"] == "王老师"
        entries = {e["display_name"]: e for e in (await client.get(f"{base}/review/3", headers=bearer(token))).json()}
        assert entries["Alice"]["grade_status"] == entries["Bob"]["grade_status"] == "ungraded"

        # Once an answer was graded by hand, a correction waits for the next homework.
        q4_entries = {e["display_name"]: e for e in (await client.get(f"{base}/review/4", headers=bearer(token))).json()}
        parts = [{"label": p["label"], "score": 0} for p in q4["rubric_parts"]]
        assert (await client.put(f"/api/teacher/submission-items/{q4_entries['Carol']['item_id']}/grade",
                                 headers=bearer(token), json={"part_scores": parts})).status_code == 204
        later = await client.put(f"{base}/review/4/rubric", headers=bearer(token), json={"parts": corrected})
        assert later.json()["applied"] is False
        assert (await client.put(f"{base}/review/1/rubric", headers=bearer(token), json={"parts": corrected})).status_code == 400
        assert (await client.put(f"{base}/review/3/rubric", headers=bearer(token),
                                 json={"parts": [{"label": "(1)", "points": 0.3, "criteria": ["x"]}]})).status_code == 400
