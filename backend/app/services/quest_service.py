import uuid
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.models.reward import Quest, StudentQuestProgress
from app.models.student import StudentMastery, StudentAnswer
from app.models.knowledge import KnowledgePoint


class QuestService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_or_generate_daily_quests(self, student_id: str) -> list[dict]:
        """Get active daily quests, generating new ones if needed."""
        today = datetime.now(timezone.utc).date()

        # Check existing daily quests
        result = await self.db.execute(
            select(Quest, StudentQuestProgress)
            .outerjoin(
                StudentQuestProgress,
                (StudentQuestProgress.quest_id == Quest.id)
                & (StudentQuestProgress.student_id == student_id),
            )
            .where(Quest.quest_type == "daily", Quest.active == True)
        )
        rows = result.all()

        if rows:
            # Check if quests are from today
            first_progress = rows[0][1] if rows else None
            if first_progress and first_progress.started_at:
                quest_date = first_progress.started_at.date()
                if quest_date == today:
                    return [
                        {
                            "quest_id": q.id,
                            "title": q.title,
                            "description": q.description,
                            "target": q.target,
                            "reward": q.reward,
                            "status": sp.status if sp else "active",
                            "progress": sp.progress if sp else {"current": 0, "total": 1},
                        }
                        for q, sp in rows
                    ]

        # Expire old daily quests and generate new ones
        if rows:
            for q, sp in rows:
                q.active = False
            await self.db.flush()

        return await self._generate_daily_quests(student_id)

    async def _generate_daily_quests(self, student_id: str) -> list[dict]:
        """Generate 2-3 daily quests based on student's weak knowledge points."""
        # Find weak KPs
        result = await self.db.execute(
            select(StudentMastery)
            .where(StudentMastery.student_id == student_id)
            .order_by(StudentMastery.mastery.asc())
            .limit(5)
        )
        weak_kps = result.scalars().all()

        # Resolve KP names
        kp_ids = [kp.knowledge_point_id for kp in weak_kps]
        kp_names: dict[str, str] = {}
        if kp_ids:
            result = await self.db.execute(
                select(KnowledgePoint.id, KnowledgePoint.name).where(
                    KnowledgePoint.id.in_(kp_ids)
                )
            )
            kp_names = {row[0]: row[1] for row in result.all()}

        # Count unreviewed mistakes
        result = await self.db.execute(
            select(func.count(StudentAnswer.id)).where(
                StudentAnswer.student_id == student_id,
                StudentAnswer.is_correct == False,
                StudentAnswer.reviewed_at == None,
            )
        )
        mistake_count = result.scalar() or 0

        quests_data = []

        # Quest 1: Practice a weak KP
        if weak_kps:
            kp = weak_kps[0]
            kp_name = kp_names.get(kp.knowledge_point_id, kp.knowledge_point_id)
            quest_id = f"q_daily_{uuid.uuid4().hex[:8]}"
            q = Quest(
                id=quest_id,
                title=f"练习「{kp_name}」基础题",
                description=f"完成3道「{kp_name}」相关基础题，当前掌握度 {int(kp.mastery * 100)}%",
                quest_type="daily",
                target={"kp_id": kp.knowledge_point_id, "count": 3, "type": "practice"},
                reward={"xp": 20},
            )
            self.db.add(q)
            sq = StudentQuestProgress(
                student_id=student_id,
                quest_id=quest_id,
                progress={"current": 0, "total": 3, "kp_id": kp.knowledge_point_id},
                status="active",
                started_at=datetime.now(timezone.utc),
            )
            self.db.add(sq)
            quests_data.append({
                "quest_id": quest_id,
                "title": q.title,
                "description": q.description,
                "target": q.target,
                "reward": q.reward,
                "status": "active",
                "progress": {"current": 0, "total": 3},
            })

        # Quest 2: Fix mistakes
        if mistake_count > 0:
            quest_id = f"q_daily_{uuid.uuid4().hex[:8]}"
            target_count = min(2, mistake_count)
            q = Quest(
                id=quest_id,
                title="订正错题",
                description=f"订正{target_count}道错题，当前有{mistake_count}道待处理",
                quest_type="daily",
                target={"count": target_count, "type": "correct_mistakes"},
                reward={"xp": 15 * target_count},
            )
            self.db.add(q)
            sq = StudentQuestProgress(
                student_id=student_id,
                quest_id=quest_id,
                progress={"current": 0, "total": target_count},
                status="active",
                started_at=datetime.now(timezone.utc),
            )
            self.db.add(sq)
            quests_data.append({
                "quest_id": quest_id,
                "title": q.title,
                "description": q.description,
                "target": q.target,
                "reward": q.reward,
                "status": "active",
                "progress": {"current": 0, "total": target_count},
            })

        # Quest 3: Review learned KP
        if weak_kps and len(weak_kps) > 1:
            kp = weak_kps[1]
            kp_name = kp_names.get(kp.knowledge_point_id, kp.knowledge_point_id)
            quest_id = f"q_daily_{uuid.uuid4().hex[:8]}"
            q = Quest(
                id=quest_id,
                title=f"复习「{kp_name}」",
                description=f"学习「{kp_name}」的知识卡片，巩固薄弱点",
                quest_type="daily",
                target={"kp_id": kp.knowledge_point_id, "type": "review_learn"},
                reward={"xp": 10},
            )
            self.db.add(q)
            sq = StudentQuestProgress(
                student_id=student_id,
                quest_id=quest_id,
                progress={"current": 0, "total": 1, "kp_id": kp.knowledge_point_id},
                status="active",
                started_at=datetime.now(timezone.utc),
            )
            self.db.add(sq)
            quests_data.append({
                "quest_id": quest_id,
                "title": q.title,
                "description": q.description,
                "target": q.target,
                "reward": q.reward,
                "status": "active",
                "progress": {"current": 0, "total": 1},
            })

        await self.db.flush()
        return quests_data

    async def update_quest_progress(
        self,
        student_id: str,
        kp_id: str | None = None,
        event_type: str | None = None,
    ) -> tuple[list[dict], bool]:
        """Update progress on active quests. Returns (completed_quests, all_daily_done)."""
        result = await self.db.execute(
            select(StudentQuestProgress, Quest)
            .join(Quest, StudentQuestProgress.quest_id == Quest.id)
            .where(
                StudentQuestProgress.student_id == student_id,
                StudentQuestProgress.status == "active",
                Quest.quest_type == "daily",
            )
        )
        rows = result.all()

        completed: list[dict] = []
        for sq, q in rows:
            progress = sq.progress or {"current": 0, "total": 1}
            target = q.target or {}

            if target.get("type") == "practice" and kp_id == target.get("kp_id"):
                progress["current"] = min(progress.get("current", 0) + 1, progress.get("total", 1))
            elif target.get("type") == "correct_mistakes" and event_type == "question_corrected":
                progress["current"] = min(progress.get("current", 0) + 1, progress.get("total", 1))
            elif target.get("type") == "review_learn" and event_type == "lesson_completed":
                progress["current"] = min(progress.get("current", 0) + 1, progress.get("total", 1))

            sq.progress = progress

            if progress["current"] >= progress["total"]:
                sq.status = "completed"
                sq.completed_at = datetime.now(timezone.utc)
                completed.append({
                    "quest_id": q.id,
                    "title": q.title,
                    "reward": q.reward,
                })

        await self.db.flush()

        # Check if all daily quests are now completed
        all_daily_done = False
        if rows:
            # Re-check active quests for this student
            result2 = await self.db.execute(
                select(StudentQuestProgress).where(
                    StudentQuestProgress.student_id == student_id,
                    StudentQuestProgress.status == "active",
                )
            )
            all_daily_done = len(result2.all()) == 0

        return completed, all_daily_done
