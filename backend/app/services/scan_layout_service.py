"""Find the printed boxes on a scanned homework page, locally, without any AI.

The printed homework (frontend/teacher PrintPage) carries no codes. A scan is
read back from its ruled shapes alone:

- number boxes: a row of 7 x 8 mm squares at the top right of a copy's first
  page, on the name line;
- the choice answer table: rows of 11 x 9 mm answer cells, each directly under a
  row of 11 x 6 mm question-number cells, below the title (top right on older papers);
- answer areas: boxes with a thin dashed border (heavy and solid on older papers)
  and a solid 3 mm square in their top-left corner, one per non-choice question, in paper order. The paper is
  printed in two columns, so the left column is read top to bottom before the
  right one; older single-column papers have full-width boxes and read the same.

Sizes are measured in millimetres from the page width (A4), so any scan
resolution or a printer's small "fit to page" scaling still matches.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np
import pypdfium2 as pdfium

A4_WIDTH_MM = 210.0
RENDER_DPI = 200
BLANK_INK_RATIO = 0.003

NUMBER_BOX_MM = (7.0, 8.0)
ANSWER_CELL_MM = (11.0, 9.0)
NUMBER_CELL_MM = (11.0, 6.0)
SIZE_TOLERANCE = 0.3
AREA_MIN_WIDTH_MM = 60.0
AREA_MIN_HEIGHT_MM = 25.0
CORNER_MARK_MM = 3.0
# Printed dashes leave gaps of 0.5 mm (1 px border) to 1 mm (older 1.5 pt border);
# closing across 2 mm joins them into rules
# while the ~2.4 mm gaps between text lines stay open.
DASH_BRIDGE_MM = 2.0
MAX_SKEW_DEGREES = 5.0


Rect = tuple[int, int, int, int]


@dataclass
class PageLayout:
    width: int
    height: int
    px_per_mm: float
    blank: bool = False
    number_boxes: list[Rect] = field(default_factory=list)
    answer_cells: list[Rect] = field(default_factory=list)
    areas: list[Rect] = field(default_factory=list)

    @property
    def is_first_page(self) -> bool:
        return bool(self.number_boxes)

    def as_dict(self) -> dict:
        return {
            "size": [self.width, self.height],
            "px_per_mm": round(self.px_per_mm, 3),
            "blank": self.blank,
            "number_boxes": [list(rect) for rect in self.number_boxes],
            "answer_cells": [list(rect) for rect in self.answer_cells],
            "areas": [list(rect) for rect in self.areas],
        }


class UnreadableScan(ValueError):
    """The upload is not a PDF or image this service can read."""


def load_pages(data: bytes, filename: str) -> list[np.ndarray]:
    """Grayscale page images from a PDF or a single image file."""
    if data[:5] == b"%PDF-" or filename.lower().endswith(".pdf"):
        try:
            document = pdfium.PdfDocument(data)
        except Exception as exc:
            raise UnreadableScan("无法读取这个 PDF 文件") from exc
        pages = []
        for index in range(len(document)):
            image = document[index].render(scale=RENDER_DPI / 72, grayscale=True).to_numpy()
            pages.append(image if image.ndim == 2 else cv2.cvtColor(image, cv2.COLOR_BGR2GRAY))
        return pages
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise UnreadableScan("无法读取这个图片文件")
    return [image]


def _binary(gray: np.ndarray) -> np.ndarray:
    return cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 31, 15)


def _skew_angle(binary: np.ndarray) -> float:
    """The rotation that makes rows of ink line up best (projection-profile method).

    Printed rules and text lines both sharpen the row profile when level, so this
    holds on pages with little printing and a lot of handwriting.
    """
    small = cv2.resize(binary, (binary.shape[1] // 4, binary.shape[0] // 4), interpolation=cv2.INTER_AREA)
    height, width = small.shape
    centre = (width / 2, height / 2)

    def score(angle: float) -> float:
        rotated = cv2.warpAffine(small, cv2.getRotationMatrix2D(centre, angle, 1.0), (width, height))
        return float(np.var(rotated.sum(axis=1, dtype=np.float64)))

    best = max(np.arange(-MAX_SKEW_DEGREES, MAX_SKEW_DEGREES + 0.01, 0.5), key=score)
    return float(max(np.arange(best - 0.5, best + 0.51, 0.05), key=score))


def deskew(gray: np.ndarray) -> np.ndarray:
    angle = _skew_angle(_binary(gray))
    if abs(angle) < 0.05:
        return gray
    height, width = gray.shape
    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), angle, 1.0)
    return cv2.warpAffine(gray, matrix, (width, height), flags=cv2.INTER_LINEAR, borderValue=255)


def _enclosed_cells(binary: np.ndarray, horizontal_px: int, vertical_px: int, bridge_px: int = 0) -> list[Rect]:
    """Rectangles enclosed by ruled lines at least the given lengths.

    With ``bridge_px`` dashed rules count too: gaps up to that size along a line are closed first.
    """
    across, down = binary, binary
    if bridge_px:
        across = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (bridge_px, 1)))
        down = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (1, bridge_px)))
    horizontal = cv2.morphologyEx(across, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (horizontal_px, 1)))
    vertical = cv2.morphologyEx(down, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, vertical_px)))
    ruled = cv2.dilate(cv2.bitwise_or(horizontal, vertical), np.ones((3, 3), np.uint8))
    count, _, stats, _ = cv2.connectedComponentsWithStats(cv2.bitwise_not(ruled), connectivity=4)
    height, width = binary.shape
    cells = []
    for index in range(1, count):
        x, y, w, h, _ = stats[index]
        if x == 0 or y == 0 or x + w >= width or y + h >= height:
            continue
        cells.append((int(x), int(y), int(w), int(h)))
    return cells


def _matches(rect: Rect, size_mm: tuple[float, float], px_per_mm: float) -> bool:
    _, _, w, h = rect
    target_w, target_h = size_mm[0] * px_per_mm, size_mm[1] * px_per_mm
    return (abs(w - target_w) <= target_w * SIZE_TOLERANCE) and (abs(h - target_h) <= target_h * SIZE_TOLERANCE)


def _rows(rects: list[Rect], tolerance: float) -> list[list[Rect]]:
    rows: list[list[Rect]] = []
    for rect in sorted(rects, key=lambda r: (r[1], r[0])):
        centre = rect[1] + rect[3] / 2
        if rows and abs(rows[-1][0][1] + rows[-1][0][3] / 2 - centre) <= tolerance:
            rows[-1].append(rect)
        else:
            rows.append([rect])
    return [sorted(row, key=lambda r: r[0]) for row in rows]


def _has_corner_mark(binary: np.ndarray, rect: Rect, px_per_mm: float) -> bool:
    """A solid 3 mm square sits in the box's top-left corner.

    Looks for any solid 2 mm square inside a 4.5 mm window: the window is larger than
    the mark so a little leftover tilt or offset still finds it, and stops short of the
    printed "第 n 题作答区" label 5 mm in. Handwriting is never that solid.
    """
    x, y, _, _ = rect
    size = max(3, int(4.5 * px_per_mm))
    patch = binary[y:y + size, x:x + size]
    probe = max(2, int(2 * px_per_mm))
    if patch.shape[0] < probe or patch.shape[1] < probe:
        return False
    density = cv2.boxFilter(patch.astype(np.float32) / 255, -1, (probe, probe), normalize=True,
                            borderType=cv2.BORDER_CONSTANT)
    return float(density.max()) > 0.85


def _extend_down(rect: Rect, cells: list[Rect], px_per_mm: float) -> Rect:
    """Rejoin pieces of one area that a stroke drawn edge to edge has cut apart."""
    x, y, w, h = rect
    tolerance = 2 * px_per_mm
    while True:
        below = next((cell for cell in cells
                      if abs(cell[0] - x) <= tolerance and abs(cell[2] - w) <= tolerance
                      and 0 <= cell[1] - (y + h) <= 1.5 * tolerance), None)
        if below is None:
            return x, y, w, h
        h = below[1] + below[3] - y


def analyse_page(gray: np.ndarray) -> PageLayout:
    height, width = gray.shape
    px_per_mm = width / A4_WIDTH_MM
    layout = PageLayout(width=width, height=height, px_per_mm=px_per_mm)
    binary = _binary(gray)
    margin = int(8 * px_per_mm)
    if float(binary[margin:-margin, margin:-margin].mean()) / 255 < BLANK_INK_RATIO:
        layout.blank = True
        return layout

    # Answer areas: only long rules enclose them, so ordinary handwriting inside cannot split them.
    wide = [
        rect for rect in _enclosed_cells(binary, int(40 * px_per_mm), int(20 * px_per_mm),
                                         bridge_px=int(DASH_BRIDGE_MM * px_per_mm))
        if rect[2] >= AREA_MIN_WIDTH_MM * px_per_mm
    ]
    for rect in wide:
        if not _has_corner_mark(binary, rect, px_per_mm):
            continue
        rect = _extend_down(rect, wide, px_per_mm)
        if rect[3] >= AREA_MIN_HEIGHT_MM * px_per_mm:
            layout.areas.append(rect)
    # Full-width boxes start at the left margin, so they sort as left-column boxes.
    layout.areas.sort(key=lambda r: (r[0] > width * 0.45, r[1], r[0]))

    small = _enclosed_cells(binary, int(5 * px_per_mm), int(5 * px_per_mm))
    top_band = height * 0.25
    number_boxes = [rect for rect in small if _matches(rect, NUMBER_BOX_MM, px_per_mm) and rect[1] < top_band]
    if number_boxes:
        rows = _rows(number_boxes, 3 * px_per_mm)
        layout.number_boxes = rows[0]

    number_cells = [rect for rect in small if _matches(rect, NUMBER_CELL_MM, px_per_mm)]
    answer_cells = [rect for rect in small if _matches(rect, ANSWER_CELL_MM, px_per_mm)]
    near = 2 * px_per_mm

    def below(cell: Rect) -> Rect | None:
        x, y, _, h = cell
        return next((rect for rect in answer_cells
                     if abs(rect[0] - x) <= near and 0 <= rect[1] - (y + h) <= near), None)

    # Each answer cell is found through the printed question-number cell above it: handwriting
    # that runs over a border can break an answer cell's outline, but never a number cell's.
    for row in _rows(number_cells, 3 * px_per_mm):
        # The row starts with the "题号" heading over the "答案" heading; a data table in a
        # question stem lacks that pair or comes later, after the answer table.
        heading = below(row[0])
        if len(row) < 2 or heading is None:
            continue
        gap, height = heading[1] - (row[0][1] + row[0][3]), heading[3]
        for cell in row[1:]:
            x, y, w, h = cell
            layout.answer_cells.append(below(cell) or (x, y + h + gap, w, height))
    return layout


def crop(gray: np.ndarray, rect: Rect, inset: int = 0) -> np.ndarray:
    """The rectangle shrunk by inset on every side; a negative inset takes a margin around it."""
    x, y, w, h = rect
    height, width = gray.shape[:2]
    return gray[max(0, y + inset):min(height, y + h - inset), max(0, x + inset):min(width, x + w - inset)]


def union(rects: list[Rect], pad: int = 0) -> Rect:
    x0 = min(r[0] for r in rects) - pad
    y0 = min(r[1] for r in rects) - pad
    x1 = max(r[0] + r[2] for r in rects) + pad
    y1 = max(r[1] + r[3] for r in rects) + pad
    return (max(0, x0), max(0, y0), x1 - max(0, x0), y1 - max(0, y0))


def choice_strip(cells: list[np.ndarray], numbers: list[int], per_row: int = 10) -> np.ndarray:
    """Answer cells side by side under their printed question numbers, for one AI call."""
    cell_w, cell_h, label_h = 140, 120, 34
    rows = (len(cells) + per_row - 1) // per_row
    strip = np.full((rows * (cell_h + label_h), min(per_row, len(cells)) * cell_w), 255, np.uint8)
    for index, (image, number) in enumerate(zip(cells, numbers)):
        row, column = divmod(index, per_row)
        x, y = column * cell_w, row * (cell_h + label_h)
        cv2.putText(strip, str(number), (x + 8, y + 26), cv2.FONT_HERSHEY_SIMPLEX, 0.8, 0, 2)
        resized = cv2.resize(image, (cell_w - 10, cell_h - 10)) if image.size else np.full((cell_h - 10, cell_w - 10), 255, np.uint8)
        strip[y + label_h + 5:y + label_h + cell_h - 5, x + 5:x + cell_w - 5] = resized
        cv2.rectangle(strip, (x + 2, y + label_h + 2), (x + cell_w - 3, y + label_h + cell_h - 3), 160, 1)
    return strip


def encode_jpeg(image: np.ndarray, quality: int = 85) -> bytes:
    ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise ValueError("image encoding failed")
    return encoded.tobytes()


def decode_image(data: bytes) -> np.ndarray:
    return cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_GRAYSCALE)
