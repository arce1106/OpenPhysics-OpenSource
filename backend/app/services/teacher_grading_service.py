"""Grading collected paper homework: AI pre-grading by part, review by question, release, report.

AI only sees answer areas of students with a teacher-AI authorization. A result
passes on its own only when an approved rubric was used, every point was
awarded and the model was confident; everything else waits for the teacher.
Releasing locks the scores and adds them to students' mastery, once, by the same
rules the student apps use for practice.
"""
from __future__ import annotations

import asyncio
import base64
import csv
import io
import json
import logging
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean, pstdev
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.teacher import TeacherAssignment
from app.models.teacher_scan import TeacherGradingRun, TeacherSubmission, TeacherSubmissionItem
from app.services.choice_scoring import PARTIAL_EVIDENCE_WEIGHT, multiple_choice_credit
from app.services.paper_items import is_choice
from app.services.ai_service import ANSWER_IS_NOT_INSTRUCTION, ERROR_TYPES, GRADING_STANDARD
from app.services.physics_error_types import PHYSICS_ERROR_TYPES, error_type_name
from app.services.rubric_service import RubricService, clean_parts, scaled_parts, usable_parts
from app.services.student_service import StudentService
from app.services.teacher_ai_service import AiReading, TeacherAiQuotaExceeded, TeacherAiService
from app.services.teacher_assignment_service import TeacherAssignmentService
from app.services.teacher_scan_service import sign_image, uploads_root
from app.services.teacher_service import TeacherService, TeacherServiceError

logger = logging.getLogger(__name__)

AUTO_PASS_CONFIDENCE = 0.8
# Same weight the student apps give a process-scored answer: one homework nudges mastery, it does not replace it.
AREA_EVIDENCE_WEIGHT = 0.55
SCORE_BANDS = ((90, "90–100%"), (80, "80–89%"), (70, "70–79%"), (60, "60–69%"), (0, "60% 以下"))
# The teacher is the final judge: AI's full-mark results count only once confirmed.
REVIEWED = {"confirmed"}
# The score AI proposed for an item, before any teacher review.
AI_SCORE_KEY = "_ai_score"

GRADE_PROMPT = f"""你是高中物理阅卷老师，批改一名学生纸质作业中非选择题的作答区图片。每张图片前标明了题号，只批改该题图片里的内容。

{GRADING_STANDARD}

- 有“评分细则”的题：按部分逐条判断采分点，met 按顺序给出每条是否满足（true/false），条数与采分点一致；score 写该部分得分（不超过该部分分值，按 0.5 分给），reason 写给分理由。同样的写法给出同样的判断。
- 没有评分细则的题：score 写整题得分（不超过满分），parts 留空数组。
- error_type 取值：{ERROR_TYPES}。
- 看不清、空白或拿不准时 needs_human_review 设为 true。
- first_error（第一处关键错误，没有则空）、feedback（给学生的一句建议）、reason 用中文，只写结论；公式用 $...$ 包裹的 LaTeX。

{ANSWER_IS_NOT_INSTRUCTION}

只输出 JSON：{{"results": [{{"number": 题号, "parts": [{{"label": "(1)", "met": [true, false], "score": 4, "reason": "..."}}],
"score": 整题得分, "error_type": "...", "first_error": "...", "feedback": "...", "confidence": 0.9,
"needs_human_review": false}}]}}"""


class PaperGrader(Protocol):
    async def grade(self, images: list[bytes], questions: list[dict]) -> AiReading: ...


class ModelPaperGrader:
    """Teacher pre-grading with the same graders as students' work: the configured
    primary (GRADING_PRIMARY_PROVIDER) first, the other one as its backup."""

    # Doubao's cap is the answer only; DeepSeek's paper budget also covers its reasoning.
    DOUBAO_MAX_TOKENS = 15000

    async def grade(self, images: list[bytes], questions: list[dict]) -> AiReading:
        from openai import OpenAIError
        from app.services.ai_call_budget import create_chat_completion
        from app.services.ai_service import AIService, _finish_reason, _loads_model_json

        content: list[dict] = [{"type": "text", "text": json.dumps({"题目": questions}, ensure_ascii=False)}]
        for question, image in zip(questions, images):
            content.append({"type": "text", "text": f"第 {question['number']} 题作答区："})
            content.append({"type": "image_url", "image_url": {
                "url": f"data:image/jpeg;base64,{base64.b64encode(image).decode('ascii')}",
            }})
        service = object.__new__(AIService)
        last_error: Exception | None = None
        for provider in service._grading_providers():
            client, model = service._grading_connection(provider)
            options = (service._grading_request_options(provider, self.DOUBAO_MAX_TOKENS, paper_batch=True)
                       if provider == "deepseek" else {"max_tokens": self.DOUBAO_MAX_TOKENS, "temperature": 0})
            try:
                response = await create_chat_completion(
                    client, provider, settings.teacher_ai_grading_timeout_seconds, model=model,
                    messages=[{"role": "system", "content": GRADE_PROMPT}, {"role": "user", "content": content}],
                    **options,
                )
                if _finish_reason(response) == "length":
                    raise ValueError("Truncated paper grading response")
                result = _loads_model_json(response.choices[0].message.content or "")
                if not isinstance(result, dict) or not isinstance(result.get("results"), list):
                    raise ValueError("Invalid paper grading response")
            except (OpenAIError, ValueError) as exc:
                logger.warning("teacher_grading_failed provider=%s kind=%s", provider, type(exc).__name__)
                last_error = exc
                continue
            for entry in result["results"]:
                if isinstance(entry, dict):
                    entry["_grading_model"] = model
            usage = getattr(response, "usage", None)
            return AiReading(
                result=result,
                input_tokens=int(getattr(usage, "prompt_tokens", 0) or 0),
                output_tokens=int(getattr(usage, "completion_tokens", 0) or 0),
            )
        raise last_error or RuntimeError("no grading provider available")


def _half(value: float) -> float:
    return round(float(value) * 2) / 2


_CRITERION_POINTS = re.compile(r"得\s*(\d+(?:\.\d+)?)\s*分")


