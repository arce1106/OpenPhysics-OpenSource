from collections import Counter, defaultdict
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.knowledge import KnowledgePoint
from app.models.question import QualityStatus, Question
from app.models.student import StudentAnswer
from app.services.grading_quality_service import GradingQualityService
from app.services.physics_error_types import error_type_name
from app.services.physics_models import MODEL_BY_ID, PHYSICS_MODELS, canonical_model_id, model_name


REQUIRED_LABEL_TYPES = [
    "knowledge_point",
    "question_type",
    "physics_model",
    "question_structure",
    "ability_dimension",
    "solution_strategy",
]


def _label_types(question: Any) -> set[str]:
    return {label.label_type for label in getattr(question, "labels", [])}


def _label_ids(question: Any, label_type: str) -> list[str]:
    return [
        label.label_id
        for label in getattr(question, "labels", [])
        if label.label_type == label_type
    ]


def audit_question_labels(question: Any) -> dict:
    present = _label_types(question)
    missing_labels = [label_type for label_type in REQUIRED_LABEL_TYPES if label_type not in present]
    completeness = (len(REQUIRED_LABEL_TYPES) - len(missing_labels)) / len(REQUIRED_LABEL_TYPES)
    issues = []
    if missing_labels:
        issues.append("missing_labels")
    if not getattr(question, "answer", None):
        issues.append("missing_answer")
    if not getattr(question, "explanation", None):
        issues.append("missing_explanation")
    if not getattr(question, "difficulty_tier", None):
        issues.append("missing_difficulty_tier")
    return {
        "missing_labels": missing_labels,
        "completeness": round(completeness, 4),
        "issues": issues,
    }


