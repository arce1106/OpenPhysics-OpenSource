import math
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.question import Question, QualityStatus
from app.models.student import StudentAnswer
from app.services.question_service import QuestionService
from app.services.student_practice_profile import StudentPracticeProfileService
from app.services.student_service import StudentService
from app.services.question_ordering import DIFFICULTY_TIER_ORDER, QUESTION_TYPE_ORDER

DIFFICULTY_TIER_TO_B = {
    "easy": -1.5,
    "moderate_easy": -0.75,
    "medium": 0.0,
    "moderate_hard": 0.75,
    "hard": 1.5,
}

# Number of answer options per question type (for guessing parameter fallback)
QUESTION_TYPE_N_OPTIONS = {
    "single_choice": 4,
    "true_false": 2,
    "multiple_choice": 6,
    "fill_in_blank": 10,
    "knowledge_fill_in_blank": 10,
    "experiment": 4,
    "graph_construction": 4,
    "problem_solving": 4,
    "comprehensive": 4,
}

PRIMARY_KNOWLEDGE_POINT_ROLES = {"primary", "主要"}

ZPD_TARGET_MIN = 0.50
ZPD_TARGET_MAX = 0.70
DIVERSITY_PENALTY = 0.20
SPACING_BONUS_7D = 0.15
SPACING_BONUS_3D = 0.08
CORRECT_ATTEMPT_EXCLUSION_DAYS = 7
WRONG_ATTEMPT_EXCLUSION_DAYS = 1

PROFILE_LABEL_SCORE_WEIGHTS = {
    "knowledge_point": 0.30,
    "physics_model": 0.28,
    "ability_dimension": 0.22,
    "question_structure": 0.18,
    "solution_strategy": 0.18,
}

PROCESS_WEAKNESS_SCORE_WEIGHTS = {
    "model_recognition": 0.20,
    "equation_setup": 0.18,
    "calculation_accuracy": 0.16,
    "unit_direction": 0.14,
}

LONG_RESPONSE_TYPES = {"problem_solving", "comprehensive"}
MID_RESPONSE_TYPES = {"experiment", "fill_in_blank", "knowledge_fill_in_blank", "graph_construction"}

PROCESS_MATCH_RULES = {
    "equation_setup": {
        "type_scores": [(LONG_RESPONSE_TYPES | MID_RESPONSE_TYPES, 0.35)],
        "label_scores": [
            ("solution_strategy", {"formula", "equation", "derive", "application"}, 0.45),
            ("question_structure", {"multi", "step", "calculation", "comprehensive"}, 0.35),
        ],
    },
    "calculation_accuracy": {
        "type_scores": [
            ({"fill_in_blank", "knowledge_fill_in_blank", "problem_solving", "comprehensive"}, 0.45),
        ],
        "label_scores": [
            ("ability_dimension", {"calculation", "calculate", "quant", "reasoning"}, 0.45),
            ("solution_strategy", {"formula", "equation"}, 0.20),
        ],
    },
    "unit_direction": {
        "type_scores": [(LONG_RESPONSE_TYPES | {"experiment", "graph_construction"}, 0.35)],
        "label_scores": [
            ("ability_dimension", {"direction", "unit", "vector", "calculation"}, 0.35),
            ("solution_strategy", {"direction", "unit", "sign", "formula"}, 0.25),
        ],
    },
}


