import datetime
from pathlib import Path

from fastapi import HTTPException

from app.services.answer_image_inference import should_infer_paper_batch_image
from app.services.answer_media_service import answer_media_service


def prefer_paper_image_history_answers(answers: list) -> list:
    deduped: list = []
    for answer in answers:
        match_index = next(
            (
                index
                for index, existing in enumerate(deduped)
                if _is_same_recent_answer(existing, answer)
            ),
            None,
        )
        if match_index is None:
            deduped.append(answer)
            continue
        existing = deduped[match_index]
        if _answer_has_paper_image(answer) and not _answer_has_paper_image(existing):
            deduped[match_index] = answer
    return deduped


def _is_same_recent_answer(left, right) -> bool:
    if left.question_id != right.question_id:
        return False
    if _compact_answer(left.given_answer) != _compact_answer(right.given_answer):
        return False
    if not left.created_at or not right.created_at:
        return False
    left_dt = left.created_at if left.created_at.tzinfo else left.created_at.replace(tzinfo=datetime.timezone.utc)
    right_dt = right.created_at if right.created_at.tzinfo else right.created_at.replace(tzinfo=datetime.timezone.utc)
    return abs((left_dt - right_dt).total_seconds()) <= 15 * 60


def _answer_has_paper_image(answer) -> bool:
    grading = answer.grading_result if isinstance(answer.grading_result, dict) else {}
    return bool(grading.get("answer_image_path") or grading.get("answer_image_paths"))


def _compact_answer(value: str | None) -> str:
    return "".join(str(value or "").split())


def parse_history_boundary(value: str | None, end: bool) -> datetime.datetime | None:
    if not value:
        return None
    raw = value.strip()
    try:
        if len(raw) == 10:
            day = datetime.date.fromisoformat(raw)
            if end:
                day = day + datetime.timedelta(days=1)
            return datetime.datetime.combine(day, datetime.time.min, tzinfo=datetime.timezone.utc)
        parsed = datetime.datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=datetime.timezone.utc)
        return parsed
    except ValueError:
        raise HTTPException(status_code=400, detail="历史记录日期格式错误")


def attach_inferred_answer_images(
    student_id: str,
    created_at: datetime.datetime | None,
    process_grading: dict | None,
    given_answer: str | None,
) -> dict | None:
    grading = process_grading or {}
    result = process_grading
    should_infer = (
        not grading.get("answer_image_path")
        and not grading.get("answer_image_paths")
        and created_at is not None
        and should_infer_paper_batch_image(grading, given_answer)
    )
    if should_infer:
        paths = _infer_paper_batch_image_paths(student_id, created_at)
        if paths:
            result = {
                **grading,
                "answer_image_path": paths[0],
                "answer_image_paths": paths,
                "answer_source": grading.get("answer_source") or "paper_batch",
            }
    return answer_media_service.secure_payload(student_id, result)


def _infer_paper_batch_image_paths(student_id: str, created_at: datetime.datetime) -> list[str]:
    static_dir = Path(__file__).resolve().parents[3] / "static"
    upload_dir = static_dir / "uploads" / "answers" / student_id
    if not upload_dir.exists():
        return []
    created = created_at if created_at.tzinfo else created_at.replace(tzinfo=datetime.timezone.utc)
    candidates: list[tuple[float, str, Path]] = []
    for path in upload_dir.glob("*_paper_batch_*.*"):
        timestamp = "_".join(path.name.split("_")[:3])
        try:
            taken = datetime.datetime.strptime(timestamp, "%Y%m%d_%H%M%S_%f").replace(tzinfo=datetime.timezone.utc)
        except ValueError:
            continue
        delta = (created - taken).total_seconds()
        if 0 <= delta <= 15 * 60:
            candidates.append((delta, timestamp, path))
    if not candidates:
        return []
    _, best_timestamp, _ = min(candidates, key=lambda item: item[0])
    return [
        f"/static/uploads/answers/{student_id}/{path.name}"
        for path in sorted(upload_dir.glob(f"{best_timestamp}_paper_batch_*.*"))
    ]
