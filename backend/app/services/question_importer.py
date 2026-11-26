"""Batch import structured questions into the database."""
import shutil
from dataclasses import dataclass
from pathlib import Path
from app.services.question_service import QuestionService


@dataclass
class ImportResult:
    question_id: str
    success: bool
    action: str  # "created", "updated", "skipped", "error"
    error: str | None = None


STATIC_DIR = (Path(__file__).resolve().parent.parent.parent / "static" / "questions").absolute()


class QuestionImporter:
    def __init__(
        self,
        question_service: QuestionService,
        static_dir: Path | None = None,
        allow_updates: bool = False,
    ):
        self.qs = question_service
        self.static_dir = static_dir or STATIC_DIR
        self.allow_updates = allow_updates
        self.static_dir.mkdir(parents=True, exist_ok=True)

    async def import_questions(
        self,
        questions: list[dict],
        image_dir: Path | None = None,
        allow_updates: bool | None = None,
    ) -> list[ImportResult]:
        should_update = self.allow_updates if allow_updates is None else allow_updates
        results = []
        for q_data in questions:
            result = await self._import_one(q_data, image_dir, should_update)
            results.append(result)
        return results

    async def _import_one(
        self, q_data: dict, image_dir: Path | None, allow_updates: bool
    ) -> ImportResult:
        qid = q_data.get("id", "")
        if not qid:
            return ImportResult("", False, "error", "Missing question id")

        # Build image lookup: ref -> static path
        # 1) explicit image_dir (batch import with local files)
        # 2) file already in static/questions (SSE extraction flow)
        image_paths: dict[str, str] = {}
        for img in q_data.get("images", []):
            ref = img.get("ref", "")
            if not ref:
                continue
            static_file = self.static_dir / ref
            if image_dir:
                src = image_dir / ref
                if src.exists():
                    static_file.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src, static_file)
                    image_paths[ref] = f"/static/questions/{ref}"
            elif static_file.exists():
                image_paths[ref] = f"/static/questions/{ref}"

        # Prepare data for QuestionService
        create_data = {
            "id": qid,
            "stem_text": q_data.get("stem_text", ""),
            "answer": q_data.get("answer"),
            "explanation": q_data.get("explanation"),
            "question_type": q_data.get("question_type"),
            "difficulty": q_data.get("difficulty"),
            "difficulty_tier": q_data.get("difficulty_tier"),
            "source": "curated",
            "quality_status": q_data.get("quality_status", "draft"),
            "options": q_data.get("options", []),
            "labels": self._build_labels(q_id=qid, q_data=q_data),
            "formulas": [
                {
                    "id": f"fml_{qid}_{i}",
                    "latex": fml.get("latex", ""),
                    "formula_role": fml.get("formula_role", "general"),
                    "knowledge_point_id": fml.get("knowledge_point_id"),
                    "variables": fml.get("variables"),
                    "confidence": fml.get("confidence"),
                }
                for i, fml in enumerate(q_data.get("formulas", []))
            ],
            "images": [
                {
                    "id": f"img_{qid}_{i}",
                    "image_path": image_paths.get(img.get("ref", ""), ""),
                    "image_type": img.get("image_type", "diagram"),
                    "description": img.get("alt", ""),
                }
                for i, img in enumerate(q_data.get("images", []))
            ],
        }

        try:
            existing = await self.qs.get_question(qid)
            if existing:
                if not allow_updates:
                    return ImportResult(
                        qid,
                        False,
                        "skipped",
                        "Question id already exists; pass allow_updates=True to update it",
                    )
                await self.qs.update_children(qid, create_data)
                return ImportResult(qid, True, "updated")
            else:
                await self.qs.create_question(create_data)
                return ImportResult(qid, True, "created")
        except Exception as e:
            return ImportResult(qid, False, "error", str(e))

    def _build_labels(self, q_id: str, q_data: dict) -> list[dict]:
        """Build labels list, auto-injecting question_type label."""
        labels = []
        seen_types = set()

        for lbl in q_data.get("labels", []):
            label = {
                "label_type": lbl.get("label_type", "knowledge_point"),
                "label_id": lbl.get("label_id", lbl.get("knowledge_point_id", "")),
                "role": lbl.get("role", "主要"),
                "confidence": lbl.get("confidence"),
                "source": lbl.get("source", "ai"),
            }
            labels.append(label)
            seen_types.add(label["label_type"])

        # Auto-inject question_type label from top-level field
        qtype = q_data.get("question_type")
        if qtype and "question_type" not in seen_types:
            labels.append({
                "label_type": "question_type",
                "label_id": qtype,
                "role": "主要",
                "confidence": 1.0,
                "source": "auto",
            })

        return labels