class QuestionRouter:
    """Intelligent question selection using IRT 3PL ZPD scoring, spaced repetition, and diversity."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.question_svc = QuestionService(db)
        self.student_svc = StudentService(db)

    @staticmethod
    def _has_primary_target_label(question: Question, kp_id: str) -> bool:
        return any(
            label.label_type == "knowledge_point"
            and label.label_id == kp_id
            and str(label.role or "").strip().lower() in PRIMARY_KNOWLEDGE_POINT_ROLES
            for label in (question.labels or [])
        )

    async def select_next(
        self,
        student_id: str,
        kp_id: str,
        mastery: float,
        recent_question_ids: list[str] | None = None,
        recent_question_types: list[str] | None = None,
        profile: dict | None = None,
    ) -> Question | None:
        """Select the best next question for a student on a knowledge point.

        Pipeline:
        1. Fetch all approved questions for the KP
        2. Score each using IRT 3PL ZPD match
        3. Apply diversity penalty (consecutive same type)
        4. Apply spacing bonus (time since last attempt)
        5. Return highest-scored unanswered question
        """
        questions = await self.question_svc.list_questions(
            status=QualityStatus.approved, kp_id=kp_id, limit=100, primary_kp_only=True,
        )
        if not questions:
            return None

        theta = self._mastery_to_theta(mastery)
        now = datetime.now(timezone.utc)
        recent_ids = set(recent_question_ids or [])
        recent_types = recent_question_types or []
        profile = profile if profile is not None else await StudentPracticeProfileService(self.db).build_profile(student_id)

        # Fetch last-attempt timestamps for spacing bonus
        last_attempt_records = await self._get_last_attempt_records(student_id)
        last_attempts = {
            question_id: record["created_at"]
            for question_id, record in last_attempt_records.items()
        }
        recent_attempt_ids = self._recent_attempt_ids(last_attempt_records, now)

        best_question = None
        best_score = -float("inf")

        available_questions = [
            q for q in questions if q.id not in recent_ids and q.id not in recent_attempt_ids
        ]
        for q in available_questions:
            score = self._compute_zpd_score(q, theta)
            score += self._diversity_bonus(q, recent_types)
            score += self._spacing_bonus(q.id, last_attempts, now)
            score += self._profile_alignment_score(q, profile)

            if score > best_score:
                best_score = score
                best_question = q

        return best_question

    async def select_session(
        self,
        student_id: str,
        kp_id: str,
        mastery: float,
        count: int = 5,
        profile: dict | None = None,
    ) -> list[Question]:
        """Build a structured session: diagnostic(1) + practice(3) + challenge(1)."""
        questions = await self.question_svc.list_questions(
            status=QualityStatus.approved, kp_id=kp_id, limit=100, primary_kp_only=True,
        )
        if not questions:
            return []

        theta = self._mastery_to_theta(mastery)
        now = datetime.now(timezone.utc)
        last_attempt_records = await self._get_last_attempt_records(student_id)
        last_attempts = {
            question_id: record["created_at"]
            for question_id, record in last_attempt_records.items()
        }
        recent_attempt_ids = self._recent_attempt_ids(last_attempt_records, now)
        profile = profile if profile is not None else await StudentPracticeProfileService(self.db).build_profile(student_id)

        # Score all questions
        available_questions = [q for q in questions if q.id not in recent_attempt_ids]
        scored = []
        for q in available_questions:
            score = self._compute_zpd_score(q, theta)
            score += self._spacing_bonus(q.id, last_attempts, now)
            score += self._profile_alignment_score(q, profile)
            scored.append((score, q))

        return self._select_tag_balanced_session(scored, theta, count, profile)

    def _compute_zpd_score(self, question: Question, theta: float) -> float:
        """Compute ZPD match score using IRT 3PL model.

        P(correct) = c + (1-c) / (1 + exp(-1.7 * a * (theta - b)))

        Score is how close P(correct) is to the ZPD sweet spot [0.5, 0.7].
        Returns 1.0 for perfect ZPD match, decreasing with distance.
        """
        a = question.irt_discrimination_a or 1.0
        b = question.irt_difficulty_b or self._tier_to_b(question)
        c = question.irt_guessing_c or self._default_guessing(question)

        z = -1.7 * a * (theta - b)
        # Clamp z to avoid overflow in exp
        z = max(-50.0, min(50.0, z))
        p_correct = c + (1.0 - c) / (1.0 + math.exp(z))

        if ZPD_TARGET_MIN <= p_correct <= ZPD_TARGET_MAX:
            return 1.0
        elif p_correct < ZPD_TARGET_MIN:
            # Too hard — penalty grows as P approaches 0
            return 1.0 - (ZPD_TARGET_MIN - p_correct) * 2.0
        else:
            # Too easy — penalty grows as P approaches 1
            return 1.0 - (p_correct - ZPD_TARGET_MAX) * 2.0

    def _tier_to_b(self, question: Question) -> float:
        """Map difficulty_tier to IRT b parameter when irt_difficulty_b is null."""
        if question.difficulty_tier:
            return DIFFICULTY_TIER_TO_B.get(question.difficulty_tier.value, 0.0)
        return 0.0

    @staticmethod
    def _default_guessing(question: Question) -> float:
        """Estimate guessing parameter from question type."""
        qt = question.question_type.value if question.question_type else "single_choice"
        n = QUESTION_TYPE_N_OPTIONS.get(qt, 4)
        return 1.0 / n

    @staticmethod
    def _mastery_to_theta(mastery: float) -> float:
        """Map mastery [0, 1] to IRT theta [-2, 2]."""
        return 4.0 * mastery - 2.0

    @staticmethod
    def _diversity_bonus(question: Question, recent_types: list[str]) -> float:
        """Penalize consecutive same-type questions."""
        qt = question.question_type.value if question.question_type else ""
        if recent_types and recent_types[-1] == qt:
            return -DIVERSITY_PENALTY
        return 0.0

    @staticmethod
    def _profile_alignment_score(question: Question, profile: dict | None) -> float:
        if not profile:
            return 0.0
        weak_label_weights = profile.get("weak_label_weights") or {}

        score = 0.0
        for label in getattr(question, "labels", []) or []:
            label_type = getattr(label, "label_type", None)
            label_id = getattr(label, "label_id", None)
            if not label_type or not label_id:
                continue
            type_weight = PROFILE_LABEL_SCORE_WEIGHTS.get(label_type)
            if not type_weight:
                continue
            weak_weight = (weak_label_weights.get(label_type) or {}).get(label_id)
            if weak_weight:
                score += type_weight * float(weak_weight)
        score += QuestionRouter._process_weakness_alignment_score(question, profile)
        return score

    @staticmethod
    def _process_weakness_alignment_score(question: Question, profile: dict | None) -> float:
        process_weights = ((profile or {}).get("process_weak_weights") or {})
        if not process_weights:
            return 0.0

        score = 0.0
        for skill_id, weak_weight in process_weights.items():
            type_weight = PROCESS_WEAKNESS_SCORE_WEIGHTS.get(skill_id)
            if not type_weight:
                continue
            match = QuestionRouter._process_weakness_match(question, skill_id)
            if match <= 0:
                continue
            score += type_weight * float(weak_weight) * match
        return score

    @staticmethod
    def _process_weakness_match(question: Question, skill_id: str) -> float:
        if skill_id == "model_recognition":
            return 1.0 if QuestionRouter._labels(question, "physics_model") else 0.0

        rule = PROCESS_MATCH_RULES.get(skill_id)
        if not rule:
            return 0.0

        question_type = QuestionRouter._question_type(question)
        match = sum(
            score
            for question_types, score in rule["type_scores"]
            if question_type in question_types
        )
        match += sum(
            score
            for label_type, tokens, score in rule["label_scores"]
            if QuestionRouter._has_label_token(question, label_type, tokens)
        )
        return min(1.0, match)

    @staticmethod
    def _has_label_token(question: Question, label_type: str, tokens: set[str]) -> bool:
        for label_id in QuestionRouter._labels(question, label_type):
            normalized = label_id.lower()
            if any(token in normalized for token in tokens):
                return True
        return False

    @staticmethod
    def _select_tag_balanced_session(
        scored: list[tuple[float, Question]],
        theta: float,
        count: int,
        profile: dict | None,
    ) -> list[Question]:
        if count <= 0 or not scored:
            return []

        selected: list[Question] = []
        used_ids: set[str] = set()
        has_profile_focus = bool(
            (profile or {}).get("focus_labels")
            or any(((profile or {}).get("weak_label_weights") or {}).values())
        )
        if not has_profile_focus:
            selected = [
                question
                for _, question in sorted(scored, key=lambda item: QuestionRouter._pedagogical_key(item[1]))
            ][:count]
            for index, question in enumerate(selected):
                phase = "warmup" if index == 0 else "challenge" if index == len(selected) - 1 and len(selected) >= 4 else "mixed_practice"
                setattr(question, "session_phase", phase)
            return selected

        phase_order = ["targeted_repair"] if count == 1 and has_profile_focus else [
            "warmup",
            "targeted_repair",
            "model_variation",
            "strategy_variation",
            "challenge",
        ]
        while len(phase_order) < count:
            phase_order.insert(-1, "mixed_practice")

        score_map = {getattr(question, "id", ""): score for score, question in scored}

        for phase in phase_order[:count]:
            candidate = QuestionRouter._best_phase_candidate(
                phase=phase,
                scored=scored,
                score_map=score_map,
                used_ids=used_ids,
                selected=selected,
                profile=profile,
                theta=theta,
            )
            if candidate is None:
                break
            setattr(candidate, "session_phase", phase)
            used_ids.add(candidate.id)
            selected.append(candidate)

        if len(selected) < count:
            for _, question in sorted(scored, key=lambda item: (-item[0], QuestionRouter._pedagogical_key(item[1]))):
                if question.id in used_ids:
                    continue
                setattr(question, "session_phase", "mixed_practice")
                used_ids.add(question.id)
                selected.append(question)
                if len(selected) >= count:
                    break

        return selected[:count]

    @staticmethod
    def _best_phase_candidate(
        phase: str,
        scored: list[tuple[float, Question]],
        score_map: dict[str, float],
        used_ids: set[str],
        selected: list[Question],
        profile: dict | None,
        theta: float,
    ) -> Question | None:
        candidates = [question for _, question in scored if question.id not in used_ids]
        if not candidates:
            return None
        if phase in {"model_variation", "strategy_variation"}:
            non_long_candidates = [
                question for question in candidates
                if QuestionRouter._question_type(question) not in LONG_RESPONSE_TYPES
            ]
            if non_long_candidates:
                candidates = non_long_candidates

        def key(question: Question) -> tuple[float, tuple[int, float, str]]:
            base = score_map.get(question.id, 0.0)
            phase_score = QuestionRouter._phase_score(question, phase, selected, profile, theta)
            return phase_score + base, QuestionRouter._pedagogical_key(question)

        if phase == "warmup":
            return min(candidates, key=lambda question: (
                QuestionRouter._pedagogical_key(question),
                -score_map.get(question.id, 0.0),
            ))

        return max(candidates, key=key)

    @staticmethod
    def _phase_score(
        question: Question,
        phase: str,
        selected: list[Question],
        profile: dict | None,
        theta: float,
    ) -> float:
        profile_score = QuestionRouter._profile_alignment_score(question, profile)
        question_type = QuestionRouter._question_type(question)
        difficulty = QuestionRouter._difficulty_rank(question)
        new_type_bonus = 0.35 if question_type and question_type not in {
            QuestionRouter._question_type(item) for item in selected
        } else 0.0
        new_structure_bonus = 0.35 if QuestionRouter._first_label(question, "question_structure") not in {
            QuestionRouter._first_label(item, "question_structure") for item in selected
        } else 0.0
        new_strategy_bonus = 0.30 if QuestionRouter._first_label(question, "solution_strategy") not in {
            QuestionRouter._first_label(item, "solution_strategy") for item in selected
        } else 0.0

        if phase == "targeted_repair":
            return profile_score * 4.0 - abs(QuestionRouter._tier_to_b_static(question) - theta) * 0.15
        if phase == "model_variation":
            return (
                QuestionRouter._weak_label_match(question, profile, "physics_model") * 3.0
                + profile_score * 1.5
                + new_structure_bonus
                + new_type_bonus
            )
        if phase == "strategy_variation":
            response_penalty = -1.2 if question_type in LONG_RESPONSE_TYPES else 0.25 if question_type in MID_RESPONSE_TYPES else 0.0
            return (
                QuestionRouter._weak_label_match(question, profile, "ability_dimension") * 1.7
                + QuestionRouter._weak_label_match(question, profile, "solution_strategy") * 1.7
                + profile_score
                + new_strategy_bonus
                + new_structure_bonus
                + response_penalty
            )
        if phase == "challenge":
            long_bonus = 0.75 if question_type in LONG_RESPONSE_TYPES else 0.25 if question_type in MID_RESPONSE_TYPES else 0.0
            return profile_score * 1.6 + difficulty * 0.35 + long_bonus + new_type_bonus
        return profile_score + new_type_bonus + new_structure_bonus + new_strategy_bonus

    @staticmethod
    def _weak_label_match(question: Question, profile: dict | None, label_type: str) -> float:
        weights = ((profile or {}).get("weak_label_weights") or {}).get(label_type) or {}
        if not weights:
            return 0.0
        return sum(float(weights.get(label_id, 0.0)) for label_id in QuestionRouter._labels(question, label_type))

    @staticmethod
    def _labels(question: Question, label_type: str) -> list[str]:
        return [
            label.label_id
            for label in getattr(question, "labels", []) or []
            if getattr(label, "label_type", None) == label_type
        ]

    @staticmethod
    def _first_label(question: Question, label_type: str) -> str | None:
        values = QuestionRouter._labels(question, label_type)
        return values[0] if values else None

    @staticmethod
    def _question_type(question: Question) -> str | None:
        value = getattr(question, "question_type", None)
        if value is None:
            return None
        return str(value.value) if hasattr(value, "value") else str(value)

    @staticmethod
    def _difficulty_tier(question: Question) -> str | None:
        value = getattr(question, "difficulty_tier", None)
        if value is None:
            return None
        return str(value.value) if hasattr(value, "value") else str(value)

    @staticmethod
    def _difficulty_rank(question: Question) -> float:
        difficulty = getattr(question, "difficulty", None)
        if difficulty is not None:
            try:
                return float(difficulty)
            except (TypeError, ValueError):
                pass
        tier = QuestionRouter._difficulty_tier(question)
        return DIFFICULTY_TIER_ORDER.get(tier or "", 99.0)

    @staticmethod
    def _pedagogical_key(question: Question) -> tuple[int, float, str]:
        question_type = QuestionRouter._question_type(question)
        return (
            QUESTION_TYPE_ORDER.get(question_type or "", 9),
            QuestionRouter._difficulty_rank(question),
            str(getattr(question, "id", "")),
        )

    @staticmethod
    def _tier_to_b_static(question: Question) -> float:
        tier = QuestionRouter._difficulty_tier(question)
        return DIFFICULTY_TIER_TO_B.get(tier or "", 0.0)

    @staticmethod
    def _spacing_bonus(
        question_id: str,
        last_attempts: dict[str, datetime],
        now: datetime,
    ) -> float:
        """Bonus for questions not seen recently (spaced repetition)."""
        last = last_attempts.get(question_id)
        if last is None:
            return 0.0  # never attempted — neutral
        days = (now - last).total_seconds() / 86400.0
        if days >= 7:
            return SPACING_BONUS_7D
        elif days >= 3:
            return SPACING_BONUS_3D
        return 0.0

    @staticmethod
    def _recent_attempt_ids(last_attempt_records: dict[str, dict], now: datetime) -> set[str]:
        """Questions attempted recently should not reappear in the next practice set."""
        recent_ids: set[str] = set()
        for question_id, record in last_attempt_records.items():
            last = record["created_at"]
            days = (now - last).total_seconds() / 86400.0
            exclusion_days = (
                CORRECT_ATTEMPT_EXCLUSION_DAYS
                if record["is_correct"]
                else WRONG_ATTEMPT_EXCLUSION_DAYS
            )
            if days < exclusion_days:
                recent_ids.add(question_id)
        return recent_ids

    async def _get_last_attempt_records(self, student_id: str) -> dict[str, dict]:
        """Get the most recent attempt timestamp and outcome for each question."""
        result = await self.db.execute(
            select(StudentAnswer.question_id, StudentAnswer.created_at, StudentAnswer.is_correct)
            .where(StudentAnswer.student_id == student_id)
            .order_by(StudentAnswer.created_at.desc())
        )
        last_attempts: dict[str, dict] = {}
        for row in result:
            qid, ts, is_correct = row
            if qid not in last_attempts:
                last_attempts[qid] = {
                    "created_at": ts,
                    "is_correct": bool(is_correct),
                }
        return last_attempts
