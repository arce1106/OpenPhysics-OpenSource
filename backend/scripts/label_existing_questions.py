"""Run two-phase labeling on existing questions to backfill difficulty_tier and labels."""
import argparse
import asyncio
import json
import sys
from pathlib import Path


async def run(limit: int = 0):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from app.core.database import async_session
    from app.services.knowledge_service import KnowledgeService
    from app.services.question_service import QuestionService
    from app.services.ai_service import AIService, LABELING_SYSTEM_V2, sanitize_labeling_results
    from app.core.ai_client import get_doubao_client
    from app.core.config import settings

    async with async_session() as db:
        q_svc = QuestionService(db)
        kp_svc = KnowledgeService(db)

        kps = await kp_svc.get_all_points()
        kp_list = [{"id": kp.id, "name": kp.name, "description": kp.description or ""} for kp in kps]

        questions = await q_svc.list_questions(limit=1000)
        if limit:
            questions = questions[:limit]

        print(f"Labeling {len(questions)} questions with {len(kp_list)} KPs...")
        ai = AIService(get_doubao_client())

        updated = 0
        errors = 0

        for i, q in enumerate(questions):
            print(f"  [{i+1}/{len(questions)}] {q.id}...", end=" ", flush=True)

            # Build the question dict for the labeling prompt
            question_dict = {
                "id": q.id,
                "stem_text": q.stem_text,
                "answer": q.answer,
                "explanation": q.explanation,
                "question_type": q.question_type.value if q.question_type else None,
                "difficulty": q.difficulty,
                "options": [{"label": o.label, "text": o.text, "is_correct": o.is_correct} for o in q.options],
            }

            labeling_prompt = json.dumps({
                "question": question_dict,
                "knowledge_points": kp_list,
                "physics_models": [],
                "misconceptions": [],
                "section_hint": "",
            }, ensure_ascii=False)

            try:
                response = await ai.client.chat.completions.create(
                    model=settings.doubao_tutor_model,
                    max_tokens=2048,
                    messages=[
                        {"role": "system", "content": LABELING_SYSTEM_V2},
                        {"role": "user", "content": labeling_prompt},
                    ],
                )
                text = response.choices[0].message.content.strip()

                try:
                    labeling = json.loads(text)
                except json.JSONDecodeError:
                    if text.startswith("```"):
                        nl = text.find("\n")
                        text = text[nl + 1:] if nl != -1 else text[3:]
                        if text.endswith("```"):
                            text = text[:-3]
                    labeling = json.loads(text.strip())

                raw_results = labeling if isinstance(labeling, list) else [labeling]
                for raw in raw_results:
                    if isinstance(raw, dict) and not raw.get("question_id"):
                        raw["question_id"] = q.id
                sanitized_results = sanitize_labeling_results(
                    raw_results,
                    kp_list,
                    question_ids={q.id},
                )
                sanitized = sanitized_results[0] if sanitized_results else {
                    "difficulty_tier": None,
                    "labels": [],
                }

                # Update question with tier
                update_data = {}
                if sanitized.get("difficulty_tier"):
                    update_data["difficulty_tier"] = sanitized["difficulty_tier"]

                if update_data:
                    await q_svc.update_question(q.id, update_data)

                # Replace labels
                if sanitized.get("labels"):
                    await q_svc.update_question_labels(q.id, sanitized["labels"])

                tier = sanitized.get("difficulty_tier", "?")
                label_count = len(sanitized.get("labels", []))
                print(f"✓ [{tier}] {label_count} labels")
                updated += 1

            except Exception as e:
                print(f"✗ {e}")
                errors += 1

        print(f"\nDone: {updated} updated, {errors} errors")


def main():
    ap = argparse.ArgumentParser(description="Label existing questions with difficulty_tier and metadata")
    ap.add_argument("--limit", "-n", type=int, default=0, help="Process only N questions")
    args = ap.parse_args()
    asyncio.run(run(args.limit))


if __name__ == "__main__":
    main()
