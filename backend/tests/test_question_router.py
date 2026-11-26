"""Tests for QuestionRouter — IRT+ZPD scoring, fallback, diversity, spacing."""
from unittest.mock import MagicMock
from datetime import datetime, timezone, timedelta
from types import SimpleNamespace

from app.services.question_router import (
    QuestionRouter, DIFFICULTY_TIER_TO_B,
    DIVERSITY_PENALTY, SPACING_BONUS_7D, SPACING_BONUS_3D,
    ZPD_TARGET_MIN, ZPD_TARGET_MAX,
)


class TestZpdScoring:
    def test_perfect_zpd_match(self):
        router = QuestionRouter(MagicMock())
        q = MagicMock()
        q.irt_discrimination_a = 1.0
        q.irt_difficulty_b = 0.0
        q.irt_guessing_c = 0.25
        # theta = 0, b = 0 → P(correct) = 0.25 + 0.75/(1+exp(0)) = 0.25 + 0.375 = 0.625
        score = router._compute_zpd_score(q, theta=0.0)
        assert score == 1.0  # 0.625 is in ZPD [0.5, 0.7]

    def test_too_hard_penalty(self):
        router = QuestionRouter(MagicMock())
        q = MagicMock()
        q.irt_discrimination_a = 1.0
        q.irt_difficulty_b = 3.0  # very hard
        q.irt_guessing_c = 0.25
        # theta=0, b=3 → P(correct) ≈ 0.2545, well below ZPD target
        score = router._compute_zpd_score(q, theta=0.0)
        assert score < 1.0  # penalized relative to perfect ZPD match
        assert score < 0.6   # substantial penalty for being too hard

    def test_too_easy_penalty(self):
        router = QuestionRouter(MagicMock())
        q = MagicMock()
        q.irt_discrimination_a = 1.0
        q.irt_difficulty_b = -3.0  # very easy
        q.irt_guessing_c = 0.25
        # theta=0, b=-3 → very high P(correct) → should be penalized
        score = router._compute_zpd_score(q, theta=0.0)
        assert score < 0.5

    def test_fallback_tier_to_b(self):
        router = QuestionRouter(MagicMock())
        q = MagicMock()
        q.irt_difficulty_b = None
        q.difficulty_tier = MagicMock(value="hard")
        assert router._tier_to_b(q) == 1.5

        q.difficulty_tier = MagicMock(value="easy")
        assert router._tier_to_b(q) == -1.5

    def test_fallback_no_tier(self):
        router = QuestionRouter(MagicMock())
        q = MagicMock()
        q.irt_difficulty_b = None
        q.difficulty_tier = None
        assert router._tier_to_b(q) == 0.0


class TestMasteryThetaMapping:
    def test_mastery_0_to_theta(self):
        assert QuestionRouter._mastery_to_theta(0.0) == -2.0

    def test_mastery_05_to_theta(self):
        assert QuestionRouter._mastery_to_theta(0.5) == 0.0

    def test_mastery_1_to_theta(self):
        assert QuestionRouter._mastery_to_theta(1.0) == 2.0


class TestTargetKnowledgePointRole:
    def test_primary_target_label_is_distinguished_from_secondary_label(self):
        primary = SimpleNamespace(
            labels=[SimpleNamespace(label_type="knowledge_point", label_id="kp_target", role="主要")]
        )
        secondary = SimpleNamespace(
            labels=[SimpleNamespace(label_type="knowledge_point", label_id="kp_target", role="次要")]
        )

        assert QuestionRouter._has_primary_target_label(primary, "kp_target") is True
        assert QuestionRouter._has_primary_target_label(secondary, "kp_target") is False


