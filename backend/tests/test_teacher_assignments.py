"""Teacher papers: bank search, drafts and publishing (teacher app P1a)."""
import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app.models.knowledge import KnowledgePoint
from app.services.question_service import QuestionService
from app.services.student_service import StudentService
from app.services.teacher_service import TeacherService
from tests.test_teacher_accounts import bearer, build_app, client_for, ready_teacher


async def add_question(db_session, qid: str, question_type: str, *, tier: str = "medium",
                       status: str = "approved", kp: str = "kp_motion", answer: str = "A"):
    options = []
    if question_type in {"single_choice", "multiple_choice"}:
        options = [{"label": label, "text": f"选项{label}", "is_correct": label == "A"} for label in "ABCD"]
    await QuestionService(db_session).create_question({
        "id": qid,
        "stem_text": f"{qid} 题干 $v=at$",
        "answer": answer,
        "explanation": "解析",
        "source": "human",
        "question_type": question_type,
        "difficulty_tier": tier,
        "quality_status": status,
        "options": options,
        "labels": [{"label_type": "knowledge_point", "label_id": kp, "role": "主要"}],
        "formulas": [],
        "images": [],
    })


async def setup_bank(db_session):
    db_session.add(KnowledgePoint(id="kp_motion", name="匀变速直线运动", volume="必修一", chapter="匀变速直线运动"))
    await db_session.commit()
    for qid in ("q_c1", "q_c2", "q_c3"):
        await add_question(db_session, qid, "single_choice")
    await add_question(db_session, "q_p1", "problem_solving", answer="v=10 m/s")
    await add_question(db_session, "q_p2", "problem_solving", tier="moderate_hard", answer="t=2 s")
    await add_question(db_session, "q_x1", "experiment", answer="略")
    await add_question(db_session, "q_draft", "single_choice", status="draft")


async def setup_class(db_session, client, *, members=("alice_s", "bob_s")):
    students = StudentService(db_session)
    created = [await students.create_student(name, "pass123", name.split("_")[0].title()) for name in members]
    teacher_id, token = await ready_teacher(client, "wang", "王老师")
    teacher_class = (await client.post(f"/api/admin/teachers/{teacher_id}/classes", json={"name": "高一(3)班"})).json()
    for name in members:
        await client.post(f"/api/admin/teacher-classes/{teacher_class['id']}/members", json={"username": name, "grantor": "school"})
    return token, teacher_class["id"], created


async def draft_with(client, token, class_id, items):
    created = await client.post(f"/api/teacher/classes/{class_id}/assignments", headers=bearer(token),
                                json={"title": "运动学单元测验"})
    assert created.status_code == 201, created.text
    assignment_id = created.json()["id"]
    updated = await client.put(f"/api/teacher/assignments/{assignment_id}", headers=bearer(token),
                               json={"items": items})
    assert updated.status_code == 200, updated.text
    return assignment_id, updated.json()


@pytest.mark.asyncio
async def test_search_lists_approved_questions_with_class_stats(db_session):
    await setup_bank(db_session)
    async with client_for(build_app(db_session)) as client:
        token, class_id, (alice, _) = await setup_class(db_session, client)
        await StudentService(db_session).record_answer(alice.id, "q_c1", "A", True, 1000)

        found = await client.get(f"/api/teacher/classes/{class_id}/questions", headers=bearer(token),
                                 params={"kp_id": "kp_motion", "question_type": "single_choice"})
        assert found.status_code == 200
        body = found.json()
        assert {item["id"] for item in body["items"]} == {"q_c1", "q_c2", "q_c3"}
        stats = {item["id"]: (item["class_attempted"], item["class_correct_rate"]) for item in body["items"]}
        assert stats["q_c1"] == (1, 1.0) and stats["q_c2"] == (0, None)
        first = body["items"][0]
        assert first["primary_kp"]["name"] == "匀变速直线运动"
        assert first["default_box"] is None and first["default_points"] == 4
        assert first["explanation"] == "解析" and first["image_types"] == []

        assert (await client.get(f"/api/teacher/classes/{class_id}/questions", headers=bearer(token),
                                 params={"question_type": "essay"})).status_code == 400
        kps = await client.get("/api/teacher/knowledge-points", headers=bearer(token))
        assert [kp["id"] for kp in kps.json()] == ["kp_motion"]
        outline = (await client.get("/api/teacher/question-bank/outline", headers=bearer(token))).json()
        # Six approved questions; the draft one is not counted.
        assert outline["points"] == {"kp_motion": 6}
        assert outline["chapters"] == {"必修一||匀变速直线运动": 6} and outline["volumes"] == {"必修一": 6}

        _, other_token = await ready_teacher(client, "li", "李老师")
        foreign = await client.get(f"/api/teacher/classes/{class_id}/questions", headers=bearer(other_token))
        assert foreign.status_code == 404


