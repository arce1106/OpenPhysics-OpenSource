"""Personalized homework (teacher app P2): drafting rules, teacher review and publishing."""
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.models.knowledge import KnowledgePoint
from app.models.student import StudentAnswer, StudentMastery
from app.models.teacher import TeacherStudentPaper
from app.services.personalized_service import Candidate, Evidence, WrongAnswer, draft_paper
from tests.test_teacher_accounts import bearer, build_app, client_for
from tests.test_teacher_assignments import add_question, setup_class


def candidate(qid, kp="kp_a", choice=True, tier="medium", model=None):
    return Candidate(id=qid, kp_id=kp, choice=choice, tier=tier, model=model)


POOL = {
    "kp_a": [candidate("a_easy", tier="easy"), candidate("a_mid", model="m1"), candidate("a_mid2"),
             candidate("a_hard", tier="moderate_hard"), candidate("a_calc", choice=False)],
    "kp_b": [candidate("b_easy", kp="kp_b", tier="easy"), candidate("b_mid", kp="kp_b"),
             candidate("b_calc", kp="kp_b", choice=False, tier="moderate_easy")],
    "kp_c": [candidate("c_mid", kp="kp_c"), candidate("c_up", kp="kp_c", tier="moderate_hard"),
             candidate("c_calc", kp="kp_c", choice=False)],
}
NAMES = {"kp_a": "匀变速直线运动", "kp_b": "自由落体", "kp_c": "牛顿第二定律"}


def by_rule(items):
    return {item["question_id"]: (item["rule"], item["reason"]) for item in items}


def test_a_recent_mistake_brings_a_same_model_variation_no_harder():
    evidence = Evidence(
        done={"a_mid"},
        wrong=[WrongAnswer(candidate("a_mid", model="m1"), "unit_direction", "《单元测验》第 3 题")],
    )
    pool = {**POOL, "kp_a": [*POOL["kp_a"], candidate("a_same_model", model="m1")]}
    items = draft_paper(evidence, pool, NAMES, choice_count=1, area_count=0)
    assert items == [{
        "question_id": "a_same_model", "rule": "same_error",
        "reason": "《单元测验》第 3 题因“单位或方向错误”做错，推同模型变式",
        "source_question_id": "a_mid", "error_type": "unit_direction",
    }]


def test_rules_fill_slots_in_order_and_never_repeat_done_questions():
    evidence = Evidence(
        done={"a_mid", "b_easy"},
        wrong=[WrongAnswer(candidate("a_mid"), None, "App 练习中")],
        mastery={"kp_b": 0.2, "kp_c": 0.9},
        attempts={"kp_b": 5, "kp_c": 8},
        recent_correct={"kp_c": "medium"},
    )
    items = draft_paper(evidence, POOL, NAMES, choice_count=2, area_count=1)
    rules = by_rule(items)
    # Same tier as the missed question when there is one, never harder.
    assert rules["a_mid2"] == ("same_error", "App 练习中做错，推同知识点变式")
    assert rules["b_mid"] == ("weak_kp", "“自由落体”掌握度 20%（薄弱），补练中等题")
    # Only a worked slot is left and kp_c has no harder worked question: practise again, not "up".
    assert rules["c_calc"] == ("step_up", "最近“牛顿第二定律”中等题做对，再练一道巩固")
    assert not {"a_mid", "b_easy"} & set(rules)
    # Choice questions lead the paper.
    assert [item["question_id"] for item in items] == ["a_mid2", "b_mid", "c_calc"]


def test_classmates_with_the_same_evidence_get_different_questions_but_each_draft_is_stable():
    def ids(seed):
        return [item["question_id"] for item in draft_paper(Evidence(), POOL, NAMES, 2, 1, seed=seed)]
    drafts = {seed: ids(seed) for seed in ("s_1", "s_2", "s_3", "s_4")}
    assert len({tuple(paper) for paper in drafts.values()}) > 1
    assert ids("s_1") == drafts["s_1"]


def test_a_correct_answer_steps_up_a_tier_when_it_can():
    evidence = Evidence(recent_correct={"kp_c": "medium"}, attempts={"kp_a": 9, "kp_b": 9})
    items = draft_paper(evidence, POOL, NAMES, choice_count=1, area_count=0)
    assert by_rule(items) == {"c_up": ("step_up", "最近“牛顿第二定律”中等题做对，升一级练较难题")}


