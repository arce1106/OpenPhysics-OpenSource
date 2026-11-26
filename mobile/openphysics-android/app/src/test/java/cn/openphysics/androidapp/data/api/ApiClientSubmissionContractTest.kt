package cn.openphysics.androidapp.data.api

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

class ApiClientSubmissionContractTest {
    @Test
    fun `all answer creation endpoints send submission id`() {
        val source = File("src/main/java/cn/openphysics/androidapp/data/api/ApiClient.kt").readText()

        assertMethodContains(source, "override fun submitAnswer", "override fun submitPhotoAnswer", ".put(\"submission_id\", submissionId)")
        assertMethodContains(source, "override fun submitPhotoAnswer", "override fun submitScratchImage", "put(\"submission_id\", submissionId)")
        assertMethodContains(source, "override fun submitSelfReview", "fun submitPaperBatch", ".put(\"submission_id\", submissionId)")
        assertMethodContains(source, "fun submitPaperBatch", "fun correctAnswerGrading", "put(\"submission_id\", submissionId)")
    }

    @Test
    fun `all mastery updating endpoints send target knowledge point`() {
        val source = File("src/main/java/cn/openphysics/androidapp/data/api/ApiClient.kt").readText()

        assertMethodContains(source, "override fun submitAnswer", "override fun submitPhotoAnswer", "target_knowledge_point_id")
        assertMethodContains(source, "override fun submitPhotoAnswer", "override fun submitScratchImage", "target_knowledge_point_id")
        assertMethodContains(source, "override fun submitSelfReview", "fun submitPaperBatch", "target_knowledge_point_id")
        assertMethodContains(source, "fun submitPaperBatch", "fun correctAnswerGrading", "target_knowledge_point_ids")
    }

    private fun assertMethodContains(source: String, start: String, end: String, expected: String) {
        val method = source.substringAfter(start).substringBefore(end)
        assertTrue("Expected $start to include $expected", method.contains(expected))
    }
}
