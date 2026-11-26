package cn.openphysics.androidapp.data.api

import java.io.ByteArrayOutputStream
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MultipartFormDataBuilderTest {
    @Test
    fun `builds multipart body with form fields and image file`() {
        val file = tempFile(byteArrayOf(1, 2, 3))
        val payload = MultipartFormDataBuilder.build(
            fields = mapOf("question_id" to "q_1", "student_id" to "stu_1"),
            fileFieldName = "image",
            fileName = "answer.png",
            mimeType = "image/png",
            file = file,
            boundary = "OpenPhysicsBoundary",
        )

        val output = ByteArrayOutputStream().also(payload::writeTo)
        val text = output.toByteArray().toString(Charsets.ISO_8859_1)

        assertEquals("multipart/form-data; boundary=OpenPhysicsBoundary", payload.contentType)
        assertTrue(text.contains("name=\"question_id\""))
        assertTrue(text.contains("q_1"))
        assertTrue(text.contains("name=\"student_id\""))
        assertTrue(text.contains("stu_1"))
        assertTrue(text.contains("name=\"image\"; filename=\"answer.png\""))
        assertTrue(text.contains("Content-Type: image/png"))
        assertTrue(text.endsWith("--OpenPhysicsBoundary--\r\n"))
        assertEquals(output.size().toLong(), payload.contentLength)
    }

    @Test
    fun `builds multipart body with repeated image fields`() {
        val first = tempFile(byteArrayOf(1))
        val second = tempFile(byteArrayOf(2))
        val payload = MultipartFormDataBuilder.build(
            fields = mapOf("question_ids" to """["q_1","q_2"]"""),
            files = listOf(
                MultipartFilePart(
                    fieldName = "images",
                    fileName = "page-1.jpg",
                    mimeType = "image/jpeg",
                    file = first,
                ),
                MultipartFilePart(
                    fieldName = "images",
                    fileName = "page-2.jpg",
                    mimeType = "image/jpeg",
                    file = second,
                ),
            ),
            boundary = "OpenPhysicsBoundary",
        )

        val output = ByteArrayOutputStream().also(payload::writeTo)
        val text = output.toByteArray().toString(Charsets.ISO_8859_1)

        assertEquals(2, Regex("name=\"images\"; filename=").findAll(text).count())
        assertTrue(text.contains("filename=\"page-1.jpg\""))
        assertTrue(text.contains("filename=\"page-2.jpg\""))
        assertTrue(text.contains("""["q_1","q_2"]"""))
        assertEquals(output.size().toLong(), payload.contentLength)
    }

    private fun tempFile(bytes: ByteArray): File = File.createTempFile("multipart-", ".img").apply {
        deleteOnExit()
        writeBytes(bytes)
    }
}
