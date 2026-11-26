import pytest
from app.services.knowledge_service import KnowledgeService, canonical_kp_name
from app.models.knowledge import RelationType


def test_canonical_kp_name_returns_chinese_for_core_motion_ids():
    assert canonical_kp_name("v1c1s3k02") == "平均速度与瞬时速度"
    assert canonical_kp_name("v1c1s2k01") == "时刻与时间间隔"
    assert canonical_kp_name("v1c2s3k02") == "速度与位移的关系"
    assert canonical_kp_name("v1c2s2k01") == "速度与时间的关系"
    assert canonical_kp_name("v1c1s1k02") == "参考系"
    assert canonical_kp_name("unknown") == "unknown"


def test_canonical_kp_name_prefers_seed_chinese_over_id_or_english_name():
    assert canonical_kp_name("v1c1s1k01", "v1c1s1k01") == "质点模型"
    assert canonical_kp_name("v1c2s4k01", "free fall") == "自由落体运动"


@pytest.mark.asyncio
async def test_create_and_get_point(db_session):
    svc = KnowledgeService(db_session)
    kp = await svc.create_point({
        "id": "test_c1s1k01", "name": "测试知识点", "chapter": "力学", "description": "测试"
    })
    assert kp.id == "test_c1s1k01"
    assert kp.name == "测试知识点"

    found = await svc.get_point("test_c1s1k01")
    assert found is not None
    assert found.name == "测试知识点"


@pytest.mark.asyncio
async def test_get_points_by_volume_filters_candidates(db_session):
    svc = KnowledgeService(db_session)
    await svc.create_point({
        "id": "x2_test_k01",
        "name": "选必二知识点",
        "volume": "选择性必修 第二册",
    })
    await svc.create_point({
        "id": "v2_test_k01",
        "name": "必修二知识点",
        "volume": "必修 第二册",
    })

    points = await svc.get_points_by_volume("选择性必修 第二册")

    assert [point.id for point in points] == ["x2_test_k01"]


@pytest.mark.asyncio
async def test_create_relation(db_session):
    svc = KnowledgeService(db_session)
    await svc.create_point({"id": "test_c1s1k02", "name": "A"})
    await svc.create_point({"id": "test_c1s1k03", "name": "B"})

    rel = await svc.create_relation("test_c1s1k02", "test_c1s1k03", RelationType.prerequisite_of, "A is needed before B")
    assert rel.source_id == "test_c1s1k02"
    assert rel.target_id == "test_c1s1k03"

    relations = await svc.get_relations("test_c1s1k03")
    assert len(relations) == 1


@pytest.mark.asyncio
async def test_prerequisite_graph(db_session):
    svc = KnowledgeService(db_session)
    await svc.create_point({"id": "v1c3s1k01", "name": "力"})
    await svc.create_point({"id": "v1c3s2k02", "name": "摩擦力"})
    await svc.create_point({"id": "v1c4s5k02", "name": "斜面"})
    await svc.create_relation("v1c3s1k01", "v1c3s2k02", RelationType.prerequisite_of)
    await svc.create_relation("v1c3s2k02", "v1c4s5k02", RelationType.prerequisite_of)

    graph = await svc.get_prerequisite_graph()
    assert "v1c4s5k02" in graph
    assert "v1c3s2k02" in graph["v1c4s5k02"]
