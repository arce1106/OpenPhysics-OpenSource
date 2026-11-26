package cn.openphysics.androidapp.data.api

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class PracticeQuestionParsersTest {
    @Test
    fun `parses solution fields for question workspace self review`() {
        val question = parsePracticeQuestionJson(
            JSONObject()
                .put("id", "q_solution")
                .put("stem_text", "写出速度与时间的关系。")
                .put("question_type", "problem_solving")
                .put("target_knowledge_point_id", "kp_critical")
                .put("correct_answer", "v = v0 + at")
                .put("explanation", "先确定初速度和加速度，再代入匀变速直线运动公式。")
                .put("options", JSONArray())
                .put("images", JSONArray()),
            apiBaseUrl = "https://example.test",
        )

        assertEquals("v = v0 + at", question.correctAnswer)
        assertEquals("先确定初速度和加速度，再代入匀变速直线运动公式。", question.explanation)
        assertEquals("kp_critical", question.targetKnowledgePointId)
    }

    @Test
    fun `parses rendered stem and option content from student API json`() {
        val question = parsePracticeQuestionJson(
            JSONObject()
                .put("id", "q_rendered")
                .put("stem_text", "由 ${'$'}v=at${'$'} 可得")
                .put("stem_rendered", renderedJson("<span class=\"katex\">v=at</span>", hasMath = true))
                .put(
                    "options",
                    JSONArray()
                        .put(
                            JSONObject()
                                .put("label", "A")
                                .put("text", "公式 ${'$'}a=F/m${'$'}")
                                .put("rendered", renderedJson("<span class=\"katex\">a=F/m</span>", hasMath = true)),
                        ),
                )
                .put("images", JSONArray())
                .put("correct_answer", "A")
                .put("correct_answer_rendered", renderedJson("<span class=\"katex\">A</span>"))
                .put("explanation", "解析")
                .put("explanation_rendered", renderedJson("<p>解析</p>")),
            apiBaseUrl = "https://example.test",
        )

        assertEquals("<span class=\"katex\">v=at</span>", question.stemRendered?.html)
        assertEquals(true, question.stemRendered?.hasMath)
        assertEquals("hash-1", question.stemRendered?.contentHash)
        assertEquals("0.16.45", question.stemRendered?.rendererVersion)
        assertEquals("<span class=\"katex\">a=F/m</span>", question.options.first().rendered?.html)
        assertEquals("<span class=\"katex\">A</span>", question.correctAnswerRendered?.html)
        assertEquals("<p>解析</p>", question.explanationRendered?.html)
    }

    @Test
    fun `parses rendered errors and keeps legacy json compatible when rendered is missing`() {
        val legacy = parsePracticeQuestionJson(
            JSONObject()
                .put("id", "q_legacy")
                .put("stem_text", "旧题干")
                .put("options", JSONArray().put(JSONObject().put("label", "A").put("text", "普通选项")))
                .put("images", JSONArray()),
            apiBaseUrl = "https://example.test",
        )
        val withError = parsePracticeQuestionJson(
            JSONObject()
                .put("id", "q_error")
                .put("stem_text", "错误公式")
                .put(
                    "stem_rendered",
                    renderedJson("错误公式", hasMath = true)
                        .put(
                            "errors",
                            JSONArray().put(
                                JSONObject()
                                    .put("type", "katex")
                                    .put("message", "Undefined control sequence")
                                    .put("latex", "\\notARealCommand")
                                    .put("position", 3),
                            ),
                        ),
                )
                .put("options", JSONArray())
                .put("images", JSONArray()),
            apiBaseUrl = "https://example.test",
        )

        assertEquals(null, legacy.stemRendered)
        assertEquals(null, legacy.options.first().rendered)
        assertEquals("katex", withError.stemRendered?.errors?.first()?.type)
        assertEquals("\\notARealCommand", withError.stemRendered?.errors?.first()?.latex)
        assertEquals(3, withError.stemRendered?.errors?.first()?.position)
    }

    private fun renderedJson(html: String, hasMath: Boolean = false): JSONObject {
        return JSONObject()
            .put("html", html)
            .put("plain_text", "plain")
            .put("renderer", "katex")
            .put("renderer_version", "0.16.45")
            .put("content_hash", "hash-1")
            .put("has_math", hasMath)
            .put("has_image", false)
            .put("has_markdown_table", false)
            .put("errors", JSONArray())
    }
}
