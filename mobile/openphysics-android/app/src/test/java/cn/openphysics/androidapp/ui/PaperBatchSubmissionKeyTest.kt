package cn.openphysics.androidapp.ui

import cn.openphysics.androidapp.domain.LocalImageFile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class PaperBatchSubmissionKeyTest {
    @Test
    fun `same paper batch keeps stable idempotency key`() {
        val images = listOf(
            image("010203", "page-1.jpg"),
        )

        assertEquals(
            paperBatchSubmissionKey(listOf("q1", "q2"), images),
            paperBatchSubmissionKey(listOf("q1", "q2"), images),
        )
    }

    @Test
    fun `changed paper batch receives a different idempotency key`() {
        val first = listOf(image("01", "page.jpg"))
        val changed = listOf(image("02", "page.jpg"))

        assertFalse(
            paperBatchSubmissionKey(listOf("q1"), first) ==
                paperBatchSubmissionKey(listOf("q1"), changed),
        )
    }

    private fun image(hash: String, name: String) = LocalImageFile(
        path = "/tmp/$hash.img",
        mimeType = "image/jpeg",
        fileName = name,
        contentHash = hash,
        sizeBytes = 1L,
    )
}
