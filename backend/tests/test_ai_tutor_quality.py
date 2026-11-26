from app.services.ai_service import (
    _build_tutor_payload,
    _normalize_tutor_text,
    _strip_think,
)


def test_strip_think_removes_tagged_and_labelled_reasoning():
    assert _strip_think("<think>先分析模型</think>用 $F=ma$ 判断。") == "用 $F=ma$ 判断。"
    assert _strip_think("思考过程：先找受力。\n提示：先画受力图。") == "提示：先画受力图。"


def test_build_tutor_payload_includes_process_grading_context():
    payload = _build_tutor_payload(
        question_stem="物体做匀变速直线运动，求速度。",
        correct_answer="v=v0+at",
        given_answer="v=at",
        explanation="应考虑初速度。",
        process_grading={
            "first_error": "漏掉初速度",
            "grading_basis": "学生使用了匀变速模型，但速度公式不完整。",
            "step_scores": [
                {"name": "模型选择", "score": 2, "max_score": 2, "comment": "模型正确"},
                {"name": "列式", "score": 1, "max_score": 2, "comment": "漏写初速度项"},
            ],
        },
    )

    assert payload["过程批改"]["第一处错误"] == "漏掉初速度"
    assert payload["过程批改"]["判分依据"] == "学生使用了匀变速模型，但速度公式不完整。"
    assert payload["过程批改"]["步骤给分"][1]["comment"] == "漏写初速度项"


def test_normalize_tutor_text_removes_reasoning_and_polishes_common_formulas():
    text = _normalize_tutor_text("思考：先代入。\n可以先检查 v=v0+at 的适用条件。")

    assert "思考" not in text
    assert "$v=v_0+at$" in text
