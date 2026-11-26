import pytest

from app.models.student import Student
from app.models.student import StudentMastery
from app.services.admin_teaching_service import AdminTeachingService
from app.services.knowledge_service import KnowledgeService
from app.services.question_service import QuestionService
from app.services.student_service import StudentService


@pytest.mark.asyncio
async def test_teaching_dashboard_summarizes_class_weak_points_and_hot_mistakes(db_session):
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({
        "id": "teach_kp_force",
        "name": "受力分析",
        "volume": "必修一",
        "chapter": "第三章 相互作用",
        "section": "第1节 重力与弹力",
    })
    await kp_svc.create_point({
        "id": "teach_kp_motion",
        "name": "匀变速直线运动",
        "volume": "必修一",
        "chapter": "第二章 匀变速直线运动",
        "section": "第2节 速度与时间的关系",
    })

    q_svc = QuestionService(db_session)
    await q_svc.create_question({
        "id": "q_teach_force",
        "stem_text": "物块静止在斜面上，判断弹力和摩擦力方向。",
        "answer": "略",
        "explanation": "先明确研究对象，再分析接触面。",
        "question_type": "problem_solving",
        "difficulty_tier": "medium",
        "source": "human",
        "options": [],
        "labels": [
            {"label_type": "knowledge_point", "label_id": "teach_kp_force", "role": "主要"},
            {"label_type": "physics_model", "label_id": "force_analysis", "role": "主要"},
            {"label_type": "ability_dimension", "label_id": "analyze", "role": "主要"},
        ],
        "formulas": [],
        "images": [],
    })
    await q_svc.create_question({
        "id": "q_teach_motion",
        "stem_text": "小车做匀加速运动，求末速度。",
        "answer": "略",
        "explanation": "使用速度时间关系。",
        "question_type": "fill_in_blank",
        "difficulty_tier": "easy",
        "source": "human",
        "options": [],
        "labels": [
            {"label_type": "knowledge_point", "label_id": "teach_kp_motion", "role": "主要"},
            {"label_type": "physics_model", "label_id": "uniform_acceleration", "role": "主要"},
        ],
        "formulas": [],
        "images": [],
    })

    student_svc = StudentService(db_session)
    student_a = await student_svc.create_student("teach_a", "pass123", "teach_a", "高二1班")
    student_b = await student_svc.create_student("teach_b", "pass123", "teach_b", "高二1班")
    student_c = await student_svc.create_student("teach_c", "pass123", "teach_c", "高二2班")

    db_session.add_all([
        StudentMastery(
            student_id=student_a.id,
            knowledge_point_id="teach_kp_force",
            mastery=0.25,
            confidence=0.8,
            attempts=4,
            correct_rate=0.25,
        ),
        StudentMastery(
            student_id=student_b.id,
            knowledge_point_id="teach_kp_force",
            mastery=0.35,
            confidence=0.8,
            attempts=3,
            correct_rate=0.33,
        ),
        StudentMastery(
            student_id=student_a.id,
            knowledge_point_id="teach_kp_motion",
            mastery=0.82,
            confidence=0.7,
            attempts=5,
            correct_rate=0.8,
        ),
        StudentMastery(
            student_id=student_c.id,
            knowledge_point_id="teach_kp_force",
            mastery=0.1,
            confidence=0.8,
            attempts=2,
            correct_rate=0.0,
        ),
    ])
    await db_session.commit()

    await student_svc.record_answer(student_a.id, "q_teach_force", "漏掉摩擦力", False, 60000)
    await student_svc.record_answer(student_b.id, "q_teach_force", "弹力方向错误", False, 65000)
    await student_svc.record_answer(student_a.id, "q_teach_motion", "正确", True, 20000)
    await student_svc.record_answer(student_c.id, "q_teach_force", "外班错误", False, 60000)

    dashboard = await AdminTeachingService(db_session).build_dashboard(class_name="高二1班")

    assert dashboard["summary"]["student_count"] == 2
    assert dashboard["weak_points"][0]["kp_id"] == "teach_kp_force"
    assert dashboard["weak_points"][0]["weak_student_count"] == 2
    assert dashboard["weak_points"][0]["pending_mistake_count"] == 2
    assert dashboard["hot_mistakes"][0]["question_id"] == "q_teach_force"
    assert dashboard["hot_mistakes"][0]["wrong_count"] == 2
    assert dashboard["hot_mistakes"][0]["affected_student_count"] == 2
    assert dashboard["students"][0]["weak_chapters"][0]["chapter"] == "第三章 相互作用"