class TestDiversityBonus:
    def test_no_recent_types(self):
        q = MagicMock()
        q.question_type = MagicMock(value="single_choice")
        assert QuestionRouter._diversity_bonus(q, []) == 0.0

    def test_same_type_penalty(self):
        q = MagicMock()
        q.question_type = MagicMock(value="single_choice")
        assert QuestionRouter._diversity_bonus(q, ["single_choice"]) == -DIVERSITY_PENALTY

    def test_different_type_no_penalty(self):
        q = MagicMock()
        q.question_type = MagicMock(value="fill_in_blank")
        assert QuestionRouter._diversity_bonus(q, ["single_choice"]) == 0.0


class TestSpacingBonus:
    def test_never_attempted(self):
        assert QuestionRouter._spacing_bonus("q1", {}, datetime.now(timezone.utc)) == 0.0

    def test_7_day_bonus(self):
        now = datetime.now(timezone.utc)
        last = now - timedelta(days=8)
        assert QuestionRouter._spacing_bonus("q1", {"q1": last}, now) == SPACING_BONUS_7D

    def test_3_day_bonus(self):
        now = datetime.now(timezone.utc)
        last = now - timedelta(days=4)
        assert QuestionRouter._spacing_bonus("q1", {"q1": last}, now) == SPACING_BONUS_3D

    def test_recent_no_bonus(self):
        now = datetime.now(timezone.utc)
        last = now - timedelta(days=1)
        assert QuestionRouter._spacing_bonus("q1", {"q1": last}, now) == 0.0


class TestProfileAlignment:
    def test_profile_alignment_rewards_matching_weak_dimensions(self):
        router = QuestionRouter(MagicMock())

        matching = MagicMock()
        matching.labels = [
            MagicMock(label_type="physics_model", label_id="uniform_acceleration"),
            MagicMock(label_type="ability_dimension", label_id="analyze"),
            MagicMock(label_type="question_structure", label_id="multi_step"),
            MagicMock(label_type="solution_strategy", label_id="formula_application"),
        ]
        unrelated = MagicMock()
        unrelated.labels = [
            MagicMock(label_type="physics_model", label_id="particle"),
            MagicMock(label_type="ability_dimension", label_id="understand"),
            MagicMock(label_type="question_structure", label_id="single_concept"),
            MagicMock(label_type="solution_strategy", label_id="concept_analysis"),
        ]
        profile = {
            "weak_label_weights": {
                "physics_model": {"uniform_acceleration": 1.0},
                "ability_dimension": {"analyze": 0.8},
                "question_structure": {"multi_step": 0.7},
                "solution_strategy": {"formula_application": 0.6},
            }
        }

        assert router._profile_alignment_score(matching, profile) > router._profile_alignment_score(unrelated, profile)

    def test_profile_alignment_rewards_matching_process_weakness(self):
        router = QuestionRouter(MagicMock())

        matching = MagicMock()
        matching.question_type = MagicMock(value="problem_solving")
        matching.labels = [
            MagicMock(label_type="physics_model", label_id="electromagnetic_induction"),
            MagicMock(label_type="ability_dimension", label_id="calculation_reasoning"),
            MagicMock(label_type="question_structure", label_id="multi_step"),
            MagicMock(label_type="solution_strategy", label_id="formula_application"),
        ]
        conceptual = MagicMock()
        conceptual.question_type = MagicMock(value="single_choice")
        conceptual.labels = [
            MagicMock(label_type="physics_model", label_id="electromagnetic_induction"),
            MagicMock(label_type="ability_dimension", label_id="concept_understanding"),
            MagicMock(label_type="question_structure", label_id="single_concept"),
            MagicMock(label_type="solution_strategy", label_id="concept_analysis"),
        ]
        profile = {
            "process_weak_weights": {
                "equation_setup": 1.0,
                "calculation_accuracy": 0.8,
            }
        }

        assert router._profile_alignment_score(matching, profile) > router._profile_alignment_score(conceptual, profile)


