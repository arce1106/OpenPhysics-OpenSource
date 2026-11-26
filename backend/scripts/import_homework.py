"""Import questions from a homework-format or exercise-format .docx into the question bank.

Pipeline: DocParser.parse_homework()/parse_exercises() → deterministic draft labels → manual label review → QuestionImporter.import_questions()

IDs are assigned from question IDs that do not currently exist in the database.
Each import is collision-checked before writing.
"""
import asyncio
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text
from app.core.database import async_session
from app.services.doc_parser import DocParser
from app.services.question_service import QuestionService
from app.services.question_importer import QuestionImporter
from app.services.ai_service import AIService
from app.core.ai_client import get_doubao_client
from app.services.knowledge_service import KnowledgeService


VOLUME_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ("选择性必修 第二册", ("选择性必修二", "选择性必修 第二册", "选必二", "选修二", "法拉第", "楞次", "电磁感应", "涡流", "互感", "自感")),
    ("选择性必修 第一册", ("选择性必修一", "选择性必修 第一册", "选必一")),
    ("选择性必修 第三册", ("选择性必修三", "选择性必修 第三册", "选必三")),
    ("必修 第二册", ("必修二", "必修 第二册")),
    ("必修 第三册", ("必修三", "必修 第三册")),
    ("必修 第一册", ("必修一", "必修 第一册")),
]


def infer_volume_from_doc_name(doc_name: str) -> str | None:
    compact = re.sub(r"\s+", "", doc_name.replace("　", ""))
    matches = [
        volume
        for volume, keywords in VOLUME_KEYWORDS
        if any(keyword.replace(" ", "") in compact for keyword in keywords)
    ]
    if not matches:
        return None
    return matches[0] if len(set(matches)) == 1 else None


def _compact_text(value: str) -> str:
    return re.sub(r"\s+", "", value.replace("　", ""))


def infer_chapter_from_doc_path(doc_path: Path) -> str | None:
    """Infer a chapter hint such as '第三章交变电流' from a directory/file path."""
    for part in doc_path.parts:
        compact = _compact_text(part)
        match = re.match(r"(第[一二三四五六七八九十]+章[\u4e00-\u9fff]*)", compact)
        if match:
            return match.group(1)
    return None


def _assign_question_ids(questions: list[dict], question_ids: list[str]) -> None:
    """Replace parser-generated IDs with checked q_XXXX IDs."""
    if len(question_ids) < len(questions):
        raise ValueError("not enough question IDs for parsed questions")
    for q, new_id in zip(questions, question_ids):
        # Update labels' question_id reference (if any from rule-based inference)
        for lbl in q.get("labels", []):
            if lbl.get("question_id"):
                lbl["question_id"] = new_id
        q["id"] = new_id


def _sync_choice_question_type(q: dict) -> None:
    """Keep objective-question type deterministic when the answer is plain A-D."""
    answer = re.sub(r"[^A-D]", "", str(q.get("answer") or "").upper())
    if not q.get("options") or not answer or not re.fullmatch(r"[A-D]+", answer):
        return

    question_type = "multiple_choice" if len(set(answer)) > 1 else "single_choice"
    q["question_type"] = question_type
    labels = q.setdefault("labels", [])
    for label in labels:
        if label.get("label_type") == "question_type":
            label["label_id"] = question_type
            label["role"] = "主要"
            label["confidence"] = 1.0
            return
    labels.append({
        "label_type": "question_type",
        "label_id": question_type,
        "role": "主要",
        "confidence": 1.0,
        "source": "auto",
    })


