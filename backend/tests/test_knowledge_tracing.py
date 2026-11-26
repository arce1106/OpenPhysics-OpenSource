"""Tests for KnowledgeTracingEngine — BKT updates, forgetting, entropy, calibration."""
import math
import pytest


class TestBKTUpdate:
    def test_correct_answer_increases_mastery(self):
        from app.services.knowledge_tracing import KnowledgeTracingEngine

        bkt = KnowledgeTracingEngine()
        # Prior 0.5, correct answer with default params
        posterior = bkt.p_learn(0.5, is_correct=True)
        assert posterior > 0.5  # mastery should increase

    def test_wrong_answer_decreases_mastery(self):
        from app.services.knowledge_tracing import KnowledgeTracingEngine

        bkt = KnowledgeTracingEngine()
        # Prior 0.5, wrong answer with default params
        posterior = bkt.p_learn(0.5, is_correct=False)
        assert posterior < 0.5  # mastery should decrease

    def test_correct_with_high_guess(self):
        """High guess rate → correct answer is less informative."""
        from app.services.knowledge_tracing import KnowledgeTracingEngine

        bkt = KnowledgeTracingEngine()
        normal = bkt.p_learn(0.5, is_correct=True, p_g=0.25)
        high_guess = bkt.p_learn(0.5, is_correct=True, p_g=0.8)
        # High guess → correct answer less convincing, so smaller gain
        assert high_guess < normal

    def test_wrong_with_high_slip(self):
        """High slip → wrong answer is less informative."""
        from app.services.knowledge_tracing import KnowledgeTracingEngine

        bkt = KnowledgeTracingEngine()
        normal = bkt.p_learn(0.5, is_correct=False, p_s=0.1)
        high_slip = bkt.p_learn(0.5, is_correct=False, p_s=0.5)
        # High slip → wrong answer could be a slip, so smaller penalty
        assert high_slip > normal

    def test_learning_transfer(self):
        """P(T) should boost mastery after evidence."""
        from app.services.knowledge_tracing import KnowledgeTracingEngine

        bkt = KnowledgeTracingEngine()
        no_transfer = bkt.p_learn(0.5, is_correct=True, p_t=0.0)
        with_transfer = bkt.p_learn(0.5, is_correct=True, p_t=0.3)
        assert with_transfer > no_transfer

    def test_output_bounds(self):
        """P(L) must always be in [0, 1]."""
        from app.services.knowledge_tracing import KnowledgeTracingEngine

        bkt = KnowledgeTracingEngine()
        # Extreme priors
        assert 0 <= bkt.p_learn(0.0, is_correct=False) <= 1.0
        assert 0 <= bkt.p_learn(1.0, is_correct=False) <= 1.0
        assert 0 <= bkt.p_learn(0.0, is_correct=True) <= 1.0
        assert 0 <= bkt.p_learn(1.0, is_correct=True) <= 1.0


class TestForgetting:
    def test_no_forgetting_recent(self):
        from app.services.knowledge_tracing import KnowledgeTracingEngine

        posterior = KnowledgeTracingEngine.apply_forgetting(0.8, days_since=0.0)
        assert posterior == pytest.approx(0.8)

    def test_forgetting_halves_at_14_days(self):
        from app.services.knowledge_tracing import KnowledgeTracingEngine, FORGETTING_LAMBDA

        posterior = KnowledgeTracingEngine.apply_forgetting(0.8, days_since=14.0)
        expected = 0.8 * math.exp(-FORGETTING_LAMBDA * 14.0)
        assert posterior == pytest.approx(expected, rel=1e-6)

    def test_forgetting_decays(self):
        from app.services.knowledge_tracing import KnowledgeTracingEngine

        p1 = KnowledgeTracingEngine.apply_forgetting(0.8, days_since=7.0)
        p2 = KnowledgeTracingEngine.apply_forgetting(0.8, days_since=30.0)
        assert p2 < p1  # longer time → more decay


class TestInitialPL:
    def test_default_prior(self):
        from app.services.knowledge_tracing import KnowledgeTracingEngine

        bkt = KnowledgeTracingEngine()
        assert bkt.initial_p_l() == 0.5  # default difficulty 2.5

    def test_easy_kp_high_prior(self):
        from app.services.knowledge_tracing import KnowledgeTracingEngine

        bkt = KnowledgeTracingEngine()
        assert bkt.initial_p_l(difficulty=1.0) > 0.5

    def test_hard_kp_low_prior(self):
        from app.services.knowledge_tracing import KnowledgeTracingEngine

        bkt = KnowledgeTracingEngine()
        assert bkt.initial_p_l(difficulty=4.0) < 0.5

    def test_bounds(self):
        from app.services.knowledge_tracing import KnowledgeTracingEngine

        bkt = KnowledgeTracingEngine()
        assert 0.05 <= bkt.initial_p_l(difficulty=5.0) <= 0.95
        assert 0.05 <= bkt.initial_p_l(difficulty=0.0) <= 0.95


class TestEntropy:
    def test_certain(self):
        from app.services.knowledge_tracing import KnowledgeTracingEngine

        bkt = KnowledgeTracingEngine()
        assert bkt.entropy(0.0) == 1.0  # confidence = 1
        assert bkt.entropy(1.0) == 1.0

    def test_uncertain(self):
        from app.services.knowledge_tracing import KnowledgeTracingEngine

        bkt = KnowledgeTracingEngine()
        conf = bkt.entropy(0.5)
        assert conf < 1.0  # less than full confidence at p=0.5


class TestCalibration:
    def test_difficulty_estimate(self):
        from app.services.knowledge_tracing import calibrate_item_stats

        result = calibrate_item_stats(total_attempts=100, correct_rate=0.3)
        assert result["difficulty_estimate"] == 0.7  # 1 - 0.3

    def test_discrimination(self):
        from app.services.knowledge_tracing import calibrate_item_stats

        result = calibrate_item_stats(
            total_attempts=100, correct_rate=0.5,
            high_group_correct_rate=0.8, low_group_correct_rate=0.3,
        )
        assert result["discrimination"] == 0.5  # 0.8 - 0.3

    def test_no_data(self):
        from app.services.knowledge_tracing import calibrate_item_stats

        result = calibrate_item_stats(total_attempts=0, correct_rate=0.0)
        assert result["difficulty_estimate"] is None
        assert result["discrimination"] is None
