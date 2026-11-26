#!/usr/bin/env python3
"""Build offline Simplified Chinese subsets without changing retained glyph shapes.

Requires fonttools==4.60.2. Source fonts are the original Noto CJK SC 2.004 OTFs;
pass a separate source directory (the full originals are available in Git history).
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from fontTools import subset
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.ttLib import TTFont

ANDROID = Path(__file__).resolve().parents[1]
FONT_NAMES = [f"noto_sans_cjk_sc_{weight}.otf" for weight in ("regular", "medium", "bold")]


def required_codepoints():
    # GB2312 supplies all 6,763 common Simplified Chinese characters, not just current UI strings.
    points = set()
    for lead in range(0xA1, 0xF8):
        for trail in range(0xA1, 0xFF):
            try:
                points.update(map(ord, bytes([lead, trail]).decode("gb2312")))
            except UnicodeDecodeError:
                pass
    # Latin, Greek, mathematical operators, units, arrows, punctuation and full-width ASCII.
    for start, end in [(0x20, 0x24F), (0x370, 0x3FF), (0x2000, 0x2BFF),
                       (0x3000, 0x303F), (0xFE10, 0xFE1F), (0xFE30, 0xFE6F), (0xFF01, 0xFF5E)]:
        points.update(range(start, end + 1))
    # Preserve every extra Han character already used in native UI and local content.
    for source in (ANDROID / "app/src/main").rglob("*"):
        if source.suffix not in {".kt", ".xml", ".json"}:
            continue
        points.update(ord(c) for c in source.read_text(encoding="utf-8") if 0x3400 <= ord(c) <= 0x9FFF)
    # GB2312 also encodes kana; this app deliberately ships the Chinese/physics repertoire only.
    return {p for p in points if not (0x3040 <= p <= 0x30FF or 0x3100 <= p <= 0x312F)}


def verify_shapes(original, result, points):
    old_map, new_map = original.getBestCmap(), result.getBestCmap()
    old_glyphs, new_glyphs = original.getGlyphSet(), result.getGlyphSet()
    for cp in points:
        assert cp in new_map, f"Missing U+{cp:04X}"
        old, new = old_glyphs[old_map[cp]], new_glyphs[new_map[cp]]
        assert old.width == new.width, f"Width changed U+{cp:04X}"
        a, b = DecomposingRecordingPen(old_glyphs), DecomposingRecordingPen(new_glyphs)
        old.draw(a)
        new.draw(b)
        assert a.value == b.value, f"Outline changed U+{cp:04X}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, default=ANDROID / "app/src/main/res/font")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    assert args.source_dir.resolve() != args.output_dir.resolve(), "Keep original fonts separate"
    args.output_dir.mkdir(parents=True, exist_ok=True)
    required = required_codepoints()
    report = []
    for name in FONT_NAMES:
        source = args.source_dir / name
        original = TTFont(source, recalcTimestamp=False)
        points = required & set(original.getBestCmap())
        font = TTFont(source, recalcTimestamp=False)
        options = subset.Options()
        options.layout_features = ["ccmp", "locl", "kern", "liga", "clig", "mark", "mkmk"]
        # Keep the SC/default forms, without carrying Japanese/Korean alternate Han glyphs.
        options.layout_scripts = [f"{script}.{lang}" for script in ("DFLT", "hani", "latn", "grek", "cyrl")
                                  for lang in ("dflt", "ZHS")]
        options.name_IDs = ["*"]
        options.name_legacy = True
        options.name_languages = ["*"]
        options.notdef_outline = True
        sub = subset.Subsetter(options=options)
        sub.populate(unicodes=points)
        sub.subset(font)
        output = args.output_dir / name
        font.save(output)
        result = TTFont(output)
        verify_shapes(original, result, points)
        report.append({"font": name, "source_bytes": source.stat().st_size,
                       "subset_bytes": output.stat().st_size, "original_glyphs": len(original.getGlyphOrder()),
                       "subset_glyphs": len(result.getGlyphOrder()), "unicode_characters": len(points),
                       "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                       "subset_sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
                       "all_retained_shapes_and_widths_verified": True})
    text = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
