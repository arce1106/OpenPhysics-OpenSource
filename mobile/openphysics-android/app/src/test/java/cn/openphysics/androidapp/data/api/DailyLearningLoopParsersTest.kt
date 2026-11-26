package cn.openphysics.androidapp.data.api

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DailyLearningLoopParsersTest {
    @Test
    fun `parses daily learning loop rings with overflow and auto review`() {
        val loop = DailyLearningLoopParsers.parseLoop(
            JSONObject()
                .put("date", "2026-06-06")
                .put("is_effective_day", true)
                .put("is_high_quality_day", true)
                .put("summary", "今天已经完成主要闭环。")
                .put("next_action", "继续一组巩固练习。")
                .put("streak_days", 4)
                .put(
                    "rings",
                    JSONObject()
                        .put(
                            "practice",
                            ring("practice", "做题环", current = 7, actualCurrent = 7, target = 5, overflow = 2),
                        )
                        .put(
                            "review",
                            ring(
                                key = "review",
                                label = "复盘环",
                                current = 3,
                                actualCurrent = 0,
                                target = 3,
                                overflow = 0,
                                autoCompleted = true,
                                pendingMistakes = 0,
                            ),
                        ),
                ),
        )

        assertEquals("2026-06-06", loop.date)
        assertTrue(loop.isHighQualityDay)
        assertEquals(4, loop.streakDays)
        assertEquals(7, loop.rings.practice.actualCurrent)
        assertEquals(2, loop.rings.practice.overflow)
        assertTrue(loop.rings.review.autoCompleted)
        assertEquals(0, loop.rings.review.pendingMistakes)
    }

    @Test
    fun `parses loop history summary and days`() {
        val history = DailyLearningLoopParsers.parseHistory(
            JSONObject()
                .put("start_date", "2026-05-31")
                .put("end_date", "2026-06-06")
                .put("practice_target", 5)
                .put("review_target", 3)
                .put(
                    "summary",
                    JSONObject()
                        .put("practice_total", 18)
                        .put("review_total", 9)
                        .put("practice_closed_days", 2)
                        .put("review_closed_days", 3)
                        .put("dual_closed_days", 2)
                        .put("effective_days", 5),
                )
                .put(
                    "days",
                    JSONArray()
                        .put(day("2026-06-05", effective = true, highQuality = false))
                        .put(day("2026-06-06", effective = true, highQuality = true)),
                ),
        )

        assertEquals("2026-05-31", history.startDate)
        assertEquals("2026-06-06", history.endDate)
        assertEquals(5, history.practiceTarget)
        assertEquals(2, history.summary.dualClosedDays)
        assertEquals(2, history.days.size)
        assertFalse(history.days.first().isHighQualityDay)
        assertTrue(history.days.last().isHighQualityDay)
    }

    private fun day(date: String, effective: Boolean, highQuality: Boolean): JSONObject {
        return JSONObject()
            .put("date", date)
            .put("is_effective_day", effective)
            .put("is_high_quality_day", highQuality)
            .put("summary", "")
            .put("next_action", "")
            .put(
                "rings",
                JSONObject()
                    .put("practice", ring("practice", "做题环", current = 5, actualCurrent = 5, target = 5))
                    .put("review", ring("review", "复盘环", current = 2, actualCurrent = 2, target = 3)),
            )
    }

    private fun ring(
        key: String,
        label: String,
        current: Int,
        actualCurrent: Int,
        target: Int,
        overflow: Int = 0,
        autoCompleted: Boolean = false,
        pendingMistakes: Int = 2,
    ): JSONObject {
        return JSONObject()
            .put("key", key)
            .put("label", label)
            .put("completed", current >= target || autoCompleted)
            .put("current", current)
            .put("actual_current", actualCurrent)
            .put("target", target)
            .put("overflow", overflow)
            .put("auto_completed", autoCompleted)
            .put("pending_mistakes", pendingMistakes)
            .put("evidence", "$actualCurrent/$target")
    }
}
