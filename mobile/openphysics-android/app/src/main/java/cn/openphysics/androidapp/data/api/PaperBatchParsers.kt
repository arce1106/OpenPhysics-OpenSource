package cn.openphysics.androidapp.data.api

import cn.openphysics.androidapp.domain.MasteryUpdateValue
import cn.openphysics.androidapp.domain.PaperBatchGradeResponse
import cn.openphysics.androidapp.domain.PaperBatchSolution
import cn.openphysics.androidapp.domain.SubmitResult
import org.json.JSONObject

object PaperBatchParsers {
    fun parse(json: JSONObject, apiBaseUrl: String): PaperBatchGradeResponse {
        return PaperBatchGradeResponse(
            results = parseResults(json.optJSONObject("results"), apiBaseUrl),
            errors = parseStringMap(json.optJSONObject("errors")),
            solutions = parseSolutions(json.optJSONObject("solutions")),
        )
    }

    fun parseSubmitResult(json: JSONObject, apiBaseUrl: String): SubmitResult {
        return SubmitResult(
            answerId = json.optNullableInt("answer_id"),
            givenAnswer = json.optText("given_answer"),
            lessonVideo = parseQuestionLessonVideo(json.optJSONObject("lesson_video")),
            correct = json.optBoolean("is_correct", false),
            correctAnswer = json.optText("correct_answer"),
            explanation = json.optText("explanation"),
            aiFeedback = json.optText("ai_feedback", json.optText("feedback")),
            extractedAnswer = json.optText("extracted_answer"),
            processGrading = StudentRecordParsers.parseProcessGrading(json.optJSONObject("process_grading"), apiBaseUrl),
            masteryUpdate = parseMasteryUpdate(json.optJSONObject("mastery_update")),
            cleared = json.optBoolean("cleared", false),
            correctAnswerRendered = json.optJSONObject("correct_answer_rendered").toRenderedRichContentOrNull(),
            explanationRendered = json.optJSONObject("explanation_rendered").toRenderedRichContentOrNull(),
            aiFeedbackRendered = json.optJSONObject("ai_feedback_rendered").toRenderedRichContentOrNull(),
            extractedAnswerRendered = json.optJSONObject("extracted_answer_rendered").toRenderedRichContentOrNull(),
        )
    }

    private fun parseResults(json: JSONObject?, apiBaseUrl: String): Map<String, SubmitResult> {
        if (json == null) return emptyMap()
        return buildMap {
            val keys = json.keys()
            while (keys.hasNext()) {
                val questionId = keys.next()
                val item = json.optJSONObject(questionId) ?: continue
                put(questionId, parseSubmitResult(item, apiBaseUrl))
            }
        }
    }

    private fun parseStringMap(json: JSONObject?): Map<String, String> {
        if (json == null) return emptyMap()
        return buildMap {
            val keys = json.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                put(key, json.optText(key))
            }
        }
    }

    private fun parseSolutions(json: JSONObject?): Map<String, PaperBatchSolution> {
        if (json == null) return emptyMap()
        return buildMap {
            val keys = json.keys()
            while (keys.hasNext()) {
                val questionId = keys.next()
                val item = json.optJSONObject(questionId) ?: continue
                put(
                    questionId,
                    PaperBatchSolution(
                        correctAnswer = item.optText("correct_answer"),
                        explanation = item.optText("explanation"),
                    ),
                )
            }
        }
    }

    private fun parseMasteryUpdate(json: JSONObject?): Map<String, MasteryUpdateValue> {
        if (json == null) return emptyMap()
        return buildMap {
            val keys = json.keys()
            while (keys.hasNext()) {
                val kpId = keys.next()
                val item = json.optJSONObject(kpId) ?: continue
                put(
                    kpId,
                    MasteryUpdateValue(
                        before = item.optDouble("before", 0.0),
                        after = item.optDouble("after", 0.0),
                        name = item.optText("name", kpId),
                    ),
                )
            }
        }
    }
}

private fun JSONObject.optText(key: String, fallback: String = ""): String {
    if (!has(key) || isNull(key)) return fallback
    return optString(key, fallback).trim()
}

private fun JSONObject.optNullableInt(key: String): Int? {
    if (!has(key) || isNull(key)) return null
    return optInt(key)
}
