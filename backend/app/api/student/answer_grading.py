from app.services.teacher_paper_service import validate_submission, question_for_attempt
import base64
import datetime
import hashlib
import json
import re
from functools import partial
from contextlib import contextmanager
from app.services.answer_file_guard import answer_file_guard, AnswerFilesErased
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.services.adaptive_service import AdaptiveService
from app.services.answer_media_service import answer_media_service
from app.services.ai_service import AIService
from app.services.paper_crop_service import crop_paper_batch_by_separators
from app.services.physics_error_types import normalize_answer_text, normalize_process_grading
from app.services.grading_quality_service import (
    OUTCOME_GRADED,
    OUTCOME_NO_ANSWER_KEY,
    OUTCOME_UNRECOGNIZED,
    record_grading_outcomes,
)
from app.services.grading_reliability import (
    NO_ANSWER_KEY_DETAIL,
    UNRECOGNIZED_PHOTO_DETAIL,
    UngradableQuestion,
    answer_key_for,
    photo_answer_unrecognized,
)
from app.services.question_service import QuestionService
from app.services.reward_service import RewardService
from app.services.rich_content_render_service import RichContentRenderService
from app.services.quest_service import QuestService
from app.services.student_service import StudentService
from app.services.student_ai_usage_service import StudentAiUsageService
from . import schemas
from .answer_rewards import award_answer_rewards
from .dependencies import (
    ensure_student_can_access_kp,
    ensure_student_can_access_question,
    get_adaptive_service,
    get_ai_service,
    get_current_student_id,
    get_question_service,
    get_quest_service,
    get_rich_content_render_service,
    get_reward_service,
    get_student_ai_usage_service,
    get_student_service,
    include_rendered_requested,
    maybe_enrich_rich_content,
)

@contextmanager
def private_answer_write(upload_dir, student_id):
    try:
        with answer_file_guard(upload_dir.parent, student_id):
            upload_dir.mkdir(parents=True, exist_ok=True)
            yield
    except AnswerFilesErased:
        raise HTTPException(401, "账号已注销，请重新登录。") from None


def parse_topic_context_form(raw):
    if not isinstance(raw, str) or not raw:
        return None
    try:
        return schemas.TopicPracticeContext.model_validate_json(raw).model_dump()
    except ValueError as error:
        raise HTTPException(status_code=400, detail="专题作答来源格式错误") from error


router = APIRouter()

SELF_REVIEW_QUESTION_TYPES = {"problem_solving", "comprehensive", "experiment", "graph_construction"}
EVIDENCE_KIND_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,39}$")


def _answer_source_for_question(question) -> str:
    question_type = question.question_type.value if question.question_type else ""
    if question_type in {"single_choice", "multiple_choice", "true_false"}:
        return "choice"
    return "text"


@router.get("/answer-images/{owner_student_id}/{filename}", include_in_schema=False)
async def get_answer_image(
    owner_student_id: str,
    filename: str,
    expires: int,
    signature: str,
):
    path = answer_media_service.resolve(owner_student_id, filename, expires, signature)
    if not path:
        raise HTTPException(status_code=404, detail="Answer image not found")
    media_type = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    return FileResponse(
        path,
        media_type=media_type,
        headers={"Cache-Control": "private, max-age=600, no-transform"},
    )

