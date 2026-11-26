"""Parse Word (.docx) documents into question fragments for AI extraction."""
import re
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

DOCX_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
RELS_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PIC_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture"
IMAGE_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
MATH_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math"

BLANK_PAT = re.compile(r"　{3,}")


def _convert_blanks(text: str) -> str:
    """Convert ideographic-space blanks (3+ 　) to visible underscores."""
    return BLANK_PAT.sub(lambda m: "_" * len(m.group()), text)


def _normalize_formula_fragments(text: str) -> str:
    """Repair common Word math extraction splits before frontend rendering."""
    if "$" not in text:
        return text

    previous = None
    normalized = text
    while previous != normalized:
        previous = normalized
        normalized = re.sub(r"\$([^$]*\d)\$\.(\d+)", r"$\1.\2$", normalized)
        normalized = re.sub(r"(?<!\$)(\d+)\.\$([0-9][^$]*)\$", r"$\1.\2$", normalized)
        normalized = re.sub(r"_\{([^{}]+)\}_\{\.\}_\{([^{}]+)\}", r"_{\1.\2}", normalized)
        normalized = re.sub(
            r"\$([^$]*=[^$]*\d(?:\.\d+)?)\$([A-Za-zα-ωΑ-ΩΔ][A-Za-z0-9_{}]*)",
            r"$\1\2$",
            normalized,
        )
        normalized = re.sub(
            r"(?<![A-Za-z0-9_$])([A-Za-zα-ωΑ-ΩΔ][A-Za-z0-9_{}]*)=\$([^$]+)\$",
            r"$\1=\2$",
            normalized,
        )
        normalized = re.sub(r"\$([^$]+)\$\(([^$]*)\$([^$]+)\$", r"$\1(\2\3$", normalized)
    return normalized


def _space_after_closing_math_before_paren(text: str) -> str:
    """Separate a closing math delimiter from a following prose parenthesis."""
    if "$" not in text:
        return text

    result: list[str] = []
    in_math = False
    for index, char in enumerate(text):
        result.append(char)
        if char != "$":
            continue

        was_in_math = in_math
        in_math = not in_math
        if was_in_math and index + 1 < len(text) and text[index + 1] in "（(":
            result.append(" ")
    return "".join(result)


def _clean_question_text(text: str) -> str:
    normalized = _normalize_formula_fragments(_convert_blanks(text.strip()))
    return _space_after_closing_math_before_paren(normalized)


def _balance_math_delimiters(text: str) -> str:
    if text.count("$") % 2 == 0:
        return text
    if text.startswith("$"):
        return f"{text}$"
    if text.endswith("$"):
        return f"${text}"
    return text


def _clean_option_text(text: str) -> str:
    cleaned = _clean_question_text(_balance_math_delimiters(text.strip()))
    cleaned = _balance_math_delimiters(cleaned)

    if (
        "$" not in cleaned
        and cleaned
        and not re.search(r"[\u4e00-\u9fff]", cleaned)
        and re.search(r"(\\[A-Za-z]+|[_^]\{?|[A-Za-zα-ωΑ-Ω][A-Za-z0-9_{}]*[+\-*/=<>≈]|[A-Za-z0-9][α-ωΑ-Ω])", cleaned)
    ):
        cleaned = f"${cleaned}$"

    outside_math = re.sub(r"\$[^$]*\$", "", cleaned)
    if (
        "$" in cleaned
        and outside_math
        and re.fullmatch(r"[<>=≤≥≈≠+\-*/:∶×·,\s]+", outside_math)
    ):
        return f"${cleaned.replace('$', '')}$"
    return cleaned


def _unwrap_option_line(line: str) -> str:
    stripped = line.strip()
    wrapped_label = re.match(r"^\$([A-D][.．])(.*)", stripped)
    if wrapped_label:
        return f"{wrapped_label.group(1)}${wrapped_label.group(2)}"
    if stripped.startswith("$") and stripped.endswith("$") and re.match(r"^\$[A-D][.．]", stripped):
        return stripped[1:-1]
    return line


@dataclass
class QuestionFragment:
    source_doc: str
    fragment_index: int
    raw_text: str
    image_paths: list[str] = field(default_factory=list)
    section_hint: str = ""
    question_type_hint: str = ""


