"""Homework library: papers and personalized settings owned by the teacher, assigned to classes."""
import importlib.util
from datetime import datetime, timezone
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import select, text

from app.models.teacher import TeacherAssignment
from app.models.teacher_scan import TeacherSubmission
from app.services.student_service import StudentService
from tests.test_teacher_accounts import bearer, build_app, client_for, ready_teacher
from tests.test_teacher_assignments import setup_bank
from tests.test_teacher_personalized import setup_scope


async def two_classes(db_session, client):
    """王老师 with 高一(3)班 (Alice, Bob) and 高一(5)班 (Carol)."""
    students = StudentService(db_session)
    for name in ("alice_s", "bob_s", "carol_s"):
        await students.create_student(name, "pass123", name.split("_")[0].title())
    teacher_id, token = await ready_teacher(client, "wang", "王老师")
    classes = {}
    for name, members in (("高一(3)班", ("alice_s", "bob_s")), ("高一(5)班", ("carol_s",))):
        created = (await client.post(f"/api/admin/teachers/{teacher_id}/classes", json={"name": name})).json()
        for member in members:
            await client.post(f"/api/admin/teacher-classes/{created['id']}/members", json={"username": member, "grantor": "school"})
        classes[name] = created["id"]
    return token, classes["高一(3)班"], classes["高一(5)班"]


@pytest.mark.asyncio
async def test_one_paper_goes_to_several_classes_each_with_its_own_frozen_copy(db_session):
    await setup_bank(db_session)
    async with client_for(build_app(db_session)) as client:
        token, class_3, class_5 = await two_classes(db_session, client)
        created = await client.post("/api/teacher/assignments", headers=bearer(token), json={"title": "运动学单元测验"})
        assert created.status_code == 201, created.text
        paper = created.json()
        assert paper["class_id"] is None and paper["class_name"] is None and paper["assigned"] == []
        paper_id = paper["id"]

        # A paper is searched and composed without a class: answer counts span all the teacher's classes.
        found = await client.get("/api/teacher/questions", headers=bearer(token), params={"kp_id": "kp_motion"})
        assert found.status_code == 200 and found.json()["total"] == 6
        empty = await client.post(f"/api/teacher/assignments/{paper_id}/assign", headers=bearer(token),
                                  json={"class_ids": [class_3]})
        assert empty.status_code == 400
        await client.put(f"/api/teacher/assignments/{paper_id}", headers=bearer(token),
                         json={"items": [{"question_id": "q_c1"}, {"question_id": "q_p1"}]})
        assert (await client.post(f"/api/teacher/assignments/{paper_id}/publish", headers=bearer(token))).status_code == 400

        assigned = await client.post(f"/api/teacher/assignments/{paper_id}/assign", headers=bearer(token),
                                     json={"class_ids": [class_3, class_5]})
        assert assigned.status_code == 200, assigned.text
        rows = assigned.json()["assigned"]
        assert {row["class_id"] for row in rows} == {class_3, class_5}
        assert all(row["status"] == "published" and row["source_id"] == paper_id for row in rows)

        # Publishing saved the paper: it is fixed now, and every class holds exactly it.
        edited = await client.put(f"/api/teacher/assignments/{paper_id}", headers=bearer(token),
                                  json={"items": [{"question_id": "q_c2"}]})
        assert edited.status_code == 409 and "复制" in edited.json()["detail"]
        class_copy = (await client.get(f"/api/teacher/assignments/{rows[0]['id']}", headers=bearer(token))).json()
        assert [item["question_id"] for item in class_copy["items"]] == ["q_c1", "q_p1"]
        assert class_copy["class_name"] in {"高一(3)班", "高一(5)班"}

        again = await client.post(f"/api/teacher/assignments/{paper_id}/assign", headers=bearer(token),
                                  json={"class_ids": [class_3]})
        assert again.status_code == 409 and "复制" in again.json()["detail"]
        copied = await client.post(f"/api/teacher/assignments/{paper_id}/copy", headers=bearer(token))
        assert copied.status_code == 201
        assert copied.json()["title"] == "运动学单元测验（副本）" and copied.json()["class_id"] is None

        library = (await client.get("/api/teacher/assignments", headers=bearer(token))).json()
        assert [group["title"] for group in library] == ["运动学单元测验（副本）", "运动学单元测验"]
        original = library[1]
        assert original["is_paper"] and {row["class_name"] for row in original["classes"]} == {"高一(3)班", "高一(5)班"}
        assert {row["member_count"] for row in original["classes"]} == {2, 1}
        detail = (await client.get(f"/api/teacher/assignments/{paper_id}", headers=bearer(token))).json()
        assert {row["class_id"] for row in detail["assigned"]} == {class_3, class_5}

        # Deleting the paper keeps what the classes already hold.
        assert (await client.delete(f"/api/teacher/assignments/{paper_id}", headers=bearer(token))).status_code == 204
        kept = (await client.get(f"/api/teacher/assignments/{rows[0]['id']}", headers=bearer(token)))
        assert kept.status_code == 200 and kept.json()["source_id"] is None