def test_a_student_without_answers_gets_coverage_with_a_plain_reason():
    items = draft_paper(Evidence(), POOL, NAMES, choice_count=3, area_count=1)
    assert len(items) == 4 and {item["rule"] for item in items} == {"coverage"}
    assert all(item["reason"].startswith("暂无足够作答数据") for item in items)
    # One knowledge point per question while there are enough of them.
    kps = [next(kp for kp, options in POOL.items() if any(c.id == item["question_id"] for c in options))
           for item in items]
    assert len(set(kps[:3])) == 3


async def setup_scope(db_session):
    db_session.add_all([
        KnowledgePoint(id="kp_motion", name="匀变速直线运动", volume="必修一", chapter="匀变速直线运动", section="1.速度"),
        KnowledgePoint(id="kp_fall", name="自由落体", volume="必修一", chapter="匀变速直线运动", section="2.自由落体"),
        KnowledgePoint(id="kp_force", name="牛顿第二定律", volume="必修一", chapter="运动和力的关系"),
    ])
    await db_session.commit()
    for qid in ("m_c1", "m_c2", "m_c3"):
        await add_question(db_session, qid, "single_choice")
    await add_question(db_session, "m_easy", "single_choice", tier="easy")
    await add_question(db_session, "m_p1", "problem_solving", answer="v=10 m/s")
    for qid in ("f_c1", "f_c2"):
        await add_question(db_session, qid, "single_choice", kp="kp_fall")
    await add_question(db_session, "f_p1", "problem_solving", kp="kp_fall", answer="h=5 m")
    await add_question(db_session, "n_c1", "single_choice", kp="kp_force")


@pytest.mark.asyncio
async def test_teacher_drafts_reviews_and_publishes_one_paper_per_student(db_session):
    await setup_scope(db_session)
    async with client_for(build_app(db_session)) as client:
        token, class_id, students = await setup_class(db_session, client)
        alice, bob = students
        # Alice got m_c1 wrong in the app; Bob has never answered anything.
        db_session.add(StudentAnswer(student_id=alice.id, question_id="m_c1", given_answer="B", is_correct=False,
                                     grading_result={"error_type": "concept_misunderstanding"}))
        db_session.add(StudentMastery(student_id=alice.id, knowledge_point_id="kp_fall", mastery=0.25, attempts=4,
                                      last_practiced=datetime.now(timezone.utc)))
        alice.last_login_at = datetime.now(timezone.utc)
        await db_session.commit()

        bad = await client.post(f"/api/teacher/classes/{class_id}/personalized", headers=bearer(token),
                                json={"title": "第一周个性化作业", "scope": [{"volume": "必修三"}]})
        assert bad.status_code == 400
        created = await client.post(f"/api/teacher/classes/{class_id}/personalized", headers=bearer(token), json={
            "title": "第一周个性化作业",
            "scope": [{"volume": "必修一", "chapter": "匀变速直线运动"}],
            "choice_count": 2, "area_count": 1,
        })
        assert created.status_code == 201, created.text
        detail = created.json()
        assert detail["kind"] == "personalized" and detail["question_count"] == 3
        papers = {paper["display_name"]: paper for paper in detail["papers"]}
        alice_items = papers["Alice"]["items"]
        assert alice_items[0]["rule"] == "same_error" and "概念理解错误" in alice_items[0]["reason"]
        assert "m_c1" not in {item["question_id"] for item in alice_items}
        assert any(item["rule"] == "weak_kp" for item in alice_items)
        assert {item["rule"] for item in papers["Bob"]["items"]} == {"coverage"}
        # Out-of-scope knowledge points never appear.
        assert all(item["question"]["primary_kp"]["id"] != "kp_force" for paper in papers.values() for item in paper["items"])
        assert (papers["Alice"]["delivery"], papers["Bob"]["delivery"]) == ("app", "paper")

        assignment_id = detail["id"]
        base = f"/api/teacher/assignments/{assignment_id}/papers"
        first = alice_items[0]["question_id"]
        options = (await client.get(f"{base}/{alice.id}/alternatives", headers=bearer(token),
                                    params={"question_id": first})).json()
        assert options and all(o["id"] not in {"m_c1", *(i["question_id"] for i in alice_items)} for o in options)
        swapped = [{"question_id": options[0]["id"]}] + [{"question_id": i["question_id"]} for i in alice_items[1:]]
        updated = await client.put(f"{base}/{alice.id}", headers=bearer(token),
                                   json={"items": swapped, "delivery": "paper"})
        alice_paper = next(p for p in updated.json()["papers"] if p["display_name"] == "Alice")
        assert alice_paper["delivery"] == "paper"
        assert alice_paper["items"][0]["question_id"] == options[0]["id"]
        # Keeps the reasons of untouched questions.
        assert alice_paper["items"][1]["reason"] == alice_items[1]["reason"]
        done = await client.put(f"{base}/{alice.id}", headers=bearer(token), json={"items": [{"question_id": "m_c1"}]})
        assert done.status_code == 400 and "做过" in done.json()["detail"]
        assert (await client.put(f"/api/teacher/assignments/{assignment_id}", headers=bearer(token),
                                 json={"items": [{"question_id": "m_c2"}]})).status_code == 400

        assert (await client.post(f"{base}/{bob.id}/redraft", headers=bearer(token))).status_code == 200
        published = await client.post(f"/api/teacher/assignments/{assignment_id}/publish", headers=bearer(token))
        assert published.status_code == 200, published.text
        assert (await client.put(f"{base}/{bob.id}", headers=bearer(token), json={"delivery": "app"})).status_code == 409  # published

    stored = (await db_session.execute(select(TeacherStudentPaper))).scalars().all()
    assert len(stored) == 2 and all(paper.question_snapshot for paper in stored)
    assert all(len(paper.question_snapshot) == len(paper.items) for paper in stored)


