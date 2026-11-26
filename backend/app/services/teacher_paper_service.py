"""Teacher homework attempts, grading ownership and private lesson recordings."""

import json
import base64
import hashlib
import hmac
import time
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

from sqlalchemy import select
from fastapi import HTTPException
from app.models.teacher_paper import TeacherPaperAttempt
from app.services.question_video_service import approved_videos, approved_video_summaries
from app.core.config import settings
from app.models.student import StudentAnswer

MEDIA_DIR = Path(__file__).resolve().parents[2] / "static" / "uploads" / "question-videos"


def _sign(payload: dict) -> str:
    data = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")
    signature = hmac.new(settings.answer_image_signing_secret.encode(),
                         f"question-video-v1:{data}".encode(), hashlib.sha256).hexdigest()
    return f"{data}.{signature}"


def _verify(token: str, kind: str, *, allow_expired=False) -> dict:
    try:
        data, _signature = token.split(".")
        payload = json.loads(base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)))
        if not hmac.compare_digest(_sign(payload), token):
            raise ValueError()
        if payload["kind"] != kind or (not allow_expired and payload["expires"] < time.time()):
            raise ValueError()
        return payload
    except (ValueError, KeyError, TypeError):
        raise PermissionError("套卷观看凭证无效或已过期") from None


def resolve_video(token: str) -> Path:
    payload = _verify(token, "media")
    filename = payload["filename"]
    if Path(filename).name != filename or not filename.endswith(".mp4"):
        raise PermissionError("视频路径无效")
    path = MEDIA_DIR / filename
    if not path.is_file():
        raise FileNotFoundError("视频暂未准备好")
    return path


def attempt_summary(attempt: TeacherPaperAttempt, has_video=False) -> dict:
    return {"id": attempt.paper_id, "title": attempt.title,
            "question_count": len(attempt.question_ids), "has_video": has_video,
            "attempt_id": attempt.id, "status": attempt.status,
            "submitted_at": attempt.submitted_at.isoformat() if attempt.submitted_at else None,
            "completed_at": attempt.completed_at.isoformat() if attempt.completed_at else None}


async def owned_attempt(db, student_id: str, attempt_id: str, *, lock=False, require_active=False):
    stmt = select(TeacherPaperAttempt).where(TeacherPaperAttempt.id == attempt_id,
                                            TeacherPaperAttempt.student_id == student_id)
    if lock:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    attempt = await db.scalar(stmt)
    if not attempt:
        raise HTTPException(status_code=404, detail='未找到这份答卷')
    if require_active and attempt.catalog_code == 'teacher_homework':
        from app.models.teacher import TeacherAssignment

        homework = select(TeacherAssignment).where(TeacherAssignment.id == attempt.node_id)
        if lock:
            homework = homework.with_for_update().execution_options(populate_existing=True)
        assignment = await db.scalar(homework)
        if not assignment or assignment.removed_at:
            raise HTTPException(status_code=409, detail='老师已删除这份作业，不能继续提交')
        if assignment.results_released_at and attempt.status != 'completed':
            raise HTTPException(status_code=409, detail='老师已发布这份作业的结果，未完成的部分不能再提交')
        from app.models.teacher import Teacher
        if attempt.status != 'completed' and await db.scalar(
                select(Teacher.status).where(Teacher.id == assignment.teacher_id)) != 'active':
            raise HTTPException(status_code=409, detail='老师账号已停用，这份作业暂时不能提交')
        from app.models.teacher import TeacherClassMember
        membership = select(TeacherClassMember).where(
            TeacherClassMember.class_id == assignment.class_id,
            TeacherClassMember.student_id == student_id,
            TeacherClassMember.added_at <= (assignment.published_at or assignment.created_at),
        )
        if lock:
            membership = membership.with_for_update(read=True)
        if not await db.scalar(membership):
            raise HTTPException(status_code=403, detail='你已退出或被移出该班级，不能继续提交这份作业')
    return attempt


async def submit_attempt(db, student_id: str, attempt_id: str):
    attempt = await owned_attempt(db, student_id, attempt_id, lock=True, require_active=True)
    if attempt.status == 'in_progress':
        attempt.status = 'grading'
        attempt.submitted_at = datetime.now(timezone.utc)
    await db.commit()
    videos = await approved_video_summaries(db, attempt.question_ids)
    return attempt_summary(attempt, bool(videos))