@pytest.mark.asyncio
async def test_personalized_settings_are_drafted_for_each_chosen_class_and_reused(db_session):
    await setup_scope(db_session)
    async with client_for(build_app(db_session)) as client:
        token, class_3, class_5 = await two_classes(db_session, client)
        body = {"title": "第一周个性化作业", "scope": [{"volume": "必修一", "chapter": "匀变速直线运动"}],
                "choice_count": 2, "area_count": 1}
        assert (await client.post("/api/teacher/personalized", headers=bearer(token),
                                  json={**body, "scope": [{"volume": "必修三"}], "class_ids": [class_3]})).status_code == 400
        created = await client.post("/api/teacher/personalized", headers=bearer(token),
                                    json={**body, "class_ids": [class_3, class_5]})
        assert created.status_code == 201, created.text
        paper = created.json()["paper"]
        drafts = created.json()["assigned"]
        assert paper["class_id"] is None and len(drafts) == 2 and all(d["status"] == "draft" for d in drafts)
        sizes = {}
        for draft in drafts:
            detail = (await client.get(f"/api/teacher/assignments/{draft['id']}", headers=bearer(token))).json()
            sizes[detail["class_name"]] = len(detail["papers"])
        assert sizes == {"高一(3)班": 2, "高一(5)班": 1}

        # The same settings again, for one class: personalized homework may repeat.
        again = await client.post(f"/api/teacher/assignments/{paper['id']}/assign", headers=bearer(token),
                                  json={"class_ids": [class_5]})
        assert again.status_code == 200 and again.json()["assigned"][0]["status"] == "draft"
        library = (await client.get("/api/teacher/assignments", headers=bearer(token))).json()
        assert len(library) == 1 and len(library[0]["classes"]) == 3


@pytest.mark.asyncio
async def test_class_homework_lists_turn_in_and_released_scores(db_session):
    await setup_bank(db_session)
    async with client_for(build_app(db_session)) as client:
        token, class_3, _ = await two_classes(db_session, client)
        paper_id = (await client.post("/api/teacher/assignments", headers=bearer(token), json={"title": "单元测验"})).json()["id"]
        await client.put(f"/api/teacher/assignments/{paper_id}", headers=bearer(token),
                         json={"items": [{"question_id": "q_c1", "points": 4}, {"question_id": "q_p1", "points": 16}]})
        row_id = (await client.post(f"/api/teacher/assignments/{paper_id}/assign", headers=bearer(token),
                                    json={"class_ids": [class_3]})).json()["assigned"][0]["id"]
        members = (await client.get(f"/api/teacher/classes/{class_3}", headers=bearer(token))).json()["members"]
        alice = next(m["id"] for m in members if m["display_name"] == "Alice")
        db_session.add(TeacherSubmission(id="sub_1", assignment_id=row_id, student_id=alice, status="graded",
                                         ai_authorized=True, total_score=15))
        await db_session.commit()

        before = (await client.get(f"/api/teacher/classes/{class_3}/homework", headers=bearer(token))).json()
        assert before["assignments"][0]["collected"] == 1 and before["assignments"][0]["average"] is None
        assert all(student["scores"] == {} for student in before["students"])

        row = await db_session.get(TeacherAssignment, row_id)
        row.results_released_at = datetime.now(timezone.utc)
        await db_session.commit()
        after = (await client.get(f"/api/teacher/classes/{class_3}/homework", headers=bearer(token))).json()
        summary = after["assignments"][0]
        assert (summary["collected"], summary["member_count"], summary["average"], summary["rate"]) == (1, 2, 15, 0.75)
        scores = {student["display_name"]: student["scores"] for student in after["students"]}
        assert scores["Alice"] == {row_id: {"score": 15, "full": 20}} and scores["Bob"] == {}


