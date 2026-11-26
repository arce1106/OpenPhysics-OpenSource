from app.services.adaptive_service import assess_ai_judgment
from app.services.grading_scores import normalize_grading_scores
from app.services.physics_error_types import normalize_process_grading, process_grading_credit


def test_eight_out_of_eight_preserves_points_and_becomes_100_percent():
    raw = {"is_correct": True, "confidence": 1, "error_type": "none",
           "process_score": 8, "step_scores": [
               {"name": "第1问", "score": 4, "full_score": 4},
               {"name": "第2问", "score": 4, "full_score": 4},
           ]}
    assessment = assess_ai_judgment("problem_solving", "答案", "答案", raw, verdict_value=True)
    grading = assessment.process_grading
    # Bank practice has no real value: the model's 8/8 becomes 100%, its total is not shown.
    assert grading["process_score"] == 100
    assert "score" not in grading and "max_score" not in grading
    assert process_grading_credit(grading) == 1
    assert not assessment.pending
    assert assessment.conflict is None


def test_teacher_points_replace_the_models_own_total():
    # The teacher set 12 points; the model graded the work as 5/10 on a scale of its own.
    raw = {"is_correct": False, "confidence": 0.9, "error_type": "calculation",
           "score": 5, "max_score": 10, "process_score": 50}
    grading = assess_ai_judgment("problem_solving", "答案", "答案", raw, verdict_value=False,
                                 full_points=12).process_grading
    assert (grading["score"], grading["max_score"], grading["process_score"]) == (6, 12, 50)
    assert process_grading_credit(grading) == 0.5


def test_teacher_points_apply_to_a_percentage_only_grading_in_half_points():
    grading = assess_ai_judgment("problem_solving", "答案", "答案",
                                 {"is_correct": False, "confidence": 0.9, "process_score": 62},
                                 verdict_value=False, full_points=12).process_grading
    assert (grading["score"], grading["max_score"]) == (7.5, 12)
    assert grading["process_score_percent"] == 62.5


def test_partial_real_points_and_half_points_are_not_rounded_away():
    raw = {"score": 7.5, "max_score": 12, "process_score": 7.5,
           "step_scores": [{"name": "结果", "score": 7.5, "max_score": 12}]}
    grading = normalize_process_grading(normalize_grading_scores(raw))
    assert grading["score"] == grading["step_scores"][0]["score"] == 7.5
    assert grading["max_score"] == 12
    assert grading["process_score"] == 62
    assert grading["process_score_percent"] == 62.5
    assert process_grading_credit(grading) == 0.625


def test_already_percent_score_does_not_get_rescaled_as_points():
    raw = {"process_score": 80, "step_scores": [{"score": 8, "max_score": 10}]}
    normalized = normalize_grading_scores(raw)
    assert normalized["process_score"] == 80
    assert process_grading_credit(normalized) == 0.8


def test_missing_step_denominators_never_invent_full_marks():
    raw = {"is_correct": True, "process_score": 10,
           "step_scores": [{"score": 10, "comment": "正确"}]}
    normalized = normalize_grading_scores(raw)
    assert normalized["process_score"] == 10
    assert "max_score" not in normalized
    assessment = assess_ai_judgment("problem_solving", "答案", "答案", raw, verdict_value=True)
    assert assessment.pending


def test_invalid_denominator_is_pending_instead_of_dividing_or_granting_credit():
    normalized = normalize_grading_scores({"score": 8, "max_score": 0, "process_score": 8})
    assert normalized["process_score"] is None
    assert normalized["needs_human_review"]


def test_normalization_is_idempotent():
    raw = {"process_score": 8, "step_scores": [{"score": 8, "max_score": 8}]}
    normalized = normalize_grading_scores(raw)
    assert normalize_grading_scores(normalized) == normalized


def test_the_grading_model_is_kept_for_comparing_graders():
    grading = assess_ai_judgment("problem_solving", "答案", "答案",
                                 {"is_correct": True, "confidence": 0.9, "process_score": 100,
                                  "vision_grading_model": "deepseek-flash"},
                                 verdict_value=True).process_grading
    assert grading["_grading_model"] == "deepseek-flash"