@pytest.mark.asyncio
async def test_each_students_own_paper_is_collected_graded_and_reported(db_session, tmp_path):
    from tests.scan_fixtures import homework_pages, scanned, to_pdf
    from tests.test_teacher_grading import FakeGrader, grading_app
    from tests.test_teacher_scans import FakeRecognizer, authorize, upload

    await setup_scope(db_session)
    recognizer = FakeRecognizer([])
    grader = FakeGrader([[{"number": 3, "parts": [], "score": 8, "error_type": "calculation", "confidence": 0.9}],
                         [{"number": 3, "parts": [], "score": 12, "error_type": "none", "confidence": 0.9}]])
    async with client_for(grading_app(db_session, tmp_path, recognizer, grader)) as client:
        token, class_id, students = await setup_class(db_session, client)
        alice, bob = students
        db_session.add(StudentAnswer(student_id=alice.id, question_id="m_c1", given_answer="B", is_correct=False,
                                     grading_result={"error_type": "concept_misunderstanding"}))
        await db_session.commit()
        await client.post(f"/api/teacher/classes/{class_id}/members/auto-number", headers=bearer(token))
        await authorize(client, class_id, students)
        detail = (await client.post(f"/api/teacher/classes/{class_id}/personalized", headers=bearer(token), json={
            "title": "个性化作业", "scope": [{"chapter": "匀变速直线运动"}], "choice_count": 2, "area_count": 1,
        })).json()
        assignment_id = detail["id"]
        await client.post(f"/api/teacher/assignments/{assignment_id}/publish", headers=bearer(token))
        published = (await client.get(f"/api/teacher/assignments/{assignment_id}", headers=bearer(token))).json()
        papers = {p["display_name"]: p for p in published["papers"]}
        assert {p["student_number"] for p in papers.values()} == {"1", "2"}
        assert papers["Alice"]["items"][0]["rule"] == "same_error"

        # Two different papers; Alice misses her same-error variation again.
        recognizer.numbers = [papers["Alice"]["student_number"], papers["Bob"]["student_number"]]
        recognizer.choices = [{1: "B", 2: "A"}, {1: "A", 2: "A"}]
        pages = []
        for seed, name in ((1, "Alice"), (9, "Bob")):
            pages += [scanned(page, angle=0.5, seed=seed + i) for i, page in enumerate(homework_pages(
                number=papers[name]["student_number"], choices=["A", "B"], area_heights=[70], seed=seed,
                stem_table=False))]
        await upload(client, token, assignment_id, to_pdf(pages))
        collection = (await client.get(f"/api/teacher/assignments/{assignment_id}/collection",
                                       headers=bearer(token))).json()
        assert collection["collected"] == 2 and collection["exceptions"] == []

        await client.post(f"/api/teacher/assignments/{assignment_id}/grading", headers=bearer(token))
        review = (await client.get(f"/api/teacher/assignments/{assignment_id}/review", headers=bearer(token))).json()
        # Reviewed by question: each distinct question once, answered by whoever received it.
        expected = {item["question_id"] for p in papers.values() for item in p["items"]}
        assert {q["question_id"] for q in review["questions"]} == expected
        assert sum(q["collected"] for q in review["questions"]) == 6
        for question in review["questions"]:
            if question["kind"] != "area":
                continue
            for entry in (await client.get(f"/api/teacher/assignments/{assignment_id}/review/{question['number']}",
                                           headers=bearer(token))).json():
                assert entry["max_score"] == 12
                graded = await client.put(f"/api/teacher/submission-items/{entry['item_id']}/grade",
                                          headers=bearer(token), json={"score": entry["score"]})
                assert graded.status_code == 204, graded.text
        released = await client.post(f"/api/teacher/assignments/{assignment_id}/release", headers=bearer(token))
        assert released.status_code == 204, released.text
        report = (await client.get(f"/api/teacher/assignments/{assignment_id}/report", headers=bearer(token))).json()

    rows = {row["display_name"]: row for row in report["students"]}
    assert report["kind"] == "personalized" and report["positions"] == [1, 2, 3]
    assert rows["Alice"]["full_points"] == 20 and set(rows["Alice"]["scores"]) == {"1", "2", "3"}
    assert report["same_error"]["questions"] == 1 and report["same_error"]["missed_again"] == 1
    assert report["same_error"]["by_error"][0]["name"] == "概念理解错误"


