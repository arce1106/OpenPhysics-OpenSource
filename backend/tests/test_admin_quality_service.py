from types import SimpleNamespace

import pytest

from app.services.admin_quality_service import AdminQualityService
from app.services.admin_quality_service import audit_question_labels
from app.services.knowledge_service import KnowledgeService
from app.services.question_service import QuestionService


def make_question(labels, **overrides):
    data = {
        "id": "q1",
        "stem_text": "题干",
        "answer": "A",
        "explanation": "解析",
        "question_type": "single_choice",
        "difficulty_tier": "easy",
        "labels": [
            SimpleNamespace(label_type=label_type, label_id=label_id)
            for label_type, label_id in labels
        ],
    }
    data.update(overrides)
    return SimpleNamespace(**data)


def test_audit_question_labels_detects_missing_required_labels():
    q = make_question([
        ("knowledge_point", "kp1"),
        ("question_type", "single_choice"),
    ])

    audit = audit_question_labels(q)

    assert "physics_model" in audit["missing_labels"]
    assert "question_structure" in audit["missing_labels"]
    assert audit["completeness"] < 1


def test_audit_question_labels_accepts_complete_question():
    q = make_question([
        ("knowledge_point", "kp1"),
        ("question_type", "single_choice"),
        ("physics_model", "free_fall"),
        ("question_structure", "single_concept"),
        ("ability_dimension", "apply"),
        ("solution_strategy", "formula_application"),
    ])

    audit = audit_question_labels(q)

    assert audit["missing_labels"] == []
    assert audit["completeness"] == 1


@pytest.mark.asyncio
async def test_chapter_coverage_includes_empty_knowledge_point_details(db_session):
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({
        "id": "cov_c1_k1",
        "name": "已有题知识点",
        "volume": "测试分册",
        "chapter": "第一章 测试章",
        "section": "1.1 测试节",
    })
    await kp_svc.create_point({
        "id": "cov_c1_k2",
        "name": "空白知识点甲",
        "volume": "测试分册",
        "chapter": "第一章 测试章",
        "section": "1.2 测试节",
    })
    await kp_svc.create_point({
        "id": "cov_c1_k3",
        "name": "空白知识点乙",
        "volume": "测试分册",
        "chapter": "第一章 测试章",
        "section": "1.3 测试节",
    })

    q_svc = QuestionService(db_session)
    await q_svc.create_question({
        "id": "q_cov_1",
        "stem_text": "题干",
        "answer": "A",
        "explanation": "解析",
        "question_type": "single_choice",
        "difficulty": 1.0,
        "difficulty_tier": "easy",
        "source": "curated",
        "quality_status": "draft",
        "labels": [
            {"label_type": "knowledge_point", "label_id": "cov_c1_k1", "role": "主要", "confidence": 1.0, "source": "test"},
            {"label_type": "question_type", "label_id": "single_choice", "role": "主要", "confidence": 1.0, "source": "test"},
            {"label_type": "physics_model", "label_id": "test_model", "role": "主要", "confidence": 1.0, "source": "test"},
            {"label_type": "question_structure", "label_id": "single_concept", "role": "主要", "confidence": 1.0, "source": "test"},
            {"label_type": "ability_dimension", "label_id": "understand", "role": "主要", "confidence": 1.0, "source": "test"},
            {"label_type": "solution_strategy", "label_id": "concept_analysis", "role": "主要", "confidence": 1.0, "source": "test"},
        ],
    })

    report = await AdminQualityService(db_session).build_report()
    row = next(item for item in report["chapter_coverage"] if item["chapter"] == "第一章 测试章")

    assert row["empty_kp_count"] == 2
    assert row["empty_knowledge_points"] == [
        {
            "kp_id": "cov_c1_k2",
            "kp_name": "空白知识点甲",
            "section": "1.2 测试节",
        },
        {
            "kp_id": "cov_c1_k3",
            "kp_name": "空白知识点乙",
            "section": "1.3 测试节",
        },
    ]


