package cn.openphysics.androidapp.data.api

import cn.openphysics.androidapp.domain.DailyLearningLoop
import cn.openphysics.androidapp.domain.DailyLearningLoopDay
import cn.openphysics.androidapp.domain.DailyLearningLoopHistory
import cn.openphysics.androidapp.domain.DailyLearningLoopHistorySummary
import cn.openphysics.androidapp.domain.DailyLoopRing
import cn.openphysics.androidapp.domain.DailyLoopRings
import org.json.JSONArray
import org.json.JSONObject

object DailyLearningLoopParsers {
    fun parseLoop(json: JSONObject): DailyLearningLoop {
        val day = parseDay(json)
        return DailyLearningLoop(
            date = day.date,
            isEffectiveDay = day.isEffectiveDay,
            isHighQualityDay = day.isHighQualityDay,
            rings = day.rings,
            summary = day.summary,
            nextAction = day.nextAction,
            streakDays = json.optInt("streak_days", 0),
        )
    }

    fun parseHistory(json: JSONObject): DailyLearningLoopHistory {
        val summary = json.optJSONObject("summary")
        return DailyLearningLoopHistory(
            startDate = json.optText("start_date"),
            endDate = json.optText("end_date"),
            practiceTarget = json.optInt("practice_target", 5),
            reviewTarget = json.optInt("review_target", 3),
            summary = DailyLearningLoopHistorySummary(
                practiceTotal = summary?.optInt("practice_total", 0) ?: 0,
                reviewTotal = summary?.optInt("review_total", 0) ?: 0,
                practiceClosedDays = summary?.optInt("practice_closed_days", 0) ?: 0,
                reviewClosedDays = summary?.optInt("review_closed_days", 0) ?: 0,
                dualClosedDays = summary?.optInt("dual_closed_days", 0) ?: 0,
                effectiveDays = summary?.optInt("effective_days", 0) ?: 0,
            ),
            days = json.optJSONArray("days").mapObjects { parseDay(it) },
        )
    }

    private fun parseDay(json: JSONObject): DailyLearningLoopDay {
        val rings = json.optJSONObject("rings")
        return DailyLearningLoopDay(
            date = json.optText("date"),
            isEffectiveDay = json.optBoolean("is_effective_day", false),
            isHighQualityDay = json.optBoolean("is_high_quality_day", false),
            rings = DailyLoopRings(
                practice = parseRing(rings?.optJSONObject("practice"), "practice", "做题环"),
                review = parseRing(rings?.optJSONObject("review"), "review", "复盘环"),
            ),
            summary = json.optText("summary"),
            nextAction = json.optText("next_action"),
        )
    }

    private fun parseRing(json: JSONObject?, fallbackKey: String, fallbackLabel: String): DailyLoopRing {
        return DailyLoopRing(
            key = json?.optText("key", fallbackKey) ?: fallbackKey,
            label = json?.optText("label", fallbackLabel) ?: fallbackLabel,
            completed = json?.optBoolean("completed", false) ?: false,
            current = json?.optInt("current", 0) ?: 0,
            actualCurrent = json?.optInt("actual_current", json.optInt("current", 0)) ?: 0,
            target = json?.optInt("target", 0) ?: 0,
            overflow = json?.optInt("overflow", 0) ?: 0,
            autoCompleted = json?.optBoolean("auto_completed", false) ?: false,
            pendingMistakes = json?.takeIf { it.has("pending_mistakes") && !it.isNull("pending_mistakes") }?.optInt("pending_mistakes"),
            evidence = json?.optText("evidence") ?: "",
        )
    }
}

private fun JSONObject.optText(key: String, fallback: String = ""): String {
    if (!has(key) || isNull(key)) return fallback
    return optString(key, fallback).ifBlank { fallback }
}

private inline fun <T> JSONArray?.mapObjects(crossinline transform: (JSONObject) -> T): List<T> {
    if (this == null) return emptyList()
    return buildList {
        for (index in 0 until length()) {
            optJSONObject(index)?.let { add(transform(it)) }
        }
    }
}
