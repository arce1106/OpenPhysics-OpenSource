from __future__ import annotations

from collections import Counter, defaultdict
from math import log1p

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.question import Question
from app.models.student import StudentAnswer
from app.services.physics_error_types import answer_credit_from_grading, effective_process_grading


PROFILE_LABEL_TYPES = [
    "knowledge_point",
    "physics_model",
    "ability_dimension",
    "question_structure",
    "solution_strategy",
]

PROCESS_WEAKNESS_NAMES = {
    "model_recognition": "模型识别",
    "equation_setup": "列式建模",
    "calculation_accuracy": "计算准确性",
    "unit_direction": "单位和方向",
}

PROCESS_LABEL_BOOSTS = {
    "model_recognition": {"physics_model": 0.45},
    "equation_setup": {"solution_strategy": 0.45, "question_structure": 0.30},
    "calculation_accuracy": {"ability_dimension": 0.40},
    "unit_direction": {"ability_dimension": 0.20, "solution_strategy": 0.20},
}

PROCESS_FLAG_FIELDS = (
    ("model_correct", "model_recognition"),
    ("equation_correct", "equation_setup"),
    ("calculation_correct", "calculation_accuracy"),
    ("unit_correct", "unit_direction"),
)

PROCESS_ERROR_TYPE_FLAGS = {
    "model_selection": "model_recognition",
    "equation_setup": "equation_setup",
    "calculation": "calculation_accuracy",
    "unit_direction": "unit_direction",
}


class StudentPracticeProfileService:
    """Build a lightweight practice profile from recent answer history.

    This does not create new persistent mastery tables. It derives short-term
    weak dimensions from the labels already attached to questions.
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    async def build_profile(
        self,
        student_id: str,
        recent_limit: int = 80,
        per_type_limit: int = 5,
    ) -> dict:
        answers = await self._load_recent_answers(student_id, recent_limit)
        if not answers:
            return self._empty_profile()

        question_ids = list(dict.fromkeys(answer.question_id for answer in answers))
        questions = await self._load_questions(question_ids)
        question_map = {question.id: question for question in questions}

        attempts: dict[str, Counter[str]] = defaultdict(Counter)
        weakness_scores: dict[str, Counter[str]] = defaultdict(Counter)
        process_attempts: Counter[str] = Counter()
        process_weakness: Counter[str] = Counter()

        for answer in answers:
            question = question_map.get(answer.question_id)
            if not question:
                continue
            grading = answer.grading_result if isinstance(answer.grading_result, dict) else {}
            answer_weakness = 1.0 - answer_credit_from_grading(answer.is_correct, grading)
            process_flags = self._process_weakness_flags(answer)
            labels_by_type: dict[str, list[str]] = defaultdict(list)

            for label in question.labels:
                if label.label_type not in PROFILE_LABEL_TYPES:
                    continue
                labels_by_type[label.label_type].append(label.label_id)
                attempts[label.label_type][label.label_id] += 1
                if answer_weakness > 0:
                    weakness_scores[label.label_type][label.label_id] += answer_weakness

            for skill_id in process_flags:
                process_attempts[skill_id] += 1
                process_weakness[skill_id] += 1.0
                for label_type, boost in PROCESS_LABEL_BOOSTS.get(skill_id, {}).items():
                    for label_id in labels_by_type.get(label_type, []):
                        weakness_scores[label_type][label_id] += boost

        weak_labels: dict[str, list[dict]] = {}
        weak_label_weights: dict[str, dict[str, float]] = {}

        for label_type in PROFILE_LABEL_TYPES:
            rows = []
            for label_id, attempt_count in attempts[label_type].items():
                weak_score = weakness_scores[label_type][label_id]
                if weak_score <= 0:
                    continue
                error_rate = min(1.0, weak_score / attempt_count)
                weight = min(1.0, error_rate * (1.0 + log1p(attempt_count) / 4.0))
                rows.append({
                    "label_type": label_type,
                    "label_id": label_id,
                    "attempts": attempt_count,
                    "wrong_count": round(weak_score, 4),
                    "correct_count": round(max(0.0, attempt_count - weak_score), 4),
                    "error_rate": round(error_rate, 4),
                    "weight": round(weight, 4),
                })
            rows.sort(key=lambda row: (-row["weight"], -row["wrong_count"], -row["attempts"], row["label_id"]))
            weak_labels[label_type] = rows[:per_type_limit]
            weak_label_weights[label_type] = {
                row["label_id"]: row["weight"]
                for row in rows[:per_type_limit]
            }

        process_weaknesses = self._build_process_weaknesses(process_attempts, process_weakness)
        process_weak_weights = {
            row["skill_id"]: row["weight"]
            for row in process_weaknesses
        }

        focus_labels = [
            rows[0]
            for label_type in PROFILE_LABEL_TYPES
            for rows in [weak_labels.get(label_type, [])]
            if rows
        ]

        return {
            "label_types": PROFILE_LABEL_TYPES,
            "focus_labels": focus_labels,
            "weak_labels": weak_labels,
            "weak_label_weights": weak_label_weights,
            "process_weaknesses": process_weaknesses,
            "process_weak_weights": process_weak_weights,
            "recent_answer_count": len(answers),
        }

    async def _load_recent_answers(self, student_id: str, limit: int) -> list[StudentAnswer]:
        result = await self.db.execute(
            select(StudentAnswer)
            .where(StudentAnswer.student_id == student_id)
            .order_by(StudentAnswer.created_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def _load_questions(self, question_ids: list[str]) -> list[Question]:
        if not question_ids:
            return []
        result = await self.db.execute(
            select(Question)
            .where(Question.id.in_(question_ids))
            .options(selectinload(Question.labels))
        )
        return list(result.scalars().unique().all())

    @staticmethod
    def _empty_profile() -> dict:
        return {
            "label_types": PROFILE_LABEL_TYPES,
            "focus_labels": [],
            "weak_labels": {label_type: [] for label_type in PROFILE_LABEL_TYPES},
            "weak_label_weights": {label_type: {} for label_type in PROFILE_LABEL_TYPES},
            "process_weaknesses": [],
            "process_weak_weights": {},
            "recent_answer_count": 0,
        }

    @staticmethod
    def _process_weakness_flags(answer: StudentAnswer) -> list[str]:
        grading = effective_process_grading(answer.grading_result)
        flags = [
            skill_id
            for field, skill_id in PROCESS_FLAG_FIELDS
            if grading.get(field) is False
        ]
        skill_id = PROCESS_ERROR_TYPE_FLAGS.get(grading.get("error_type"))
        if skill_id and skill_id not in flags:
            flags.append(skill_id)
        return flags

    @staticmethod
    def _build_process_weaknesses(
        process_attempts: Counter[str],
        process_weakness: Counter[str],
    ) -> list[dict]:
        rows = []
        for skill_id, weak_score in process_weakness.items():
            attempts = process_attempts[skill_id]
            if attempts <= 0 or weak_score <= 0:
                continue
            error_rate = min(1.0, weak_score / attempts)
            weight = min(1.0, error_rate * (1.0 + log1p(attempts) / 4.0))
            rows.append({
                "skill_id": skill_id,
                "skill_name": PROCESS_WEAKNESS_NAMES.get(skill_id, skill_id),
                "attempts": attempts,
                "wrong_count": round(weak_score, 4),
                "error_rate": round(error_rate, 4),
                "weight": round(weight, 4),
            })
        rows.sort(key=lambda row: (-row["weight"], -row["wrong_count"], row["skill_id"]))
        return rows
