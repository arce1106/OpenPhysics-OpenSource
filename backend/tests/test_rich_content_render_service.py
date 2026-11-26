from app.services.rich_content_render_service import RichContentRenderService


def _question_payload(stem_text: str) -> dict:
    return {
        "id": "q1",
        "stem_text": stem_text,
        "options": [
            {"label": "A", "text": "普通选项"},
            {"label": "B", "text": r"$E_k=\frac{1}{2}mv^2$"},
        ],
        "images": [
            {
                "id": "img1",
                "image_path": "http://example.test/a.png",
                "image_type": "stem",
            }
        ],
        "correct_answer": r"$v=at$",
        "explanation": "由速度公式可得。",
    }


def test_enriches_plain_question_stem_with_rendered_content():
    service = RichContentRenderService(enabled=True)
    question = _question_payload("这是一道普通题")

    service.enrich_question(question)

    assert question["stem_rendered"]["has_math"] is False
    assert question["stem_rendered"]["plain_text"] == "这是一道普通题"
    assert question["stem_rendered"]["renderer"] == "katex"


def test_enriches_formula_stem_with_katex_html():
    service = RichContentRenderService(enabled=True)
    question = _question_payload(r"由 $v=at$ 可得")

    service.enrich_question(question)

    assert question["stem_rendered"]["has_math"] is True
    assert question["stem_rendered"]["renderer"] == "katex"
    assert "katex" in question["stem_rendered"]["html"]


def test_enriches_formula_options_without_removing_original_text():
    service = RichContentRenderService(enabled=True)
    question = _question_payload("选择正确表达式")

    service.enrich_question(question)

    assert question["options"][1]["text"] == r"$E_k=\frac{1}{2}mv^2$"
    assert question["options"][1]["rendered"]["has_math"] is True
    assert "katex" in question["options"][1]["rendered"]["html"]
    assert question["options"][1]["text_rendered"] == question["options"][1]["rendered"]


def test_enriches_image_placeholder_with_question_images():
    service = RichContentRenderService(enabled=True)
    question = _question_payload("如图所示 {{IMG:0}}")

    service.enrich_question(question)

    assert question["stem_rendered"]["has_image"] is True
    assert "http://example.test/a.png" in question["stem_rendered"]["html"]


def test_enriches_markdown_table_and_cell_formulas():
    service = RichContentRenderService(enabled=True)
    question = _question_payload(
        "\n".join(
            [
                "| 序号 | 1 | 2 |",
                "| --- | --- | --- |",
                r"| 速度 | $v_1$ | $v_2$ |",
            ]
        )
    )

    service.enrich_question(question)

    assert question["stem_rendered"]["has_markdown_table"] is True
    assert "<table" in question["stem_rendered"]["html"]
    assert "katex" in question["stem_rendered"]["html"]


def test_rendering_errors_are_recorded_without_crashing_api_payload():
    service = RichContentRenderService(enabled=True)
    question = _question_payload(r"错误公式 $\notARealCommand{1}$")

    service.enrich_question(question)

    assert question["stem_rendered"]["errors"]
    assert question["stem_rendered"]["errors"][0]["type"] == "katex"
    assert question["stem_text"] == r"错误公式 $\notARealCommand{1}$"


def test_disabled_service_preserves_legacy_question_payload():
    service = RichContentRenderService(enabled=False)
    question = _question_payload(r"由 $v=at$ 可得")

    service.enrich_question(question)

    assert "stem_rendered" not in question
    assert "rendered" not in question["options"][0]
    assert question["stem_text"] == r"由 $v=at$ 可得"


def test_enrich_questions_batches_multiple_questions_into_one_renderer_call():
    class RecordingRenderService(RichContentRenderService):
        def __init__(self):
            super().__init__(enabled=True)
            self.calls: list[list[str]] = []

        def _invoke_cli(self, items, *, strict):
            self.calls.append([item["id"] for item in items])
            return {
                item["id"]: {
                    "html": f"<p>{item['id']}</p>",
                    "plainText": item["text"],
                    "plain_text": item["text"],
                    "renderer": "katex",
                    "rendererVersion": "test",
                    "renderer_version": "test",
                    "contentHash": item["id"],
                    "content_hash": item["id"],
                    "hasMath": "$" in item["text"],
                    "has_math": "$" in item["text"],
                    "hasImage": "{{IMG:" in item["text"],
                    "has_image": "{{IMG:" in item["text"],
                    "hasMarkdownTable": False,
                    "has_markdown_table": False,
                    "errors": [],
                }
                for item in items
            }

    service = RecordingRenderService()
    questions = [
        _question_payload(r"第一题 $v=at$"),
        {**_question_payload("第二题"), "id": "q2"},
    ]

    service.enrich_questions(questions)

    assert len(service.calls) == 1
    assert "q0:stem" in service.calls[0]
    assert "q1:stem" in service.calls[0]
    assert questions[0]["stem_rendered"]["plain_text"] == r"第一题 $v=at$"
    assert questions[1]["stem_rendered"]["plain_text"] == "第二题"
    assert questions[0]["options"][1]["rendered"]["has_math"] is True


def test_review_summary_renders_only_printable_stem_and_options():
    service = RichContentRenderService(enabled=True)
    mistake = _question_payload(r"复盘题干 $v=at$")
    groups = [{"mistakes": [mistake]}]

    service.enrich_review_group_summaries(groups)

    assert mistake["stem_rendered"]["has_math"] is True
    assert mistake["options"][1]["rendered"]["has_math"] is True
    assert "correct_answer_rendered" not in mistake
    assert "explanation_rendered" not in mistake


def test_renderer_reuses_one_persistent_process_across_cache_misses():
    service = RichContentRenderService(enabled=True)
    try:
        first = service.render_text("第一段内容")
        first_pid = service._process.pid
        second = service.render_text("第二段不同内容")

        assert first["plain_text"] == "第一段内容"
        assert second["plain_text"] == "第二段不同内容"
        assert service._process.pid == first_pid
    finally:
        service.close()
