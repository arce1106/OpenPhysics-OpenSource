"""Typed per-student counts survive drafting, reuse, and redrafting without replacing missing types."""
from collections import Counter

import pytest

from app.services.personalized_service import Candidate, Evidence, PersonalizedHomeworkService, draft_paper
from app.services.teacher_service import TeacherServiceError
from tests.test_teacher_accounts import bearer, build_app, client_for, ready_teacher
from tests.test_teacher_assignments import add_question
from tests.test_teacher_library import two_classes
from tests.test_teacher_personalized import setup_scope


@pytest.mark.parametrize("counts, expected", [
    ((1, 2, 1), {"choice": 1, "experiment": 2, "problem_solving": 1}),
    ((0, 0, 2), {"problem_solving": 2}),
    ((1, 3, 1), {"choice": 1, "experiment": 2, "problem_solving": 1}),
])
def test_each_type_keeps_its_quota_and_unseen_shortage_does_not_fill_with_other_types(counts, expected):
    candidates = [Candidate(id=f"{kind}_{index}", kp_id="kp", choice=kind == "choice", tier="medium", model=None,
                            question_type="single_choice" if kind == "choice" else kind)
                  for kind in ("choice", "experiment", "problem_solving", "fill_in_blank") for index in range(3)]
    evidence = Evidence(done={f"{kind}_0" for kind in ("choice", "experiment", "problem_solving")})
    items = draft_paper(evidence, {"kp": candidates}, {"kp": "运动"}, counts[0], counts[1] + counts[2],
                        experiment_count=counts[1], calculation_count=counts[2], seed="student")
    by_id = {c.id: c for c in candidates}
    actual = ["choice" if by_id[item["question_id"]].choice else by_id[item["question_id"]].question_type for item in items]
    assert Counter(actual) == Counter(expected)
    assert actual == sorted(actual, key=("choice", "experiment", "problem_solving").index)
    assert not evidence.done.intersection(item["question_id"] for item in items)


@pytest.mark.parametrize("choice, experiment, calculation", [(0, 0, 0), (20, 20, 1), (1, -1, 1), (1, 1, 21)])
def test_split_counts_reject_empty_negative_and_oversized_papers(choice, experiment, calculation):
    with pytest.raises(TeacherServiceError):
        PersonalizedHomeworkService.make_settings([], choice, 2, experiment, calculation)


def test_legacy_area_counts_remain_compatible():
    assert PersonalizedHomeworkService.make_settings([{"kp_id": "kp"}], 3, 2) == {
        "scope": [{"kp_id": "kp"}], "choice_count": 3, "area_count": 2,
    }


@pytest.mark.asyncio
async def test_typed_settings_are_used_for_selected_students_reused_classes_and_redrafting(db_session):
    await setup_scope(db_session)
    await add_question(db_session, "m_x1", "experiment")
    await add_question(db_session, "f_x1", "experiment", kp="kp_fall")
    async with client_for(build_app(db_session)) as client:
        token, class_3, class_5 = await two_classes(db_session, client)
        members = (await client.get(f"/api/teacher/classes/{class_3}", headers=bearer(token))).json()["members"]
        alice = next(member["id"] for member in members if member["display_name"] == "Alice")
        payload = {"title": "分题型补练", "scope": [{"volume": "必修一", "chapter": "匀变速直线运动"}],
                   "choice_count": 1, "experiment_count": 1, "calculation_count": 1, "class_ids": [class_3],
                   "student_ids_by_class": {class_3: [alice]}}
        created = await client.post("/api/teacher/personalized", headers=bearer(token), json=payload)
        assert created.status_code == 201, created.text
        source_id = created.json()["paper"]["id"]
        assigned_id = created.json()["assigned"][0]["id"]

        async def check_paper(assignment_id, expected_names):
            response = await client.get(f"/api/teacher/assignments/{assignment_id}", headers=bearer(token))
            assert response.status_code == 200, response.text
            detail = response.json()
            assert detail["question_count"] == 3
            assert detail["settings"]["experiment_count"] == detail["settings"]["calculation_count"] == 1
            assert detail["settings"]["area_count"] == 2
            assert {paper["display_name"] for paper in detail["papers"]} == expected_names
            for paper in detail["papers"]:
                assert [item["question"]["question_type"] for item in paper["items"]] == ["single_choice", "experiment", "problem_solving"]
                assert all(item["reason"] for item in paper["items"])

        await check_paper(assigned_id, {"Alice"})
        redrafted = await client.post(f"/api/teacher/assignments/{assigned_id}/papers/{alice}/redraft", headers=bearer(token))
        assert redrafted.status_code == 200, redrafted.text
        await check_paper(assigned_id, {"Alice"})

        copied = await client.post(f"/api/teacher/assignments/{source_id}/copy", headers=bearer(token))
        assert copied.status_code == 201, copied.text
        reused = await client.post(f"/api/teacher/assignments/{copied.json()['id']}/assign", headers=bearer(token),
                                   json={"class_ids": [class_5]})
        assert reused.status_code == 200, reused.text
        await check_paper(reused.json()["assigned"][0]["id"], {"Carol"})

        _, other_token = await ready_teacher(client, "li_counts", "李老师")
        assert (await client.get(f"/api/teacher/assignments/{assigned_id}", headers=bearer(other_token))).status_code == 404
        denied = await client.post("/api/teacher/personalized", headers=bearer(other_token), json=payload)
        assert denied.status_code == 404
        empty = await client.post("/api/teacher/personalized", headers=bearer(token), json={
            **payload, "choice_count": 0, "experiment_count": 0, "calculation_count": 0,
        })
        assert empty.status_code == 400