async def get_available_question_ids(db, count: int) -> list[str]:
    """Return a contiguous q_XXXX block, filling earlier gaps only if large enough."""
    if count <= 0:
        return []
    result = await db.execute(
        text(
            """
            WITH numbered AS (
                SELECT substring(id from 3)::int AS n
                FROM questions
                WHERE id ~ '^q_[0-9]{4}$'
            ),
            bounds AS (
                SELECT COALESCE(MAX(n), 0) AS max_n
                FROM numbered
            ),
            gaps AS (
                SELECT gs.n
                FROM bounds, generate_series(1, bounds.max_n + :count) AS gs(n)
                LEFT JOIN numbered ON numbered.n = gs.n
                WHERE numbered.n IS NULL
            ),
            gap_runs AS (
                SELECT n, n - row_number() OVER (ORDER BY n) AS run_id
                FROM gaps
            ),
            usable_gap AS (
                SELECT MIN(n) AS start_n
                FROM gap_runs
                GROUP BY run_id
                HAVING COUNT(*) >= :count
                ORDER BY MIN(n)
                LIMIT 1
            ),
            chosen AS (
                SELECT COALESCE((SELECT start_n FROM usable_gap), bounds.max_n + 1) AS start_n
                FROM bounds
            )
            SELECT 'q_' || lpad(n::text, 4, '0') AS id
            FROM chosen, generate_series(chosen.start_n, chosen.start_n + :count - 1) AS gs(n)
            ORDER BY n
            """
        ),
        {"count": count},
    )
    ids = [row[0] for row in result.fetchall()]
    if len(ids) != count:
        raise RuntimeError(f"expected {count} available IDs, got {len(ids)}")
    return ids


async def find_existing_question_ids(db, question_ids: list[str]) -> list[str]:
    if not question_ids:
        return []
    result = await db.execute(
        text("SELECT id FROM questions WHERE id = ANY(:ids) ORDER BY id"),
        {"ids": question_ids},
    )
    return [row[0] for row in result.fetchall()]


def _format_id_summary(question_ids: list[str]) -> str:
    if not question_ids:
        return "(none)"
    numbers = [int(qid.replace("q_", "")) for qid in question_ids]
    if numbers == list(range(numbers[0], numbers[0] + len(numbers))):
        return f"{question_ids[0]} .. {question_ids[-1]}"
    preview = ", ".join(question_ids[:8])
    suffix = "" if len(question_ids) <= 8 else f", ... , {question_ids[-1]}"
    return f"{preview}{suffix}"


