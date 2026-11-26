package cn.openphysics.androidapp.data.api

import cn.openphysics.androidapp.domain.AnswerHistoryRecord
import cn.openphysics.androidapp.domain.PracticeOption
import cn.openphysics.androidapp.domain.ProcessGrading
import cn.openphysics.androidapp.domain.ProcessStepScore
import cn.openphysics.androidapp.domain.QuestionImage
import cn.openphysics.androidapp.domain.ReviewData
import cn.openphysics.androidapp.domain.ReviewCenter
import cn.openphysics.androidapp.domain.ReviewErrorGroup
import cn.openphysics.androidapp.domain.ReviewGroup
import cn.openphysics.androidapp.domain.ReviewMistake
import cn.openphysics.androidapp.domain.ReviewStep
import org.json.JSONArray
import org.json.JSONObject

object StudentRecordParsers {
    fun parseHistory(json: JSONArray, apiBaseUrl: String): List<AnswerHistoryRecord> {
        return json.mapObjects { item ->
            val processGradingJson = item.optJSONObject("process_grading")
            AnswerHistoryRecord(
                id = item.optInt("id", -1),
                lessonVideo = parseQuestionLessonVideo(item.optJSONObject("lesson_video")),
                questionId = item.optText("question_id"),
                stemText = item.optText("stem_text"),
                stemRendered = item.optJSONObject("stem_rendered").toRenderedRichContentOrNull(),
                questionType = item.optText("question_type"),
                options = parseOptions(item.optJSONArray("options")),
                images = parseImages(item.optJSONArray("images"), apiBaseUrl),
                kpNames = item.optJSONArray("knowledge_points").mapObjects { it.optText("name") }.filter { it.isNotBlank() },
                givenAnswer = item.optText("given_answer"),
                isCorrect = item.optBoolean("is_correct", false),
                correctAnswer = item.optText("correct_answer"),
                correctAnswerRendered = item.optJSONObject("correct_answer_rendered").toRenderedRichContentOrNull(),
                explanation = item.optText("explanation"),
                explanationRendered = item.optJSONObject("explanation_rendered").toRenderedRichContentOrNull(),
                createdAt = item.optText("created_at"),
                answerImages = parseAnswerImages(processGradingJson, apiBaseUrl),
                processGrading = parseProcessGrading(processGradingJson, apiBaseUrl),
            )
        }
    }

    fun parseReview(
        json: JSONObject,
        apiBaseUrl: String,
        mistakesAreDetailed: Boolean = true,
    ): ReviewData {
        val clearance = json.optJSONObject("clearance_progress")
        val groups = json.optJSONArray("groups").mapObjects { group ->
            ReviewGroup(
                kpId = group.optText("kp_id", "unknown"),
                kpName = group.optText("kp_name", "未归类知识点"),
                wrongCount = group.optInt("wrong_count", 0),
                mistakes = group.optJSONArray("mistakes").mapObjects { mistake ->
                    parseReviewMistake(mistake, apiBaseUrl, mistakesAreDetailed)
                },
            )
        }
        return ReviewData(
            groups = groups,
            reviewedCount = clearance?.optInt("reviewed", 0) ?: 0,
            totalCount = clearance?.optInt("total", groups.sumOf { it.wrongCount }) ?: groups.sumOf { it.wrongCount },
            reviewCenter = parseReviewCenter(json.optJSONObject("review_center")),
        )
    }

