from collections import deque
from sqlalchemy.ext.asyncio import AsyncSession
from app.services.knowledge_service import KnowledgeService, canonical_kp_name
from app.services.learning_state_rules import (
    REINFORCEMENT_THRESHOLD as LEARNING_REINFORCEMENT_THRESHOLD,
    STABLE_MASTERY_THRESHOLD as LEARNING_STABLE_MASTERY_THRESHOLD,
    classify_learning_state,
)
from app.services.student_service import StudentService


class LearningPathService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.knowledge_svc = KnowledgeService(db)
        self.student_svc = StudentService(db)

    STABLE_MASTERY_THRESHOLD = LEARNING_STABLE_MASTERY_THRESHOLD
    REINFORCEMENT_THRESHOLD = LEARNING_REINFORCEMENT_THRESHOLD

    async def generate_path(
        self,
        student_id: str,
        all_kps=None,
        mastery_list=None,
        prereq_graph: dict[str, list[str]] | None = None,
    ) -> dict:
        """Generate a full learning path for a student."""
        if all_kps is None:
            all_kps = await self.knowledge_svc.get_practicable_points()
        if prereq_graph is None:
            prereq_graph = await self.knowledge_svc.get_prerequisite_graph()
        if mastery_list is None:
            mastery_list = await self.student_svc.get_all_mastery(student_id)
        mastery_map = {m.knowledge_point_id: m.mastery for m in mastery_list}

        # Add all KPs to graph even if they have no prerequisites
        for kp in all_kps:
            if kp.id not in prereq_graph:
                prereq_graph[kp.id] = []

        # Topological sort
        in_degree: dict[str, int] = {kp.id: 0 for kp in all_kps}
        adj: dict[str, list[str]] = {kp.id: [] for kp in all_kps}
        for target, prereqs in prereq_graph.items():
            for prereq in prereqs:
                adj.setdefault(prereq, []).append(target)
                in_degree[target] = in_degree.get(target, 0) + 1

        queue = deque([kp_id for kp_id, deg in in_degree.items() if deg == 0])
        sorted_order = []
        while queue:
            node = queue.popleft()
            sorted_order.append(node)
            for neighbor in adj.get(node, []):
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        # Build stages with status coloring
        stages = []
        kp_map = {kp.id: kp for kp in all_kps}
        for kp_id in sorted_order:
            mastery = mastery_map.get(kp_id, 0.0)
            prereqs = prereq_graph.get(kp_id, [])
            all_prereqs_met = all(
                mastery_map.get(p, 0.0) >= self.STABLE_MASTERY_THRESHOLD
                for p in prereqs
            )

            if mastery >= self.STABLE_MASTERY_THRESHOLD:
                status = "mastered"
            elif not all_prereqs_met:
                status = "locked"
            elif mastery < self.REINFORCEMENT_THRESHOLD:
                status = "needs_learning"
            elif mastery < self.STABLE_MASTERY_THRESHOLD:
                status = "current"
            else:
                status = "upcoming"

            blocked_by = [
                p for p in prereqs
                if mastery_map.get(p, 0.0) < self.STABLE_MASTERY_THRESHOLD
            ]

            kp = kp_map.get(kp_id)
            stages.append({
                "kp_id": kp_id,
                "kp_name": canonical_kp_name(kp_id, kp.name if kp else None),
                "status": status,
                "mastery": round(mastery, 3),
                "blocked_by": blocked_by,
            })

        # Count stats
        mastered = sum(1 for s in stages if s["status"] == "mastered")
        remaining = sum(1 for s in stages if s["status"] != "mastered")
        estimated_hours = round(remaining * 0.5, 1)  # 0.5h per KP estimate

        return {
            "student_id": student_id,
            "stages": stages,
            "stats": {
                "total": len(stages),
                "mastered": mastered,
                "in_progress": sum(1 for s in stages if s["status"] in ("current", "needs_learning")),
                "locked": sum(1 for s in stages if s["status"] == "locked"),
                "remaining": remaining,
            },
            "estimated_hours": estimated_hours,
        }

    async def get_next_step(self, student_id: str) -> dict | None:
        """Get the next recommended knowledge point and suggested actions."""
        path = await self.generate_path(student_id)
        for stage in path["stages"]:
            if stage["status"] in ("needs_learning", "current"):
                suggestions = []
                mastery = stage["mastery"]
                if mastery < self.REINFORCEMENT_THRESHOLD:
                    suggestions = [
                        f"阅读 {stage['kp_name']} 的概念讲解",
                        f"完成3道基础练习",
                    ]
                else:
                    suggestions = [
                        f"完成5道 {stage['kp_name']} 的变式训练",
                        "回顾常见误区",
                    ]
                return {
                    "kp_id": stage["kp_id"],
                    "kp_name": stage["kp_name"],
                    "status": stage["status"],
                    "mastery": mastery,
                    "suggestions": suggestions,
                }
        # All mastered
        total = path["stats"]["total"]
        return {
            "kp_id": None,
            "kp_name": "全部完成",
            "status": "mastered",
            "mastery": 1.0,
            "suggestions": [f"你已掌握全部 {total} 个知识点！可以尝试综合测试"],
        }

    async def get_reinforcement_recommendations(
        self,
        student_id: str,
        limit: int = 5,
    ) -> list[dict]:
        """Recommend KPs for reinforcement from actual learning evidence.

        A zero-mastery KP with no student attempts means "not learned yet", not
        "weak point". Reinforcement should only surface KPs that have student
        mastery records produced by diagnosis/practice.
        """
        mastery_list = await self.student_svc.get_all_mastery(student_id)
        attempted_mastery = {
            mastery.knowledge_point_id: mastery
            for mastery in mastery_list
            if mastery.attempts > 0 and mastery.mastery < self.STABLE_MASTERY_THRESHOLD
        }
        if not attempted_mastery:
            return []

        path = await self.generate_path(student_id, mastery_list=mastery_list)
        stage_map = {stage["kp_id"]: stage for stage in path["stages"]}
        candidates = []
        for kp_id, mastery in attempted_mastery.items():
            stage = stage_map.get(kp_id)
            if not stage or stage["status"] == "locked":
                continue
            learning_state = classify_learning_state(
                status=stage["status"],
                mastery=mastery.mastery,
                attempts=mastery.attempts,
            )
            if learning_state["state"] != "practice":
                continue
            reason = (
                "近期练习暴露薄弱，建议先修复"
                if mastery.mastery < self.REINFORCEMENT_THRESHOLD
                else "接近掌握，建议继续巩固到稳定"
            )
            candidates.append({
                "kp_id": kp_id,
                "kp_name": stage["kp_name"],
                "mastery": round(mastery.mastery, 3),
                "reason": reason,
                "attempts": mastery.attempts,
            })

        candidates.sort(key=lambda item: (item["mastery"], -item["attempts"], item["kp_id"]))
        return candidates[:limit]

    async def get_stats(self, student_id: str) -> dict:
        """Get learning progress statistics."""
        path = await self.generate_path(student_id)
        return path["stats"]