@pytest.mark.asyncio
async def test_teachers_only_reach_their_own_papers_and_classes(db_session):
    await setup_bank(db_session)
    async with client_for(build_app(db_session)) as client:
        token, class_3, _ = await two_classes(db_session, client)
        paper_id = (await client.post("/api/teacher/assignments", headers=bearer(token), json={"title": "单元测验"})).json()["id"]
        await client.put(f"/api/teacher/assignments/{paper_id}", headers=bearer(token),
                         json={"items": [{"question_id": "q_c1"}]})
        other_id, other_token = await ready_teacher(client, "li", "李老师")
        other_class = (await client.post(f"/api/admin/teachers/{other_id}/classes", json={"name": "高二(1)班"})).json()["id"]
        other = bearer(other_token)

        assert (await client.get(f"/api/teacher/assignments/{paper_id}", headers=other)).status_code == 404
        assert (await client.post(f"/api/teacher/assignments/{paper_id}/copy", headers=other)).status_code == 404
        assert (await client.post(f"/api/teacher/assignments/{paper_id}/assign", headers=other,
                                  json={"class_ids": [other_class]})).status_code == 404
        # Nor can a teacher assign their own paper into someone else's class.
        assert (await client.post(f"/api/teacher/assignments/{paper_id}/assign", headers=bearer(token),
                                  json={"class_ids": [other_class]})).status_code == 404
        assert (await client.get("/api/teacher/questions", headers=bearer(token),
                                 params={"class_id": other_class})).status_code == 404
        assert (await client.get(f"/api/teacher/assignments/{paper_id}", headers=bearer(token),
                                 params={"stats_class_id": other_class})).status_code == 404
        assert (await client.get(f"/api/teacher/classes/{class_3}/homework", headers=other)).status_code == 404
        assert (await client.get("/api/teacher/assignments", headers=other)).json() == []


@pytest.mark.asyncio
async def test_migration_turns_existing_rows_into_papers_and_class_copies(db_session):
    spec = importlib.util.spec_from_file_location(
        "library_migration", Path(__file__).resolve().parents[1] / "alembic/versions/0043_teacher_assignment_library.py",
    )
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    from app.services.teacher_service import TeacherService

    service = TeacherService(db_session)
    teacher = await service.create_teacher("wang", "王老师", "init2026pass")
    teacher_class = await service.create_class(teacher.id, "高一(3)班")
    items = '[{"question_id": "q_c1", "points": 4, "box": null}]'
    for row_id, kind, status in (("a_draft", "test", "draft"), ("a_pub", "test", "published"),
                                 ("a_pers", "personalized", "published")):
        await db_session.execute(text(
            "INSERT INTO teacher_assignments (id, teacher_id, class_id, kind, title, status, items, settings) "
            "VALUES (:id, :t, :c, :kind, :id, :status, CAST(:items AS JSONB), CAST(:settings AS JSONB))"
        ), {"id": row_id, "t": teacher.id, "c": teacher_class.id, "kind": kind, "status": status, "items": items,
            "settings": '{"scope": [{"volume": "必修一"}], "choice_count": 2, "area_count": 1}'
            if kind == "personalized" else None})
    await db_session.commit()

    def upgrade(connection):
        # The test schema already has the new columns: undo them, then run the migration as written.
        connection.execute(text("ALTER TABLE teacher_assignments DROP COLUMN source_id"))
        connection.execute(text("DELETE FROM teacher_assignments WHERE class_id IS NULL"))
        connection.execute(text("ALTER TABLE teacher_assignments ALTER COLUMN class_id SET NOT NULL"))
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()

    await (await db_session.connection()).run_sync(upgrade)
    await db_session.commit()
    rows = {row.id: row for row in (await db_session.execute(select(TeacherAssignment))).scalars().all()}
    assert rows["a_draft"].class_id is None and rows["a_draft"].source_id is None
    for row_id in ("a_pub", "a_pers"):
        source = rows[rows[row_id].source_id]
        assert source.class_id is None and source.kind == rows[row_id].kind and source.status == "draft"
    assert rows[rows["a_pub"].source_id].items == [{"question_id": "q_c1", "points": 4, "box": None}]
    assert rows[rows["a_pers"].source_id].items == [] and rows[rows["a_pers"].source_id].settings["choice_count"] == 2
    assert len(rows) == 5


