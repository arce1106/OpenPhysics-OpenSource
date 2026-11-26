package cn.openphysics.androidapp.data.api

import java.io.File
import java.io.OutputStream

class MultipartFormData internal constructor(
    private val boundary: String,
    private val fields: Map<String, String>,
    private val files: List<MultipartFilePart>,
) {
    val contentType: String = "multipart/form-data; boundary=$boundary"

    val contentLength: Long by lazy {
        var total = closingBoundary().size.toLong()
        fields.forEach { (name, value) ->
            total += fieldHeader(name).size + value.toByteArray(Charsets.UTF_8).size + CrLf.size
        }
        files.forEach { file ->
            total += fileHeader(file).size + file.file.length() + CrLf.size
        }
        total
    }

    fun writeTo(output: OutputStream) {
        fields.forEach { (name, value) ->
            output.write(fieldHeader(name))
            output.write(value.toByteArray(Charsets.UTF_8))
            output.write(CrLf)
        }
        files.forEach { part ->
            require(part.file.isFile) { "Upload file is missing: ${part.fileName}" }
            output.write(fileHeader(part))
            part.file.inputStream().use { input -> input.copyTo(output) }
            output.write(CrLf)
        }
        output.write(closingBoundary())
    }

    private fun fieldHeader(name: String): ByteArray = ascii(
        "--$boundary\r\nContent-Disposition: form-data; name=\"${quoted(name)}\"\r\n\r\n",
    )

    private fun fileHeader(file: MultipartFilePart): ByteArray = ascii(
        "--$boundary\r\n" +
            "Content-Disposition: form-data; name=\"${quoted(file.fieldName)}\"; filename=\"${quoted(file.fileName)}\"\r\n" +
            "Content-Type: ${file.mimeType}\r\n\r\n",
    )

    private fun closingBoundary(): ByteArray = ascii("--$boundary--\r\n")

    private fun quoted(value: String): String = value.replace("\\", "_").replace("\"", "_")

    private fun ascii(value: String): ByteArray = value.toByteArray(Charsets.ISO_8859_1)

    private companion object {
        val CrLf = "\r\n".toByteArray(Charsets.ISO_8859_1)
    }
}

data class MultipartFilePart(
    val fieldName: String,
    val fileName: String,
    val mimeType: String,
    val file: File,
)

object MultipartFormDataBuilder {
    fun build(
        fields: Map<String, String>,
        fileFieldName: String,
        fileName: String,
        mimeType: String,
        file: File,
        boundary: String = "OpenPhysicsBoundary${System.currentTimeMillis()}",
    ): MultipartFormData {
        return build(
            fields = fields,
            files = listOf(MultipartFilePart(fileFieldName, fileName, mimeType, file)),
            boundary = boundary,
        )
    }

    fun build(
        fields: Map<String, String>,
        files: List<MultipartFilePart>,
        boundary: String = "OpenPhysicsBoundary${System.currentTimeMillis()}",
    ): MultipartFormData {
        require(files.all { it.file.isFile && it.file.length() > 0L }) { "Multipart upload contains a missing file" }
        return MultipartFormData(boundary, fields, files)
    }
}
