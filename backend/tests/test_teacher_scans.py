"""Collecting paper homework (teacher app P1b): layout, identification, authorization, metering."""
import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from app.api.teacher.router import get_scan_runner, get_scan_service, images_router
from app.core.config import settings
from app.models.teacher_scan import TeacherAiCall, TeacherScanBatch, TeacherScanPage, TeacherSubmission
from app.services import scan_layout_service as layout
from app.services.student_service import StudentService
from app.services.teacher_ai_service import AiReading, TeacherAiService
from app.services.teacher_scan_service import TeacherScanService, sign_image
from tests.scan_fixtures import blank_page, homework_pages, scanned, to_pdf
from tests.test_teacher_accounts import bearer, build_app, client_for
from tests.test_teacher_assignments import draft_with, setup_bank, setup_class

AREAS = {"q_p1": 110, "q_x1": 70}
CHOICES = ["q_c1", "q_c2"]  # answer key "A" for every choice question in the bank fixture


class FakeRecognizer:
    """Answers in call order and records what was sent out."""

    def __init__(self, numbers: list[str], choices: list[dict[int, str]] | None = None):
        self.numbers = list(numbers)
        self.choices = list(choices or [])
        self.number_images: list[bytes] = []
        self.choice_images: list[bytes] = []

    async def read_number(self, image: bytes) -> AiReading:
        self.number_images.append(image)
        return AiReading({"number": self.numbers.pop(0), "confidence": 0.95}, input_tokens=300, output_tokens=20)

    async def read_choices(self, image: bytes, options: dict[int, list[str]]) -> AiReading:
        self.choice_images.append(image)
        answers = self.choices.pop(0)
        return AiReading({"answers": [{"number": n, "answer": a, "confidence": 0.95 if a != "?" else 0.3}
                                      for n, a in answers.items()]}, input_tokens=1000, output_tokens=60)


def copy_pages(number: str | None, seed: int, choices=("A", "B")):
    return [scanned(page, angle=0.8, seed=seed + index)
            for index, page in enumerate(homework_pages(number=number, choices=list(choices),
                                                        area_heights=list(AREAS.values()), seed=seed,
                                                        stem_table=False))]


def scan_app(db_session, tmp_path, recognizer):
    app = build_app(db_session)
    app.include_router(images_router)

    def service():
        return TeacherScanService(db_session, TeacherAiService(db_session, recognizer), root=tmp_path)

    async def run(batch_id: str):
        await service().process(batch_id)

    app.dependency_overrides[get_scan_service] = service
    app.dependency_overrides[get_scan_runner] = lambda: run
    return app


async def published_homework(client, db_session, members=("alice_s", "bob_s", "carol_s")):
    await setup_bank(db_session)
    token, class_id, students = await setup_class(db_session, client, members=members)
    await client.post(f"/api/teacher/classes/{class_id}/members/auto-number", headers=bearer(token))
    assignment_id, _ = await draft_with(client, token, class_id,
                                        [{"question_id": q} for q in CHOICES + list(AREAS)])
    await client.post(f"/api/teacher/assignments/{assignment_id}/publish", headers=bearer(token))
    detail = (await client.get(f"/api/teacher/classes/{class_id}", headers=bearer(token))).json()
    numbers = {m["username"]: m["student_number"] for m in detail["members"]}
    return token, class_id, assignment_id, {s.username: s for s in students}, numbers


async def authorize(client, class_id, students, granted=True):
    response = await client.post(f"/api/admin/teacher-classes/{class_id}/ai-authorization", json={
        "student_ids": [s.id for s in students], "granted": granted, "grantor": "school",
    })
    assert response.status_code == 200, response.text
    return response.json()


async def upload(client, token, assignment_id, pdf: bytes, name="scan.pdf"):
    return await client.post(f"/api/teacher/assignments/{assignment_id}/scans", headers=bearer(token),
                             files={"file": (name, pdf, "application/pdf")})


