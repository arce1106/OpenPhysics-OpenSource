import os
import pytest
from pathlib import Path
from app.services.doc_parser import DocParser, QuestionFragment, _clean_question_text

# Try to find the test document in common locations
_candidates = [
    Path("/home/quantis/.openclaw/workspace/OpenPhysics/第一章　1　质点　参考系.docx"),
    Path(__file__).parent.parent.parent.parent.parent.parent / "OpenPhysics" / "第一章　1　质点　参考系.docx",
]
TEST_DOC = next((p for p in _candidates if p.exists()), Path("第一章　1　质点　参考系.docx"))

_lenz_candidates = [
    Path("/home/quantis/.openclaw/workspace/OpenPhysics/第二章　1　楞次定律.docx"),
    Path("第二章　1　楞次定律.docx"),
]
LENZ_DOC = next((p for p in _lenz_candidates if p.exists()), Path("第二章　1　楞次定律.docx"))

_faraday_candidates = [
    Path("/home/quantis/.openclaw/workspace/OpenPhysics/第二章　2　法拉第电磁感应定律.docx"),
    Path("第二章　2　法拉第电磁感应定律.docx"),
]
FARADAY_DOC = next((p for p in _faraday_candidates if p.exists()), Path("第二章　2　法拉第电磁感应定律.docx"))

SPECIAL_10_DOC = Path("第二章　专题强化10　电磁感应中的电路、电荷量问题.docx")
TRANSFORMER_DOC = Path("变压器.docx")
CH3_TRANSFORMER_DOC = Path("第三章 交变电流/第三章　3　变压器.docx")
NUMBERED_EM_DOC = Path("第二章 电磁感应.docx")


@pytest.fixture
def parser():
    return DocParser()


def test_clean_question_text_spaces_closing_math_before_prose_parenthesis():
    assert (
        _clean_question_text("声速为$v_0$(红外线的传播时间可以忽略)。")
        == "声速为$v_0$ (红外线的传播时间可以忽略)。"
    )
    assert _clean_question_text("能量为$E$（单位为J）") == "能量为$E$ （单位为J）"


def test_clean_question_text_keeps_opening_parenthesized_math():
    assert (
        _clean_question_text(r"答案为$(2-\sqrt{3})\,\mathrm{s}$。")
        == r"答案为$(2-\sqrt{3})\,\mathrm{s}$。"
    )
    assert _clean_question_text("设$(x+y)$为整体") == "设$(x+y)$为整体"


def test_parse_document_returns_fragments(parser):
    if not TEST_DOC.exists():
        pytest.skip("Test document not found")
    fragments = parser.parse(TEST_DOC)
    assert len(fragments) > 0
    assert all(isinstance(f, QuestionFragment) for f in fragments)


def test_fragment_has_required_fields(parser):
    if not TEST_DOC.exists():
        pytest.skip("Test document not found")
    fragments = parser.parse(TEST_DOC)
    for f in fragments:
        assert f.source_doc
        assert f.raw_text
        assert f.fragment_index >= 0
        assert f.section_hint


def test_detects_example_questions(parser):
    if not TEST_DOC.exists():
        pytest.skip("Test document not found")
    fragments = parser.parse(TEST_DOC)
    examples = [f for f in fragments if f.raw_text.strip().startswith("例")]
    assert len(examples) > 0


def test_detects_practice_questions(parser):
    if not TEST_DOC.exists():
        pytest.skip("Test document not found")
    fragments = parser.parse(TEST_DOC)
    practice = [f for f in fragments if not f.raw_text.strip().startswith("例")]
    assert len(practice) > 0


def test_extracts_images(parser):
    if not TEST_DOC.exists():
        pytest.skip("Test document not found")
    fragments = parser.parse(TEST_DOC)
    fragments_with_images = [f for f in fragments if f.image_paths]
    assert len(fragments_with_images) > 0


def test_section_hint_matches_document(parser):
    if not TEST_DOC.exists():
        pytest.skip("Test document not found")
    fragments = parser.parse(TEST_DOC)
    for f in fragments:
        assert "1.1" in f.section_hint or "1" in f.section_hint


def test_parse_exercises_handles_lenz_word_math_options_and_multiline_answers(parser):
    if not LENZ_DOC.exists():
        pytest.skip("Lenz test document not found")

    questions = parser.parse_exercises(LENZ_DOC, id_prefix="preview")

    assert len(questions) == 14
    assert "(2)向右偏" in questions[0]["answer"]
    assert "(2)向右偏" not in questions[0]["stem_text"]

    math_choice = questions[2]
    assert math_choice["answer"] == "BC"
    assert [option["label"] for option in math_choice["options"]] == ["A", "B", "C", "D"]
    assert math_choice["options"][0]["text"].startswith("$0~t_{1}$")

    image_choice = questions[8]
    assert image_choice["answer"] == "A"
    assert [option["label"] for option in image_choice["options"]] == ["A", "B", "C", "D"]

    mixed_experiment = questions[4]
    assert mixed_experiment["answer"].startswith("(1)B")
    assert mixed_experiment["options"] == []
    assert "A. 灯泡A、B均不发光" in mixed_experiment["stem_text"]

    later_math_choice = questions[12]
    assert later_math_choice["answer"] == "B"
    assert [option["label"] for option in later_math_choice["options"]] == ["A", "B", "C", "D"]