@pytest.mark.asyncio
async def test_search_tells_each_figure_kind_by_position(db_session):
    await setup_bank(db_session)
    await QuestionService(db_session).create_question({
        "id": "q_fig", "stem_text": "如图所示，求加速度。", "answer": "2 m/s²", "explanation": "由图读出斜率。",
        "source": "human", "question_type": "problem_solving", "difficulty_tier": "medium",
        "quality_status": "approved", "options": [], "formulas": [],
        "labels": [{"label_type": "knowledge_point", "label_id": "kp_motion", "role": "主要"}],
        "images": [{"id": "img_a", "image_path": "/static/questions/q_fig_diagram_0.png", "image_type": "diagram"},
                   {"id": "img_b", "image_path": "/static/questions/q_fig_expl_0.png", "image_type": "explanation"}],
    })
    async with client_for(build_app(db_session)) as client:
        token, class_id, _ = await setup_class(db_session, client)
        found = await client.get(f"/api/teacher/classes/{class_id}/questions", headers=bearer(token),
                                 params={"search": "q_fig"})
        item = next(row for row in found.json()["items"] if row["id"] == "q_fig")
        assert item["image_paths"] == ["/static/questions/q_fig_diagram_0.png", "/static/questions/q_fig_expl_0.png"]
        assert item["image_types"] == ["diagram", "explanation"]


@pytest.mark.asyncio
async def test_draft_applies_defaults_and_rejects_bad_items(db_session):
    await setup_bank(db_session)
    async with client_for(build_app(db_session)) as client:
        token, class_id, _ = await setup_class(db_session, client)
        assignment_id, detail = await draft_with(client, token, class_id, [
            {"question_id": "q_c1"},
            {"question_id": "q_p1", "points": 15},
            {"question_id": "q_x1", "box": "small", "area_mm": 55},
        ])
        items = detail["items"]
        assert [(i["number"], i["question_id"], i["points"], i["box"], i["area_mm"]) for i in items] == [
            (1, "q_c1", 4.0, None, None), (2, "q_p1", 15.0, "large", None), (3, "q_x1", 8.0, "small", 55),
        ]
        assert detail["total_points"] == 27 and detail["status"] == "draft"
        assert items[1]["question"]["stem_text"].startswith("q_p1")

        path = f"/api/teacher/assignments/{assignment_id}"
        for bad in (
            [{"question_id": "q_c1"}, {"question_id": "q_c1"}],
            [{"question_id": "q_draft"}],
            [{"question_id": "q_missing"}],
            [{"question_id": "q_c1", "points": 0}],
            [{"question_id": "q_p1", "area_mm": 20}],
            [{"question_id": "q_p1", "area_mm": 240}],
            [{"question_id": "q_p1", "area_mm": 72}],
        ):
            response = await client.put(path, headers=bearer(token), json={"items": bad})
            assert response.status_code == 400, bad
        assert (await client.put(path, headers=bearer(token), json={"title": "  "})).status_code == 400

        listed = await client.get(f"/api/teacher/classes/{class_id}/assignments", headers=bearer(token))
        assert [(row["id"], row["question_count"]) for row in listed.json()] == [(assignment_id, 3)]


@pytest.mark.asyncio
async def test_alternatives_stay_on_knowledge_point_and_type_outside_the_paper(db_session):
    await setup_bank(db_session)
    async with client_for(build_app(db_session)) as client:
        token, class_id, _ = await setup_class(db_session, client)
        assignment_id, _ = await draft_with(client, token, class_id, [{"question_id": "q_c1"}, {"question_id": "q_c2"}])
        choice = await client.get(f"/api/teacher/assignments/{assignment_id}/alternatives",
                                  headers=bearer(token), params={"question_id": "q_c1"})
        assert [item["id"] for item in choice.json()] == ["q_c3"]

        await client.put(f"/api/teacher/assignments/{assignment_id}", headers=bearer(token),
                         json={"items": [{"question_id": "q_p1"}]})
        solving = await client.get(f"/api/teacher/assignments/{assignment_id}/alternatives",
                                   headers=bearer(token), params={"question_id": "q_p1"})
        assert [item["id"] for item in solving.json()] == ["q_p2"]


