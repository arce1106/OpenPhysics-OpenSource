from app.services.review_center_service import build_review_center


def test_build_review_center_groups_by_error_type_and_prioritizes_first_error():
    groups = [
        {
            "kp_id": "kp_motion",
            "kp_name": "匀变速直线运动",
            "wrong_count": 2,
            "mistakes": [
                {
                    "answer_id": 1,
                    "question_id": "q1",
                    "misconception": {"id": "equation_setup", "name": "方程建立错误"},
                    "process_grading": {
                        "error_type": "equation_setup",
                        "error_type_name": "方程建立错误",
                        "first_error": "没有先规定正方向",
                        "next_action": "先画过程图，再列方程",
                    },
                },
                {
                    "answer_id": 2,
                    "question_id": "q2",
                    "misconception": {"id": "calculation", "name": "数学处理错误"},
                    "process_grading": {
                        "error_type": "calculation",
                        "error_type_name": "数学处理错误",
                        "first_error": "代入时漏平方",
                    },
                },
            ],
        },
        {
            "kp_id": "kp_force",
            "kp_name": "受力分析",
            "wrong_count": 1,
            "mistakes": [
                {
                    "answer_id": 3,
                    "question_id": "q3",
                    "misconception": {"id": "equation_setup", "name": "方程建立错误"},
                    "process_grading": {
                        "error_type": "equation_setup",
                        "error_type_name": "方程建立错误",
                        "first_error": "把合力方向写反",
                    },
                },
            ],
        },
    ]

    center = build_review_center(groups)

    assert center["total_pending"] == 3
    assert center["primary_focus"]["error_type"] == "equation_setup"
    assert center["primary_focus"]["count"] == 2
    assert center["primary_focus"]["first_error"] == "没有先规定正方向"
    assert center["error_groups"][0]["kp_names"] == ["匀变速直线运动", "受力分析"]
    assert center["review_steps"][0]["title"] == "先看第一处错误"
