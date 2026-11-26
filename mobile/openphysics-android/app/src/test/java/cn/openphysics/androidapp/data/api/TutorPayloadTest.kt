package cn.openphysics.androidapp.data.api

import cn.openphysics.androidapp.domain.ProcessGrading
import cn.openphysics.androidapp.domain.ProcessStepScore
import cn.openphysics.androidapp.domain.RenderedRichContent
import org.junit.Assert.assertEquals
import org.junit.Test

class TutorPayloadTest {
    @Test
    fun `serializes process grading for question tutor context`() {
        val json = processGradingToTutorJson(
            ProcessGrading(
                feedback = "模型判断有误",
                firstError = "第一步受力分析错误",
                nextAction = "先重画受力图",
                answerImagePaths = listOf("http://example.com/a.jpg"),
                confidenceLevel = "low",
                needsHumanReview = true,
                processScore = 45,
                modelCorrect = false,
                equationCorrect = true,
                calculationCorrect = null,
                unitCorrect = false,
                errorTypeName = "模型识别错误",
                gradingBasis = "依据步骤给分",
                gradingConfidence = 0.62,
                stepScores = listOf(ProcessStepScore("模型", 1.0, 3.0, "受力对象错")),
                firstErrorRendered = RenderedRichContent(html = "<p>第一步受力分析错误</p>"),
                nextActionRendered = RenderedRichContent(html = "<p>先重画受力图</p>"),
            ),
        )

        assertEquals("第一步受力分析错误", json.getString("first_error"))
        assertEquals("模型识别错误", json.getString("error_type_name"))
        assertEquals(false, json.getBoolean("model_correct"))
        assertEquals(true, json.getBoolean("needs_human_review"))
        assertEquals("http://example.com/a.jpg", json.getJSONArray("answer_image_paths").getString(0))
        assertEquals("模型", json.getJSONArray("step_scores").getJSONObject(0).getString("name"))
        assertEquals(
            "<p>第一步受力分析错误</p>",
            json.getJSONObject("first_error_rendered").getString("html"),
        )
        assertEquals(
            "<p>先重画受力图</p>",
            json.getJSONObject("next_action_rendered").getString("html"),
        )
    }
}
