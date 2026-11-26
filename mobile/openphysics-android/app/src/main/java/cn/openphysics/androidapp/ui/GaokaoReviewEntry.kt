package cn.openphysics.androidapp.ui

import cn.openphysics.androidapp.domain.LearningCatalogData
import cn.openphysics.androidapp.domain.LearningCatalogNode
import cn.openphysics.androidapp.domain.LearningCatalogTopicLayer

internal fun LearningCatalogTopicLayer.defersGrading(): Boolean =
    this == LearningCatalogTopicLayer.Diagnostic || this == LearningCatalogTopicLayer.Paper

internal data class GaokaoReviewEntry(val blockId: String, val topic: LearningCatalogNode)

/** The server's latest learning evidence wins; a missing/deleted topic falls back to the first. */
internal fun gaokaoReviewEntry(catalog: LearningCatalogData, resumeTopicId: String): GaokaoReviewEntry? {
    val entries = catalog.knowledgeBlocks().sortedBy { it.sortOrder }.flatMap { block ->
        block.topics().sortedBy { it.sortOrder }.map { GaokaoReviewEntry(block.id, it) }
    }
    return entries.firstOrNull { it.topic.id == resumeTopicId } ?: entries.firstOrNull()
}
