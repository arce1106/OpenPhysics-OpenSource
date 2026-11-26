from dataclasses import dataclass
from datetime import datetime, timezone
from functools import partial

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.services.ai_service import AIService
from app.services.diagnosis_engine import DiagnosisEngine
from app.services.choice_scoring import (
    PARTIAL_FEEDBACK,
    extract_choice_labels,
    is_partial_multiple_choice,
    normalize_choice_answer,
)
from app.services.knowledge_service import KnowledgeService, canonical_kp_name
from app.services.learning_state_rules import STABLE_MASTERY_THRESHOLD
from app.services.physics_error_types import (
    display_process_grading,
    normalize_process_grading,
    process_grading_credit,
)
from app.services.grading_reliability import (
    DETERMINISTIC_ANSWER_SOURCE,
    GRADING_METHOD_KEY,
    INSTRUCTION_IN_ANSWER_BASIS,
    PENDING_FLAG,
    PENDING_GRADING_BASIS,
    PROCESS_CONFLICT_KEY,
    UngradableQuestion,
    answer_contains_grading_instruction,
    answer_key_for,
    has_answer_key,
    has_choice_letters,
    model_flagged_uncertain,
    process_conflict_basis,
    strict_verdict,
    verdict_process_conflict,
)
from app.services.grading_scores import apply_full_points
from app.services.learning_evidence import PROCESS_SCORE_QUESTION_TYPES
from app.services.physics_models import canonical_model_id, model_name, related_model_ids
from app.services.question_ordering import (
    CHOICE_TYPES,
    LONG_TYPES,
    MID_TYPES,
    ordered_questions_for_student,
)
from app.services.question_service import QuestionService
from app.services.review_mistake_utils import readable_misconception_name
from app.services.question_router import QuestionRouter
from app.services.student_practice_profile import StudentPracticeProfileService
from app.services.student_ai_usage_service import StudentAiUsageService
from app.services.student_service import StudentService
from app.services.mastery_scope import includes_basic_mastery, resolve_topic_context, topic_updates_basic
from app.services.teacher_paper_service import validate_submission, decorate_answer_video, question_for_attempt

AI_JUDGE_TYPES = {"fill_in_blank", "knowledge_fill_in_blank", "experiment", "problem_solving", "comprehensive"}
CHOICE_JUDGE_TYPES = {"single_choice", "multiple_choice", "true_false"}
SELF_REVIEW_TYPES = {
    "problem_solving",
    "comprehensive",
    "experiment",
    "graph_construction",
    "fill_in_blank",
    "knowledge_fill_in_blank",
}
SELF_REVIEW_STATUS_SCORES = {
    "correct": 1.0,
    "partial": 0.5,
    "wrong": 0.0,
}
SELF_REVIEW_STATUS_NAMES = {
    "correct": "完全正确",
    "partial": "部分正确",
    "wrong": "不会",
}
FALLBACK_EXPLANATION = "本题暂无详细解析，可先根据标准答案和批改反馈复盘关键步骤。"
PRIMARY_KNOWLEDGE_POINT_ROLES = {"primary", "主要"}


def explanation_or_fallback(explanation: str | None) -> str:
    text = (explanation or "").strip()
    return text or FALLBACK_EXPLANATION


def _first(values: list[str] | None) -> str | None:
    return values[0] if values else None


def _question_type_value(question) -> str:
    question_type = getattr(question, "question_type", None)
    return getattr(question_type, "value", question_type) or ""


def _is_self_review_supported(question) -> bool:
    return _question_type_value(question) in SELF_REVIEW_TYPES


def _knowledge_point_labels(question) -> list:
    return [
        label
        for label in (getattr(question, "labels", None) or [])
        if getattr(label, "label_type", None) == "knowledge_point"
    ]


def _knowledge_point_role_priority(label) -> tuple[int, float, str]:
    role = str(getattr(label, "role", "") or "").strip().lower()
    confidence = float(getattr(label, "confidence", 0.0) or 0.0)
    return (
        0 if role in PRIMARY_KNOWLEDGE_POINT_ROLES else 1,
        -confidence,
        str(getattr(label, "label_id", "") or ""),
    )


@dataclass(frozen=True)
class JudgmentAssessment:
    is_correct: bool
    process_grading: dict
    pending: bool
    conflict: dict | None = None


def assess_ai_judgment(
    question_type: str,
    given_answer: str,
    answer_key: str | None,
    raw: dict,
    *,
    verdict_value,
    feedback: str = "",
    full_points: float | None = None,
) -> JudgmentAssessment:
    """Turn a model's grading into the verdict the learning record may use.

    The single rule set shared by live grading and the offline grading eval:
    choice letters are compared with the key, unclear or self-doubting verdicts
    wait for confirmation, and so does a verdict its own process score contradicts.
    """
    # Points only on the question's real scale (the teacher's), never the model's guess.
    raw = apply_full_points(dict(raw or {}), full_points)
    verdict = strict_verdict(verdict_value)
    is_correct = bool(verdict)
    if question_type in CHOICE_JUDGE_TYPES and has_choice_letters(given_answer):
        # Objective photo answers: compare the recognized letters with the key
        # instead of trusting the model's verdict (it also sees the key).
        is_correct = AdaptiveService._answers_equal(question_type, given_answer, answer_key)
        raw["is_correct"] = is_correct
        model_error = raw.get("error_type")
        raw["error_type"] = "none" if is_correct else (
            model_error if model_error and model_error != "none" else "unknown"
        )
        pending = model_flagged_uncertain(raw, require_verdict=False)
    else:
        pending = verdict is None or model_flagged_uncertain(raw)
    # An answer that tries to steer the grader is never a learning conclusion on
    # the model's word alone (choice letters above are compared in code instead).
    steered = (question_type not in CHOICE_JUDGE_TYPES or not has_choice_letters(given_answer)) and (
        answer_contains_grading_instruction(given_answer)
    )
    pending = pending or steered
    process_grading = normalize_process_grading(raw, fallback_answer=given_answer, fallback_feedback=feedback or "")
    # Which grader produced it, for comparing graders in the admin quality report.
    grading_model = raw.get("vision_grading_model") or raw.get("text_grading_model")
    if grading_model:
        process_grading["_grading_model"] = str(grading_model)

    conflict = None
    if not pending and question_type in PROCESS_SCORE_QUESTION_TYPES and question_type not in CHOICE_JUDGE_TYPES:
        # The process score feeds mastery for these types; a verdict it
        # contradicts (correct at 40, wrong at 90) is not a learning conclusion.
        credit = process_grading_credit(process_grading)
        if verdict_process_conflict(is_correct, credit):
            pending = True
            conflict = {"is_correct": is_correct, "process_score": round(credit * 100)}

    if pending:
        process_grading["needs_human_review"] = True
        process_grading["confidence_level"] = "low"
        process_grading["grading_confidence"] = min(process_grading.get("grading_confidence") or 0.4, 0.4)
        process_grading["grading_basis"] = (
            INSTRUCTION_IN_ANSWER_BASIS if steered
            else process_conflict_basis(is_correct, conflict["process_score"] / 100) if conflict
            else PENDING_GRADING_BASIS
        )
    return JudgmentAssessment(is_correct, process_grading, pending, conflict)


