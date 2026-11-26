from app.services.physics_error_types import (
    error_type_name,
    normalize_answer_text,
    normalize_process_grading,
)


def test_normalize_process_grading_maps_error_type_and_clamps_score():
    result = normalize_process_grading(
        {
            "extracted_answer": "v=gt",
            "is_correct": False,
            "feedback": "少考虑初速度",
            "process_score": 135,
            "model_correct": True,
            "equation_correct": False,
            "calculation_correct": None,
            "unit_correct": "false",
            "error_type": "equation_setup",
            "first_error": "运动方程建立错误",
            "next_action": "先写出位移时间关系",
        }
    )

    assert result["final_answer"] == "v=gt"
    assert result["process_score"] == 100
    assert result["error_type"] == "equation_setup"
    assert result["error_type_name"] == "方程建立错误"
    assert result["model_correct"] is True
    assert result["equation_correct"] is False
    assert result["unit_correct"] is False


def test_normalize_process_grading_uses_safe_defaults():
    result = normalize_process_grading(
        {"is_correct": True, "error_type": "made_up"},
        fallback_answer="A",
        fallback_feedback="已提交",
    )

    assert result["final_answer"] == "A"
    assert result["feedback"] == "已提交"
    assert result["error_type"] == "unknown"
    assert result["error_type_name"] == error_type_name("unknown")


def test_normalize_process_grading_preserves_answer_image_metadata():
    result = normalize_process_grading({
        "is_correct": False,
        "answer_image_path": "/static/uploads/answers/student/a.png",
        "answer_crop_image_path": "/static/uploads/answers/student/crop-a.png",
        "answer_page_image_path": "/static/uploads/answers/student/page-a.png",
        "answer_image_paths": [
            "/static/uploads/answers/student/a.png",
            "/static/uploads/answers/student/b.png",
        ],
        "answer_page_image_paths": [
            "/static/uploads/answers/student/page-a.png",
            "/static/uploads/answers/student/page-b.png",
        ],
        "answer_source": "handwriting",
    })

    assert result["answer_image_path"] == "/static/uploads/answers/student/a.png"
    assert result["answer_crop_image_path"] == "/static/uploads/answers/student/crop-a.png"
    assert result["answer_page_image_path"] == "/static/uploads/answers/student/page-a.png"
    assert result["answer_image_paths"] == [
        "/static/uploads/answers/student/a.png",
        "/static/uploads/answers/student/b.png",
    ]
    assert result["answer_page_image_paths"] == [
        "/static/uploads/answers/student/page-a.png",
        "/static/uploads/answers/student/page-b.png",
    ]
    assert result["answer_source"] == "handwriting"


def test_normalize_answer_text_flattens_multi_part_vision_answer():
    result = normalize_answer_text({"(1)": "t = 4s", "(2)": "h_2 = 60m"})

    assert result == "(1) t = 4s；(2) h_2 = 60m"


def test_normalize_answer_text_localizes_english_vision_keys():
    result = normalize_answer_text({
        "acceleration": "-4 m/s²",
        "displacement_after_5s": "40.5 m",
    })

    assert result == "加速度 -4 m/s²；5s 后位移 40.5 m"


def test_normalize_answer_text_repairs_latex_fraction_control_escape():
    result = normalize_answer_text("t_{3}=\x0crac{v_{1}}{a_{2}} = 4s")

    assert result == r"t_{3}=\frac{v_{1}}{a_{2}} = 4s"


def test_normalize_process_grading_repairs_latex_in_trust_fields():
    result = normalize_process_grading({
        "extracted_answer": "t_{3}=\x0crac{v_{1}}{a_{2}} = 4s",
        "grading_basis": "由 t_{3}=\x0crac{v_{1}}{a_{2}} 得出时间正确。",
        "step_scores": [
            {
                "name": "列式",
                "score": 2,
                "max_score": 2,
                "comment": "写出 \x0crac{v_{1}}{a_{2}} 关系式。",
            }
        ],
    })

    assert result["final_answer"] == r"t_{3}=\frac{v_{1}}{a_{2}} = 4s"
    assert result["grading_basis"] == r"由 t_{3}=\frac{v_{1}}{a_{2}} 得出时间正确。"
    assert result["step_scores"][0]["comment"] == r"写出 \frac{v_{1}}{a_{2}} 关系式。"