async def validate_submission(db, student_id: str, attempt_id: str, question_id: str, *, lock=False):
    attempt = await owned_attempt(db, student_id, attempt_id, lock=lock, require_active=True)
    if question_id not in attempt.question_ids:
        raise HTTPException(status_code=400, detail='题目不属于这份答卷')
    if attempt.status == 'in_progress':
        raise HTTPException(status_code=409, detail='请先提交整套答卷再开始批改')
    # A completed attempt accepts only an idempotent replay, never new evidence.
    if attempt.status == 'completed':
        existing = await db.scalar(select(StudentAnswer.id).where(
            StudentAnswer.teacher_paper_attempt_id == attempt.id, StudentAnswer.question_id == question_id))
        if existing is None:
            raise HTTPException(status_code=409, detail='答卷已完成，请从结果页选择重新作答')
    return attempt


async def finish_if_complete(db, student_id: str, attempt_id: str):
    attempt = await owned_attempt(db, student_id, attempt_id, lock=True)
    await db.flush()
    answered = set((await db.scalars(select(StudentAnswer.question_id).where(
        StudentAnswer.teacher_paper_attempt_id == attempt.id, StudentAnswer.student_id == student_id))).all())
    if answered == set(attempt.question_ids) and attempt.status == 'grading':
        attempt.status = 'completed'
        attempt.completed_at = datetime.now(timezone.utc)
        await db.flush()
        # Handed in to the teacher at once, not when the teacher next opens a page.
        from app.services.teacher_homework_service import sync_finished_attempt
        await sync_finished_attempt(db, attempt)


async def answer_video_summaries(db, answers: list) -> dict[int, dict]:
    videos = await approved_video_summaries(db, [a.question_id for a in answers])
    attempt_ids = {a.teacher_paper_attempt_id for a in answers if getattr(a, 'teacher_paper_attempt_id', None)}
    completed = set((await db.scalars(select(TeacherPaperAttempt.id).where(
        TeacherPaperAttempt.id.in_(attempt_ids), TeacherPaperAttempt.status == 'completed'))).all()) if attempt_ids else set()
    result = {}
    for answer in answers:
        if answer.question_id not in videos:
            continue
        attempt_id = getattr(answer, 'teacher_paper_attempt_id', None)
        available = not attempt_id or attempt_id in completed
        result[answer.id] = {**videos[answer.question_id], 'available': available,
                            'locked_reason': None if available else '整套提交并完成批改后可观看'}
    return result


async def decorate_answer_video(db, answer, response):
    response['lesson_video'] = (await answer_video_summaries(db, [answer])).get(answer.id)
    return response


def signed_video(student_id: str, video) -> dict:
    return {'question_id': video.question_id, 'title': video.title, 'duration_seconds': video.duration_seconds,
            'video_url': '/api/student/question-videos/media?' + urlencode({'token': _sign({
                'kind': 'media', 'student_id': student_id, 'filename': video.filename,
                'expires': int(time.time()) + 7200,
            })})}


async def question_video(db, student_id: str, question_id: str, answer_id: int) -> dict:
    answer = await db.scalar(select(StudentAnswer).where(StudentAnswer.id == answer_id,
        StudentAnswer.student_id == student_id, StudentAnswer.question_id == question_id))
    if not answer:
        raise HTTPException(status_code=404, detail='未找到本题的作答记录')
    if answer.teacher_paper_attempt_id:
        attempt = await owned_attempt(db, student_id, answer.teacher_paper_attempt_id)
        if attempt.status != 'completed':
            raise HTTPException(status_code=403, detail='请先完成整套批改，再观看讲解')
    video = (await approved_videos(db, [question_id])).get(question_id)
    if not video:
        raise HTTPException(status_code=404, detail='本题暂未配视频讲解')
    if not (MEDIA_DIR / video.filename).is_file():
        raise HTTPException(status_code=404, detail='视频暂未准备好')
    return signed_video(student_id, video)