class AdaptiveService:
    def __init__(self, db: AsyncSession, ai_usage_svc: StudentAiUsageService | None = None):
        self.db = db
        self.knowledge_svc = KnowledgeService(db)
        self.question_svc = QuestionService(db)
        self.student_svc = StudentService(db)
        self.router = QuestionRouter(db)
        self.diagnosis = DiagnosisEngine(db)
        self.practice_profile_svc = StudentPracticeProfileService(db)
        self.ai_svc = AIService()
        self.ai_usage_svc = ai_usage_svc

    async def get_practice_session(
        self, student_id: str, target_kp_id: str | None = None, count: int = 5
    ) -> dict:
        """Generate an adaptive practice session with IRT+ZPD question routing."""
        all_mastery = await self.student_svc.get_all_mastery(student_id)
        mastery_map = {m.knowledge_point_id: m for m in all_mastery}
        learner_profile = await self.practice_profile_svc.build_profile(student_id)

        if target_kp_id:
            target_kps = [target_kp_id]
        else:
            all_kps = await self.knowledge_svc.get_practicable_points()
            target_kps = []
            for label in learner_profile.get("weak_labels", {}).get("knowledge_point", []):
                kp_id = label.get("label_id")
                if not kp_id or kp_id in target_kps:
                    continue
                mastery = mastery_map.get(kp_id)
                mastery_value = mastery.mastery if mastery else 0.0
                if mastery_value < STABLE_MASTERY_THRESHOLD:
                    target_kps.append(kp_id)
                if len(target_kps) >= 3:
                    break
            for kp in all_kps:
                if kp.id in target_kps:
                    continue
                mastery = mastery_map.get(kp.id)
                mastery_value = mastery.mastery if mastery else 0.0
                if mastery_value < STABLE_MASTERY_THRESHOLD:
                    target_kps.append(kp.id)
                if len(target_kps) >= 3:
                    break

        if not target_kps:
            all_kps = await self.knowledge_svc.get_practicable_points()
            target_kps = [kp.id for kp in all_kps[:1]]

        questions = []
        seen_question_ids: set[str] = set()
        per_kp_counts = self._distribute_question_counts(count, len(target_kps))
        for kp_id, kp_count in zip(target_kps, per_kp_counts):
            mastery = mastery_map.get(kp_id)
            raw_mastery = mastery.mastery if mastery else 0.0
            effective_mastery = self.student_svc.get_effective_mastery(
                raw_mastery, mastery.last_practiced if mastery else None,
            )

            qs = await self.router.select_session(
                student_id=student_id,
                kp_id=kp_id,
                mastery=effective_mastery,
                count=kp_count,
                profile=learner_profile,
            )
            for q in qs:
                if q.id in seen_question_ids:
                    continue
                seen_question_ids.add(q.id)
                questions.append(
                    self._serialize_question(
                        q,
                        route="zpd",
                        target_knowledge_point_id=kp_id,
                    )
                )

        questions = ordered_questions_for_student(questions)[:count]
        session_structure = self._build_session_structure(questions, count)

        return {
            "student_id": student_id,
            "session_type": "practice",
            "strategy": self._get_global_strategy(mastery_map),
            "session_objective": self._derive_objective(mastery_map),
            "session_structure": session_structure,
            "learner_profile": learner_profile,
            "questions": questions,
        }

    async def submit_answer(
        self,
        student_id: str,
        question_id: str,
        given_answer: str,
        time_spent_ms: int = 0,
        judged_is_correct: bool | None = None,
        judged_feedback: str | None = None,
        judged_grading: dict | None = None,
        submission_id: str | None = None,
        target_knowledge_point_id: str | None = None,
        teacher_paper_attempt_id: str | None = None,
        topic_context: dict | None = None,
    ) -> dict:
        try:
            result = await self._submit_answer_once(
                student_id=student_id,
                question_id=question_id,
                given_answer=given_answer,
                time_spent_ms=time_spent_ms,
                judged_is_correct=judged_is_correct,
                judged_feedback=judged_feedback,
                judged_grading=judged_grading,
                submission_id=submission_id,
                target_knowledge_point_id=target_knowledge_point_id,
                teacher_paper_attempt_id=teacher_paper_attempt_id,
                topic_context=topic_context,
            )
            await self.db.commit()
            return result
        except IntegrityError:
            await self.db.rollback()
            existing = await self.get_existing_submission_response(
                student_id,
                question_id,
                submission_id,
                **({"teacher_paper_attempt_id": teacher_paper_attempt_id} if teacher_paper_attempt_id else {}),
            )
            if existing:
                return existing
            raise
        except Exception:
            await self.db.rollback()
            raise

    async def _submit_answer_once(
        self,
        student_id: str,
        question_id: str,
        given_answer: str,
        time_spent_ms: int = 0,
        judged_is_correct: bool | None = None,
        judged_feedback: str | None = None,
        judged_grading: dict | None = None,
        submission_id: str | None = None,
        target_knowledge_point_id: str | None = None,
        teacher_paper_attempt_id: str | None = None,
        topic_context: dict | None = None,
    ) -> dict:
        """Process an answer submission and return feedback with misconception diagnosis."""
        if teacher_paper_attempt_id:
            await validate_submission(self.db, student_id, teacher_paper_attempt_id, question_id)
        question = await self.question_svc.get_question(question_id)
        if not question:
            raise ValueError(f"Question {question_id} not found")
        question = await question_for_attempt(self.db, student_id, teacher_paper_attempt_id, question)
        topic_context = await resolve_topic_context(
            self.db, student_id, question, topic_context, teacher_paper_attempt_id,
        )
        update_basic = topic_updates_basic(topic_context, question)

        existing = await self.student_svc.get_answer_by_submission(
            student_id,
            question_id,
            submission_id,
            **({"teacher_paper_attempt_id": teacher_paper_attempt_id} if teacher_paper_attempt_id else {}),
        )
        if existing:
            return await self._response_from_existing_answer(student_id, question, existing)

        correct_answer = answer_key_for(question) or question.answer
        qt = question.question_type.value if question.question_type else ""
        # The teacher's points for this question on an assigned paper; bank practice has none.
        full_points = getattr(question, "_full_points", None)

        if judged_is_correct is None and not teacher_paper_attempt_id and not topic_context:
            recent_paper_answer = await self.student_svc.find_recent_paper_batch_answer(
                student_id,
                question_id,
                given_answer,
            )
            if recent_paper_answer:
                return await self._response_from_existing_answer(
                    student_id,
                    question,
                    recent_paper_answer,
                )

        if not has_answer_key(correct_answer):
            # Nothing to compare with: no model call, no verdict, no learning record.
            raise UngradableQuestion()

        # An upstream OCR/vision step may already have judged; its verdict is only
        # trusted as learning evidence when it is clear and not flagged uncertain.
        ai_feedback = None
        process_grading = None
        pending_confirmation = False
        process_conflict = None
        if judged_is_correct is not None:
            ai_feedback = judged_feedback
            assessment = assess_ai_judgment(
                qt, given_answer, correct_answer,
                judged_grading or {"is_correct": judged_is_correct, "feedback": judged_feedback},
                verdict_value=judged_is_correct, feedback=ai_feedback or "",
                full_points=full_points,
            )
            is_correct = assessment.is_correct
            process_grading = assessment.process_grading
            pending_confirmation = assessment.pending
            process_conflict = assessment.conflict
        elif qt in AI_JUDGE_TYPES:
            operation = partial(self.ai_svc.judge_answer,
                question_stem=question.stem_text,
                correct_answer=correct_answer or "",
                given_answer=given_answer,
                **({"full_points": full_points} if full_points else {}),
            )
            if self.ai_usage_svc:
                judge_result = await self.ai_usage_svc.run(
                    student_id,
                    feature="practice.text_grading",
                    operation=operation,
                    submission_key=f"{submission_id}:{question_id}" if submission_id else None,
                    fingerprint={"question": question_id, "answer": given_answer,
                                 "target": target_knowledge_point_id},
                )
            else:
                judge_result = await operation()
            ai_feedback = judge_result.get("feedback", "")
            assessment = assess_ai_judgment(
                qt, given_answer, correct_answer, judge_result,
                verdict_value=judge_result.get("is_correct"), feedback=ai_feedback,
                full_points=full_points,
            )
            is_correct = assessment.is_correct
            process_grading = assessment.process_grading
            pending_confirmation = assessment.pending
            process_conflict = assessment.conflict
        else:
            is_correct = self._answers_equal(qt, given_answer, correct_answer)

        counts_toward_mastery = update_basic and not pending_confirmation
        if not is_correct and not pending_confirmation and is_partial_multiple_choice(qt, correct_answer, given_answer):
            # Still marked wrong (it stays in the mistakes list); mastery takes half credit.
            ai_feedback = f"{PARTIAL_FEEDBACK}\n\n{ai_feedback}" if ai_feedback else PARTIAL_FEEDBACK

        kp_id = self.resolve_target_knowledge_point_id(
            question,
            target_knowledge_point_id,
        ) or "kp_unknown"

        if teacher_paper_attempt_id:
            await validate_submission(self.db, student_id, teacher_paper_attempt_id, question_id, lock=True)
            replay = await self.get_existing_submission_response(student_id, question_id, submission_id, teacher_paper_attempt_id)
            if replay:
                return replay

        mastery_updates, observed_at = await self._update_scoped_mastery(
            student_id, kp_id, question, is_correct, given_answer, process_grading, counts_toward_mastery,
        )

        # Diagnose misconceptions on wrong answers
        misconception_ids = []
        detected_misconception = None
        if not is_correct:
            error_type = (process_grading or {}).get("error_type")
            error_name = (process_grading or {}).get("error_type_name")
            if error_type and error_type not in {"none", "unknown"}:
                misconception_ids = [error_type]
                detected_misconception = {"id": error_type, "name": error_name or error_type}
                if counts_toward_mastery:
                    await self.student_svc.add_misconception(
                        student_id, kp_id, detected_misconception, commit=False
                    )
            else:
                matches = await self.diagnosis.diagnose(question, given_answer)
                misconception_ids = [m["id"] for m in matches]
                if matches:
                    detected_misconception = {"id": matches[0]["id"], "name": matches[0]["name"]}
                    if counts_toward_mastery:
                        await self.student_svc.add_misconception(
                            student_id, kp_id, matches[0], commit=False
                        )

        stored_grading = dict(process_grading or {})
        if process_grading is None:
            stored_grading[GRADING_METHOD_KEY] = "deterministic"
            if qt in CHOICE_JUDGE_TYPES:
                stored_grading["answer_source"] = DETERMINISTIC_ANSWER_SOURCE
        if pending_confirmation:
            stored_grading[PENDING_FLAG] = True
        if process_conflict:
            stored_grading[PROCESS_CONFLICT_KEY] = process_conflict
        stored_grading["_mastery_update"] = mastery_updates
        stored_grading["_evidence_knowledge_point_id"] = kp_id
        stored_grading["_evidence_observed_at"] = observed_at
        stored_grading["_mastery_scope"] = "basic" if update_basic else "topic_only"
        if topic_context:
            stored_grading["_topic_context"] = topic_context
        answer_record = await self.student_svc.record_answer(
            student_id=student_id, question_id=question_id,
            given_answer=given_answer, is_correct=is_correct, time_spent_ms=time_spent_ms,
            misconception_ids=misconception_ids,
            grading_result=stored_grading,
            submission_id=submission_id,
            teacher_paper_attempt_id=teacher_paper_attempt_id,
            commit=False,
        )

        if topic_context:
            await self._record_topic_evidence(student_id, answer_record.id, topic_context)

        await self.student_svc.update_item_stats(
            question_id, is_correct, time_spent_ms, commit=False
        )

        # Check if intervention is needed
        intervention = await self.diagnosis.should_intervene(student_id)

        return await decorate_answer_video(self.db, answer_record, {
            "answer_id": answer_record.id,
            "given_answer": answer_record.given_answer,
            "is_correct": is_correct,
            "correct_answer": correct_answer,
            "explanation": explanation_or_fallback(question.explanation),
            "mastery_update": mastery_updates,
            "detected_misconception": detected_misconception,
            "needs_intervention": intervention is not None,
            "ai_feedback": ai_feedback,
            "process_grading": process_grading,
            "idempotent_replay": False,
        })

    async def _update_scoped_mastery(self, student_id, kp_id, question, correct, answer, grading, update_basic):
        if not update_basic:
            return {}, datetime.now(timezone.utc).isoformat()
        old = await self.student_svc.get_mastery(student_id, kp_id)
        before = old.mastery if old else 0.0
        updated = await self.student_svc.update_mastery_from_answer(
            student_id, kp_id, question, correct, answer, grading, commit=False,
        )
        kp = await self.knowledge_svc.get_point(kp_id)
        return {kp_id: {"before": before, "after": updated.mastery,
                        "name": canonical_kp_name(kp_id, kp.name if kp else None)}}, updated.last_practiced.isoformat()

    async def _record_topic_evidence(self, student_id, answer_id, context):
        from app.services.learning_catalog_service import LearningCatalogService
        await LearningCatalogService(self.db).record_topic_answer(
            student_id, context["catalog_code"], context["node_id"],
            answer_id=answer_id, layer=context["layer"], commit=False,
        )

    async def get_existing_submission_response(
        self,
        student_id: str,
        question_id: str,
        submission_id: str | None,
        teacher_paper_attempt_id: str | None = None,
    ) -> dict | None:
        answer = await self.student_svc.get_answer_by_submission(
            student_id,
            question_id,
            submission_id,
            **({"teacher_paper_attempt_id": teacher_paper_attempt_id} if teacher_paper_attempt_id else {}),
        )
        if not answer:
            return None
        if teacher_paper_attempt_id:
            await validate_submission(self.db, student_id, teacher_paper_attempt_id, question_id)
        question = await self.question_svc.get_question(question_id)
        if not question:
            return None
        return await self._response_from_existing_answer(student_id, question, answer)

    async def _response_from_existing_answer(self, student_id: str, question, answer_record) -> dict:
        question = await question_for_attempt(self.db, student_id, getattr(answer_record, "teacher_paper_attempt_id", None), question)
        grading = answer_record.grading_result if isinstance(answer_record.grading_result, dict) else {}
        kp_id = (
            self.student_svc._evidence_kp_from_grading(grading)
            or self.resolve_target_knowledge_point_id(question)
            or "kp_unknown"
        )

        mastery = await self.student_svc.get_mastery(student_id, kp_id)
        mastery_value = mastery.mastery if mastery else 0.0
        kp = await self.knowledge_svc.get_point(kp_id)
        kp_name = canonical_kp_name(kp_id, kp.name if kp else None)
        stored_mastery_update = grading.get("_mastery_update")
        mastery_update = (
            stored_mastery_update
            if isinstance(stored_mastery_update, dict) and (stored_mastery_update or not includes_basic_mastery(grading))
            else {
                kp_id: {
                    "before": mastery_value,
                    "after": mastery_value,
                    "name": kp_name,
                }
            }
        )
        process_grading = display_process_grading(
            grading,
            fallback_answer=answer_record.given_answer or "",
            fallback_feedback=grading.get("feedback", ""),
            question_type=getattr(question, "question_type", None),
        )
        detected_misconception = None
        misconception_ids = answer_record.misconception_ids or []
        if not answer_record.is_correct and misconception_ids:
            first = misconception_ids[0]
            detected_misconception = {
                "id": first,
                "name": readable_misconception_name(first, (process_grading or {}).get("error_type_name")),
            }

        return await decorate_answer_video(self.db, answer_record, {
            "answer_id": answer_record.id,
            "given_answer": answer_record.given_answer,
            "is_correct": answer_record.is_correct,
            "correct_answer": question.answer,
            "explanation": explanation_or_fallback(question.explanation),
            "mastery_update": mastery_update,
            "detected_misconception": detected_misconception,
            "needs_intervention": False,
            "ai_feedback": (process_grading or {}).get("feedback"),
            "extracted_answer": answer_record.given_answer,
            "process_grading": process_grading,
            "idempotent_replay": True,
        })

    async def submit_self_review(
        self,
        student_id: str,
        question_id: str,
        items: list[dict],
        time_spent_ms: int = 0,
        submission_id: str | None = None,
        target_knowledge_point_id: str | None = None,
        teacher_paper_attempt_id: str | None = None,
        topic_context: dict | None = None,
    ) -> dict:
        try:
            result = await self._submit_self_review_once(
                student_id=student_id,
                question_id=question_id,
                items=items,
                time_spent_ms=time_spent_ms,
                submission_id=submission_id,
                target_knowledge_point_id=target_knowledge_point_id,
                teacher_paper_attempt_id=teacher_paper_attempt_id,
                topic_context=topic_context,
            )
            await self.db.commit()
            return result
        except IntegrityError:
            await self.db.rollback()
            existing = await self.get_existing_submission_response(
                student_id,
                question_id,
                submission_id,
                **({"teacher_paper_attempt_id": teacher_paper_attempt_id} if teacher_paper_attempt_id else {}),
            )
            if existing:
                return existing
            raise
        except Exception:
            await self.db.rollback()
            raise

    async def _submit_self_review_once(
        self,
        student_id: str,
        question_id: str,
        items: list[dict],
        time_spent_ms: int = 0,
        submission_id: str | None = None,
        target_knowledge_point_id: str | None = None,
        teacher_paper_attempt_id: str | None = None,
        topic_context: dict | None = None,
    ) -> dict:
        """Record a student self-review after AI could not reliably grade a paper solution."""
        if teacher_paper_attempt_id:
            await validate_submission(self.db, student_id, teacher_paper_attempt_id, question_id)
        question = await self.question_svc.get_question(question_id)
        if not question:
            raise ValueError(f"Question {question_id} not found")
        question = await question_for_attempt(self.db, student_id, teacher_paper_attempt_id, question)
        topic_context = await resolve_topic_context(
            self.db, student_id, question, topic_context, teacher_paper_attempt_id,
        )
        update_basic = topic_updates_basic(topic_context, question)
        if not _is_self_review_supported(question):
            raise ValueError("Self review is not supported for this question type")
        if not items:
            raise ValueError("Self review items cannot be empty")

        existing = await self.student_svc.get_answer_by_submission(
            student_id,
            question_id,
            submission_id,
            **({"teacher_paper_attempt_id": teacher_paper_attempt_id} if teacher_paper_attempt_id else {}),
        )
        if existing:
            return await self._response_from_existing_answer(student_id, question, existing)

        scored_items = []
        for index, item in enumerate(items, start=1):
            label = str(item.get("label") or f"第{index}问").strip()
            status = str(item.get("status") or "wrong").strip()
            if status not in SELF_REVIEW_STATUS_SCORES:
                status = "wrong"
            score = SELF_REVIEW_STATUS_SCORES[status]
            scored_items.append({
                "label": label,
                "status": status,
                "score": score,
                "status_name": SELF_REVIEW_STATUS_NAMES[status],
            })

        average_score = sum(item["score"] for item in scored_items) / len(scored_items)
        is_correct = average_score >= 0.8
        kp_id = self.resolve_target_knowledge_point_id(
            question,
            target_knowledge_point_id,
        ) or "kp_unknown"

        if teacher_paper_attempt_id:
            await validate_submission(self.db, student_id, teacher_paper_attempt_id, question_id, lock=True)
            replay = await self.get_existing_submission_response(student_id, question_id, submission_id, teacher_paper_attempt_id)
            if replay:
                return replay

        mastery_updates, observed_at = await self._update_scoped_mastery(
            student_id, kp_id, question, is_correct, "自评",
            {"answer_source": "self_review", "self_review_items": scored_items}, update_basic,
        )

        first_weak = next((item for item in scored_items if item["status"] != "correct"), None)
        grading = {
            "final_answer": "；".join(
                f"{item['label']}{item['status_name']}" for item in scored_items
            ),
            "feedback": "已按学生对照解析自评记录本题。",
            "process_score": round(average_score * 100),
            "model_correct": None,
            "equation_correct": None,
            "calculation_correct": None,
            "unit_correct": None,
            "error_type": "none" if is_correct else "unknown",
            "error_type_name": "自评通过" if is_correct else "自评待复盘",
            "first_error": f"{first_weak['label']}仍需复盘" if first_weak else "",
            "next_action": "重做未完全正确的小问" if first_weak else "继续保持规范过程",
            "grading_basis": "AI 未能稳定识别纸面过程，本结果来自学生对照标准答案和解析的逐问自评，按低权重计入学习记录。",
            "step_scores": [
                {
                    "name": item["label"],
                    "score": int(item["score"] * 2),
                    "max_score": 2,
                    "comment": item["status_name"],
                }
                for item in scored_items
            ],
            "grading_confidence": 0.55,
            "confidence_level": "low",
            "needs_human_review": True,
            "answer_source": "self_review",
            "self_review_items": scored_items,
        }
        given_answer = "自评：" + "；".join(
            f"{item['label']}{item['status_name']}" for item in scored_items
        )

        grading["_mastery_update"] = mastery_updates
        grading["_evidence_knowledge_point_id"] = kp_id
        grading["_evidence_observed_at"] = observed_at
        grading["_mastery_scope"] = "basic" if update_basic else "topic_only"
        if topic_context:
            grading["_topic_context"] = topic_context
        answer_record = await self.student_svc.record_answer(
            student_id=student_id,
            question_id=question_id,
            given_answer=given_answer,
            is_correct=is_correct,
            time_spent_ms=time_spent_ms,
            misconception_ids=[] if is_correct else ["self_review_needed"],
            grading_result=grading,
            submission_id=submission_id,
            teacher_paper_attempt_id=teacher_paper_attempt_id,
            commit=False,
        )

        if topic_context:
            await self._record_topic_evidence(student_id, answer_record.id, topic_context)

        await self.student_svc.update_item_stats(
            question_id, is_correct, time_spent_ms, commit=False
        )

        return await decorate_answer_video(self.db, answer_record, {
            "answer_id": answer_record.id,
            "given_answer": answer_record.given_answer,
            "is_correct": is_correct,
            "correct_answer": question.answer or "",
            "explanation": explanation_or_fallback(question.explanation),
            "mastery_update": mastery_updates,
            "detected_misconception": None if is_correct else {"id": "self_review_needed", "name": "自评待复盘"},
            "needs_intervention": False,
            "ai_feedback": grading["feedback"],
            "extracted_answer": given_answer,
            "process_grading": grading,
            "idempotent_replay": False,
        })

    async def get_next_practice_question(
        self,
        student_id: str,
        target_kp_id: str | None = None,
        recent_question_ids: list[str] | None = None,
        recent_question_types: list[str] | None = None,
    ) -> dict:
        all_mastery = await self.student_svc.get_all_mastery(student_id)
        mastery_map = {m.knowledge_point_id: m for m in all_mastery}

        kp_id = target_kp_id
        if not kp_id:
            all_kps = await self.knowledge_svc.get_practicable_points()
            for kp in all_kps:
                mastery = mastery_map.get(kp.id)
                if (mastery.mastery if mastery else 0.0) < STABLE_MASTERY_THRESHOLD:
                    kp_id = kp.id
                    break
            if not kp_id and all_kps:
                kp_id = all_kps[0].id

        if not kp_id:
            return {"question": None, "session_complete": True}

        mastery = mastery_map.get(kp_id)
        raw_mastery = mastery.mastery if mastery else 0.0
        effective_mastery = self.student_svc.get_effective_mastery(
            raw_mastery, mastery.last_practiced if mastery else None,
        )
        question = await self.router.select_next(
            student_id=student_id,
            kp_id=kp_id,
            mastery=effective_mastery,
            recent_question_ids=recent_question_ids or [],
            recent_question_types=recent_question_types or [],
            profile=await self.practice_profile_svc.build_profile(student_id),
        )
        if not question:
            return {"question": None, "session_complete": True}
        return {
            "question": self._serialize_question(question, route="dynamic_zpd", target_knowledge_point_id=kp_id),
            "session_complete": False,
        }

    def _build_session_structure(self, questions: list[dict], count: int) -> dict:
        """Build session structure labels from router-assigned phases when available."""
        if not questions:
            return {"phases": [], "total": 0}
        if any(question.get("session_phase") for question in questions):
            phase_rows: list[dict] = []
            phase_index: dict[str, int] = {}
            for index, question in enumerate(questions):
                phase = question.get("session_phase") or "mixed_practice"
                if phase not in phase_index:
                    phase_index[phase] = len(phase_rows)
                    phase_rows.append({"phase": phase, "question_indices": []})
                phase_rows[phase_index[phase]]["question_indices"].append(index)
            return {"phases": phase_rows, "total": len(questions)}

        phases = []
        n = len(questions)
        if n >= 1:
            phases.append({"phase": "diagnostic", "question_indices": [0]})
        if n >= 4:
            phases.append({"phase": "practice", "question_indices": [1, 2, 3]})
        elif n >= 2:
            phases.append({"phase": "practice", "question_indices": list(range(1, n))})
        if n >= 5:
            phases.append({"phase": "challenge", "question_indices": [4]})
        return {"phases": phases, "total": n}

    @staticmethod
    def _distribute_question_counts(count: int, target_count: int) -> list[int]:
        if target_count <= 0:
            return []
        base = max(1, count // target_count)
        remainder = max(0, count - base * target_count)
        return [
            base + (1 if idx < remainder else 0)
            for idx in range(target_count)
        ]

    @staticmethod
    def resolve_target_knowledge_point_id(
        question,
        requested_id: str | None = None,
        allowed_ids: set[str] | None = None,
    ) -> str | None:
        labels = _knowledge_point_labels(question)
        if allowed_ids is not None:
            labels = [label for label in labels if label.label_id in allowed_ids]
        if requested_id:
            requested_id = requested_id.strip()
            if not any(label.label_id == requested_id for label in labels):
                raise ValueError(
                    f"Knowledge point {requested_id} is not linked to question {question.id}"
                )
            return requested_id
        if not labels:
            return None
        return sorted(labels, key=_knowledge_point_role_priority)[0].label_id

    @staticmethod
    def _serialize_question(
        q,
        route: str = "zpd",
        target_knowledge_point_id: str | None = None,
    ) -> dict:
        labels_by_type: dict[str, list[str]] = {}
        for lbl in q.labels:
            labels_by_type.setdefault(lbl.label_type, []).append(lbl.label_id)

        serialized = {
            "id": q.id,
            "stem_text": q.stem_text,
            "question_type": q.question_type.value if q.question_type else None,
            "difficulty": q.difficulty,
            "difficulty_tier": q.difficulty_tier.value if q.difficulty_tier else None,
            "knowledge_point_ids": labels_by_type.get("knowledge_point", []),
            "target_knowledge_point_id": target_knowledge_point_id
            or AdaptiveService.resolve_target_knowledge_point_id(q),
            "physics_model": _first(labels_by_type.get("physics_model")),
            "ability_dimension": _first(labels_by_type.get("ability_dimension")),
            "question_structure": _first(labels_by_type.get("question_structure")),
            "solution_strategy": _first(labels_by_type.get("solution_strategy")),
            "labels_by_type": labels_by_type,
            "session_phase": getattr(q, "session_phase", None),
            "options": [{"label": o.label, "text": o.text} for o in q.options],
            "images": [
                {
                    "id": img.id,
                    "image_path": img.image_path,
                    "image_type": img.image_type,
                    "description": img.description,
                }
                for img in q.images
            ],
            "route": route,
        }
        if _is_self_review_supported(q):
            serialized["answer"] = q.answer
            serialized["correct_answer"] = q.answer
            serialized["explanation"] = q.explanation
        return serialized

    def _derive_objective(self, mastery_map: dict) -> str:
        """Derive a human-readable session objective from mastery state."""
        if not mastery_map:
            return "探索新知识"
        avg = sum(m.mastery for m in mastery_map.values()) / len(mastery_map)
        if avg < 0.3:
            return "夯实基础概念"
        elif avg < 0.6:
            return "强化理解与应用"
        elif avg < STABLE_MASTERY_THRESHOLD:
            return "突破薄弱环节"
        else:
            return "综合拔高训练"

    async def run_diagnostic(self, student_id: str, count: int = 8) -> dict:
        """Run a cross-chapter diagnostic to establish baseline mastery for a new student."""
        all_kps = await self.knowledge_svc.get_practicable_points()
        if not all_kps:
            return {"session_type": "diagnostic", "strategy": "exploration",
                    "session_objective": "探索新知识", "questions": []}

        # Pick diverse KPs: one from each chapter, rotating
        chapters: dict[str, list] = {}
        for kp in all_kps:
            ch = kp.chapter or "其他"
            chapters.setdefault(ch, []).append(kp)

        sampled_kps = []
        chapter_names = list(chapters.keys())
        for i in range(min(count, len(all_kps))):
            ch = chapter_names[i % len(chapter_names)]
            kps = chapters[ch]
            if kps:
                sampled_kps.append(kps[i % len(kps)])

        questions = []
        for kp in sampled_kps:
            qs = await self.question_svc.get_questions_by_knowledge_point(kp.id, limit=1)
            for q in qs:
                questions.append({
                    "id": q.id,
                    "stem_text": q.stem_text,
                    "question_type": q.question_type.value if q.question_type else None,
                    "difficulty": q.difficulty,
                    "options": [{"label": o.label, "text": o.text} for o in q.options],
                    "images": [
                        {"id": img.id, "image_path": img.image_path,
                         "image_type": img.image_type, "description": img.description}
                        for img in q.images
                    ],
                    "route": "diagnostic",
                })

        questions = ordered_questions_for_student(questions)[:count]

        return {
            "session_type": "diagnostic",
            "strategy": "diagnostic_baseline",
            "session_objective": "诊断定位 — 了解你的当前水平",
            "questions": questions,
        }

    async def get_similar_question(
        self, student_id: str, answer_id: int,
        exclude_question_ids: set[str] | None = None,
    ) -> dict | None:
        """Find a similar question (same KP, same difficulty tier, NOT the same question)
        for re-practice after a mistake."""
        variations = await self.get_variation_questions(
            student_id, answer_id, limit=1, exclude_question_ids=exclude_question_ids,
        )
        if variations:
            return variations[0]["question"]

        # Legacy fallback: same KP only.
        answers = await self.student_svc.get_answer_history(student_id, limit=200)
        target_answer = None
        for a in answers:
            if a.id == answer_id:
                target_answer = a
                break
        if not target_answer:
            return None

        question = await self.question_svc.get_question(target_answer.question_id)
        if not question:
            return None

        kp_id = self.resolve_target_knowledge_point_id(question)
        if not kp_id:
            return None

        # Get candidates from the same KP, excluding the original question
        candidates = await self.question_svc.get_questions_by_knowledge_point(
            kp_id, limit=10,
        )
        excluded = {target_answer.question_id, *(exclude_question_ids or set())}
        candidates = [
            q for q in candidates
            if q.id not in excluded and self._matches_variation_content(question, q, "foundation")
        ]

        if not candidates:
            return None

        q = max(candidates, key=lambda c: self._similarity_score(question, c))
        return {
            "id": q.id,
            "stem_text": q.stem_text,
            "question_type": q.question_type.value if q.question_type else None,
            "difficulty": q.difficulty,
            "difficulty_tier": q.difficulty_tier.value if q.difficulty_tier else None,
            "options": [{"label": o.label, "text": o.text} for o in q.options],
            "images": [
                {"id": img.id, "image_path": img.image_path,
                 "image_type": img.image_type, "description": img.description}
                for img in q.images
            ],
        }

    async def get_variation_questions(
        self, student_id: str, answer_id: int, limit: int = 3,
        exclude_question_ids: set[str] | None = None,
    ) -> list[dict]:
        """Return targeted variation questions after a mistake.

        The sequence is teacher-like: repair the local weak point, then vary the
        context under the same model, then transfer to a related model.
        """
        answers = await self.student_svc.get_answer_history(student_id, limit=300)
        target_answer = next((a for a in answers if a.id == answer_id), None)
        if not target_answer:
            return []

        original = await self.question_svc.get_question(target_answer.question_id)
        if not original:
            return []

        answered_ids = {a.question_id for a in answers}
        kp_id = self.resolve_target_knowledge_point_id(original)
        raw_model_id = self._label_value(original, "physics_model")
        model_id = canonical_model_id(raw_model_id)
        structure_id = self._label_value(original, "question_structure")
        error_type = None
        if isinstance(target_answer.grading_result, dict):
            error_type = target_answer.grading_result.get("error_type")

        variations: list[dict] = []
        # Explicit exclusions belong to this review round and are never relaxed,
        # even when the unseen-question pool is exhausted.
        used_ids = {target_answer.question_id, *(exclude_question_ids or set())}

        async def add_best(
            variation_type: str,
            title: str,
            reason: str,
            candidates,
        ) -> None:
            if len(variations) >= limit:
                return
            # Content is a hard boundary, before unseen/surface preferences.
            # Shared structures such as graphical_analysis span unrelated topics.
            eligible = [
                q for q in candidates
                if q.id not in used_ids
                and self._matches_variation_content(original, q, variation_type)
            ]
            filtered = [q for q in eligible if q.id not in answered_ids]
            if not filtered:
                filtered = eligible
            if not filtered:
                return
            surface_filtered = self._best_surface_match_candidates(original, filtered)
            if surface_filtered:
                filtered = surface_filtered
            elif self._should_wait_for_surface_match(original, variation_type):
                return
            best = max(filtered, key=lambda c: self._variation_score(original, c, variation_type, error_type))
            used_ids.add(best.id)
            variations.append({
                "variation_type": variation_type,
                "title": title,
                "reason": reason,
                "question": self._serialize_question(best, route=f"variation_{variation_type}"),
            })

        if kp_id:
            same_kp = await self.question_svc.get_questions_by_knowledge_point(kp_id, limit=30)
            await add_best(
                "foundation",
                "基础巩固",
                "先在同一知识点下修正刚才暴露的错误。",
                same_kp,
            )

        if model_id:
            same_model = []
            for label_id in dict.fromkeys([raw_model_id, model_id]):
                if label_id:
                    same_model.extend(
                        await self.question_svc.get_questions_by_label(
                            "physics_model", label_id, limit=40,
                        )
                    )
            await add_best(
                "same_model",
                "同模变式",
                f"保持「{model_name(model_id)}」不变，换一个情境重新识别模型。",
                same_model,
            )

        if model_id:
            transfer_candidates = []
            for related_id in related_model_ids(model_id)[:5]:
                transfer_candidates.extend(
                    await self.question_svc.get_questions_by_label(
                        "physics_model", related_id, limit=12,
                    )
                )
            await add_best(
                "transfer",
                "迁移挑战",
                "迁移到相邻物理模型，检查是否真正理解模型边界。",
                transfer_candidates,
            )

        if len(variations) < limit and structure_id:
            same_structure = await self.question_svc.get_questions_by_label(
                "question_structure", structure_id, limit=30,
            )
            await add_best(
                "structure",
                "题型变式",
                "保持知识点或物理模型相关，训练相近题型的审题和表达。",
                same_structure,
            )

        return variations[:limit]

    @staticmethod
    def _answers_equal(question_type: str, given_answer: str, correct_answer: str | None) -> bool:
        if question_type in CHOICE_JUDGE_TYPES:
            return (
                AdaptiveService._normalize_choice_answer(given_answer, question_type)
                == AdaptiveService._normalize_choice_answer(correct_answer or "", question_type)
            )
        return (given_answer or "").strip() == (correct_answer or "").strip()

    @staticmethod
    def _normalize_choice_answer(answer: str, question_type: str) -> str:
        return normalize_choice_answer(answer, question_type)

    @staticmethod
    def _extract_choice_labels(answer: str) -> list[str]:
        return extract_choice_labels(answer)

    @staticmethod
    def _label_value(question, label_type: str) -> str | None:
        for lbl in question.labels:
            if lbl.label_type == label_type:
                return lbl.label_id
        return None

    def is_review_retry_for(self, original, candidate) -> bool:
        """A retry that can close this mistake: the same question or one of its variations."""
        if original is None or candidate is None:
            return False
        if candidate.id == original.id:
            return True
        return any(
            self._matches_variation_content(original, candidate, variation_type)
            for variation_type in ("foundation", "same_model", "transfer")
        )

    def _matches_variation_content(self, original, candidate, variation_type: str) -> bool:
        """Require physics relevance; answer format alone never makes a variation."""
        kp_id = self.resolve_target_knowledge_point_id(original)
        model_id = canonical_model_id(self._label_value(original, "physics_model"))
        labels = getattr(candidate, "labels", None) or []
        same_kp = bool(kp_id and any(
            lbl.label_type == "knowledge_point" and lbl.label_id == kp_id
            for lbl in labels
        ))
        candidate_models = {
            canonical_model_id(lbl.label_id)
            for lbl in labels
            if lbl.label_type == "physics_model" and lbl.label_id
        }
        same_model = bool(model_id and model_id in candidate_models)
        if variation_type == "foundation":
            return same_kp
        if variation_type == "same_model":
            return same_model
        if variation_type == "transfer":
            # Preserve explicit model-graph transfers, never infer one from format.
            return bool(candidate_models.intersection(related_model_ids(model_id)[:5]))
        if variation_type == "structure":
            return same_kp or same_model
        return False

    def _best_surface_match_candidates(self, original, candidates) -> list:
        """Keep only candidates that preserve the student's answer surface.

        Variation practice should first feel like the same kind of task: an
        experiment/error-review item should not jump straight to a long
        calculation problem just because the knowledge point and model match.
        """
        scored = [
            (self._surface_match_level(original, candidate), candidate)
            for candidate in candidates
        ]
        eligible = [(level, candidate) for level, candidate in scored if level <= 2]
        if not eligible:
            return []
        best_level = min(level for level, _ in eligible)
        return [candidate for level, candidate in eligible if level == best_level]

    def _surface_match_level(self, original, candidate) -> int:
        original_type = _question_type_value(original)
        candidate_type = _question_type_value(candidate)
        if original_type and candidate_type and original_type == candidate_type:
            return 0

        original_structure = self._label_value(original, "question_structure")
        candidate_structure = self._label_value(candidate, "question_structure")
        if original_structure and candidate_structure and original_structure == candidate_structure:
            return 1

        original_family = self._response_family(original)
        candidate_family = self._response_family(candidate)
        if original_family and candidate_family and original_family == candidate_family:
            return 2

        return 4 if "long" in {original_family, candidate_family} else 3

    @staticmethod
    def _response_family(question) -> str:
        question_type = _question_type_value(question)
        if question_type in CHOICE_TYPES:
            return "choice"
        if question_type in MID_TYPES:
            return "mid"
        if question_type in LONG_TYPES:
            return "long"
        return ""

    def _should_wait_for_surface_match(self, original, variation_type: str) -> bool:
        if variation_type not in {"foundation", "same_model", "transfer"}:
            return False
        return bool(
            _question_type_value(original)
            or self._label_value(original, "question_structure")
        )

    def _similarity_score(self, original, candidate) -> float:
        score = 0.0
        if candidate.question_type == original.question_type:
            score += 4.0
        if candidate.difficulty_tier and candidate.difficulty_tier == original.difficulty_tier:
            score += 3.0
        if candidate.difficulty is not None and original.difficulty is not None:
            score += max(0.0, 2.0 - abs(candidate.difficulty - original.difficulty))

        for label_type in ("ability_dimension", "question_structure", "physics_model", "solution_strategy"):
            if self._label_value(candidate, label_type) == self._label_value(original, label_type):
                score += 2.0
        return score

    def _variation_score(self, original, candidate, variation_type: str, error_type: str | None) -> float:
        score = self._similarity_score(original, candidate)
        original_kp = self.resolve_target_knowledge_point_id(original)
        candidate_kp = self.resolve_target_knowledge_point_id(candidate)
        original_model = canonical_model_id(self._label_value(original, "physics_model"))
        candidate_model = canonical_model_id(self._label_value(candidate, "physics_model"))

        if variation_type == "foundation":
            if candidate_kp == original_kp:
                score += 6.0
            if candidate.difficulty is not None and original.difficulty is not None:
                if candidate.difficulty <= original.difficulty + 0.1:
                    score += 2.0
        elif variation_type == "same_model":
            if candidate_model == original_model:
                score += 7.0
            if candidate_kp != original_kp:
                score += 1.5
        elif variation_type == "transfer":
            if candidate_model != original_model:
                score += 4.0
            if candidate_kp != original_kp:
                score += 2.0

        if error_type == "equation_setup" and self._label_value(candidate, "solution_strategy") == "formula_application":
            score += 1.5
        if error_type == "model_selection" and candidate_model == original_model:
            score += 1.5
        return score

    def _get_global_strategy(self, mastery_map: dict) -> str:
        if not mastery_map:
            return "exploration"
        avg_mastery = sum(m.mastery for m in mastery_map.values()) / len(mastery_map)
        if avg_mastery < 0.2:
            return "focus_on_basics"
        elif avg_mastery < 0.4:
            return "foundation_building"
        elif avg_mastery < 0.6:
            return "balanced_practice"
        elif avg_mastery < STABLE_MASTERY_THRESHOLD:
            return "reinforcement"
        else:
            return "comprehensive_review"
