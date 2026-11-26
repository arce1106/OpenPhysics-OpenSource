from app.services.grading_trust_service import normalize_grading_trust


def test_normalize_grading_trust_keeps_high_confidence_basis_and_steps():
    grading = normalize_grading_trust({
        "is_correct": True,
        "confidence": 0.92,
        "grading_basis": "模型选择正确，方程建立完整，计算结果与标准答案一致。",
        "step_scores": [
            {"name": "模型选择", "score": 2, "max_score": 2, "comment": "选用匀变速模型"},
            {"name": "计算", "score": 3, "max_score": 3, "comment": "代入无误"},
        ],
        "error_type": "none",
        "feedback": "过程完整。",
    })

    assert grading["grading_confidence"] == 0.92
    assert grading["confidence_level"] == "high"
    assert grading["needs_human_review"] is False
    assert grading["grading_basis"] == "模型选择正确，方程建立完整，计算结果与标准答案一致。"
    assert grading["step_scores"][0]["name"] == "模型选择"


def test_normalize_grading_trust_marks_unknown_or_empty_answers_for_review():
    grading = normalize_grading_trust({
        "is_correct": False,
        "extracted_answer": "",
        "feedback": "AI 未能定位这道题的答案",
        "error_type": "unknown",
    })

    assert grading["grading_confidence"] <= 0.4
    assert grading["confidence_level"] == "low"
    assert grading["needs_human_review"] is True
    assert "建议人工确认" in grading["grading_basis"]


def test_normalize_grading_trust_keeps_formula_process_out_of_step_title():
    grading = normalize_grading_trust({
        "is_correct": True,
        "confidence": 0.9,
        "error_type": "none",
        "step_scores": [
            {
                "name": "由$v^{2}=2ax_{1}$，代入$v = 50m/s$，$a = 5.0m",
                "score": 3,
                "max_score": 1,
                "comment": "",
            }
        ],
    })

    assert grading["step_scores"][0]["name"] == "步骤1"
    assert grading["step_scores"][0]["score"] == 3
    assert grading["step_scores"][0]["max_score"] == 3
    assert grading["step_scores"][0]["comment"] == ""
