import asyncio
from collections import Counter

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.knowledge import KnowledgePoint
from app.models.learning_catalog import (
    LearningCatalog,
    LearningCatalogNode,
    LearningCatalogNodeEvidence,
    LearningCatalogNodeKnowledgePoint,
    LearningCatalogNodeQuestionOverride,
)
from app.models.question import (
    DifficultyTier,
    QualityStatus,
    Question,
    QuestionLabel,
    QuestionSource,
    QuestionType,
)
from app.models.student import StudentAnswer, StudentMastery
from app.services.learning_catalog_service import LearningCatalogService
from app.services.seed_learning_catalogs import seed_learning_catalogs


@pytest.mark.asyncio
async def test_seed_builds_parallel_catalogs_and_gaokao_topic_tree(db_session):
    db_session.add_all(
        [
            KnowledgePoint(
                id="v1c1s1k01",
                name="质点",
                volume="必修 第一册",
                chapter="第一章 运动的描述",
                section="第一节 质点 参考系",
            ),
            KnowledgePoint(
                id="v1c3s1k01",
                name="力",
                volume="必修 第一册",
                chapter="第三章 相互作用",
                section="第一节 重力与弹力",
            ),
            KnowledgePoint(
                id="x3c5s1k01",
                name="质子和中子",
                volume="选择性必修 第三册",
                chapter="第五章 原子核",
                section="第一节 原子核的组成",
            ),
        ]
    )
    await db_session.commit()

    first = await seed_learning_catalogs(db_session)
    second = await seed_learning_catalogs(db_session)
    catalog_count = await db_session.scalar(
        select(func.count()).select_from(LearningCatalog)
    )
    node_count = await db_session.scalar(
        select(func.count()).select_from(LearningCatalogNode)
    )

    assert first["catalogs"] == 2
    assert first["nodes"] == 25
    assert second == {
        "catalogs": 0,
        "nodes": 0,
        "knowledge_point_mappings": 0,
        "label_rules": 0,
    }
    assert catalog_count == 2
    assert node_count == 25

    catalog = await LearningCatalogService(db_session).get_catalog(
        "gaokao_review",
        include_mappings=True,
    )

    assert catalog is not None
    assert catalog["topic_count"] == 19
    assert catalog["config"]["selection_mode"] == "topic_relative_gradient"
    assert catalog["config"]["type_mix_mode"] == "topic_adaptive_profiles"
    assert len(catalog["nodes"]) == 6
    assert catalog["nodes"][0]["title"] == "一、运动与相互作用"
    assert catalog["nodes"][0]["children"][0]["title"] == "运动描述、运动图像与追及相遇"
    assert catalog["nodes"][0]["children"][0]["knowledge_points"][0][
        "knowledge_point_id"
    ] == "v1c1s1k01"
    assert catalog["nodes"][0]["children"][0]["label_rules"][0] == {
        "id": 1,
        "label_type": "gaokao_topic",
        "label_id": "01",
        "action": "include",
        "weight": 1.0,
        "sort_order": 1,
    }

    sync_catalog = await LearningCatalogService(db_session).get_catalog(
        "sync_learning",
    )

    assert sync_catalog is not None
    assert sync_catalog["nodes"][0]["title"] == "必修 第一册"
    assert sync_catalog["nodes"][0]["children"][0]["title"] == "第一章 运动的描述"
    assert (
        sync_catalog["nodes"][0]["children"][0]["children"][0]["children"][0][
            "title"
        ]
        == "质点"
    )