@pytest.mark.asyncio
async def test_a_saved_paper_is_fixed_as_printed_and_published_as_it_is(db_session):
    await setup_bank(db_session)
    async with client_for(build_app(db_session)) as client:
        token, class_3, class_5 = await two_classes(db_session, client)
        paper_id = (await client.post("/api/teacher/assignments", headers=bearer(token),
                                      json={"title": "周测"})).json()["id"]
        url = f"/api/teacher/assignments/{paper_id}"
        assert (await client.post(f"{url}/save", headers=bearer(token))).status_code == 400  # nothing in it yet
        await client.put(url, headers=bearer(token), json={"items": [
            {"question_id": "q_c1"}, {"question_id": "q_p1", "area_mm": 90}]})

        saved = await client.post(f"{url}/save", headers=bearer(token))
        assert saved.status_code == 200, saved.text
        detail = saved.json()
        assert detail["status"] == "saved" and detail["class_id"] is None and detail["published_at"]
        assert [item["question_id"] for item in detail["items"]] == ["q_c1", "q_p1"]
        assert detail["items"][1]["area_mm"] == 90 and detail["items"][0]["question"]["stem_text"]

        # Fixed: no edits, no answer-area changes, no second save; a copy is a fresh draft.
        for body in ({"title": "改名"}, {"items": [{"question_id": "q_c2"}]}):
            refused = await client.put(url, headers=bearer(token), json=body)
            assert refused.status_code == 409 and "复制" in refused.json()["detail"]
        assert (await client.post(f"{url}/save", headers=bearer(token))).status_code == 409
        copied = (await client.post(f"{url}/copy", headers=bearer(token))).json()
        assert copied["status"] == "draft" and len(copied["items"]) == 2

        # The bank question changes after printing; the classes still get what was printed.
        printed = detail["items"][0]["question"]["stem_text"]
        await db_session.execute(text("UPDATE questions SET stem_text = '改过的题干' WHERE id = 'q_c1'"))
        await db_session.commit()
        published = await client.post(f"{url}/assign", headers=bearer(token), json={"class_ids": [class_3, class_5]})
        assert published.status_code == 200, published.text
        for row in published.json()["assigned"]:
            class_copy = (await client.get(f"/api/teacher/assignments/{row['id']}", headers=bearer(token))).json()
            assert class_copy["status"] == "published" and class_copy["items"][0]["question"]["stem_text"] == printed
            assert class_copy["items"][1]["area_mm"] == 90
        library = (await client.get("/api/teacher/assignments", headers=bearer(token))).json()
        entry = next(group for group in library if group["id"] == paper_id)
        assert entry["status"] == "saved" and len(entry["classes"]) == 2

        # A saved paper can leave the history; the classes keep their copies.
        assert (await client.delete(url, headers=bearer(token))).status_code == 204


@pytest.mark.asyncio
async def test_saved_source_deletion_is_owned_and_preserves_class_results(db_session):
    await setup_bank(db_session)
    async with client_for(build_app(db_session)) as client:
        token, class_id, _ = await two_classes(db_session, client)
        teacher = bearer(token)
        source_id = (await client.post('/api/teacher/assignments', headers=teacher,
                                      json={'title': '可删除的保存试卷'})).json()['id']
        source_url = f'/api/teacher/assignments/{source_id}'
        await client.put(source_url, headers=teacher, json={'items': [{'question_id': 'q_c1'}]})
        await client.post(source_url + '/save', headers=teacher)
        assigned = await client.post(source_url + '/assign', headers=teacher, json={'class_ids': [class_id]})
        execution_id = assigned.json()['assigned'][0]['id']
        members = (await client.get(f'/api/teacher/classes/{class_id}', headers=teacher)).json()['members']
        db_session.add(TeacherSubmission(id='sub_keep', assignment_id=execution_id, student_id=members[0]['id'],
                                         status='graded', ai_authorized=True, total_score=4))
        execution = await db_session.get(TeacherAssignment, execution_id)
        execution.results_released_at = datetime.now(timezone.utc)
        await db_session.commit()
        _, other = await ready_teacher(client, 'li', '李老师')
        assert (await client.delete(source_url, headers=bearer(other))).status_code == 404
        assert (await client.get(source_url, headers=teacher)).status_code == 200
        assert (await client.delete(f'/api/teacher/assignments/{execution_id}', headers=teacher)).status_code == 409
        assert (await client.delete(source_url, headers=teacher)).status_code == 204
        assert (await client.get(source_url, headers=teacher)).status_code == 404
        # Requests share this test session; reload the FK changed by ON DELETE SET NULL.
        await db_session.refresh(execution)
        kept = (await client.get(f'/api/teacher/assignments/{execution_id}', headers=teacher)).json()
        assert kept['source_id'] is None and kept['collected'] == 1 and kept['results_released_at']
        submission = await db_session.get(TeacherSubmission, 'sub_keep')
        assert submission.total_score == 4 and submission.student_id == members[0]['id']
        library = (await client.get('/api/teacher/assignments', headers=teacher)).json()
        retained = next(entry for entry in library if entry['id'] == execution_id)
        assert not retained['is_paper'] and retained['classes'][0]['collected'] == 1