@pytest.mark.parametrize("angle", [0.0, 1.5, -2.5])
def test_layout_reads_number_boxes_choice_cells_and_answer_areas(angle):
    pages = homework_pages(number="12", choices=list("ABCDABCDABCD"), area_heights=[110, 110, 70, 40], seed=3)
    images = layout.load_pages(to_pdf([scanned(p, angle=angle, seed=i) for i, p in enumerate(pages)] + [blank_page()]),
                               "scan.pdf")
    found = [layout.analyse_page(layout.deskew(image)) for image in images]
    assert [page.is_first_page for page in found] == [True, False, False, False]
    assert found[-1].blank
    first = found[0]
    assert len(first.number_boxes) == 2
    # The data table inside a stem comes after the answer table, so the first 12 cells are the answers.
    answer_rows = layout._rows(first.answer_cells[:12], 3 * first.px_per_mm)
    assert len(first.answer_cells) >= 12 and [len(row) for row in answer_rows] == [6, 6]
    areas = [area for page in found for area in page.areas]
    # Measured inside the border, so each area reads about a millimetre short.
    heights = [area[3] / first.px_per_mm for area in areas]
    assert len(heights) == 4 and all(abs(h - want) <= 2 for h, want in zip(heights, [110, 110, 70, 40]))



def test_number_boxes_are_told_apart_from_the_smaller_answer_table():
    pages = homework_pages(number="23", choices=list("ABCDABCDAB"), area_heights=[40], seed=7, number_boxes=3,
                           stem_table=False)
    found = layout.analyse_page(layout.deskew(layout.load_pages(to_pdf([scanned(pages[0], angle=1.0)]), "s.pdf")[0]))
    assert len(found.number_boxes) == 3 and len(found.answer_cells) == 10
    assert {round(rect[2] / found.px_per_mm) for rect in found.number_boxes} <= {6, 7}



@pytest.mark.parametrize("overrun", [2, 5, 6])
def test_an_answer_written_over_the_cell_border_keeps_every_cell_in_place(overrun):
    choices = list("ABCDAB")
    pages = homework_pages(number="12", choices=choices, area_heights=[40], seed=11, stem_table=False, overrun=overrun)
    found = layout.analyse_page(layout.deskew(layout.load_pages(to_pdf([scanned(pages[0], angle=0.8)]), "s.pdf")[0]))
    cells = found.answer_cells
    assert len(cells) == 6
    # Evenly spaced 11 mm apart, in question order, with no cell missing or shifted.
    steps = [round((b[0] - a[0]) / found.px_per_mm) for a, b in zip(cells, cells[1:])]
    assert steps == [11] * 5


@pytest.mark.parametrize("dashed, angle", [(False, 0.0), (True, 0.0), (True, 2.0)])
def test_two_column_areas_read_left_column_first(dashed, angle):
    pages = homework_pages(number="7", choices=list("ABCD"), area_heights=[40, 40, 110, 70, 40], seed=5, columns=2,
                           dashed=dashed, cut=dashed)
    images = layout.load_pages(to_pdf([scanned(p, angle=angle, seed=i) for i, p in enumerate(pages)]), "scan.pdf")
    found = [layout.analyse_page(layout.deskew(image)) for image in images]
    areas = [area for page in found for area in page.areas]
    px_per_mm = found[0].px_per_mm
    heights = [round(area[3] / px_per_mm) for area in areas]
    assert len(areas) == 5 and all(abs(h - want) <= 2 for h, want in zip(heights, [40, 40, 110, 70, 40]))
    # Page one: two boxes down the left column come before the right column's box,
    # although that box starts higher up than the second left one.
    first_page = found[0].areas
    assert [area[0] < found[0].width / 2 for area in first_page] == [True, True, False]
    assert first_page[2][1] < first_page[1][1]
    assert all(77 - 2 <= area[2] / px_per_mm <= 77 + 1 for area in areas)


