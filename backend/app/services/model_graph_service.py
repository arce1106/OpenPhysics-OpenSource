from sqlalchemy.ext.asyncio import AsyncSession

from app.services.knowledge_service import KnowledgeService
from app.services.learning_state_rules import STABLE_MASTERY_THRESHOLD
from app.services.physics_models import (
    MODEL_BY_ID,
    PHYSICS_MODELS,
    canonical_model_id,
    infer_model_ids_from_kp,
)
from app.services.question_service import QuestionService
from app.services.student_service import StudentService


class ModelGraphService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.knowledge_svc = KnowledgeService(db)
        self.question_svc = QuestionService(db)
        self.student_svc = StudentService(db)

    async def build_for_student(self, student_id: str) -> dict:
        all_kps = await self.knowledge_svc.get_all_points()
        all_questions = await self.question_svc.get_approved_questions_with_labels()
        mastery_list = await self.student_svc.get_all_mastery(student_id)

        kp_map = {kp.id: kp for kp in all_kps}
        mastery_map = {m.knowledge_point_id: m.mastery for m in mastery_list}

        model_kps: dict[str, set[str]] = {model.id: set() for model in PHYSICS_MODELS}
        model_questions: dict[str, set[str]] = {model.id: set() for model in PHYSICS_MODELS}

        for kp in all_kps:
            for model_id in infer_model_ids_from_kp(kp.name, kp.chapter, kp.section):
                if model_id in MODEL_BY_ID:
                    model_kps[model_id].add(kp.id)

        for question in all_questions:
            labels_by_type: dict[str, list[str]] = {}
            for label in question.labels:
                labels_by_type.setdefault(label.label_type, []).append(label.label_id)

            kp_ids = labels_by_type.get("knowledge_point", [])
            raw_model_ids = labels_by_type.get("physics_model", [])
            model_ids = [
                canonical
                for raw in raw_model_ids
                if (canonical := canonical_model_id(raw)) in MODEL_BY_ID
            ]

            if not model_ids:
                for kp_id in kp_ids:
                    kp = kp_map.get(kp_id)
                    if kp:
                        model_ids.extend(infer_model_ids_from_kp(kp.name, kp.chapter, kp.section))

            for model_id in dict.fromkeys(model_ids):
                if model_id not in MODEL_BY_ID:
                    continue
                model_questions[model_id].add(question.id)
                for kp_id in kp_ids:
                    if kp_id in kp_map:
                        model_kps[model_id].add(kp_id)

        nodes = []
        for model in PHYSICS_MODELS:
            kp_ids = sorted(model_kps[model.id])
            question_count = len(model_questions[model.id])
            kp_masteries = [mastery_map.get(kp_id, 0.0) for kp_id in kp_ids]
            mastery = sum(kp_masteries) / len(kp_masteries) if kp_masteries else 0.0
            if mastery >= STABLE_MASTERY_THRESHOLD:
                status = "mastered"
            elif mastery > 0:
                status = "current"
            elif kp_ids or question_count > 0:
                status = "needs_learning"
            else:
                status = "upcoming"

            nodes.append({
                "id": model.id,
                "name": model.name,
                "domain": model.domain,
                "layer": model.layer,
                "description": model.description,
                "core_equations": model.core_equations,
                "typical_errors": model.typical_errors,
                "kp_ids": kp_ids,
                "kp_names": [kp_map[kp_id].name for kp_id in kp_ids if kp_id in kp_map],
                "question_count": question_count,
                "mastery": mastery,
                "weakness": 1.0 - mastery if kp_ids else 0.0,
                "status": status,
            })

        relations = []
        relation_id = 1
        for model in PHYSICS_MODELS:
            for prereq in model.prerequisites:
                canonical = canonical_model_id(prereq)
                if canonical in MODEL_BY_ID:
                    relations.append({
                        "id": relation_id,
                        "source_id": canonical,
                        "target_id": model.id,
                        "relation_type": "prerequisite",
                        "reason": "先掌握前置模型，再进入当前模型",
                    })
                    relation_id += 1
            for target in model.transfer_targets:
                canonical = canonical_model_id(target)
                if canonical in MODEL_BY_ID:
                    relations.append({
                        "id": relation_id,
                        "source_id": model.id,
                        "target_id": canonical,
                        "relation_type": "transfer",
                        "reason": "模型情境迁移",
                    })
                    relation_id += 1

        active_nodes = [node for node in nodes if node["kp_ids"] or node["question_count"] > 0]
        weak_nodes = [node for node in active_nodes if node["mastery"] < STABLE_MASTERY_THRESHOLD]

        return {
            "nodes": nodes,
            "relations": relations,
            "summary": {
                "total_models": len(nodes),
                "active_models": len(active_nodes),
                "weak_models": len(weak_nodes),
            },
        }