@pytest.mark.asyncio
async def test_app_students_answer_in_the_app_and_their_answers_reach_the_teacher(db_session, tmp_path, monkeypatch):
    from app.api.student.router import router as student_router
    from app.models.student import Student
    from app.models.teacher_paper import TeacherPaperAttempt
    from app.services.ai_service import AIService
    from app.services.student_service import StudentService
    from tests.test_teacher_grading import FakeGrader, grading_app
    from tests.test_teacher_scans import FakeRecognizer

    async def judge(self, **kwargs):
        return {"is_correct": False, "feedback": "第二步代入错了", "process_score": 50,
                "error_type": "calculation", "confidence": 0.9}
    monkeypatch.setattr(AIService, "judge_answer", judge)

    await setup_scope(db_session)
    app = grading_app(db_session, tmp_path, FakeRecognizer([]), FakeGrader([]))
    app.include_router(student_router)
    async with client_for(app) as client:
        token, class_id, students = await setup_class(db_session, client)
        alice, bob = students
        alice.last_login_at = datetime.now(timezone.utc)
        await db_session.commit()
        detail = (await client.post(f"/api/teacher/classes/{class_id}/personalized", headers=bearer(token), json={
            "title": "App 作业", "scope": [{"chapter": "匀变速直线运动"}], "choice_count": 2, "area_count": 1,
        })).json()
        assignment_id = detail["id"]
        await client.post(f"/api/teacher/assignments/{assignment_id}/publish", headers=bearer(token))

        student = bearer(StudentService.create_access_token(alice.id, alice.auth_version))
        listed = (await client.get("/api/student/teacher-homework", headers=student)).json()
        assert [(h["title"], h["question_count"], h["status"]) for h in listed] == [("App 作业", 3, "in_progress")]
        # Bob prints his paper: nothing in his app.
        assert (await client.get("/api/student/teacher-homework",
                                 headers=bearer(StudentService.create_access_token(bob.id, bob.auth_version)))).json() == []

        attempt_id = listed[0]["attempt_id"]
        session = (await client.post(f"/api/student/teacher-homework/{attempt_id}/session", headers=student)).json()
        assert session["session_objective"] == "老师作业「App 作业」"
        assert session["teacher_paper"]["status"] == "in_progress"
        questions = session["questions"]
        assert [q["id"] for q in questions] == [i["question_id"] for i in
                                                next(p for p in detail["papers"] if p["display_name"] == "Alice")["items"]]

        assert (await client.post(f"/api/student/teacher-paper-attempts/{attempt_id}/submit", headers=student)).status_code == 200
        for index, question in enumerate(questions):
            answer = "A" if question.get("options") else "v=10 m/s"
            response = await client.post("/api/student/practice/submit", headers=student, json={
                "question_id": question["id"], "given_answer": "B" if index == 1 else answer,
                "teacher_paper_attempt_id": attempt_id,
            })
            assert response.status_code == 200, response.text

        attempt = await db_session.get(TeacherPaperAttempt, attempt_id)
        await db_session.refresh(attempt)
        assert attempt.status == "completed"
        # Out of 100 on the teacher's points: first choice right, second wrong, the worked one half.
        points = [i["points"] for i in next(p for p in detail["papers"] if p["display_name"] == "Alice")["items"]]
        expected = {"score": points[0] + points[2] / 2, "max_score": sum(points),
                    "score_percent": round(100 * (points[0] + points[2] / 2) / sum(points)), "results_released": False}
        finished = (await client.get("/api/student/teacher-homework", headers=student)).json()[0]
        assert {key: finished[key] for key in expected} == expected
        reopened = (await client.post(f"/api/student/teacher-homework/{attempt_id}/session", headers=student)).json()
        assert {key: reopened["teacher_paper"][key] for key in expected} == expected

        collection = (await client.get(f"/api/teacher/assignments/{assignment_id}/collection", headers=bearer(token))).json()
        row = next(r for r in collection["students"] if r["display_name"] == "Alice")
        items = row["submission"]["items"]
        assert [(i["kind"], i["answer"], i["is_correct"]) for i in items[:2]] == [("choice", "A", True), ("choice", "B", False)]
        published = (await client.get(f"/api/teacher/assignments/{assignment_id}", headers=bearer(token))).json()
        alice_paper = next(p for p in published["papers"] if p["display_name"] == "Alice")
        assert alice_paper["app_status"] == {"status": "completed", "graded": 3, "total": 3}

        review = (await client.get(f"/api/teacher/assignments/{assignment_id}/review", headers=bearer(token))).json()
        area = next(q for q in review["questions"] if q["kind"] == "area"
                    and q["question_id"] == alice_paper["items"][2]["question_id"])
        entry = next(e for e in (await client.get(
            f"/api/teacher/assignments/{assignment_id}/review/{area['number']}", headers=bearer(token))).json()
            if e["display_name"] == "Alice")
        # The app's grading arrives as the score: half of 12, which the teacher may still change.
        assert (entry["score"], entry["grade_status"], entry["error_type"]) == (6, "auto_passed", "calculation")
        assert entry["answer"] == "v=10 m/s"
        await client.put(f"/api/teacher/submission-items/{entry['item_id']}/grade", headers=bearer(token), json={"score": 6})
        mastery_before = {m.knowledge_point_id: m.mastery for m in (await db_session.execute(
            select(StudentMastery).where(StudentMastery.student_id == alice.id))).scalars().all()}
        # Bob never handed in, which does not block releasing Alice's result.
        released = await client.post(f"/api/teacher/assignments/{assignment_id}/release", headers=bearer(token))
        assert released.status_code == 204, released.text
        after_release = (await client.get("/api/student/teacher-homework", headers=student)).json()[0]
        assert {key: after_release[key] for key in expected} == {**expected, "results_released": True}
        # The home card drops finished work after a week; the history list keeps it.
        attempt.completed_at = datetime(2020, 1, 1, tzinfo=timezone.utc)
        await db_session.commit()
        assert (await client.get("/api/student/teacher-homework", headers=student)).json() == []
        history = (await client.get("/api/student/teacher-homework?history=true", headers=student)).json()
        assert [(h["attempt_id"], h["score_percent"]) for h in history] == [(attempt_id, expected["score_percent"])]
    after = {m.knowledge_point_id: m.mastery for m in (await db_session.execute(
        select(StudentMastery).where(StudentMastery.student_id == alice.id))).scalars().all()}
    # Whole-paper App pre-grades are topic-only. The reviewed release contributes
    # each answer once, through the same facts as scanned teacher homework.
    assert mastery_before == {}
    assert after
    mastery = list((await db_session.scalars(select(StudentMastery).where(
        StudentMastery.student_id == alice.id))).all())
    assert sum(m.attempts for m in mastery) == 3
    for m in mastery:
        before = m.mastery
        replayed = await StudentService(db_session).rebuild_mastery_for_kp(alice.id, m.knowledge_point_id)
        assert replayed.mastery == pytest.approx(before)
    assert (await db_session.get(Student, alice.id)).id == alice.id
