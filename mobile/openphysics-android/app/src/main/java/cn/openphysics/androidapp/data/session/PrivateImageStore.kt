package cn.openphysics.androidapp.data.session

import android.content.Context
import cn.openphysics.androidapp.domain.LocalImageFile
import java.io.File
import java.io.InputStream
import java.security.MessageDigest

class PrivateImageStore internal constructor(private val root: File) {
    constructor(context: Context) : this(File(context.filesDir, RootDirectory))

    init { root.mkdirs() }

    fun save(
        studentId: String,
        bytes: ByteArray,
        mimeType: String,
        preferredFileName: String,
    ): LocalImageFile {
        require(studentId.isNotBlank())
        require(bytes.isNotEmpty())
        require(mimeType.startsWith("image/"))
        val contentHash = sha256(bytes)
        val directory = studentDirectory(studentId).apply { mkdirs() }
        val file = File(directory, "$contentHash.img")
        if (!file.isFile || file.length() != bytes.size.toLong()) file.writeBytes(bytes)
        return LocalImageFile(
            path = file.absolutePath,
            mimeType = mimeType,
            fileName = sanitizeFileName(preferredFileName, mimeType),
            contentHash = contentHash,
            sizeBytes = bytes.size.toLong(),
        )
    }

    fun delete(image: LocalImageFile) {
        val file = image.asFile()
        if (isInside(file, root)) file.delete()
    }

    fun clearStudent(studentId: String) {
        studentDirectory(studentId).deleteRecursively()
    }

    fun studentDirectory(studentId: String): File {
        return File(root, sha256(studentId.toByteArray(Charsets.UTF_8)))
    }

    private fun isInside(file: File, directory: File): Boolean {
        return runCatching {
            val parentPath = directory.canonicalFile.path.trimEnd(File.separatorChar) + File.separator
            file.canonicalFile.path.startsWith(parentPath)
        }.getOrDefault(false)
    }

    private fun sanitizeFileName(name: String, mimeType: String): String {
        val safe = name.substringAfterLast('/').replace(Regex("[^A-Za-z0-9._-]"), "_")
        if (safe.isNotBlank()) return safe
        return if (mimeType.contains("png")) "answer.png" else "answer.jpg"
    }

    private fun sha256(bytes: ByteArray): String {
        return MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    }

    private fun sha256(input: InputStream): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            digest.update(buffer, 0, read)
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private companion object {
        const val RootDirectory = "practice_images"
    }
}
