"""Question recordings are reusable; an unfinished paper cannot unlock its answers."""

import asyncio

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models.question import Question, QuestionType
from app.models.learning_catalog import LearningCatalog, LearningCatalogNode, LearningCatalogNodeEvidence, LearningCatalogNodeKnowledgePoint
from app.models.question_video import QuestionVideo
from app.models.student import ItemStats, Student, StudentAnswer, StudentMastery
from app.models.teacher_paper import TeacherPaperAttempt
from app.services import teacher_paper_service as papers
from app.services.adaptive_service import AdaptiveService
from app.services.knowledge_service import KnowledgeService
from app.services.question_service import QuestionService


@pytest.mark.asyncio
async def test_video_permission_follows_the_owned_answer_not_only_the_question(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(papers, "MEDIA_DIR", tmp_path)
    (tmp_path / "lesson.mp4").write_bytes(b"private validated recording fixture")
    db_session.add_all([
        Student(id="video-student", username="video-student", password_hash="unused", display_name="测试学生"),
        Student(id="other-student", username="other-student", password_hash="unused", display_name="另一学生"),
        Question(id="video-question", stem_text="题目"), Question(id="other-question", stem_text="另一题"),
    ])
    await db_session.flush()
    attempt = TeacherPaperAttempt(
        id="video-attempt", student_id="video-student", paper_id="video-paper", catalog_code="gaokao_review",
        node_id="video-topic", title="套卷", question_ids=["video-question", "other-question"],
        questions=[{"id": "video-question"}, {"id": "other-question"}], status="grading",
    )
    db_session.add(attempt)
    db_session.add(QuestionVideo(id="lesson", question_id="video-question", title="讲解", filename="lesson.mp4",
                                 sha256="a" * 64, duration_seconds=10, status="approved"))
    await db_session.flush()
    ordinary = StudentAnswer(student_id="video-student", question_id="video-question", is_correct=False)
    unfinished = StudentAnswer(student_id="video-student", question_id="video-question", is_correct=False,
                               teacher_paper_attempt_id=attempt.id)
    another_student = StudentAnswer(student_id="other-student", question_id="video-question", is_correct=True)
    db_session.add_all([ordinary, unfinished, another_student])
    await db_session.commit()

    summaries = await papers.answer_video_summaries(db_session, [ordinary, unfinished])
    assert summaries[ordinary.id]["available"] is True
    assert summaries[unfinished.id]["available"] is False
    assert "整套" in summaries[unfinished.id]["locked_reason"]
    assert not {"filename", "video_url"} & summaries[ordinary.id].keys()

    allowed = await papers.question_video(db_session, "video-student", "video-question", ordinary.id)
    assert allowed["question_id"] == "video-question"
    for student_id, question_id, answer_id, expected in (
        ("video-student", "video-question", unfinished.id, 403),
        ("other-student", "video-question", unfinished.id, 404),
        ("video-student", "other-question", ordinary.id, 404),
        ("video-student", "video-question", another_student.id, 404),
    ):
        with pytest.raises(HTTPException) as error:
            await papers.question_video(db_session, student_id, question_id, answer_id)
        assert error.value.status_code == expected

    attempt.status = "completed"
    await db_session.commit()
    assert (await papers.answer_video_summaries(db_session, [unfinished]))[unfinished.id]["available"] is True
    assert (await papers.question_video(db_session, "video-student", "video-question", unfinished.id))["video_url"]
    video = (await papers.approved_videos(db_session, ["video-question"]))["video-question"]
    video.status = "draft"
    await db_session.commit()
    assert await papers.answer_video_summaries(db_session, [ordinary, unfinished]) == {}
    with pytest.raises(HTTPException) as unpublished:
        await papers.question_video(db_session, "video-student", "video-question", ordinary.id)
    assert unpublished.value.status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize("legacy_snapshot", [False, True])
async def test_concurrent_paper_submissions_share_one_answer_and_one_topic_evidence(db_session, legacy_snapshot):
    """Two devices can retry the same paper question under different request IDs."""
    student_id, qid, kp_id = "paper-race-student", "paper-race-question", "paper-race-kp"
    db_session.add(Student(id=student_id, username=student_id, password_hash="unused", display_name="测试学生"))
    await db_session.commit()
    await KnowledgeService(db_session).create_point({"id": kp_id, "name": "并发测试知识点"})
    db_session.add(LearningCatalog(id="paper-race-catalog", code="gaokao_review", name="高考复习"))
    await db_session.flush()
    db_session.add(LearningCatalogNode(id="paper-race-topic", catalog_id="paper-race-catalog",
                                     code="01", node_type="topic", title="并发测试专题"))
    await db_session.flush()
    db_session.add(LearningCatalogNodeKnowledgePoint(node_id="paper-race-topic", knowledge_point_id=kp_id))
    question = await QuestionService(db_session).create_question({
        "id": qid, "stem_text": "开卷时的题干", "answer": "A", "explanation": "开卷时的解析",
        "question_type": QuestionType.single_choice, "source": "human", "difficulty": 2.0,
        "options": [{"label": "A", "text": "原正确选项", "is_correct": True},
                    {"label": "B", "text": "原错误选项", "is_correct": False}],
        "labels": [{"label_type": "knowledge_point", "label_id": kp_id, "role": "主要"}],
    })
    snapshot = ({**AdaptiveService._serialize_question(question), "_answer": question.answer,
                 "_explanation": question.explanation} if legacy_snapshot else papers.question_snapshot(question))
    attempt = TeacherPaperAttempt(
        id="paper-race-attempt", student_id=student_id, paper_id="paper-race", catalog_code="gaokao_review",
        node_id="paper-race-topic", title="并发测试套卷", question_ids=[qid], questions=[snapshot], status="grading",
    )
    db_session.add(attempt)
    # Later question-bank maintenance must not silently change this opened paper.
    question.answer, question.stem_text, question.explanation = "B", "修改后的题干", "修改后的解析"
    question.question_type = QuestionType.problem_solving
    await db_session.commit()

    factory = async_sessionmaker(db_session.bind, expire_on_commit=False)
    first_reads_done = asyncio.Event()
    first_read_count = 0

    async def submit_from_device(request_id):
        nonlocal first_read_count
        async with factory() as independent_session:
            service = AdaptiveService(independent_session)
            real_lookup = service.student_svc.get_answer_by_submission
            first_lookup = True

            async def synchronized_lookup(*args, **kwargs):
                nonlocal first_lookup, first_read_count
                existing = await real_lookup(*args, **kwargs)
                if first_lookup:
                    first_lookup = False
                    assert existing is None
                    first_read_count += 1
                    if first_read_count == 2:
                        first_reads_done.set()
                    await first_reads_done.wait()
                return existing

            service.student_svc.get_answer_by_submission = synchronized_lookup
            return await service.submit_answer(student_id, qid, "B", submission_id=request_id,
                                               teacher_paper_attempt_id=attempt.id)

    first, second = await asyncio.wait_for(asyncio.gather(
        submit_from_device("device-one-request"), submit_from_device("device-two-request"),
    ), timeout=30)
    assert first["answer_id"] == second["answer_id"]
    assert {first["idempotent_replay"], second["idempotent_replay"]} == {False, True}
    assert first["is_correct"] is False and second["is_correct"] is False
    assert first["correct_answer"] == second["correct_answer"] == "A"
    assert first["explanation"] == second["explanation"] == "开卷时的解析"
    async with factory() as replay_session:
        replay = await AdaptiveService(replay_session).submit_answer(
            student_id, qid, "B", submission_id="later-retry-request", teacher_paper_attempt_id=attempt.id,
        )
    assert replay["answer_id"] == first["answer_id"] and replay["idempotent_replay"] is True
    assert await db_session.scalar(select(func.count()).select_from(StudentAnswer).where(
        StudentAnswer.teacher_paper_attempt_id == attempt.id, StudentAnswer.question_id == qid,
    )) == 1
    mastery = await db_session.get(StudentMastery, (student_id, kp_id))
    # A paper contributes topic evidence, never foundation mastery. Retries
    # across devices must still produce exactly one durable topic record.
    assert mastery is None
    assert first["mastery_update"] == second["mastery_update"] == replay["mastery_update"] == {}
    evidence = list(await db_session.scalars(select(LearningCatalogNodeEvidence).where(
        LearningCatalogNodeEvidence.student_id == student_id,
        LearningCatalogNodeEvidence.node_id == "paper-race-topic",
    )))
    assert len(evidence) == 1
    assert evidence[0].answer_id == first["answer_id"]
    assert evidence[0].knowledge_point_id == kp_id and evidence[0].layer == "paper"
    stats = await db_session.get(ItemStats, qid)
    assert stats is not None and stats.total_attempts == 1
    await db_session.refresh(attempt)
    assert attempt.status == "completed"
