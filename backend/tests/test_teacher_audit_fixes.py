"""Teacher app audit, 2026-10-23: locked results, safer matching of papers to students,
interrupted work, frozen rosters and rubrics, and the data behind reports."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update

from app.models.student import StudentAnswer
from app.models.teacher import TeacherAssignment, TeacherStudentPaper
from app.models.teacher_scan import TeacherScanBatch, TeacherScanPage, TeacherSubmission, TeacherSubmissionItem
from app.services.rubric_service import RubricService
from app.services.student_service import StudentService
from app.services.teacher_ai_service import AiReading
from app.services.teacher_homework_service import sync_app_submissions
from app.services.teacher_scan_service import recover_interrupted_work
from tests.scan_fixtures import to_pdf
from tests.test_teacher_accounts import bearer, build_app, client_for, ready_teacher
from tests.test_teacher_assignments import setup_class
from tests.test_teacher_grading import RUBRIC_Q_P1, FakeGrader, collected_homework, full_marks, grading_app
from tests.test_teacher_personalized import setup_scope
from tests.test_teacher_scans import FakeRecognizer, authorize, copy_pages, published_homework, scan_app, upload


class UnsureRecognizer(FakeRecognizer):
    """Reads numbers with the given confidences, in call order."""

    def __init__(self, numbers, confidences, choices=None):
        super().__init__(numbers, choices)
        self.confidences = list(confidences)

    async def read_number(self, image: bytes) -> AiReading:
        self.number_images.append(image)
        return AiReading({"number": self.numbers.pop(0), "confidence": self.confidences.pop(0)})


async def collection(client, token, assignment_id):
    response = await client.get(f"/api/teacher/assignments/{assignment_id}/collection", headers=bearer(token))
    assert response.status_code == 200, response.text
    return response.json()


def row_of(overview, name):
    return next(row for row in overview["students"] if row["display_name"] == name)


@pytest.mark.asyncio
async def test_a_doubtful_number_waits_for_the_teacher_with_a_suggestion(db_session, tmp_path):
    fake = UnsureRecognizer([], [0.5])
    async with client_for(scan_app(db_session, tmp_path, fake)) as client:
        token, _, assignment_id, students, numbers = await published_homework(client, db_session)
        fake.numbers = [numbers["alice_s"]]
        await upload(client, token, assignment_id, to_pdf(copy_pages(numbers["alice_s"], 1)))
        overview = await collection(client, token, assignment_id)
        assert overview["collected"] == 0
        [exception] = overview["exceptions"]
        assert exception["issue"] == "number_unsure" and exception["number_confidence"] == 0.5
        assert exception["suggested"] == {"student_id": students["alice_s"].id, "display_name": "Alice"}
        assigned = await client.post(f"/api/teacher/scan-pages/{exception['page_id']}/assign", headers=bearer(token),
                                     json={"student_id": students["alice_s"].id})
        assert assigned.status_code == 204
        assert (await collection(client, token, assignment_id))["collected"] == 1


@pytest.mark.asyncio
async def test_papers_match_the_numbers_the_homework_went_out_with(db_session, tmp_path):
    fake = FakeRecognizer([])
    async with client_for(scan_app(db_session, tmp_path, fake)) as client:
        token, class_id, assignment_id, students, numbers = await published_homework(client, db_session)
        alice, bob = students["alice_s"], students["bob_s"]
        old_alice, old_bob = numbers["alice_s"], numbers["bob_s"]
        # After publishing, Alice moves to 9 and Bob takes Alice's old number.
        base = f"/api/teacher/classes/{class_id}/members"
        assert (await client.put(f"{base}/{alice.id}/number", headers=bearer(token), json={"student_number": "9"})).status_code == 200
        assert (await client.put(f"{base}/{bob.id}/number", headers=bearer(token), json={"student_number": old_alice})).status_code == 200
        fake.numbers = [old_alice, old_bob, "9"]
        await upload(client, token, assignment_id, to_pdf(copy_pages(old_alice, 1) + copy_pages(old_bob, 5)
                                                          + copy_pages("9", 9)))
        overview = await collection(client, token, assignment_id)
    # The papers carry the numbers they went out with: each lands with its own student.
    assert row_of(overview, "Alice")["submission"] is not None and row_of(overview, "Bob")["submission"] is not None
    assert row_of(overview, "Alice")["student_number"] == old_alice
    assert [e["issue"] for e in overview["exceptions"]] == ["unknown_number"]


@pytest.mark.asyncio
async def test_a_rescanned_copy_replaces_the_first_one_only_when_asked(db_session, tmp_path):
    fake = FakeRecognizer([])
    async with client_for(scan_app(db_session, tmp_path, fake)) as client:
        token, _, assignment_id, students, numbers = await published_homework(client, db_session)
        fake.numbers = [numbers["alice_s"]]
        await upload(client, token, assignment_id, to_pdf(copy_pages(numbers["alice_s"], 1)), name="first.pdf")
        first = row_of(await collection(client, token, assignment_id), "Alice")["submission"]["id"]
        fake.numbers = [numbers["alice_s"]]
        await upload(client, token, assignment_id, to_pdf(copy_pages(numbers["alice_s"], 30)), name="again.pdf")
        overview = await collection(client, token, assignment_id)
        [duplicate] = overview["exceptions"]
        assert duplicate["issue"] == "duplicate_copy" and duplicate["suggested"]["display_name"] == "Alice"
        path = f"/api/teacher/scan-pages/{duplicate['page_id']}/assign"
        body = {"student_id": students["alice_s"].id}
        refused = await client.post(path, headers=bearer(token), json=body)
        assert refused.status_code == 409 and "替换" in refused.json()["detail"]
        assert (await client.post(path, headers=bearer(token), json={**body, "replace": True})).status_code == 204
        overview = await collection(client, token, assignment_id)
    assert overview["exceptions"] == [] and overview["collected"] == 1
    assert row_of(overview, "Alice")["submission"]["id"] != first
    statuses = sorted(p.status for p in (await db_session.execute(select(TeacherScanPage))).scalars().all())
    assert statuses.count("replaced") == 2 and statuses.count("ok") == 2
    # Page images of the two uploads are kept apart in the student's folder.
    folder = tmp_path / f"answers/{students['alice_s'].id}/teacher/{assignment_id}"
    assert len(list(folder.glob("*page_001.jpg"))) == 2


@pytest.mark.asyncio
async def test_an_unclaimed_continuation_page_fills_the_areas_a_copy_is_missing(db_session, tmp_path):
    fake = FakeRecognizer([])
    async with client_for(scan_app(db_session, tmp_path, fake)) as client:
        token, _, assignment_id, students, numbers = await published_homework(client, db_session)
        pages = copy_pages(numbers["alice_s"], 1)
        fake.numbers = [numbers["alice_s"]]
        await upload(client, token, assignment_id, to_pdf(pages[:1]), name="first-pages.pdf")
        await upload(client, token, assignment_id, to_pdf(pages[1:]), name="second-pages.pdf")
        overview = await collection(client, token, assignment_id)
        missing = [i["number"] for i in row_of(overview, "Alice")["submission"]["items"] if not i["image_url"]]
        assert missing
        [orphan] = overview["exceptions"]
        assert orphan["issue"] == "orphan_page"
        path = f"/api/teacher/scan-pages/{orphan['page_id']}/attach"
        assert (await client.post(path, headers=bearer(token), json={"student_id": students["bob_s"].id})).status_code == 409
        attached = await client.post(path, headers=bearer(token), json={"student_id": students["alice_s"].id})
        assert attached.status_code == 200 and attached.json()["filled"] == len(missing)
        overview = await collection(client, token, assignment_id)
    assert overview["exceptions"] == []
    assert all(i["image_url"] for i in row_of(overview, "Alice")["submission"]["items"])


@pytest.mark.asyncio
async def test_released_results_lock_the_collection(db_session, tmp_path):
    fake = FakeRecognizer([])
    async with client_for(scan_app(db_session, tmp_path, fake)) as client:
        token, _, assignment_id, students, numbers = await published_homework(client, db_session)
        fake.numbers = [numbers["carol_s"], "99"]
        await upload(client, token, assignment_id, to_pdf(copy_pages(numbers["carol_s"], 2) + copy_pages("99", 6)))
        overview = await collection(client, token, assignment_id)
        submission = row_of(overview, "Carol")["submission"]["id"]
        page = overview["exceptions"][0]["page_id"]
        batch = overview["batches"][0]["id"]
        assert overview["batches"][0]["copies"] == 1
        await db_session.execute(update(TeacherAssignment).where(TeacherAssignment.id == assignment_id)
                                 .values(results_released_at=datetime.now(timezone.utc)))
        await db_session.commit()
        attempts = [
            await upload(client, token, assignment_id, to_pdf(copy_pages(numbers["bob_s"], 9))),
            await client.put(f"/api/teacher/submissions/{submission}/choices/1", headers=bearer(token), json={"answer": "B"}),
            await client.post(f"/api/teacher/scan-pages/{page}/assign", headers=bearer(token),
                              json={"student_id": students["bob_s"].id}),
            await client.post(f"/api/teacher/scan-pages/{page}/ignore", headers=bearer(token)),
            await client.delete(f"/api/teacher/scan-batches/{batch}", headers=bearer(token)),
        ]
        assert [r.status_code for r in attempts] == [409] * 5
        assert "锁定" in attempts[0].json()["detail"]
        # Looking at the collection still works.
        assert (await collection(client, token, assignment_id))["released"] is True


@pytest.mark.asyncio
async def test_auto_passed_answers_need_the_teachers_confirmation_before_release(db_session, tmp_path):
    recognizer, grader = FakeRecognizer([]), FakeGrader([full_marks(), full_marks()])
    async with client_for(grading_app(db_session, tmp_path, recognizer, grader)) as client:
        token, assignment_id, students = await collected_homework(client, db_session, recognizer)
        await RubricService(db_session).review("q_p1", parts=RUBRIC_Q_P1, approve=True, note=None, reviewer="admin:t")
        base = f"/api/teacher/assignments/{assignment_id}"
        await client.post(f"{base}/grading", headers=bearer(token))
        grade = lambda item, body: client.put(f"/api/teacher/submission-items/{item}/grade", headers=bearer(token), json=body)
        q3 = {e["display_name"]: e for e in (await client.get(f"{base}/review/3", headers=bearer(token))).json()}
        q4 = {e["display_name"]: e for e in (await client.get(f"{base}/review/4", headers=bearer(token))).json()}
        assert q3["Alice"]["grade_status"] == q3["Bob"]["grade_status"] == "auto_passed"
        await grade(q3["Carol"]["item_id"], {"part_scores": [{"label": "(1)", "score": 2}, {"label": "(2)", "score": 2}]})
        for name in ("Alice", "Bob", "Carol"):
            assert (await grade(q4[name]["item_id"], {"score": 4})).status_code == 204
        carol = row_of((await client.get(f"{base}/collection", headers=bearer(token))).json(), "Carol")["submission"]["id"]
        for number in (1, 2):
            await client.put(f"/api/teacher/submissions/{carol}/choices/{number}", headers=bearer(token), json={"answer": "A"})
        bob = row_of((await client.get(f"{base}/collection", headers=bearer(token))).json(), "Bob")["submission"]["id"]
        await client.put(f"/api/teacher/submissions/{bob}/choices/2", headers=bearer(token), json={"answer": "B"})

        blocked = await client.post(f"{base}/release", headers=bearer(token))
        assert blocked.status_code == 409 and "2 份是 AI 自动通过" in blocked.json()["detail"]
        confirmed = await client.post(f"{base}/review/confirm-auto", headers=bearer(token))
        assert confirmed.json() == {"confirmed": 2}
        assert (await client.post(f"{base}/release", headers=bearer(token))).status_code == 204
        report = (await client.get(f"{base}/report", headers=bearer(token))).json()
    assert report["class_id"] and {r["display_name"]: r["percent"] for r in report["students"]}["Alice"] > 0
    # Each released student carries the band the distribution counted them in.
    banded = [r["band"] for r in report["students"] if r["submitted"]]
    assert {b["label"]: b["count"] for b in report["bands"]} == {
        b["label"]: banded.count(b["label"]) for b in report["bands"]}
    q1 = report["questions"][0]
    assert q1["distribution"] == {"A": 3} and q1["kp_name"] == "匀变速直线运动"


@pytest.mark.asyncio
async def test_a_withdrawn_authorization_keeps_answers_away_from_ai(db_session, tmp_path):
    recognizer, grader = FakeRecognizer([]), FakeGrader([full_marks()])
    async with client_for(grading_app(db_session, tmp_path, recognizer, grader)) as client:
        token, assignment_id, students = await collected_homework(client, db_session, recognizer)
        from app.models.teacher import TeacherClassMember
        class_id = (await db_session.execute(select(TeacherClassMember.class_id))).scalars().first()
        await authorize(client, class_id, [students["alice_s"]], granted=False)
        base = f"/api/teacher/assignments/{assignment_id}"
        started = await client.post(f"{base}/grading", headers=bearer(token))
        assert started.status_code == 202 and started.json()["total"] == 1
        entries = {e["display_name"]: e for e in (await client.get(f"{base}/review/3", headers=bearer(token))).json()}
    assert grader.calls == [(2, [3, 4])]
    assert entries["Alice"]["grade_status"] == "manual" and entries["Alice"]["ai_authorized"] is False


@pytest.mark.asyncio
async def test_rubrics_in_force_when_grading_starts_stay_for_the_homework(db_session, tmp_path):
    recognizer, grader = FakeRecognizer([]), FakeGrader([full_marks(), full_marks()])
    async with client_for(grading_app(db_session, tmp_path, recognizer, grader)) as client:
        token, assignment_id, _ = await collected_homework(client, db_session, recognizer)
        base = f"/api/teacher/assignments/{assignment_id}"
        await client.post(f"{base}/grading", headers=bearer(token))
        # Approved only after grading started: this homework keeps scoring question 3 as a whole.
        await RubricService(db_session).review("q_p1", parts=RUBRIC_Q_P1, approve=True, note=None, reviewer="admin:t")
        review = (await client.get(f"{base}/review", headers=bearer(token))).json()
        q3 = review["questions"][2]
        assert q3["rubric_status"] == "approved" and q3["rubric_parts"] is None and q3["rubric_frozen"] is True
        entry = (await client.get(f"{base}/review/3", headers=bearer(token))).json()[0]
        graded = await client.put(f"/api/teacher/submission-items/{entry['item_id']}/grade", headers=bearer(token),
                                  json={"score": 6})
        assert graded.status_code == 204


@pytest.mark.asyncio
async def test_interrupted_uploads_and_runs_can_be_started_again(db_session, tmp_path):
    fake = FakeRecognizer([])
    async with client_for(scan_app(db_session, tmp_path, fake)) as client:
        token, _, assignment_id, _, numbers = await published_homework(client, db_session)
        fake.numbers = [numbers["alice_s"]]
        await upload(client, token, assignment_id, to_pdf(copy_pages(numbers["alice_s"], 1)))
        batch = (await db_session.execute(select(TeacherScanBatch))).scalar_one()
        # As if the process stopped mid-way an hour ago.
        batch.status, batch.created_at = "processing", datetime.now(timezone.utc) - timedelta(hours=2)
        await db_session.commit()
        recent = await recover_interrupted_work(db_session, older_than_minutes=600)
        assert recent == {"batches": 0, "runs": 0, "rubrics": 0}
        overview = await collection(client, token, assignment_id)
        assert overview["batches"][0]["status"] == "failed" and "重新处理" in overview["batches"][0]["error"]
        fake.numbers = [numbers["alice_s"]]
        retried = await client.post(f"/api/teacher/scan-batches/{batch.id}/retry", headers=bearer(token))
        assert retried.status_code == 202
        overview = await collection(client, token, assignment_id)
        assert overview["batches"][0]["status"] == "done" and overview["collected"] == 1
        assert (await client.post(f"/api/teacher/scan-batches/{batch.id}/retry", headers=bearer(token))).status_code == 409
        _, other = await ready_teacher(client, "li", "李老师")
        assert (await client.post(f"/api/teacher/scan-batches/{batch.id}/retry", headers=bearer(other))).status_code == 404
    pages = (await db_session.execute(select(TeacherScanPage))).scalars().all()
    assert len(pages) == 2


@pytest.mark.asyncio
async def test_reports_and_class_data_count_only_what_was_released(db_session, tmp_path):
    fake = FakeRecognizer([])
    async with client_for(scan_app(db_session, tmp_path, fake)) as client:
        token, class_id, assignment_id, students, numbers = await published_homework(client, db_session)
        fake.numbers = [numbers["alice_s"], numbers["bob_s"]]
        await upload(client, token, assignment_id, to_pdf(copy_pages(numbers["alice_s"], 1) + copy_pages(numbers["bob_s"], 5)))
        await db_session.execute(update(TeacherSubmission).values(total_score=20.0))
        await db_session.execute(update(TeacherSubmissionItem).values(max_score=7.0, score=5.0))
        await db_session.execute(update(TeacherAssignment).where(TeacherAssignment.id == assignment_id)
                                 .values(results_released_at=datetime.now(timezone.utc)))
        await db_session.commit()
        # A copy that never went through release (it has no total) must not count as zero.
        db_session.add(TeacherSubmission(id="sub_late", assignment_id=assignment_id, student_id=students["carol_s"].id,
                                         status="recognized", ai_authorized=False, source="app"))
        await db_session.commit()
        from app.api.teacher.router import get_grading_service
        from app.services.teacher_grading_service import TeacherGradingService

        client._transport.app.dependency_overrides[get_grading_service] = lambda: TeacherGradingService(db_session, root=tmp_path)
        report = (await client.get(f"/api/teacher/assignments/{assignment_id}/report", headers=bearer(token))).json()
        homework = (await client.get(f"/api/teacher/classes/{class_id}/homework", headers=bearer(token))).json()
    assert report["collected"] == 2 and report["lowest"] == 20 and report["class_size"] == 3
    carol = next(row for row in report["students"] if row["display_name"] == "Carol")
    assert carol["submitted"] is False
    rows = {row["display_name"]: row for row in homework["students"]}
    assert rows["Carol"]["missing"] == [assignment_id] and rows["Alice"]["missing"] == []


@pytest.mark.asyncio
async def test_a_late_app_paper_does_not_join_a_released_homework(db_session):
    assignment = TeacherAssignment(id="a_x", teacher_id="t", class_id=None, kind="personalized", title="x",
                                   status="published", results_released_at=datetime.now(timezone.utc))
    assert await sync_app_submissions(db_session, assignment) == 0


@pytest.mark.asyncio
async def test_personalized_homework_waits_for_students_who_joined_after_drafting(db_session):
    await setup_scope(db_session)
    async with client_for(build_app(db_session)) as client:
        token, class_id, students = await setup_class(db_session, client)
        created = (await client.post(f"/api/teacher/classes/{class_id}/personalized", headers=bearer(token), json={
            "title": "第一周", "scope": [{"volume": "必修一"}], "choice_count": 2, "area_count": 1,
        })).json()
        assignment_id = created["id"]
        await StudentService(db_session).create_student("dave_s", "pass123", "Dave")
        await client.post(f"/api/admin/teacher-classes/{class_id}/members", json={"username": "dave_s", "grantor": "school"})
        detail = (await client.get(f"/api/teacher/assignments/{assignment_id}", headers=bearer(token))).json()
        dave = next(p for p in detail["papers"] if p["display_name"] == "Dave")
        assert dave["missing"] is True and dave["items"] == []
        refused = await client.post(f"/api/teacher/assignments/{assignment_id}/publish", headers=bearer(token))
        assert refused.status_code == 400 and "Dave" in refused.json()["detail"]
        drafted = await client.post(f"/api/teacher/assignments/{assignment_id}/papers/{dave['student_id']}/redraft",
                                    headers=bearer(token))
        assert drafted.status_code == 200
        everyone = await client.put(f"/api/teacher/assignments/{assignment_id}/papers/delivery", headers=bearer(token),
                                    json={"delivery": "paper"})
        assert everyone.status_code == 200 and {p["delivery"] for p in everyone.json()["papers"]} == {"paper"}
        _, other = await ready_teacher(client, "li", "李老师")
        assert (await client.put(f"/api/teacher/assignments/{assignment_id}/papers/delivery", headers=bearer(other),
                                 json={"delivery": "app"})).status_code == 404
        published = await client.post(f"/api/teacher/assignments/{assignment_id}/publish", headers=bearer(token))
        assert published.status_code == 200, published.text
    assert len((await db_session.execute(select(TeacherStudentPaper))).scalars().all()) == 3


@pytest.mark.asyncio
async def test_question_counts_include_paper_homework_answers(db_session, tmp_path):
    fake = FakeRecognizer([])
    async with client_for(scan_app(db_session, tmp_path, fake)) as client:
        token, class_id, assignment_id, students, numbers = await published_homework(client, db_session)
        fake.numbers = [numbers["carol_s"]]
        await upload(client, token, assignment_id, to_pdf(copy_pages(numbers["carol_s"], 2)))
        db_session.add(StudentAnswer(student_id=students["alice_s"].id, question_id="q_c1", given_answer="A", is_correct=True))
        await db_session.commit()
        found = (await client.get(f"/api/teacher/classes/{class_id}/questions", headers=bearer(token),
                                  params={"kp_id": "kp_motion"})).json()
        hidden = (await client.get(f"/api/teacher/classes/{class_id}/questions", headers=bearer(token),
                                   params={"kp_id": "kp_motion", "exclude_attempted": True})).json()
        outline = (await client.get("/api/teacher/question-bank/outline", headers=bearer(token))).json()
    by_id = {q["id"]: q for q in found["items"]}
    # Alice in the app and Carol on paper both met q_c1; Carol's paper is not scored yet.
    assert by_id["q_c1"]["class_attempted"] == 2 and by_id["q_c1"]["class_correct_rate"] == 1.0
    assert by_id["q_p1"]["class_attempted"] == 1 and by_id["q_p1"]["class_correct_rate"] is None
    assert {q["id"] for q in hidden["items"]} == {"q_c3", "q_p2"}
    assert outline["total"] == 6


@pytest.mark.asyncio
async def test_snapshot_migration_adds_and_drops_its_columns(db_session):
    import importlib.util
    from pathlib import Path

    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import text

    spec = importlib.util.spec_from_file_location(
        "snapshot_migration", Path(__file__).resolve().parents[1] / "alembic/versions/0044_teacher_snapshots.py",
    )
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    assert migration.down_revision == "0043_teacher_assignment_library"

    def columns(connection):
        return {row[0] for row in connection.execute(text(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'teacher_assignments'"))}

    def run(connection):
        with Operations.context(MigrationContext.configure(connection)):
            migration.downgrade()
            gone = columns(connection)
            migration.upgrade()
        return gone, columns(connection)

    gone, back = await (await db_session.connection()).run_sync(run)
    assert not {"roster", "rubric_snapshot"} & gone
    assert {"roster", "rubric_snapshot"} <= back