@pytest.mark.asyncio
async def test_quality_report_can_scope_to_one_chapter(db_session):
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({
        "id": "scope_kp_a",
        "name": "范围内知识点",
        "volume": "测试分册",
        "chapter": "第一章 范围内",
        "section": "1.1 测试节",
    })
    await kp_svc.create_point({
        "id": "scope_kp_b",
        "name": "范围外知识点",
        "volume": "测试分册",
        "chapter": "第二章 范围外",
        "section": "2.1 测试节",
    })

    q_svc = QuestionService(db_session)
    for qid, kp_id in [("q_scope_a", "scope_kp_a"), ("q_scope_b", "scope_kp_b")]:
        await q_svc.create_question({
            "id": qid,
            "stem_text": "题干",
            "answer": "A",
            "explanation": "解析",
            "question_type": "single_choice",
            "difficulty": 1.0,
            "difficulty_tier": "easy",
            "source": "curated",
            "quality_status": "draft",
            "labels": [
                {"label_type": "knowledge_point", "label_id": kp_id, "role": "主要", "confidence": 1.0, "source": "test"},
                {"label_type": "question_type", "label_id": "single_choice", "role": "主要", "confidence": 1.0, "source": "test"},
                {"label_type": "physics_model", "label_id": "test_model", "role": "主要", "confidence": 1.0, "source": "test"},
                {"label_type": "question_structure", "label_id": "single_concept", "role": "主要", "confidence": 1.0, "source": "test"},
                {"label_type": "ability_dimension", "label_id": "understand", "role": "主要", "confidence": 1.0, "source": "test"},
                {"label_type": "solution_strategy", "label_id": "concept_analysis", "role": "主要", "confidence": 1.0, "source": "test"},
            ],
        })

    report = await AdminQualityService(db_session).build_report(
        volume="测试分册",
        chapter="第一章 范围内",
    )

    assert report["summary"]["question_count"] == 1
    assert [row["chapter"] for row in report["chapter_coverage"]] == ["第一章 范围内"]
    assert [row["kp_id"] for row in report["kp_coverage"]] == ["scope_kp_a"]


@pytest.mark.asyncio
async def test_model_coverage_reports_chapter_distribution(db_session):
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({
        "id": "model_ch_kp_a",
        "name": "模型章节甲",
        "volume": "测试分册",
        "chapter": "第一章 模型甲",
        "section": "1.1 测试节",
    })
    await kp_svc.create_point({
        "id": "model_ch_kp_b",
        "name": "模型章节乙",
        "volume": "测试分册",
        "chapter": "第二章 模型乙",
        "section": "2.1 测试节",
    })

    q_svc = QuestionService(db_session)
    for qid, kp_id, model_id, tier in [
        ("q_model_ch_a", "model_ch_kp_a", "free_fall", "easy"),
        ("q_model_ch_b", "model_ch_kp_b", "electric_field", "medium"),
    ]:
        await q_svc.create_question({
            "id": qid,
            "stem_text": "题干",
            "answer": "A",
            "explanation": "解析",
            "question_type": "single_choice",
            "difficulty": 1.0,
            "difficulty_tier": tier,
            "source": "curated",
            "quality_status": "draft",
            "labels": [
                {"label_type": "knowledge_point", "label_id": kp_id, "role": "主要", "confidence": 1.0, "source": "test"},
                {"label_type": "question_type", "label_id": "single_choice", "role": "主要", "confidence": 1.0, "source": "test"},
                {"label_type": "physics_model", "label_id": model_id, "role": "主要", "confidence": 1.0, "source": "test"},
                {"label_type": "question_structure", "label_id": "single_concept", "role": "主要", "confidence": 1.0, "source": "test"},
                {"label_type": "ability_dimension", "label_id": "understand", "role": "主要", "confidence": 1.0, "source": "test"},
                {"label_type": "solution_strategy", "label_id": "concept_analysis", "role": "主要", "confidence": 1.0, "source": "test"},
            ],
        })

    report = await AdminQualityService(db_session).build_report(volume="测试分册")
    free_fall = next(item for item in report["model_coverage"] if item["model_id"] == "free_fall")
    electric_field = next(item for item in report["model_coverage"] if item["model_id"] == "electric_field")

    assert free_fall["chapter_counts"] == [{
        "volume": "测试分册",
        "chapter": "第一章 模型甲",
        "question_count": 1,
        "tier_counts": {"easy": 1},
        "type_counts": {"single_choice": 1},
    }]
    assert electric_field["chapter_counts"] == [{
        "volume": "测试分册",
        "chapter": "第二章 模型乙",
        "question_count": 1,
        "tier_counts": {"medium": 1},
        "type_counts": {"single_choice": 1},
    }]


@pytest.mark.asyncio
async def test_label_coverage_counts_questions_not_labels(db_session):
    kp_svc = KnowledgeService(db_session)
    for kp_id in ("cov_kp_a", "cov_kp_b"):
        await kp_svc.create_point({
            "id": kp_id, "name": kp_id, "volume": "覆盖分册",
            "chapter": "第一章", "section": "1.1",
        })
    q_svc = QuestionService(db_session)
    await q_svc.create_question({
        "id": "q_cov_two_kps",
        "stem_text": "题干",
        "answer": "A",
        "explanation": "",
        "question_type": "single_choice",
        "difficulty_tier": "easy",
        "source": "curated",
        "quality_status": "draft",
        "labels": [
            {"label_type": "knowledge_point", "label_id": "cov_kp_a", "role": "主要", "confidence": 1.0, "source": "test"},
            {"label_type": "knowledge_point", "label_id": "cov_kp_b", "role": "辅助", "confidence": 1.0, "source": "test"},
        ],
    })

    report = await AdminQualityService(db_session).build_report(volume="覆盖分册")

    coverage = report["label_coverage"]["knowledge_point"]
    assert coverage == {"count": 1, "rate": 1.0, "label_count": 2}
    assert report["summary"]["issue_question_count"] == 1