def _omml_to_latex(elem: ET.Element) -> str:
    """Recursively convert an OMML math element to LaTeX."""
    tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag

    if tag == "t":
        return elem.text or ""

    if tag in ("r", "oMath", "e", "num", "den", "sub", "sup"):
        parts = []
        for child in elem:
            parts.append(_omml_to_latex(child))
        if elem.tail and elem.tail.strip():
            parts.append(elem.tail)
        return "".join(parts)

    if tag == "f":
        num = "".join(_omml_to_latex(c) for c in elem if c.tag.split("}")[-1] == "num")
        den = "".join(_omml_to_latex(c) for c in elem if c.tag.split("}")[-1] == "den")
        return f"\\frac{{{num}}}{{{den}}}"

    if tag == "sSub":
        base = "".join(_omml_to_latex(c) for c in elem if c.tag.split("}")[-1] == "e")
        sub = "".join(_omml_to_latex(c) for c in elem if c.tag.split("}")[-1] == "sub")
        return f"{base}_{{{sub}}}"

    if tag == "sSup":
        base = "".join(_omml_to_latex(c) for c in elem if c.tag.split("}")[-1] == "e")
        sup = "".join(_omml_to_latex(c) for c in elem if c.tag.split("}")[-1] == "sup")
        return f"{base}^{{{sup}}}"

    if tag == "sSubSup":
        base = "".join(_omml_to_latex(c) for c in elem if c.tag.split("}")[-1] == "e")
        sub = "".join(_omml_to_latex(c) for c in elem if c.tag.split("}")[-1] == "sub")
        sup = "".join(_omml_to_latex(c) for c in elem if c.tag.split("}")[-1] == "sup")
        return f"{base}_{{{sub}}}^{{{sup}}}"

    if tag == "sPre":
        base = "".join(_omml_to_latex(c) for c in elem if c.tag.split("}")[-1] == "e")
        sub = "".join(_omml_to_latex(c) for c in elem if c.tag.split("}")[-1] == "sub")
        sup = "".join(_omml_to_latex(c) for c in elem if c.tag.split("}")[-1] == "sup")
        scripts = ""
        if sup:
            scripts += f"^{{{sup}}}"
        if sub:
            scripts += f"_{{{sub}}}"
        return f"{scripts}{base}"

    if tag == "bar":
        # overline / underline
        pos = ""
        for c in elem:
            if c.tag.split("}")[-1] == "barPr":
                for p in c:
                    if p.tag.split("}")[-1] == "pos":
                        pos = p.get(f"{{{MATH_NS}}}val", "top")
        base = "".join(_omml_to_latex(c) for c in elem if c.tag.split("}")[-1] == "e")
        if pos == "top":
            return f"\\overline{{{base}}}"
        return base

    if tag == "acc":
        # accent: hat, vector arrow, etc.
        chr_val = ""
        for c in elem:
            if c.tag.split("}")[-1] == "accPr":
                for p in c.iter(f"{{{MATH_NS}}}chr"):
                    chr_val = p.get(f"{{{MATH_NS}}}val", "")
        base = "".join(_omml_to_latex(c) for c in elem if c.tag.split("}")[-1] == "e")
        if "⃗" in chr_val:  # vector arrow
            return f"\\vec{{{base}}}"
        if "̂" in chr_val:  # hat
            return f"\\hat{{{base}}}"
        return base

    if tag == "d":
        # delimiter (parentheses, brackets, etc.)
        base = "".join(_omml_to_latex(c) for c in elem if c.tag.split("}")[-1] == "e")
        return f"\\left({base}\\right)"

    if tag == "rad":
        # radical: square root or nth root
        deg = ""
        base = ""
        for c in elem:
            child_tag = c.tag.split("}")[-1] if "}" in c.tag else c.tag
            if child_tag == "deg":
                deg = "".join(_omml_to_latex(gc) for gc in c)
            elif child_tag == "e":
                base = "".join(_omml_to_latex(gc) for gc in c)
        if deg:
            return f"\\sqrt[{deg}]{{{base}}}"
        return f"\\sqrt{{{base}}}"

    # Properties, etc. — skip
    return ""


