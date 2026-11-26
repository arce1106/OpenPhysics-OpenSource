package cn.openphysics.androidapp.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class AnswerPhotoCaptureTest {
    @Test
    fun `large photos are sampled before decode to a bounded pixel buffer`() {
        assertEquals(1, answerPhotoDecodeSampleSize(1600, 1200))
        assertEquals(4, answerPhotoDecodeSampleSize(6000, 4000))
        assertEquals(8, answerPhotoDecodeSampleSize(12000, 9000))
        assertEquals(8, answerPhotoDecodeSampleSize(9000, 12000))
        val sample = answerPhotoDecodeSampleSize(12000, 9000)
        assertTrue((12000 / sample).toLong() * (9000 / sample) * 4 < 13_000_000L)
    }

    @Test
    fun `invalid or extreme source pixel counts are rejected before allocation`() {
        assertTrue(runCatching { answerPhotoDecodeSampleSize(-1, -1) }.isFailure)
        assertTrue(runCatching { answerPhotoDecodeSampleSize(Int.MAX_VALUE, 100) }.isFailure)
        assertTrue(runCatching { answerPhotoDecodeSampleSize(20000, 20000) }.isFailure)
    }
    @get:Rule
    val temporaryFolder = TemporaryFolder()

    @Test
    fun `creates safe jpeg file under answer photo cache directory`() {
        val file = createAnswerPhotoFile(temporaryFolder.root, "q/03:10")

        assertEquals("answer_photos", file.parentFile?.name)
        assertTrue(file.name.startsWith("answer_q_03_10_"))
        assertTrue(file.name.endsWith(".jpg"))
    }

    @Test
    fun `uses application scoped file provider authority`() {
        assertEquals("cn.openphysics.androidapp.fileprovider", answerPhotoAuthority("cn.openphysics.androidapp"))
    }

    @Test
    fun `image byte reader rejects files over configured limit`() {
        val result = runCatching {
            readUploadImageBytesWithLimit(
                input = ByteArray(9) { 1 }.inputStream(),
                maxBytes = 8,
            )
        }

        assertTrue(result.exceptionOrNull() is UploadImageTooLargeException)
    }

    @Test
    fun `image byte reader keeps bytes within configured limit`() {
        val bytes = readUploadImageBytesWithLimit(
            input = byteArrayOf(1, 2, 3).inputStream(),
            maxBytes = 3,
        )

        assertEquals(listOf<Byte>(1, 2, 3), bytes.toList())
    }
}
