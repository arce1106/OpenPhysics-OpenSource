"""Seed reusable learning catalogs and expand curated KP selectors.

The seed is additive and safe for multiple application workers. Existing curation
remains authoritative. Only the exact legacy standalone demo defaults are retired
when upgrading to the complete review tree; their content and evidence are kept.
"""

import json
from pathlib import Path
from typing import Any

from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.knowledge import KnowledgePoint
from app.models.learning_catalog import (
    LearningCatalog,
    LearningCatalogNode,
    LearningCatalogNodeKnowledgePoint,
    LearningCatalogNodeLabelRule,
)


SEED_PATH = Path(__file__).resolve().parent.parent / "seed" / "learning_catalogs.json"
LEARNING_CATALOG_SEED_LOCK_ID = 730731030001


def _flatten_nodes(
    catalog_id: str,
    nodes: list[dict[str, Any]],
    parent_id: str | None = None,
) -> list[dict[str, Any]]:
    flattened: list[dict[str, Any]] = []
    for node in nodes:
        flattened.append(
            {
                "id": node["id"],
                "catalog_id": catalog_id,
                "parent_id": parent_id,
                "code": node["code"],
                "node_type": node["node_type"],
                "title": node["title"],
                "description": node.get("description"),
                "sort_order": node.get("sort_order", 0),
                "enabled": node.get("enabled", True),
                "config": node.get("config", {}),
                "_kp_ids": node.get("kp_ids", []),
                "_kp_id_prefixes": node.get("kp_id_prefixes", []),
                "_supporting_kp_ids": node.get("supporting_kp_ids", []),
                "_supporting_kp_id_prefixes": node.get(
                    "supporting_kp_id_prefixes",
                    [],
                ),
                "_label_rules": node.get("label_rules", []),
            }
        )
        flattened.extend(
            _flatten_nodes(catalog_id, node.get("children", []), node["id"])
        )
    return flattened


def _select_kp_ids(
    known_kp_ids: set[str],
    explicit_ids: list[str],
    prefixes: list[str],
) -> set[str]:
    selected = {kp_id for kp_id in explicit_ids if kp_id in known_kp_ids}
    selected.update(
        kp_id
        for kp_id in known_kp_ids
        if any(kp_id.startswith(prefix) for prefix in prefixes)
    )
    return selected


async def seed_learning_catalogs(db: AsyncSession) -> dict[str, int]:
    """Insert missing catalog data once across concurrent application workers."""
    await db.execute(
        text("SELECT pg_advisory_xact_lock(:lock_id)"),
        {"lock_id": LEARNING_CATALOG_SEED_LOCK_ID},
    )
    with SEED_PATH.open(encoding="utf-8") as seed_file:
        payload = json.load(seed_file)

    # Retire only the original unmodified standalone demo node. Keep its rows and
    # evidence; the default directory now uses the complete block/topic tree.
    await db.execute(update(LearningCatalogNode).where(
        LearningCatalogNode.id == "demo_motion",
        LearningCatalogNode.catalog_id == "catalog_gaokao_review",
        LearningCatalogNode.parent_id.is_(None),
        LearningCatalogNode.code == "demo_motion",
        LearningCatalogNode.title == "匀速直线运动示例",
        LearningCatalogNode.config == {},
    ).values(enabled=False))
    full_review = next(c for c in payload["catalogs"] if c["code"] == "gaokao_review")
    await db.execute(update(LearningCatalog).where(
        LearningCatalog.id == "catalog_gaokao_review",
        LearningCatalog.name == "高考复习示例",
        LearningCatalog.config == {"source_mode": "curated_topic_mapping", "mastery_source": "catalog_topic_evidence"},
    ).values(name=full_review["name"], config=full_review["config"]))

    catalog_rows: list[dict[str, Any]] = []
    node_specs: list[dict[str, Any]] = []
    for catalog in payload["catalogs"]:
        catalog_rows.append(
            {
                "id": catalog["id"],
                "code": catalog["code"],
                "name": catalog["name"],
                "description": catalog.get("description"),
                "version": catalog.get("version", 1),
                "enabled": catalog.get("enabled", True),
                "sort_order": catalog.get("sort_order", 0),
                "config": catalog.get("config", {}),
            }
        )
        node_specs.extend(_flatten_nodes(catalog["id"], catalog.get("nodes", [])))

    catalog_result = await db.execute(
        pg_insert(LearningCatalog)
        .values(catalog_rows)
        .on_conflict_do_nothing(index_elements=[LearningCatalog.id])
    )

    node_rows = [
        {key: value for key, value in node.items() if not key.startswith("_")}
        for node in node_specs
    ]
    inserted_nodes = 0
    if node_rows:
        node_result = await db.execute(
            pg_insert(LearningCatalogNode)
            .values(node_rows)
            .on_conflict_do_nothing(index_elements=[LearningCatalogNode.id])
        )
        inserted_nodes = int(node_result.rowcount or 0)

    known_kp_ids = set(
        (await db.scalars(select(KnowledgePoint.id))).all()
    )
    mapping_rows: list[dict[str, Any]] = []
    label_rule_rows: list[dict[str, Any]] = []

    for node in node_specs:
        core_ids = _select_kp_ids(
            known_kp_ids,
            node["_kp_ids"],
            node["_kp_id_prefixes"],
        )
        supporting_ids = _select_kp_ids(
            known_kp_ids,
            node["_supporting_kp_ids"],
            node["_supporting_kp_id_prefixes"],
        ) - core_ids

        for index, kp_id in enumerate(sorted(core_ids), start=1):
            mapping_rows.append(
                {
                    "node_id": node["id"],
                    "knowledge_point_id": kp_id,
                    "role": "core",
                    "weight": 1.0,
                    "sort_order": index,
                }
            )
        for index, kp_id in enumerate(sorted(supporting_ids), start=1):
            mapping_rows.append(
                {
                    "node_id": node["id"],
                    "knowledge_point_id": kp_id,
                    "role": "supporting",
                    "weight": 0.5,
                    "sort_order": index,
                }
            )
        for index, rule in enumerate(node["_label_rules"], start=1):
            label_rule_rows.append(
                {
                    "node_id": node["id"],
                    "label_type": rule["label_type"],
                    "label_id": rule["label_id"],
                    "action": rule.get("action", "include"),
                    "weight": rule.get("weight", 1.0),
                    "sort_order": rule.get("sort_order", index),
                }
            )

    inserted_mappings = 0
    if mapping_rows:
        mapping_result = await db.execute(
            pg_insert(LearningCatalogNodeKnowledgePoint)
            .values(mapping_rows)
            .on_conflict_do_nothing(
                index_elements=[
                    LearningCatalogNodeKnowledgePoint.node_id,
                    LearningCatalogNodeKnowledgePoint.knowledge_point_id,
                ]
            )
        )
        inserted_mappings = int(mapping_result.rowcount or 0)

    inserted_rules = 0
    if label_rule_rows:
        rule_result = await db.execute(
            pg_insert(LearningCatalogNodeLabelRule)
            .values(label_rule_rows)
            .on_conflict_do_nothing(
                constraint="uq_learning_catalog_node_label_rule"
            )
        )
        inserted_rules = int(rule_result.rowcount or 0)

    await db.commit()
    return {
        "catalogs": int(catalog_result.rowcount or 0),
        "nodes": inserted_nodes,
        "knowledge_point_mappings": inserted_mappings,
        "label_rules": inserted_rules,
    }
