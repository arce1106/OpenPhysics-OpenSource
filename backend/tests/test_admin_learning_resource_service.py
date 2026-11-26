import pytest

from app.models.learning import ContentSource, ContentType, LearningContent, LearningVideoCuration
from app.services.admin_learning_resource_service import AdminLearningResourceService
from app.services.knowledge_service import KnowledgeService
from app.services.question_service import QuestionService


@pytest.mark.asyncio
async def test_learning_resource_report_summarizes_resources_by_scope(db_session):
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({
        "id": "x2c2s1k01",
        "name": "楞次定律",
        "volume": "选择性必修第二册",
        "chapter": "第二章 电磁感应",
        "section": "1 楞次定律",
    })
    await kp_svc.create_point({
        "id": "x2c1s3k05",
        "name": "带电粒子在有界磁场中的运动",
        "volume": "选择性必修第二册",
        "chapter": "第一章 安培力与洛伦兹力",
        "section": "3 带电粒子在匀强磁场中的运动",
    })

    db_session.add(LearningContent(
        id="learn-x2c2-card-v1",
        knowledge_point_id="x2c2s1k01",
        content_type=ContentType.card,
        title="楞次定律知识卡片",
        body={"summary": "感应电流的效果总要阻碍引起感应电流的磁通量变化。"},
        source=ContentSource.curated,
        version=1,
    ))
    await db_session.commit()

    q_svc = QuestionService(db_session)
    await q_svc.create_question({
        "id": "q_learning_resource_1",
        "stem_text": "楞次定律测试题",
        "answer": "A",
        "explanation": "解析",
        "question_type": "single_choice",
        "difficulty": 1.0,
        "difficulty_tier": "easy",
        "source": "curated",
        "quality_status": "approved",
        "labels": [
            {"label_type": "knowledge_point", "label_id": "x2c2s1k01", "role": "主要", "confidence": 1.0, "source": "test"},
            {"label_type": "question_type", "label_id": "single_choice", "role": "主要", "confidence": 1.0, "source": "test"},
        ],
    })

    report = await AdminLearningResourceService(db_session).build_report(
        volume="选择性必修第二册",
        chapter="第二章 电磁感应",
    )

    assert report["summary"]["kp_count"] == 1
    assert report["summary"]["card_count"] == 1
    assert report["summary"]["simulation_count"] == 1
    assert report["summary"]["missing_video_count"] == 1
    item = report["items"][0]
    assert item["kp_id"] == "x2c2s1k01"
    assert item["contents"]["card"]["title"] == "楞次定律知识卡片"
    assert item["question_count"] == 1
    assert item["simulations"]["local_demos"][0]["demo_id"] == "electromagnetic-induction"


@pytest.mark.asyncio
async def test_learning_resource_report_detects_backend_simulation(db_session):
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({
        "id": "x2c1s3k05",
        "name": "带电粒子在有界磁场中的运动",
        "volume": "选择性必修第二册",
        "chapter": "第一章 安培力与洛伦兹力",
        "section": "3 带电粒子在匀强磁场中的运动",
    })

    report = await AdminLearningResourceService(db_session).build_report(kp_id="x2c1s3k05")

    assert report["summary"]["kp_count"] == 1
    assert report["summary"]["simulation_count"] == 1
    item = report["items"][0]
    assert item["simulations"]["has_simulation"] is True
    assert item["simulations"]["backend_simulations"][0]["demo_id"] == "bounded_magnetic_field"


@pytest.mark.asyncio
async def test_learning_resource_report_counts_database_video_curations(db_session):
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({
        "id": "x2c2s1k01",
        "name": "楞次定律",
        "volume": "选择性必修 第二册",
        "chapter": "第二章 电磁感应",
        "section": "1 楞次定律",
    })
    db_session.add(LearningVideoCuration(
        knowledge_point_id="x2c2s1k01",
        video_type="lecture",
        title="楞次定律教师精选",
        url="https://www.bilibili.com/video/BVTESTLENZ/",
        uploader="北大学长跳跳",
        reason="教师指定主讲解。",
        priority=1,
        enabled=True,
    ))
    await db_session.commit()

    report = await AdminLearningResourceService(db_session).build_report(kp_id="x2c2s1k01")

    assert report["summary"]["video_count"] == 1
    assert report["summary"]["missing_video_count"] == 0
    assert report["items"][0]["video"]["curated_count"] == 1
    assert report["items"][0]["video"]["top_title"] == "楞次定律教师精选"
