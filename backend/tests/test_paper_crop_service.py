from pathlib import Path

from PIL import Image, ImageDraw

from app.services.paper_crop_service import crop_paper_batch_by_separators


def test_crop_paper_batch_by_separators_creates_per_question_images(tmp_path: Path):
    page = tmp_path / "worksheet.jpg"
    image = Image.new("RGB", (800, 1000), "white")
    draw = ImageDraw.Draw(image)
    for y in (120, 420, 760):
        draw.line((40, y, 760, y), fill=(120, 120, 120), width=3)
    draw.text((70, 160), "第 1 题", fill=(0, 0, 0))
    draw.text((70, 460), "第 2 题", fill=(0, 0, 0))
    image.save(page, quality=95)

    crops = crop_paper_batch_by_separators(
        page_paths=[page],
        question_ids=["q_001", "q_002"],
        output_dir=tmp_path,
        static_prefix="/static/uploads/answers/student",
        batch_timestamp="20260515_190000_000000",
    )

    assert set(crops) == {"q_001", "q_002"}
    for path in crops.values():
        assert path.startswith("/static/uploads/answers/student/")
        crop_file = tmp_path / Path(path).name
        assert crop_file.exists()
        with Image.open(crop_file) as crop:
            assert crop.width == 800
            assert crop.height > 200


def test_crop_paper_batch_falls_back_to_even_page_slices(tmp_path: Path):
    page = tmp_path / "worksheet_no_lines.jpg"
    image = Image.new("RGB", (800, 1000), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((20, 20, 780, 980), outline=(0, 0, 0), width=2)
    draw.text((70, 100), "第 1 题", fill=(0, 0, 0))
    draw.text((70, 420), "第 2 题", fill=(0, 0, 0))
    draw.text((70, 740), "第 3 题", fill=(0, 0, 0))
    image.save(page, quality=95)

    crops = crop_paper_batch_by_separators(
        page_paths=[page],
        question_ids=["q_001", "q_002", "q_003"],
        output_dir=tmp_path,
        static_prefix="/static/uploads/answers/student",
        batch_timestamp="20260515_190500_000000",
    )

    assert set(crops) == {"q_001", "q_002", "q_003"}


def test_crop_paper_batch_normalizes_exif_orientation_before_cropping(tmp_path: Path):
    page = tmp_path / "phone_worksheet.jpg"
    upright = Image.new("RGB", (600, 900), "white")
    draw = ImageDraw.Draw(upright)
    for y in (100, 400, 800):
        draw.line((40, y, 560, y), fill=(0, 0, 0), width=4)
    draw.text((70, 150), "第 1 题", fill=(0, 0, 0))
    draw.text((70, 450), "第 2 题", fill=(0, 0, 0))

    raw_phone_image = upright.transpose(Image.Transpose.ROTATE_90)
    exif = raw_phone_image.getexif()
    exif[274] = 6
    raw_phone_image.save(page, exif=exif.tobytes(), quality=95)

    crops = crop_paper_batch_by_separators(
        page_paths=[page],
        question_ids=["q_001", "q_002"],
        output_dir=tmp_path,
        static_prefix="/static/uploads/answers/student",
        batch_timestamp="20260515_191000_000000",
    )

    assert set(crops) == {"q_001", "q_002"}
    first_crop = tmp_path / Path(crops["q_001"]).name
    with Image.open(first_crop) as crop:
        assert crop.width == 600
        assert crop.height > 250


def test_crop_paper_batch_ignores_internal_lines_when_question_count_is_known(tmp_path: Path):
    page = tmp_path / "worksheet_with_internal_lines.jpg"
    image = Image.new("RGB", (800, 1000), "white")
    draw = ImageDraw.Draw(image)
    for y in (100, 420, 820):
        draw.line((40, y, 760, y), fill=(0, 0, 0), width=3)
    for y in (240, 580):
        draw.line((80, y, 560, y), fill=(0, 0, 0), width=3)
    draw.text((70, 150), "第 1 题", fill=(0, 0, 0))
    draw.text((70, 470), "第 2 题", fill=(0, 0, 0))
    image.save(page, quality=95)

    crops = crop_paper_batch_by_separators(
        page_paths=[page],
        question_ids=["q_001", "q_002"],
        output_dir=tmp_path,
        static_prefix="/static/uploads/answers/student",
        batch_timestamp="20260515_191500_000000",
    )

    assert set(crops) == {"q_001", "q_002"}
    for question_id in ("q_001", "q_002"):
        crop_file = tmp_path / Path(crops[question_id]).name
        with Image.open(crop_file) as crop:
            assert crop.height > 280
