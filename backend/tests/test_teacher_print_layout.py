import pytest

from app.services.paper_items import normalize_print_layout
from tests.test_teacher_accounts import bearer, build_app, client_for, ready_teacher
from tests.test_teacher_assignments import setup_bank, setup_class, draft_with


@pytest.mark.parametrize("value", [[], {"css": "x"}, {"figure": "left"}, {"figure": []},
    {"figure_width_mm": 19}, {"figure_width_mm": 80}, {"figure_width_mm": 33},
    {"figure_width_mm": True}, {"break_before": "page"}])
def test_print_settings_reject_unbounded_or_arbitrary_layout(value):
    with pytest.raises(ValueError):
        normalize_print_layout(value)


@pytest.mark.asyncio
async def test_layout_survives_save_and_pdf_snapshot_and_cannot_change_published_paper(db_session, monkeypatch):
    from unittest.mock import AsyncMock
    await setup_bank(db_session)
    renderer = AsyncMock(return_value=b"%PDF-1.7\nfixture")
    monkeypatch.setattr("app.api.teacher.router.render_pdf", renderer)
    async with client_for(build_app(db_session)) as client:
        token, class_id, _ = await setup_class(db_session, client)
        layout = {"figure": "wrap", "figure_width_mm": 35, "break_before": "column"}
        assignment_id, detail = await draft_with(client, token, class_id, [
            {"question_id": "q_c1", "print_layout": layout},
            {"question_id": "q_p1", "box": "large", "area_mm": 110},
        ])
        assert detail["items"][0]["print_layout"] == layout
        path = f"/api/teacher/assignments/{assignment_id}"
        _, other = await ready_teacher(client, "print_other", "其他老师")
        assert (await client.put(path, headers=bearer(other), json={"items": []})).status_code == 404
        assert (await client.put(path, headers=bearer(token), json={"items": [
            {"question_id": "q_c1", "print_layout": {"figure_width_mm": 500}},
        ]})).status_code == 400
        assert (await client.get(path, headers=bearer(token))).json()["items"][0]["print_layout"] == layout
        published = await client.post(path + "/publish", headers=bearer(token))
        assert published.status_code == 200, published.text
        assert (await client.get(path + "/pdf", headers=bearer(token))).status_code == 200
        snapshot = renderer.call_args.args[0]
        assert snapshot["detail"]["items"][0]["print_layout"] == layout
        assert snapshot["detail"]["items"][1]["area_mm"] == 110
        assert snapshot["detail"]["items"][0]["number"] == 1
        assert (await client.put(path, headers=bearer(token), json={"items": [
            {"question_id": "q_c1", "print_layout": None},
        ]})).status_code == 409