def _extract_paragraph_text(p_elem: ET.Element) -> str:
    """Extract full paragraph text with OMML equations and run-level sub/superscript
    formatting converted to LaTeX.

    Walks paragraph children in document order, converting OMML equations to $...$,
    and Word-format sub/superscript runs (vertAlign) to _{...} / ^{...}.
    """
    segments: list[tuple[str, str]] = []  # (kind, text)
    for child in p_elem:
        child_tag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
        if child_tag == "r":
            # Check for subscript/superscript formatting
            rpr = child.find(f"{{{DOCX_NS}}}rPr")
            vert = None
            italic = False
            if rpr is not None:
                va = rpr.find(f"{{{DOCX_NS}}}vertAlign")
                if va is not None:
                    vert = va.get(f"{{{DOCX_NS}}}val")
                italic = rpr.find(f"{{{DOCX_NS}}}i") is not None
            text = "".join(t.text or "" for t in child.iter(f"{{{DOCX_NS}}}t"))
            if not text:
                continue
            if vert == "subscript":
                segments.append(("sub", text))
            elif vert == "superscript":
                segments.append(("sup", text))
            elif italic:
                segments.append(("italic", text))
            else:
                segments.append(("text", text))
        elif child_tag == "oMath":
            latex = _omml_to_latex(child)
            if latex:
                segments.append(("math", f"${latex}$"))

    # Merge adjacent Word runs into formula spans. Physics documents often encode
    # formulas as italic Latin runs mixed with plain digits/operators and
    # run-level sub/superscripts instead of a single OMML object.
    result: list[str] = []
    i = 0
    formula_text_re = re.compile(r"^[A-Za-z0-9+\-*/=().,·×Δ \t]+$")
    item_marker_re = re.compile(r"^[（(]\d+[）)]$")

    def is_formula_trigger(kind: str) -> bool:
        return kind in {"italic", "sub", "sup", "math"}

    def is_formula_text(kind: str, value: str) -> bool:
        stripped = value.strip()
        if kind != "text" or not stripped:
            return False
        if item_marker_re.match(stripped) or "　" in value:
            return False
        return bool(formula_text_re.match(value))

    def has_formula_trigger_ahead(start: int) -> bool:
        for look in range(start, len(segments)):
            kind, value = segments[look]
            if is_formula_trigger(kind):
                return True
            if not is_formula_text(kind, value):
                return False
        return False

    def is_split_item_marker(start: int) -> bool:
        if start + 2 >= len(segments):
            return False
        first, second, third = segments[start:start + 3]
        return (
            first[0] == second[0] == third[0] == "text"
            and first[1] in {"(", "（"}
            and second[1].strip().isdigit()
            and third[1] in {")", "）"}
        )

    def append_scripts(buf: list[str], sub: list[str], sup: list[str]) -> None:
        if sub:
            buf.append(f"_{{{''.join(sub)}}}")
            sub.clear()
        if sup:
            buf.append(f"^{{{''.join(sup)}}}")
            sup.clear()

    def collect_formula(start: int) -> tuple[str, int]:
        buf: list[str] = []
        sub_buf: list[str] = []
        sup_buf: list[str] = []
        j = start
        while j < len(segments):
            kind, value = segments[j]
            if kind == "sub":
                sub_buf.append(value)
            elif kind == "sup":
                sup_buf.append(value)
            elif kind == "math":
                append_scripts(buf, sub_buf, sup_buf)
                buf.append(value[1:-1] if value.startswith("$") and value.endswith("$") else value)
            elif kind == "italic" or is_formula_text(kind, value):
                append_scripts(buf, sub_buf, sup_buf)
                buf.append(value)
            else:
                break
            j += 1

        append_scripts(buf, sub_buf, sup_buf)
        return f"${''.join(buf)}$", j

    while i < len(segments):
        kind, text = segments[i]
        if is_split_item_marker(i):
            result.append(text + segments[i + 1][1] + segments[i + 2][1])
            i += 3
            continue
        if is_formula_trigger(kind) or (is_formula_text(kind, text) and has_formula_trigger_ahead(i + 1)):
            formula, i = collect_formula(i)
            result.append(formula)
            continue
        if kind == "text":
            result.append(text)
        elif kind == "sub":
            result.append(f"$_{{{text}}}$")
        elif kind == "sup":
            result.append(f"$^{{{text}}}$")
        else:
            result.append(text)
        i += 1

    # Second pass: merge adjacent $...$ blocks and math-like text into unified formulas.
    # Key rules:
    # 1. Math-like text can only START a new formula buffer if it is a single-letter
    #    variable name (e.g. "g" in "g$=10 m/s^{2}$").  Multi-char text like "(2)"
    #    may only join an already-started buffer.
    # 2. Lone delimiters (parentheses, brackets) are never merged — they are usually
    #    Chinese punctuation, not formula syntax.
    _MATH_TEXT_RE = re.compile(
        r'^[a-zA-Z0-9+\-*/=()\[\]{}.,:;Δ∑∫√∞≤≥≠±°′″αβγδεθλμπστφω \t²³]+$'
    )
    _MATH_STARTER_RE = re.compile(r'^[a-zA-Z0-9αβγδεθλμπστφωΔ]+$')
    _LONE_DELIM = re.compile(r'^[\(\)\[\]\{\}]+$')

    merged: list[str] = []
    math_buf: list[str] = []  # inner LaTeX without $ delimiters
    math_buf_started = False

    def _is_math_block(s: str) -> bool:
        return s.startswith("$") and s.endswith("$")

    def _flush_math_buf():
        nonlocal math_buf_started
        if math_buf:
            merged.append(f"${''.join(math_buf)}$")
            math_buf.clear()
            math_buf_started = False

    for idx, seg in enumerate(result):
        is_block = _is_math_block(seg)
        is_math_text = bool(_MATH_TEXT_RE.match(seg)) and seg.strip() and "　" not in seg
        is_lone_delim = bool(_LONE_DELIM.match(seg))
        next_to_block = (
            (idx > 0 and _is_math_block(result[idx - 1]))
            or (idx + 1 < len(result) and _is_math_block(result[idx + 1]))
        )

        if is_block:
            math_buf.append(seg[1:-1])
            math_buf_started = True
        elif is_math_text and next_to_block and not is_lone_delim:
            if not math_buf_started and not _MATH_STARTER_RE.match(seg):
                merged.append(seg)
            else:
                math_buf.append(seg)
                math_buf_started = True
        else:
            _flush_math_buf()
            merged.append(seg)

    _flush_math_buf()
    return "".join(merged)


class DocParserError(Exception):
    """Raised when a document cannot be parsed."""
    pass


