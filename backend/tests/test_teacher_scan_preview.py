"""Read-only scan image inspection stays available after collection is locked."""
from datetime import datetime, timezone

import pytest

from app.models.teacher import TeacherAssignment
from app.models.teacher_scan import TeacherScanBatch, TeacherScanPage
from tests.test_teacher_accounts import bearer, client_for, ready_teacher
from tests.test_teacher_scans import FakeRecognizer, published_homework, scan_app


@pytest.mark.asyncio
async def test_scan_preview_orders_pages_and_remains_readable_after_release(db_session, tmp_path):
    recognizer = FakeRecognizer([])
    async with client_for(scan_app(db_session, tmp_path, recognizer)) as client:
        token, _, assignment_id, students, numbers = await published_homework(client, db_session)
        assignment = await db_session.get(TeacherAssignment, assignment_id)
        batch = TeacherScanBatch(
            id="b_preview", assignment_id=assignment_id, teacher_id=assignment.teacher_id,
            filename="班级.pdf", sha256="preview", status="done", page_count=3, processed_pages=3,
        )
        db_session.add(batch)
        await db_session.flush()
        db_session.add_all([
            TeacherScanPage(id="p_later", batch_id=batch.id, assignment_id=assignment_id, page_index=3,
                            kind="continuation", status="ignored", image_path=None),
            TeacherScanPage(id="p_first", batch_id=batch.id, assignment_id=assignment_id, page_index=1,
                            kind="first", status="ok", student_id=students["alice_s"].id,
                            image_path=f"teacher_scans/{assignment_id}/{batch.id}/page_1.png"),
            TeacherScanPage(id="p_issue", batch_id=batch.id, assignment_id=assignment_id, page_index=2,
                            kind="first", status="exception", issue="unknown_number",
                            image_path=f"teacher_scans/{assignment_id}/{batch.id}/page_2.png"),
        ])
        await db_session.commit()

        url = f"/api/teacher/scan-batches/{batch.id}/pages"
        response = await client.get(url, headers=bearer(token))
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["filename"] == "班级.pdf"
        assert [p["page_index"] for p in data["pages"]] == [1, 2, 3]
        first, issue, ignored = data["pages"]
        assert first["student_name"] == students["alice_s"].display_name
        assert first["student_number"] == numbers["alice_s"]
        assert first["image_url"].startswith("/api/teacher/scan-images/")
        assert "image_path" not in first
        assert issue["issue_label"] == "学号不在本班名单中"
        assert issue["student_name"] is None
        assert ignored["image_url"] is None

        assignment.results_released_at = datetime.now(timezone.utc)
        await db_session.commit()
        released = await client.get(url, headers=bearer(token))
        assert released.status_code == 200, released.text
        assert len(released.json()["pages"]) == 3
        # Inspection never reprocesses, changes counts, or starts recognition.
        assert (batch.status, batch.page_count, batch.processed_pages) == ("done", 3, 3)
        assert not recognizer.number_images and not recognizer.choice_images
        assert (await client.delete(f"/api/teacher/scan-batches/{batch.id}", headers=bearer(token))).status_code == 409


@pytest.mark.asyncio
async def test_scan_preview_rejects_anonymous_and_other_teachers(db_session, tmp_path):
    async with client_for(scan_app(db_session, tmp_path, FakeRecognizer([]))) as client:
        token, _, assignment_id, _, _ = await published_homework(client, db_session)
        assignment = await db_session.get(TeacherAssignment, assignment_id)
        db_session.add(TeacherScanBatch(
            id="b_private", assignment_id=assignment_id, teacher_id=assignment.teacher_id,
            filename="私有扫描.pdf", sha256="private", status="done",
        ))
        await db_session.commit()
        url = "/api/teacher/scan-batches/b_private/pages"
        assert (await client.get(url)).status_code == 401
        _, other_token = await ready_teacher(client, "li_preview", "李老师")
        other = await client.get(url, headers=bearer(other_token))
        assert other.status_code == 404
        assert "私有扫描" not in other.text
        assert (await client.get("/api/teacher/scan-batches/missing/pages", headers=bearer(token))).status_code == 404
        assert (await client.get(url, headers=bearer(token))).json()["pages"] == []
