"""Seed the database with knowledge points, relations, and misconceptions.

Uses upsert to avoid foreign key violations with existing student data.
Safe to run repeatedly — only adds new records, does not delete existing.
"""

import asyncio
import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.models.knowledge import KnowledgePoint, KnowledgeRelation, Misconception, RelationType

SEED_DIR = Path(__file__).parent


async def seed():
    engine = create_async_engine(settings.database_url)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with session_factory() as session:
        # ── Knowledge Points ───────────────────────────────────────
        with open(SEED_DIR / "knowledge_points.json") as f:
            kps = json.load(f)

        new_kp = 0
        skip_kp = 0
        for kp_data in kps:
            # Check if already exists (don't update to preserve existing data)
            existing = await session.get(KnowledgePoint, kp_data["id"])
            if existing:
                skip_kp += 1
                continue
            session.add(KnowledgePoint(**kp_data))
            new_kp += 1
        await session.flush()
        print(f"Knowledge points: {new_kp} new, {skip_kp} skipped (already exist)")

        # ── Relations ──────────────────────────────────────────────
        with open(SEED_DIR / "relations.json") as f:
            relations = json.load(f)

        # Get existing relation keys
        result = await session.execute(select(KnowledgeRelation))
        existing_rels = {(r.source_id, r.target_id, r.relation_type.value) for r in result.scalars().all()}

        new_rel = 0
        skip_rel = 0
        for rel_data in relations:
            key = (rel_data["source_id"], rel_data["target_id"], rel_data["relation_type"])
            if key in existing_rels:
                skip_rel += 1
                continue
            session.add(KnowledgeRelation(
                source_id=rel_data["source_id"],
                target_id=rel_data["target_id"],
                relation_type=RelationType(rel_data["relation_type"]),
                reason=rel_data.get("reason"),
            ))
            new_rel += 1
        await session.flush()
        print(f"Relations: {new_rel} new, {skip_rel} skipped (already exist)")

        # ── Misconceptions ─────────────────────────────────────────
        mc_path = SEED_DIR / "misconceptions.json"
        if mc_path.exists():
            with open(mc_path) as f:
                misconceptions = json.load(f)
            new_mc = 0
            skip_mc = 0
            for mc_data in misconceptions:
                existing = await session.get(Misconception, mc_data["id"])
                if existing:
                    skip_mc += 1
                    continue
                session.add(Misconception(
                    id=mc_data["id"],
                    name=mc_data["name"],
                    description=mc_data.get("description"),
                    related_kp_ids=mc_data.get("related_kp_ids"),
                ))
                new_mc += 1
            print(f"Misconceptions: {new_mc} new, {skip_mc} skipped (already exist)")

        await session.commit()

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed())
