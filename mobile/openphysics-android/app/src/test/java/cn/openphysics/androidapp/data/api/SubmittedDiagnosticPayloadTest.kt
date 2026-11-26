package cn.openphysics.androidapp.data.api

import cn.openphysics.androidapp.domain.MasteryUpdateValue
import cn.openphysics.androidapp.domain.SubmittedDiagnosticAnswer
import org.junit.Assert.assertEquals
import org.junit.Test

class SubmittedDiagnosticPayloadTest {
    @Test
    fun `submitted diagnostic payload keeps mastery update from graded answers`() {
        val payload = SubmittedDiagnosticPayload.answersJson(
            listOf(
                SubmittedDiagnosticAnswer(
                    answerId = 7,
                    masteryUpdate = mapOf(
                        "kp_1" to MasteryUpdateValue(
                            before = 0.35,
                            after = 0.82,
                            name = "参考系",
                        ),
                    ),
                ),
            ),
        )

        val item = payload.getJSONObject(0)
        val update = item.getJSONObject("mastery_update").getJSONObject("kp_1")
        assertEquals(7, item.getInt("answer_id"))
        assertEquals(0.35, update.getDouble("before"), 0.0001)
        assertEquals(0.82, update.getDouble("after"), 0.0001)
        assertEquals("参考系", update.getString("name"))
    }
}
