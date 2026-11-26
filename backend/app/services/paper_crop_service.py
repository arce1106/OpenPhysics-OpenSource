import re
from itertools import combinations
from pathlib import Path

from PIL import Image, ImageOps


def crop_paper_batch_by_separators(
    page_paths: list[Path],
    question_ids: list[str],
    output_dir: Path,
    static_prefix: str,
    batch_timestamp: str,
) -> dict[str, str]:
    """Crop printed worksheet photos into per-question images using separator lines."""
    if not page_paths or not question_ids:
        return {}

    segments: list[tuple[Path, int, int]] = []
    for page_path in page_paths:
        expected_count = len(question_ids) if len(page_paths) == 1 else None
        segments.extend(_detect_question_segments(page_path, expected_count))

    if len(segments) < len(question_ids):
        segments = _fallback_even_segments(page_paths, len(question_ids))
    if len(segments) < len(question_ids):
        return {}

    output_dir.mkdir(parents=True, exist_ok=True)
    crops: dict[str, str] = {}
    for index, (question_id, (page_path, top, bottom)) in enumerate(zip(question_ids, segments), start=1):
        safe_qid = _safe_filename_part(question_id)
        filename = f"{batch_timestamp}_paper_crop_{index}_{safe_qid}.jpg"
        output_path = output_dir / filename
        with _open_upright_image(page_path) as image:
            width, height = image.size
            crop_top = max(0, top)
            crop_bottom = min(height, bottom)
            if crop_bottom - crop_top < max(60, height * 0.04):
                continue
            image.crop((0, crop_top, width, crop_bottom)).convert("RGB").save(
                output_path,
                format="JPEG",
                quality=92,
                optimize=True,
            )
        crops[question_id] = f"{static_prefix}/{filename}"
    return crops


def _detect_question_segments(page_path: Path, expected_count: int | None = None) -> list[tuple[Path, int, int]]:
    with _open_upright_image(page_path) as image:
        gray = ImageOps.grayscale(image)
        width, height = gray.size
        separator_rows = _detect_separator_rows(gray, expected_count)

    if len(separator_rows) < 2:
        return []

    raw_segments = [
        (separator_rows[i] + 4, separator_rows[i + 1] - 4)
        for i in range(len(separator_rows) - 1)
    ]
    min_height = max(80, int(height * 0.08))
    return [
        (page_path, top, bottom)
        for top, bottom in raw_segments
        if bottom - top >= min_height
    ]


def _fallback_even_segments(page_paths: list[Path], question_count: int) -> list[tuple[Path, int, int]]:
    if not page_paths or question_count <= 0:
        return []
    segments: list[tuple[Path, int, int]] = []
    base_count = question_count // len(page_paths)
    remainder = question_count % len(page_paths)
    for page_index, page_path in enumerate(page_paths):
        count = base_count + (1 if page_index < remainder else 0)
        if count <= 0:
            continue
        with _open_upright_image(page_path) as image:
            top, bottom = _content_vertical_bounds(ImageOps.grayscale(image))
        usable_height = bottom - top
        if usable_height <= 0:
            continue
        for index in range(count):
            seg_top = top + round(usable_height * index / count)
            seg_bottom = top + round(usable_height * (index + 1) / count)
            segments.append((page_path, seg_top, seg_bottom))
    return segments


def _content_vertical_bounds(gray: Image.Image) -> tuple[int, int]:
    width, height = gray.size
    pixels = gray.load()
    rows: list[int] = []
    for y in range(height):
        non_background = 0
        for x in range(0, width, 8):
            value = pixels[x, y]
            if 35 < value < 248:
                non_background += 1
        if non_background >= max(2, width // 240):
            rows.append(y)
    if not rows:
        return 0, height
    margin = max(12, height // 80)
    return max(0, min(rows) - margin), min(height, max(rows) + margin)


def _detect_separator_rows(gray: Image.Image, expected_count: int | None = None) -> list[int]:
    width, height = gray.size
    x0 = int(width * 0.05)
    x1 = int(width * 0.95)
    step = max(1, width // 700)
    sample_xs = range(x0, x1, step)
    sample_count = max(1, len(range(x0, x1, step)))
    pixels = gray.load()
    row_scores: list[float] = []

    for y in range(height):
        dark_count = 0
        for x in sample_xs:
            if pixels[x, y] < 105:
                dark_count += 1
        row_scores.append(dark_count / sample_count)

    candidate_rows = [y for y, score in enumerate(row_scores) if score >= 0.16]
    groups = _group_close_rows(candidate_rows, max_gap=6)
    candidates = []
    for start, end in groups:
        if end - start > max(40, height // 45):
            continue
        best_row = max(range(start, end + 1), key=lambda row: row_scores[row])
        candidates.append((best_row, row_scores[best_row]))
    if expected_count:
        return _select_separator_rows_for_count(candidates, expected_count, height)
    return [row for row, _ in candidates]


def _select_separator_rows_for_count(
    candidates: list[tuple[int, float]],
    expected_count: int,
    height: int,
) -> list[int]:
    boundary_count = expected_count + 1
    if len(candidates) <= boundary_count:
        return [row for row, _ in candidates]

    min_gap = max(80, int(height / max(1, expected_count * 2.7)))
    best_rows: tuple[int, ...] | None = None
    best_score = -1.0
    for combo in combinations(candidates, boundary_count):
        rows = tuple(row for row, _ in combo)
        if any(rows[index + 1] - rows[index] < min_gap for index in range(len(rows) - 1)):
            continue
        score = sum(weight for _, weight in combo)
        if score > best_score:
            best_score = score
            best_rows = rows
    if best_rows:
        return list(best_rows)
    return [row for row, _ in candidates]


def _group_close_rows(rows: list[int], max_gap: int) -> list[tuple[int, int]]:
    if not rows:
        return []
    groups: list[tuple[int, int]] = []
    start = rows[0]
    previous = rows[0]
    for row in rows[1:]:
        if row - previous <= max_gap:
            previous = row
            continue
        groups.append((start, previous))
        start = previous = row
    groups.append((start, previous))
    return groups


def _safe_filename_part(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("._") or "question"


def _open_upright_image(page_path: Path) -> Image.Image:
    image = Image.open(page_path)
    upright = ImageOps.exif_transpose(image)
    if upright is image:
        return image
    image.close()
    return upright
