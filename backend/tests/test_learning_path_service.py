import pytest
from app.services.learning_path_service import LearningPathService
from app.services.knowledge_service import KnowledgeService
from app.services.student_service import StudentService
from app.models.knowledge import RelationType
from app.models.student import StudentMastery
from tests.practicable import seed_practicable


@pytest.mark.asyncio
async def test_generate_path_with_prerequisites(db_session):
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({"id": "v1c3s1k01", "name": "力"})
    await kp_svc.create_point({"id": "v1c3s2k02", "name": "摩擦力"})
    await kp_svc.create_relation("v1c3s1k01", "v1c3s2k02", RelationType.prerequisite_of)
    await seed_practicable(db_session, "v1c3s1k01", "v1c3s2k02")

    svc = LearningPathService(db_session)
    path = await svc.generate_path("student_1")

    assert path["stats"]["total"] == 2
    force = next(s for s in path["stages"] if s["kp_id"] == "v1c3s1k01")
    assert force["status"] != "locked"
    friction = next(s for s in path["stages"] if s["kp_id"] == "v1c3s2k02")
    assert friction["status"] == "locked"


@pytest.mark.asyncio
async def test_path_with_mastered_prerequisite(db_session):
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({"id": "v1c3s1k01", "name": "力"})
    await kp_svc.create_point({"id": "v1c3s2k02", "name": "摩擦力"})
    await kp_svc.create_relation("v1c3s1k01", "v1c3s2k02", RelationType.prerequisite_of)
    await seed_practicable(db_session, "v1c3s1k01", "v1c3s2k02")

    # Mark force concept as mastered
    student_svc = StudentService(db_session)
    m = await student_svc.update_mastery("student_1", "v1c3s1k01", True)
    m.mastery = 0.85
    await db_session.commit()

    svc = LearningPathService(db_session)
    path = await svc.generate_path("student_1")

    friction = next(s for s in path["stages"] if s["kp_id"] == "v1c3s2k02")
    assert friction["status"] != "locked"  # Should be unlocked now
    assert friction["blocked_by"] == []


@pytest.mark.asyncio
async def test_path_does_not_mark_near_mastery_as_mastered(db_session):
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({"id": "v1c1s1k01", "name": "质点"})
    await seed_practicable(db_session, "v1c1s1k01")
    db_session.add(StudentMastery(
        student_id="student_near",
        knowledge_point_id="v1c1s1k01",
        mastery=0.75,
        attempts=3,
        correct_rate=0.67,
    ))
    await db_session.commit()

    svc = LearningPathService(db_session)
    path = await svc.generate_path("student_near")

    point = next(s for s in path["stages"] if s["kp_id"] == "v1c1s1k01")
    assert point["status"] == "current"
    assert path["stats"]["mastered"] == 0


@pytest.mark.asyncio
async def test_reinforcement_recommendations_include_attempted_near_mastery_kps(db_session):
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({"id": "v1c1s1k02", "name": "参考系"})
    await seed_practicable(db_session, "v1c1s1k02")
    db_session.add(StudentMastery(
        student_id="student_near",
        knowledge_point_id="v1c1s1k02",
        mastery=0.75,
        attempts=3,
        correct_rate=0.67,
    ))
    await db_session.commit()

    svc = LearningPathService(db_session)
    recommendations = await svc.get_reinforcement_recommendations("student_near")

    assert [item["kp_id"] for item in recommendations] == ["v1c1s1k02"]
    assert recommendations[0]["reason"] == "接近掌握，建议继续巩固到稳定"


@pytest.mark.asyncio
async def test_next_step_recommendation(db_session):
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({"id": "v1c3s1k01", "name": "力"})
    await seed_practicable(db_session, "v1c3s1k01")

    svc = LearningPathService(db_session)
    next_step = await svc.get_next_step("student_new")

    assert next_step is not None
    assert next_step["kp_id"] == "v1c3s1k01"
    assert next_step["status"] == "needs_learning"
    assert len(next_step["suggestions"]) > 0


@pytest.mark.asyncio
async def test_reinforcement_recommendations_exclude_untouched_zero_mastery_kps(db_session):
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({"id": "v2c5s1k02", "name": "曲线运动的条件"})
    await seed_practicable(db_session, "v2c5s1k02")

    svc = LearningPathService(db_session)
    recommendations = await svc.get_reinforcement_recommendations("student_new")

    assert recommendations == []


@pytest.mark.asyncio
async def test_reinforcement_recommendations_include_attempted_weak_kps(db_session):
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({"id": "v1c2s2k01", "name": "速度与时间的关系"})
    await seed_practicable(db_session, "v1c2s2k01")
    db_session.add(StudentMastery(
        student_id="student_weak",
        knowledge_point_id="v1c2s2k01",
        mastery=0.25,
        attempts=2,
        correct_rate=0.0,
    ))
    await db_session.commit()

    svc = LearningPathService(db_session)
    recommendations = await svc.get_reinforcement_recommendations("student_weak")

    assert [item["kp_id"] for item in recommendations] == ["v1c2s2k01"]
    assert recommendations[0]["reason"] == "近期练习暴露薄弱，建议先修复"
