"""Synthetic scans of the printed homework (frontend/teacher PrintPage) for layout tests."""
from __future__ import annotations

import io
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

DPI = 200
PX_PER_MM = DPI / 25.4
PAGE_W, PAGE_H = round(210 * PX_PER_MM), round(297 * PX_PER_MM)
LINE = 3  # 1.5 CSS px at 200 dpi
HEAVY = 4  # 1.5 pt
THIN = 2  # 1 CSS px, the dashed answer-area border


def mm(value: float) -> int:
    return round(value * PX_PER_MM)


def _font(size_mm: float) -> ImageFont.ImageFont:
    return ImageFont.load_default(size=mm(size_mm))


def _box(draw: ImageDraw.ImageDraw, x: float, y: float, w: float, h: float, width: int = LINE) -> None:
    draw.rectangle([mm(x), mm(y), mm(x + w), mm(y + h)], outline=0, width=width)


def _text_lines(draw: ImageDraw.ImageDraw, y: float, lines: int, rng: random.Random) -> float:
    for _ in range(lines):
        x = 20.0
        while x < 185:
            length = rng.uniform(3, 12)
            draw.rectangle([mm(x), mm(y), mm(min(x + length, 190)), mm(y + 2.4)], fill=90)
            x += length + rng.uniform(1, 3)
        y += 6
    return y + 2


def _dashed_box(draw: ImageDraw.ImageDraw, x: float, y: float, w: float, h: float, width: int) -> None:
    """Chrome's printed 1 px dashed border: about 0.76 mm dashes, 0.5 mm gaps."""
    dash, gap = 0.76, 0.51
    for edge in range(4):
        length = w if edge % 2 == 0 else h
        offset = 0.0
        while offset < length:
            end = min(offset + dash, length)
            if edge == 0:
                draw.rectangle([mm(x + offset), mm(y), mm(x + end), mm(y) + width], fill=0)
            elif edge == 2:
                draw.rectangle([mm(x + offset), mm(y + h) - width, mm(x + end), mm(y + h)], fill=0)
            elif edge == 1:
                draw.rectangle([mm(x + w) - width, mm(y + offset), mm(x + w), mm(y + end)], fill=0)
            else:
                draw.rectangle([mm(x), mm(y + offset), mm(x) + width, mm(y + end)], fill=0)
            offset += dash + gap


def _scribble(draw: ImageDraw.ImageDraw, x: float, y: float, w: float, h: float, rng: random.Random) -> None:
    for _ in range(6):
        points = [(mm(x + rng.uniform(5, w - 5)), mm(y + rng.uniform(8, h - 5))) for _ in range(4)]
        draw.line(points, fill=20, width=3)
    # A long handwritten fraction bar must not split the answer area.
    draw.line([(mm(x + 10), mm(y + h / 2)), (mm(x + w - 20), mm(y + h / 2 + 1))], fill=20, width=3)


def _area(draw, y: float, height: float, rng, x: float = 22.0, w: float = 172.0, dashed: bool = False,
          cut: bool = False) -> float:
    if dashed:
        _dashed_box(draw, x, y, w, height, THIN)
    else:
        _box(draw, x, y, w, height, HEAVY)
    if cut:
        # A working line drawn right across the box, ending just short of each border.
        draw.line([(mm(x + 0.6), mm(y + height * 0.4)), (mm(x + w - 0.6), mm(y + height * 0.4))], fill=20, width=3)
    draw.rectangle([mm(x), mm(y), mm(x + 3), mm(y + 3)], fill=0)
    _scribble(draw, x, y, w, height, rng)
    return y + height + 4


