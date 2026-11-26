package cn.openphysics.androidapp.data.api

import cn.openphysics.androidapp.domain.HomeworkScore
import cn.openphysics.androidapp.domain.LearningCatalogData
import cn.openphysics.androidapp.domain.LearningCatalogMappingSummary
import cn.openphysics.androidapp.domain.LearningCatalogNode
import cn.openphysics.androidapp.domain.LearningCatalogTopicLayer
import cn.openphysics.androidapp.domain.LearningCatalogTopicOverview
import cn.openphysics.androidapp.domain.TeacherPaper
import cn.openphysics.androidapp.domain.TeacherPaperQuestionVideo
import java.net.URI
import org.json.JSONArray
import org.json.JSONObject

internal object LearningCatalogParsers {
    fun parseResumeTopicId(json: JSONObject): String = json.text("node_id")

    fun parseCatalog(json: JSONObject): LearningCatalogData {
        return LearningCatalogData(
            id = json.text("id"),
            code = json.text("code"),
            name = json.text("name"),
            description = json.text("description"),
            version = json.optInt("version", 0),
            enabled = json.optBoolean("enabled", true),
            sortOrder = json.optInt("sort_order", 0),
            nodeCount = json.optInt("node_count", 0),
            topicCount = json.optInt("topic_count", 0),
            nodes = json.optJSONArray("nodes").objects(::parseNode),
        )
    }

    fun parseOverview(json: JSONObject): LearningCatalogTopicOverview {
        return LearningCatalogTopicOverview(
            catalogCode = json.text("catalog_code"),
            nodeId = json.text("node_id"),
            topicCode = json.text("topic_code"),
            title = json.text("title"),
            description = json.text("description"),
            status = json.text("status"),
            statusLabel = json.text("status_label"),
            recommendedLayer = LearningCatalogTopicLayer.fromApi(json.text("recommended_layer")),
            recommendedLayerName = json.text("recommended_layer_name"),
            nextAction = json.text("next_action"),
            coreKnowledgePointCount = json.optInt("core_knowledge_point_count", 0),
            attemptedKnowledgePointCount = json.optInt("attempted_knowledge_point_count", 0),
            masteredKnowledgePointCount = json.optInt("mastered_knowledge_point_count", 0),
            needsReviewKnowledgePointCount = json.optInt("needs_review_knowledge_point_count", 0),
            averageMastery = json.optDouble("average_mastery", 0.0),
            performanceScore = if (json.has("performance_score") && !json.isNull("performance_score")) json.optDouble("performance_score").takeIf { it.isFinite() } else null,
            evidenceCount = json.optInt("evidence_count", 0),
            lastPracticed = json.text("last_practiced"),
            teacherPapers = json.optJSONArray("teacher_papers").objects(::parseTeacherPaper),
        )
    }

    fun parseTeacherPaper(json: JSONObject): TeacherPaper = TeacherPaper(
        id = json.text("id"), title = json.text("title"),
        questionCount = json.optInt("question_count"), hasVideo = json.optBoolean("has_video"),
        attemptToken = json.text("attempt_token"),
        attemptId = json.text("attempt_id"), status = json.text("status").ifBlank { "not_started" },
        submittedAt = json.text("submitted_at"), completedAt = json.text("completed_at"),
        score = parseHomeworkScore(json),
    )

    fun parseHomeworkScore(json: JSONObject): HomeworkScore? {
        if (json.isNull("score_percent") || json.isNull("score") || json.isNull("max_score")) return null
        return HomeworkScore(
            score = json.optDouble("score"), maxScore = json.optDouble("max_score"),
            percent = json.optInt("score_percent"), released = json.optBoolean("results_released"),
        )
    }

    fun teacherPaperJson(paper: TeacherPaper): JSONObject = JSONObject()
        .put("id", paper.id).put("title", paper.title).put("question_count", paper.questionCount)
        .put("has_video", paper.hasVideo).put("attempt_token", paper.attemptToken)
        .put("attempt_id", paper.attemptId).put("status", paper.status)
        .put("submitted_at", paper.submittedAt).put("completed_at", paper.completedAt)
        .also { json ->
            paper.score?.let {
                json.put("score", it.score).put("max_score", it.maxScore)
                    .put("score_percent", it.percent).put("results_released", it.released)
            }
        }

    private fun parseNode(json: JSONObject): LearningCatalogNode {
        val mapping = json.optJSONObject("mapping_summary")
        val config = json.optJSONObject("config")
        return LearningCatalogNode(
            id = json.text("id"),
            code = json.text("code"),
            nodeType = json.text("node_type"),
            title = json.text("title"),
            description = json.text("description"),
            sortOrder = json.optInt("sort_order", 0),
            displayCode = config.displayCode(),
            mappingSummary = LearningCatalogMappingSummary(
                knowledgePointCount = mapping?.optInt("knowledge_point_count", 0) ?: 0,
                labelRuleCount = mapping?.optInt("label_rule_count", 0) ?: 0,
                questionOverrideCount = mapping?.optInt("question_override_count", 0) ?: 0,
            ),
            children = json.optJSONArray("children").objects(::parseNode),
        )
    }

    private fun JSONObject?.displayCode(): String {
        if (this == null || !has("display_code") || isNull("display_code")) return ""
        return when (val value = opt("display_code")) {
            is Number -> value.toInt().toString().padStart(2, '0')
            else -> value?.toString().orEmpty().takeUnless { it == "null" }.orEmpty()
        }
    }

    private fun JSONObject.text(key: String): String {
        if (!has(key) || isNull(key)) return ""
        return optString(key).takeUnless { it == "null" }.orEmpty()
    }

    private fun <T> JSONArray?.objects(transform: (JSONObject) -> T): List<T> {
        if (this == null) return emptyList()
        return List(length()) { index -> transform(getJSONObject(index)) }
    }
}
