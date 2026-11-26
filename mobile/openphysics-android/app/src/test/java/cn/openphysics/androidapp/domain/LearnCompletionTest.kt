package cn.openphysics.androidapp.domain

import org.junit.Assert.assertEquals
import org.junit.Test

class LearnCompletionTest {
    @Test
    fun `builds card completion request from knowledge card`() {
        val card = KnowledgeCard(
            contentId = "x2c1s2k01-card-curated-001",
            title = "安培力",
            sections = emptyList(),
            consumed = false,
        )

        val request = card.toCompletionRequest(kpId = "x2c1s2k01", timeSpentSeconds = 18)

        assertEquals("x2c1s2k01", request.kpId)
        assertEquals("x2c1s2k01-card-curated-001", request.contentId)
        assertEquals("card", request.contentType)
        assertEquals(18, request.timeSpentSeconds)
    }
}
