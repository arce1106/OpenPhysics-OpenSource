"""Generate teacher-grade knowledge cards for OpenPhysics learning contents."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select

from app.core.ai_client import get_doubao_client
from app.core.config import settings
from app.core.database import async_session
from app.models.learning import ContentSource, ContentType, LearningContent
from app.services.knowledge_card_generation import (
    CARD_GENERATION_SYSTEM,
    KnowledgeCardValidationError,
    build_card_prompt,
    default_content_id,
    extract_json_payload,
    normalize_generated_cards,
)


ROOT = Path(__file__).resolve().parent.parent
KP_FILE = ROOT / "app" / "seed" / "knowledge_points.json"


def load_knowledge_points(volume: str, kp_ids: list[str] | None = None) -> list[dict[str, Any]]:
    all_kps = json.loads(KP_FILE.read_text(encoding="utf-8"))
    selected = [kp for kp in all_kps if kp.get("volume") == volume]
    if kp_ids:
        wanted = set(kp_ids)
        selected = [kp for kp in selected if kp["id"] in wanted]
        missing = sorted(wanted - {kp["id"] for kp in selected})
        if missing:
            raise SystemExit(f"ERROR: kp-id not found in {volume}: {', '.join(missing)}")
    return selected


async def existing_cards_for(kp_ids: list[str]) -> dict[str, LearningContent]:
    if not kp_ids:
        return {}
    async with async_session() as db:
        result = await db.execute(
            select(LearningContent)
            .where(
                LearningContent.knowledge_point_id.in_(kp_ids),
                LearningContent.content_type == ContentType.card,
            )
            .order_by(LearningContent.knowledge_point_id, LearningContent.version.desc())
        )
        existing: dict[str, LearningContent] = {}
        for content in result.scalars().all():
            existing.setdefault(content.knowledge_point_id, content)
        return existing


def filter_pending(
    kps: list[dict[str, Any]],
    existing: dict[str, LearningContent],
    overwrite_ai: bool,
) -> tuple[list[dict[str, Any]], list[tuple[str, str]]]:
    pending = []
    skipped = []
    for kp in kps:
        content = existing.get(kp["id"])
        if not content:
            pending.append(kp)
            continue

        source = content.source.value if hasattr(content.source, "value") else str(content.source)
        if source == ContentSource.curated.value:
            skipped.append((kp["id"], "curated"))
        elif overwrite_ai:
            pending.append(kp)
        else:
            skipped.append((kp["id"], "existing_ai"))
    return pending, skipped


async def generate_batch(kps: list[dict[str, Any]], volume: str, model: str) -> list[dict[str, Any]]:
    client = get_doubao_client()
    kp_lookup = {kp["id"]: kp for kp in kps}
    response = await client.chat.completions.create(
        model=model,
        max_tokens=8192,
        messages=[
            {"role": "system", "content": CARD_GENERATION_SYSTEM},
            {"role": "user", "content": build_card_prompt(kps, volume)},
        ],
    )
    text = response.choices[0].message.content or ""
    payload = extract_json_payload(text)
    cards = normalize_generated_cards(payload, kp_lookup)

    generated_ids = {card["kp_id"] for card in cards}
    expected_ids = set(kp_lookup)
    missing = sorted(expected_ids - generated_ids)
    if missing:
        raise KnowledgeCardValidationError(f"model missed kp_id: {', '.join(missing)}")
    return cards


async def save_cards(cards: list[dict[str, Any]], overwrite_ai: bool) -> tuple[int, int, int]:
    created = 0
    updated = 0
    skipped = 0
    async with async_session() as db:
        for card in cards:
            result = await db.execute(
                select(LearningContent)
                .where(
                    LearningContent.knowledge_point_id == card["kp_id"],
                    LearningContent.content_type == ContentType.card,
                )
                .order_by(LearningContent.version.desc())
                .limit(1)
            )
            existing = result.scalar_one_or_none()
            if existing:
                source = existing.source.value if hasattr(existing.source, "value") else str(existing.source)
                if source == ContentSource.curated.value or not overwrite_ai:
                    skipped += 1
                    continue
                existing.title = card["title"]
                existing.body = card["body"]
                existing.source = ContentSource.ai_generated
                updated += 1
                continue

            db.add(
                LearningContent(
                    id=default_content_id(card["kp_id"]),
                    knowledge_point_id=card["kp_id"],
                    content_type=ContentType.card,
                    title=card["title"],
                    body=card["body"],
                    source=ContentSource.ai_generated,
                    version=1,
                )
            )
            created += 1
        await db.commit()
    return created, updated, skipped


def batched(items: list[dict[str, Any]], batch_size: int):
    for i in range(0, len(items), batch_size):
        yield i // batch_size + 1, items[i : i + batch_size]


async def run(args: argparse.Namespace) -> None:
    if not settings.ark_api_key or not settings.doubao_tutor_model:
        raise SystemExit(
            "ERROR: ARK_API_KEY or DOUBAO_TUTOR_MODEL is empty; cannot generate cards."
        )

    kps = load_knowledge_points(args.volume, args.kp_id)
    if args.limit:
        kps = kps[: args.limit]
    existing = await existing_cards_for([kp["id"] for kp in kps])
    pending, skipped_before = filter_pending(kps, existing, args.overwrite_ai)

    total_batches = (len(pending) + args.batch_size - 1) // args.batch_size
    print(f"Volume: {args.volume}")
    print(f"KPs selected: {len(kps)}")
    print(f"Pending generation: {len(pending)}")
    print(f"Skipped before generation: {len(skipped_before)}")
    print(f"Mode: {'DRY RUN' if args.dry_run else 'APPLY'}")
    print(f"Model: {args.model}\n")

    all_cards: list[dict[str, Any]] = []
    errors: list[tuple[list[str], str]] = []
    for batch_no, chunk in batched(pending, args.batch_size):
        ids = [kp["id"] for kp in chunk]
        print(f"[{batch_no}/{total_batches}] generating {', '.join(ids)} ...", end=" ", flush=True)
        try:
            cards = await generate_batch(chunk, args.volume, args.model)
            all_cards.extend(cards)
            print("OK")
        except Exception as exc:
            print(f"FAILED: {exc}")
            if len(chunk) == 1:
                errors.append((ids, str(exc)))
                continue

            print("  retrying one by one")
            for _, single in batched(chunk, 1):
                single_id = single[0]["id"]
                print(f"  - {single_id} ...", end=" ", flush=True)
                try:
                    cards = await generate_batch(single, args.volume, args.model)
                    all_cards.extend(cards)
                    print("OK")
                except Exception as single_exc:
                    print(f"FAILED: {single_exc}")
                    errors.append(([single_id], str(single_exc)))

    if args.dry_run:
        print(f"\nDry run generated {len(all_cards)} cards. No database writes.")
        if all_cards:
            preview = {
                "kp_id": all_cards[0]["kp_id"],
                "title": all_cards[0]["title"],
                "section_titles": [s["title"] for s in all_cards[0]["body"]["sections"]],
            }
            print(json.dumps(preview, ensure_ascii=False, indent=2))
    else:
        created, updated, skipped_during_save = await save_cards(all_cards, args.overwrite_ai)
        print(
            f"\nSaved: {created} created, {updated} updated, "
            f"{skipped_during_save} skipped during save."
        )

    if skipped_before:
        by_reason: dict[str, int] = {}
        for _, reason in skipped_before:
            by_reason[reason] = by_reason.get(reason, 0) + 1
        print(f"Skipped summary: {by_reason}")
    if errors:
        print("\nErrors:")
        for ids, error in errors:
            print(f"  {', '.join(ids)}: {error}")
        raise SystemExit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate OpenPhysics knowledge cards by volume")
    parser.add_argument("--volume", required=True, help='Example: "选择性必修 第二册"')
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--limit", type=int, default=0, help="Process only the first N selected KPs")
    parser.add_argument("--kp-id", action="append", help="Generate only a specific KP id; may repeat")
    parser.add_argument("--model", default=settings.doubao_tutor_model)
    parser.add_argument("--dry-run", action="store_true", help="Generate and validate, but do not write DB")
    parser.add_argument(
        "--overwrite-ai",
        action="store_true",
        help="Overwrite existing ai_generated card content. Curated cards are never overwritten.",
    )
    args = parser.parse_args()
    if args.batch_size < 1:
        raise SystemExit("ERROR: --batch-size must be >= 1")
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
