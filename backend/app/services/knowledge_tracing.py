"""Bayesian Knowledge Tracing engine.

Replaces simple EMA mastery tracking with proper BKT:
- P(L|evidence) via Bayes' rule
- Learning transfer between attempts
- Forgetting curve applied over time
"""

import math

from app.models.question import Question

# BKT default parameters
P_T_DEFAULT = 0.10   # learning transfer probability
P_G_DEFAULT = 0.25   # guess probability (4-option MCQ)
P_S_DEFAULT = 0.10   # slip probability
FORGETTING_LAMBDA = 0.05  # half-life ~14 days


class KnowledgeTracingEngine:
    """Bayesian Knowledge Tracing with forgetting integration."""

    @staticmethod
    def p_learn(
        p_l_prior: float,
        is_correct: bool,
        p_g: float | None = None,
        p_s: float | None = None,
        p_t: float | None = None,
        question: Question | None = None,
    ) -> float:
        """Compute P(L|evidence) using BKT Bayes' rule, then apply learning transfer.

        Args:
            p_l_prior: Prior probability of knowing the skill
            is_correct: Whether the answer was correct
            p_g: Guess probability (default from question IRT c or P_G_DEFAULT)
            p_s: Slip probability (default from question IRT a or P_S_DEFAULT)
            p_t: Learning transfer probability
            question: Question object for IRT parameter extraction

        Returns:
            Posterior P(L) after evidence and learning transfer
        """
        if p_g is None:
            p_g = KnowledgeTracingEngine._guess_from_question(question)
        if p_s is None:
            p_s = KnowledgeTracingEngine._slip_from_question(question)
        if p_t is None:
            p_t = P_T_DEFAULT

        # Bayes' rule
        if is_correct:
            numerator = p_l_prior * (1.0 - p_s)
            denominator = numerator + (1.0 - p_l_prior) * p_g
        else:
            numerator = p_l_prior * p_s
            denominator = numerator + (1.0 - p_l_prior) * (1.0 - p_g)

        # Avoid division by zero
        if denominator < 1e-9:
            p_l_evidence = p_l_prior
        else:
            p_l_evidence = max(0.0, min(1.0, numerator / denominator))

        # Learning transfer: P(L_next) = P(L|evidence) + (1 - P(L|evidence)) * P(T)
        p_l_next = p_l_evidence + (1.0 - p_l_evidence) * p_t
        return max(0.0, min(1.0, p_l_next))

    @staticmethod
    def apply_forgetting(p_l: float, days_since: float) -> float:
        """Apply exponential forgetting: P(L_t) = P(L) * exp(-lambda * days)."""
        if days_since <= 0:
            return p_l
        return p_l * math.exp(-FORGETTING_LAMBDA * days_since)

    @staticmethod
    def initial_p_l(difficulty: float | None = None) -> float:
        """Estimate prior P(L0) from difficulty.

        Args:
            difficulty: Knowledge point difficulty (0-5 scale), defaults to 2.5

        Returns:
            P(L0) = 1 - difficulty/5, clamped to [0.05, 0.95]
        """
        if difficulty is None:
            difficulty = 2.5
        p_l0 = 1.0 - difficulty / 5.0
        return max(0.05, min(0.95, p_l0))

    @staticmethod
    def entropy(p_l: float) -> float:
        """Compute binary entropy of P(L) as a confidence measure.

        H = -p*log2(p) - (1-p)*log2(1-p)
        entropy=0 → certain, entropy=1 → maximum uncertainty.

        Returns 1 - entropy as confidence (higher = more certain).
        """
        if p_l <= 0.0 or p_l >= 1.0:
            return 1.0  # certain
        h = -p_l * math.log2(p_l) - (1.0 - p_l) * math.log2(1.0 - p_l)
        return max(0.0, 1.0 - h)  # confidence = 1 - entropy

    @staticmethod
    def _guess_from_question(question: Question | None) -> float:
        """Extract guessing parameter from question IRT c, or fall back."""
        if question and question.irt_guessing_c is not None:
            return question.irt_guessing_c
        return P_G_DEFAULT

    @staticmethod
    def _slip_from_question(question: Question | None) -> float:
        """Extract slip probability from question IRT a (discrimination).

        Higher discrimination → lower slip: P(S) = 1/(1 + exp(1.7*a))
        """
        if question and question.irt_discrimination_a is not None:
            a = question.irt_discrimination_a
            return 1.0 / (1.0 + math.exp(1.7 * a))
        return P_S_DEFAULT


def calibrate_item_stats(
    total_attempts: int,
    correct_rate: float,
    high_group_correct_rate: float | None = None,
    low_group_correct_rate: float | None = None,
) -> dict:
    """Calibrate ItemStats from accumulated answer data.

    Returns:
        dict with difficulty_estimate and discrimination values.
    """
    # CTT difficulty: proportion of students who answered correctly
    # Lower correct_rate → higher difficulty
    difficulty_estimate = 1.0 - correct_rate if total_attempts > 0 else None

    # Discrimination: difference between high and low performing groups
    discrimination = None
    if high_group_correct_rate is not None and low_group_correct_rate is not None:
        discrimination = high_group_correct_rate - low_group_correct_rate
        discrimination = max(0.0, min(1.0, discrimination))

    return {
        "difficulty_estimate": difficulty_estimate,
        "discrimination": discrimination,
    }