class TestTagBalancedSession:
    def _question(
        self,
        qid: str,
        question_type: str,
        tier: str,
        model: str,
        ability: str,
        structure: str,
        strategy: str,
    ):
        return SimpleNamespace(
            id=qid,
            question_type=SimpleNamespace(value=question_type),
            difficulty_tier=SimpleNamespace(value=tier),
            difficulty=None,
            irt_discrimination_a=1.0,
            irt_difficulty_b=None,
            irt_guessing_c=None,
            labels=[
                SimpleNamespace(label_type="physics_model", label_id=model),
                SimpleNamespace(label_type="ability_dimension", label_id=ability),
                SimpleNamespace(label_type="question_structure", label_id=structure),
                SimpleNamespace(label_type="solution_strategy", label_id=strategy),
            ],
        )

    def test_tag_balanced_session_builds_teacher_like_sequence(self):
        profile = {
            "weak_label_weights": {
                "physics_model": {"uniform_acceleration": 1.0},
                "ability_dimension": {"analyze": 0.8},
                "question_structure": {"multi_step": 0.7},
                "solution_strategy": {"formula_application": 0.6},
            }
        }
        warmup = self._question("q_warmup", "single_choice", "easy", "particle", "understand", "single_concept", "concept_analysis")
        repair = self._question("q_repair", "single_choice", "medium", "uniform_acceleration", "analyze", "multi_step", "formula_application")
        model_variation = self._question("q_model_variation", "fill_in_blank", "medium", "uniform_acceleration", "analyze", "graphical_analysis", "formula_application")
        strategy_variation = self._question("q_strategy_variation", "experiment", "medium", "uniform_acceleration", "apply", "experimental_design", "process_segmentation")
        challenge = self._question("q_challenge", "problem_solving", "hard", "uniform_acceleration", "analyze", "multi_step", "formula_application")
        unrelated = self._question("q_unrelated", "single_choice", "medium", "particle", "understand", "single_concept", "concept_analysis")

        selected = QuestionRouter._select_tag_balanced_session(
            [(1.0, q) for q in [unrelated, challenge, strategy_variation, model_variation, repair, warmup]],
            theta=0.0,
            count=5,
            profile=profile,
        )

        assert [q.id for q in selected] == [
            "q_warmup",
            "q_repair",
            "q_model_variation",
            "q_strategy_variation",
            "q_challenge",
        ]
        assert [q.session_phase for q in selected] == [
            "warmup",
            "targeted_repair",
            "model_variation",
            "strategy_variation",
            "challenge",
        ]

    def test_single_question_session_prioritizes_profile_repair(self):
        profile = {
            "weak_label_weights": {
                "physics_model": {"uniform_acceleration": 1.0},
                "ability_dimension": {"analyze": 1.0},
            }
        }
        warmup = self._question("q_warmup", "single_choice", "easy", "particle", "understand", "single_concept", "concept_analysis")
        repair = self._question("q_repair", "single_choice", "medium", "uniform_acceleration", "analyze", "multi_step", "formula_application")

        selected = QuestionRouter._select_tag_balanced_session(
            [(1.0, warmup), (1.0, repair)],
            theta=0.0,
            count=1,
            profile=profile,
        )

        assert [q.id for q in selected] == ["q_repair"]
        assert selected[0].session_phase == "targeted_repair"


class TestDefaultGuessing:
    def test_single_choice(self):
        q = MagicMock()
        q.question_type = MagicMock(value="single_choice")
        q.irt_guessing_c = None
        assert QuestionRouter._default_guessing(q) == 0.25

    def test_true_false(self):
        q = MagicMock()
        q.question_type = MagicMock(value="true_false")
        q.irt_guessing_c = None
        assert QuestionRouter._default_guessing(q) == 0.5

    def test_irt_c_override(self):
        q = MagicMock()
        q.irt_guessing_c = 0.3
        # _compute_zpd_score uses irt_guessing_c directly, not _default_guessing
        router = QuestionRouter(MagicMock())
        q.irt_discrimination_a = 1.0
        q.irt_difficulty_b = 0.0
        score = router._compute_zpd_score(q, theta=0.0)
        # P = 0.3 + 0.7/(1+1) = 0.3 + 0.35 = 0.65 — in ZPD range
        assert score == 1.0
