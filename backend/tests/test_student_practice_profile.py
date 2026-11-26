import pytest

from app.api.student.schemas import PracticeSessionResponse
from app.models.question import QualityStatus
from app.services.knowledge_service import KnowledgeService
from app.services.question_service import QuestionService
from app.services.student_practice_profile import StudentPracticeProfileService
from app.services.student_service import StudentService


def test_practice_session_response_allows_fractional_profile_counts():
    response = PracticeSessionResponse.model_validate({
        "student_id": "student_fractional_profile",
        "session_type": "practice",
        "strategy": "target_kp",
        "session_objective": "巩固小练",
        "session_structure": {"phases": [], "total": 0},
        "learner_profile": {
            "label_types": ["knowledge_point"],
            "focus_labels": [{
                "label_type": "knowledge_point",
                "label_id": "kp_partial",
                "attempts": 1,
                "wrong_count": 0.4,
                "correct_count": 0.6,
                "error_rate": 0.4,
                "weight": 0.45,
            }],
            "weak_labels": {
                "knowledge_point": [{
                    "label_type": "knowledge_point",
                    "label_id": "kp_partial",
                    "attempts": 1,
                    "wrong_count": 0.4,
                    "correct_count": 0.6,
                    "error_rate": 0.4,
                    "weight": 0.45,
                }],
            },
            "weak_label_weights": {"knowledge_point": {"kp_partial": 0.45}},
            "recent_answer_count": 1,
        },
        "questions": [],
    })

    assert response.learner_profile is not None
    assert response.learner_profile.focus_labels[0].wrong_count == 0.4
    assert response.learner_profile.focus_labels[0].correct_count == 0.6


@pytest.mark.asyncio
async def test_profile_finds_weak_labels_across_practice_dimensions(db_session):
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({"id": "profile_kp_motion", "name": "运动模型"})

    q_svc = QuestionService(db_session)
    await q_svc.create_question({
        "id": "q_profile_wrong",
        "stem_text": "带图像的多步骤运动题",
        "answer": "A",
        "explanation": "解析",
        "question_type": "single_choice",
        "difficulty_tier": "medium",
        "source": "human",
        "options": [],
        "labels": [
            {"label_type": "knowledge_point", "label_id": "profile_kp_motion", "role": "主要"},
            {"label_type": "physics_model", "label_id": "uniform_acceleration", "role": "主要"},
            {"label_type": "ability_dimension", "label_id": "analyze", "role": "主要"},
            {"label_type": "question_structure", "label_id": "multi_step", "role": "主要"},
            {"label_type": "solution_strategy", "label_id": "formula_application", "role": "主要"},
        ],
        "formulas": [],
        "images": [],
    })
    await q_svc.review_question("q_profile_wrong", QualityStatus.approved)

    await q_svc.create_question({
        "id": "q_profile_correct",
        "stem_text": "单概念理解题",
        "answer": "A",
        "explanation": "解析",
        "question_type": "single_choice",
        "difficulty_tier": "easy",
        "source": "human",
        "options": [],
        "labels": [
            {"label_type": "knowledge_point", "label_id": "profile_kp_motion", "role": "主要"},
            {"label_type": "physics_model", "label_id": "particle", "role": "主要"},
            {"label_type": "ability_dimension", "label_id": "understand", "role": "主要"},
            {"label_type": "question_structure", "label_id": "single_concept", "role": "主要"},
            {"label_type": "solution_strategy", "label_id": "concept_analysis", "role": "主要"},
        ],
        "formulas": [],
        "images": [],
    })
    await q_svc.review_question("q_profile_correct", QualityStatus.approved)

    student_svc = StudentService(db_session)
    await student_svc.record_answer("student_profile", "q_profile_wrong", "B", False, 30000)
    await student_svc.record_answer("student_profile", "q_profile_correct", "A", True, 20000)

    profile = await StudentPracticeProfileService(db_session).build_profile("student_profile")

    assert profile["weak_labels"]["physics_model"][0]["label_id"] == "uniform_acceleration"
    assert profile["weak_labels"]["ability_dimension"][0]["label_id"] == "analyze"
    assert profile["weak_labels"]["question_structure"][0]["label_id"] == "multi_step"
    assert profile["weak_labels"]["solution_strategy"][0]["label_id"] == "formula_application"
    assert profile["focus_labels"][0]["label_type"] == "knowledge_point"


@pytest.mark.asyncio
async def test_profile_uses_process_grading_as_learning_evidence(db_session):
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({"id": "profile_kp_induction", "name": "楞次定律"})

    q_svc = QuestionService(db_session)
    await q_svc.create_question({
        "id": "q_profile_partial_process",
        "stem_text": "电磁感应解答题",
        "answer": "完整答案",
        "explanation": "解析",
        "question_type": "problem_solving",
        "difficulty_tier": "medium",
        "source": "human",
        "options": [],
        "labels": [
            {"label_type": "knowledge_point", "label_id": "profile_kp_induction", "role": "主要"},
            {"label_type": "physics_model", "label_id": "electromagnetic_induction", "role": "主要"},
            {"label_type": "ability_dimension", "label_id": "calculation_reasoning", "role": "主要"},
            {"label_type": "question_structure", "label_id": "multi_step", "role": "主要"},
            {"label_type": "solution_strategy", "label_id": "formula_application", "role": "主要"},
        ],
        "formulas": [],
        "images": [],
    })
    await q_svc.review_question("q_profile_partial_process", QualityStatus.approved)

    student_svc = StudentService(db_session)
    await student_svc.record_answer(
        "student_process_profile",
        "q_profile_partial_process",
        "列式正确但计算和单位不完整",
        False,
        30000,
        grading_result={
            "process_score": 60,
            "model_correct": True,
            "equation_correct": False,
            "calculation_correct": False,
            "unit_correct": False,
            "step_scores": [
                {"name": "建模", "score": 2, "max_score": 2},
                {"name": "计算", "score": 1, "max_score": 3},
            ],
        },
    )

    profile = await StudentPracticeProfileService(db_session).build_profile("student_process_profile")

    assert profile["weak_labels"]["solution_strategy"][0]["label_id"] == "formula_application"
    assert profile["weak_label_weights"]["solution_strategy"]["formula_application"] > profile["weak_label_weights"]["physics_model"]["electromagnetic_induction"]
    assert profile["process_weak_weights"]["equation_setup"] > 0
    assert profile["process_weak_weights"]["calculation_accuracy"] > 0
    assert profile["process_weak_weights"]["unit_direction"] > 0
    assert "model_recognition" not in profile["process_weak_weights"]