@pytest.mark.asyncio
async def test_collecting_identifies_students_and_reads_choices_only_with_authorization(db_session, tmp_path):
    fake = FakeRecognizer([], [{1: "A", 2: "B"}, {1: "C", 2: "?"}])
    async with client_for(scan_app(db_session, tmp_path, fake)) as client:
        token, class_id, assignment_id, students, numbers = await published_homework(client, db_session)
        await authorize(client, class_id, [students["alice_s"], students["bob_s"]])
        fake.numbers = [numbers["alice_s"], numbers["bob_s"], numbers["carol_s"]]

        pdf = to_pdf(copy_pages(numbers["alice_s"], 1) + [blank_page()]
                     + copy_pages(numbers["bob_s"], 10) + copy_pages(numbers["carol_s"], 20))
        response = await upload(client, token, assignment_id, pdf)
        assert response.status_code == 202 and response.json()["created"] is True
        again = await upload(client, token, assignment_id, pdf)
        assert again.json() == {"batch_id": response.json()["batch_id"], "created": False, "status": "done"}

        overview = (await client.get(f"/api/teacher/assignments/{assignment_id}/collection",
                                     headers=bearer(token))).json()

    assert overview["collected"] == 3 and overview["total"] == 3 and overview["exceptions"] == []
    assert overview["batches"][0]["status"] == "done"
    rows = {row["display_name"]: row for row in overview["students"]}
    alice, bob, carol = rows["Alice"]["submission"], rows["Bob"]["submission"], rows["Carol"]["submission"]
    assert [(i["number"], i["kind"], i["answer"], i["is_correct"], i["status"]) for i in alice["items"]] == [
        (1, "choice", "A", True, "recognized"), (2, "choice", "B", False, "recognized"),
        (3, "area", None, None, "collected"), (4, "area", None, None, "collected"),
    ]
    assert alice["status"] == "recognized"
    assert bob["status"] == "needs_review" and bob["items"][1]["status"] == "needs_review"
    # Carol has no authorization: her choices never reach AI and wait for manual entry.
    assert carol["status"] == "manual" and rows["Carol"]["ai_authorized"] is False
    assert [i["status"] for i in carol["items"]] == ["manual", "manual", "collected", "collected"]
    assert all(i["image_url"] for i in carol["items"])
    assert len(fake.number_images) == 3 and len(fake.choice_images) == 2

    # Number crops are small: the boxes only, never the page.
    assert all(layout.decode_image(image).shape[0] < 150 for image in fake.number_images)
    carol_id = students["carol_s"].id
    assert any((tmp_path / f"answers/{carol_id}/teacher/{assignment_id}").glob("*_q03.jpg"))
    pages = (await db_session.execute(select(TeacherScanPage).order_by(TeacherScanPage.page_index))).scalars().all()
    assert [page.kind for page in pages][:4] == ["first", "continuation", "blank", "first"]
    calls = (await db_session.execute(select(TeacherAiCall))).scalars().all()
    assert len(calls) == 5 and sum(call.input_tokens for call in calls) == 3 * 300 + 2 * 1000
    assert overview["ai_usage"]["calls"] == 5


@pytest.mark.asyncio
async def test_exceptions_can_be_assigned_or_ignored(db_session, tmp_path):
    fake = FakeRecognizer([], [{1: "A", 2: "A"}])
    async with client_for(scan_app(db_session, tmp_path, fake)) as client:
        token, class_id, assignment_id, students, numbers = await published_homework(client, db_session)
        await authorize(client, class_id, list(students.values()))
        fake.numbers = [numbers["alice_s"], "99", "", numbers["alice_s"]]
        orphan = copy_pages(None, 40)[1]
        pdf = to_pdf([orphan] + copy_pages(numbers["alice_s"], 1) + copy_pages("99", 5)
                     + copy_pages(None, 9) + copy_pages(numbers["alice_s"], 13))
        await upload(client, token, assignment_id, pdf)
        overview = (await client.get(f"/api/teacher/assignments/{assignment_id}/collection",
                                     headers=bearer(token))).json()
        issues = [(e["issue"], e["recognized_number"]) for e in overview["exceptions"]]
        assert issues == [("orphan_page", None), ("unknown_number", "99"), ("number_unread", None),
                          ("duplicate_copy", numbers["alice_s"])]
        assert all(e["page_url"] for e in overview["exceptions"])
        assert overview["exceptions"][1]["number_url"]

        unknown = overview["exceptions"][1]["page_id"]
        taken = await client.post(f"/api/teacher/scan-pages/{unknown}/assign", headers=bearer(token),
                                  json={"student_id": students["alice_s"].id})
        assert taken.status_code == 409
        fake.choices = [{1: "A", 2: "C"}]
        assigned = await client.post(f"/api/teacher/scan-pages/{unknown}/assign", headers=bearer(token),
                                     json={"student_id": students["bob_s"].id})
        assert assigned.status_code == 204
        ignored = await client.post(f"/api/teacher/scan-pages/{overview['exceptions'][0]['page_id']}/ignore",
                                    headers=bearer(token))
        assert ignored.status_code == 204

        overview = (await client.get(f"/api/teacher/assignments/{assignment_id}/collection",
                                     headers=bearer(token))).json()
        assert [e["issue"] for e in overview["exceptions"]] == ["number_unread", "duplicate_copy"]
        bob = next(row for row in overview["students"] if row["display_name"] == "Bob")["submission"]
        assert [i["answer"] for i in bob["items"][:2]] == ["A", "C"]
        assert len(bob["items"]) == 4 and all(i["image_url"] for i in bob["items"])