class DocParser:
    def __init__(self, image_output_dir: Optional[Path] = None):
        self.image_output_dir = image_output_dir or Path("/tmp/docx_imgs")

    def parse(self, doc_path: Path) -> list[QuestionFragment]:
        doc_path = Path(doc_path)
        if not doc_path.exists():
            raise DocParserError(f"File not found: {doc_path}")
        if doc_path.suffix.lower() != ".docx":
            raise DocParserError(f"Not a .docx file: {doc_path}")
        self.image_output_dir.mkdir(parents=True, exist_ok=True)

        try:
            paragraphs = self._extract_paragraphs(doc_path)
        except (zipfile.BadZipFile, KeyError) as e:
            raise DocParserError(f"Cannot read document XML: {e}") from e

        image_map = self._extract_images(doc_path)

        # Build mapping: paragraph_index -> [image_paths]
        para_images = self._map_images_to_paragraphs(doc_path, image_map)

        section = self._detect_section(paragraphs)
        fragments = self._split_into_fragments(
            paragraphs, para_images, doc_path.name, section
        )
        return fragments

    # ── Label inference ──────────────────────────────────────────────
    # Maps knowledge-point IDs to inferred enrichment labels matching
    # the approved-question taxonomy (physics_model, core_literacy, etc.)

    KP_LABEL_MAP: dict[str, dict[str, list[str]]] = {
        "v1c1s1k01": {  # 质点
            "physics_model": ["particle"],
            "core_literacy": ["model_construction"],
        },
        "v1c1s1k02": {  # 参考系
            "physics_model": ["reference_frame"],
            "core_literacy": ["motion_interaction_view"],
        },
        "v1c1s2k01": {  # 时刻与时间间隔
            "physics_model": ["time_interval"],
            "core_literacy": ["scientific_reasoning"],
        },
        "v1c1s2k02": {  # 路程与位移
            "physics_model": ["displacement"],
            "core_literacy": ["scientific_reasoning"],
        },
        "v1c1s1k03": {  # 坐标系
            "physics_model": ["reference_frame"],
            "core_literacy": ["quantitative_analysis"],
        },
        "v1c1s2k03": {  # 矢量与标量
            "physics_model": ["displacement"],
            "core_literacy": ["scientific_reasoning"],
        },
        "v1c1s2k04": {  # x-t图像
            "physics_model": ["displacement"],
            "core_literacy": ["quantitative_analysis"],
            "solution_strategy": ["graphical_analysis"],
        },
    }

    @classmethod
    def _infer_labels(cls, q: dict) -> None:
        """Add enrichment labels (physics_model, core_literacy, etc.) inferred
        from knowledge-point tags, matching the approved-question taxonomy.
        """
        existing = q.setdefault("labels", [])

        def add(label_type: str, label_id: str, role: str = "主要"):
            for lbl in existing:
                if lbl["label_type"] == label_type and lbl["label_id"] == label_id:
                    return  # already present
            existing.append({
                "label_type": label_type,
                "label_id": label_id,
                "role": role,
                "source": "curated",
                "confidence": 1.0,
            })

        # Always-present base labels
        add("math_prerequisite", "algebra", "辅助")
        add("solution_strategy", "concept_analysis")
        add("ability_dimension", "understand")

        # Infer question_structure from stem
        stem = q.get("stem_text", "")
        if any(kw in stem for kw in ["如图", "图甲", "图乙", "图示", "图1", "图2", "图3", "图4"]):
            add("question_structure", "graphical_analysis")
        if any(kw in stem for kw in ["据报道", "阅兵", "奥运会", "全运会", "亚运会", "比赛", "节目"]):
            add("question_structure", "real_world_application")
        elif any(kw in stem for kw in ["关于", "下列", "正确", "不正确"]):
            add("question_structure", "single_concept")

        # KP-driven labels
        kp_ids = {lbl["label_id"] for lbl in existing if lbl["label_type"] == "knowledge_point"}
        for kp_id in kp_ids:
            enrichments = cls.KP_LABEL_MAP.get(kp_id, {})
            for label_type, label_ids in enrichments.items():
                for label_id in label_ids:
                    add(label_type, label_id)

        # Scientific reasoning if multiple KPs or comparing concepts
        if len(kp_ids) > 1:
            add("core_literacy", "scientific_reasoning")
    # Parses exercise-book style documents with explicit metadata tags:
    #   (source) stem…
    #   A．option  B．option  …
    #   【答案】D  【难度】0.85  【知识点】…  【详解】…

    # Knowledge-point name → DB kp_id mapping
    KP_MAP: dict[str, list[str]] = {
        "质点": ["v1c1s1k01"],
        "参考系": ["v1c1s1k02"],
        "同一运动在不同参考系中的描述": ["v1c1s1k02"],
        "已知参考系判断物体运动情况": ["v1c1s1k02"],
        "已知物体运动情况判断参考系": ["v1c1s1k02"],
        "时间": ["v1c1s2k01"],
        "时刻与时间间隔": ["v1c1s2k01"],
        "位移的定义": ["v1c1s2k02"],
        "路程与位移": ["v1c1s2k02"],
        "路程和位移的计算": ["v1c1s2k02"],
        "坐标系": ["v1c1s1k03"],
        "x-t图像": ["v1c1s2k04"],
        "标量与矢量": ["v1c1s2k03"],
    }

    @staticmethod
    def _map_difficulty(value: float) -> tuple[float, str]:
        if value >= 0.90:
            return 1.0, "easy"
        elif value >= 0.80:
            return 1.5, "easy"
        else:
            return 2.0, "moderate_easy"

    def parse_homework(self, doc_path: Path, id_prefix: str = "q_hw") -> list[dict]:
        """Parse a homework-format docx into QuestionImporter-ready dicts.

        Empty paragraphs without images are treated as question boundaries unless
        the document uses explicit numeric question prefixes.
        Empty paragraphs with images remain attached to the current question.
        """
        doc_path = Path(doc_path)
        if not doc_path.exists():
            raise DocParserError(f"File not found: {doc_path}")

        self.image_output_dir.mkdir(parents=True, exist_ok=True)
        paragraphs = self._extract_paragraphs(doc_path)
        image_map = self._extract_images(doc_path)
        para_images = self._map_images_to_paragraphs(doc_path, image_map)

        questions: list[dict] = []
        current: dict | None = None
        in_explanation = False
        in_answer = False
        q_idx = 0

        # Detect source prefix like （25-26高一上·云南丽江·期中）
        numbered_q_start_pat = re.compile(r"^\d{1,3}(?:[．。]|\.\s+)\s*\S+")
        q_start_pat = re.compile(
            r"^(?:"
            r"\d{1,3}(?:[．。]|\.\s+)\s*\S+"  # explicit numeric prefix
            r"|"
            r"(\d+[．.]\s*)?"                # optional number prefix
            r"[（(]\d{2,4}"                   # ( followed by 2-4 digit year/semester
            r")"
        )
        opt_pat = re.compile(r"^([A-D])[．.]\s*(.*)")
        compact_split_pat = re.compile(r"([A-D])[．.]\s*(.*?)(?=[A-D][．.]|$)")
        meta_answer_pat = re.compile(r"^【答案】(.+)")
        meta_diff_pat = re.compile(r"^【难度】([\d.]+)")
        meta_kp_pat = re.compile(r"^【知识点】(.+)")
        meta_explain_pat = re.compile(r"^【详解】(.*)")
        uses_numbered_boundaries = sum(
            1 for para in paragraphs if numbered_q_start_pat.match(para.strip())
        ) >= 5

        def mark_correct_options(q: dict) -> None:
            answer = q.get("answer", "")
            for option in q.get("options", []):
                option["text"] = _clean_option_text(option.get("text", ""))
                option["is_correct"] = option.get("label", "") in answer

        def capture_images(q: dict, pi: int) -> None:
            if pi in para_images:
                existing_refs = {img.get("ref") for img in q.get("images", [])}
                for img_path in para_images[pi]:
                    ref = Path(img_path).name
                    if ref not in existing_refs:
                        q["images"].append({
                            "ref": ref, "image_type": "diagram", "alt": ""
                        })
                        existing_refs.add(ref)

        def append_option(q: dict, label: str, text: str, image_path: str | None = None) -> None:
            option_text = text.strip()
            if image_path:
                ref = Path(image_path).name
                image_index = len(q.get("images", []))
                q["images"].append({
                    "ref": ref,
                    "image_type": "option",
                    "alt": f"选项{label}",
                })
                image_token = f"{{{{IMG:{image_index}}}}}"
                option_text = f"{option_text}\n{image_token}".strip() if option_text else image_token
            q["options"].append({
                "label": label,
                "text": option_text,
                "is_correct": label in q.get("answer", ""),
            })

        def clean_start_stem(line: str) -> str:
            stem = re.sub(r"^\d+[．.]\s*", "", line)
            return re.sub(r"^[（(]\d{2,4}[^）)]*?[）)]\s*", "", stem)

        def flush():
            nonlocal current, in_explanation, in_answer
            if current and current.get("stem_text", "").strip():
                # question_type is determined by AI labeling, not regex heuristics

                current["id"] = f"{id_prefix}{q_idx:03d}"
                current["source"] = "curated"
                current["quality_status"] = "draft"
                current["stem_text"] = _clean_question_text(current.get("stem_text", ""))
                if current.get("answer"):
                    current["answer"] = _clean_question_text(current["answer"])
                if current.get("explanation"):
                    current["explanation"] = _clean_question_text(current["explanation"])
                mark_correct_options(current)
                self._infer_labels(current)  # rule-based baseline, replaced by AI later
                questions.append(current)
            current = None
            in_explanation = False
            in_answer = False

        def start_question(stem: str, pi: int) -> None:
            nonlocal current, in_explanation, in_answer, q_idx
            flush()
            q_idx += 1
            current = {
                "stem_text": stem,
                "options": [],
                "images": [],
                "labels": [],
                "formulas": [],
            }
            in_explanation = False
            in_answer = False
            capture_images(current, pi)

        for pi, p in enumerate(paragraphs):
            line = p.strip()
            has_image = pi in para_images

            # Empty paragraph WITHOUT image → question separator.
            if not line and not has_image:
                if current is not None:
                    if uses_numbered_boundaries or in_explanation or in_answer:
                        continue
                    flush()
                continue

            # Empty paragraph WITH image → inline diagram, stay in current question.
            if not line and has_image:
                if current is not None:
                    capture_images(current, pi)
                continue

            # Question start
            if q_start_pat.match(line):
                start_question(clean_start_stem(line), pi)
                continue

            if current is None:
                start_question(line, pi)
                continue

            # Metadata lines
            m = meta_answer_pat.match(line)
            if m:
                current["answer"] = m.group(1).strip()
                mark_correct_options(current)
                in_answer = True
                in_explanation = False
                continue

            m = meta_diff_pat.match(line)
            if m:
                diff_val = float(m.group(1))
                difficulty, tier = self._map_difficulty(diff_val)
                current["difficulty"] = difficulty
                current["difficulty_tier"] = tier
                in_answer = False
                continue

            m = meta_kp_pat.match(line)
            if m:
                in_answer = False
                kp_ids = set()
                for name in re.split(r"[、,，]", m.group(1)):
                    name = name.strip()
                    if name in self.KP_MAP:
                        kp_ids.update(self.KP_MAP[name])
                for kp_id in sorted(kp_ids):
                    current["labels"].append({
                        "label_type": "knowledge_point",
                        "label_id": kp_id,
                        "role": "主要",
                        "source": "curated",
                        "confidence": 1.0,
                    })
                continue

            m = meta_explain_pat.match(line)
            if m:
                current["explanation"] = m.group(1).strip()
                in_answer = False
                in_explanation = True
                continue

            # Answer continuation, common in multi-part experiment/calculation questions.
            if in_answer:
                current["answer"] = (current.get("answer", "") + "\n" + line).strip()
                mark_correct_options(current)
                continue

            # Explanation continuation
            if in_explanation:
                current["explanation"] = (current.get("explanation", "") + "\n" + line).strip()
                continue

            # Option lines (regular or compact)
            option_line = _unwrap_option_line(line)
            om = opt_pat.match(option_line)
            if om:
                if re.search(r"\(\d+\)", current.get("stem_text", "")):
                    current["stem_text"] = current["stem_text"] + "\n" + option_line
                    continue
                # Try compact split first
                parts = compact_split_pat.findall(option_line)
                option_images = para_images.get(pi, [])
                if len(parts) > 1:
                    for idx, (label, text) in enumerate(parts):
                        append_option(
                            current,
                            label,
                            text,
                            option_images[idx] if idx < len(option_images) else None,
                        )
                else:
                    append_option(
                        current,
                        om.group(1),
                        om.group(2),
                        option_images[0] if option_images else None,
                    )
                continue

            # Continuation of stem text (before options/explanation)
            if not current.get("options") and not in_explanation:
                current["stem_text"] = current["stem_text"] + "\n" + line
                if pi in para_images:
                    current["images"].extend(
                        {"ref": Path(p).name, "image_type": "diagram", "alt": ""}
                        for p in para_images[pi]
                    )

        flush()
        return questions

    def parse_exercises(self, doc_path: Path, id_prefix: str = "q_ex") -> list[dict]:
        """Parse exercise-book format docx into QuestionImporter-ready dicts.

        Format (no bracket metadata — uses space-separated tags):
            (source) stem text…
            A. option  B. option  …
            答案　X
            解析　explanation text…

        Questions are separated by empty paragraphs (no text, no image).
        Empty paragraphs WITH images are inline diagrams within a question.
        """
        doc_path = Path(doc_path)
        if not doc_path.exists():
            raise DocParserError(f"File not found: {doc_path}")

        self.image_output_dir.mkdir(parents=True, exist_ok=True)
        paragraphs = self._extract_paragraphs(doc_path)
        image_map = self._extract_images(doc_path)
        para_images = self._map_images_to_paragraphs(doc_path, image_map)

        questions: list[dict] = []
        current: dict | None = None
        in_explanation = False
        in_answer = False
        explanation_images: list[dict] = []
        q_idx = 0

        source_pat = re.compile(r"^[（(]\d{4}[·.]")
        multi_pat = re.compile(r"^[（(]多选[）)]")
        example_pat = re.compile(r"^例\d+")
        numbered_pat = re.compile(r"^\d+[.．](?!\d)")
        opt_pat = re.compile(r"^([A-D])[.．]\s*(.*)")
        compact_split_pat = re.compile(r"([A-D])[.．]\s*(.*?)(?=[A-D][.．]|$)")
        answer_pat = re.compile(r"^答案\s+(.*)")
        explain_pat = re.compile(r"^解析\s+(.*)")
        plain_image_question_pat = re.compile(
            r"^(如图所示|如图甲所示|如图|下列|将|用|把|一根|一电阻|某)"
        )

        def is_question_start(line: str) -> bool:
            return bool(source_pat.match(line) or multi_pat.match(line)
                       or example_pat.match(line) or numbered_pat.match(line))

        def is_plain_image_question_start(line: str, has_image: bool) -> bool:
            if not has_image:
                return False
            return bool(
                plain_image_question_pat.match(line)
                and ("( )" in line or "（ ）" in line or "求：" in line or "则" in line)
            )

        def mark_correct_options(q: dict) -> None:
            answer = q.get("answer", "")
            for option in q.get("options", []):
                option["text"] = _clean_option_text(option.get("text", ""))
                option["is_correct"] = option.get("label", "") in answer

        def flush():
            nonlocal current, in_explanation, in_answer, explanation_images
            if current and current.get("stem_text", "").strip():
                # question_type is determined by AI labeling, not regex heuristics

                current["id"] = f"{id_prefix}{q_idx:03d}"
                current["source"] = "curated"
                current["quality_status"] = "draft"
                current["stem_text"] = _clean_question_text(current.get("stem_text", ""))
                if current.get("answer"):
                    current["answer"] = _clean_question_text(current["answer"])
                if current.get("explanation"):
                    current["explanation"] = _clean_question_text(current["explanation"])
                current.setdefault("difficulty", 1.5)
                current.setdefault("difficulty_tier", "easy")
                current.setdefault("labels", [])
                mark_correct_options(current)
                convert_mixed_subquestion_options_to_stem(current)
                synthesize_image_options(current)
                if explanation_images:
                    current.setdefault("images", []).extend(explanation_images)
                questions.append(current)
            current = None
            in_explanation = False
            in_answer = False
            explanation_images = []

        def capture_images(q: dict, pi: int) -> None:
            if pi in para_images:
                for img_path in para_images[pi]:
                    ref = Path(img_path).name
                    if ref not in {img.get("ref") for img in q.get("images", [])}:
                        q["images"].append({
                            "ref": ref, "image_type": "diagram", "alt": ""
                        })

        def start_question(stem: str, pi: int) -> None:
            nonlocal current, in_explanation, in_answer, q_idx
            flush()
            q_idx += 1
            current = {
                "stem_text": clean_question_start(stem),
                "options": [],
                "images": [],
                "labels": [],
                "formulas": [],
            }
            in_explanation = False
            in_answer = False
            capture_images(current, pi)

        def clean_question_start(line: str) -> str:
            if multi_pat.match(line):
                return multi_pat.sub("", line).strip()
            if example_pat.match(line):
                return example_pat.sub("", line).strip()
            if numbered_pat.match(line):
                return numbered_pat.sub("", line).strip()
            return line

        def next_nonempty_context(start: int) -> tuple[str, bool]:
            for next_idx in range(start + 1, len(paragraphs)):
                next_line = paragraphs[next_idx].strip()
                next_has_image = next_idx in para_images
                if next_line or next_has_image:
                    return next_line, next_has_image
            return "", False

        def should_keep_empty_paragraph(pi: int) -> bool:
            next_line, next_has_image = next_nonempty_context(pi)
            if (
                current is not None
                and not current.get("answer")
                and next_line
                and not is_question_start(next_line)
                and not answer_pat.match(next_line)
                and not explain_pat.match(next_line)
            ):
                return True
            return bool(
                next_has_image
                or opt_pat.match(_unwrap_option_line(next_line))
                or answer_pat.match(next_line)
                or explain_pat.match(next_line)
            )

        def synthesize_image_options(q: dict) -> None:
            answer = (q.get("answer") or "").strip()
            if q.get("options") or not q.get("images"):
                return
            if not re.fullmatch(r"[A-D]+", answer):
                return
            for label in "ABCD":
                q["options"].append({
                    "label": label,
                    "text": f"见图中{label}选项",
                    "is_correct": label in answer,
                })

        def convert_mixed_subquestion_options_to_stem(q: dict) -> None:
            answer = q.get("answer") or ""
            stem = q.get("stem_text") or ""
            options = q.get("options") or []
            if not options:
                return
            if not (re.search(r"\(1\).*\(2\)", answer) and "(2)" in stem):
                return
            option_lines = "\n".join(
                f"{option.get('label')}. {option.get('text', '').strip()}"
                for option in options
            )
            q["stem_text"] = (stem.rstrip() + "\n" + option_lines).strip()
            q["options"] = []

        for pi, p in enumerate(paragraphs):
            line = p.strip()
            has_image = pi in para_images

            # Empty paragraph WITHOUT image → question separator
            if not line and not has_image:
                if current is not None:
                    if should_keep_empty_paragraph(pi):
                        continue
                    in_explanation = False
                    flush()
                continue

            # Empty paragraph WITH image → inline diagram, stay in current question
            if not line and has_image:
                if current is not None:
                    if in_explanation:
                        for img_path in para_images[pi]:
                            ref = Path(img_path).name
                            explanation_images.append({
                                "ref": ref, "image_type": "explanation", "alt": ""
                            })
                    else:
                        capture_images(current, pi)
                continue

            # ── Content lines ──

            # Answer line
            am = answer_pat.match(line)
            if am:
                if current is not None:
                    current["answer"] = am.group(1).strip()
                    mark_correct_options(current)
                in_explanation = False
                in_answer = True
                continue

            # Explanation line
            em = explain_pat.match(line)
            if em:
                if current is not None:
                    current["explanation"] = em.group(1).strip()
                in_explanation = True
                in_answer = False
                continue

            # Answer continuation such as "(2)..." on the next paragraph.
            if in_answer and current is not None:
                if is_question_start(line):
                    in_answer = False
                    flush()
                    start_question(line, pi)
                    continue
                current["answer"] = (current.get("answer", "") + "\n" + line).strip()
                mark_correct_options(current)
                continue

            # Explanation continuation (multi-paragraph)
            if in_explanation and current is not None:
                # New question starting inside explanation → flush and start new
                if is_question_start(line) or is_plain_image_question_start(line, has_image):
                    in_explanation = False
                    flush()
                    start_question(line, pi)
                    continue
                if has_image:
                    for img_path in para_images[pi]:
                        ref = Path(img_path).name
                        explanation_images.append({
                            "ref": ref, "image_type": "explanation", "alt": ""
                        })
                current["explanation"] = (current.get("explanation", "") + "\n" + line).strip()
                continue

            # Question start: source prefix, 例\d, numbered, or (多选)
            if is_question_start(line):
                start_question(line, pi)
                continue

            # Option lines (within a current question)
            if current is not None:
                option_line = _unwrap_option_line(line)
                om = opt_pat.match(option_line)
                if om:
                    parts = compact_split_pat.findall(option_line)
                    if len(parts) > 1:
                        for label, text in parts:
                            current["options"].append({
                                "label": label, "text": text.strip(),
                                "is_correct": label in current.get("answer", ""),
                            })
                    else:
                        current["options"].append({
                            "label": om.group(1), "text": om.group(2).strip(),
                            "is_correct": om.group(1) in current.get("answer", ""),
                        })
                    continue

                # Stem continuation
                current["stem_text"] = current["stem_text"] + "\n" + line
                capture_images(current, pi)
                continue

            # No current question — start a new one (plain-text start, no source prefix)
            start_question(line, pi)

        flush()
        return questions

    def _extract_paragraphs(self, doc_path: Path) -> list[str]:
        text = []
        with zipfile.ZipFile(doc_path) as z:
            with z.open("word/document.xml") as f:
                tree = ET.parse(f)
            for p in tree.iter(f"{{{DOCX_NS}}}p"):
                line = _extract_paragraph_text(p)
                text.append(line)
        return text

    def _extract_images(self, doc_path: Path) -> dict[str, Path]:
        """Extract images from docx media folder, return {rId: local_path}."""
        image_map = {}
        with zipfile.ZipFile(doc_path) as z:
            try:
                with z.open("word/_rels/document.xml.rels") as f:
                    rels_tree = ET.parse(f)
            except KeyError:
                return image_map
            for rel in rels_tree.iter():
                rel_type = rel.get("Type", "")
                if rel_type == IMAGE_REL_TYPE:
                    rid = rel.get("Id", "")
                    target = rel.get("Target", "")
                    if not rid or not target:
                        continue
                    media_name = target.split("/")[-1]
                    media_path = f"word/media/{media_name}"
                    if media_path in z.namelist():
                        dest = self.image_output_dir / f"{doc_path.stem}_{media_name}"
                        with z.open(media_path) as src:
                            dest.write_bytes(src.read())
                        image_map[rid] = dest
        return image_map

    def _map_images_to_paragraphs(
        self, doc_path: Path, image_map: dict[str, Path]
    ) -> dict[int, list[str]]:
        """Map each paragraph index to the images it contains.

        Parses document.xml looking for <a:blip r:embed="rId..."> in each
        paragraph.  The r:embed value is looked up in image_map (built
        from document.xml.rels) to yield a filesystem path to the image.
        """
        para_images: dict[int, list[str]] = {}
        with zipfile.ZipFile(doc_path) as z:
            with z.open("word/document.xml") as f:
                tree = ET.parse(f)

            para_idx = -1
            for p in tree.iter(f"{{{DOCX_NS}}}p"):
                para_idx += 1
                # Look for blip elements that reference an image relationship
                blips = p.iter(f"{{{DRAWING_NS}}}blip")
                for blip in blips:
                    embed_id = blip.get(f"{{{RELS_NS}}}embed")
                    if embed_id and embed_id in image_map:
                        path = str(image_map[embed_id])
                        para_images.setdefault(para_idx, []).append(path)

        return para_images

    def _detect_section(self, paragraphs: list[str]) -> str:
        for p in paragraphs[:20]:
            p = p.strip()
            m = re.match(r"(\d+)\s+", p)
            if m:
                return p
        return ""

    def _split_into_fragments(
        self,
        paragraphs: list[str],
        para_images: dict[int, list[str]],
        doc_name: str,
        section: str,
    ) -> list[QuestionFragment]:
        fragments = []
        current_lines = []
        current_images = []
        in_answer = False

        # Question start patterns
        example_pat = re.compile(r"^例\d+")
        practice_pat = re.compile(r"^\d+\.")
        tf_pat = re.compile(r"[（(]\s*[×√]\s*[）)]")
        blank_pat = re.compile(r"_{3,}")
        answer_pat = re.compile(r"^答案\s")

        def is_question_start(line: str) -> bool:
            line = line.strip()
            if example_pat.match(line):
                return True
            if practice_pat.match(line):
                return len(line) < 200
            return False

        def is_answer_line(line: str) -> bool:
            return bool(answer_pat.match(line.strip()))

        def flush_fragment():
            nonlocal current_lines, current_images
            if current_lines:
                text = "\n".join(current_lines).strip()
                # Detect type hint
                type_hint = "short_answer"
                if any("A." in l or "B." in l for l in current_lines):
                    type_hint = "conceptual_judgment"
                elif tf_pat.search(text):
                    type_hint = "conceptual_judgment"
                elif blank_pat.search(text):
                    type_hint = "calculation"

                fragments.append(QuestionFragment(
                    source_doc=doc_name,
                    fragment_index=len(fragments),
                    raw_text=text,
                    image_paths=list(current_images),
                    section_hint=section,
                    question_type_hint=type_hint,
                ))
            current_lines = []
            current_images = []

        for i, p in enumerate(paragraphs):
            line = p.strip()
            if not line:
                continue

            if is_answer_line(line):
                current_lines.append(line)
                in_answer = True
                continue

            if in_answer and is_question_start(line):
                flush_fragment()
                in_answer = False

            if is_question_start(line):
                flush_fragment()

            current_lines.append(line)
            if i in para_images:
                current_images.extend(para_images[i])

        flush_fragment()
        return fragments
