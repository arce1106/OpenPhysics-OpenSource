"""Browse the complete taxonomy; recommend only points with approved primary questions."""

import pytest

from app.models.knowledge import KnowledgePoint
from app.models.learning_catalog import LearningCatalog
from app.models.question import QualityStatus, Question, QuestionLabel
from app.services.knowledge_service import KnowledgeService
from app.services.learning_catalog_service import LearningCatalogService
from app.services.student_learning_state_service import StudentLearningStateService


def kp_label(kp_id: str, role: str) -> QuestionLabel:
    return QuestionLabel(label_type="knowledge_point", label_id=kp_id, role=role)


async def seed(db):
    db.add_all([
        KnowledgePoint(id=kp, name=name, volume="必修 第一册", chapter="第一章", section="1.1")
        for kp, name in [
            ("kp-primary", "有主标签题"), ("kp-secondary-only", "只做辅助标签"),
            ("kp-retired-only", "只有撤下的题"), ("kp-empty", "没有题"),
        ]
    ])
    db.add_all([
        Question(id="q-ok", stem_text="ok", quality_status=QualityStatus.approved,
                 labels=[kp_label("kp-primary", "主要"), kp_label("kp-secondary-only", "次要")]),
        Question(id="q-en", stem_text="en", quality_status=QualityStatus.approved,
                 labels=[kp_label("kp-primary", "Primary ")]),
        Question(id="q-retired", stem_text="retired", quality_status=QualityStatus.retired,
                 labels=[kp_label("kp-retired-only", "主要")]),
    ])
    db.add(LearningCatalog(id="cat-sync", code="sync", name="同步学习",
                           config={"source_mode": "knowledge_point_taxonomy"}))
    await db.commit()


def catalog_kp_ids(catalog: dict) -> list[str]:
    ids = []

    def walk(nodes):
        for node in nodes:
            if node["node_type"] == "knowledge_point":
                ids.append(node["code"])
            walk(node["children"])

    walk(catalog["nodes"])
    return ids


@pytest.mark.asyncio
async def test_only_kps_with_approved_primary_questions_are_practicable(db_session):
    await seed(db_session)
    svc = KnowledgeService(db_session)
    assert [kp.id for kp in await svc.get_practicable_points()] == ["kp-primary"]
    assert await svc.get_practicable_point_ids() == {"kp-primary"}
    # The taxonomy itself is untouched.
    assert len(await svc.get_all_points()) == 4


@pytest.mark.asyncio
async def test_practice_context_filters_empty_points_while_the_taxonomy_stays_complete(db_session):
    await seed(db_session)
    catalog_svc = LearningCatalogService(db_session)
    student = await catalog_svc.get_catalog("sync", practicable_only=True)
    admin = await catalog_svc.get_catalog("sync", include_mappings=True, include_disabled=True)
    assert catalog_kp_ids(student) == ["kp-primary"]
    assert sorted(catalog_kp_ids(admin)) == ["kp-empty", "kp-primary", "kp-retired-only", "kp-secondary-only"]

    context = await StudentLearningStateService(db_session).build_context("student-hidden")
    assert [state["kp_id"] for state in context["states"]] == ["kp-primary"]


@pytest.mark.asyncio
async def test_student_directory_includes_empty_points_without_recommending_them(db_session):
    from app.api.student.directory import get_directory
    from app.api.student.learning_catalogs import get_learning_catalog

    await seed(db_session)
    svc = StudentLearningStateService(db_session)
    result = await get_directory(student_id="directory-demo", state_svc=svc, include_pending=True)
    catalog = await get_learning_catalog("sync", _student_id="directory-demo", catalog_svc=LearningCatalogService(db_session))
    assert len(catalog_kp_ids(catalog)) == 4
    assert result.stats.total == 4
    assert result.stats.pending_content == 3
    points = {p.id: p for p in result.kps}
    assert points["kp-primary"].content_available and points["kp-primary"].practice_available
    for kp_id in ["kp-empty", "kp-secondary-only", "kp-retired-only"]:
        assert points[kp_id].learning_state == "pending_content"
        assert points[kp_id].learning_state_label == "内容待补充"
        assert not points[kp_id].content_available and not points[kp_id].practice_available
    practice = await get_directory(student_id="directory-demo", state_svc=svc, include_pending=False)
    assert [kp.id for kp in practice.kps] == ["kp-primary"]
    assert practice.stats.pending_content == 0


@pytest.mark.asyncio
async def test_card_only_point_can_be_read_but_has_no_practice(db_session):
    from app.models.learning import ContentSource, ContentType, LearningContent

    await seed(db_session)
    db_session.add(LearningContent(id="card-only", knowledge_point_id="kp-empty",
        content_type=ContentType.card, title="知识卡", body={"sections": []},
        source=ContentSource.ai_generated, version=1))
    await db_session.commit()
    svc = StudentLearningStateService(db_session)
    context = await svc.build_directory_context("card-reader")
    point = context["state_map"]["kp-empty"]
    assert point["content_available"] is True
    assert point["practice_available"] is False
    assert point["learning_state"] == "to_learn"
    # Browsing metadata does not add card-only or empty points to the practice path.
    assert [p["kp_id"] for p in (await svc.build_context("card-reader"))["states"]] == ["kp-primary"]


@pytest.mark.asyncio
async def test_directory_keeps_numeric_textbook_chapter_order(db_session):
    db_session.add_all([KnowledgePoint(id=f"v3c{chapter}s1k01", name="目录条目", chapter=f"第{chapter}章")
                        for chapter in [10, 9, 11]])
    await db_session.commit()
    assert [kp.id for kp in await KnowledgeService(db_session).get_all_points()] == [
        "v3c9s1k01", "v3c10s1k01", "v3c11s1k01"]
