"""Seed original demonstration cards only; no textbook-wide content packs."""

import asyncio
import json
from pathlib import Path

from app.core.database import async_session
from app.models.learning import ContentSource, ContentType, LearningContent


async def seed():
    cards = json.loads((Path(__file__).parent / "knowledge_cards.json").read_text(encoding="utf-8"))
    async with async_session() as db:
        inserted = 0
        for card in cards:
            if await db.get(LearningContent, card["id"]):
                continue
            db.add(LearningContent(id=card["id"], knowledge_point_id=card["kp_id"],
                                   content_type=ContentType.card, title=card["title"], body=card["body"],
                                   source=ContentSource.ai_generated, version=1))
            inserted += 1
        await db.commit()
        print(f"Original demonstration cards created: {inserted}")


if __name__ == "__main__":
    asyncio.run(seed())