def homework_pages(
    *,
    number: str | None,
    choices: list[str],
    area_heights: list[float],
    seed: int = 1,
    number_boxes: int = 2,
    box_mm: tuple[float, float] = (7.0, 8.0),
    overrun: int | None = None,
    stem_table: bool = True,
    columns: int = 1,
    dashed: bool = False,
    cut: bool = False,
) -> list[Image.Image]:
    """One student's copy: header with number boxes, choice table, stems and answer areas.

    With two columns the areas fill the left column of a page, then the right one.
    """
    rng = random.Random(seed)
    pages: list[Image.Image] = []

    def new_page():
        image = Image.new("L", (PAGE_W, PAGE_H), 255)
        pages.append(image)
        return ImageDraw.Draw(image), 16.0

    draw, y = new_page()
    # Header, as printed: the name line at the left and the 7 x 8 mm number boxes at the right,
    # above the top rule; under it the title, and the choice answer table at the top right.
    draw.rectangle([mm(24), mm(16), mm(56), mm(16.3)], fill=0)  # name line
    step = box_mm[0] + 1.5
    left = 196 - number_boxes * step
    for index in range(number_boxes):
        _box(draw, left + index * step, 9, *box_mm)
    if number:
        for index, digit in enumerate(number.rjust(number_boxes)):
            if digit.strip():
                draw.text((mm(left + index * step + 1.5), mm(9.3)), digit, fill=10, font=_font(6.5))
    draw.rectangle([mm(14), mm(20), mm(196), mm(20.3)], fill=0)  # top rule
    draw.rectangle([mm(14), mm(26), mm(60), mm(31)], fill=60)  # title, left of the table
    draw.rectangle([mm(14), mm(34), mm(64), mm(37)], fill=110)  # meta line
    y = 48.0
    table_y = 23.0
    per_row = -(-len(choices) // -(-len(choices) // 10)) if choices else 10
    for start in range(0, len(choices), per_row):
        row = choices[start:start + per_row]
        x0 = 196 - (len(row) + 1) * 11
        for column in range(len(row) + 1):
            _box(draw, x0 + column * 11, table_y, 11, 6)
            _box(draw, x0 + column * 11, table_y + 6, 11, 9)
            if column:
                draw.text((mm(x0 + column * 11 + 4), mm(table_y + 1)), str(start + column), fill=0, font=_font(3.5))
                letters = row[column - 1]
                if letters:
                    if overrun == start + column:
                        # A long answer like "ABCD" running over the cell's right and bottom borders.
                        draw.line([(mm(x0 + column * 11 + 6), mm(table_y + 6.5)),
                                   (mm(x0 + column * 11 + 13), mm(table_y + 16))], fill=20, width=3)
                        draw.line([(mm(x0 + column * 11 + 5.5), mm(table_y + 5.6)),
                                   (mm(x0 + column * 11 + 6), mm(table_y + 15.8))], fill=20, width=3)
                    # Like handwriting, no two students' letters land in quite the same place.
                    draw.text((mm(x0 + column * 11 + 2 + rng.uniform(-0.8, 0.8)), mm(table_y + 7 + rng.uniform(-0.6, 0.6))),
                              letters, fill=15, font=_font(6))
        table_y += 18
    y = max(y, table_y + 4)
    if choices:
        y = _text_lines(draw, y, 3 * len(choices) // 2 + 2, rng)

    if stem_table:
        # Data tables inside question stems must not be taken for the answer table.
        for row, height in enumerate((7, 12)):
            for column in range(4):
                _box(draw, 30 + column * 15, y + row * 7, 15, height if row else 7)
        y += 25

    if columns == 1:
        for height in area_heights:
            if y + 14 + height > 280:
                draw, y = new_page()
            y = _text_lines(draw, y, 2, rng)
            y = _area(draw, y, height, rng)
        return pages

    column, top = 0, y
    for height in area_heights:
        if y + 14 + height > 280:
            column, y = column + 1, top
            if column == 2:
                draw, y = new_page()
                column, top = 0, y
        x = 22.0 if column == 0 else 112.0
        draw.rectangle([mm(x - 2), mm(y), mm(x + 60), mm(y + 2.4)], fill=90)  # stem line
        y = _area(draw, y + 8, height, rng, x=x, w=78.0, dashed=dashed, cut=cut)
    return pages


def scanned(page: Image.Image, *, angle: float = 0.0, noise: bool = True, seed: int = 1) -> Image.Image:
    image = page.rotate(angle, resample=Image.BICUBIC, expand=False, fillcolor=255) if angle else page
    if noise:
        rng = random.Random(seed)
        draw = ImageDraw.Draw(image)
        for _ in range(400):
            x, y = rng.randrange(PAGE_W), rng.randrange(PAGE_H)
            draw.point((x, y), fill=rng.randrange(120, 220))
        image = image.filter(ImageFilter.GaussianBlur(0.6))
    return image


def blank_page() -> Image.Image:
    return Image.new("L", (PAGE_W, PAGE_H), 252)


def to_pdf(pages: list[Image.Image]) -> bytes:
    buffer = io.BytesIO()
    pages[0].convert("RGB").save(buffer, format="PDF", save_all=True, resolution=DPI,
                                 append_images=[page.convert("RGB") for page in pages[1:]])
    return buffer.getvalue()