async def main(
    docx_path: str,
    skip_ai: bool = True,
    fmt: str = "homework",
    volume: str | None = None,
    chapter: str | None = None,
):
    doc_path = Path(docx_path)
    if not doc_path.exists():
        print(f"ERROR: file not found: {doc_path}")
        sys.exit(1)

    # ── Phase 1: Parse ──────────────────────────────────────────
    print(f"Parsing: {doc_path.name}  (format: {fmt})")
    parser = DocParser()
    # Use a temp prefix; IDs are replaced with global sequential IDs below
    if fmt == "exercises":
        questions = parser.parse_exercises(doc_path, id_prefix="__tmp")
    else:
        questions = parser.parse_homework(doc_path, id_prefix="__tmp")
    print(f"  → {len(questions)} questions parsed\n")

    if not questions:
        print("No questions found. Aborting.")
        return

    async with async_session() as db:
        question_ids = await get_available_question_ids(db, len(questions))
    _assign_question_ids(questions, question_ids)
    print(f"  IDs assigned: {_format_id_summary(question_ids)}\n")

    # ── Phase 2: Optional external label suggestions ──────────────
    if skip_ai:
        print("External AI labeling disabled. Using deterministic draft labels for manual review.")
    else:
        async with async_session() as db:
            kp_svc = KnowledgeService(db)
            inferred_volume = volume or infer_volume_from_doc_name(doc_path.name)
            if inferred_volume:
                kps = await kp_svc.get_points_by_volume(inferred_volume)
                chapter_hint = chapter or infer_chapter_from_doc_path(doc_path)
                if chapter_hint:
                    scoped = [
                        kp for kp in kps
                        if kp.chapter and chapter_hint in _compact_text(kp.chapter)
                    ]
                    if scoped:
                        kps = scoped
                        print(f"  KP chapter scope: {chapter_hint} ({len(kps)} knowledge points)")
                if kps:
                    print(f"  KP scope: {inferred_volume} ({len(kps)} knowledge points)")
                else:
                    print(f"  KP scope: {inferred_volume} has no knowledge points, fallback to all")
                    kps = await kp_svc.get_all_points()
            else:
                kps = await kp_svc.get_all_points()
                print(f"  KP scope: all volumes ({len(kps)} knowledge points)")
            kp_list = [{"id": kp.id, "name": kp.name, "description": kp.description or ""}
                       for kp in kps]

        BATCH_SIZE = 5
        ai = AIService(get_doubao_client())

        labeling_results = []
        for i in range(0, len(questions), BATCH_SIZE):
            chunk = questions[i:i + BATCH_SIZE]
            chunk_num = i // BATCH_SIZE + 1
            total_chunks = (len(questions) + BATCH_SIZE - 1) // BATCH_SIZE
            print(f"  AI labeling chunk {chunk_num}/{total_chunks} "
                  f"({chunk[0]['id']}..{chunk[-1]['id']}, {len(chunk)} questions)...", end=" ", flush=True)
            try:
                results = await ai.label_questions_batch(chunk, kp_list)
                labeling_results.extend(results)
                print("OK")
            except Exception as e:
                print(f"FAILED: {e}")
                # Retry one-by-one for this chunk
                for q in chunk:
                    try:
                        results = await ai.label_questions_batch([q], kp_list)
                        labeling_results.extend(results)
                        print(f"    {q['id']} retry OK")
                    except Exception as e2:
                        print(f"    {q['id']} FAILED: {e2}")

        # Merge AI labels into questions
        ai_labeled = 0
        for result in labeling_results:
            qid = result.get("question_id", "")
            for q in questions:
                if q["id"] == qid:
                    ai_labels = result.get("labels", [])
                    if ai_labels:
                        q["labels"] = ai_labels
                        ai_labeled += 1
                        # Extract question_type from AI labels
                        for lbl in ai_labels:
                            if lbl.get("label_type") == "question_type":
                                q["question_type"] = lbl["label_id"]
                                break
                    if result.get("difficulty_tier"):
                        tier = result["difficulty_tier"]
                        TIER_MAP = {"moderate": "medium", "easy": "easy", "hard": "hard",
                                    "medium": "medium", "moderate_easy": "moderate_easy",
                                    "moderate_hard": "moderate_hard"}
                        q["difficulty_tier"] = TIER_MAP.get(tier, "easy")
                    _sync_choice_question_type(q)
                    break

        print(f"  → AI labeled {ai_labeled}/{len(questions)} questions")

    for q in questions:
        _sync_choice_question_type(q)

    # ── Phase 3: Preview ─────────────────────────────────────────
    print(f"\n{'ID':12s} {'Type':16s} {'Ans':4s} {'Diff':6s} {'Imgs':4s}  {'KPs'}")
    print("-" * 80)
    for q in questions:
        kps = [l["label_id"] for l in q.get("labels", []) if l["label_type"] == "knowledge_point"]
        n_imgs = len(q.get("images", []))
        print(f"{q['id']:12s} {q.get('question_type','?'):16s} {q.get('answer','?'):4s} "
              f"{q.get('difficulty','?'):<6} {n_imgs:4d}  {', '.join(kps)}")

    # ── Phase 4: Import ──────────────────────────────────────────
    print(f"\nImporting {len(questions)} questions into database...")
    async with async_session() as db:
        collisions = await find_existing_question_ids(db, [q["id"] for q in questions])
        if collisions:
            print(f"ERROR: target question IDs already exist: {', '.join(collisions)}")
            return
        qs = QuestionService(db)
        importer = QuestionImporter(qs)
        results = await importer.import_questions(
            questions, image_dir=parser.image_output_dir
        )

    created = sum(1 for r in results if r.action == "created")
    updated = sum(1 for r in results if r.action == "updated")
    errors = [r for r in results if not r.success or r.action == "error"]
    for e in errors:
        print(f"  ERROR {e.question_id}: {e.error}")
    print(f"Done: {created} created, {updated} updated, {len(errors)} errors")


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="Import homework-format .docx into question bank")
    ap.add_argument("docx", help="Path to the .docx file")
    ap.add_argument("--skip-ai", action="store_true", help="Compatibility flag; external AI labeling is already disabled by default")
    ap.add_argument("--use-ai-labeling", action="store_true", help="Experimental only: request external AI label suggestions before manual review")
    ap.add_argument("--format", dest="fmt", default="homework", choices=["homework", "exercises"],
                    help="Document format: homework (【答案】/【知识点】 tags) or exercises (答案　/ 解析　 tags)")
    ap.add_argument("--volume", help='Limit label candidates to one volume, e.g. "选择性必修 第二册"')
    ap.add_argument("--chapter", help='Limit label candidates to one chapter, e.g. "第三章交变电流"')
    args = ap.parse_args()
    skip_ai = args.skip_ai or not args.use_ai_labeling
    asyncio.run(main(args.docx, skip_ai, args.fmt, args.volume, args.chapter))
