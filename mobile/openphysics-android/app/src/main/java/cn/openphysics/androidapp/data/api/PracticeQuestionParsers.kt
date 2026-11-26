package cn.openphysics.androidapp.data.api

import cn.openphysics.androidapp.BuildConfig
import cn.openphysics.androidapp.domain.PracticeOption
import cn.openphysics.androidapp.domain.PracticeQuestion
import cn.openphysics.androidapp.domain.QuestionImage
import cn.openphysics.androidapp.domain.RenderedRichContent
import cn.openphysics.androidapp.domain.RenderedRichContentError
import org.json.JSONArray
import org.json.JSONObject

internal fun parsePracticeQuestionJson(
    json: JSONObject?,
    apiBaseUrl: String = BuildConfig.API_BASE_URL,
): PracticeQuestion {
    val question = json ?: JSONObject()
    return PracticeQuestion(
        id = question.optText("id"),
        stem = question.optText("stem_text", question.optText("stem")),
        questionType = question.optText("question_type", "practice"),
        options = question.optJSONArray("options").mapObjects { option ->
            PracticeOption(
                label = option.optText("label"),
                text = option.optText("text", option.optText("content")),
                rendered = option.optJSONObject("rendered").toRenderedRichContentOrNull(),
                textRendered = option.optJSONObject("text_rendered").toRenderedRichContentOrNull(),
            )
        },
        images = question.optJSONArray("images").mapObjects { image ->
            val path = image.optText("image_path")
            QuestionImage(
                id = image.optInt("id", -1),
                imagePath = path,
                imageUrl = ResourceUrls.resolve(apiBaseUrl, path),
                imageType = image.optText("image_type"),
                description = image.optText("description"),
            )
        },
        correctAnswer = question.optText("correct_answer", question.optText("answer")),
        explanation = question.optText("explanation"),
        stemRendered = question.optJSONObject("stem_rendered").toRenderedRichContentOrNull(),
        correctAnswerRendered = question.optJSONObject("correct_answer_rendered").toRenderedRichContentOrNull(),
        explanationRendered = question.optJSONObject("explanation_rendered").toRenderedRichContentOrNull(),
        targetKnowledgePointId = question.optText("target_knowledge_point_id"),
        topicContext = question.optJSONObject("topic_context")?.toString(),
        lessonVideo = parseQuestionLessonVideo(question.optJSONObject("lesson_video")),
    )
}

internal fun JSONObject?.toRenderedRichContentOrNull(): RenderedRichContent? {
    val json = this ?: return null
    return RenderedRichContent(
        html = json.optText("html"),
        plainText = json.optText("plain_text", json.optText("plainText")),
        renderer = json.optText("renderer"),
        rendererVersion = json.optText("renderer_version", json.optText("rendererVersion")),
        contentHash = json.optText("content_hash", json.optText("contentHash")),
        hasMath = json.optBoolean("has_math", json.optBoolean("hasMath", false)),
        hasImage = json.optBoolean("has_image", json.optBoolean("hasImage", false)),
        hasMarkdownTable = json.optBoolean("has_markdown_table", json.optBoolean("hasMarkdownTable", false)),
        errors = json.optJSONArray("errors").mapObjects { error ->
            RenderedRichContentError(
                type = error.optText("type"),
                message = error.optText("message"),
                latex = error.optText("latex"),
                position = error.optNullableInt("position"),
            )
        },
    )
}

private inline fun <T> JSONArray?.mapObjects(crossinline transform: (JSONObject) -> T): List<T> {
    if (this == null) return emptyList()
    return buildList {
        for (index in 0 until length()) {
            optJSONObject(index)?.let { add(transform(it)) }
        }
    }
}

private fun JSONObject.optText(key: String, fallback: String = ""): String {
    if (!has(key) || isNull(key)) return fallback
    val value = optString(key, fallback)
    return if (value == "null") fallback else value
}

private fun JSONObject.optNullableInt(key: String): Int? {
    if (!has(key) || isNull(key)) return null
    return optInt(key)
}

internal fun parseQuestionLessonVideo(json: JSONObject?): cn.openphysics.androidapp.domain.QuestionLessonVideo? = json?.let {
    cn.openphysics.androidapp.domain.QuestionLessonVideo(
        id = it.optText("id"), title = it.optText("title"),
        durationSeconds = it.optInt("duration_seconds", 0),
        available = it.optBoolean("available", false), lockedReason = it.optText("locked_reason"),
    )
}

internal fun questionLessonVideoJson(video: cn.openphysics.androidapp.domain.QuestionLessonVideo?): JSONObject? = video?.let {
    JSONObject().put("id", it.id).put("title", it.title).put("duration_seconds", it.durationSeconds)
        .put("available", it.available).put("locked_reason", it.lockedReason)
}
