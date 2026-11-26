from app.services.learning_state_rules import (
    build_learning_state_stats,
    classify_learning_state,
    recommend_learning_action,
    recommend_scope_learning_action,
)
import pytest


@pytest.mark.parametrize("mastery", [0.0, 0.25, 0.7326, 0.79])
def test_completed_practice_evidence_takes_priority_over_missing_prerequisites(mastery):
    state = classify_learning_state(status="locked", mastery=mastery, attempts=3)
    assert state["state"] == "practice"


def test_missing_prerequisites_still_guide_an_unattempted_knowledge_point():
    assert classify_learning_state(status="locked", mastery=0, attempts=0)["state"] == "locked"


def test_learning_state_marks_unseen_unlocked_kp_as_to_learn():
    state = classify_learning_state(status="needs_learning", mastery=0.0)

    assert state["state"] == "to_learn"
    assert state["label"] == "待学习"
    assert state["tone"] == "learning"


def test_learning_state_marks_passive_learning_without_practice_as_learning():
    state = classify_learning_state(
        status="needs_learning",
        mastery=0.25,
        attempts=0,
        has_learning_progress=True,
    )

    assert state["state"] == "learning"
    assert state["label"] == "学习中"


def test_learning_state_marks_attempted_low_mastery_as_practice():
    state = classify_learning_state(status="needs_learning", mastery=0.25, attempts=2)

    assert state["state"] == "practice"
    assert state["label"] == "待巩固"
    assert state["tone"] == "practice"


def test_learning_state_keeps_attempted_near_mastery_as_practice_until_stable():
    state = classify_learning_state(status="current", mastery=0.75, attempts=3)

    assert state["state"] == "practice"
    assert state["label"] == "待巩固"


def test_learning_state_does_not_trust_stale_mastered_status_below_stable_threshold():
    state = classify_learning_state(status="mastered", mastery=0.75, attempts=3)

    assert state["state"] == "practice"
    assert state["label"] == "待巩固"


def test_learning_state_marks_stable_mastery_as_mastered():
    state = classify_learning_state(status="current", mastery=0.8, attempts=3)

    assert state["state"] == "mastered"
    assert state["label"] == "已掌握"


def test_learning_action_recommendation_uses_same_stable_mastery_threshold():
    assert recommend_learning_action(0.8) == "mastered"
    assert recommend_learning_action(0.79) == "practice"
    assert recommend_learning_action(0.49) == "study"


def test_scope_learning_action_requires_every_tested_kp_to_be_stably_mastered():
    assert recommend_scope_learning_action([0.82, 0.91]) == "mastered"
    assert recommend_scope_learning_action([0.91, 0.7]) == "practice"
    assert recommend_scope_learning_action([0.2, 0.4]) == "study"


def test_learning_state_does_not_treat_low_mastery_without_evidence_as_practice():
    state = classify_learning_state(status="needs_learning", mastery=0.25, attempts=0)

    assert state["state"] == "to_learn"
    assert state["label"] == "待学习"


def test_learning_state_stats_count_backend_states_without_frontend_guessing():
    stats = build_learning_state_stats([
        {"learning_state": "to_learn", "status": "needs_learning"},
        {"learning_state": "practice", "status": "needs_learning"},
        {"learning_state": "learning", "status": "current"},
        {"learning_state": "mastered", "status": "mastered"},
        {"learning_state": "locked", "status": "locked"},
    ])

    assert stats["to_learn"] == 1
    assert stats["practice"] == 1
    assert stats["learning"] == 1
    assert stats["mastered"] == 1
    assert stats["locked"] == 1