def criteria_score(criteria: list[str], met, points: float, base_points: float | None = None) -> float | None:
    """A part's score from which criteria the model found met, so the same judgement always
    gives the same score. Only for additive criteria: each states its points ("得 2 分") and they
    add up to the part's rubric points; alternatives ("只选 A 得 1 分") do not. Scaled to the
    part's points on this paper. None otherwise, and the model's own score stands."""
    if not isinstance(met, list) or len(met) != len(criteria) or not all(isinstance(hit, bool) for hit in met):
        return None
    values = []
    for criterion in criteria:
        found = _CRITERION_POINTS.findall(criterion)
        if len(found) != 1:
            return None
        values.append(float(found[0]))
    total = sum(values)
    if total <= 0 or abs(total - (base_points if base_points is not None else points)) > 1e-6:
        return None
    return _half(points * sum(value for value, hit in zip(values, met) if hit) / total)


def _letters(value: str | None) -> str:
    return "".join(sorted({ch for ch in (value or "").upper() if "A" <= ch <= "H"}))


def choice_credit(question_type: str | None, key: str | None, answer: str | None) -> float | None:
    """Share of the points: the exact answer earns all; multiple choice follows the 高考 rule (少选 earns half)."""
    key, given = _letters(key), _letters(answer)
    if not key:
        return None
    if question_type == "multiple_choice":
        return multiple_choice_credit(key, given)
    return 1.0 if given == key else 0.0


def choice_score(question_type: str | None, key: str | None, answer: str | None, points: float) -> float | None:
    credit = choice_credit(question_type, key, answer)
    return None if credit is None else _half(points * credit)


async def release_choice_mastery(students: StudentService, student_id: str, kp: str, credit: float) -> None:
    """Choice answers move mastery as practice in the apps does: right or wrong by knowledge
    tracing, and a half-right multiple choice (少选) by its partial credit."""
    if credit in (0, 1):
        await students.update_mastery(student_id, kp, credit >= 1, commit=False)
    else:
        await students.update_mastery_with_score(
            student_id, kp, credit, evidence_weight=PARTIAL_EVIDENCE_WEIGHT, commit=False,
        )


def _clamp(value, upper: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(upper, _half(number)))


