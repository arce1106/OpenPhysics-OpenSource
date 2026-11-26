import uuid
from datetime import datetime, timezone, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from app.models.reward import (
    LearningEvent,
    StudentXp,
    RewardRecord,
    StudentBadge,
)
from app.models.student import StudentAnswer, StudentMastery
from app.services.learning_state_rules import (
    REINFORCEMENT_THRESHOLD,
    STABLE_MASTERY_THRESHOLD,
)
from app.services.teacher_paper_results import answered_in_app


# XP base values per event type (from design doc)
EVENT_XP = {
    "question_answered": 5,
    "question_corrected": 15,
    "misconception_fixed": 10,
    "knowledge_mastered": 30,
    "lesson_completed": 5,
    "challenge_completed": 50,
    "daily_goal_completed": 20,
    "reflection_submitted": 10,
}

# Difficulty multiplier
DIFFICULTY_FACTOR = {1: 1.0, 2: 1.2, 3: 1.5, 4: 1.8, 5: 2.0}

# Learning value multiplier
LEARNING_VALUE = {
    "weak_point": 1.6,
    "new_knowledge": 1.3,
    "review": 1.1,
    "mastered": 0.4,
}

# Level thresholds
LEVEL_THRESHOLDS = [0, 100, 300, 600, 1000, 1500, 2500, 4000]

LEVEL_NAMES = [
    "物理新手",
    "运动观察者",
    "加速度掌握者",
    "受力分析师",
    "牛顿定律实践者",
    "力学建模者",
    "物理学者",
    "物理先驱",
]


def level_name(level: int) -> str:
    if level < 1:
        return LEVEL_NAMES[0]
    if level > len(LEVEL_NAMES):
        return LEVEL_NAMES[-1]
    return LEVEL_NAMES[level - 1]


def xp_for_next_level(level: int) -> int:
    if level < 1 or level > len(LEVEL_THRESHOLDS):
        return 0
    return LEVEL_THRESHOLDS[min(level, len(LEVEL_THRESHOLDS) - 1)]


