"""Regression coverage for cross-topic review recommendations (motion vs flux)."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.api.student import journey
from app.models.question import DifficultyTier, QuestionType
from app.services.adaptive_service import AdaptiveService


def label(kind, value, role="主要"):
    return SimpleNamespace(label_type=kind, label_id=value, role=role)


def question(qid, *, kp="v1c2s2k01", model="graph_motion"):
    return SimpleNamespace(
        id=qid,
        stem_text="运动图像题" if model == "graph_motion" else "候选题",
        answer="A",
        explanation="测试解析",
        question_type=QuestionType.single_choice,
        difficulty=2.8,
        difficulty_tier=DifficultyTier.medium,
        labels=[
            *([label("knowledge_point", kp)] if kp else []),
            *([label("physics_model", model)] if model else []),
            label("question_structure", "graphical_analysis"),
        ],
        options=[],
        images=[],
    )


@pytest.fixture
def motion_original():
    # Synthetic motion-graph example: no dependency on the private question bank.
    return question("synthetic_motion_original", kp="v1c2s2k01", model="graph_motion")


def service(original, *, structure=(), by_kp=None, by_model=None, answered=()):
    """Mock storage only; run the real selector, scoring and serialization."""
    svc = object.__new__(AdaptiveService)
    svc.student_svc = SimpleNamespace(
        get_answer_history=AsyncMock(return_value=[
            SimpleNamespace(id=1, question_id=original.id, grading_result={}),
            *(SimpleNamespace(id=i + 2, question_id=qid) for i, qid in enumerate(answered)),
        ]),
    )
    svc.question_svc = SimpleNamespace(
        get_question=AsyncMock(return_value=original),
        get_questions_by_knowledge_point=AsyncMock(
            side_effect=lambda kp_id, **kwargs: (by_kp or {}).get(kp_id, []),
        ),
        get_questions_by_label=AsyncMock(
            side_effect=lambda kind, value, **kwargs: (
                list(structure) if kind == "question_structure"
                else (by_model or {}).get(value, [])
            ),
        ),
    )
    return svc


def flux_question():
    flux = question("synthetic_flux", kp="magnetic_flux_kp", model="electromagnetic_induction")
    flux.stem_text = "如图，判断磁通量随时间变化的图像。"
    return flux


@pytest.mark.asyncio
async def test_motion_graph_never_falls_back_to_magnetic_flux(motion_original):
    svc = service(motion_original, structure=[flux_question()])

    assert await svc.get_variation_questions("student", 1, limit=3) == []
    # Android and web also call this legacy endpoint when variations are empty.
    assert await svc.get_similar_question("student", 1) is None


@pytest.mark.asyncio
@pytest.mark.parametrize("kp,model", [
    ("v1c2s2k01", None),
    ("other_motion_kp", "graph_motion"),
])
async def test_structure_fallback_still_accepts_same_content(motion_original, kp, model):
    valid = question("valid_motion", kp=kp, model=model)
    svc = service(motion_original, structure=[flux_question(), valid])

    result = await svc.get_variation_questions("student", 1, limit=1)

    assert result[0]["question"]["id"] == valid.id
    assert result[0]["variation_type"] == "structure"


@pytest.mark.asyncio
async def test_structure_fallback_recognizes_model_aliases_and_nonfirst_labels():
    original = question("original", kp="motion_kp", model="acceleration")
    valid = question("valid", kp="other_kp", model="velocity_acceleration")
    valid.labels.insert(0, label("physics_model", "other_model", "辅助"))
    svc = service(original, structure=[valid])

    result = await svc.get_variation_questions("student", 1, limit=1)

    assert result[0]["question"]["id"] == valid.id


@pytest.mark.asyncio
async def test_missing_content_labels_cannot_match_each_other_by_absence():
    original = question("original", kp=None, model=None)
    candidate = question("candidate", kp=None, model=None)

    assert await service(original, structure=[candidate]).get_variation_questions("student", 1) == []


@pytest.mark.asyncio
async def test_content_filter_precedes_unseen_preference(motion_original):
    valid = question("previously_answered_motion")
    svc = service(motion_original, structure=[flux_question(), valid], answered=[valid.id])

    result = await svc.get_variation_questions("student", 1, limit=1)

    assert result[0]["question"]["id"] == valid.id
    assert await svc.get_variation_questions(
        "student", 1, limit=1, exclude_question_ids={valid.id},
    ) == []


@pytest.mark.asyncio
async def test_structure_fallback_accepts_target_kp_in_secondary_candidate_label(motion_original):
    valid = question("valid", kp="another_kp", model=None)
    valid.labels.append(label("knowledge_point", "v1c2s2k01", "辅助"))

    result = await service(motion_original, structure=[valid]).get_variation_questions("student", 1)

    assert result[0]["question"]["id"] == valid.id


@pytest.mark.asyncio
async def test_review_uses_primary_kp_even_when_auxiliary_label_is_first():
    original = question("original", kp="primary_kp", model=None)
    original.labels.insert(0, label("knowledge_point", "auxiliary_kp", "辅助"))
    primary = question("primary", kp="primary_kp", model=None)
    auxiliary = question("auxiliary", kp="auxiliary_kp", model=None)
    svc = service(original, by_kp={"primary_kp": [primary], "auxiliary_kp": [auxiliary]})

    result = await svc.get_variation_questions("student", 1, limit=1)

    assert result[0]["question"]["id"] == primary.id


@pytest.mark.asyncio
async def test_legacy_retry_fallback_also_uses_primary_kp():
    original = question("original", kp="primary_kp", model=None)
    original.labels.insert(0, label("knowledge_point", "auxiliary_kp", "辅助"))
    primary = question("primary", kp="primary_kp", model=None)
    auxiliary = question("auxiliary", kp="auxiliary_kp", model=None)
    svc = service(original, by_kp={"primary_kp": [primary], "auxiliary_kp": [auxiliary]})
    svc.get_variation_questions = AsyncMock(return_value=[])

    result = await svc.get_similar_question("student", 1)

    assert result["id"] == primary.id


@pytest.mark.asyncio
async def test_same_model_keeps_experiment_surface_instead_of_long_calculation():
    original = question("original", kp="free_fall_kp", model="velocity_acceleration")
    original.question_type = QuestionType.experiment
    original.labels[-1].label_id = "experiment"
    long_response = question("long", kp="free_fall_kp", model="velocity_acceleration")
    long_response.question_type = QuestionType.problem_solving
    long_response.labels[-1].label_id = "multi_step"
    experiment = question("experiment", kp="timer_kp", model="velocity_acceleration")
    experiment.question_type = QuestionType.experiment
    experiment.labels[-1].label_id = "experiment"
    svc = service(
        original, by_kp={"free_fall_kp": [long_response]},
        by_model={"velocity_acceleration": [long_response, experiment]},
    )

    result = await svc.get_variation_questions("student", 1, limit=1)

    assert result[0]["question"]["id"] == experiment.id
    assert result[0]["variation_type"] == "same_model"


@pytest.mark.asyncio
async def test_related_motion_model_transfer_is_preserved(motion_original):
    related = question("uniform_motion", kp="other_motion_kp", model="uniform_acceleration")
    svc = service(motion_original, by_model={"uniform_acceleration": [related]})

    result = await svc.get_variation_questions("student", 1, limit=1)

    assert result[0]["question"]["id"] == related.id
    assert result[0]["variation_type"] == "transfer"


@pytest.mark.asyncio
@pytest.mark.parametrize("endpoint", ["variations", "retry"])
async def test_review_endpoints_return_empty_when_only_unrelated_structure_remains(
    monkeypatch, motion_original, endpoint,
):
    monkeypatch.setattr(journey, "ensure_student_can_access_question", AsyncMock())
    svc = service(motion_original, structure=[flux_question()])
    student_svc = SimpleNamespace(
        get_answer=AsyncMock(return_value=SimpleNamespace(question_id=motion_original.id)),
    )
    handler = journey.get_review_variations if endpoint == "variations" else journey.retry_similar

    result = await handler(
        answer_id=1, student_id="student", adaptive_svc=svc, student_svc=student_svc,
        include_rendered=False, x_openphysics_include_rendered=None,
    )

    if endpoint == "variations":
        assert result.variations == []
    else:
        assert result.question is None