@router.post("/practice/submit-photo", response_model=schemas.SubmitAnswerResponse)
async def submit_photo_answer(
    image: UploadFile = File(...),
    question_id: str = Form(...),
    student_id: str = Depends(get_current_student_id),
    time_spent_ms: int = Form(0),
    submission_id: str | None = Form(None),
    teacher_paper_attempt_id: str | None = Form(None, max_length=80),
    topic_context: str | None = Form(None, max_length=1024),
    target_knowledge_point_id: str | None = Form(None),
    adaptive_svc: AdaptiveService = Depends(get_adaptive_service),
    ai_svc: AIService = Depends(get_ai_service),
    question_svc: QuestionService = Depends(get_question_service),
    reward_svc: RewardService = Depends(get_reward_service),
    quest_svc: QuestService = Depends(get_quest_service),
    student_svc: StudentService = Depends(get_student_service),
    ai_usage_svc: StudentAiUsageService = Depends(get_student_ai_usage_service),
    rich_content_svc: RichContentRenderService = Depends(get_rich_content_render_service),
    include_rendered: bool = False,
    x_openphysics_include_rendered: str | None = Header(default=None, alias="X-OpenPhysics-Include-Rendered"),
):
    """Submit a handwritten answer as a photo for AI vision recognition and grading."""
    teacher_paper_attempt_id = teacher_paper_attempt_id if isinstance(teacher_paper_attempt_id, str) else None
    topic_context = parse_topic_context_form(topic_context)
    if target_knowledge_point_id and len(target_knowledge_point_id) > 128:
        raise HTTPException(status_code=400, detail="目标知识点标识过长")
    await ensure_student_can_access_question(student_id, question_id, student_svc)
    if target_knowledge_point_id:
        await ensure_student_can_access_kp(
            student_id,
            target_knowledge_point_id,
            student_svc,
        )
    result = await _submit_image_answer(
        image=image,
        question_id=question_id,
        student_id=student_id,
        time_spent_ms=time_spent_ms,
        submission_id=submission_id,
        target_knowledge_point_id=target_knowledge_point_id,
        **({"topic_context": topic_context} if topic_context else {}),
        adaptive_svc=adaptive_svc,
        ai_svc=ai_svc,
        question_svc=question_svc,
        source="photo",
        **({"teacher_paper_attempt_id": teacher_paper_attempt_id} if isinstance(teacher_paper_attempt_id, str) else {}),
        ai_usage_svc=ai_usage_svc,
        reward_svc=reward_svc,
        quest_svc=quest_svc,
    )
    await maybe_enrich_rich_content(
        rich_content_svc,
        "enrich_submit_response",
        result,
        include_rendered=include_rendered_requested(include_rendered, x_openphysics_include_rendered),
    )
    return answer_media_service.secure_payload(student_id, result)


