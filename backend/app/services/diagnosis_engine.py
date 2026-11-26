"""Misconception diagnosis engine.

Diagnoses misconceptions from student wrong answers using:
1. Direct option→misconception mapping (when options have targets_misconception set)
2. Rule-based fallback: confused_with knowledge relations + keyword matching
"""

import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.knowledge import KnowledgeRelation, Misconception, RelationType
from app.models.question import Question

SEED_DIR = Path(__file__).parent.parent / "seed"
INTERVENTION_THRESHOLD = 3


class DiagnosisEngine:
    def __init__(self, db: AsyncSession):
        self.db = db
        self._misconception_kw: list[dict] | None = None  # loaded lazily

    async def diagnose(
        self, question: Question, given_answer: str
    ) -> list[dict]:
        """Diagnose misconceptions from a wrong answer.

        Returns list of {id, name, source} dicts.
        """
        # Step 1: Check direct option→misconception mapping
        for opt in question.options:
            if opt.label == given_answer and opt.targets_misconception:
                mc = await self._get_misconception_by_id(opt.targets_misconception)
                if mc:
                    return [{"id": mc.id, "name": mc.name, "source": "option"}]

        # Step 2: Rule-based fallback via confused_with relations + keyword match
        kp_ids = [lbl.label_id for lbl in question.labels if lbl.label_type == "knowledge_point"]
        confused_kp_ids = await self._get_confused_kp_ids(kp_ids)

        matched = []
        for mc_entry in self._load_misconceptions():
            mc_kps = set(mc_entry.get("related_kp_ids", []))
            if mc_kps & confused_kp_ids or mc_kps & set(kp_ids):
                # Keyword match against option text
                selected_text = self._get_option_text(question, given_answer)
                if self._keyword_match(mc_entry.get("keywords", []), selected_text):
                    matched.append({"id": mc_entry["id"], "name": mc_entry["name"], "source": "rule"})
                elif not mc_entry.get("keywords"):
                    # No keywords → match by KP overlap alone
                    matched.append({"id": mc_entry["id"], "name": mc_entry["name"], "source": "rule"})

        return matched[:2]  # Return at most 2 matched misconceptions

    async def should_intervene(self, student_id: str) -> dict | None:
        """Check if any misconception has appeared >= INTERVENTION_THRESHOLD times.

        Returns {misconception_id, name, count} if intervention needed, else None.
        """
        from app.models.student import StudentAnswer

        result = await self.db.execute(
            select(StudentAnswer.misconception_ids)
            .where(StudentAnswer.student_id == student_id)
            .order_by(StudentAnswer.created_at.desc())
            .limit(50)
        )
        counts: dict[str, int] = {}
        for row in result.scalars().all():
            if row:
                for mc_id in row:
                    counts[mc_id] = counts.get(mc_id, 0) + 1

        for mc_id, count in counts.items():
            if count >= INTERVENTION_THRESHOLD:
                mc = await self._get_misconception_by_id(mc_id)
                name = mc.name if mc else mc_id
                return {"misconception_id": mc_id, "name": name, "count": count}

        return None

    async def _get_misconception_by_id(self, mc_id: str) -> Misconception | None:
        result = await self.db.execute(
            select(Misconception).where(Misconception.id == mc_id)
        )
        return result.scalar_one_or_none()

    async def _get_confused_kp_ids(self, kp_ids: list[str]) -> set[str]:
        """Get KP IDs that are 'confused_with' the given KPs."""
        if not kp_ids:
            return set()
        result = await self.db.execute(
            select(KnowledgeRelation.target_id).where(
                KnowledgeRelation.source_id.in_(kp_ids),
                KnowledgeRelation.relation_type == RelationType.confused_with,
            )
        )
        return set(result.scalars().all())

    def _load_misconceptions(self) -> list[dict]:
        if self._misconception_kw is not None:
            return self._misconception_kw
        path = SEED_DIR / "misconceptions.json"
        if path.exists():
            self._misconception_kw = json.loads(path.read_text())
        else:
            self._misconception_kw = []
        return self._misconception_kw

    @staticmethod
    def _get_option_text(question: Question, label: str) -> str:
        for opt in question.options:
            if opt.label == label:
                return opt.text
        return ""

    @staticmethod
    def _keyword_match(keywords: list[str], text: str) -> bool:
        if not keywords or not text:
            return False
        return any(kw in text for kw in keywords)
