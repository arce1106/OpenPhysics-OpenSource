from collections import defaultdict
from typing import Any

from sqlalchemy import select, tuple_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.knowledge import KnowledgePoint
from app.models.learning_catalog import (
    LearningCatalog,
    LearningCatalogNode,
    LearningCatalogNodeEvidence,
    LearningCatalogNodeKnowledgePoint,
    LearningCatalogNodeLabelRule,
    LearningCatalogNodeQuestionOverride,
)
from app.models.question import QualityStatus, Question, QuestionLabel, QuestionType
from app.models.student import StudentAnswer
from app.services.knowledge_service import knowledge_point_order_key, practicable_kp_ids_query
from app.services.learning_state_rules import STABLE_MASTERY_THRESHOLD
from app.services.mastery_scope import includes_basic_mastery, loaded_question, topic_updates_basic, topic_answer_score
from app.services.question_ordering import ordered_questions_for_student


TOPIC_LAYER_DIFFICULTY_PREFERENCE = {
    "diagnostic": [
        "moderate_easy",
        "medium",
        "moderate_hard",
        "easy",
        "hard",
    ],
    "foundation": ["easy", "moderate_easy"],
    "breakthrough": ["medium"],
    "transfer": ["moderate_hard", "hard"],
    "paper": ["moderate_easy", "medium", "moderate_hard", "hard", "easy"],
}

TopicLayerQuotas = dict[str, tuple[tuple[str, int], ...]]

QUESTION_TYPE_BUCKETS = {
    "single_choice": frozenset({QuestionType.single_choice}),
    "multiple_choice": frozenset({QuestionType.multiple_choice}),
    "experiment": frozenset({QuestionType.experiment}),
    "calculation": frozenset(
        {QuestionType.problem_solving, QuestionType.comprehensive}
    ),
}

REGULAR_TOPIC_LAYER_QUOTAS: TopicLayerQuotas = {
    "foundation": (
        ("single_choice", 3),
        ("multiple_choice", 1),
        ("experiment", 1),
    ),
    "breakthrough": (
        ("single_choice", 1),
        ("multiple_choice", 1),
        ("experiment", 1),
        ("calculation", 1),
    ),
    "transfer": (
        ("single_choice", 1),
        ("multiple_choice", 1),
        ("calculation", 2),
    ),
}

NO_EXPERIMENT_TOPIC_LAYER_QUOTAS: TopicLayerQuotas = {
    "foundation": (
        ("single_choice", 3),
        ("multiple_choice", 1),
        ("calculation", 1),
    ),
    "breakthrough": (
        ("single_choice", 1),
        ("multiple_choice", 1),
        ("calculation", 2),
    ),
    "transfer": (
        ("single_choice", 1),
        ("multiple_choice", 1),
        ("calculation", 2),
    ),
}

LIMITED_EXPERIMENT_TOPIC_LAYER_QUOTAS: TopicLayerQuotas = {
    "foundation": (
        ("single_choice", 3),
        ("multiple_choice", 1),
        ("calculation", 1),
    ),
    "breakthrough": (
        ("single_choice", 1),
        ("multiple_choice", 1),
        ("experiment", 1),
        ("calculation", 1),
    ),
    "transfer": (
        ("single_choice", 1),
        ("multiple_choice", 1),
        ("calculation", 2),
    ),
}

EXPERIMENT_TOPIC_LAYER_QUOTAS: TopicLayerQuotas = {
    "foundation": (
        ("single_choice", 2),
        ("multiple_choice", 1),
        ("experiment", 2),
    ),
    "breakthrough": (
        ("single_choice", 1),
        ("multiple_choice", 1),
        ("experiment", 2),
    ),
    "transfer": (
        ("multiple_choice", 1),
        ("experiment", 2),
        ("calculation", 1),
    ),
}

TOPIC_LAYER_QUOTA_PROFILES: dict[str, TopicLayerQuotas] = {
    "gaokao_topic_05": NO_EXPERIMENT_TOPIC_LAYER_QUOTAS,
    "gaokao_topic_11": NO_EXPERIMENT_TOPIC_LAYER_QUOTAS,
    "gaokao_topic_14": EXPERIMENT_TOPIC_LAYER_QUOTAS,
    "gaokao_topic_15": EXPERIMENT_TOPIC_LAYER_QUOTAS,
    "gaokao_topic_16": EXPERIMENT_TOPIC_LAYER_QUOTAS,
    "gaokao_topic_19": LIMITED_EXPERIMENT_TOPIC_LAYER_QUOTAS,
}

TOPIC_LAYER_QUESTION_COUNTS = {
    "foundation": 5,
    "breakthrough": 4,
    "transfer": 4,
}

TOPIC_TRAINING_LAYERS = tuple(TOPIC_LAYER_QUESTION_COUNTS)

DIFFICULTY_TIER_RANK = {
    "easy": 0,
    "moderate_easy": 1,
    "medium": 2,
    "moderate_hard": 3,
    "hard": 4,
}

TOPIC_LAYER_NAMES = {
    "diagnostic": "专题摸底",
    "foundation": "基础巩固",
    "breakthrough": "典型突破",
    "transfer": "综合迁移",
    "paper": "专题套卷",
}