@router.post("/practice/process-evidence", response_model=schemas.ProcessEvidenceResponse)
async def submit_process_evidence(
    image: UploadFile = File(...),
    question_id: str = Form(...),
    answer_id: int = Form(...),
    time_spent_ms: int = Form(0),
    evidence_kind: str = Form("scratch_image"),
    student_id: str = Depends(get_current_student_id),
    question_svc: QuestionService = Depends(get_question_service),
    student_svc: StudentService = Depends(get_student_service),
    rich_content_svc: RichContentRenderService = Depends(get_rich_content_render_service),
    include_rendered: bool = False,
    x_openphysics_include_rendered: str | None = Header(default=None, alias="X-OpenPhysics-Include-Rendered"),
):
    """Attach a final draft image to an existing answer without regrading it."""
    await ensure_student_can_access_question(student_id, question_id, student_svc)
    evidence_kind = evidence_kind or "scratch_image"
    if not EVIDENCE_KIND_PATTERN.fullmatch(evidence_kind):
        raise HTTPException(status_code=400, detail="过程证据类型格式错误")
    if image.content_type not in ("image/jpeg", "image/png", "image/jpg"):
        raise HTTPException(status_code=400, detail="仅支持 JPEG 和 PNG 格式的图片")
    contents = await image.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="图片大小不能超过 5MB")
    if not contents:
        raise HTTPException(status_code=400, detail="图片内容不能为空")

    answer = await student_svc.get_answer(student_id, answer_id)
    if not answer:
        raise HTTPException(status_code=404, detail="Answer not found")
    if str(answer.question_id) != str(question_id):
        raise HTTPException(status_code=400, detail="过程证据与答题记录不匹配")

    question = await question_svc.get_question(question_id)
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    static_dir = Path(__file__).resolve().parents[3] / "static"
    upload_dir = static_dir / "uploads" / "answers" / student_id
    ext = ".jpg" if image.content_type in ("image/jpeg", "image/jpg") else ".png"
    content_hash = hashlib.sha256(contents).hexdigest()[:20]
    filename = f"answer_{answer_id}_{evidence_kind}_{content_hash}{ext}"
    filepath = upload_dir / filename
    with private_answer_write(upload_dir, student_id):
        if not filepath.exists():
            filepath.write_bytes(contents)
    evidence_image_path = f"/static/uploads/answers/{student_id}/{filename}"

    existing_grading = answer.grading_result if isinstance(answer.grading_result, dict) else {}
    answer_source = existing_grading.get("answer_source") or _answer_source_for_question(question)
    merged_grading = normalize_process_grading(
        {
            **existing_grading,
            "final_answer": existing_grading.get("final_answer") or answer.given_answer or "",
            "feedback": existing_grading.get("feedback") or "已保存本题草稿图片，供订正和复盘参考。",
            "is_correct": answer.is_correct,
            "error_type": existing_grading.get("error_type") or ("none" if answer.is_correct else "unknown"),
            "answer_source": answer_source,
            "process_evidence_kind": evidence_kind,
            "process_evidence_image_path": evidence_image_path,
        },
        fallback_answer=answer.given_answer or "",
        fallback_feedback=existing_grading.get("feedback") or "",
    )
    for key in ("_mastery_update", "_evidence_knowledge_point_id", "_evidence_observed_at",
                "_original_grading", "manual_correction", "self_review_items",
                "_mastery_scope", "_topic_context", "_previous_basic_mastery_update", "_knowledge_point_repair"):
        if key in existing_grading:
            merged_grading[key] = existing_grading[key]
    answer.grading_result = merged_grading
    await student_svc.db.commit()
    await student_svc.db.refresh(answer)

    response = {
        "answer_id": answer.id,
        "question_id": answer.question_id,
        "process_grading": merged_grading,
    }
    await maybe_enrich_rich_content(
        rich_content_svc,
        "enrich_submit_response",
        response,
        include_rendered=include_rendered_requested(include_rendered, x_openphysics_include_rendered),
    )
    return answer_media_service.secure_payload(student_id, response)


