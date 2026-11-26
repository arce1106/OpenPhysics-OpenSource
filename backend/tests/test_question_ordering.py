from types import SimpleNamespace

from app.services.question_ordering import ordered_questions_for_student


def test_orders_questions_by_pedagogical_type_then_difficulty():
    questions = [
        {"id": "solve_hard", "question_type": "problem_solving", "difficulty": 4.0},
        {"id": "fill_medium", "question_type": "fill_in_blank", "difficulty": 2.5},
        {"id": "choice_hard", "question_type": "single_choice", "difficulty": 3.5},
        {"id": "graph_easy", "question_type": "graph_construction", "difficulty": 1.5},
        {"id": "choice_easy", "question_type": "multiple_choice", "difficulty": 1.0},
        {"id": "experiment_easy", "question_type": "experiment", "difficulty": 1.0},
        {"id": "comprehensive_medium", "question_type": "comprehensive", "difficulty": 3.0},
    ]

    ordered = ordered_questions_for_student(questions)

    assert [q["id"] for q in ordered] == [
        "choice_easy",
        "choice_hard",
        "experiment_easy",
        "graph_easy",
        "fill_medium",
        "comprehensive_medium",
        "solve_hard",
    ]


def test_orders_model_objects_with_enum_like_values_and_tier_fallback():
    questions = [
        SimpleNamespace(
            id="solve_medium",
            question_type=SimpleNamespace(value="problem_solving"),
            difficulty=None,
            difficulty_tier=SimpleNamespace(value="medium"),
        ),
        SimpleNamespace(
            id="choice_hard",
            question_type=SimpleNamespace(value="single_choice"),
            difficulty=None,
            difficulty_tier=SimpleNamespace(value="hard"),
        ),
        SimpleNamespace(
            id="fill_easy",
            question_type=SimpleNamespace(value="fill_in_blank"),
            difficulty=None,
            difficulty_tier=SimpleNamespace(value="easy"),
        ),
    ]

    ordered = ordered_questions_for_student(questions)

    assert [q.id for q in ordered] == ["choice_hard", "fill_easy", "solve_medium"]
