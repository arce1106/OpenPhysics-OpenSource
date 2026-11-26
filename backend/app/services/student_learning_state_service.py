from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.knowledge import RelationType
from app.models.learning import ContentType, LearningContent, LearningProgress
from app.services.knowledge_service import KnowledgeService, canonical_kp_name
from app.services.learning_state_rules import (
    REINFORCEMENT_THRESHOLD,
    build_learning_state_stats,
    classify_learning_state,
)
from app.services.learning_path_service import LearningPathService
from app.services.student_service import StudentService


class StudentLearningStateService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.knowledge_svc = KnowledgeService(db)
        self.student_svc = StudentService(db)
        self.learning_path_svc = LearningPathService(db)

    async def build_directory_context(self, student_id: str) -> dict:
        """Show the whole taxonomy without adding empty points to learning recommendations."""
        context = await self.build_context(student_id)
        states = context["state_map"]
        all_kps = await self.knowledge_svc.get_all_points()
        card_ids = set((await self.db.scalars(
            select(LearningContent.knowledge_point_id)
            .where(LearningContent.content_type == ContentType.card).distinct()
        )).all())
        mastery_map = {m.knowledge_point_id: m for m in context["mastery_list"]}
        directory_states = []
        for kp in all_kps:
            if kp.id in states:
                directory_states.append({**states[kp.id], "content_available": True, "practice_available": True})
                continue
            mastery = mastery_map.get(kp.id)
            content_available = kp.id in card_ids
            state = classify_learning_state(
                status="needs_learning", mastery=mastery.mastery if mastery else 0.0,
                attempts=mastery.attempts if mastery else 0,
            ) if content_available else {"state": "pending_content", "label": "内容待补充", "tone": "locked"}
            directory_states.append({
                "kp_id": kp.id, "kp_name": canonical_kp_name(kp.id, kp.name), "kp": kp,
                "volume": kp.volume, "chapter": kp.chapter, "section": kp.section,
                "mastery": mastery.mastery if mastery else 0.0,
                "attempts": mastery.attempts if mastery else 0,
                "status": "needs_learning" if content_available else "pending_content",
                "blocked_by": [], "last_practiced": mastery.last_practiced if mastery else None,
                "has_learning_progress": False, "learning_state": state["state"],
                "learning_state_label": state["label"], "learning_state_tone": state["tone"],
                "content_available": content_available, "practice_available": False,
            })
        return {**context, "all_kps": all_kps, "states": directory_states,
                "state_map": {s["kp_id"]: s for s in directory_states},
                "stats": build_learning_state_stats(directory_states)}

    async def build_context(
        self,
        student_id: str,
        all_kps=None,
        all_relations=None,
        mastery_list=None,
    ) -> dict:
        if all_kps is None:
            all_kps = await self.knowledge_svc.get_practicable_points()
        if all_relations is None:
            all_relations = await self.knowledge_svc.get_relations()
        if mastery_list is None:
            mastery_list = await self.student_svc.get_all_mastery(student_id)

        mastery_map = {m.knowledge_point_id: m for m in mastery_list}
        learning_progress_kp_ids = await self._learning_progress_kp_ids(student_id)
        prereq_graph = self._prereq_graph(all_relations)
        path = await self.learning_path_svc.generate_path(
            student_id,
            all_kps=all_kps,
            mastery_list=mastery_list,
            prereq_graph=prereq_graph,
        )
        stage_map = {stage["kp_id"]: stage for stage in path["stages"]}

        states = []
        for kp in all_kps:
            stage = stage_map.get(kp.id, {})
            mastery = mastery_map.get(kp.id)
            mastery_value = mastery.mastery if mastery else 0.0
            attempts = mastery.attempts if mastery else 0
            status = stage.get("status", "locked")
            state = classify_learning_state(
                status=status,
                mastery=mastery_value,
                attempts=attempts,
                has_learning_progress=kp.id in learning_progress_kp_ids,
            )
            states.append({
                "kp_id": kp.id,
                "kp_name": canonical_kp_name(kp.id, kp.name),
                "kp": kp,
                "volume": kp.volume,
                "chapter": kp.chapter,
                "section": kp.section,
                "mastery": mastery_value,
                "attempts": attempts,
                "status": status,
                "blocked_by": stage.get("blocked_by", []),
                "last_practiced": mastery.last_practiced if mastery else None,
                "has_learning_progress": kp.id in learning_progress_kp_ids,
                "learning_state": state["state"],
                "learning_state_label": state["label"],
                "learning_state_tone": state["tone"],
            })

        return {
            "student_id": student_id,
            "all_kps": all_kps,
            "all_relations": all_relations,
            "mastery_list": mastery_list,
            "path": path,
            "states": states,
            "state_map": {state["kp_id"]: state for state in states},
            "stats": build_learning_state_stats(states),
        }

    async def get_reinforcement_recommendations(
        self,
        student_id: str,
        limit: int = 5,
        context: dict | None = None,
    ) -> list[dict]:
        if context is None:
            context = await self.build_context(student_id)

        candidates = []
        for state in context["states"]:
            if state["learning_state"] != "practice" or state["status"] == "locked":
                continue
            reason = (
                "近期练习暴露薄弱，建议先修复"
                if state["mastery"] < REINFORCEMENT_THRESHOLD
                else "接近掌握，建议继续巩固到稳定"
            )
            candidates.append({
                "kp_id": state["kp_id"],
                "kp_name": state["kp_name"],
                "mastery": round(state["mastery"], 3),
                "reason": reason,
                "attempts": state["attempts"],
            })

        candidates.sort(key=lambda item: (item["mastery"], -item["attempts"], item["kp_id"]))
        return candidates[:limit]

    async def _learning_progress_kp_ids(self, student_id: str) -> set[str]:
        result = await self.db.execute(
            select(LearningProgress.knowledge_point_id)
            .where(LearningProgress.student_id == student_id)
            .distinct()
        )
        return set(result.scalars().all())

    @staticmethod
    def _prereq_graph(relations) -> dict[str, list[str]]:
        prereq_graph: dict[str, list[str]] = {}
        for rel in relations:
            if rel.relation_type == RelationType.prerequisite_of:
                prereq_graph.setdefault(rel.target_id, []).append(rel.source_id)
        return prereq_graph