@pytest.mark.asyncio
async def test_teacher_corrects_choices_and_deleting_a_batch_undoes_it(db_session, tmp_path):
    fake = FakeRecognizer([], [])
    async with client_for(scan_app(db_session, tmp_path, fake)) as client:
        token, class_id, assignment_id, students, numbers = await published_homework(client, db_session)
        fake.numbers = [numbers["carol_s"]]
        await upload(client, token, assignment_id, to_pdf(copy_pages(numbers["carol_s"], 2)))
        overview = (await client.get(f"/api/teacher/assignments/{assignment_id}/collection",
                                     headers=bearer(token))).json()
        carol = next(row for row in overview["students"] if row["display_name"] == "Carol")["submission"]
        path = f"/api/teacher/submissions/{carol['id']}/choices"
        assert (await client.put(f"{path}/1", headers=bearer(token), json={"answer": "a"})).status_code == 204
        assert (await client.put(f"{path}/2", headers=bearer(token), json={"answer": "Z"})).status_code == 400
        assert (await client.put(f"{path}/3", headers=bearer(token), json={"answer": "A"})).status_code == 404
        assert (await client.put(f"{path}/2", headers=bearer(token), json={"answer": "B"})).status_code == 204
        overview = (await client.get(f"/api/teacher/assignments/{assignment_id}/collection",
                                     headers=bearer(token))).json()
        carol = next(row for row in overview["students"] if row["display_name"] == "Carol")["submission"]
        assert [(i["answer"], i["is_correct"], i["status"]) for i in carol["items"][:2]] == [
            ("A", True, "confirmed"), ("B", False, "confirmed"),
        ]

        batch_id = overview["batches"][0]["id"]
        assert (await client.delete(f"/api/teacher/scan-batches/{batch_id}", headers=bearer(token))).status_code == 204
        assert (await db_session.execute(select(func.count()).select_from(TeacherSubmission))).scalar() == 0
        assert not (tmp_path / f"answers/{students['carol_s'].id}/teacher/{assignment_id}").exists()
        assert not (tmp_path / f"teacher_scans/{assignment_id}/{batch_id}").exists()


@pytest.mark.asyncio
async def test_ai_caps_send_the_rest_to_manual_entry(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "teacher_ai_calls_per_student", 1)
    fake = FakeRecognizer([], [{1: "A", 2: "A"}] * 3)
    async with client_for(scan_app(db_session, tmp_path, fake)) as client:
        token, class_id, assignment_id, students, numbers = await published_homework(client, db_session)
        await authorize(client, class_id, list(students.values()))
        fake.numbers = [numbers["alice_s"], numbers["bob_s"], numbers["carol_s"]]
        pdf = to_pdf(copy_pages(numbers["alice_s"], 1) + copy_pages(numbers["bob_s"], 5)
                     + copy_pages(numbers["carol_s"], 9))
        await upload(client, token, assignment_id, pdf)
        overview = (await client.get(f"/api/teacher/assignments/{assignment_id}/collection",
                                     headers=bearer(token))).json()
    # Three calls allowed in total: Alice's number and choices, then Bob's number.
    assert len(fake.number_images) == 2 and len(fake.choice_images) == 1
    rows = {row["display_name"]: row for row in overview["students"]}
    assert rows["Alice"]["submission"]["status"] == "recognized"
    assert rows["Bob"]["submission"]["status"] == "needs_review"
    assert rows["Carol"]["submission"] is None
    assert [e["issue"] for e in overview["exceptions"]] == ["ai_quota"]