class RewardService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def record_event(
        self,
        student_id: str,
        event_type: str,
        question_id: str | None = None,
        knowledge_point_id: str | None = None,
        payload: dict | None = None,
    ) -> tuple[dict, list[dict]]:
        """Record a learning event and calculate rewards. Returns (event_dict, unlocked_badges)."""
        event_id = f"evt_{uuid.uuid4().hex[:12]}"
        event = LearningEvent(
            id=event_id,
            student_id=student_id,
            event_type=event_type,
            question_id=question_id,
            knowledge_point_id=knowledge_point_id,
            payload=payload or {},
        )
        self.db.add(event)

        xp = await self._calculate_xp(student_id, event_type, payload or {})
        unlocked_badges: list[dict] = []
        leveled_up = False
        new_level = 0
        new_level_name = ""

        if xp > 0:
            leveled_up, new_level, new_level_name = await self._grant_xp(
                student_id, xp, event_id, event_type, f"完成{event_type}"
            )
            unlocked = await self._check_badges(student_id, event_type, payload or {})
            unlocked_badges.extend(unlocked)

        await self.db.commit()
        return {
            "event_id": event_id,
            "event_type": event_type,
            "xp_awarded": xp,
            "unlocked_badges": unlocked_badges,
            "leveled_up": leveled_up,
            "new_level": new_level,
            "new_level_name": new_level_name,
        }, unlocked_badges

    async def _calculate_xp(
        self, student_id: str, event_type: str, payload: dict
    ) -> int:
        base = EVENT_XP.get(event_type, 5)

        # Difficulty factor from payload
        difficulty = payload.get("difficulty", 3)
        diff_factor = DIFFICULTY_FACTOR.get(difficulty, 1.0)

        # Learning value factor based on mastery state
        kp_id = payload.get("knowledge_point_id")
        learning_factor = 1.0
        if kp_id:
            result = await self.db.execute(
                select(StudentMastery).where(
                    StudentMastery.student_id == student_id,
                    StudentMastery.knowledge_point_id == kp_id,
                )
            )
            mastery = result.scalar_one_or_none()
            if mastery:
                if mastery.mastery < REINFORCEMENT_THRESHOLD:
                    learning_factor = LEARNING_VALUE["weak_point"]
                elif mastery.mastery < STABLE_MASTERY_THRESHOLD:
                    learning_factor = LEARNING_VALUE["review"]
                else:
                    learning_factor = LEARNING_VALUE["mastered"]
            else:
                learning_factor = LEARNING_VALUE["new_knowledge"]

        # Anti-grinding / anti-gaming checks
        anti_grinding = 1.0
        if kp_id and event_type == "question_answered":
            seven_days_ago = datetime.now(timezone.utc) - timedelta(days=7)

            # Fast-guess detection: answer under 2s with correct result is suspicious
            time_sec = payload.get("time_spent_sec", 30)
            if time_sec < 2 and payload.get("is_correct"):
                anti_grinding = 0.3

            # Per-KP grinding: >30 answers on same KP this week with >90% correct
            result = await self.db.execute(
                select(func.count(StudentAnswer.id)).where(
                    StudentAnswer.student_id == student_id,
                    StudentAnswer.created_at >= seven_days_ago,
                    answered_in_app(),
                )
            )
            weekly_answers = result.scalar() or 0

            # Global volume check
            if weekly_answers > 100 and payload.get("is_correct"):
                result = await self.db.execute(
                    select(func.count(StudentAnswer.id)).where(
                        StudentAnswer.student_id == student_id,
                        StudentAnswer.is_correct == True,
                        StudentAnswer.created_at >= seven_days_ago,
                        answered_in_app(),
                    )
                )
                weekly_correct = result.scalar() or 0
                if weekly_correct / weekly_answers > 0.9:
                    anti_grinding = min(anti_grinding, 0.5)

            # Per-KP check: detect grinding a single mastered KP
            if payload.get("is_correct") and weekly_answers > 30:
                result = await self.db.execute(
                    select(func.count(LearningEvent.id)).where(
                        LearningEvent.student_id == student_id,
                        LearningEvent.knowledge_point_id == kp_id,
                        LearningEvent.event_type == "question_answered",
                        LearningEvent.created_at >= seven_days_ago,
                    )
                )
                kp_weekly = result.scalar() or 0
                if kp_weekly > 30:
                    anti_grinding = min(anti_grinding, 0.4)

        xp = int(base * diff_factor * learning_factor * anti_grinding)
        return max(1, xp)

    async def _grant_xp(
        self,
        student_id: str,
        xp: int,
        event_id: str,
        reward_type: str,
        reason: str,
    ) -> tuple[bool, int, str]:
        """Grant XP and return (leveled_up, new_level, new_level_name)."""
        student_xp = await self._get_or_create_student_xp(student_id, initial_energy=3)

        old_level = student_xp.level
        student_xp.total_xp += xp
        # Recalculate level
        new_level = 1
        for i, threshold in enumerate(LEVEL_THRESHOLDS):
            if student_xp.total_xp >= threshold:
                new_level = i + 1
        student_xp.level = new_level
        leveled_up = new_level > old_level

        # Energy: +5 on level up, capped at level*2
        if leveled_up:
            student_xp.energy = min(student_xp.energy + 5, new_level * 2)

        # Consume 1 energy per answer event (but not for passive events)
        if reward_type in ("question_answered", "question_corrected"):
            student_xp.energy = max(0, student_xp.energy - 1)

        # Update streak
        await self._update_streak(student_xp)

        # Record reward
        record = RewardRecord(
            id=f"rwd_{uuid.uuid4().hex[:12]}",
            student_id=student_id,
            event_id=event_id,
            reward_type=reward_type,
            reward_value=xp,
            reason=reason,
        )
        self.db.add(record)

        return leveled_up, new_level, level_name(new_level)

    async def _get_or_create_student_xp(self, student_id: str, initial_energy: int = 0) -> StudentXp:
        stmt = (
            pg_insert(StudentXp)
            .values(
                student_id=student_id,
                total_xp=0,
                level=1,
                energy=initial_energy,
                streak_days=0,
            )
            .on_conflict_do_nothing(index_elements=[StudentXp.student_id])
        )
        await self.db.execute(stmt)
        result = await self.db.execute(select(StudentXp).where(StudentXp.student_id == student_id))
        xp = result.scalar_one_or_none()
        if not xp:
            raise RuntimeError(f"Failed to load XP status for student={student_id}")
        return xp

    async def _update_streak(self, student_xp: StudentXp) -> None:
        """Update consecutive learning days streak."""
        today = datetime.now(timezone.utc).date()
        last = student_xp.last_activity_date

        if last is None:
            student_xp.streak_days = 1
        elif last == today:
            pass  # already counted today
        elif last == today - timedelta(days=1):
            student_xp.streak_days += 1
        else:
            student_xp.streak_days = 1

        student_xp.last_activity_date = today

    async def _check_badges(
        self, student_id: str, event_type: str, payload: dict
    ) -> list[dict]:
        """Check badge conditions and award any newly earned ones. Returns list of {id, name}."""
        from app.models.reward import Badge as BadgeModel

        result = await self.db.execute(select(BadgeModel))
        all_badges = result.scalars().all()
        if not all_badges:
            return []

        result = await self.db.execute(
            select(StudentBadge.badge_id).where(
                StudentBadge.student_id == student_id
            )
        )
        earned_ids = {r[0] for r in result.all()}

        newly_unlocked: list[dict] = []
        for badge in all_badges:
            if badge.id in earned_ids:
                continue
            condition = badge.condition or {}
            if await self._match_condition(student_id, condition, event_type, payload):
                student_badge = StudentBadge(
                    student_id=student_id,
                    badge_id=badge.id,
                    evidence={"trigger_event": event_type, **payload},
                )
                self.db.add(student_badge)
                newly_unlocked.append({"id": badge.id, "name": badge.name, "badge_type": badge.badge_type})

        return newly_unlocked

    async def _match_condition(
        self,
        student_id: str,
        condition: dict,
        event_type: str,
        payload: dict,
    ) -> bool:
        """Check if a badge condition matches."""
        cond_type = condition.get("type", "")
        threshold = condition.get("threshold", 0)

        if cond_type == "event_count" and condition.get("event") == event_type:
            # Count events of this type for this student
            query = select(func.count(LearningEvent.id)).where(
                LearningEvent.student_id == student_id,
                LearningEvent.event_type == event_type,
            )
            kp_filter = condition.get("kp_contains")
            if kp_filter:
                query = query.where(LearningEvent.knowledge_point_id.contains(kp_filter))
            result = await self.db.execute(query)
            count = result.scalar() or 0
            # speed_bonus: check answer was fast and correct
            if condition.get("speed_bonus"):
                time_sec = payload.get("time_spent_sec", 999999)
                return payload.get("is_correct") and time_sec < 30 and count >= threshold
            return count >= threshold

        if cond_type == "mastery_increase":
            kp_id = condition.get("kp_id")
            if kp_id and payload.get("knowledge_point_id") == kp_id:
                before = payload.get("mastery_before", 0)
                after = payload.get("mastery_after", 0)
                return before < threshold / 100 <= after

        if cond_type == "misconception_fixed":
            return event_type == "misconception_fixed" and payload.get(
                "misconception_name"
            ) == condition.get("misconception_name")

        if cond_type == "streak_days":
            return event_type == "daily_goal_completed" and payload.get("streak", 0) >= threshold

        return False

    async def ensure_student_xp(self, student_id: str) -> StudentXp:
        return await self._get_or_create_student_xp(student_id, initial_energy=0)

    async def get_xp_status(self, student_id: str) -> dict:
        xp = await self.ensure_student_xp(student_id)

        # Daily energy recovery: reset to max if last activity was before today
        today = datetime.now(timezone.utc).date()
        max_energy = xp.level * 2
        if xp.last_activity_date and xp.last_activity_date < today:
            xp.energy = max_energy
            await self.db.flush()

        return {
            "total_xp": xp.total_xp,
            "level": xp.level,
            "level_name": level_name(xp.level),
            "xp_for_next_level": xp_for_next_level(xp.level),
            "energy": xp.energy,
            "streak_days": xp.streak_days,
        }

    async def get_badges(self, student_id: str) -> list[dict]:
        from app.models.reward import Badge as BadgeModel

        result = await self.db.execute(
            select(BadgeModel, StudentBadge).outerjoin(
                StudentBadge,
                (StudentBadge.badge_id == BadgeModel.id)
                & (StudentBadge.student_id == student_id),
            )
        )
        rows = result.all()
        return [
            {
                "id": badge.id,
                "name": badge.name,
                "description": badge.description,
                "badge_type": badge.badge_type,
                "icon_url": badge.icon_url,
                "earned": sb is not None,
                "earned_at": sb.earned_at.isoformat() if sb and sb.earned_at else None,
            }
            for badge, sb in rows
        ]

    async def get_reward_history(
        self, student_id: str, limit: int = 20
    ) -> list[dict]:
        result = await self.db.execute(
            select(RewardRecord)
            .where(RewardRecord.student_id == student_id)
            .order_by(RewardRecord.created_at.desc())
            .limit(limit)
        )
        records = result.scalars().all()
        return [
            {
                "id": r.id,
                "reward_type": r.reward_type,
                "reward_value": r.reward_value,
                "reason": r.reason,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in records
        ]

    async def generate_encouragement(
        self, student_id: str, event_type: str, payload: dict
    ) -> str:
        """Generate a personalized encouragement message."""
        xp_status = await self.get_xp_status(student_id)
        is_correct = payload.get("is_correct", False)

        if event_type == "question_answered":
            if is_correct:
                kp_name = payload.get("kp_name", "")
                if kp_name:
                    return f"很好，这道题说明你已经能正确运用「{kp_name}」的知识了。"
                return f"答对了！你在物理上的进步很稳定。"
            else:
                return "这道题虽然没做对，但每次错误都是发现薄弱点的机会。继续加油！"

        if event_type == "question_corrected":
            return "你把之前的错误修正了，这比一次做对更能说明你在进步。"

        if event_type == "knowledge_mastered":
            kp_name = payload.get("kp_name", "")
            return f"恭喜！「{kp_name}」已经达到掌握水平，这是你努力的结果。"

        if event_type == "lesson_completed":
            return "完成了学习内容，这些基础概念会在解题时帮助你的。"

        if event_type == "misconception_fixed":
            return "你成功修正了一个常见误区。真正的进步不是不犯错，而是能把错误变成经验。"

        if event_type == "challenge_completed":
            return "你完成了一项挑战！困难是成长的阶梯。"

        if event_type == "daily_goal_completed":
            streak = xp_status.get("streak_days", 0)
            if streak >= 7:
                return f"连续{streak}天！你的坚持已经成为了习惯。"
            return "今日目标全部完成，积少成多，水滴石穿。"

        # Check milestone
        if xp_status["level"] > 1 and xp_status["total_xp"] % 100 < 20:
            return f"你已经达到 {xp_status['level_name']} 等级！继续挑战更高难度的题目吧。"

        return "坚持学习，每一步都在让你变得更强。"
