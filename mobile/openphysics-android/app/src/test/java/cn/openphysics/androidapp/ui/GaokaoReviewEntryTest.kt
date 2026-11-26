package cn.openphysics.androidapp.ui

import cn.openphysics.androidapp.domain.LearningCatalogData
import cn.openphysics.androidapp.domain.LearningCatalogNode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GaokaoReviewEntryTest {
    private fun topic(id: String, order: Int) = LearningCatalogNode(id, id, "topic", id, sortOrder = order)
    private val catalog = LearningCatalogData("catalog", "gaokao_review", "高考复习", nodes = listOf(
        LearningCatalogNode("block-2", "block-2", "block", "能量与动量", sortOrder = 2,
            children = listOf(topic("topic-6", 6))),
        LearningCatalogNode("block-1", "block-1", "block", "运动与相互作用", sortOrder = 1,
            children = listOf(topic("topic-2", 2), topic("topic-1", 1))),
    ))

    @Test fun `restores the recent topic in another knowledge block`() {
        val entry = gaokaoReviewEntry(catalog, "topic-6")
        assertEquals("block-2", entry?.blockId)
        assertEquals("topic-6", entry?.topic?.id)
    }

    @Test fun `new account missing history and removed topic use the first ordered topic`() {
        for (resume in listOf("", "deleted-topic", "block-2")) {
            val entry = gaokaoReviewEntry(catalog, resume)
            assertEquals("block-1", entry?.blockId)
            assertEquals("topic-1", entry?.topic?.id)
        }
    }

    @Test fun `empty catalog has no invented selection`() {
        assertNull(gaokaoReviewEntry(catalog.copy(nodes = emptyList()), "topic-6"))
        assertNull(gaokaoReviewEntry(catalog.copy(nodes = listOf(
            LearningCatalogNode("empty", "empty", "block", "准备中"),
        )), ""))
    }
}
