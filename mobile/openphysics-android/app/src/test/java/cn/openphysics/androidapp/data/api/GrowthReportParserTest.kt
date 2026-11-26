package cn.openphysics.androidapp.data.api

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GrowthReportParserTest {
    @Test
    fun `parses web growth report fields used by native home`() {
        val parsed = parseGrowthReportJson(
            JSONObject()
                .put(
                    "report",
                    JSONObject()
                        .put("id", "report-1")
                        .put("summary", "本周完成了一个学习闭环。")
                        .put("start_date", "2026-07-14")
                        .put("end_date", "2026-07-20")
                        .put("metrics", JSONObject().put("total_answers", 8)),
                ),
        )

        requireNotNull(parsed)
        assertEquals("report-1", parsed.id)
        assertEquals("本周完成了一个学习闭环。", parsed.summary)
        assertEquals(8, parsed.totalAnswers)
        assertEquals("2026-07-14", parsed.startDate)
        assertEquals("2026-07-20", parsed.endDate)
    }

    @Test
    fun `returns null when report is unavailable`() {
        assertNull(parseGrowthReportJson(JSONObject()))
    }
}