class AdminQualityService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def build_report(
        self,
        volume: str | None = None,
        chapter: str | None = None,
        section: str | None = None,
        kp_id: str | None = None,
    ) -> dict:
        questions = await self._load_questions()
        kps = await self._load_kps()
        wrong_answers = await self._load_recent_wrong_answers()
        kps = self._filter_kps(kps, volume=volume, chapter=chapter, section=section, kp_id=kp_id)
        scoped_kp_ids = {kp.id for kp in kps}
        is_scoped = bool(volume or chapter or section or kp_id)
        if is_scoped:
            questions = [
                q for q in questions
                if scoped_kp_ids.intersection(_label_ids(q, "knowledge_point"))
            ]
            scoped_question_ids = {q.id for q in questions}
            wrong_answers = [a for a in wrong_answers if a.question_id in scoped_question_ids]

        kp_map = {kp.id: kp for kp in kps}
        question_count = len(questions)
        status_counts = Counter(
            q.quality_status.value if hasattr(q.quality_status, "value") else str(q.quality_status)
            for q in questions
        )
        label_totals = Counter()
        issue_counts = Counter()
        issue_questions = []

        covered_questions = Counter()
        for q in questions:
            audit = audit_question_labels(q)
            for label in q.labels:
                label_totals[label.label_type] += 1
            # A question with several knowledge-point labels still counts once.
            for label_type in {label.label_type for label in q.labels}:
                covered_questions[label_type] += 1
            for issue in audit["issues"]:
                issue_counts[issue] += 1
            if audit["issues"]:
                issue_questions.append(self._serialize_issue_question(q, audit, kp_map))

        chapter_coverage = self._build_chapter_coverage(questions, kps)
        kp_coverage = self._build_kp_coverage(questions, kps)
        model_coverage = self._build_model_coverage(questions, kps)
        error_audit = self._build_error_audit(wrong_answers)
        # Site-wide, not narrowed by the question scope above.
        grading_metrics = await GradingQualityService(self.db).online_rates()

        complete_count = sum(1 for q in questions if audit_question_labels(q)["completeness"] == 1)
        health_score = round((complete_count / question_count) * 100, 1) if question_count else 0.0

        return {
            "summary": {
                "question_count": question_count,
                "approved_count": status_counts.get("approved", 0),
                "pending_count": status_counts.get("pending_review", 0),
                "draft_count": status_counts.get("draft", 0),
                "retired_count": status_counts.get("retired", 0),
                "label_complete_count": complete_count,
                "label_complete_rate": round(complete_count / question_count, 4) if question_count else 0.0,
                "health_score": health_score,
                # issue_questions below is capped for display; this is the full count.
                "issue_question_count": len(issue_questions),
            },
            "label_coverage": {
                label_type: {
                    # Questions carrying at least one label of this type.
                    "count": covered_questions.get(label_type, 0),
                    "rate": round(covered_questions.get(label_type, 0) / question_count, 4) if question_count else 0.0,
                    "label_count": label_totals.get(label_type, 0),
                }
                for label_type in REQUIRED_LABEL_TYPES
            },
            "issue_counts": dict(issue_counts),
            "issue_questions": issue_questions[:80],
            "chapter_coverage": chapter_coverage,
            "kp_coverage": kp_coverage,
            "model_coverage": model_coverage,
            "error_audit": error_audit,
            "grading_metrics": grading_metrics,
        }

    def _filter_kps(
        self,
        kps: list[KnowledgePoint],
        volume: str | None = None,
        chapter: str | None = None,
        section: str | None = None,
        kp_id: str | None = None,
    ) -> list[KnowledgePoint]:
        if kp_id:
            return [kp for kp in kps if kp.id == kp_id]
        return [
            kp for kp in kps
            if (not volume or kp.volume == volume)
            and (not chapter or kp.chapter == chapter)
            and (not section or kp.section == section)
        ]

    async def _load_questions(self) -> list[Question]:
        result = await self.db.execute(
            select(Question)
            .where(Question.quality_status != QualityStatus.retired)
            .options(
                selectinload(Question.labels),
                selectinload(Question.images),
                selectinload(Question.options),
            )
        )
        return list(result.scalars().unique().all())

    async def _load_kps(self) -> list[KnowledgePoint]:
        result = await self.db.execute(select(KnowledgePoint).order_by(KnowledgePoint.id))
        return list(result.scalars().all())

    async def _load_recent_wrong_answers(self) -> list[StudentAnswer]:
        result = await self.db.execute(
            select(StudentAnswer)
            .where(StudentAnswer.is_correct == False)
            .order_by(StudentAnswer.created_at.desc())
            .limit(120)
        )
        return list(result.scalars().all())

    def _serialize_issue_question(self, q: Question, audit: dict, kp_map: dict[str, KnowledgePoint]) -> dict:
        kp_ids = _label_ids(q, "knowledge_point")
        return {
            "id": q.id,
            "stem_preview": (q.stem_text or "")[:120],
            "status": q.quality_status.value if hasattr(q.quality_status, "value") else str(q.quality_status),
            "question_type": q.question_type.value if hasattr(q.question_type, "value") else q.question_type,
            "difficulty_tier": q.difficulty_tier.value if hasattr(q.difficulty_tier, "value") else q.difficulty_tier,
            "kp_ids": kp_ids,
            "kp_names": [kp_map[kp_id].name for kp_id in kp_ids if kp_id in kp_map],
            "missing_labels": audit["missing_labels"],
            "issues": audit["issues"],
            "completeness": audit["completeness"],
        }

    def _build_chapter_coverage(self, questions: list[Question], kps: list[KnowledgePoint]) -> list[dict]:
        kp_map = {kp.id: kp for kp in kps}
        kp_to_scope = {
            kp.id: (
                kp.volume or "未分册",
                kp.chapter or "未分章",
                kp.section or "未分节",
            )
            for kp in kps
        }
        chapter_kps: dict[tuple[str, str], set[str]] = defaultdict(set)
        for kp in kps:
            chapter_kps[(kp.volume or "未分册", kp.chapter or "未分章")].add(kp.id)

        chapter_questions: dict[tuple[str, str], set[str]] = defaultdict(set)
        chapter_tiers: dict[tuple[str, str], Counter] = defaultdict(Counter)
        kp_question_counts: Counter = Counter()
        for q in questions:
            tier = q.difficulty_tier.value if hasattr(q.difficulty_tier, "value") else q.difficulty_tier
            for kp_id in _label_ids(q, "knowledge_point"):
                scope = kp_to_scope.get(kp_id)
                if not scope:
                    continue
                key = (scope[0], scope[1])
                chapter_questions[key].add(q.id)
                chapter_tiers[key][tier or "unlabeled"] += 1
                kp_question_counts[kp_id] += 1

        rows = []
        for key, kp_ids in chapter_kps.items():
            volume, chapter = key
            empty_kps = [kp_id for kp_id in kp_ids if kp_question_counts[kp_id] == 0]
            empty_kp_details = [
                {
                    "kp_id": kp_id,
                    "kp_name": kp_map[kp_id].name,
                    "section": kp_map[kp_id].section,
                }
                for kp_id in sorted(empty_kps)
                if kp_id in kp_map
            ]
            rows.append({
                "volume": volume,
                "chapter": chapter,
                "kp_count": len(kp_ids),
                "question_count": len(chapter_questions.get(key, set())),
                "empty_kp_count": len(empty_kps),
                "empty_kp_ids": sorted(empty_kps)[:12],
                "empty_knowledge_points": empty_kp_details,
                "tier_counts": dict(chapter_tiers.get(key, Counter())),
            })
        return sorted(rows, key=lambda r: (r["volume"], r["chapter"]))

    def _build_kp_coverage(self, questions: list[Question], kps: list[KnowledgePoint]) -> list[dict]:
        counts: Counter = Counter()
        tier_counts: dict[str, Counter] = defaultdict(Counter)
        for q in questions:
            tier = q.difficulty_tier.value if hasattr(q.difficulty_tier, "value") else q.difficulty_tier
            for kp_id in _label_ids(q, "knowledge_point"):
                counts[kp_id] += 1
                tier_counts[kp_id][tier or "unlabeled"] += 1

        rows = []
        for kp in kps:
            count = counts[kp.id]
            rows.append({
                "kp_id": kp.id,
                "kp_name": kp.name,
                "volume": kp.volume,
                "chapter": kp.chapter,
                "section": kp.section,
                "question_count": count,
                "tier_counts": dict(tier_counts.get(kp.id, Counter())),
                "risk": "empty" if count == 0 else "thin" if count < 3 else "ok",
            })
        return sorted(rows, key=lambda r: (r["question_count"], r["volume"] or "", r["chapter"] or "", r["kp_id"]))

    def _build_model_coverage(self, questions: list[Question], kps: list[KnowledgePoint]) -> list[dict]:
        kp_to_chapter = {
            kp.id: (
                kp.volume or "未分册",
                kp.chapter or "未分章",
            )
            for kp in kps
        }
        counts: Counter = Counter()
        tier_counts: dict[str, Counter] = defaultdict(Counter)
        type_counts: dict[str, Counter] = defaultdict(Counter)
        chapter_questions: dict[str, dict[tuple[str, str], set[str]]] = defaultdict(lambda: defaultdict(set))
        chapter_tiers: dict[str, dict[tuple[str, str], Counter]] = defaultdict(lambda: defaultdict(Counter))
        chapter_types: dict[str, dict[tuple[str, str], Counter]] = defaultdict(lambda: defaultdict(Counter))

        for q in questions:
            tier = q.difficulty_tier.value if hasattr(q.difficulty_tier, "value") else q.difficulty_tier
            question_type = q.question_type.value if hasattr(q.question_type, "value") else q.question_type
            chapter_keys = {
                kp_to_chapter[kp_id]
                for kp_id in _label_ids(q, "knowledge_point")
                if kp_id in kp_to_chapter
            }
            for raw_model_id in _label_ids(q, "physics_model"):
                model_id = canonical_model_id(raw_model_id) or raw_model_id
                counts[model_id] += 1
                tier_counts[model_id][tier or "unlabeled"] += 1
                type_counts[model_id][question_type or "unknown"] += 1
                for chapter_key in chapter_keys:
                    chapter_questions[model_id][chapter_key].add(q.id)
                    chapter_tiers[model_id][chapter_key][tier or "unlabeled"] += 1
                    chapter_types[model_id][chapter_key][question_type or "unknown"] += 1

        def model_chapter_counts(model_id: str) -> list[dict]:
            rows = []
            for (volume, chapter), question_ids in chapter_questions.get(model_id, {}).items():
                rows.append({
                    "volume": volume,
                    "chapter": chapter,
                    "question_count": len(question_ids),
                    "tier_counts": dict(chapter_tiers[model_id].get((volume, chapter), Counter())),
                    "type_counts": dict(chapter_types[model_id].get((volume, chapter), Counter())),
                })
            return sorted(rows, key=lambda r: (r["volume"], r["chapter"]))

        rows = []
        for model in PHYSICS_MODELS:
            count = counts[model.id]
            rows.append({
                "model_id": model.id,
                "model_name": model.name,
                "domain": model.domain,
                "layer": model.layer,
                "question_count": count,
                "tier_counts": dict(tier_counts.get(model.id, Counter())),
                "type_counts": dict(type_counts.get(model.id, Counter())),
                "chapter_counts": model_chapter_counts(model.id),
                "risk": "empty" if count == 0 else "thin" if count < 5 else "ok",
            })
        extra_model_ids = [mid for mid in counts if mid not in MODEL_BY_ID]
        for model_id in extra_model_ids:
            rows.append({
                "model_id": model_id,
                "model_name": model_name(model_id),
                "domain": "未归类",
                "layer": "未归类",
                "question_count": counts[model_id],
                "tier_counts": dict(tier_counts.get(model_id, Counter())),
                "type_counts": dict(type_counts.get(model_id, Counter())),
                "chapter_counts": model_chapter_counts(model_id),
                "risk": "unknown_model",
            })
        return sorted(rows, key=lambda r: (r["risk"] == "ok", r["question_count"], r["domain"], r["model_id"]))

    def _build_error_audit(self, wrong_answers: list[StudentAnswer]) -> dict:
        error_counts: Counter = Counter()
        samples = []
        for answer in wrong_answers:
            grading = answer.grading_result if isinstance(answer.grading_result, dict) else {}
            error_type = grading.get("error_type") or "unknown"
            error_counts[error_type] += 1
            if grading:
                samples.append({
                    "answer_id": answer.id,
                    "question_id": answer.question_id,
                    "error_type": error_type,
                    "error_type_name": grading.get("error_type_name") or error_type_name(error_type),
                    "first_error": grading.get("first_error") or "",
                    "feedback": grading.get("feedback") or "",
                    "created_at": answer.created_at.isoformat() if answer.created_at else None,
                })
        return {
            "error_counts": [
                {
                    "error_type": error_type,
                    "error_type_name": error_type_name(error_type),
                    "count": count,
                }
                for error_type, count in error_counts.most_common()
            ],
            "samples": samples[:50],
        }
