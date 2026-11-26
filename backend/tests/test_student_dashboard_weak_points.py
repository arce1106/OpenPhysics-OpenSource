from types import SimpleNamespace

import pytest

from app.services.learning_path_service import LearningPathService


class FakeStudentService:
    async def get_all_mastery(self, student_id):
        return [
            SimpleNamespace(knowledge_point_id="passive", attempts=0, mastery=0.2),
            SimpleNamespace(knowledge_point_id="attempted", attempts=2, mastery=0.2),
            SimpleNamespace(knowledge_point_id="mastered", attempts=2, mastery=0.82),
        ]


class FakeKnowledgeService:
    async def get_practicable_points(self):
        return await self.get_all_points()

    async def get_all_points(self):
        return [
            SimpleNamespace(id="passive", name="被动学习低掌握"),
            SimpleNamespace(id="attempted", name="已练习低掌握"),
            SimpleNamespace(id="mastered", name="已掌握"),
        ]

    async def get_prerequisite_graph(self):
        return {}


@pytest.mark.asyncio
async def test_reinforcement_weak_point_requires_practice_evidence():
    service = LearningPathService(db=None)
    service.student_svc = FakeStudentService()
    service.knowledge_svc = FakeKnowledgeService()

    recommendations = await service.get_reinforcement_recommendations("student")

    assert [item["kp_id"] for item in recommendations] == ["attempted"]