def test_parse_homework_uses_numbered_boundaries_not_explanation_blank_lines(parser):
    if not NUMBERED_EM_DOC.exists():
        pytest.skip("Numbered electromagnetic induction document not found")

    questions = parser.parse_homework(NUMBERED_EM_DOC, id_prefix="preview")

    assert len(questions) == 32
    assert questions[13]["answer"] == "AD"
    assert "根据法拉第电磁感应定律可知" in questions[13]["explanation"]
    assert "可知电阻之比" not in questions[14]["stem_text"]


def test_parse_homework_keeps_multiline_answers_out_of_numbered_stems(parser):
    if not NUMBERED_EM_DOC.exists():
        pytest.skip("Numbered electromagnetic induction document not found")

    questions = parser.parse_homework(NUMBERED_EM_DOC, id_prefix="preview")

    mixed_answer = questions[23]
    assert mixed_answer["answer"] == "(1)方向为$a$→$b$\n(2)10V，9V"
    assert "(2)10V，9V" not in mixed_answer["stem_text"]

    experiment = questions[21]
    assert experiment["answer"].startswith("(1)D\n(2)左偏")
    assert experiment["options"] == []
    assert "A．检查各仪器" in experiment["stem_text"]


def test_parse_homework_keeps_image_options_as_choice_options(parser):
    if not NUMBERED_EM_DOC.exists():
        pytest.skip("Numbered electromagnetic induction document not found")

    questions = parser.parse_homework(NUMBERED_EM_DOC, id_prefix="preview")

    graph_choice = questions[16]
    assert graph_choice["answer"] == "BD"
    assert len(graph_choice["images"]) == 5
    assert [image["image_type"] for image in graph_choice["images"]] == [
        "diagram",
        "option",
        "option",
        "option",
        "option",
    ]
    assert [option["label"] for option in graph_choice["options"]] == ["A", "B", "C", "D"]
    assert [option["text"] for option in graph_choice["options"]] == [
        "{{IMG:1}}",
        "{{IMG:2}}",
        "{{IMG:3}}",
        "{{IMG:4}}",
    ]

    capacitor_choice = questions[20]
    assert capacitor_choice["answer"] == "BC"
    assert len(capacitor_choice["images"]) == 5
    assert [option["text"] for option in capacitor_choice["options"]] == [
        "{{IMG:1}}",
        "{{IMG:2}}",
        "{{IMG:3}}",
        "{{IMG:4}}",
    ]


def test_parse_exercises_balances_faraday_compact_formula_options(parser):
    if not FARADAY_DOC.exists():
        pytest.skip("Faraday test document not found")

    questions = parser.parse_exercises(FARADAY_DOC, id_prefix="preview")

    assert len(questions) == 26

    formula_options = questions[6]["options"]
    assert [option["label"] for option in formula_options] == ["A", "B", "C", "D"]
    assert formula_options[0]["text"] == r"$\frac{NBScosθ}{t}$"
    assert formula_options[1]["text"] == r"$\frac{NBSsinθ}{t}$"

    potential_options = questions[22]["options"]
    assert potential_options[0]["text"].startswith(r"$φ_{O}>φ_{a}>φ_{b}>φ_{c}$")
    assert potential_options[1]["text"].startswith(r"$φ_{O}<φ_{a}<φ_{b}<φ_{c}$")

    rotating_bar_options = questions[11]["options"]
    assert rotating_bar_options[1]["text"] == r"$3BωR^{2}$"
    assert rotating_bar_options[2]["text"] == r"$4BωR^{2}$"


def test_parse_exercises_splits_plain_image_question_after_explanation(parser):
    if not SPECIAL_10_DOC.exists():
        pytest.skip("Special topic 10 test document not found")

    questions = parser.parse_exercises(SPECIAL_10_DOC, id_prefix="preview")

    assert len(questions) == 12
    assert questions[9]["answer"] == "D"
    assert "等边三角形闭合回路" in questions[9]["stem_text"]
    assert questions[10]["answer"] == "B"
    assert "平行“”形光滑金属导轨" in questions[10]["stem_text"]
    assert questions[11]["answer"].startswith("(1)")


def test_parse_exercises_keeps_decimal_table_cells_inside_question(parser):
    if not TRANSFORMER_DOC.exists():
        pytest.skip("Transformer table test document not found")

    questions = parser.parse_exercises(TRANSFORMER_DOC, id_prefix="preview")

    assert len(questions) == 1
    question = questions[0]
    assert question["answer"] == "(1)D　(2)乙　(3)3∶1　C　(4)BCD"
    assert "8.2" in question["stem_text"]
    assert "6.1" in question["stem_text"]
    assert "1.9" in question["stem_text"]
    assert question["options"] == []


def test_parse_exercises_keeps_transformer_experiment_tables_inside_question(parser):
    if not CH3_TRANSFORMER_DOC.exists():
        pytest.skip("Chapter 3 transformer test document not found")

    questions = parser.parse_exercises(CH3_TRANSFORMER_DOC, id_prefix="preview")

    assert len(questions) == 13
    assert all(q.get("answer") for q in questions)
    first_experiment = questions[5]
    assert first_experiment["answer"].startswith("(1)D")
    assert "原线圈匝数" in first_experiment["stem_text"]
    assert "通过分析实验数据可得出的实验结论" in first_experiment["stem_text"]

    second_experiment = questions[6]
    assert second_experiment["answer"].startswith("(1)D")
    assert "1 200" in second_experiment["stem_text"]
    assert "(4)实验时" in second_experiment["stem_text"]
    assert "(5)之后" in second_experiment["stem_text"]