@router.post("/practice/submit-paper-batch", response_model=schemas.PaperBatchGradeResponse)
async def submit_paper_batch_answers(
    images: list[UploadFile] = File(...),
    question_ids: str = Form(...),
    student_id: str = Depends(get_current_student_id),
    time_spent_ms: int = Form(0),
    submission_id: str | None = Form(None),
    teacher_paper_attempt_id: str | None = Form(None, max_length=80),
    topic_context: str | None = Form(None, max_length=1024),
    target_knowledge_point_ids: str | None = Form(None),
    adaptive_svc: AdaptiveService = Depends(get_adaptive_service),
    ai_svc: AIService = Depends(get_ai_service),
    question_svc: QuestionService = Depends(get_question_service),
    reward_svc: RewardService = Depends(get_reward_service),
    quest_svc: QuestService = Depends(get_quest_service),
    student_svc: StudentService = Depends(get_student_service),
    ai_usage_svc: StudentAiUsageService = Depends(get_student_ai_usage_service),
    rich_content_svc: RichContentRenderService = Depends(get_rich_content_render_service),
    include_rendered: bool = False,
    x_openphysics_include_rendered: str | None = Header(default=None, alias="X-OpenPhysics-Include-Rendered"),
):
    """Submit one photographed worksheet and grade all included questions together."""
    teacher_paper_attempt_id = teacher_paper_attempt_id if isinstance(teacher_paper_attempt_id, str) else None
    topic_context = parse_topic_context_form(topic_context)
    try:
        parsed_question_ids = json.loads(question_ids)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="题目列表格式错误")
    if not isinstance(parsed_question_ids, list) or not parsed_question_ids:
        raise HTTPException(status_code=400, detail="题目列表不能为空")
    parsed_question_ids = [str(qid) for qid in parsed_question_ids if str(qid).strip()]
    if len(parsed_question_ids) > 20:
        raise HTTPException(status_code=400, detail="一次最多批改 20 道题")
    if submission_id and len(submission_id) > 128:
        raise HTTPException(status_code=400, detail="提交标识过长")
    parsed_target_kp_ids: dict[str, str] = {}
    if target_knowledge_point_ids:
        if len(target_knowledge_point_ids) > 8192:
            raise HTTPException(status_code=400, detail="目标知识点映射过大")
        try:
            raw_target_kp_ids = json.loads(target_knowledge_point_ids)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="目标知识点映射格式错误")
        if not isinstance(raw_target_kp_ids, dict):
            raise HTTPException(status_code=400, detail="目标知识点映射格式错误")
        for question_id, kp_id in raw_target_kp_ids.items():
            if not isinstance(question_id, str) or not isinstance(kp_id, str):
                raise HTTPException(status_code=400, detail="目标知识点映射格式错误")
            if len(question_id) > 128 or len(kp_id) > 128:
                raise HTTPException(status_code=400, detail="目标知识点标识过长")
            if question_id in parsed_question_ids and kp_id.strip():
                parsed_target_kp_ids[question_id] = kp_id.strip()
    for qid in parsed_question_ids:
        if teacher_paper_attempt_id:
            await validate_submission(adaptive_svc.db, student_id, teacher_paper_attempt_id, qid)
        await ensure_student_can_access_question(student_id, qid, student_svc)
        target_kp_id = parsed_target_kp_ids.get(qid)
        if target_kp_id:
            await ensure_student_can_access_kp(student_id, target_kp_id, student_svc)
    if not images:
        raise HTTPException(status_code=400, detail="请上传整套答题照片")
    if len(images) > 6:
        raise HTTPException(status_code=400, detail="一次最多上传 6 张照片")

    existing_results = {}
    if submission_id or teacher_paper_attempt_id:
        for qid in parsed_question_ids:
            existing = await adaptive_svc.get_existing_submission_response(
                student_id,
                qid,
                submission_id,
                **({"teacher_paper_attempt_id": teacher_paper_attempt_id} if teacher_paper_attempt_id else {}),
            )
            if existing:
                existing_results[qid] = existing
        if len(existing_results) == len(parsed_question_ids):
            return answer_media_service.secure_payload(
                student_id,
                {"results": existing_results, "errors": {}, "solutions": {}},
            )

    image_payloads: list[str] = []
    answer_image_paths: list[str] = []
    page_file_paths: list[Path] = []
    static_dir = Path(__file__).resolve().parents[3] / "static"
    upload_dir = static_dir / "uploads" / "answers" / student_id
    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
    for index, image in enumerate(images, start=1):
        if image.content_type not in ("image/jpeg", "image/png", "image/jpg"):
            raise HTTPException(status_code=400, detail="仅支持 JPEG 和 PNG 格式的图片")
        contents = await image.read()
        if not contents:
            raise HTTPException(status_code=400, detail="图片内容不能为空")
        if len(contents) > 8 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="单张图片大小不能超过 8MB")
        ext = ".jpg" if image.content_type in ("image/jpeg", "image/jpg") else ".png"
        filename = f"{timestamp}_paper_batch_{index}{ext}"
        page_file_path = upload_dir / filename
        with private_answer_write(upload_dir, student_id):
            page_file_path.write_bytes(contents)
        page_file_paths.append(page_file_path)
        answer_image_paths.append(f"/static/uploads/answers/{student_id}/{filename}")
        image_payloads.append(base64.b64encode(contents).decode("utf-8"))

    with private_answer_write(upload_dir, student_id):
        crop_paths_by_qid = crop_paper_batch_by_separators(
            page_paths=page_file_paths,
            question_ids=parsed_question_ids,
            output_dir=upload_dir,
            static_prefix=f"/static/uploads/answers/{student_id}",
            batch_timestamp=timestamp,
        )

    # Keep worksheet numbering/cropping stable while grading only missing receipts.
    questions = []
    question_objects: dict[str, object] = {}
    ungradable: dict[str, object] = {}
    for question_index, qid in enumerate(parsed_question_ids, start=1):
        if qid in existing_results:
            continue
        question = await question_svc.get_question(qid)
        if not question:
            raise HTTPException(status_code=404, detail=f"Question {qid} not found")
        if teacher_paper_attempt_id:
            question = await question_for_attempt(adaptive_svc.db, student_id, teacher_paper_attempt_id, question)
        question_objects[qid] = question
        answer_key = answer_key_for(question)
        if not answer_key:
            # No standard answer: never sent to the model, never scored.
            ungradable[qid] = question
            continue
        questions.append({
            "question_id": qid,
            "question_index": question_index,
            "question_type": question.question_type.value if question.question_type else "",
            "stem": question.stem_text,
            "correct_answer": answer_key,
            "options": [
                {"label": opt.label, "text": opt.text}
                for opt in sorted(question.options, key=lambda opt: opt.label)
            ],
            **({"full_points": question._full_points} if getattr(question, "_full_points", None) else {}),
        })

    ai_submission_key = submission_id
    if submission_id:
        # Receipt identity stays stable across retakes; AI work also includes the current photos.
        image_key = ",".join(hashlib.sha256(data.encode()).hexdigest() for data in image_payloads)
        pending_key = submission_id + ":" + ",".join(question["question_id"] for question in questions) + ":" + image_key
        ai_submission_key = "paper-retry:" + hashlib.sha256(pending_key.encode()).hexdigest()
    ai_items = await ai_usage_svc.run(
        student_id,
        feature="practice.paper_batch_grading",
        operation=partial(ai_svc.judge_paper_batch_answers, image_payloads, questions),
        submission_key=ai_submission_key,
        fingerprint={"questions": parsed_question_ids, "targets": parsed_target_kp_ids,
                     "images": [hashlib.sha256(data.encode()).hexdigest() for data in image_payloads]},
    ) if questions else []
    ai_by_id = {
        str(item.get("question_id")): item
        for item in ai_items
        if isinstance(item, dict) and item.get("question_id")
    }
    # One identity-free outcome per photographed question (recognition-failure rate).
    outcomes = [
        (question["question_type"], OUTCOME_GRADED if not photo_answer_unrecognized(
            question["question_type"],
            normalize_answer_text((ai_by_id.get(question["question_id"]) or {}).get("extracted_answer", "")),
        ) else OUTCOME_UNRECOGNIZED)
        for question in questions
    ] + [
        (question.question_type.value if question.question_type else None, OUTCOME_NO_ANSWER_KEY)
        for question in ungradable.values()
    ]
    await record_grading_outcomes(getattr(adaptive_svc, "db", None), "paper_batch", outcomes)

    results: dict[str, dict] = dict(existing_results)
    errors: dict[str, str] = {}
    solutions: dict[str, dict] = {}
    questions_by_id = {question["question_id"]: question for question in questions}
    for qid in parsed_question_ids:
        if qid in existing_results:
            continue
        if qid in ungradable:
            errors[qid] = NO_ANSWER_KEY_DETAIL
            question = ungradable[qid]
            question_type = question.question_type.value if question.question_type else ""
            if question_type in SELF_REVIEW_QUESTION_TYPES and question.explanation:
                # Self-review against the worked solution is the only way to record it.
                solutions[qid] = {"correct_answer": "", "explanation": question.explanation}
            continue
        ai_result = ai_by_id.get(qid)
        if not ai_result:
            errors[qid] = "AI 未能在整套照片中定位这道题的答案"
            question_meta = questions_by_id.get(qid)
            question = await question_svc.get_question(qid)
            if question and teacher_paper_attempt_id:
                question = await question_for_attempt(adaptive_svc.db, student_id, teacher_paper_attempt_id, question)
            if question_meta and question_meta.get("question_type") in SELF_REVIEW_QUESTION_TYPES and question:
                solutions[qid] = {
                    "correct_answer": question.answer or "",
                    "explanation": question.explanation,
                }
            continue
        extracted_answer = normalize_answer_text(ai_result.get("extracted_answer", ""))
        question_type = (questions_by_id.get(qid) or {}).get("question_type") or ""
        if photo_answer_unrecognized(question_type, extracted_answer):
            errors[qid] = (ai_result.get("feedback") if not extracted_answer else None) or "AI 未能识别这道题的答案"
            question_meta = questions_by_id.get(qid)
            question = await question_svc.get_question(qid)
            if question and teacher_paper_attempt_id:
                question = await question_for_attempt(adaptive_svc.db, student_id, teacher_paper_attempt_id, question)
            if question_meta and question_meta.get("question_type") in SELF_REVIEW_QUESTION_TYPES and question:
                solutions[qid] = {
                    "correct_answer": question.answer or "",
                    "explanation": question.explanation,
                }
            continue
        ai_result["extracted_answer"] = extracted_answer
        if answer_image_paths:
            crop_path = crop_paths_by_qid.get(qid)
            ai_result["answer_image_path"] = crop_path or answer_image_paths[0]
            ai_result["answer_image_paths"] = [crop_path] if crop_path else answer_image_paths
            if crop_path:
                ai_result["answer_crop_image_path"] = crop_path
            ai_result["answer_page_image_path"] = answer_image_paths[0]
            ai_result["answer_page_image_paths"] = answer_image_paths
            ai_result["answer_source"] = "paper_batch"
        try:
            result = await adaptive_svc.submit_answer(
                student_id,
                qid,
                extracted_answer or "[整套纸笔照片]",
                time_spent_ms,
                judged_is_correct=bool(ai_result.get("is_correct", False)),
                judged_feedback=ai_result.get("feedback", ""),
                judged_grading=ai_result,
                submission_id=submission_id,
                target_knowledge_point_id=parsed_target_kp_ids.get(qid),
                **({"topic_context": topic_context} if topic_context else {}),
                **({"teacher_paper_attempt_id": teacher_paper_attempt_id} if teacher_paper_attempt_id else {}),
            )
            result["extracted_answer"] = extracted_answer
            results[qid] = result
            if result.get("idempotent_replay"):
                continue
            await award_answer_rewards(
                result,
                student_id=student_id,
                question_id=qid,
                question=question_objects.get(qid),
                time_spent_ms=time_spent_ms,
                reward_svc=reward_svc,
                quest_svc=quest_svc,
            )
        except ValueError as e:
            errors[qid] = str(e)

    render_requested = include_rendered_requested(include_rendered, x_openphysics_include_rendered)
    for result in results.values():
        await maybe_enrich_rich_content(
            rich_content_svc,
            "enrich_submit_response",
            result,
            include_rendered=render_requested,
        )
    await maybe_enrich_rich_content(
        rich_content_svc,
        "enrich_history_items",
        solutions.values(),
        include_rendered=render_requested,
    )
    return answer_media_service.secure_payload(
        student_id,
        {"results": results, "errors": errors, "solutions": solutions},
    )


