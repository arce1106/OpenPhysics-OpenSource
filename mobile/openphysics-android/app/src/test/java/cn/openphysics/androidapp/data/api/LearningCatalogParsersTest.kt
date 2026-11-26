package cn.openphysics.androidapp.data.api

import cn.openphysics.androidapp.domain.LearningCatalogTopicLayer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LearningCatalogParsersTest {
    @Test
    fun `topic performance distinguishes untested from zero and preserves grading scope`() {
        val raw = JSONObject().put("core_knowledge_point_count", 25).put("attempted_knowledge_point_count", 9)
            .put("average_mastery", 0.108).put("performance_score", 0.6).put("evidence_count", 10)
        val overview = LearningCatalogParsers.parseOverview(raw)
        assertEquals("60% 专题作答表现", overview.topicPerformanceLabel())
        assertEquals(16, overview.untestedKnowledgePointCount())
        assertEquals(10, overview.evidenceCount)
        assertEquals("0% 专题作答表现", LearningCatalogParsers.parseOverview(raw.put("performance_score", 0)).topicPerformanceLabel())
        assertEquals("专题表现待检测", LearningCatalogParsers.parseOverview(raw.put("performance_score", JSONObject.NULL)).topicPerformanceLabel())
        val scope = JSONObject().put("catalog_code", "gaokao_review").put("node_id", "topic-1").put("layer", "transfer")
        val question = parsePracticeQuestionJson(JSONObject().put("id", "q1").put("topic_context", scope))
        assertEquals("transfer", JSONObject(question.topicContext!!).getString("layer"))
    }

    @Test
    fun `paper entry follows server attempt status and preserves permanent identity`() {
        val json = JSONObject("""{"id":"paper-2","title":"新的专题卷","question_count":4,"attempt_id":"durable-attempt","status":"completed","submitted_at":"2026-09-14","completed_at":"2026-09-15"}""")
        val paper = LearningCatalogParsers.parseTeacherPaper(json)
        assertEquals("查看答卷", paper.entryLabel)
        assertEquals("durable-attempt", paper.attemptId)
        assertEquals(paper, LearningCatalogParsers.parseTeacherPaper(LearningCatalogParsers.teacherPaperJson(paper)))
        assertEquals("查看批改进度", paper.copy(status = "grading").entryLabel)
        assertEquals("继续作答", paper.copy(status = "in_progress").entryLabel)
        assertEquals("开始作答", paper.copy(status = "not_started").entryLabel)
    }

    @Test
    fun `lesson video availability defaults to locked and existing answer text is restored`() {
        val video = JSONObject("""{"id":"lesson-1","title":"位移","duration_seconds":98}""")
        val question = parsePracticeQuestionJson(JSONObject().put("id", "q1").put("lesson_video", video))
        assertEquals(false, question.lessonVideo?.available)
        val answer = PaperBatchParsers.parseSubmitResult(JSONObject().put("answer_id", 5).put("given_answer", "BD").put("lesson_video", video.put("available", true)), "https://openphysics.example/api/student/")
        assertEquals("BD", answer.givenAnswer)
        assertEquals(true, answer.lessonVideo?.available)
        assertEquals(null, parsePracticeQuestionJson(JSONObject()).lessonVideo)
    }

    @Test
    fun `teacher paper preserves its attempt token through the overview`() {
        val paper = LearningCatalogParsers.parseTeacherPaper(JSONObject("""{"id":"paper-1","title":"运动","question_count":10,"has_video":true,"attempt_token":"attempt"}"""))
        val overview = LearningCatalogParsers.parseOverview(JSONObject().put("teacher_papers", JSONArray().put(LearningCatalogParsers.teacherPaperJson(paper))))
        assertEquals(paper, overview.teacherPapers.single())
        assertEquals("attempt", paper.attemptToken)
        assertTrue(LearningCatalogParsers.parseOverview(JSONObject()).teacherPapers.isEmpty())
    }

    @Test
    fun `resume accepts latest evidence and a new account without evidence`() {
        assertEquals("topic-6", LearningCatalogParsers.parseResumeTopicId(JSONObject().put("node_id", "topic-6")))
        assertEquals("", LearningCatalogParsers.parseResumeTopicId(JSONObject().put("node_id", JSONObject.NULL)))
        assertEquals("", LearningCatalogParsers.parseResumeTopicId(JSONObject()))
    }

    @Test
    fun `parses knowledge blocks topics and display codes`() {
        val topic = JSONObject()
            .put("id", "topic-1")
            .put("code", "topic_motion")
            .put("node_type", "topic")
            .put("title", "运动描述、运动图像与追及相遇")
            .put("sort_order", 1)
            .put("config", JSONObject().put("display_code", 1))
            .put(
                "mapping_summary",
                JSONObject()
                    .put("knowledge_point_count", 25)
                    .put("label_rule_count", 2)
                    .put("question_override_count", 1),
            )
            .put("children", JSONArray())
        val block = JSONObject()
            .put("id", "block-1")
            .put("code", "motion")
            .put("node_type", "block")
            .put("title", "一、运动与相互作用")
            .put("sort_order", 1)
            .put("config", JSONObject())
            .put("mapping_summary", JSONObject())
            .put("children", JSONArray().put(topic))
        val catalog = LearningCatalogParsers.parseCatalog(
            JSONObject()
                .put("id", "catalog-1")
                .put("code", "gaokao_review")
                .put("name", "高考复习")
                .put("version", 1)
                .put("enabled", true)
                .put("sort_order", 1)
                .put("node_count", 2)
                .put("topic_count", 1)
                .put("nodes", JSONArray().put(block)),
        )

        assertEquals("gaokao_review", catalog.code)
        assertEquals("一、运动与相互作用", catalog.knowledgeBlocks().single().title)
        assertEquals("01", catalog.topic("topic-1")?.topicDisplayCode())
        assertEquals(25, catalog.topic("topic-1")?.mappingSummary?.knowledgePointCount)
    }

    @Test
    fun `parses topic overview without unit diagnostic state`() {
        val overview = LearningCatalogParsers.parseOverview(
            JSONObject()
                .put("catalog_code", "gaokao_review")
                .put("node_id", "topic-1")
                .put("topic_code", "01")
                .put("title", "运动描述")
                .put("status", "needs_review")
                .put("status_label", "需要巩固")
                .put("recommended_layer", "breakthrough")
                .put("recommended_layer_name", "典型突破")
                .put("next_action", "继续训练")
                .put("core_knowledge_point_count", 25)
                .put("attempted_knowledge_point_count", 11)
                .put("mastered_knowledge_point_count", 5)
                .put("needs_review_knowledge_point_count", 6)
                .put("average_mastery", 0.48),
        )

        assertEquals(LearningCatalogTopicLayer.Breakthrough, overview.recommendedLayer)
        assertEquals(48, overview.averageMasteryPercent())
        assertTrue(overview.hasLearningEvidence())
    }

    @Test
    fun `keeps web aligned layer question counts`() {
        assertEquals(8, LearningCatalogTopicLayer.Diagnostic.questionCount)
        assertEquals(5, LearningCatalogTopicLayer.Foundation.questionCount)
        assertEquals(4, LearningCatalogTopicLayer.Breakthrough.questionCount)
        assertEquals(4, LearningCatalogTopicLayer.Transfer.questionCount)
        assertEquals(10, LearningCatalogTopicLayer.Paper.questionCount)
        assertEquals(
            "5 题 · 专题内基础梯度 · 题型按专题特点安排。",
            LearningCatalogTopicLayer.Foundation.description,
        )
        assertEquals(
            "4 题 · 专题内中段梯度 · 突出典型模型与关键方法。",
            LearningCatalogTopicLayer.Breakthrough.description,
        )
        assertEquals(
            "4 题 · 专题内较高梯度 · 侧重综合迁移与复杂情境。",
            LearningCatalogTopicLayer.Transfer.description,
        )
    }
}