@pytest.mark.asyncio
async def test_identical_crops_are_read_once(db_session):
    fake = FakeRecognizer(["7", "8"])
    ai = TeacherAiService(db_session, fake)
    meter = {"assignment_id": "a_x", "teacher_id": "t_x", "student_count": 5}
    first = await ai.read_student_number(b"crop-bytes", **meter)
    second = await ai.read_student_number(b"crop-bytes", **meter)
    assert first == second == ("7", 0.95)
    assert len(fake.number_images) == 1


@pytest.mark.asyncio
async def test_authorization_is_recorded_per_student_and_can_be_withdrawn(db_session, tmp_path):
    async with client_for(scan_app(db_session, tmp_path, FakeRecognizer([]))) as client:
        token, class_id, assignment_id, students, _ = await published_homework(client, db_session)
        granted = await authorize(client, class_id, [students["alice_s"]])
        assert {m["username"]: (m["teacher_ai_authorized"], m["teacher_ai_grantor"]) for m in granted}["alice_s"] == (True, "school")
        withdrawn = await authorize(client, class_id, [students["alice_s"]], granted=False)
        assert not any(m["teacher_ai_authorized"] for m in withdrawn)
        outsider = await StudentService(db_session).create_student("dave_s", "pass123", "Dave")
        bad = await client.post(f"/api/admin/teacher-classes/{class_id}/ai-authorization", json={
            "student_ids": [outsider.id], "granted": True, "grantor": "guardian",
        })
        assert bad.status_code == 400
        overview = (await client.get(f"/api/teacher/assignments/{assignment_id}/collection",
                                     headers=bearer(token))).json()
        assert not any(row["ai_authorized"] for row in overview["students"])


@pytest.mark.asyncio
async def test_only_the_owner_collects_and_image_links_are_signed(db_session, tmp_path):
    async with client_for(scan_app(db_session, tmp_path, FakeRecognizer([]))) as client:
        token, class_id, assignment_id, _, _ = await published_homework(client, db_session)
        draft_id, _ = await draft_with(client, token, class_id, [{"question_id": "q_c3"}])
        assert (await upload(client, token, draft_id, b"%PDF-1.4")).status_code == 409
        assert (await upload(client, token, assignment_id, b"")).status_code == 400

        from tests.test_teacher_accounts import ready_teacher
        _, other = await ready_teacher(client, "li", "李老师")
        assert (await client.get(f"/api/teacher/assignments/{assignment_id}/collection",
                                 headers=bearer(other))).status_code == 404
        assert (await upload(client, other, assignment_id, b"%PDF-1.4")).status_code == 404

        image = tmp_path / "answers/s1/teacher/a1/q01.jpg"
        image.parent.mkdir(parents=True)
        image.write_bytes(b"\xff\xd8jpeg")
        import app.services.teacher_scan_service as scan_module
        original_root = scan_module.uploads_root
        scan_module.uploads_root = lambda: tmp_path
        try:
            link = sign_image("answers/s1/teacher/a1/q01.jpg", "t_1")
            assert (await client.get(link)).content == b"\xff\xd8jpeg"
            assert (await client.get(link[:-1] + ("0" if link[-1] != "0" else "1"))).status_code == 404
            escaped = sign_image("../../etc/passwd", "t_1")
            assert (await client.get(escaped)).status_code == 404
            expired = sign_image("answers/s1/teacher/a1/q01.jpg", "t_1", ttl=-1)
            assert (await client.get(expired)).status_code == 404
        finally:
            scan_module.uploads_root = original_root


