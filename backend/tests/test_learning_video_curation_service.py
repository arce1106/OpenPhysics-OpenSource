import pytest

from app.models.knowledge import KnowledgePoint
from app.models.learning import LearningVideoCuration
from app.services.learning_video_curation_service import LearningVideoCurationService


@pytest.mark.asyncio
async def test_student_recommendation_uses_database_curated_lecture_before_search(db_session):
    db_session.add(KnowledgePoint(
        id="x2c2s1k01",
        name="楞次定律",
        volume="选择性必修 第二册",
        chapter="第二章 电磁感应",
        section="1 楞次定律",
    ))
    db_session.add(LearningVideoCuration(
        knowledge_point_id="x2c2s1k01",
        video_type="lecture",
        title="楞次定律精选讲解",
        url="https://www.bilibili.com/video/BVTESTLENZ/",
        uploader="北大学长跳跳",
        reason="教师指定给本知识点的主讲解。",
        priority=1,
        enabled=True,
    ))
    await db_session.commit()

    bundle = await LearningVideoCurationService(db_session).recommendation_maps("x2c2s1k01")

    assert bundle["lecture"]["x2c2s1k01"][0]["source"] == "teacher_curated_db"
    assert bundle["lecture"]["x2c2s1k01"][0]["title"] == "楞次定律精选讲解"
    assert bundle["lecture"]["x2c2s1k01"][0]["url"] == "https://www.bilibili.com/video/BVTESTLENZ/"


@pytest.mark.asyncio
async def test_disabled_database_curations_do_not_override_search_fallback(db_session):
    db_session.add(KnowledgePoint(
        id="x2c2s2k01",
        name="法拉第电磁感应定律",
        volume="选择性必修 第二册",
        chapter="第二章 电磁感应",
        section="2 法拉第电磁感应定律",
    ))
    db_session.add(LearningVideoCuration(
        knowledge_point_id="x2c2s2k01",
        video_type="lecture",
        title="已停用的视频",
        url="https://www.bilibili.com/video/BVDISABLED/",
        uploader="旧资源",
        reason="不再推荐。",
        priority=1,
        enabled=False,
    ))
    await db_session.commit()

    bundle = await LearningVideoCurationService(db_session).recommendation_maps("x2c2s2k01")

    assert bundle["lecture"] == {}
    assert bundle["experiment"] == {}