@pytest.mark.asyncio
async def test_publish_freezes_the_paper(db_session):
    await setup_bank(db_session)
    async with client_for(build_app(db_session)) as client:
        token, class_id, _ = await setup_class(db_session, client)
        empty_id, _ = await draft_with(client, token, class_id, [])
        assert (await client.post(f"/api/teacher/assignments/{empty_id}/publish", headers=bearer(token))).status_code == 400
        assert (await client.delete(f"/api/teacher/assignments/{empty_id}", headers=bearer(token))).status_code == 204

        assignment_id, _ = await draft_with(client, token, class_id, [{"question_id": "q_c1"}, {"question_id": "q_p1"}])

        published = await client.post(f"/api/teacher/assignments/{assignment_id}/publish", headers=bearer(token))
        assert published.status_code == 200
        assert published.json()["status"] == "published"

        await QuestionService(db_session).update_question("q_c1", {"stem_text": "题库里改过的题干"})
        frozen = await client.get(f"/api/teacher/assignments/{assignment_id}", headers=bearer(token))
        assert frozen.json()["items"][0]["question"]["stem_text"].startswith("q_c1")

        path = f"/api/teacher/assignments/{assignment_id}"
        assert (await client.put(path, headers=bearer(token), json={"title": "改名"})).status_code == 409
        assert (await client.delete(path, headers=bearer(token))).status_code == 409
        assert (await client.post(f"{path}/publish", headers=bearer(token))).status_code == 409

        _, other_token = await ready_teacher(client, "li", "李老师")
        for method, suffix in (("get", ""), ("post", "/publish")):
            response = await getattr(client, method)(f"{path}{suffix}", headers=bearer(other_token))
            assert response.status_code == 404


@pytest.mark.asyncio
async def test_publish_needs_students_in_the_class(db_session):
    await setup_bank(db_session)
    async with client_for(build_app(db_session)) as client:
        token, class_id, _ = await setup_class(db_session, client, members=())
        assignment_id, _ = await draft_with(client, token, class_id, [{"question_id": "q_c1"}])
        response = await client.post(f"/api/teacher/assignments/{assignment_id}/publish", headers=bearer(token))
        assert response.status_code == 400


@pytest.mark.asyncio
async def test_migration_creates_tables_guards_erased_students_and_downgrades(db_session):
    from tests.test_account_deletion import install_guards

    await install_guards(db_session)
    spec = importlib.util.spec_from_file_location(
        "assignment_migration", Path(__file__).resolve().parents[1] / "alembic/versions/0036_teacher_assignments.py",
    )
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    def recreate(connection):
        # Later teacher tables depend on these, so they go first.
        for table in ("teacher_student_papers", "teacher_grading_runs", "teacher_ai_calls", "teacher_submission_items", "teacher_submissions",
                      "teacher_scan_pages", "teacher_scan_batches", "teacher_answer_sheets", "teacher_assignments"):
            connection.execute(text(f"DROP TABLE IF EXISTS {table}"))
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()

    await (await db_session.connection()).run_sync(recreate)
    await db_session.commit()

    student = await StudentService(db_session).create_student("erased_s", "pass123", "Erased")
    service = TeacherService(db_session)
    teacher = await service.create_teacher("wang", "王老师", "init2026pass")
    teacher_class = await service.create_class(teacher.id, "高一(3)班")
    await db_session.execute(text(
        "INSERT INTO teacher_assignments (id, teacher_id, class_id, title) VALUES ('a_1', :t, :c, '测验')"
    ), {"t": teacher.id, "c": teacher_class.id})
    await db_session.execute(text("UPDATE students SET status='deleted' WHERE id=:id"), {"id": student.id})
    await db_session.commit()
    with pytest.raises(IntegrityError):
        await db_session.execute(text(
            "INSERT INTO teacher_answer_sheets (id, assignment_id, student_id, layout) "
            "VALUES ('SHEET00001', 'a_1', :s, '{}')"
        ), {"s": student.id})
    await db_session.rollback()

    def downgrade(connection):
        with Operations.context(MigrationContext.configure(connection)):
            migration.downgrade()

    await (await db_session.connection()).run_sync(downgrade)
    await db_session.commit()
    remaining = await db_session.execute(text(
        "SELECT count(*) FROM information_schema.tables "
        "WHERE table_name IN ('teacher_assignments', 'teacher_answer_sheets')"
    ))
    assert remaining.scalar_one() == 0


@pytest.mark.asyncio
async def test_choice_questions_always_lead_the_paper(db_session):
    await setup_bank(db_session)
    async with client_for(build_app(db_session)) as client:
        token, class_id, _ = await setup_class(db_session, client)
        _, detail = await draft_with(client, token, class_id, [
            {"question_id": "q_p1"}, {"question_id": "q_c2"}, {"question_id": "q_x1"}, {"question_id": "q_c1"},
        ])
        assert [item["question_id"] for item in detail["items"]] == ["q_c2", "q_c1", "q_p1", "q_x1"]
        assert [item["number"] for item in detail["items"]] == [1, 2, 3, 4]