@router.post("/practice/self-review", response_model=schemas.SubmitAnswerResponse)
async def submit_self_review(
    body: schemas.SelfReviewRequest,
    student_id: str = Depends(get_current_student_id),
    adaptive_svc: AdaptiveService = Depends(get_adaptive_service),
    student_svc: StudentService = Depends(get_student_service),
    rich_content_svc: RichContentRenderService = Depends(get_rich_content_render_service),
    include_rendered: bool = False,
    x_openphysics_include_rendered: str | None = Header(default=None, alias="X-OpenPhysics-Include-Rendered"),
):
    """Record a low-trust self-review after AI could not grade a paper solution."""
    await ensure_student_can_access_question(student_id, body.question_id, student_svc)
    if body.target_knowledge_point_id:
        await ensure_student_can_access_kp(
            student_id,
            body.target_knowledge_point_id,
            student_svc,
        )
    try:
        result = await adaptive_svc.submit_self_review(
            student_id=student_id,
            question_id=body.question_id,
            items=[item.model_dump() for item in body.items],
            time_spent_ms=body.time_spent_ms,
            submission_id=body.submission_id,
            target_knowledge_point_id=body.target_knowledge_point_id,
            **({"topic_context": body.topic_context.model_dump()} if body.topic_context else {}),
            **({"teacher_paper_attempt_id": body.teacher_paper_attempt_id} if body.teacher_paper_attempt_id else {}),
        )
        await maybe_enrich_rich_content(
            rich_content_svc,
            "enrich_submit_response",
            result,
            include_rendered=include_rendered_requested(include_rendered, x_openphysics_include_rendered),
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


async def _submit_image_answer(
    image: UploadFile,
    question_id: str,
    student_id: str,
    time_spent_ms: int,
    submission_id: str | None,
    target_knowledge_point_id: str | None,
    adaptive_svc: AdaptiveService,
    ai_svc: AIService,
    question_svc: QuestionService,
    source: str,
    ai_usage_svc: StudentAiUsageService | None = None,
    reward_svc: RewardService | None = None,
    quest_svc: QuestService | None = None,
    teacher_paper_attempt_id: str | None = None,
    topic_context: dict | None = None,
):
    """Save an image answer, then run vision grading."""
    if teacher_paper_attempt_id:
        await validate_submission(adaptive_svc.db, student_id, teacher_paper_attempt_id, question_id)
    # Validate image type
    if image.content_type not in ("image/jpeg", "image/png", "image/jpg"):
        raise HTTPException(status_code=400, detail="仅支持 JPEG 和 PNG 格式的图片")

    # Validate size (max 5MB)
    contents = await image.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="图片大小不能超过 5MB")
    if not contents:
        raise HTTPException(status_code=400, detail="图片内容不能为空")
    if submission_id and len(submission_id) > 128:
        raise HTTPException(status_code=400, detail="提交标识过长")

    question = await question_svc.get_question(question_id)
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")
    if teacher_paper_attempt_id:
        question = await question_for_attempt(adaptive_svc.db, student_id, teacher_paper_attempt_id, question)
    existing = await adaptive_svc.get_existing_submission_response(
        student_id,
        question_id,
        submission_id,
        **({"teacher_paper_attempt_id": teacher_paper_attempt_id} if teacher_paper_attempt_id else {}),
    )
    if existing:
        return existing
    correct_answer = answer_key_for(question)
    question_type = question.question_type.value if question.question_type else ""
    if not correct_answer:
        # No standard answer: no model call, nothing recorded.
        await record_grading_outcomes(adaptive_svc.db, source, [(question_type, OUTCOME_NO_ANSWER_KEY)])
        raise HTTPException(status_code=422, detail=NO_ANSWER_KEY_DETAIL)

    # Save image
    static_dir = Path(__file__).resolve().parents[3] / "static"
    upload_dir = static_dir / "uploads" / "answers" / student_id
    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
    ext = ".jpg" if image.content_type in ("image/jpeg", "image/jpg") else ".png"
    filename = f"{timestamp}_{source}{ext}"
    filepath = upload_dir / filename
    with private_answer_write(upload_dir, student_id):
        filepath.write_bytes(contents)
    answer_image_path = f"/static/uploads/answers/{student_id}/{filename}"

    # Encode image as base64 for AI
    image_base64 = base64.b64encode(contents).decode("utf-8")

    # AI vision: OCR + judge
    # Same question context as the worksheet path: stem, type and options (audit A12).
    operation = partial(ai_svc.judge_photo_answer,
        image_base64=image_base64,
        question_stem=question.stem_text,
        correct_answer=correct_answer,
        question_type=question_type,
        options=[
            {"label": opt.label, "text": opt.text}
            for opt in sorted(getattr(question, "options", None) or [], key=lambda opt: opt.label)
        ],
        **({"full_points": question._full_points} if getattr(question, "_full_points", None) else {}),
    )
    try:
        if ai_usage_svc:
            image_hash = hashlib.sha256(contents).hexdigest()
            ai_result = await ai_usage_svc.run(
                student_id,
                feature=f"practice.{source}_vision_grading",
                operation=operation,
                # A retaken photo is new AI work; the same photo replays the stored result.
                submission_key=f"{submission_id}:{question_id}:{image_hash}" if submission_id else None,
                fingerprint={"question": question_id, "target": target_knowledge_point_id,
                             "image": image_hash},
            )
        else:
            ai_result = await operation()
    except Exception:
        # A failed provider call created no answer; discard only this request's
        # unreferenced upload. The client's original photo/draft is retained.
        filepath.unlink(missing_ok=True)
        raise
    extracted_answer = normalize_answer_text(ai_result.get("extracted_answer", ""))
    if photo_answer_unrecognized(question_type, extracted_answer):
        # Nothing gradable was read: do not record a wrong answer or touch mastery.
        filepath.unlink(missing_ok=True)
        await record_grading_outcomes(adaptive_svc.db, source, [(question_type, OUTCOME_UNRECOGNIZED)])
        raise HTTPException(status_code=422, detail=UNRECOGNIZED_PHOTO_DETAIL)
    await record_grading_outcomes(adaptive_svc.db, source, [(question_type, OUTCOME_GRADED)])
    is_correct = ai_result.get("is_correct", False)
    ai_feedback = ai_result.get("feedback", "")
    ai_result["extracted_answer"] = extracted_answer
    ai_result["answer_image_path"] = answer_image_path
    ai_result["answer_source"] = source

    # Submit to adaptive system for BKT update
    try:
        bkt_result = await adaptive_svc.submit_answer(
            student_id,
            question_id,
            extracted_answer or "[图片]",
            time_spent_ms,
            judged_is_correct=is_correct,
            judged_feedback=ai_feedback,
            judged_grading=ai_result,
            submission_id=submission_id,
            target_knowledge_point_id=target_knowledge_point_id,
            **({"topic_context": topic_context} if topic_context else {}),
            **({"teacher_paper_attempt_id": teacher_paper_attempt_id} if teacher_paper_attempt_id else {}),
        )
    except UngradableQuestion as e:
        raise HTTPException(status_code=422, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    # Merge OCR text into the already-authoritative vision judgment result.
    bkt_result["extracted_answer"] = extracted_answer

    if bkt_result.get("idempotent_replay"):
        return bkt_result

    if reward_svc and quest_svc:
        await award_answer_rewards(
            bkt_result,
            student_id=student_id,
            question_id=question_id,
            question=question,
            time_spent_ms=time_spent_ms,
            reward_svc=reward_svc,
            quest_svc=quest_svc,
        )

    return bkt_result


@router.post("/practice/extract-photo")
async def extract_photo_answer(
    image: UploadFile = File(...),
    question_id: str = Form(...),
    student_id: str = Depends(get_current_student_id),
    ai_svc: AIService = Depends(get_ai_service),
    question_svc: QuestionService = Depends(get_question_service),
    student_svc: StudentService = Depends(get_student_service),
    ai_usage_svc: StudentAiUsageService = Depends(get_student_ai_usage_service),
):
    """Extract handwritten answer text from a photo without judging/submitting."""
    await ensure_student_can_access_question(student_id, question_id, student_svc)
    if image.content_type not in ("image/jpeg", "image/png", "image/jpg"):
        raise HTTPException(status_code=400, detail="仅支持 JPEG 和 PNG 格式的图片")

    contents = await image.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="图片大小不能超过 5MB")

    question = await question_svc.get_question(question_id)
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    image_base64 = base64.b64encode(contents).decode("utf-8")
    result = await ai_usage_svc.run(
        student_id,
        feature="practice.extract_photo",
        operation=partial(ai_svc.extract_answer_from_image,
                          image_base64=image_base64, question_stem=question.stem_text),
    )
    return {"extracted_answer": result.get("extracted_answer", ""),
            "confidence": result.get("confidence", 0),
            "notes": result.get("notes", "")}
