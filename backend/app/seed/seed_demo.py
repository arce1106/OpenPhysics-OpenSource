"""Load the full directory and original concept examples; never overwrite existing content."""

import asyncio
import json
from pathlib import Path

from app.core.database import async_session
from app.seed.seed import seed as seed_knowledge
from app.seed.seed_learning_content import seed as seed_cards
from app.services.question_importer import QuestionImporter
from app.services.question_service import QuestionService
from app.services.seed_learning_catalogs import seed_learning_catalogs


async def seed():
    await seed_knowledge()
    demo_dir = Path(__file__).resolve().parents[2] / "data/demo"
    questions = [question for name in ("chapter01.json", "knowledge-point-examples.json")
                 for question in json.loads((demo_dir / name).read_text(encoding="utf-8"))["questions"]]
    async with async_session() as db:
        results = await QuestionImporter(QuestionService(db)).import_questions(questions)
        failures = [r for r in results if r.action == "error"]
        if failures:
            raise RuntimeError(f"Demo import failed for {len(failures)} questions; review database errors locally.")
        await seed_learning_catalogs(db)
        await db.commit()
        print(f"Demo questions created: {sum(r.action == 'created' for r in results)}; existing questions kept: {sum(r.action == 'skipped' for r in results)}")
    await seed_cards()


if __name__ == "__main__":
    asyncio.run(seed())
