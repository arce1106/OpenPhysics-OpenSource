from datetime import date, datetime, timezone

import pytest
from sqlalchemy import func, select

from app.models import (
    Badge,
    ContentType,
    GrowthReport,
    KnowledgePoint,
    LearningContent,
    LearningEvent,
    LearningProgress,
    Quest,
    RewardRecord,
    StudentAnswer,
    StudentBadge,
    StudentScopeDiagnosticAttempt,
    StudentScopeDiagnosticKpResult,
    StudentImprovementPlan,
    StudentImprovementRetestAttempt,
    StudentImprovementTask,
    StudentMastery,
    StudentQuestProgress,
    StudentXp,
)
from app.services.question_service import QuestionService
from app.services.student_service import StudentService


@pytest.mark.asyncio
async def test_reset_student_account_clears_learning_profile_but_keeps_account(
    db_session,
    tmp_path,
):
    db_session.add(KnowledgePoint(id="kp_reset", name="重置测试知识点"))
    db_session.add(
        LearningContent(
            id="content_reset",
            knowledge_point_id="kp_reset",
            content_type=ContentType.card,
            title="学习卡片",
            body={"summary": "测试"},
        )
    )
    await db_session.commit()

    question_svc = QuestionService(db_session)
    await question_svc.create_question(
        {
            "id": "q_reset",
            "stem_text": "测试题",
            "answer": "A",
            "explanation": "解析",
            "question_type": "single_choice",
            "difficulty_tier": "easy",
            "source": "human",
            "options": [],
            "labels": [],
            "formulas": [],
            "images": [],
        }
    )

    student_svc = StudentService(db_session)
    student = await student_svc.create_student("reset_user", "pass123", "reset_user", "高二1班")
    student.last_login_at = datetime.now(timezone.utc)
    db_session.add_all(
        [
            StudentMastery(
                student_id=student.id,
                knowledge_point_id="kp_reset",
                mastery=0.8,
                attempts=3,
                correct_rate=0.67,
            ),
            LearningProgress(
                student_id=student.id,
                knowledge_point_id="kp_reset",
                content_id="content_reset",
                content_type=ContentType.card,
                time_spent_seconds=120,
            ),
            LearningEvent(
                id="event_reset",
                student_id=student.id,
                event_type="answer_submitted",
                question_id="q_reset",
                knowledge_point_id="kp_reset",
                payload={"correct": False},
            ),
            StudentXp(
                student_id=student.id,
                total_xp=120,
                level=2,
                energy=18,
                streak_days=4,
                last_activity_date=date.today(),
            ),
            RewardRecord(
                id="reward_reset",
                student_id=student.id,
                event_id="event_reset",
                reward_type="xp",
                reward_value=10,
                reason="测试",
            ),
            Badge(id="badge_reset", name="徽章", badge_type="test"),
            StudentBadge(student_id=student.id, badge_id="badge_reset", evidence={"ok": True}),
            Quest(id="quest_reset", title="任务", quest_type="daily", active=True),
            StudentQuestProgress(
                student_id=student.id,
                quest_id="quest_reset",
                progress={"done": 1},
                status="active",
            ),
            GrowthReport(
                id="growth_reset",
                student_id=student.id,
                report_type="weekly",
                metrics={"score": 90},
            ),
            StudentScopeDiagnosticAttempt(
                id="scope_attempt_reset",
                student_id=student.id,
                scope_type="chapter",
                scope_id="第一章 运动的描述",
                scope_name="第一章 运动的描述",
                question_ids=["q_reset"],
                answer_ids=[1],
                result={"scope_id": "第一章 运动的描述"},
                correct_count=0,
                total_count=1,
                weak_count=1,
                weak_kp_ids=["kp_reset"],
                recommendation="study",
                feedback="测试检测历史",
            ),
            StudentScopeDiagnosticKpResult(
                id="scope_kp_result_reset",
                attempt_id="scope_attempt_reset",
                student_id=student.id,
                kp_id="kp_reset",
                kp_name="重置测试知识点",
                correct_count=0,
                total_count=1,
                mastery_before=0.1,
                mastery_after=0.2,
                is_weak=True,
            ),
            StudentImprovementPlan(
                id="plan_reset",
                student_id=student.id,
                scope_type="chapter",
                scope_id="第一章 运动的描述",
                scope_name="第一章 运动的描述",
                status="in_progress",
                current_task_id="task_reset",
                correct_count=0,
                total_count=1,
                weak_count=1,
                source_result={"scope_id": "第一章 运动的描述"},
            ),
            StudentImprovementTask(
                id="task_reset",
                plan_id="plan_reset",
                student_id=student.id,
                kp_id="kp_reset",
                kp_name="重置测试知识点",
                correct_count=0,
                total_count=1,
                mastery_before=0.1,
                mastery_after=0.2,
                is_weak=True,
                priority=1,
                status="pending",
                recommended_action="practice",
                reason="测试清理",
            ),
            StudentImprovementRetestAttempt(
                id="attempt_reset",
                plan_id="plan_reset",
                student_id=student.id,
                status="in_progress",
                question_ids=["q_reset"],
                correct_count=0,
                total_count=1,
            ),
        ]
    )
    await db_session.commit()
    await student_svc.record_answer(student.id, "q_reset", "B", False, 1000)

    upload_root = tmp_path / "answers"
    student_upload_dir = upload_root / student.id
    student_upload_dir.mkdir(parents=True)
    (student_upload_dir / "paper.png").write_bytes(b"fake image")

    result = await StudentService(db_session, answer_upload_root=upload_root).reset_student_account(student.id)

    assert result is not None
    reset_student = result["student"]
    assert reset_student.id == student.id
    assert reset_student.username == "reset_user"
    assert reset_student.class_name == "高二1班"
    assert StudentService.verify_password("pass123", reset_student.password_hash)
    assert reset_student.last_login_at is None
    assert result["deleted"]["student_answers"] == 1
    assert result["deleted"]["student_mastery"] == 1
    assert result["deleted"]["learning_progress"] == 1
    assert result["deleted"]["learning_events"] == 1
    assert result["deleted"]["student_xp"] == 1
    assert result["deleted"]["reward_records"] == 1
    assert result["deleted"]["student_badges"] == 1
    assert result["deleted"]["student_quest_progress"] == 1
    assert result["deleted"]["growth_reports"] == 1
    assert result["deleted"]["student_improvement_retest_attempts"] == 1
    assert result["deleted"]["student_improvement_tasks"] == 1
    assert result["deleted"]["student_improvement_plans"] == 1
    assert result["deleted"]["student_scope_diagnostic_kp_results"] == 1
    assert result["deleted"]["student_scope_diagnostic_attempts"] == 1

    for model in (
        StudentAnswer,
        StudentMastery,
        LearningProgress,
        LearningEvent,
        StudentXp,
        RewardRecord,
        StudentBadge,
        StudentQuestProgress,
        GrowthReport,
        StudentImprovementRetestAttempt,
        StudentImprovementTask,
        StudentImprovementPlan,
        StudentScopeDiagnosticKpResult,
        StudentScopeDiagnosticAttempt,
    ):
        remaining = await db_session.scalar(
            select(func.count()).select_from(model).where(model.student_id == student.id)
        )
        assert remaining == 0

    assert not student_upload_dir.exists()