CATALOG_MASTERY_EVIDENCE_WEIGHT = 0.45


class LearningCatalogService:
    """Read catalog trees and resolve broad topics onto the canonical question bank."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_catalogs(self, include_disabled: bool = False) -> list[dict[str, Any]]:
        statement = select(LearningCatalog).order_by(LearningCatalog.sort_order)
        if not include_disabled:
            statement = statement.where(LearningCatalog.enabled.is_(True))
        catalogs = list((await self.db.scalars(statement)).all())

        nodes = list(
            (
                await self.db.scalars(
                    select(LearningCatalogNode).where(
                        LearningCatalogNode.catalog_id.in_(
                            [catalog.id for catalog in catalogs]
                        )
                    )
                )
            ).all()
        ) if catalogs else []
        node_counts: dict[str, int] = defaultdict(int)
        topic_counts: dict[str, int] = defaultdict(int)
        for node in nodes:
            node_counts[node.catalog_id] += 1
            if node.node_type == "topic":
                topic_counts[node.catalog_id] += 1

        return [
            {
                "id": catalog.id,
                "code": catalog.code,
                "name": catalog.name,
                "description": catalog.description,
                "version": catalog.version,
                "enabled": catalog.enabled,
                "sort_order": catalog.sort_order,
                "config": catalog.config or {},
                "node_count": node_counts[catalog.id],
                "topic_count": topic_counts[catalog.id],
            }
            for catalog in catalogs
        ]

    async def get_catalog(
        self,
        catalog_code: str,
        *,
        include_mappings: bool = False,
        include_disabled: bool = False,
        practicable_only: bool = False,
    ) -> dict[str, Any] | None:
        catalog_statement = select(LearningCatalog).where(
            LearningCatalog.code == catalog_code
        )
        if not include_disabled:
            catalog_statement = catalog_statement.where(
                LearningCatalog.enabled.is_(True)
            )
        catalog = await self.db.scalar(catalog_statement)
        if not catalog:
            return None

        if (catalog.config or {}).get("source_mode") == "knowledge_point_taxonomy":
            return await self._get_knowledge_point_taxonomy_catalog(
                catalog,
                include_mappings=include_mappings,
                practicable_only=practicable_only,
            )

        node_statement = (
            select(LearningCatalogNode)
            .where(LearningCatalogNode.catalog_id == catalog.id)
            .order_by(
                LearningCatalogNode.parent_id.nulls_first(),
                LearningCatalogNode.sort_order,
                LearningCatalogNode.id,
            )
        )
        if not include_disabled:
            node_statement = node_statement.where(
                LearningCatalogNode.enabled.is_(True)
            )
        nodes = list((await self.db.scalars(node_statement)).all())
        node_ids = [node.id for node in nodes]

        mappings_by_node: dict[str, list[dict[str, Any]]] = defaultdict(list)
        rules_by_node: dict[str, list[dict[str, Any]]] = defaultdict(list)
        overrides_by_node: dict[str, list[dict[str, Any]]] = defaultdict(list)
        if node_ids:
            mapping_rows = (
                await self.db.execute(
                    select(
                        LearningCatalogNodeKnowledgePoint,
                        KnowledgePoint.name,
                    )
                    .join(
                        KnowledgePoint,
                        KnowledgePoint.id
                        == LearningCatalogNodeKnowledgePoint.knowledge_point_id,
                    )
                    .where(
                        LearningCatalogNodeKnowledgePoint.node_id.in_(node_ids)
                    )
                    .order_by(
                        LearningCatalogNodeKnowledgePoint.node_id,
                        LearningCatalogNodeKnowledgePoint.sort_order,
                        LearningCatalogNodeKnowledgePoint.knowledge_point_id,
                    )
                )
            ).all()
            for mapping, kp_name in mapping_rows:
                mappings_by_node[mapping.node_id].append(
                    {
                        "knowledge_point_id": mapping.knowledge_point_id,
                        "knowledge_point_name": kp_name,
                        "role": mapping.role,
                        "weight": mapping.weight,
                        "sort_order": mapping.sort_order,
                    }
                )

            rules = list(
                (
                    await self.db.scalars(
                        select(LearningCatalogNodeLabelRule)
                        .where(LearningCatalogNodeLabelRule.node_id.in_(node_ids))
                        .order_by(
                            LearningCatalogNodeLabelRule.node_id,
                            LearningCatalogNodeLabelRule.sort_order,
                            LearningCatalogNodeLabelRule.id,
                        )
                    )
                ).all()
            )
            for rule in rules:
                rules_by_node[rule.node_id].append(
                    {
                        "id": rule.id,
                        "label_type": rule.label_type,
                        "label_id": rule.label_id,
                        "action": rule.action,
                        "weight": rule.weight,
                        "sort_order": rule.sort_order,
                    }
                )

            overrides = list(
                (
                    await self.db.scalars(
                        select(LearningCatalogNodeQuestionOverride)
                        .where(
                            LearningCatalogNodeQuestionOverride.node_id.in_(node_ids)
                        )
                        .order_by(
                            LearningCatalogNodeQuestionOverride.node_id,
                            LearningCatalogNodeQuestionOverride.priority.desc(),
                            LearningCatalogNodeQuestionOverride.question_id,
                        )
                    )
                ).all()
            )
            for override in overrides:
                overrides_by_node[override.node_id].append(
                    {
                        "question_id": override.question_id,
                        "action": override.action,
                        "priority": override.priority,
                        "note": override.note,
                    }
                )

        node_payloads: dict[str, dict[str, Any]] = {}
        children_by_parent: dict[str | None, list[dict[str, Any]]] = defaultdict(list)
        for node in nodes:
            mappings = mappings_by_node[node.id]
            rules = rules_by_node[node.id]
            overrides = overrides_by_node[node.id]
            payload = {
                "id": node.id,
                "code": node.code,
                "node_type": node.node_type,
                "title": node.title,
                "description": node.description,
                "sort_order": node.sort_order,
                "config": node.config or {},
                "mapping_summary": {
                    "knowledge_point_count": len(mappings),
                    "label_rule_count": len(rules),
                    "question_override_count": len(overrides),
                },
                "children": [],
            }
            if include_mappings:
                payload["knowledge_points"] = mappings
                payload["label_rules"] = rules
                payload["question_overrides"] = overrides
            node_payloads[node.id] = payload
            children_by_parent[node.parent_id].append(payload)

        for node in nodes:
            node_payloads[node.id]["children"] = children_by_parent[node.id]

        return {
            "id": catalog.id,
            "code": catalog.code,
            "name": catalog.name,
            "description": catalog.description,
            "version": catalog.version,
            "enabled": catalog.enabled,
            "sort_order": catalog.sort_order,
            "config": catalog.config or {},
            "node_count": len(nodes),
            "topic_count": sum(node.node_type == "topic" for node in nodes),
            "nodes": children_by_parent[None],
        }

    async def _get_knowledge_point_taxonomy_catalog(
        self,
        catalog: LearningCatalog,
        *,
        include_mappings: bool,
        practicable_only: bool = False,
    ) -> dict[str, Any]:
        """Adapt canonical textbook KPs to the same tree contract as curated catalogs.

        Browsing includes empty chapters; practice selectors can still request only usable KPs.
        """
        statement = select(KnowledgePoint).order_by(KnowledgePoint.id)
        if practicable_only:
            statement = statement.where(KnowledgePoint.id.in_(practicable_kp_ids_query()))
        knowledge_points = sorted((await self.db.scalars(statement)).all(), key=knowledge_point_order_key)
        volumes: dict[str, dict[str, Any]] = {}
        node_count = 0

        for kp in knowledge_points:
            volume_title = kp.volume or "未分册"
            chapter_title = kp.chapter or "未分章"
            section_title = kp.section or "未分节"
            volume = volumes.setdefault(
                volume_title,
                {
                    "title": volume_title,
                    "chapters": {},
                    "knowledge_point_count": 0,
                },
            )
            chapter = volume["chapters"].setdefault(
                chapter_title,
                {
                    "title": chapter_title,
                    "sections": {},
                    "knowledge_point_count": 0,
                },
            )
            section = chapter["sections"].setdefault(
                section_title,
                {
                    "title": section_title,
                    "knowledge_points": [],
                },
            )
            section["knowledge_points"].append(kp)
            volume["knowledge_point_count"] += 1
            chapter["knowledge_point_count"] += 1

        volume_nodes: list[dict[str, Any]] = []
        for volume_index, (volume_title, volume) in enumerate(
            volumes.items(),
            start=1,
        ):
            chapter_nodes: list[dict[str, Any]] = []
            for chapter_index, (chapter_title, chapter) in enumerate(
                volume["chapters"].items(),
                start=1,
            ):
                section_nodes: list[dict[str, Any]] = []
                for section_index, (section_title, section) in enumerate(
                    chapter["sections"].items(),
                    start=1,
                ):
                    kp_nodes: list[dict[str, Any]] = []
                    for kp_index, kp in enumerate(
                        section["knowledge_points"],
                        start=1,
                    ):
                        kp_node = {
                            "id": f"sync_kp:{kp.id}",
                            "code": kp.id,
                            "node_type": "knowledge_point",
                            "title": kp.name,
                            "description": kp.description,
                            "sort_order": kp_index,
                            "config": {
                                "knowledge_point_id": kp.id,
                                "difficulty": kp.difficulty,
                            },
                            "mapping_summary": {
                                "knowledge_point_count": 1,
                                "label_rule_count": 0,
                                "question_override_count": 0,
                            },
                            "children": [],
                        }
                        if include_mappings:
                            kp_node["knowledge_points"] = [
                                {
                                    "knowledge_point_id": kp.id,
                                    "knowledge_point_name": kp.name,
                                    "role": "core",
                                    "weight": 1.0,
                                    "sort_order": 1,
                                }
                            ]
                            kp_node["label_rules"] = []
                            kp_node["question_overrides"] = []
                        kp_nodes.append(kp_node)

                    section_nodes.append(
                        {
                            "id": (
                                f"sync_section:{volume_index}:"
                                f"{chapter_index}:{section_index}"
                            ),
                            "code": (
                                f"section_{volume_index}_"
                                f"{chapter_index}_{section_index}"
                            ),
                            "node_type": "section",
                            "title": section_title,
                            "description": None,
                            "sort_order": section_index,
                            "config": {},
                            "mapping_summary": {
                                "knowledge_point_count": len(kp_nodes),
                                "label_rule_count": 0,
                                "question_override_count": 0,
                            },
                            "children": kp_nodes,
                        }
                    )
                    node_count += 1 + len(kp_nodes)

                chapter_nodes.append(
                    {
                        "id": f"sync_chapter:{volume_index}:{chapter_index}",
                        "code": f"chapter_{volume_index}_{chapter_index}",
                        "node_type": "chapter",
                        "title": chapter_title,
                        "description": None,
                        "sort_order": chapter_index,
                        "config": {},
                        "mapping_summary": {
                            "knowledge_point_count": chapter[
                                "knowledge_point_count"
                            ],
                            "label_rule_count": 0,
                            "question_override_count": 0,
                        },
                        "children": section_nodes,
                    }
                )
                node_count += 1

            volume_nodes.append(
                {
                    "id": f"sync_volume:{volume_index}",
                    "code": f"volume_{volume_index}",
                    "node_type": "volume",
                    "title": volume_title,
                    "description": None,
                    "sort_order": volume_index,
                    "config": {},
                    "mapping_summary": {
                        "knowledge_point_count": volume[
                            "knowledge_point_count"
                        ],
                        "label_rule_count": 0,
                        "question_override_count": 0,
                    },
                    "children": chapter_nodes,
                }
            )
            node_count += 1

        return {
            "id": catalog.id,
            "code": catalog.code,
            "name": catalog.name,
            "description": catalog.description,
            "version": catalog.version,
            "enabled": catalog.enabled,
            "sort_order": catalog.sort_order,
            "config": catalog.config or {},
            "node_count": node_count,
            "topic_count": 0,
            "nodes": volume_nodes,
        }

    async def resolve_question_ids(
        self,
        node_id: str,
        *,
        approved_only: bool = True,
    ) -> list[str]:
        """Resolve a broad topic into questions.

        Canonical KP mappings and include-label rules add candidates. Exclusion
        rules remove candidates. Explicit question overrides are applied last.
        """
        node = await self.db.get(LearningCatalogNode, node_id)
        if not node:
            raise LookupError(f"Learning catalog node not found: {node_id}")

        mapping_rows = list(
            (
                await self.db.scalars(
                    select(LearningCatalogNodeKnowledgePoint).where(
                        LearningCatalogNodeKnowledgePoint.node_id == node_id
                    )
                )
            ).all()
        )
        core_mapping_rows = [row for row in mapping_rows if row.role == "core"]
        candidate_mapping_rows = core_mapping_rows or mapping_rows
        kp_ids = [row.knowledge_point_id for row in candidate_mapping_rows]
        rules = list(
            (
                await self.db.scalars(
                    select(LearningCatalogNodeLabelRule).where(
                        LearningCatalogNodeLabelRule.node_id == node_id
                    )
                )
            ).all()
        )
        overrides = list(
            (
                await self.db.scalars(
                    select(LearningCatalogNodeQuestionOverride).where(
                        LearningCatalogNodeQuestionOverride.node_id == node_id
                    )
                )
            ).all()
        )

        async def labeled_question_ids(
            *,
            knowledge_point_ids: list[str] | None = None,
            label_pairs: list[tuple[str, str]] | None = None,
        ) -> set[str]:
            statement = select(QuestionLabel.question_id).join(
                Question,
                Question.id == QuestionLabel.question_id,
            )
            if knowledge_point_ids:
                statement = statement.where(
                    QuestionLabel.label_type == "knowledge_point",
                    QuestionLabel.label_id.in_(knowledge_point_ids),
                )
            elif label_pairs:
                statement = statement.where(
                    tuple_(
                        QuestionLabel.label_type,
                        QuestionLabel.label_id,
                    ).in_(label_pairs)
                )
            else:
                return set()
            if approved_only:
                statement = statement.where(
                    Question.quality_status == QualityStatus.approved
                )
            return set((await self.db.scalars(statement)).all())

        candidates = await labeled_question_ids(knowledge_point_ids=kp_ids)
        include_pairs = [
            (rule.label_type, rule.label_id)
            for rule in rules
            if rule.action == "include"
        ]
        exclude_pairs = [
            (rule.label_type, rule.label_id)
            for rule in rules
            if rule.action == "exclude"
        ]
        candidates.update(await labeled_question_ids(label_pairs=include_pairs))
        candidates.difference_update(
            await labeled_question_ids(label_pairs=exclude_pairs)
        )

        include_override_ids = {
            override.question_id
            for override in overrides
            if override.action == "include"
        }
        if approved_only and include_override_ids:
            include_override_ids = set(
                (
                    await self.db.scalars(
                        select(Question.id).where(
                            Question.id.in_(include_override_ids),
                            Question.quality_status == QualityStatus.approved,
                        )
                    )
                ).all()
            )
        candidates.update(include_override_ids)
        candidates.difference_update(
            override.question_id
            for override in overrides
            if override.action == "exclude"
        )
        return sorted(candidates)

    async def get_topic_overview(
        self,
        student_id: str,
        catalog_code: str,
        node_id: str,
    ) -> dict[str, Any] | None:
        node = await self._get_topic_node(catalog_code, node_id)
        if not node:
            return None

        mapping_rows = list(
            (
                await self.db.scalars(
                    select(LearningCatalogNodeKnowledgePoint)
                    .where(
                        LearningCatalogNodeKnowledgePoint.node_id == node_id
                    )
                    .order_by(
                        LearningCatalogNodeKnowledgePoint.sort_order,
                        LearningCatalogNodeKnowledgePoint.knowledge_point_id,
                    )
                )
            ).all()
        )
        core_rows = [row for row in mapping_rows if row.role == "core"] or mapping_rows
        core_kp_ids = [row.knowledge_point_id for row in core_rows]
        evidence_rows = list(
            (
                await self.db.scalars(
                    select(LearningCatalogNodeEvidence)
                    .where(
                        LearningCatalogNodeEvidence.student_id == student_id,
                        LearningCatalogNodeEvidence.node_id == node_id,
                    )
                    .order_by(
                        LearningCatalogNodeEvidence.created_at,
                        LearningCatalogNodeEvidence.id,
                    )
                )
            ).all()
        )
        core_kp_set = set(core_kp_ids)
        attempts_by_kp: dict[str, int] = defaultdict(int)
        mastery_by_kp: dict[str, float] = defaultdict(float)
        for evidence in evidence_rows:
            kp_id = evidence.knowledge_point_id
            if not kp_id or kp_id not in core_kp_set:
                continue
            attempts_by_kp[kp_id] += 1
            previous = mastery_by_kp[kp_id]
            mastery_by_kp[kp_id] = previous + (
                evidence.score - previous
            ) * CATALOG_MASTERY_EVIDENCE_WEIGHT

        total = len(core_kp_ids)
        attempted = sum(
            1
            for kp_id in core_kp_ids
            if attempts_by_kp.get(kp_id, 0) > 0
        )
        mastered = sum(
            1
            for kp_id in core_kp_ids
            if mastery_by_kp.get(kp_id, 0.0) >= STABLE_MASTERY_THRESHOLD
        )
        needs_review = sum(
            1
            for kp_id in core_kp_ids
            if attempts_by_kp.get(kp_id, 0) > 0
            and mastery_by_kp.get(kp_id, 0.0) < STABLE_MASTERY_THRESHOLD
        )
        average_mastery = (
            sum(
                mastery_by_kp.get(kp_id, 0.0)
                for kp_id in core_kp_ids
            )
            / total
            if total
            else 0.0
        )
        coverage = attempted / total if total else 0.0
        evidence_count = len(evidence_rows)
        performance_score = sum(row.score for row in evidence_rows) / evidence_count if evidence_count else None
        layer_performance = []
        for layer, name in TOPIC_LAYER_NAMES.items():
            scores = [row.score for row in evidence_rows if row.layer == layer]
            layer_performance.append({"layer": layer, "name": name, "evidence_count": len(scores),
                "performance_score": round(sum(scores) / len(scores), 4) if scores else None})

        if evidence_count == 0:
            status = "not_started"
            status_label = "尚未摸底"
            recommended_layer = "diagnostic"
            next_action = "先用少量代表性题目判断本专题从哪一层开始。"
        elif total and mastered == total:
            status = "stable"
            status_label = "整体较稳定"
            recommended_layer = "transfer"
            next_action = "核心知识点已较稳定，建议进入综合迁移。"
        elif coverage < 0.35:
            status = "in_progress"
            status_label = "待补充检测"
            recommended_layer = "diagnostic"
            next_action = "未练知识点仍待检测，建议补充专题摸底，已练表现单独记录。"
        elif performance_score is not None and performance_score < 0.5:
            status = "needs_review"
            status_label = "需要巩固"
            recommended_layer = "foundation"
            next_action = "已练题目仍有较多失分，建议从基础巩固开始复盘。"
        elif performance_score is not None and performance_score < STABLE_MASTERY_THRESHOLD:
            status = "in_progress"
            status_label = "正在提升"
            recommended_layer = "breakthrough"
            next_action = "已练题目已有一定得分，建议进入典型模型和关键方法突破。"
        else:
            status = "in_progress"
            status_label = "可以迁移"
            recommended_layer = "transfer"
            next_action = "已练题目表现较好，可以尝试综合情境训练，并继续检测未练知识点。"

        last_practiced_values = [row.created_at for row in evidence_rows]
        last_practiced = max(last_practiced_values) if last_practiced_values else None

        return {
            "catalog_code": catalog_code,
            "node_id": node.id,
            "topic_code": str((node.config or {}).get("display_code") or node.code),
            "title": node.title,
            "description": node.description,
            "status": status,
            "status_label": status_label,
            "recommended_layer": recommended_layer,
            "recommended_layer_name": TOPIC_LAYER_NAMES[recommended_layer],
            "next_action": next_action,
            "core_knowledge_point_count": total,
            "attempted_knowledge_point_count": attempted,
            "mastered_knowledge_point_count": mastered,
            "needs_review_knowledge_point_count": needs_review,
            "average_mastery": round(average_mastery, 4),
            "performance_score": round(performance_score, 4) if performance_score is not None else None,
            "evidence_count": evidence_count,
            "untested_knowledge_point_count": total - attempted,
            "coverage_ratio": round(coverage, 4),
            "layer_performance": layer_performance,
            "last_practiced": (
                last_practiced.isoformat()
                if last_practiced
                else None
            ),
        }

    async def get_resume_topic(
        self,
        student_id: str,
        catalog_code: str,
    ) -> dict[str, Any] | None:
        """Return the student's most recently practiced topic in a catalog."""
        catalog_id = await self.db.scalar(
            select(LearningCatalog.id).where(
                LearningCatalog.code == catalog_code,
                LearningCatalog.enabled.is_(True),
            )
        )
        if not catalog_id:
            return None

        latest = (
            await self.db.execute(
                select(
                    LearningCatalogNodeEvidence.node_id,
                    LearningCatalogNodeEvidence.created_at,
                )
                .join(
                    LearningCatalogNode,
                    LearningCatalogNode.id == LearningCatalogNodeEvidence.node_id,
                )
                .where(
                    LearningCatalogNodeEvidence.student_id == student_id,
                    LearningCatalogNode.catalog_id == catalog_id,
                    LearningCatalogNode.node_type == "topic",
                    LearningCatalogNode.enabled.is_(True),
                )
                .order_by(
                    LearningCatalogNodeEvidence.created_at.desc(),
                    LearningCatalogNodeEvidence.id.desc(),
                )
                .limit(1)
            )
        ).first()

        return {
            "catalog_code": catalog_code,
            "node_id": latest.node_id if latest else None,
            "last_practiced": latest.created_at.isoformat() if latest else None,
        }

    async def record_topic_answer(
        self,
        student_id: str,
        catalog_code: str,
        node_id: str,
        *,
        answer_id: int,
        layer: str,
        commit: bool = True,
    ) -> bool | None:
        """Attribute an existing graded answer to a catalog topic, idempotently."""
        node = await self._get_topic_node(catalog_code, node_id)
        if not node:
            return None
        if layer not in TOPIC_LAYER_NAMES:
            raise ValueError(f"Invalid topic layer: {layer}")

        answer = await self.db.scalar(
            select(StudentAnswer).where(
                StudentAnswer.id == answer_id,
                StudentAnswer.student_id == student_id,
            )
        )
        if not answer:
            raise LookupError("Student answer not found")

        candidate_ids = set(await self.resolve_question_ids(node_id))
        if answer.question_id not in candidate_ids:
            # A durable teacher paper keeps the questions captured when opened,
            # even after the live bank or topic mapping changes.
            from app.models.teacher_paper import TeacherPaperAttempt
            attempt = await self.db.get(TeacherPaperAttempt, answer.teacher_paper_attempt_id) if answer.teacher_paper_attempt_id else None
            if not (attempt and attempt.student_id == student_id
                    and attempt.catalog_code == catalog_code and attempt.node_id == node_id
                    and layer == "paper" and answer.question_id in attempt.question_ids):
                raise ValueError("Answer question does not belong to this topic")

        mapping_rows = list(
            (
                await self.db.scalars(
                    select(LearningCatalogNodeKnowledgePoint).where(
                        LearningCatalogNodeKnowledgePoint.node_id == node_id
                    )
                )
            ).all()
        )
        core_mapping_rows = [row for row in mapping_rows if row.role == "core"]
        evidence_mapping_rows = core_mapping_rows or mapping_rows
        evidence_kp_ids = {
            row.knowledge_point_id for row in evidence_mapping_rows
        }
        grading_result = (
            answer.grading_result
            if isinstance(answer.grading_result, dict)
            else {}
        )
        from app.services.student_service import StudentService
        context = {"catalog_code": catalog_code, "node_id": node_id, "layer": layer}
        stored_context = grading_result.get("_topic_context")
        if stored_context and stored_context != context:
            raise ValueError("Answer already belongs to a different topic context")
        question = await loaded_question(self.db, answer.question_id)
        knowledge_point_id = StudentService._evidence_kp_from_grading(grading_result)
        if knowledge_point_id not in evidence_kp_ids:
            knowledge_point_id = StudentService._primary_kp_from_loaded_question(question, evidence_kp_ids)
        update_basic = (includes_basic_mastery(grading_result)
                        if stored_context == context and grading_result.get("_mastery_scope") in {"basic", "topic_only"}
                        else topic_updates_basic(context, question))
        prior_kp = StudentService._evidence_kp_from_grading(grading_result) or StudentService._primary_kp_from_loaded_question(question)
        service = StudentService(self.db)
        if not update_basic and includes_basic_mastery(grading_result) and prior_kp:
            # Serialize legacy reattribution with normal grading and corrections.
            await service._get_or_create_mastery(student_id, prior_kp)
            await self.db.refresh(answer)
            grading_result = dict(answer.grading_result or {})
            if grading_result.get("_topic_context") not in (None, context):
                raise ValueError("Answer already belongs to a different topic context")
        was_basic = includes_basic_mastery(grading_result)
        next_grading = {**grading_result, "_topic_context": context,
                        "_mastery_scope": "basic" if update_basic else "topic_only"}
        if not update_basic:
            if was_basic:
                next_grading["_previous_basic_mastery_update"] = grading_result.get("_mastery_update")
            next_grading["_mastery_update"] = {}
        answer.grading_result = next_grading
        await self.db.flush()
        if was_basic and not update_basic and prior_kp:
            await service.rebuild_mastery_for_kp(student_id, prior_kp, refresh_answer_snapshots=True)
        score = topic_answer_score(answer)
        evidence_insert = pg_insert(LearningCatalogNodeEvidence).values(
            student_id=student_id,
            node_id=node_id,
            answer_id=answer.id,
            question_id=answer.question_id,
            knowledge_point_id=knowledge_point_id,
            layer=layer,
            score=score,
        )
        result = await self.db.execute(
            evidence_insert.on_conflict_do_update(
                constraint="uq_learning_catalog_node_evidence_answer",
                set_={
                    "question_id": evidence_insert.excluded.question_id,
                    "knowledge_point_id": evidence_insert.excluded.knowledge_point_id,
                    "layer": evidence_insert.excluded.layer,
                    "score": evidence_insert.excluded.score,
                },
            )
        )
        if commit:
            await self.db.commit()
        else:
            await self.db.flush()
        return bool(result.rowcount)


    async def get_topic_questions(
        self,
        student_id: str,
        catalog_code: str,
        node_id: str,
        *,
        layer: str,
        count: int,
    ) -> list[Question] | None:
        node = await self._get_topic_node(catalog_code, node_id)
        if not node:
            return None
        if layer not in TOPIC_LAYER_DIFFICULTY_PREFERENCE:
            raise ValueError(f"Invalid topic layer: {layer}")

        candidate_ids = await self.resolve_question_ids(node_id)
        if not candidate_ids:
            return []

        tiers = TOPIC_LAYER_DIFFICULTY_PREFERENCE[layer]

        async def load_questions(
            difficulty_tiers: list[str] | None = None,
        ) -> list[Question]:
            statement = (
                select(Question)
                .where(
                    Question.id.in_(candidate_ids),
                    Question.quality_status == QualityStatus.approved,
                )
                .options(
                    selectinload(Question.options),
                    selectinload(Question.labels),
                    selectinload(Question.formulas),
                    selectinload(Question.images),
                )
                .order_by(Question.id)
            )
            if difficulty_tiers:
                statement = statement.where(
                    Question.difficulty_tier.in_(difficulty_tiers)
                )
            return list(
                (await self.db.scalars(statement)).unique().all()
            )

        if layer in TOPIC_TRAINING_LAYERS:
            questions = await load_questions()
        else:
            questions = await load_questions(tiers)
        if layer not in TOPIC_TRAINING_LAYERS and len(questions) < count:
            preferred_ids = {question.id for question in questions}
            questions.extend(
                question
                for question in await load_questions()
                if question.id not in preferred_ids
            )

        recent_question_ids = set(
            (
                await self.db.scalars(
                    select(StudentAnswer.question_id)
                    .where(
                        StudentAnswer.student_id == student_id,
                        StudentAnswer.question_id.in_(
                            [question.id for question in questions]
                        ),
                    )
                    .order_by(StudentAnswer.created_at.desc())
                    .limit(200)
                )
            ).all()
        )
        fresh_questions = [
            question
            for question in questions
            if question.id not in recent_question_ids
        ]
        pool = (
            fresh_questions
            if len(fresh_questions) >= count
            else fresh_questions + [
                question
                for question in questions
                if question.id in recent_question_ids
            ]
        )

        tier_order = {tier: index for index, tier in enumerate(tiers)}
        pool.sort(
            key=lambda question: (
                question.id in recent_question_ids,
                tier_order.get(
                    question.difficulty_tier.value
                    if question.difficulty_tier
                    else "",
                    len(tier_order),
                ),
                question.id,
            )
        )
        if layer == "paper":
            tier_buckets = {
                tier: [
                    question
                    for question in pool
                    if (
                        question.difficulty_tier.value
                        if question.difficulty_tier
                        else ""
                    ) == tier
                ]
                for tier in tiers
            }
            mixed_pool: list[Question] = []
            while any(tier_buckets.values()):
                for tier in tiers:
                    if tier_buckets[tier]:
                        mixed_pool.append(tier_buckets[tier].pop(0))
            pool = mixed_pool

        core_kp_ids = set(
            (
                await self.db.scalars(
                    select(
                        LearningCatalogNodeKnowledgePoint.knowledge_point_id
                    ).where(
                        LearningCatalogNodeKnowledgePoint.node_id == node_id,
                        LearningCatalogNodeKnowledgePoint.role == "core",
                    )
                )
            ).all()
        )
        selected: list[Question] = []
        covered_kp_ids: set[str] = set()
        topic_layer_quotas = TOPIC_LAYER_QUOTA_PROFILES.get(
            node_id,
            REGULAR_TOPIC_LAYER_QUOTAS,
        )
        quotas = topic_layer_quotas.get(layer)

        def difficulty_key(question: Question) -> tuple[int, float, str]:
            tier = (
                question.difficulty_tier.value
                if question.difficulty_tier
                else ""
            )
            numeric_difficulty = (
                float(question.difficulty)
                if question.difficulty is not None
                else float(DIFFICULTY_TIER_RANK.get(tier, 2))
            )
            return (
                DIFFICULTY_TIER_RANK.get(tier, 2),
                numeric_difficulty,
                question.id,
            )

        def relative_layer_pool() -> list[Question]:
            allocated: dict[str, list[Question]] = {
                training_layer: []
                for training_layer in TOPIC_TRAINING_LAYERS
            }
            question_buckets = {
                question_bucket
                for layer_quotas in topic_layer_quotas.values()
                for question_bucket, _ in layer_quotas
            }
            for question_bucket in question_buckets:
                typed_questions = sorted(
                    (
                        question
                        for question in questions
                        if question.question_type
                        in QUESTION_TYPE_BUCKETS[question_bucket]
                    ),
                    key=difficulty_key,
                )
                weights = {
                    training_layer: next(
                        (
                            quota
                            for quota_bucket, quota in topic_layer_quotas[
                                training_layer
                            ]
                            if quota_bucket == question_bucket
                        ),
                        0,
                    )
                    for training_layer in TOPIC_TRAINING_LAYERS
                }
                total_weight = sum(weights.values())
                if not typed_questions or total_weight == 0:
                    continue

                minimum_total = total_weight
                if len(typed_questions) >= minimum_total:
                    allocation_counts = dict(weights)
                    remaining = len(typed_questions) - minimum_total
                else:
                    allocation_counts = {
                        training_layer: 0
                        for training_layer in TOPIC_TRAINING_LAYERS
                    }
                    remaining = len(typed_questions)

                fractional_extras: list[tuple[float, str]] = []
                assigned_extras = 0
                for training_layer in TOPIC_TRAINING_LAYERS:
                    raw_extra = remaining * weights[training_layer] / total_weight
                    whole_extra = int(raw_extra)
                    allocation_counts[training_layer] += whole_extra
                    assigned_extras += whole_extra
                    fractional_extras.append(
                        (raw_extra - whole_extra, training_layer)
                    )
                for _, training_layer in sorted(
                    fractional_extras,
                    key=lambda item: (
                        -item[0],
                        TOPIC_TRAINING_LAYERS.index(item[1]),
                    ),
                )[: remaining - assigned_extras]:
                    allocation_counts[training_layer] += 1

                offset = 0
                for training_layer in TOPIC_TRAINING_LAYERS:
                    next_offset = offset + allocation_counts[training_layer]
                    allocated[training_layer].extend(
                        typed_questions[offset:next_offset]
                    )
                    offset = next_offset
            return allocated[layer]

        def question_core_kps(question: Question) -> set[str]:
            return {
                label.label_id
                for label in question.labels
                if label.label_type == "knowledge_point"
            } & core_kp_ids

        def append_with_coverage(candidates: list[Question], limit: int) -> None:
            deferred: list[Question] = []
            for question in candidates:
                if len(selected) >= limit:
                    break
                question_kp_ids = question_core_kps(question)
                if question_kp_ids - covered_kp_ids:
                    selected.append(question)
                    covered_kp_ids.update(question_kp_ids)
                else:
                    deferred.append(question)
            for question in deferred:
                if len(selected) >= limit:
                    break
                selected.append(question)
                covered_kp_ids.update(question_core_kps(question))

        if quotas:
            pool = relative_layer_pool()
            pool.sort(
                key=lambda question: (
                    question.id in recent_question_ids,
                    difficulty_key(question),
                )
            )
            target_count = TOPIC_LAYER_QUESTION_COUNTS[layer]
            for question_bucket, quota in quotas:
                typed_candidates = [
                    question
                    for question in pool
                    if question.question_type
                    in QUESTION_TYPE_BUCKETS[question_bucket]
                ]
                append_with_coverage(
                    typed_candidates,
                    min(target_count, len(selected) + quota),
                )
        else:
            append_with_coverage(pool, count)

        final_count = TOPIC_LAYER_QUESTION_COUNTS.get(layer, count)
        return ordered_questions_for_student(selected[:final_count])

    async def _get_topic_node(
        self,
        catalog_code: str,
        node_id: str,
    ) -> LearningCatalogNode | None:
        return await self.db.scalar(
            select(LearningCatalogNode)
            .join(
                LearningCatalog,
                LearningCatalog.id == LearningCatalogNode.catalog_id,
            )
            .where(
                LearningCatalog.code == catalog_code,
                LearningCatalog.enabled.is_(True),
                LearningCatalogNode.id == node_id,
                LearningCatalogNode.node_type == "topic",
                LearningCatalogNode.enabled.is_(True),
            )
        )