async def attempt_session(db, student_id: str, attempt, adaptive_svc, rich_content_svc=None, include_rendered=False):
    from app.api.student.dependencies import maybe_enrich_rich_content
    from app.services.answer_media_service import answer_media_service
    videos = await approved_video_summaries(db, attempt.question_ids)
    questions = deepcopy(attempt.questions)
    for question in questions:
        video = videos.get(question['id'])
        question['lesson_video'] = ({**video, 'available': attempt.status == 'completed',
            'locked_reason': None if attempt.status == 'completed' else '整套提交并完成批改后可观看'} if video else None)
    rows = (await db.scalars(select(StudentAnswer).where(
        StudentAnswer.teacher_paper_attempt_id == attempt.id, StudentAnswer.student_id == student_id))).all()
    by_id = {q['id']: q for q in questions}
    answers = {}
    for row in rows:
        question = await adaptive_svc.question_svc.get_question(row.question_id)
        if question:
            response = await adaptive_svc._response_from_existing_answer(student_id, question, row)
            snapshot = by_id.get(row.question_id, {})
            response['correct_answer'] = snapshot.get('_answer', response['correct_answer']) or ''
            response['explanation'] = snapshot.get('_explanation', response['explanation'])
            answers[row.question_id] = response
    for question in questions:
        for key in list(question):
            if key.startswith('_'):
                question.pop(key, None)
    await maybe_enrich_rich_content(rich_content_svc, 'enrich_questions', questions, include_rendered=include_rendered)
    for response in answers.values():
        await maybe_enrich_rich_content(rich_content_svc, 'enrich_submit_response', response, include_rendered=include_rendered)
    return answer_media_service.secure_payload(student_id, {
        'student_id': student_id, 'session_type': f'{attempt.catalog_code}_paper',
        'strategy': f'{attempt.catalog_code}_paper',
        'session_objective': (f'老师作业「{attempt.title}」' if attempt.catalog_code == 'teacher_homework'
                              else f'教师作业「{attempt.title}」'),
        'session_structure': {'phases': [{'phase': 'paper', 'question_indices': list(range(len(questions)))}], 'total': len(questions)},
        'learner_profile': None, 'questions': questions, 'answers': answers,
        'teacher_paper': {**attempt_summary(attempt, bool(videos)), **await _homework_score(db, student_id, attempt)},
    })


async def _homework_score(db, student_id: str, attempt) -> dict:
    from app.models.teacher import TeacherAssignment
    from app.services.teacher_homework_service import HOMEWORK_CATALOG, homework_scores

    if attempt.catalog_code != HOMEWORK_CATALOG or attempt.completed_at is None:
        return {}
    assignment = await db.get(TeacherAssignment, attempt.node_id)
    if assignment is None:
        return {}
    return (await homework_scores(db, student_id, [(attempt, assignment)])).get(attempt.id, {})


async def attempt_question_points(db, attempt, question_id: str) -> float | None:
    """The teacher's points for this question on an assigned homework; other papers have none."""
    from app.models.teacher import TeacherStudentPaper
    from app.services.teacher_homework_service import HOMEWORK_CATALOG

    if attempt.catalog_code != HOMEWORK_CATALOG:
        return None
    items = await db.scalar(select(TeacherStudentPaper.items).where(
        TeacherStudentPaper.assignment_id == attempt.node_id,
        TeacherStudentPaper.student_id == attempt.student_id))
    for item in items or []:
        if item.get("question_id") == question_id:
            try:
                points = float(item.get("points"))
            except (TypeError, ValueError):
                return None
            return points if points > 0 else None
    return None


async def question_for_attempt(db, student_id: str, attempt_id: str | None, question):
    """Use the opened paper's question and answer for every grading entry."""
    if not attempt_id or getattr(question, "_paper_snapshot_id", None) == attempt_id:
        return question
    from types import SimpleNamespace
    from app.models.question import QuestionType, DifficultyTier
    attempt = await owned_attempt(db, student_id, attempt_id)
    snapshot = next((q for q in attempt.questions if q['id'] == question.id), None)
    if not snapshot:
        raise HTTPException(status_code=400, detail='题目不属于这份答卷')
    values = {column.key: getattr(question, column.key) for column in question.__table__.columns}
    values.update(_paper_snapshot_id=attempt_id,
                  _full_points=await attempt_question_points(db, attempt, question.id),
                  question_type=QuestionType(snapshot['question_type']) if snapshot.get('question_type') else question.question_type,
                  difficulty=snapshot.get('difficulty', question.difficulty),
                  difficulty_tier=DifficultyTier(snapshot['difficulty_tier']) if snapshot.get('difficulty_tier') else question.difficulty_tier,
                  stem_text=snapshot['stem_text'], answer=snapshot.get('_answer', question.answer),
                  explanation=snapshot.get('_explanation', question.explanation),
                  labels=[SimpleNamespace(**label) for label in snapshot["_labels"]] if "_labels" in snapshot else question.labels,
                  formulas=question.formulas,
                  images=question.images, options=[SimpleNamespace(**{'targets_misconception': None, **opt})
                      for opt in snapshot.get('_options', snapshot.get('options', []))])
    return SimpleNamespace(**values)


def question_snapshot(question, route='gaokao_review_paper'):
    from app.services.adaptive_service import AdaptiveService
    return {**AdaptiveService._serialize_question(question, route=route),
            '_answer': question.answer, '_explanation': question.explanation,
            '_labels': [{key: getattr(label, key) for key in ('label_type', 'label_id', 'role', 'confidence', 'related_kp_id')}
                        for label in question.labels],
            '_options': [{'label': opt.label, 'text': opt.text, 'targets_misconception': opt.targets_misconception}
                         for opt in question.options]}