    fun parseReviewMistake(
        json: JSONObject,
        apiBaseUrl: String,
        detailLoaded: Boolean = true,
    ): ReviewMistake {
        val processGradingJson = json.optJSONObject("process_grading")
        return ReviewMistake(
            answerId = json.optInt("answer_id", -1),
            lessonVideo = parseQuestionLessonVideo(json.optJSONObject("lesson_video")),
            questionId = json.optText("question_id"),
            stemText = json.optText("stem_text"),
            stemRendered = json.optJSONObject("stem_rendered").toRenderedRichContentOrNull(),
            questionType = json.optText("question_type"),
            options = parseOptions(json.optJSONArray("options")),
            images = parseImages(json.optJSONArray("images"), apiBaseUrl),
            givenAnswer = json.optText("given_answer"),
            correctAnswer = json.optText("correct_answer"),
            correctAnswerRendered = json.optJSONObject("correct_answer_rendered").toRenderedRichContentOrNull(),
            explanation = json.optText("explanation"),
            explanationRendered = json.optJSONObject("explanation_rendered").toRenderedRichContentOrNull(),
            misconceptionName = json.optJSONObject("misconception")?.optText("name", "待复盘") ?: "待复盘",
            createdAt = json.optText("created_at"),
            answerImages = parseAnswerImages(processGradingJson, apiBaseUrl),
            processGrading = parseProcessGrading(processGradingJson, apiBaseUrl),
            isDetailLoaded = detailLoaded,
        )
    }

    fun parseProcessGrading(json: JSONObject?, apiBaseUrl: String): ProcessGrading? {
        if (json == null) return null
        val rawPaths = answerImagePaths(json)
        return ProcessGrading(
            feedback = json.optText("feedback"),
            firstError = json.optText("first_error"),
            nextAction = json.optText("next_action"),
            answerImagePaths = rawPaths.map { ResourceUrls.resolve(apiBaseUrl, it) },
            confidenceLevel = json.optText("confidence_level"),
            needsHumanReview = json.optBoolean("needs_human_review", false),
            processScore = json.optNullableInt("process_score"),
            processScorePercent = json.optNullableDouble("process_score_percent"),
            score = json.optNullableDouble("score"),
            maxScore = json.optNullableDouble("max_score"),
            modelCorrect = json.optNullableBoolean("model_correct"),
            equationCorrect = json.optNullableBoolean("equation_correct"),
            calculationCorrect = json.optNullableBoolean("calculation_correct"),
            unitCorrect = json.optNullableBoolean("unit_correct"),
            errorTypeName = json.optText("error_type_name"),
            gradingBasis = json.optText("grading_basis"),
            gradingConfidence = json.optNullableDouble("grading_confidence"),
            feedbackRendered = json.optJSONObject("feedback_rendered").toRenderedRichContentOrNull(),
            firstErrorRendered = json.optJSONObject("first_error_rendered").toRenderedRichContentOrNull(),
            nextActionRendered = json.optJSONObject("next_action_rendered").toRenderedRichContentOrNull(),
            gradingBasisRendered = json.optJSONObject("grading_basis_rendered").toRenderedRichContentOrNull(),
            stepScores = json.optJSONArray("step_scores").mapObjects { step ->
                ProcessStepScore(
                    name = step.optText("name"),
                    score = step.optDouble("score", 0.0),
                    maxScore = step.optDouble("max_score", 0.0),
                    comment = step.optText("comment"),
                )
            },
        )
    }

    private fun parseReviewCenter(json: JSONObject?): ReviewCenter? {
        if (json == null) return null
        return ReviewCenter(
            totalPending = json.optInt("total_pending", 0),
            primaryFocus = parseErrorGroup(json.optJSONObject("primary_focus")),
            errorGroups = json.optJSONArray("error_groups").mapObjects { parseErrorGroup(it) }.filterNotNull(),
            reviewSteps = json.optJSONArray("review_steps").mapObjects {
                ReviewStep(
                    title = it.optText("title"),
                    description = it.optText("description"),
                )
            },
            stageCounts = json.optJSONObject("stage_counts")?.toIntMap().orEmpty(),
        )
    }

    private fun parseErrorGroup(json: JSONObject?): ReviewErrorGroup? {
        if (json == null) return null
        return ReviewErrorGroup(
            errorType = json.optText("error_type"),
            errorName = json.optText("error_name", "未归类错因"),
            count = json.optInt("count", 0),
            kpNames = json.optJSONArray("kp_names").mapStrings(),
            sampleAnswerId = json.optNullableInt("sample_answer_id"),
            firstError = json.optText("first_error"),
            nextAction = json.optText("next_action"),
        )
    }

