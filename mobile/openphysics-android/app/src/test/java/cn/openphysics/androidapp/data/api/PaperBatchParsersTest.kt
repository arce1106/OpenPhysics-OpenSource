package cn.openphysics.androidapp.data.api

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class PaperBatchParsersTest {
    @Test
    fun `parses paper batch results errors and solutions`() {
        val response = PaperBatchParsers.parse(
            JSONObject()
                .put(
                    "results",
                    JSONObject()
                        .put(
                            "q_1",
                            JSONObject()
                                .put("answer_id", 11)
                                .put("is_correct", false)
                                .put("correct_answer", "A")
                                .put("explanation", "先列受力关系")
                                .put("ai_feedback", "模型第一步有误")
                                .put("extracted_answer", "B"),
                        ),
                )
                .put("errors", JSONObject().put("q_2", "未识别到第 2 题"))
                .put(
                    "solutions",
                    JSONObject()
                        .put("q_2", JSONObject().put("correct_answer", "C").put("explanation", "代入公式")),
                ),
            apiBaseUrl = "https://openphysics.example/api/student",
        )

        assertEquals(11, response.results["q_1"]?.answerId)
        assertFalse(response.results["q_1"]?.correct ?: true)
        assertEquals("未识别到第 2 题", response.errors["q_2"])
        assertEquals("C", response.solutions["q_2"]?.correctAnswer)
        assertEquals("代入公式", response.solutions["q_2"]?.explanation)
    }

    @Test
    fun `parses rendered submit result fields and keeps legacy json compatible`() {
        val rendered = PaperBatchParsers.parseSubmitResult(
            JSONObject()
                .put("answer_id", 12)
                .put("is_correct", true)
                .put("correct_answer", "v=at")
                .put("correct_answer_rendered", renderedJson("<span class=\"katex\">v=at</span>", hasMath = true))
                .put("explanation", "解析")
                .put("explanation_rendered", renderedJson("<p>解析</p>"))
                .put("ai_feedback", "提示")
                .put("ai_feedback_rendered", renderedJson("<p>提示</p>"))
                .put("extracted_answer", "学生答案")
                .put("extracted_answer_rendered", renderedJson("<p>学生答案</p>")),
            apiBaseUrl = "https://openphysics.example/api/student",
        )
        val legacy = PaperBatchParsers.parseSubmitResult(
            JSONObject()
                .put("is_correct", false)
                .put("correct_answer", "A")
                .put("explanation", "旧解析"),
            apiBaseUrl = "https://openphysics.example/api/student",
        )

        assertEquals("<span class=\"katex\">v=at</span>", rendered.correctAnswerRendered?.html)
        assertEquals(true, rendered.correctAnswerRendered?.hasMath)
        assertEquals("<p>解析</p>", rendered.explanationRendered?.html)
        assertEquals("<p>提示</p>", rendered.aiFeedbackRendered?.html)
        assertEquals("<p>学生答案</p>", rendered.extractedAnswerRendered?.html)
        assertEquals(null, legacy.correctAnswerRendered)
        assertEquals(null, legacy.explanationRendered)
    }

    private fun renderedJson(html: String, hasMath: Boolean = false): JSONObject {
        return JSONObject()
            .put("html", html)
            .put("plain_text", "plain")
            .put("renderer", "katex")
            .put("renderer_version", "0.16.45")
            .put("content_hash", "hash")
            .put("has_math", hasMath)
            .put("has_image", false)
            .put("has_markdown_table", false)
            .put("errors", JSONArray())
    }
}