@pytest.mark.asyncio
async def test_search_can_hide_questions_the_class_already_answered(db_session):
    await setup_bank(db_session)
    async with client_for(build_app(db_session)) as client:
        token, class_id, (alice, _) = await setup_class(db_session, client)
        await StudentService(db_session).record_answer(alice.id, "q_c1", "B", False, 1000)
        outsider = await StudentService(db_session).create_student("dave_s", "pass123", "Dave")
        await StudentService(db_session).record_answer(outsider.id, "q_c2", "A", True, 1000)

        found = await client.get(f"/api/teacher/classes/{class_id}/questions", headers=bearer(token),
                                 params={"question_type": "single_choice", "exclude_attempted": "true"})
        assert {item["id"] for item in found.json()["items"]} == {"q_c2", "q_c3"}
        assert found.json()["total"] == 2


@pytest.mark.asyncio
async def test_teacher_numbers_the_roster_for_paper_homework(db_session):
    async with client_for(build_app(db_session)) as client:
        token, class_id, created = await setup_class(db_session, client, members=("alice_s", "bob_s", "carol_s"))
        students = {student.username: student for student in created}
        path = f"/api/teacher/classes/{class_id}/members"

        set_bob = await client.put(f"{path}/{students['bob_s'].id}/number", headers=bearer(token),
                                   json={"student_number": "02"})
        assert set_bob.status_code == 200
        assert {m["username"]: m["student_number"] for m in set_bob.json()["members"]}["bob_s"] == "2"

        clash = await client.put(f"{path}/{students['alice_s'].id}/number", headers=bearer(token),
                                 json={"student_number": "2"})
        assert clash.status_code == 409
        for bad in ("A1", "12345"):
            response = await client.put(f"{path}/{students['alice_s'].id}/number", headers=bearer(token),
                                        json={"student_number": bad})
            assert response.status_code == 400

        numbered = await client.post(f"{path}/auto-number", headers=bearer(token))
        members = numbered.json()["members"]
        assert [(m["username"], m["student_number"]) for m in members] == [
            ("alice_s", "1"), ("bob_s", "2"), ("carol_s", "3"),
        ]

        cleared = await client.put(f"{path}/{students['alice_s'].id}/number", headers=bearer(token),
                                   json={"student_number": None})
        assert [m["username"] for m in cleared.json()["members"]][-1] == "alice_s"

        _, other_token = await ready_teacher(client, "li", "李老师")
        foreign = await client.post(f"{path}/auto-number", headers=bearer(other_token))
        assert foreign.status_code == 404


@pytest.mark.asyncio
async def test_member_number_migration_downgrades_and_upgrades(db_session):
    spec = importlib.util.spec_from_file_location(
        "number_migration", Path(__file__).resolve().parents[1] / "alembic/versions/0037_class_member_numbers.py",
    )
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    def columns(connection):
        return {row[0] for row in connection.execute(text(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'teacher_class_members'"
        ))}

    def run(connection, step):
        with Operations.context(MigrationContext.configure(connection)):
            step()
        return columns(connection)

    connection = await db_session.connection()
    assert "student_number" not in await connection.run_sync(lambda c: run(c, migration.downgrade))
    assert "student_number" in await connection.run_sync(lambda c: run(c, migration.upgrade))
    await db_session.commit()


@pytest.mark.asyncio
async def test_answer_sheet_table_is_dropped_and_restored_on_downgrade(db_session):
    spec = importlib.util.spec_from_file_location(
        "drop_sheets_migration",
        Path(__file__).resolve().parents[1] / "alembic/versions/0040_drop_teacher_answer_sheets.py",
    )
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    async def sheet_table_exists() -> bool:
        result = await db_session.execute(text(
            "SELECT count(*) FROM information_schema.tables WHERE table_name = 'teacher_answer_sheets'"
        ))
        return result.scalar_one() == 1

    def run(step):
        def apply(connection):
            with Operations.context(MigrationContext.configure(connection)):
                step()
        return apply

    from tests.test_account_deletion import install_guards

    await install_guards(db_session)
    assert not await sheet_table_exists()
    await (await db_session.connection()).run_sync(run(migration.downgrade))
    await db_session.commit()
    assert await sheet_table_exists()
    await (await db_session.connection()).run_sync(run(migration.upgrade))
    await db_session.commit()
    assert not await sheet_table_exists()