    private fun parseOptions(json: JSONArray?): List<PracticeOption> {
        return json.mapObjects { option ->
            PracticeOption(
                label = option.optText("label"),
                text = option.optText("text", option.optText("content")),
                rendered = option.optJSONObject("rendered").toRenderedRichContentOrNull(),
                textRendered = option.optJSONObject("text_rendered").toRenderedRichContentOrNull(),
            )
        }
    }

    private fun parseImages(json: JSONArray?, apiBaseUrl: String): List<QuestionImage> {
        return json.mapObjects { image ->
            val path = image.optText("image_path")
            QuestionImage(
                id = image.optInt("id", -1),
                imagePath = path,
                imageUrl = ResourceUrls.resolve(apiBaseUrl, path),
                imageType = image.optText("image_type"),
                description = image.optText("description"),
            )
        }
    }

    private fun parseAnswerImages(processGrading: JSONObject?, apiBaseUrl: String): List<QuestionImage> {
        if (processGrading == null) return emptyList()
        val paths = answerImagePaths(processGrading)
        return paths.mapIndexed { index, path ->
            QuestionImage(
                id = index,
                imagePath = path,
                imageUrl = ResourceUrls.resolve(apiBaseUrl, path),
                imageType = "answer",
                description = "学生作答图片 ${index + 1}",
            )
        }
    }

    private fun answerImagePaths(processGrading: JSONObject): List<String> {
        val answerImagePaths = processGrading.optJSONArray("answer_image_paths").mapStrings().distinct()
        if (answerImagePaths.isNotEmpty()) return answerImagePaths

        val answerImagePath = processGrading.optText("answer_image_path").takeIf { it.isNotBlank() }?.let { listOf(it) }.orEmpty()
        if (answerImagePath.isNotEmpty()) return answerImagePath

        return buildList {
            processGrading.optText("answer_crop_image_path").takeIf { it.isNotBlank() }?.let { add(it) }
            processGrading.optJSONArray("answer_page_image_paths").forEachString { add(it) }
            processGrading.optText("answer_page_image_path").takeIf { it.isNotBlank() }?.let { add(it) }
            processGrading.optText("process_evidence_image_path").takeIf { it.isNotBlank() }?.let { add(it) }
        }.distinct()
    }
}

private fun JSONObject.optText(key: String, fallback: String = ""): String {
    if (!has(key) || isNull(key)) return fallback
    val value = optString(key, fallback)
    return if (value == "null") fallback else value
}

private inline fun <T> JSONArray?.mapObjects(crossinline transform: (JSONObject) -> T): List<T> {
    if (this == null) return emptyList()
    return List(length()) { index -> transform(getJSONObject(index)) }
}

private fun JSONArray?.forEachString(block: (String) -> Unit) {
    if (this == null) return
    for (index in 0 until length()) {
        val value = optString(index)
        if (value.isNotBlank() && value != "null") block(value)
    }
}

private fun JSONArray?.mapStrings(): List<String> {
    if (this == null) return emptyList()
    return buildList {
        for (index in 0 until length()) {
            val value = optString(index)
            if (value.isNotBlank() && value != "null") add(value)
        }
    }
}

private fun JSONObject.optNullableBoolean(key: String): Boolean? {
    if (!has(key) || isNull(key)) return null
    return optBoolean(key)
}

private fun JSONObject.optNullableDouble(key: String): Double? {
    if (!has(key) || isNull(key)) return null
    return optDouble(key)
}

private fun JSONObject.optNullableInt(key: String): Int? {
    if (!has(key) || isNull(key)) return null
    return optInt(key)
}

private fun JSONObject.toIntMap(): Map<String, Int> {
    return keys().asSequence().associateWith { key -> optInt(key, 0) }
}