@pytest.mark.asyncio
async def test_teaching_dashboard_ignores_legacy_default_student_data(db_session):
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({
        "id": "teach_kp_legacy_default",
        "name": "历史默认学生测试知识点",
        "volume": "必修一",
        "chapter": "第一章 运动的描述",
        "section": "第1节 质点",
    })

    q_svc = QuestionService(db_session)
    await q_svc.create_question({
        "id": "q_teach_legacy_default",
        "stem_text": "历史默认学生错题不应进入教师统计。",
        "answer": "A",
        "explanation": "默认学生是早期占位账号。",
        "question_type": "single_choice",
        "difficulty_tier": "easy",
        "source": "human",
        "options": [],
        "labels": [
            {"label_type": "knowledge_point", "label_id": "teach_kp_legacy_default", "role": "主要"},
        ],
        "formulas": [],
        "images": [],
    })

    db_session.add(Student(
        id="default",
        username="default",
        password_hash="",
        display_name="默认学生",
        status="active",
    ))
    db_session.add(StudentMastery(
        student_id="default",
        knowledge_point_id="teach_kp_legacy_default",
        mastery=0.1,
        attempts=10,
        correct_rate=0.1,
    ))
    await db_session.commit()

    student_svc = StudentService(db_session)
    await student_svc.record_answer("default", "q_teach_legacy_default", "B", False, 1000)

    dashboard = await AdminTeachingService(db_session).build_dashboard()

    assert dashboard["summary"]["student_count"] == 0
    assert dashboard["summary"]["pending_mistake_count"] == 0
    assert dashboard["summary"]["avg_mastery"] == 0.0
    assert dashboard["classes"] == []
    assert dashboard["students"] == []
    assert dashboard["weak_points"] == []
    assert dashboard["hot_mistakes"] == []


@pytest.mark.asyncio
async def test_teaching_dashboard_unassigned_button_selects_students_without_class(db_session):
    student_svc = StudentService(db_session)
    await student_svc.create_student("no_class_a", "pass123", "no_class_a")
    await student_svc.create_student("no_class_b", "pass123", "no_class_b", "")
    await student_svc.create_student("in_class", "pass123", "in_class", "高一3班")

    service = AdminTeachingService(db_session)
    overview = await service.build_dashboard()
    unassigned = next(row for row in overview["classes"] if row["class_name"] == "未分班")
    dashboard = await service.build_dashboard(class_name=unassigned["class_name"])

    assert unassigned["student_count"] == 2
    assert dashboard["summary"]["student_count"] == 2
    assert {row["username"] for row in dashboard["students"]} == {"no_class_a", "no_class_b"}


@pytest.mark.asyncio
async def test_content_insights_leave_out_internal_accounts_and_flag_questions_nearly_everyone_misses(db_session):
    from app.models.teacher import TeacherClassMember
    from app.services.admin_content_insights_service import AdminContentInsightsService
    from app.services.teacher_service import TeacherService

    await KnowledgeService(db_session).create_point({"id": "ins_kp", "name": "受力分析", "volume": "必修一",
                                                     "chapter": "第三章 相互作用", "section": "重力与弹力"})
    q_svc = QuestionService(db_session)
    for qid in ("q_ins_hard", "q_ins_ok"):
        await q_svc.create_question({"id": qid, "stem_text": f"{qid} 题干", "answer": "A", "explanation": "略",
                                     "question_type": "single_choice", "difficulty_tier": "medium", "source": "human",
                                     "options": [], "labels": [{"label_type": "knowledge_point", "label_id": "ins_kp", "role": "主要"}],
                                     "formulas": [], "images": []})
    students = StudentService(db_session)
    learners = [await students.create_student(f"ins_{i}", "pass123", f"学生{i}", "高一1班") for i in range(5)]
    tester = await students.create_student("ins_review", "pass123", "审核员", "平台审核账号")
    for index, learner in enumerate(learners):
        db_session.add(StudentMastery(student_id=learner.id, knowledge_point_id="ins_kp",
                                      mastery=0.3 if index < 3 else 0.9, attempts=3))
        await students.record_answer(learner.id, "q_ins_hard", "B", False, 30000)
        await students.record_answer(learner.id, "q_ins_ok", "A", index != 0, 30000)
    db_session.add(StudentMastery(student_id=tester.id, knowledge_point_id="ins_kp", mastery=0.0, attempts=9))
    await students.record_answer(tester.id, "q_ins_ok", "B", False, 1000)
    await db_session.commit()

    insights = await AdminContentInsightsService(db_session).build()
    assert insights["summary"]["student_count"] == 5  # the review account is left out
    assert insights["summary"]["active_students"] == 5 and insights["summary"]["to_correct"] == 6
    point = insights["weak_points"][0]
    assert (point["kp_id"], point["weak_students"], point["evidence_students"]) == ("ins_kp", 3, 5)
    hard, ok = insights["hot_mistakes"]
    assert hard["question_id"] == "q_ins_hard" and hard["wrong_rate"] == 1.0 and hard["suspect"] is True
    assert ok["question_id"] == "q_ins_ok" and ok["wrong_students"] == 1 and ok["suspect"] is False
    assert insights["summary"]["suspect_questions"] == 1

    with_tester = await AdminContentInsightsService(db_session).build(include_internal=True)
    assert with_tester["summary"]["student_count"] == 6
    assert with_tester["weak_points"][0]["weak_students"] == 4

    teachers = TeacherService(db_session)
    teacher = await teachers.create_teacher("ins_t", "李老师", "init2026pass")
    cls = await teachers.create_class(teacher.id, "高一(1)班")
    db_session.add(TeacherClassMember(class_id=cls.id, student_id=learners[0].id))
    await db_session.commit()
    one = await AdminContentInsightsService(db_session).build(class_id=cls.id)
    assert one["summary"]["student_count"] == 1 and one["hot_mistakes"][0]["wrong_students"] == 1
    assert {"id": cls.id, "name": "高一(1)班", "teacher_name": "李老师"} in await AdminContentInsightsService(db_session).classes()
