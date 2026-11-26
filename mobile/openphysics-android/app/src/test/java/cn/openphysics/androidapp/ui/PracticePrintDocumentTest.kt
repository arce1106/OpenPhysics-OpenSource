package cn.openphysics.androidapp.ui

import cn.openphysics.androidapp.domain.PracticeOption
import cn.openphysics.androidapp.domain.PracticeQuestion
import cn.openphysics.androidapp.domain.QuestionImage
import cn.openphysics.androidapp.domain.RenderedRichContent
import cn.openphysics.androidapp.domain.RenderedRichContentError
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PracticePrintDocumentTest {
    @Test
    fun `builds web aligned printable practice sheet`() {
        val html = buildPracticePrintHtml(
            title = "掌握评估",
            subtitle = "运动学 · 用 3 道题检查是否真正会用",
            questions = listOf(
                PracticeQuestion(
                    id = "q_1",
                    stem = "关于速度，下列说法正确的是？",
                    questionType = "single_choice",
                    options = listOf(
                        PracticeOption("A", "速度只有大小"),
                        PracticeOption("B", "速度有方向"),
                    ),
                    images = emptyList(),
                ),
                PracticeQuestion(
                    id = "q_2",
                    stem = "计算合力大小",
                    questionType = "problem_solving",
                    options = emptyList(),
                    images = emptyList(),
                ),
            ),
        )

        assertTrue(html.contains("掌握评估"))
        assertTrue(html.contains("运动学 · 用 3 道题检查是否真正会用"))
        assertTrue(html.contains("姓名：__________"))
        assertTrue(html.contains("日期：__________"))
        assertTrue(html.contains("第 1 题"))
        assertTrue(html.contains("Q:q_1"))
        assertTrue(html.contains("关于速度"))
        assertTrue(html.contains("print-option-label-single"))
        assertTrue(html.contains(">A</span>"))
        assertTrue(html.contains("第 2 题"))
        assertTrue(html.contains("作答区"))
        assertTrue(html.contains("print-answer-box-large"))
        assertFalse(
            html.substringAfter("Q:q_1").substringBefore("Q:q_2").contains("print-answer-box"),
        )
        assertFalse(html.contains("<script"))
    }

    @Test
    fun `uses compact long question layout without breaking the paper crop boundary`() {
        val html = buildPracticePrintHtml(
            title = "巩固小练",
            questions = listOf(
                question(id = "q_short", type = "fill_in_blank", stem = "速度是____。"),
                question(id = "q_long", type = "problem_solving", stem = "很长的计算题".repeat(80)),
            ),
        )

        assertTrue(html.contains("print-answer-box-short"))
        assertTrue(html.contains("print-answer-box-large"))
        assertTrue(html.contains("print-question-dense"))
        assertTrue(html.contains(".print-question { break-inside: avoid-page; page-break-inside: avoid;"))
        assertTrue(html.contains(".print-question-title { break-after: avoid-page;"))
        assertTrue(html.contains(".print-option, .print-question-images, .print-answer-box { break-inside: avoid;"))
        assertTrue(html.contains("border-bottom: 2px solid #111827"))
        assertFalse(html.contains(".print-question { break-inside: auto;"))
    }

    @Test
    fun `uses safe pre rendered formulas tables and inline images`() {
        val html = buildPracticePrintHtml(
            title = "掌握评估",
            questions = listOf(
                PracticeQuestion(
                    id = "q_rich",
                    stem = "由 ${'$'}v=at${'$'} 可得 {{IMG:0}}",
                    questionType = "single_choice",
                    options = listOf(
                        PracticeOption(
                            label = "A",
                            text = "${'$'}a=F/m${'$'}",
                            textRendered = RenderedRichContent(html = "<span class=\"katex\">a=F/m</span>"),
                        ),
                    ),
                    images = listOf(
                        QuestionImage(1, "/a.png", "https://example.test/a.png", "stem", "题图"),
                    ),
                    stemRendered = RenderedRichContent(
                        html = "<table class=\"openphysics-rich-table\"><tr><td><span class=\"katex\">v=at</span></td></tr></table><img class=\"openphysics-rich-image\" src=\"https://example.test/a.png\">",
                        hasMath = true,
                        hasImage = true,
                        hasMarkdownTable = true,
                    ),
                ),
            ),
        )

        assertTrue(html.contains("katex/katex.min.css"))
        assertTrue(html.contains("openphysics-rich-table"))
        assertTrue(html.contains("<span class=\"katex\">a=F/m</span>"))
        assertFalse(html.contains("{{IMG:0}}"))
    }

    @Test
    fun `falls back to escaped text when rendered content reports errors`() {
        val html = buildPracticePrintHtml(
            title = "掌握评估",
            questions = listOf(
                question(
                    id = "q_bad",
                    type = "problem_solving",
                    stem = "<script>alert('x')</script> 原始题干",
                    rendered = RenderedRichContent(
                        html = "<script>alert('rendered')</script>",
                        errors = listOf(RenderedRichContentError(type = "katex", message = "bad")),
                    ),
                ),
            ),
        )

        assertFalse(html.contains("<script"))
        assertTrue(html.contains("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; 原始题干"))
    }

    @Test
    fun `raw image placeholders use an android compatible regex and render inline images`() {
        val html = buildPracticePrintHtml(
            title = "掌握评估",
            questions = listOf(
                PracticeQuestion(
                    id = "q_inline_image",
                    stem = "先观察题图 {{IMG:0}} 再作答",
                    questionType = "problem_solving",
                    options = emptyList(),
                    images = listOf(
                        QuestionImage(
                            id = 1,
                            imagePath = "/inline.png",
                            imageUrl = "https://example.test/inline.png",
                            imageType = "stem",
                            description = "题目附图",
                        ),
                    ),
                ),
            ),
        )

        assertFalse(html.contains("{{IMG:0}}"))
        assertTrue(html.contains("class=\"print-inline-image\""))
        assertTrue(html.contains("https://example.test/inline.png"))
    }

    @Test
    fun `rewrites rendered option image paths to absolute urls for android print`() {
        val html = buildPracticePrintHtml(
            title = "掌握评估",
            questions = listOf(
                PracticeQuestion(
                    id = "q_1411",
                    stem = "关于物体重力的图示，下列描绘正确的是？",
                    questionType = "single_choice",
                    options = listOf(
                        PracticeOption(
                            label = "A",
                            text = "{{IMG:0}}",
                            textRendered = RenderedRichContent(
                                html = """
                                    <img class="openphysics-rich-image"
                                         data-openphysics-image-index="0"
                                         src="/static/questions/q_1411_option_A.png"
                                         alt="题目附图">
                                """.trimIndent(),
                                hasImage = true,
                            ),
                        ),
                    ),
                    images = listOf(
                        QuestionImage(
                            id = 1,
                            imagePath = "/static/questions/q_1411_option_A.png",
                            imageUrl = "https://openphysics.example/static/questions/q_1411_option_A.png",
                            imageType = "option",
                            description = "选项 A",
                        ),
                    ),
                ),
            ),
        )

        assertTrue(
            html.contains(
                "src=\"https://openphysics.example/static/questions/q_1411_option_A.png\"",
            ),
        )
        assertFalse(html.contains("src=\"/static/questions/q_1411_option_A.png\""))
        assertTrue(html.contains("data-openphysics-image-index=\"0\""))
        assertTrue(html.contains(".print-option-content .openphysics-rich-image"))
    }

    private fun question(
        id: String,
        type: String,
        stem: String,
        rendered: RenderedRichContent? = null,
    ) = PracticeQuestion(
        id = id,
        stem = stem,
        questionType = type,
        options = emptyList(),
        images = emptyList(),
        stemRendered = rendered,
    )
}