@pytest.mark.asyncio
async def test_seed_serializes_concurrent_application_workers(db_session):
    db_session.add(KnowledgePoint(id="v1c1s1k01", name="质点"))
    await db_session.commit()
    session_factory = async_sessionmaker(
        db_session.bind,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    async def run_seed():
        async with session_factory() as worker_session:
            return await seed_learning_catalogs(worker_session)

    results = await asyncio.gather(run_seed(), run_seed())

    assert sorted(result["catalogs"] for result in results) == [0, 2]
    assert await db_session.scalar(
        select(func.count()).select_from(LearningCatalog)
    ) == 2
    assert await db_session.scalar(
        select(func.count()).select_from(LearningCatalogNode)
    ) == 25


@pytest.mark.asyncio
async def test_topic_resolution_combines_kps_direct_tags_and_manual_overrides(db_session):
    db_session.add(KnowledgePoint(id="v1c1s1k01", name="质点"))
    db_session.add_all(
        [
            Question(
                id="q-kp",
                stem_text="知识点映射题",
                quality_status=QualityStatus.approved,
                source=QuestionSource.human,
            ),
            Question(
                id="q-direct",
                stem_text="专题直标题",
                quality_status=QualityStatus.approved,
                source=QuestionSource.human,
            ),
            Question(
                id="q-manual",
                stem_text="人工纳入题",
                quality_status=QualityStatus.approved,
                source=QuestionSource.human,
            ),
            Question(
                id="q-draft",
                stem_text="未审核专题题",
                quality_status=QualityStatus.draft,
                source=QuestionSource.human,
            ),
        ]
    )
    db_session.add_all(
        [
            QuestionLabel(
                question_id="q-kp",
                label_type="knowledge_point",
                label_id="v1c1s1k01",
            ),
            QuestionLabel(
                question_id="q-direct",
                label_type="gaokao_topic",
                label_id="01",
            ),
            QuestionLabel(
                question_id="q-draft",
                label_type="gaokao_topic",
                label_id="01",
            ),
        ]
    )
    await db_session.commit()
    await seed_learning_catalogs(db_session)
    service = LearningCatalogService(db_session)

    assert await service.resolve_question_ids("gaokao_topic_01") == [
        "q-direct",
        "q-kp",
    ]

    db_session.add_all(
        [
            LearningCatalogNodeQuestionOverride(
                node_id="gaokao_topic_01",
                question_id="q-kp",
                action="exclude",
                note="不符合专题综合性",
            ),
            LearningCatalogNodeQuestionOverride(
                node_id="gaokao_topic_01",
                question_id="q-manual",
                action="include",
                priority=10,
                note="教师精选",
            ),
        ]
    )
    await db_session.commit()

    assert await service.resolve_question_ids("gaokao_topic_01") == [
        "q-direct",
        "q-manual",
    ]


@pytest.mark.asyncio
async def test_topic_overview_and_sessions_reuse_catalog_evidence(
    db_session,
):
    db_session.add_all(
        [
            KnowledgePoint(id="v1c1s1k01", name="质点"),
            KnowledgePoint(id="v1c1s1k02", name="参考系"),
        ]
    )
    db_session.add_all(
        [
            Question(
                id="q-foundation",
                stem_text="基础题",
                question_type=QuestionType.single_choice,
                difficulty_tier=DifficultyTier.easy,
                quality_status=QualityStatus.approved,
                source=QuestionSource.human,
            ),
            Question(
                id="q-breakthrough",
                stem_text="典型题",
                question_type=QuestionType.multiple_choice,
                difficulty_tier=DifficultyTier.medium,
                quality_status=QualityStatus.approved,
                source=QuestionSource.human,
            ),
            Question(
                id="q-transfer",
                stem_text="迁移题",
                question_type=QuestionType.problem_solving,
                difficulty_tier=DifficultyTier.hard,
                quality_status=QualityStatus.approved,
                source=QuestionSource.human,
            ),
        ]
    )
    db_session.add_all(
        [
            QuestionLabel(
                question_id=question_id,
                label_type="knowledge_point",
                label_id=kp_id,
            )
            for question_id, kp_id in (
                ("q-foundation", "v1c1s1k01"),
                ("q-breakthrough", "v1c1s1k02"),
                ("q-transfer", "v1c1s1k01"),
            )
        ]
    )
    await db_session.commit()
    await seed_learning_catalogs(db_session)
    service = LearningCatalogService(db_session)

    initial = await service.get_topic_overview(
        "student-topic",
        "gaokao_review",
        "gaokao_topic_01",
    )
    initial_resume = await service.get_resume_topic(
        "student-topic",
        "gaokao_review",
    )

    assert initial is not None
    assert initial_resume == {
        "catalog_code": "gaokao_review",
        "node_id": None,
        "last_practiced": None,
    }
    assert initial["status"] == "not_started"
    assert initial["recommended_layer"] == "diagnostic"
    assert initial["core_knowledge_point_count"] == 2

    db_session.add_all(
        [
            StudentMastery(
                student_id="student-topic",
                knowledge_point_id="v1c1s1k01",
                mastery=0.7,
                attempts=3,
            ),
            StudentMastery(
                student_id="student-topic",
                knowledge_point_id="v1c1s1k02",
                mastery=0.6,
                attempts=2,
            ),
        ]
    )
    await db_session.commit()

    isolated_overview = await service.get_topic_overview(
        "student-topic",
        "gaokao_review",
        "gaokao_topic_01",
    )
    assert isolated_overview is not None
    assert isolated_overview["status"] == "not_started"
    assert isolated_overview["attempted_knowledge_point_count"] == 0

    answer = StudentAnswer(
        student_id="student-topic",
        question_id="q-foundation",
        given_answer="A",
        is_correct=True,
        grading_result={
            "_mastery_update": {
                "v1c1s1k01": {
                    "before": 0.7,
                    "after": 0.8,
                    "name": "质点",
                }
            }
        },
    )
    db_session.add(answer)
    await db_session.commit()
    await db_session.refresh(answer)
    assert await service.record_topic_answer(
        "student-topic",
        "gaokao_review",
        "gaokao_topic_01",
        answer_id=answer.id,
        layer="diagnostic",
    )
    assert await service.record_topic_answer(
        "student-topic",
        "gaokao_review",
        "gaokao_topic_01",
        answer_id=answer.id,
        layer="diagnostic",
    )
    evidence_count = await db_session.scalar(
        select(func.count())
        .select_from(LearningCatalogNodeEvidence)
        .where(
            LearningCatalogNodeEvidence.student_id == "student-topic",
            LearningCatalogNodeEvidence.node_id == "gaokao_topic_01",
            LearningCatalogNodeEvidence.answer_id == answer.id,
        )
    )
    assert evidence_count == 1

    answer.is_correct = False
    answer.grading_result = {
        **answer.grading_result,
        "process_score": 100,
        "manual_correction": {
            "corrected_answer": "B",
            "is_correct": False,
            "reason": "人工纠正",
        },
    }
    await db_session.commit()
    assert await service.record_topic_answer(
        "student-topic",
        "gaokao_review",
        "gaokao_topic_01",
        answer_id=answer.id,
        layer="diagnostic",
    )
    corrected_evidence = await db_session.scalar(
        select(LearningCatalogNodeEvidence).where(
            LearningCatalogNodeEvidence.student_id == "student-topic",
            LearningCatalogNodeEvidence.node_id == "gaokao_topic_01",
            LearningCatalogNodeEvidence.answer_id == answer.id,
        )
    )
    assert corrected_evidence is not None
    assert corrected_evidence.score == 0.0

    overview = await service.get_topic_overview(
        "student-topic",
        "gaokao_review",
        "gaokao_topic_01",
    )
    resume = await service.get_resume_topic(
        "student-topic",
        "gaokao_review",
    )
    paper = await service.get_topic_questions(
        "student-topic",
        "gaokao_review",
        "gaokao_topic_01",
        layer="paper",
        count=10,
    )

    assert overview is not None
    assert overview["status"] == "needs_review"
    assert overview["recommended_layer"] == "foundation"
    assert overview["attempted_knowledge_point_count"] == 1
    assert overview["needs_review_knowledge_point_count"] == 1
    assert resume is not None
    assert resume["node_id"] == "gaokao_topic_01"
    assert resume["last_practiced"] is not None
    assert {question.id for question in paper or []} == {
        "q-foundation",
        "q-breakthrough",
        "q-transfer",
    }


@pytest.mark.asyncio
async def test_topic_layers_use_full_pool_and_relative_difficulty(db_session):
    db_session.add(KnowledgePoint(id="v1c1s1k01", name="质点"))
    definitions = [
        *(QuestionType.single_choice for _ in range(5)),
        *(QuestionType.multiple_choice for _ in range(3)),
        *(QuestionType.experiment for _ in range(2)),
        *(QuestionType.problem_solving for _ in range(3)),
    ]
    questions = [
        Question(
            id=f"q-relative-{index:02d}",
            stem_text=f"相对难度分层题 {index}",
            question_type=question_type,
            difficulty=index / 100,
            difficulty_tier=DifficultyTier.easy,
            quality_status=QualityStatus.approved,
            source=QuestionSource.human,
        )
        for index, question_type in enumerate(definitions, start=1)
    ]
    db_session.add_all(questions)
    db_session.add_all(
        [
            QuestionLabel(
                question_id=question.id,
                label_type="knowledge_point",
                label_id="v1c1s1k01",
            )
            for question in questions
        ]
    )
    await db_session.commit()
    await seed_learning_catalogs(db_session)

    service = LearningCatalogService(db_session)
    layers = {
        layer: await service.get_topic_questions(
            "student-relative",
            "gaokao_review",
            "gaokao_topic_01",
            layer=layer,
            count=10,
        )
        for layer in ("foundation", "breakthrough", "transfer")
    }

    assert all(layers.values())
    assert len(layers["foundation"] or []) == 5
    assert len(layers["breakthrough"] or []) == 4
    assert len(layers["transfer"] or []) == 4
    selected_ids = [
        {question.id for question in layers[layer] or []}
        for layer in ("foundation", "breakthrough", "transfer")
    ]
    assert len(set.union(*selected_ids)) == 13
    assert all(
        question.difficulty_tier == DifficultyTier.easy
        for question in questions
    )

    for question_type, layer_order in (
        (
            QuestionType.single_choice,
            ("foundation", "breakthrough", "transfer"),
        ),
        (
            QuestionType.multiple_choice,
            ("foundation", "breakthrough", "transfer"),
        ),
        (QuestionType.experiment, ("foundation", "breakthrough")),
        (QuestionType.problem_solving, ("breakthrough", "transfer")),
    ):
        difficulty_bands = [
            [
                question.difficulty
                for question in layers[layer] or []
                if question.question_type == question_type
            ]
            for layer in layer_order
        ]
        assert all(difficulty_bands)
        assert all(
            max(left) < min(right)
            for left, right in zip(difficulty_bands, difficulty_bands[1:])
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("node_id", "topic_code", "question_types", "expected_counts"),
    [
        (
            "gaokao_topic_05",
            "05",
            [
                *(QuestionType.single_choice for _ in range(5)),
                *(QuestionType.multiple_choice for _ in range(3)),
                *(QuestionType.problem_solving for _ in range(4)),
                QuestionType.comprehensive,
            ],
            {
                "foundation": (3, 1, 0, 1),
                "breakthrough": (1, 1, 0, 2),
                "transfer": (1, 1, 0, 2),
            },
        ),
        (
            "gaokao_topic_19",
            "19",
            [
                *(QuestionType.single_choice for _ in range(5)),
                *(QuestionType.multiple_choice for _ in range(3)),
                QuestionType.experiment,
                *(QuestionType.problem_solving for _ in range(4)),
            ],
            {
                "foundation": (3, 1, 0, 1),
                "breakthrough": (1, 1, 1, 1),
                "transfer": (1, 1, 0, 2),
            },
        ),
        (
            "gaokao_topic_14",
            "14",
            [
                *(QuestionType.single_choice for _ in range(3)),
                *(QuestionType.multiple_choice for _ in range(3)),
                *(QuestionType.experiment for _ in range(6)),
                QuestionType.problem_solving,
            ],
            {
                "foundation": (2, 1, 2, 0),
                "breakthrough": (1, 1, 2, 0),
                "transfer": (0, 1, 2, 1),
            },
        ),
    ],
)
async def test_topic_layers_adapt_type_mix_to_topic_profile(
    db_session,
    node_id,
    topic_code,
    question_types,
    expected_counts,
):
    await seed_learning_catalogs(db_session)
    questions = [
        Question(
            id=f"q-profile-{topic_code}-{index:02d}",
            stem_text=f"专题 {topic_code} 分层题 {index}",
            question_type=question_type,
            difficulty=index / 100,
            difficulty_tier=DifficultyTier.easy,
            quality_status=QualityStatus.approved,
            source=QuestionSource.human,
        )
        for index, question_type in enumerate(question_types, start=1)
    ]
    db_session.add_all(questions)
    db_session.add_all(
        [
            QuestionLabel(
                question_id=question.id,
                label_type="gaokao_topic",
                label_id=topic_code,
            )
            for question in questions
        ]
    )
    await db_session.commit()
    service = LearningCatalogService(db_session)

    selected_ids: list[set[str]] = []
    for layer in ("foundation", "breakthrough", "transfer"):
        selected = await service.get_topic_questions(
            f"student-profile-{topic_code}",
            "gaokao_review",
            node_id,
            layer=layer,
            count=10,
        )
        assert selected is not None
        assert len(selected) == sum(expected_counts[layer])
        counts = Counter(
            (
                "calculation"
                if question.question_type
                in {QuestionType.problem_solving, QuestionType.comprehensive}
                else question.question_type.value
            )
            for question in selected
        )
        assert (
            counts["single_choice"],
            counts["multiple_choice"],
            counts["experiment"],
            counts["calculation"],
        ) == expected_counts[layer]
        selected_ids.append({question.id for question in selected})

    assert len(set.union(*selected_ids)) == 13


@pytest.mark.asyncio
async def test_supporting_kps_do_not_expand_topic_question_pool(db_session):
    db_session.add_all(
        [
            KnowledgePoint(id="v1c1s1k01", name="辅助知识点"),
            KnowledgePoint(id="v1c4s5k01", name="力学综合核心知识点"),
        ]
    )
    db_session.add_all(
        [
            Question(
                id="q-supporting-only",
                stem_text="普通基础题",
                quality_status=QualityStatus.approved,
                source=QuestionSource.human,
            ),
            Question(
                id="q-topic-core",
                stem_text="力学综合题",
                quality_status=QualityStatus.approved,
                source=QuestionSource.human,
            ),
        ]
    )
    db_session.add_all(
        [
            QuestionLabel(
                question_id="q-supporting-only",
                label_type="knowledge_point",
                label_id="v1c1s1k01",
            ),
            QuestionLabel(
                question_id="q-topic-core",
                label_type="knowledge_point",
                label_id="v1c4s5k01",
            ),
            QuestionLabel(
                question_id="q-topic-core",
                label_type="knowledge_point",
                label_id="v1c1s1k01",
            ),
        ]
    )
    await db_session.commit()
    await seed_learning_catalogs(db_session)

    question_ids = await LearningCatalogService(db_session).resolve_question_ids(
        "gaokao_topic_08"
    )

    assert question_ids == ["q-topic-core"]

    answer = StudentAnswer(
        student_id="student-supporting",
        question_id="q-topic-core",
        given_answer="A",
        is_correct=True,
        grading_result={
            "_mastery_update": {
                "v1c1s1k01": {"before": 0.0, "after": 0.45},
                "v1c4s5k01": {"before": 0.0, "after": 0.45},
            }
        },
    )
    db_session.add(answer)
    await db_session.commit()
    await db_session.refresh(answer)

    assert await LearningCatalogService(db_session).record_topic_answer(
        "student-supporting",
        "gaokao_review",
        "gaokao_topic_08",
        answer_id=answer.id,
        layer="breakthrough",
    )
    evidence = await db_session.scalar(
        select(LearningCatalogNodeEvidence).where(
            LearningCatalogNodeEvidence.answer_id == answer.id
        )
    )
    assert evidence is not None
    assert evidence.knowledge_point_id == "v1c4s5k01"


@pytest.mark.asyncio
async def test_full_catalog_upgrade_keeps_legacy_rows_and_user_edits(db_session):
    db_session.add(LearningCatalog(
        id='catalog_gaokao_review', code='gaokao_review', name='高考复习示例',
        config={'source_mode': 'curated_topic_mapping', 'mastery_source': 'catalog_topic_evidence'},
    ))
    await db_session.flush()
    db_session.add(LearningCatalogNode(
        id='demo_motion', catalog_id='catalog_gaokao_review', code='demo_motion',
        node_type='topic', title='匀速直线运动示例', config={},
    ))
    db_session.add(LearningCatalogNode(
        id='custom-review', catalog_id='catalog_gaokao_review', code='custom-review',
        node_type='topic', title='部署者自建专题', config={'custom': True},
    ))
    await db_session.commit()
    await seed_learning_catalogs(db_session)
    await db_session.refresh(await db_session.get(LearningCatalogNode, 'demo_motion'))
    legacy = await db_session.get(LearningCatalogNode, 'demo_motion')
    assert legacy is not None and not legacy.enabled
    custom = await db_session.get(LearningCatalogNode, 'custom-review')
    assert custom.enabled and custom.title == '部署者自建专题'
    catalog = await LearningCatalogService(db_session).get_catalog('gaokao_review')
    blocks = [n for n in catalog['nodes'] if n['node_type'] == 'block']
    assert len(blocks) == 6
    assert sum(len(block['children']) for block in blocks) == 19
    assert (await db_session.get(LearningCatalog, 'catalog_gaokao_review')).name == '高考复习'
    # A renamed/customized catalog is no longer a default migration target.
    custom_catalog = await db_session.get(LearningCatalog, 'catalog_gaokao_review')
    custom_catalog.name = '部署者目录'
    custom_catalog.config = {'custom': True}
    await db_session.commit()
    await seed_learning_catalogs(db_session)
    await db_session.refresh(custom_catalog)
    assert custom_catalog.name == '部署者目录' and custom_catalog.config == {'custom': True}
