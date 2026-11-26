package cn.openphysics.androidapp.data.api

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StudentRecordParsersTest {
    @Test
    fun `raw rubric points and percentage survive parsing and pane forwarding`() {
        val parsed = StudentRecordParsers.parseProcessGrading(
            JSONObject().put("score", 7.5).put("max_score", 12).put("process_score", 62), "https://example.test",
        )!!
        assertEquals(7.5, parsed.score!!, 0.0)
        assertEquals(12.0, parsed.maxScore!!, 0.0)
        assertEquals(62, parsed.processScore)
        val forwarded = processGradingToTutorJson(parsed)
        assertEquals(7.5, forwarded.getDouble("score"), 0.0)
        assertEquals(12.0, forwarded.getDouble("max_score"), 0.0)
    }

    @Test
    fun `signed answer image query survives both history image and grading parsing`() {
        val path = "/api/student/answer-images/student-1/answer.jpg?expires=2000000000&signature=a%2Bb"
        val record = JSONObject().put("id", 1).put("question_id", "q-written")
            .put("given_answer", "(1)0.26；0.34")
            .put("process_grading", JSONObject().put("answer_image_path", path))
        val parsed = StudentRecordParsers.parseHistory(JSONArray().put(record), "https://openphysics.example/api/student").single()

        assertEquals("(1)0.26；0.34", parsed.givenAnswer)
        assertEquals("https://openphysics.example$path", parsed.answerImages.single().imageUrl)
        assertEquals("https://openphysics.example$path", parsed.processGrading!!.answerImagePaths.single())
    }

    @Test
    fun `current student parser refreshes account while preserving token`() {
        val session = parseStudentSession(
            JSONObject()
                .put("id", "student-1")
                .put("username", "learner")
                .put("display_name", "学习者")
                .put("status", "active"),
            token = "cached-token",
        )

        assertEquals("cached-token", session.token)
        assertEquals("active", session.accountStatus)
        assertTrue(cn.openphysics.androidapp.domain.StudentAccessPolicy.hasFullLearningAccess(session))
    }
    @Test
    fun `parses answer history with kp names options and images`() {
        val json = JSONArray().put(
            JSONObject()
                .put("id", 7)
                .put("question_id", "q_0007")
                .put("stem_text", "关于质点下列说法正确的是")
                .put("stem_rendered", renderedJson("<p>关于质点</p>"))
                .put("question_type", "single_choice")
                .put("given_answer", "A")
                .put("is_correct", false)
                .put("correct_answer", "C")
                .put("correct_answer_rendered", renderedJson("<p>C</p>"))
                .put("explanation", "解析")
                .put("explanation_rendered", renderedJson("<p>解析</p>"))
                .put("created_at", "2026-05-20T00:00:00+08:00")
                .put(
                    "process_grading",
                    JSONObject()
                        .put("answer_image_path", "/static/uploads/answers/stu/page-1.jpg")
                        .put("feedback", "证据不足")
                        .put("feedback_rendered", renderedJson("<p>证据不足</p>"))
                        .put("first_error", "第一步错误")
                        .put("first_error_rendered", renderedJson("<p>第一步错误</p>"))
                        .put("next_action", "重画受力图")
                        .put("next_action_rendered", renderedJson("<p>重画受力图</p>"))
                        .put("needs_human_review", true)
                        .put(
                            "answer_image_paths",
                            JSONArray()
                                .put("/static/uploads/answers/stu/page-1.jpg")
                                .put("/static/uploads/answers/stu/page-2.jpg"),
                        ),
                )
                .put("knowledge_points", JSONArray().put(JSONObject().put("id", "v1c1s1k01").put("name", "质点")))
                .put("options", JSONArray().put(JSONObject().put("label", "A").put("text", "只有小物体才能看作质点")))
                .put("images", JSONArray().put(JSONObject().put("id", 1).put("image_path", "/static/questions/test.png"))),
        )

        val records = StudentRecordParsers.parseHistory(json, apiBaseUrl = "http://example.com/api/student")

        assertEquals(1, records.size)
        assertEquals("质点", records.first().kpNames.single())
        assertFalse(records.first().isCorrect)
        assertEquals("<p>关于质点</p>", records.first().stemRendered?.html)
        assertEquals("<p>C</p>", records.first().correctAnswerRendered?.html)
        assertEquals("<p>解析</p>", records.first().explanationRendered?.html)
        assertTrue(records.first().processGrading?.needsHumanReview == true)
        assertEquals("<p>证据不足</p>", records.first().processGrading?.feedbackRendered?.html)
        assertEquals("<p>第一步错误</p>", records.first().processGrading?.firstErrorRendered?.html)
        assertEquals("<p>重画受力图</p>", records.first().processGrading?.nextActionRendered?.html)
        assertEquals("A", records.first().options.single().label)
        assertEquals("http://example.com/static/questions/test.png", records.first().images.single().imageUrl)
        assertEquals(2, records.first().answerImages.size)
        assertEquals("http://example.com/static/uploads/answers/stu/page-1.jpg", records.first().answerImages.first().imageUrl)
    }

    @Test
    fun `parses review groups and total pending count`() {
        val json = JSONObject()
            .put("clearance_progress", JSONObject().put("reviewed", 2).put("total", 5))
            .put(
                "review_center",
                JSONObject()
                    .put("total_pending", 3)
                    .put("primary_focus", JSONObject()
                        .put("error_type", "model_error")
                        .put("error_name", "模型识别错误")
                        .put("count", 2)
                        .put("first_error", "第一步没有判断研究对象")
                        .put("next_action", "先画受力图")
                        .put("kp_names", JSONArray().put("参考系")),
                    )
                    .put(
                        "stage_counts",
                        JSONObject().put("待复盘", 3).put("已复盘", 2),
                    )
                    .put(
                        "review_steps",
                        JSONArray().put(JSONObject().put("title", "先看第一处错误").put("description", "找到最早出错的环节")),
                    )
                    .put(
                        "error_groups",
                        JSONArray().put(JSONObject()
                            .put("error_type", "model_error")
                            .put("error_name", "模型识别错误")
                            .put("count", 2)
                            .put("sample_answer_id", 9)
                            .put("kp_names", JSONArray().put("参考系")),
                        ),
                    ),
            )
            .put(
                "groups",
                JSONArray().put(
                    JSONObject()
                        .put("kp_id", "v1c1s1k02")
                        .put("kp_name", "参考系")
                        .put("wrong_count", 3)
                        .put(
                            "mistakes",
                            JSONArray().put(
                                JSONObject()
                                    .put("answer_id", 9)
                                    .put("question_id", "q_0009")
                                    .put("stem_text", "关于参考系下列说法正确的是")
                                    .put("stem_rendered", renderedJson("<p>关于参考系</p>"))
                                    .put("given_answer", "B")
                                    .put("correct_answer", "D")
                                    .put("correct_answer_rendered", renderedJson("<p>D</p>"))
                                    .put("explanation", "参考系解析")
                                    .put("explanation_rendered", renderedJson("<p>参考系解析</p>"))
                                    .put(
                                        "process_grading",
                                        JSONObject()
                                            .put("answer_image_path", "/static/uploads/answers/stu/wrong.jpg")
                                            .put("process_score", 55)
                                            .put("model_correct", false)
                                            .put("equation_correct", true)
                                            .put("calculation_correct", JSONObject.NULL)
                                            .put("unit_correct", false)
                                            .put("confidence_level", "medium")
                                            .put("needs_human_review", true)
                                            .put("grading_basis", "依据学生步骤和最终答案判断")
                                            .put(
                                                "step_scores",
                                                JSONArray().put(JSONObject()
                                                    .put("name", "模型")
                                                    .put("score", 1)
                                                    .put("max_score", 3)
                                                    .put("comment", "没有先判断参考系"),
                                                ),
                                            ),
                                    )
                                    .put("misconception", JSONObject().put("name", "参考系选择不当")),
                            ),
                        ),
                ),
            )

        val review = StudentRecordParsers.parseReview(json, apiBaseUrl = "http://example.com/api/student")

        assertEquals(3, review.pendingCount)
        assertEquals(2, review.reviewedCount)
        assertEquals("模型识别错误", review.reviewCenter?.primaryFocus?.errorName)
        assertEquals("找到最早出错的环节", review.reviewCenter?.reviewSteps?.single()?.description)
        assertEquals(2, review.reviewCenter?.stageCounts?.get("已复盘"))
        assertEquals("v1c1s1k02", review.groups.single().kpId)
        assertEquals("参考系", review.groups.single().kpName)
        assertEquals("参考系选择不当", review.groups.single().mistakes.single().misconceptionName)
        assertTrue(review.groups.single().mistakes.single().isDetailLoaded)
        assertEquals("<p>关于参考系</p>", review.groups.single().mistakes.single().stemRendered?.html)
        assertEquals("<p>D</p>", review.groups.single().mistakes.single().correctAnswerRendered?.html)
        assertEquals("<p>参考系解析</p>", review.groups.single().mistakes.single().explanationRendered?.html)
        assertTrue(review.groups.single().mistakes.single().needsReview)
        assertEquals(55, review.groups.single().mistakes.single().processGrading?.processScore)
        assertEquals(false, review.groups.single().mistakes.single().processGrading?.modelCorrect)
        assertEquals(true, review.groups.single().mistakes.single().processGrading?.equationCorrect)
        assertEquals(null, review.groups.single().mistakes.single().processGrading?.calculationCorrect)
        assertTrue(review.groups.single().mistakes.single().processGrading?.needsHumanReview == true)
        assertEquals("模型", review.groups.single().mistakes.single().processGrading?.stepScores?.single()?.name)
        assertEquals("http://example.com/static/uploads/answers/stu/wrong.jpg", review.groups.single().mistakes.single().answerImages.single().imageUrl)
    }

    @Test
    fun `marks compact review mistakes as summaries until detail is fetched`() {
        val mistake = JSONObject()
            .put("answer_id", 12)
            .put("question_id", "q-12")
            .put("stem_text", "摘要题干")
            .put("question_type", "calculation")
        val json = JSONObject()
            .put("clearance_progress", JSONObject().put("reviewed", 0).put("total", 1))
            .put(
                "groups",
                JSONArray().put(
                    JSONObject()
                        .put("kp_id", "kp")
                        .put("kp_name", "运动")
                        .put("wrong_count", 1)
                        .put("mistakes", JSONArray().put(mistake)),
                ),
            )

        val review = StudentRecordParsers.parseReview(
            json,
            apiBaseUrl = "http://example.com/api/student",
            mistakesAreDetailed = false,
        )
        val detail = StudentRecordParsers.parseReviewMistake(
            mistake.put("explanation", "完整解析"),
            apiBaseUrl = "http://example.com/api/student",
        )

        assertFalse(review.groups.single().mistakes.single().isDetailLoaded)
        assertTrue(detail.isDetailLoaded)
        assertEquals("完整解析", detail.explanation)
    }

    @Test
    fun `parses fallback process evidence images for review mistakes`() {
        val json = JSONObject()
            .put("clearance_progress", JSONObject().put("reviewed", 0).put("total", 1))
            .put(
                "groups",
                JSONArray().put(
                    JSONObject()
                        .put("kp_id", "kp")
                        .put("kp_name", "实验")
                        .put("wrong_count", 1)
                        .put(
                            "mistakes",
                            JSONArray().put(
                                JSONObject()
                                    .put("answer_id", 10)
                                    .put("question_id", "q_10")
                                    .put("stem_text", "实验题")
                                    .put("given_answer", "[整套纸笔照片]")
                                    .put("correct_answer", "答案")
                                    .put(
                                        "process_grading",
                                        JSONObject()
                                            .put(
                                                "answer_page_image_paths",
                                                JSONArray()
                                                    .put("/static/uploads/answers/page-1.jpg")
                                                    .put("/static/uploads/answers/page-2.jpg"),
                                            )
                                            .put("process_evidence_image_path", "/static/uploads/answers/evidence.jpg"),
                                    ),
                            ),
                        ),
                ),
            )

        val review = StudentRecordParsers.parseReview(json, apiBaseUrl = "http://example.com/api/student")

        assertEquals(3, review.groups.single().mistakes.single().answerImages.size)
        assertEquals(
            "http://example.com/static/uploads/answers/page-1.jpg",
            review.groups.single().mistakes.single().answerImages.first().imageUrl,
        )
        assertEquals(
            "http://example.com/static/uploads/answers/evidence.jpg",
            review.groups.single().mistakes.single().answerImages.last().imageUrl,
        )
    }

    private fun renderedJson(html: String): JSONObject {
        return JSONObject()
            .put("html", html)
            .put("plain_text", "plain")
            .put("renderer", "katex")
            .put("renderer_version", "0.16.45")
            .put("content_hash", "hash")
            .put("has_math", false)
            .put("has_image", false)
            .put("has_markdown_table", false)
            .put("errors", JSONArray())
    }
}
