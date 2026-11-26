import uuid
from datetime import datetime, timezone, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.models.knowledge import KnowledgePoint
from app.models.reward import GrowthReport, RewardRecord
from app.models.student import StudentMastery, StudentAnswer
from app.services.knowledge_service import canonical_kp_name
from app.services.learning_state_rules import (
    REINFORCEMENT_THRESHOLD,
    STABLE_MASTERY_THRESHOLD,
)
from app.services.teacher_paper_results import answered_in_app


class GrowthReportService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_latest_report(self, student_id: str) -> dict | None:
        result = await self.db.execute(
            select(GrowthReport)
            .where(GrowthReport.student_id == student_id)
            .order_by(GrowthReport.created_at.desc())
            .limit(1)
        )
        report = result.scalar_one_or_none()
        if not report:
            return None
        return {
            "id": report.id,
            "summary": report.summary,
            "metrics": report.metrics,
            "start_date": report.start_date.isoformat() if report.start_date else None,
            "end_date": report.end_date.isoformat() if report.end_date else None,
            "created_at": report.created_at.isoformat() if report.created_at else None,
        }

    async def generate_weekly_report(self, student_id: str, *, persist: bool = True) -> dict:
        """Calculate the report; live previews do not create saved reports."""
        now = datetime.now(timezone.utc)
        week_ago = now - timedelta(days=7)
        # Live previews use the same inclusive date window as answer history.
        if not persist:
            week_ago = week_ago.replace(hour=0, minute=0, second=0, microsecond=0)

        # Answers this week
        result = await self.db.execute(
            select(func.count(StudentAnswer.id)).where(
                StudentAnswer.student_id == student_id,
                StudentAnswer.created_at >= week_ago,
                answered_in_app(),
            )
        )
        total_answers = result.scalar() or 0

        result = await self.db.execute(
            select(func.count(StudentAnswer.id)).where(
                StudentAnswer.student_id == student_id,
                StudentAnswer.is_correct == True,
                StudentAnswer.created_at >= week_ago,
                answered_in_app(),
            )
        )
        correct_answers = result.scalar() or 0

        # Mistakes corrected this week
        result = await self.db.execute(
            select(func.count(StudentAnswer.id)).where(
                StudentAnswer.student_id == student_id,
                StudentAnswer.is_correct == False,
                StudentAnswer.reviewed_at >= week_ago,
            )
        )
        mistakes_corrected = result.scalar() or 0

        # XP earned this week
        result = await self.db.execute(
            select(func.sum(RewardRecord.reward_value)).where(
                RewardRecord.student_id == student_id,
                RewardRecord.created_at >= week_ago,
                RewardRecord.reward_type.in_([
                    "question_answered", "question_corrected",
                    "knowledge_mastered", "lesson_completed",
                    "misconception_fixed", "daily_goal_completed",
                ]),
            )
        )
        weekly_xp = result.scalar() or 0

        # Mastery changes
        result = await self.db.execute(
            select(StudentMastery)
            .where(StudentMastery.student_id == student_id)
            .order_by(StudentMastery.mastery.desc())
        )
        all_mastery = result.scalars().all()
        result = await self.db.execute(select(KnowledgePoint))
        kp_name_map = {kp.id: kp.name for kp in result.scalars().all()}

        def display_kp_name(kp_id: str) -> str:
            return canonical_kp_name(kp_id, kp_name_map.get(kp_id))

        improved = []
        weak = []
        for m in all_mastery:
            kp_name = display_kp_name(m.knowledge_point_id)
            if m.mastery >= STABLE_MASTERY_THRESHOLD:
                improved.append(kp_name)
            elif m.mastery < REINFORCEMENT_THRESHOLD:
                weak.append(kp_name)

        # Build summary
        correct_rate = f"{int(correct_answers / total_answers * 100)}%" if total_answers > 0 else "0%"
        # A week without answers has no accuracy; "正确率 0%" read as failing every question.
        summary_lines = [
            f"本周你完成了 {total_answers} 道题，正确率 {correct_rate}。" if total_answers > 0 else "本周还没有做题。",
        ]
        if mistakes_corrected > 0:
            summary_lines.append(f"订正了 {mistakes_corrected} 道错题。")
        if improved:
            summary_lines.append(f"目前已掌握的知识点包括：{'、'.join(improved[:5])}。")
        if weak:
            summary_lines.append(f"还需加强的知识点：{'、'.join(weak[:3])}。")
            summary_lines.append(f"下周建议：重点巩固 {'、'.join(weak[:2])} 的基础概念和典型题型。")

        summary = "\n".join(summary_lines)

        metrics = {
            "total_answers": total_answers,
            "correct_answers": correct_answers,
            "correct_rate": correct_rate,
            "mistakes_corrected": mistakes_corrected,
            "weekly_xp": weekly_xp,
            "mastered_kps": improved,
            "weak_kps": weak,
        }

        if not persist:
            return {
                "id": "current-week",
                "summary": summary,
                "metrics": metrics,
                "start_date": week_ago.date().isoformat(),
                "end_date": now.date().isoformat(),
            }

        # Save report only on the explicit generation route.
        report_id = f"rpt_{uuid.uuid4().hex[:12]}"
        report = GrowthReport(
            id=report_id,
            student_id=student_id,
            report_type="weekly",
            start_date=week_ago.date(),
            end_date=now.date(),
            summary=summary,
            metrics=metrics,
        )
        self.db.add(report)
        await self.db.flush()

        return {
            "id": report_id,
            "summary": summary,
            "metrics": metrics,
            "start_date": week_ago.date().isoformat(),
            "end_date": now.date().isoformat(),
        }