@pytest.mark.asyncio
async def test_failed_batch_reports_an_unreadable_file(db_session, tmp_path):
    fake = FakeRecognizer([])
    async with client_for(scan_app(db_session, tmp_path, fake)) as client:
        token, _, assignment_id, _, _ = await published_homework(client, db_session)
        response = await upload(client, token, assignment_id, b"not a pdf at all", name="scan.png")
        batch = await db_session.get(TeacherScanBatch, response.json()["batch_id"])
        await db_session.refresh(batch)
        assert batch.status == "failed" and batch.error == "无法读取这个图片文件"


@pytest.mark.asyncio
async def test_scan_migration_guards_erased_students_and_downgrades(db_session):
    from tests.test_account_deletion import install_guards

    await install_guards(db_session)
    spec = importlib.util.spec_from_file_location(
        "scan_migration", Path(__file__).resolve().parents[1] / "alembic/versions/0038_teacher_scans.py",
    )
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    def recreate(connection):
        for table in ("teacher_ai_calls", "teacher_submission_items", "teacher_submissions",
                      "teacher_scan_pages", "teacher_scan_batches"):
            connection.execute(text(f"DROP TABLE {table}"))
        for column in ("source", "grantor", "recorded_by"):
            connection.execute(text(f"ALTER TABLE student_privacy_consents DROP COLUMN {column}"))
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()

    await (await db_session.connection()).run_sync(recreate)
    await db_session.commit()

    from app.services.teacher_service import TeacherService
    student = await StudentService(db_session).create_student("erased_s", "pass123", "Erased")
    teacher = await TeacherService(db_session).create_teacher("wang", "王老师", "init2026pass")
    teacher_class = await TeacherService(db_session).create_class(teacher.id, "高一(3)班")
    await db_session.execute(text(
        "INSERT INTO teacher_assignments (id, teacher_id, class_id, title) VALUES ('a_1', :t, :c, '测验')"
    ), {"t": teacher.id, "c": teacher_class.id})
    await db_session.execute(text("UPDATE students SET status='deleted' WHERE id=:id"), {"id": student.id})
    await db_session.commit()
    with pytest.raises(IntegrityError):
        await db_session.execute(text(
            "INSERT INTO teacher_submissions (id, assignment_id, student_id, status, ai_authorized) "
            "VALUES ('sub_1', 'a_1', :s, 'manual', false)"
        ), {"s": student.id})
    await db_session.rollback()

    def downgrade(connection):
        with Operations.context(MigrationContext.configure(connection)):
            migration.downgrade()
        return [row[0] for row in connection.execute(text(
            "SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'teacher_scan%' "
            "OR table_name IN ('teacher_submissions', 'teacher_submission_items', 'teacher_ai_calls')"
        ))]

    assert await (await db_session.connection()).run_sync(downgrade) == []
    await db_session.commit()


@pytest.mark.asyncio
async def test_teacher_authorization_leaves_the_ios_consent_state_alone(db_session):
    from app.services.privacy_consent_service import PrivacyConsentService

    student = await StudentService(db_session).create_student("ios_s", "pass123", "Ios")
    before = await PrivacyConsentService(db_session).state(student.id)
    await TeacherAiService(db_session).record_authorization(
        [student.id], granted=True, grantor="guardian", recorded_by="admin:test",
    )
    assert await PrivacyConsentService(db_session).state(student.id) == before
    assert await TeacherAiService(db_session).authorized_students([student.id]) == {student.id}


def test_incomplete_multiple_choice_is_flagged_as_half_marks():
    question = {"question_type": "multiple_choice", "answer": "ACD"}
    assert TeacherScanService._is_partial(question, "AC") is True
    assert TeacherScanService._is_partial(question, "AB") is False
    assert TeacherScanService._is_partial(question, "ACD") is False
    assert TeacherScanService._is_partial({"question_type": "single_choice", "answer": "A"}, "A") is False


def test_a_margin_crop_stops_at_the_page_edge():
    import numpy as np
    page = np.zeros((100, 80), np.uint8)
    assert layout.crop(page, (2, 3, 10, 10), inset=-5).shape == (18, 17)
    assert layout.crop(page, (70, 90, 10, 10), inset=-5).shape == (15, 15)
    assert layout.crop(page, (20, 20, 10, 10), inset=2).shape == (6, 6)