class TeacherGradingService:
    def __init__(self, db: AsyncSession, ai: TeacherAiService | None = None, grader: PaperGrader | None = None,
                 root: Path | None = None, rubric_drafter=None):
        self.db = db
        # Drafts a missing rubric before AI pre-grading; without one, such questions are graded whole.
        self.rubric_drafter = rubric_drafter
        self.ai = ai or TeacherAiService(db)
        self.grader = grader or ModelPaperGrader()
        self.root = root or uploads_root()
        self.teachers = TeacherService(db)

    # --- Loading ---

    async def _assignment(self, teacher_id: str, assignment_id: str) -> TeacherAssignment:
        assignment = await self.db.get(TeacherAssignment, assignment_id)
        if not assignment or assignment.teacher_id != teacher_id:
            raise TeacherServiceError(404, "测验不存在")
        if assignment.status != "published":
            raise TeacherServiceError(409, "测验发布后才能批改")
        return assignment

    async def _questions(self, assignment: TeacherAssignment) -> tuple[dict[int, dict], dict[str, int]]:
        """Questions under review by number, and each question id's number.

        A class test numbers them as on the paper. A personalized homework numbers the
        distinct questions across all students' papers, choice questions first, so a
        question several students received is reviewed once.
        """
        if assignment.kind == "personalized":
            pairs = await TeacherAssignmentService(self.db).frozen_items(assignment)
            unique: dict[str, tuple[dict, dict]] = {}
            for item, question in pairs:
                unique.setdefault(question["id"], (item, question))
            ordered = sorted(unique.values(), key=lambda pair: (not is_choice(pair[1]["question_type"]), pair[1]["id"]))
        else:
            snapshot = {question["id"]: question for question in assignment.question_snapshot or []}
            ordered = [(item, snapshot[item["question_id"]]) for item in assignment.items]
        questions = {
            number: {**question, "points": float(item["points"]), "number": number}
            for number, (item, question) in enumerate(ordered, start=1)
        }
        return questions, {question["id"]: number for number, question in questions.items()}

    async def _item_points(self, assignment: TeacherAssignment) -> dict[tuple[str, str], float]:
        """(student id, question id) -> points on that student's own paper; empty for a class test."""
        if assignment.kind != "personalized":
            return {}
        papers = await TeacherAssignmentService(self.db).personalized().papers(assignment.id)
        return {(paper.student_id, item["question_id"]): float(item["points"]) for paper in papers for item in paper.items}

    async def _rubrics(self, assignment: TeacherAssignment, questions: dict[int, dict]) -> dict[int, list[dict]]:
        """Approved rubric parts scaled to each question's points on this paper. A question already
        being graded keeps the rubric it started with (``rubric_snapshot``), so an approval that
        lands mid-review never changes how this homework is scored."""
        frozen = assignment.rubric_snapshot or {}
        live = await RubricService(self.db).for_questions(
            [q["id"] for q in questions.values() if q["id"] not in frozen])
        scaled = {}
        for number, question in questions.items():
            if question["id"] in frozen:
                parts = frozen[question["id"]]
            else:
                parts = usable_parts(live.get(question["id"]))
            if parts:
                scaled[number] = scaled_parts(parts, question["points"])
        return scaled

    async def _freeze_rubrics(self, assignment: TeacherAssignment, question_ids: set[str]) -> None:
        """Record the rubric in force for questions whose grading starts now."""
        frozen = dict(assignment.rubric_snapshot or {})
        new = [question_id for question_id in question_ids if question_id not in frozen]
        if not new:
            return
        live = await RubricService(self.db).for_questions(new)
        for question_id in new:
            frozen[question_id] = usable_parts(live.get(question_id))
        assignment.rubric_snapshot = frozen

    async def _ensure_rubrics(self, assignment: TeacherAssignment, question_ids: set[str]) -> None:
        """Before AI pre-grading: any of these questions without a usable rubric (never drafted, or a
        draft that failed) is drafted now, so the AI grades it by part; then the rubrics are fixed
        for this homework."""
        frozen = assignment.rubric_snapshot or {}
        wanted = [question_id for question_id in question_ids if question_id not in frozen]
        if self.rubric_drafter is not None and wanted:
            service = RubricService(self.db, self.rubric_drafter)
            live = await service.for_questions(wanted)
            questions, keys = await self._questions(assignment)
            points = {question["id"]: question["points"] for question in questions.values()}
            for question_id in wanted:
                rubric = live.get(question_id)
                if usable_parts(rubric) or (rubric is not None and rubric.status == "drafting"):
                    continue
                await service.draft(question_id, default_points=float(points.get(question_id) or 10))
        await self._freeze_rubrics(assignment, set(question_ids))
        await self.db.commit()

    async def _refresh_authorization(self, assignment: TeacherAssignment) -> None:
        """Whether AI may see a student's answers is decided now, not when the paper was collected:
        a withdrawn authorization keeps the rest of their answers away from AI."""
        submissions = [s for s in await self._submissions(assignment.id) if s.source == "scan"]
        authorized = await self.ai.authorized_students([s.student_id for s in submissions])
        for submission in submissions:
            allowed = submission.student_id in authorized
            if allowed == submission.ai_authorized:
                continue
            submission.ai_authorized = allowed
            for item in await self._items([submission.id]):
                if item.kind != "area":
                    continue
                if not allowed and item.grade_status == "ungraded":
                    item.grade_status = "manual"
                elif allowed and item.grade_status == "manual" and item.score is None:
                    item.grade_status = "ungraded"

    async def _submissions(self, assignment_id: str) -> list[TeacherSubmission]:
        return list((await self.db.execute(
            select(TeacherSubmission).where(TeacherSubmission.assignment_id == assignment_id)
        )).scalars().all())

    async def _items(self, submission_ids: list[str]) -> list[TeacherSubmissionItem]:
        if not submission_ids:
            return []
        return list((await self.db.execute(
            select(TeacherSubmissionItem).where(TeacherSubmissionItem.submission_id.in_(submission_ids))
            .order_by(TeacherSubmissionItem.submission_id, TeacherSubmissionItem.number)
        )).scalars().all())

    async def _prepare(self, assignment: TeacherAssignment) -> None:
        """Give every collected item its points and starting grade status. Released results are
        final and are not touched again."""
        from app.services.teacher_homework_service import sync_app_submissions

        if assignment.results_released_at is not None:
            return
        await sync_app_submissions(self.db, assignment)
        questions, keys = await self._questions(assignment)
        own_points = await self._item_points(assignment)
        submissions = {s.id: s for s in await self._submissions(assignment.id)}
        for item in await self._items(list(submissions)):
            question = questions[keys[item.question_id]]
            item.max_score = own_points.get((submissions[item.submission_id].student_id, item.question_id),
                                            question["points"])
            if item.kind == "choice":
                item.score = choice_score(question["question_type"], question.get("answer"), item.answer, item.max_score)
            elif item.grade_status is None:
                item.grade_status = "ungraded" if submissions[item.submission_id].ai_authorized else "manual"
        await self.db.commit()

    # --- AI pre-grading ---

    async def start_run(self, teacher_id: str, assignment_id: str) -> TeacherGradingRun:
        assignment = await self._assignment(teacher_id, assignment_id)
        if assignment.removed_at:
            raise TeacherServiceError(409, "作业已删除，不能再预批")
        if assignment.results_released_at:
            raise TeacherServiceError(409, "结果已发布，不能再预批")
        from app.services.teacher_scan_service import recover_interrupted_work

        await recover_interrupted_work(self.db)
        running = (await self.db.execute(select(TeacherGradingRun).where(
            TeacherGradingRun.assignment_id == assignment.id, TeacherGradingRun.status.in_(["queued", "running"]),
        ))).first()
        if running:
            raise TeacherServiceError(409, "预批正在进行中")
        await self._prepare(assignment)
        await self._refresh_authorization(assignment)
        submissions = [s for s in await self._submissions(assignment.id) if s.ai_authorized]
        items = await self._items([s.id for s in submissions])
        ungraded = [item for item in items if item.kind == "area" and item.grade_status == "ungraded"]
        pending = {item.submission_id for item in ungraded}
        if not pending:
            await self.db.commit()
            raise TeacherServiceError(400, "没有需要 AI 预批的作答；未授权学生的作答请在审核页人工打分")
        run = TeacherGradingRun(id=f"g_{uuid.uuid4().hex}", assignment_id=assignment.id, total=len(pending))
        self.db.add(run)
        await self.db.commit()
        await self.db.refresh(run)
        return run

    async def process_run(self, run_id: str) -> None:
        run = await self.db.get(TeacherGradingRun, run_id)
        if not run or run.status != "queued":
            return
        run.status = "running"
        await self.db.commit()
        assignment = await self.db.get(TeacherAssignment, run.assignment_id)
        waiting = (await self.db.scalars(select(TeacherSubmissionItem.question_id).join(
            TeacherSubmission, TeacherSubmission.id == TeacherSubmissionItem.submission_id).where(
            TeacherSubmission.assignment_id == assignment.id, TeacherSubmissionItem.kind == "area",
            TeacherSubmissionItem.grade_status == "ungraded"))).all()
        await self._ensure_rubrics(assignment, set(waiting))
        questions, keys = await self._questions(assignment)
        rubrics = await self._rubrics(assignment, questions)
        student_count = len(await self.teachers.assignment_members(assignment))
        meter = {"assignment_id": assignment.id, "teacher_id": assignment.teacher_id}
        notes: set[str] = set()

        jobs = []
        for submission in [s for s in await self._submissions(assignment.id) if s.ai_authorized]:
            items = [item for item in await self._items([submission.id])
                     if item.kind == "area" and item.grade_status == "ungraded"]
            if not items:
                continue
            graded = [item for item in items if item.crop_path and (self.root / item.crop_path).is_file()]
            for item in items:
                if item not in graded:
                    item.grade_status, item.ai_result = "needs_review", {"error": "作答区缺失"}
            images = [(self.root / item.crop_path).read_bytes() for item in graded]
            # Labelled by position on this student's paper, which is how the results come back.
            payload = [self._question_payload({**questions[keys[item.question_id]], "number": item.number,
                                               "points": item.max_score or questions[keys[item.question_id]]["points"]},
                                              rubrics.get(keys[item.question_id]))
                       for item in graded]
            # The prompt is part of the key, so a reworded prompt never replays old grades.
            key = TeacherAiService.grading_key(images, payload) + GRADE_PROMPT.encode()
            jobs.append((graded, images, payload, key))
        await self.db.commit()

        # Provider calls run a few at a time; cache lookups, caps and writes stay on this one session.
        concurrency = max(1, settings.teacher_ai_grading_concurrency)
        for start in range(0, len(jobs), concurrency):
            chunk = jobs[start:start + concurrency]
            results: dict[int, dict | Exception] = {}
            to_call = []
            for index, (graded, images, payload, key) in enumerate(chunk):
                if not graded:
                    continue
                cached = await self.ai.cached("grade", key)
                if cached is not None:
                    results[index] = cached
                else:
                    to_call.append(index)
            left, message = await self.ai.remaining_calls(assignment.id, assignment.teacher_id, student_count)
            for index in to_call[left:]:
                results[index] = TeacherAiQuotaExceeded(message)
            calling = to_call[:left]
            readings = await asyncio.gather(
                *(self._grade_with_retry(chunk[index][1], chunk[index][2]) for index in calling),
                return_exceptions=True,
            )
            for index, reading in zip(calling, readings):
                ok = not isinstance(reading, BaseException)
                self.ai.record("grade", chunk[index][3], reading=reading if ok else None, **meter)
                results[index] = reading.result if ok else reading
            for index, (graded, _, _, _) in enumerate(chunk):
                outcome = results.get(index)
                if isinstance(outcome, TeacherAiQuotaExceeded):
                    notes.add(outcome.detail)
                    for item in graded:
                        item.grade_status, item.ai_result = "needs_review", {"error": outcome.detail}
                elif isinstance(outcome, BaseException):
                    logger.warning("pre-grading call failed: %s", outcome)
                    notes.add("部分作答 AI 预批失败，已转为人工审核")
                    for item in graded:
                        item.grade_status, item.ai_result = "needs_review", {"error": "AI 预批失败"}
                elif outcome is not None:
                    entries = {int(entry["number"]): entry for entry in outcome.get("results") or []
                               if isinstance(entry, dict) and str(entry.get("number", "")).isdigit()}
                    for item in graded:
                        self._apply(item, entries.get(item.number), rubrics.get(keys[item.question_id]))
            run.done += len(chunk)
            await self.db.commit()
        run.status, run.error = "done", "；".join(sorted(notes)) or None
        run.finished_at = datetime.now(timezone.utc)
        await self.db.commit()

    async def _grade_with_retry(self, images: list[bytes], payload: list[dict]) -> AiReading:
        """One more try before a student's areas fall back to the teacher: a timeout or a
        dropped connection is usually gone the second time."""
        try:
            return await self.grader.grade(images, payload)
        except Exception as exc:
            logger.warning("pre-grading call failed, retrying once: %s", exc)
            return await self.grader.grade(images, payload)

    @staticmethod
    def _question_payload(question: dict, parts: list[dict] | None) -> dict:
        return {
            "number": question["number"],
            "题型": question["question_type"],
            "题干": question["stem_text"],
            "标准答案": question.get("answer") or "",
            "满分": question["points"],
            "评分细则": [{"label": p["label"], "points": p["points"], "criteria": p["criteria"]} for p in parts] if parts else None,
        }

    @staticmethod
    def _apply(item: TeacherSubmissionItem, entry: dict | None, parts: list[dict] | None) -> None:
        maximum = item.max_score or 0.0
        if not isinstance(entry, dict):
            item.grade_status, item.ai_result = "needs_review", {"error": "AI 没有给出这道题的结果"}
            return
        item.ai_result = entry
        complete = True
        if parts:
            given = {str(p.get("label")): p for p in entry.get("parts") or [] if isinstance(p, dict)}
            scored = []
            for part in parts:
                match = given.get(part["label"])
                complete = complete and match is not None
                counted = criteria_score(part.get("criteria") or [], (match or {}).get("met"), part["points"],
                                         part.get("base_points"))
                scored.append({
                    "label": part["label"], "points": part["points"],
                    "score": counted if counted is not None else _clamp((match or {}).get("score"), part["points"]),
                    "reason": str((match or {}).get("reason") or "AI 没有给出这一部分的评分")[:300],
                })
            item.part_scores = scored
            item.score = _half(sum(part["score"] for part in scored))
        else:
            item.score = _clamp(entry.get("score"), maximum)
            item.part_scores = [{"label": "全题", "points": maximum, "score": item.score,
                                 "reason": str(entry.get("feedback") or "")[:300]}]
        error_type = str(entry.get("error_type") or "unknown")
        item.error_type = error_type if error_type in PHYSICS_ERROR_TYPES else "unknown"
        item.first_error = str(entry.get("first_error") or "")[:300] or None
        item.feedback = str(entry.get("feedback") or "")[:300] or None
        try:
            confidence = float(entry.get("confidence"))
        except (TypeError, ValueError):
            confidence = 0.0
        confident = confidence >= AUTO_PASS_CONFIDENCE and not entry.get("needs_human_review")
        full = maximum > 0 and item.score >= maximum
        item.grade_status = "auto_passed" if parts and complete and confident and full else "needs_review"
        # Kept beside the teacher's final score, so a changed grade can be counted later.
        item.ai_result = {**entry, AI_SCORE_KEY: item.score}

    async def run_status(self, assignment_id: str) -> dict | None:
        run = (await self.db.execute(
            select(TeacherGradingRun).where(TeacherGradingRun.assignment_id == assignment_id)
            .order_by(TeacherGradingRun.created_at.desc()).limit(1)
        )).scalar_one_or_none()
        if run is None:
            return None
        return {"id": run.id, "status": run.status, "total": run.total, "done": run.done, "error": run.error}

    # --- Review ---

    async def review_overview(self, teacher_id: str, assignment_id: str) -> dict:
        from app.services.teacher_scan_service import recover_interrupted_work

        assignment = await self._assignment(teacher_id, assignment_id)
        await recover_interrupted_work(self.db)
        await self._prepare(assignment)
        questions, keys = await self._questions(assignment)
        rubrics_all = await RubricService(self.db).for_questions([q["id"] for q in questions.values()])
        rubrics = await self._rubrics(assignment, questions)
        frozen = assignment.rubric_snapshot or {}
        items = await self._items([s.id for s in await self._submissions(assignment.id)])
        confirmers = await self._rubric_confirmers(rubrics_all.values())
        rows = []
        for number, question in questions.items():
            mine = [item for item in items if keys.get(item.question_id) == number]
            row = {
                "number": number,
                "question_id": question["id"],
                "question_type": question["question_type"],
                "points": question["points"],
                "stem_text": question["stem_text"],
                "answer": question.get("answer"),
                "image_paths": question.get("image_paths") or [],
                "collected": len(mine),
            }
            if is_choice(question["question_type"]):
                counts: dict[str, int] = {}
                for item in mine:
                    counts[item.answer or "未作答"] = counts.get(item.answer or "未作答", 0) + 1
                scored = [item.score for item in mine if item.score is not None]
                full = [item for item in mine if item.score is not None and item.max_score]
                row.update(kind="choice", distribution=counts,
                           correct_rate=round(sum(1 for i in full if i.score >= i.max_score) / len(full), 4) if full else None,
                           pending=sum(1 for item in mine if item.status in {"manual", "needs_review", "missing", "pending"}))
            else:
                statuses = [item.grade_status for item in mine]
                rubric = rubrics_all.get(question["id"])
                row.update(
                    kind="area",
                    rubric_status=rubric.status if rubric else None,
                    rubric_parts=rubrics.get(number),
                    # The shared rubric as written (its own points), for a teacher to correct and confirm.
                    rubric_base=(rubric.parts or None) if rubric else None,
                    rubric_source=rubric.source if rubric else None,
                    rubric_confirmed_by=confirmers.get(rubric.reviewed_by) if rubric and rubric.status == "approved" else None,
                    # A corrected rubric still applies to this homework while no answer to it was graded by hand.
                    rubric_applies_here=assignment.results_released_at is None
                    and not any(item.grade_status in REVIEWED for item in mine),
                    # Grading began before the current rubric was approved: this homework keeps whole-question scores.
                    rubric_frozen=question["id"] in frozen,
                    pending=sum(1 for s in statuses if s in {"ungraded", "manual", "needs_review"}),
                    auto_passed=statuses.count("auto_passed"),
                    confirmed=statuses.count("confirmed"),
                )
            rows.append(row)
        return {
            "assignment_id": assignment.id,
            "released": assignment.results_released_at is not None,
            "run": await self.run_status(assignment.id),
            "questions": rows,
            "auto_passed": sum(1 for item in items if item.kind == "area" and item.grade_status == "auto_passed"),
            "error_types": PHYSICS_ERROR_TYPES,
            "turn_in": await self._turn_in(assignment),
        }

    async def _turn_in(self, assignment: TeacherAssignment) -> dict:
        """Who has not handed in yet, so releasing (which closes unfinished App work) is a known choice."""
        from app.models.teacher_paper import TeacherPaperAttempt
        from app.services.teacher_homework_service import homework_paper_id

        members = {student.id for student in await self.teachers.assignment_members(assignment)}
        collected = {submission.student_id for submission in await self._submissions(assignment.id)}
        attempts = dict((await self.db.execute(select(TeacherPaperAttempt.student_id, TeacherPaperAttempt.status).where(
            TeacherPaperAttempt.paper_id == homework_paper_id(assignment.id)))).all())
        missing = members - collected
        return {
            "expected": len(members),
            "collected": len(members & collected),
            "missing": len(missing),
            # Answering in the App, or submitted there with answers still being graded.
            "app_working": sum(attempts.get(sid) == "in_progress" for sid in missing),
            "app_grading": sum(attempts.get(sid) == "grading" for sid in missing),
        }

    async def _rubric_confirmers(self, rubrics) -> dict[str, str]:
        """Who confirmed each rubric, as teachers see it: a teacher's name, or 管理员."""
        from app.models.teacher import Teacher

        reviewers = {rubric.reviewed_by for rubric in rubrics if rubric.reviewed_by}
        ids = [reviewer.split(":", 1)[1] for reviewer in reviewers if reviewer.startswith("teacher:")]
        names = dict((await self.db.execute(select(Teacher.id, Teacher.display_name).where(Teacher.id.in_(ids)))).all()) if ids else {}
        return {reviewer: (names.get(reviewer.split(':', 1)[1]) or "一位老师" if reviewer.startswith("teacher:") else "管理员")
                for reviewer in reviewers}

    async def save_rubric(self, teacher_id: str, assignment_id: str, number: int, parts) -> dict:
        """A teacher corrects and confirms a question's rubric while reviewing. The rubric is shared:
        every teacher's homework uses it from now on. In this homework it replaces the one in use
        when no answer to the question has been graded by hand yet; those answers go back to AI
        pre-grading under the new rubric."""
        assignment = await self._assignment(teacher_id, assignment_id)
        if assignment.removed_at:
            raise TeacherServiceError(409, "作业已删除")
        questions, keys = await self._questions(assignment)
        question = questions.get(number)
        if question is None:
            raise TeacherServiceError(404, "没有这道题")
        if is_choice(question["question_type"]):
            raise TeacherServiceError(400, "选择题按答案给分，不需要评分细则")
        try:
            cleaned = clean_parts(parts)
        except ValueError as exc:
            raise TeacherServiceError(400, str(exc)) from None
        await RubricService(self.db).review(question["id"], parts=cleaned, approve=True, note=None,
                                            reviewer=f"teacher:{teacher_id}")
        items = [item for item in await self._items([s.id for s in await self._submissions(assignment.id)])
                 if keys.get(item.question_id) == number and item.kind == "area"]
        applied = assignment.results_released_at is None and not any(item.grade_status in REVIEWED for item in items)
        regrade = 0
        if applied:
            frozen = dict(assignment.rubric_snapshot or {})
            if question["id"] in frozen:
                frozen[question["id"]] = cleaned
                assignment.rubric_snapshot = frozen
            authorized = {s.id for s in await self._submissions(assignment.id) if s.ai_authorized}
            for item in items:
                if item.submission_id in authorized and item.grade_status in {"auto_passed", "needs_review"} and item.ai_result:
                    item.grade_status, item.score, item.part_scores, item.ai_result = "ungraded", None, None, None
                    regrade += 1
                elif item.grade_status in {"manual", "ungraded"}:
                    item.part_scores = None
        await self.db.commit()
        return {"applied": applied, "regrade": regrade}

    async def _names(self, assignment: TeacherAssignment, student_ids: list[str]) -> dict[str, str]:
        """Everyone whose paper is here keeps their name; a student who has since left is marked so."""
        from app.models.student import Student
        from app.services.teacher_service import mask_phone
        current = {s.id for s in await self.teachers.list_members(assignment.class_id)}
        students = (await self.db.scalars(select(Student).where(
            Student.id.in_(student_ids), Student.status != "deleted"))).all() if student_ids else []
        return {s.id: mask_phone(s.display_name) + ("" if s.id in current else "（已离班）") for s in students}

    async def question_entries(self, teacher_id: str, assignment_id: str, number: int) -> list[dict]:
        assignment = await self._assignment(teacher_id, assignment_id)
        questions, keys = await self._questions(assignment)
        if number not in questions:
            raise TeacherServiceError(404, "没有这道题")
        from app.models.teacher_scan import TeacherScanPage
        from app.services.teacher_scan_service import collection_numbers

        submissions = {s.id: s for s in await self._submissions(assignment.id)}
        numbers = await collection_numbers(self.teachers, assignment)
        names = await self._names(assignment, [s.student_id for s in submissions.values()])
        pages: dict[str, list[str]] = {}
        for page in (await self.db.execute(select(TeacherScanPage).where(
            TeacherScanPage.assignment_id == assignment.id, TeacherScanPage.status == "ok",
            TeacherScanPage.image_path.is_not(None),
        ).order_by(TeacherScanPage.batch_id, TeacherScanPage.page_index))).scalars().all():
            pages.setdefault(page.student_id, []).append(sign_image(page.image_path, teacher_id))
        entries = []
        for item in await self._items(list(submissions)):
            if keys.get(item.question_id) != number:
                continue
            student_id = submissions[item.submission_id].student_id
            entries.append({
                "item_id": item.id,
                "student_id": student_id,
                "display_name": names.get(student_id, "已注销学生"),
                "student_number": numbers.get(student_id),
                "ai_authorized": submissions[item.submission_id].ai_authorized,
                "image_url": sign_image(item.crop_path, teacher_id) if item.crop_path else None,
                # Whole pages, to read an answer whose area could not be cut out.
                "page_urls": pages.get(student_id, []) if not item.crop_path else [],
                "answer": item.answer,
                "grade_status": item.grade_status,
                "score": item.score,
                "max_score": item.max_score,
                "part_scores": item.part_scores,
                "error_type": item.error_type,
                "error_type_name": error_type_name(item.error_type) if item.error_type else None,
                "first_error": item.first_error,
                "feedback": item.feedback,
                "teacher_comment": item.teacher_comment,
                "confidence": (item.ai_result or {}).get("confidence") if isinstance(item.ai_result, dict) else None,
                "ai_error": (item.ai_result or {}).get("error") if isinstance(item.ai_result, dict) else None,
            })
        entries.sort(key=lambda e: (e["student_number"] is None, int(e["student_number"] or 0)))
        return entries

    async def _owned_item(self, teacher_id: str, item_id: int) -> tuple[TeacherSubmissionItem, TeacherAssignment]:
        item = await self.db.get(TeacherSubmissionItem, item_id)
        submission = await self.db.get(TeacherSubmission, item.submission_id) if item else None
        assignment = await self.db.get(TeacherAssignment, submission.assignment_id) if submission else None
        if not item or not assignment or assignment.teacher_id != teacher_id:
            raise TeacherServiceError(404, "作答不存在")
        if assignment.removed_at:
            raise TeacherServiceError(409, "作业已删除，不能修改成绩")
        if assignment.results_released_at:
            raise TeacherServiceError(409, "结果已发布，不能再修改")
        return item, assignment

    async def grade_item(self, teacher_id: str, item_id: int, *, part_scores: list[dict] | None,
                         score: float | None, error_type: str | None, comment: str | None) -> None:
        item, assignment = await self._owned_item(teacher_id, item_id)
        if item.kind != "area":
            raise TeacherServiceError(400, "选择题在收卷页修改答案")
        questions, keys = await self._questions(assignment)
        number = keys[item.question_id]
        question = {**questions[number], "points": item.max_score or questions[number]["points"]}
        maximum = question["points"]
        await self._freeze_rubrics(assignment, {item.question_id})
        parts = (await self._rubrics(assignment, {number: question})).get(number)
        if part_scores is not None:
            if not parts:
                raise TeacherServiceError(400, "这道题没有审核过的评分细则，请直接给整题得分")
            given = {str(p.get("label")): p.get("score") for p in part_scores if isinstance(p, dict)}
            previous = {p["label"]: p for p in item.part_scores or []}
            scored = []
            for part in parts:
                if part["label"] not in given:
                    raise TeacherServiceError(400, f"请给出 {part['label']} 的得分")
                value = float(given[part["label"]])
                if not 0 <= value <= part["points"] or value * 2 != int(value * 2):
                    raise TeacherServiceError(400, f"{part['label']} 的得分需在 0 到 {part['points']:g} 之间，按 0.5 分给")
                scored.append({"label": part["label"], "points": part["points"], "score": value,
                               "reason": previous.get(part["label"], {}).get("reason", "")})
            item.part_scores, item.score = scored, _half(sum(p["score"] for p in scored))
        elif score is not None:
            if parts:
                raise TeacherServiceError(400, "这道题有评分细则，请按部分给分")
            if not 0 <= score <= maximum or score * 2 != int(score * 2):
                raise TeacherServiceError(400, f"得分需在 0 到 {maximum:g} 之间，按 0.5 分给")
            reason = (item.part_scores or [{}])[0].get("reason", "")
            item.score = float(score)
            item.part_scores = [{"label": "全题", "points": maximum, "score": item.score, "reason": reason}]
        elif item.score is None:
            raise TeacherServiceError(400, "请先给出得分")
        if error_type is not None:
            if error_type not in PHYSICS_ERROR_TYPES:
                raise TeacherServiceError(400, "未知的错因")
            item.error_type = error_type
        if comment is not None:
            item.teacher_comment = comment.strip()[:300] or None
        item.max_score = maximum
        item.grade_status = "confirmed"
        item.reviewed_by, item.reviewed_at = teacher_id, datetime.now(timezone.utc)
        await self.db.commit()

    async def confirm_auto(self, teacher_id: str, assignment_id: str, number: int | None = None) -> int:
        """Accept AI's full-mark results the teacher has looked over: one question, or all of them."""
        assignment = await self._assignment(teacher_id, assignment_id)
        if assignment.removed_at:
            raise TeacherServiceError(409, "作业已删除，不能修改成绩")
        if assignment.results_released_at:
            raise TeacherServiceError(409, "结果已发布，不能再修改")
        _, keys = await self._questions(assignment)
        items = [item for item in await self._items([s.id for s in await self._submissions(assignment.id)])
                 if (number is None or keys.get(item.question_id) == number) and item.grade_status == "auto_passed"]
        now = datetime.now(timezone.utc)
        for item in items:
            item.grade_status, item.reviewed_by, item.reviewed_at = "confirmed", teacher_id, now
        await self.db.commit()
        return len(items)

    # --- Release ---

    async def release(self, teacher_id: str, assignment_id: str) -> None:
        initial = await self._assignment(teacher_id, assignment_id)
        if initial.removed_at:
            raise TeacherServiceError(409, "作业已删除，不能发布成绩")
        if initial.results_released_at:
            raise TeacherServiceError(409, "结果已经发布过")
        await self._prepare(initial)
        # Lock the row: a second click waits here and then finds the results already released,
        # so mastery is never written twice.
        assignment = (await self.db.execute(
            select(TeacherAssignment).where(TeacherAssignment.id == assignment_id)
            .with_for_update().execution_options(populate_existing=True)
        )).scalar_one()
        if assignment.removed_at:
            raise TeacherServiceError(409, "作业已删除，不能发布成绩")
        if assignment.results_released_at:
            raise TeacherServiceError(409, "结果已经发布过")
        submissions = await self._submissions(assignment.id)
        if not submissions:
            raise TeacherServiceError(400, "还没有收到任何卷子")
        items = await self._items([s.id for s in submissions])
        choices_open = sum(1 for i in items if i.kind == "choice" and (i.status not in {"recognized", "confirmed"} or i.score is None))
        areas_open = sum(1 for i in items if i.kind == "area" and i.grade_status not in REVIEWED | {"auto_passed"})
        auto_open = sum(1 for i in items if i.kind == "area" and i.grade_status == "auto_passed")
        if choices_open or areas_open or auto_open:
            parts = []
            if choices_open:
                parts.append(f"{choices_open} 道选择题未录入或待核对")
            if areas_open:
                parts.append(f"{areas_open} 份作答待批改或待审核")
            if auto_open:
                parts.append(f"{auto_open} 份是 AI 自动通过、还没有确认")
            await self.db.rollback()
            raise TeacherServiceError(409, "还不能发布：" + "，".join(parts))

        questions, keys = await self._questions(assignment)
        students = StudentService(self.db)
        now = datetime.now(timezone.utc)
        by_submission: dict[str, list[TeacherSubmissionItem]] = {}
        for item in items:
            by_submission.setdefault(item.submission_id, []).append(item)
        for submission in submissions:
            mine = by_submission.get(submission.id, [])
            submission.total_score = _half(sum(item.score or 0 for item in mine))
            submission.graded_at = now
        assignment.results_released_at = now
        await self.db.flush()
        from app.services.teacher_learning_evidence import released_teacher_evidence, sync_app_teacher_reviews
        # Replay final facts in observation order, so a later student correction
        # cannot erase scanned work and an App pre-grade is never counted twice.
        evidence = await released_teacher_evidence(self.db, [s.student_id for s in submissions], assignment_id=assignment.id)
        targets = sorted({(e.submission.student_id, e.kp_id) for e in evidence if e.kp_id})
        for student_id, kp_id in targets:
            await students.rebuild_mastery_for_kp(student_id, kp_id)
        await sync_app_teacher_reviews(self.db, assignment)
        # Scanned papers reach the students' own records (练习记录, 错题本) with their crops.
        from app.services.teacher_paper_results import mirror_paper_results
        await mirror_paper_results(self.db, assignment)
        await self.db.commit()

    # --- Report ---

    async def report(self, teacher_id: str, assignment_id: str) -> dict:
        from app.services.teacher_scan_service import collection_numbers

        assignment = await self._assignment(teacher_id, assignment_id)
        if not assignment.results_released_at:
            raise TeacherServiceError(409, "发布结果后才能查看报告")
        questions, keys = await self._questions(assignment)
        members = await self.teachers.assignment_members(assignment, historical=True)
        numbers = await collection_numbers(self.teachers, assignment)
        numbers.update(assignment.roster or {})
        everything = await self._submissions(assignment.id)
        # Only copies that went through release count; anything that arrived later has no score.
        recipients = {member.id for member in members}
        submissions = {s.student_id: s for s in everything
                       if s.total_score is not None and s.student_id in recipients}
        late_ids = {s.student_id for s in everything if s.total_score is None and s.student_id in recipients}
        late = len(late_ids)
        items = await self._items([s.id for s in submissions.values()])
        # Scores are listed by position on each student's paper: the same for a class test,
        # each student's own questions in a personalized homework.
        by_submission: dict[str, dict[int, TeacherSubmissionItem]] = {}
        for item in items:
            by_submission.setdefault(item.submission_id, {})[item.number] = item
        positions = sorted({item.number for item in items}) or list(questions)
        personalized = assignment.kind == "personalized"
        total_points = None if personalized else sum(q["points"] for q in questions.values())

        def full_of(submission: TeacherSubmission) -> float:
            return sum(item.max_score or 0 for item in by_submission.get(submission.id, {}).values())

        totals = [s.total_score for s in submissions.values()]
        # Papers can differ (a personalized homework): students are compared by score rate, not raw score.
        rates = {sid: (s.total_score / full_of(s) if full_of(s) else 0.0) for sid, s in submissions.items()}
        average = mean(totals) if totals else 0.0
        average_rate = mean(rates.values()) if rates else 0.0
        spread = pstdev(rates.values()) if len(rates) > 1 else 0.0

        question_rows, error_counts = [], {}
        for number, question in questions.items():
            mine = [item for item in items if keys.get(item.question_id) == number]
            scores = [item.score or 0.0 for item in mine]
            item_rates = [(item.score or 0.0) / item.max_score for item in mine if item.max_score]
            errors: dict[str, int] = {}
            for item in mine:
                if item.kind == "area" and item.error_type and item.error_type not in {"none", "unknown"} \
                        and (item.score or 0) < (item.max_score or 0):
                    errors[item.error_type] = errors.get(item.error_type, 0) + 1
                    error_counts[item.error_type] = error_counts.get(item.error_type, 0) + 1
            part_rates = []
            for item in mine[:1]:
                for part in item.part_scores or []:
                    if part["label"] == "全题":
                        continue
                    earned = [p["score"] / p["points"] for other in mine for p in other.part_scores or []
                              if p["label"] == part["label"] and p.get("points")]
                    part_rates.append({"label": part["label"], "points": part["points"],
                                       "rate": round(mean(earned), 4) if earned else None})
            distribution = None
            if is_choice(question["question_type"]):
                distribution = {}
                for item in mine:
                    distribution[item.answer or "未作答"] = distribution.get(item.answer or "未作答", 0) + 1
            kp = question.get("primary_kp") or {}
            question_rows.append({
                "number": number,
                "question_id": question["id"],
                "question_type": question["question_type"],
                "points": question["points"],
                "kp_name": kp.get("name"),
                "kp_id": kp.get("id"),
                "stem_preview": re.sub(r"\s+", " ", question.get("stem_text") or "")[:60],
                "answer": question.get("answer"),
                "students": len(mine),
                "average": round(mean(scores), 2) if scores else None,
                "rate": round(mean(item_rates), 4) if item_rates else None,
                "parts": part_rates,
                "distribution": distribution,
                "errors": [{"error_type": key, "name": error_type_name(key), "count": count}
                           for key, count in sorted(errors.items(), key=lambda kv: -kv[1])],
            })

        bands = {label: 0 for _, label in SCORE_BANDS}
        students = []
        shown = await self._names(assignment, [member.id for member in members])
        for member in sorted(members, key=lambda m: (numbers.get(m.id) is None, int(numbers.get(m.id) or 0))):
            submission = submissions.get(member.id)
            if submission is None:
                students.append({"student_id": member.id, "display_name": shown.get(member.id, member.display_name),
                                 "student_number": numbers.get(member.id), "submitted": False,
                                 "late": member.id in late_ids})
                continue
            mine = by_submission.get(submission.id, {})
            total = submission.total_score
            full = full_of(submission)
            percent = rates[member.id] * 100
            band = next(label for floor, label in SCORE_BANDS if percent >= floor)
            bands[band] += 1
            repeated = {}
            for item in mine.values():
                if item.kind == "area" and item.error_type not in {None, "none", "unknown"} \
                        and (item.score or 0) < (item.max_score or 0):
                    repeated[item.error_type] = repeated.get(item.error_type, 0) + 1
            students.append({
                "student_id": member.id,
                "display_name": shown.get(member.id, member.display_name),
                "student_number": numbers.get(member.id),
                "submitted": True,
                "total": total,
                "full_points": full,
                "percent": round(percent, 1),
                # Same band as the distribution chart, so clicking a bar lists exactly its students.
                "band": band,
                "deviation": round(total - average, 2),
                "rate_deviation": round(rates[member.id] - average_rate, 4),
                "scores": {str(number): mine[number].score if number in mine else None for number in positions},
                # The paper position and the analysis question number differ on personalized papers.
                # Keep both so a score cell always opens the student's actual question.
                "items": [{"number": item.number, "analysis_number": keys.get(item.question_id),
                           "question_id": item.question_id, "score": item.score, "max_score": item.max_score,
                           "answer": item.answer, "error_type": item.error_type,
                           "error_type_name": error_type_name(item.error_type) if item.error_type else None}
                          for item in mine.values()],
                "repeated_errors": [error_type_name(key) for key, count in repeated.items() if count >= 2],
            })
        attention = [row for row in students if row["submitted"] and (
            (spread and row["rate_deviation"] <= -spread) or row["repeated_errors"])]
        report = {
            "assignment_id": assignment.id,
            "class_id": assignment.class_id,
            "kind": assignment.kind,
            "title": assignment.title,
            "released_at": assignment.results_released_at,
            "total_points": total_points,
            "positions": positions,
            "collected": len(submissions),
            "class_size": len(members),
            "late": late,
            "average": round(average, 2),
            "average_rate": round(average_rate, 4),
            "highest": max(totals) if totals else None,
            "lowest": min(totals) if totals else None,
            "bands": [{"label": label, "count": bands[label]} for _, label in SCORE_BANDS],
            "questions": question_rows,
            "errors": [{"error_type": key, "name": error_type_name(key), "count": count}
                       for key, count in sorted(error_counts.items(), key=lambda kv: -kv[1])],
            "students": students,
            "missing": [{"display_name": row["display_name"], "student_number": row["student_number"]}
                        for row in students if not row["submitted"]],
            "attention": [{"display_name": row["display_name"], "student_number": row["student_number"],
                           "total": row["total"], "full_points": row["full_points"], "percent": row["percent"],
                           "deviation": row["deviation"], "repeated_errors": row["repeated_errors"]}
                          for row in attention],
        }
        if personalized:
            report["same_error"] = await self._same_error_rate(assignment, submissions, by_submission)
        return report

    async def _same_error_rate(self, assignment, submissions, by_submission) -> dict:
        """Of the variations chosen to repair a past mistake: how many lost points again, and how
        many lost them to the same cause, as the teacher marked it (plan section 7). Only the
        second says the mistake came back; the first may be a different slip on the same topic."""
        papers = await TeacherAssignmentService(self.db).personalized().papers(assignment.id)
        total, again, same, comparable = 0, 0, 0, 0
        by_error: dict[str, list[int]] = {}
        for paper in papers:
            submission = submissions.get(paper.student_id)
            if submission is None:
                continue
            mine = by_submission.get(submission.id, {})
            for number, item in enumerate(paper.items, start=1):
                answered = mine.get(number)
                if item.get("rule") != "same_error" or answered is None or answered.score is None:
                    continue
                cause = item.get("error_type") or "unknown"
                missed = answered.score < (answered.max_score or 0)
                known = cause not in {"unknown", "none"} and (
                    not missed or answered.error_type not in {None, "unknown", "none"})
                repeated = known and missed and answered.error_type == cause
                total += 1
                again += missed
                same += repeated
                comparable += known
                counts = by_error.setdefault(cause, [0, 0, 0, 0])
                counts[0] += 1
                counts[1] += missed
                counts[2] += repeated
                counts[3] += known
        return {
            "questions": total,
            "missed_again": again,
            "same_cause_again": same,
            "comparable": comparable,
            "unknown": total - comparable,
            "rate": round(again / total, 4) if total else None,
            "same_cause_rate": round(same / comparable, 4) if comparable else None,
            "by_error": [{"error_type": key, "name": error_type_name(key), "questions": n, "missed_again": m,
                          "same_cause_again": r, "comparable": c, "unknown": n - c}
                         for key, (n, m, r, c) in sorted(by_error.items(), key=lambda kv: -kv[1][0])],
        }

    async def report_csv(self, teacher_id: str, assignment_id: str) -> tuple[str, str]:
        report = await self.report(teacher_id, assignment_id)
        numbers = [str(n) for n in report["positions"]]
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        personalized = report['kind'] == 'personalized'
        leading = ["学号", "姓名", "总分", "个人满分", "得分率"] if personalized else ["学号", "姓名", "总分", "与平均分差"]
        writer.writerow(leading + [f"第{n}题" for n in numbers])
        for row in report["students"]:
            if not row["submitted"]:
                writer.writerow([row["student_number"] or "", row["display_name"], "迟交未计入" if row.get('late') else "缺交"]
                                + [""] * (len(leading) - 3 + len(numbers)))
                continue
            values = [f"{row['full_points']:g}", f"{row['percent']:g}%"] if personalized else [f"{row['deviation']:+g}"]
            writer.writerow([row["student_number"] or "", row["display_name"], f"{row['total']:g}", *values]
                            + ["" if row["scores"][n] is None else f"{row['scores'][n]:g}" for n in numbers])
        # The byte-order mark makes Excel read the file as UTF-8.
        return report["title"], "﻿" + buffer.getvalue()
