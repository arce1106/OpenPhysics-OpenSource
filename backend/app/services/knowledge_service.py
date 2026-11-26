import json
import re
from functools import lru_cache
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.knowledge import KnowledgePoint, KnowledgeRelation, RelationType
from app.models.question import QualityStatus, Question, QuestionLabel


CANONICAL_KP_NAMES: dict[str, str] = {
    "v1c1s3k02": "平均速度与瞬时速度",
    "v1c1s2k01": "时刻与时间间隔",
    "v1c2s3k02": "速度与位移的关系",
    "v1c2s2k01": "速度与时间的关系",
    "v1c1s1k02": "参考系",
}


def knowledge_point_order_key(kp: KnowledgePoint) -> tuple:
    """Keep chapter 9 before 10, following the stable textbook IDs."""
    return tuple((0, int(part)) if part.isdigit() else (1, part)
                 for part in re.split(r"(\d+)", kp.id))


@lru_cache(maxsize=1)
def _seed_kp_names() -> dict[str, str]:
    path = Path(__file__).resolve().parent.parent / "seed" / "knowledge_points.json"
    if not path.exists():
        return {}
    try:
        rows = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return {
        str(row.get("id")): str(row.get("name")).strip()
        for row in rows
        if row.get("id") and row.get("name")
    }


def _has_chinese(text: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", text))


def canonical_kp_name(kp_id: str, current_name: str | None = None) -> str:
    """Return the display name for a knowledge point, falling back to curated names."""
    if current_name and current_name != kp_id and _has_chinese(current_name):
        return current_name
    curated_name = CANONICAL_KP_NAMES.get(kp_id) or _seed_kp_names().get(kp_id)
    if curated_name:
        return curated_name
    if current_name and current_name != kp_id:
        return current_name
    return kp_id


def practicable_kp_ids_query():
    """IDs of KPs that are the primary label of at least one approved question."""
    return (
        select(QuestionLabel.label_id)
        .join(Question, Question.id == QuestionLabel.question_id)
        .where(
            QuestionLabel.label_type == "knowledge_point",
            func.lower(func.trim(func.coalesce(QuestionLabel.role, ""))).in_(["primary", "主要"]),
            Question.quality_status == QualityStatus.approved,
        )
        .distinct()
    )


class KnowledgeService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_all_points(self) -> list[KnowledgePoint]:
        result = await self.db.execute(select(KnowledgePoint).order_by(KnowledgePoint.id))
        return sorted(result.scalars().all(), key=knowledge_point_order_key)

    async def get_practicable_points(self) -> list[KnowledgePoint]:
        """KPs students can actually practice: at least one approved question has them as primary.

        Very fine-grained KPs without such a question stay in the taxonomy (and in
        secondary labels) but are not offered to students, so they never open an
        empty practice or mastery assessment.
        """
        result = await self.db.execute(
            select(KnowledgePoint)
            .where(KnowledgePoint.id.in_(practicable_kp_ids_query()))
            .order_by(KnowledgePoint.id)
        )
        return list(result.scalars().all())

    async def get_practicable_point_ids(self) -> set[str]:
        return set((await self.db.scalars(practicable_kp_ids_query())).all())

    async def get_points_by_volume(self, volume: str) -> list[KnowledgePoint]:
        result = await self.db.execute(
            select(KnowledgePoint)
            .where(KnowledgePoint.volume == volume)
            .order_by(KnowledgePoint.id)
        )
        return list(result.scalars().all())

    async def get_point(self, kp_id: str) -> KnowledgePoint | None:
        return await self.db.get(KnowledgePoint, kp_id)

    async def get_points_by_chapter(self, chapter: str) -> list[KnowledgePoint]:
        result = await self.db.execute(
            select(KnowledgePoint)
            .where(KnowledgePoint.chapter == chapter)
            .order_by(KnowledgePoint.id)
        )
        return list(result.scalars().all())

    async def get_points_by_section(self, chapter: str, section: str) -> list[KnowledgePoint]:
        result = await self.db.execute(
            select(KnowledgePoint)
            .where(
                KnowledgePoint.chapter == chapter,
                KnowledgePoint.section == section,
            )
            .order_by(KnowledgePoint.id)
        )
        return list(result.scalars().all())

    async def create_point(self, data: dict) -> KnowledgePoint:
        kp = KnowledgePoint(**data)
        self.db.add(kp)
        await self.db.commit()
        await self.db.refresh(kp)
        return kp

    async def update_point(self, kp_id: str, data: dict) -> KnowledgePoint | None:
        kp = await self.get_point(kp_id)
        if not kp:
            return None
        for key, value in data.items():
            setattr(kp, key, value)
        await self.db.commit()
        await self.db.refresh(kp)
        return kp

    async def delete_point(self, kp_id: str) -> bool:
        kp = await self.get_point(kp_id)
        if not kp:
            return False
        await self.db.delete(kp)
        await self.db.commit()
        return True

    async def create_relation(self, source_id: str, target_id: str, rel_type: RelationType, reason: str | None = None) -> KnowledgeRelation:
        rel = KnowledgeRelation(source_id=source_id, target_id=target_id, relation_type=rel_type, reason=reason)
        self.db.add(rel)
        await self.db.commit()
        await self.db.refresh(rel)
        return rel

    async def get_relations(self, kp_id: str | None = None) -> list[KnowledgeRelation]:
        query = select(KnowledgeRelation)
        if kp_id:
            query = query.where(
                (KnowledgeRelation.source_id == kp_id) | (KnowledgeRelation.target_id == kp_id)
            )
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def delete_relation(self, rel_id: int) -> bool:
        rel = await self.db.get(KnowledgeRelation, rel_id)
        if not rel:
            return False
        await self.db.delete(rel)
        await self.db.commit()
        return True

    async def get_prerequisite_graph(self) -> dict[str, list[str]]:
        """Return adjacency list of prerequisite_of relations: {kp_id: [prereq_kp_ids]}"""
        result = await self.db.execute(
            select(KnowledgeRelation).where(KnowledgeRelation.relation_type == RelationType.prerequisite_of)
        )
        graph: dict[str, list[str]] = {}
        for rel in result.scalars().all():
            graph.setdefault(rel.target_id, []).append(rel.source_id)
        return graph
