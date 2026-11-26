package cn.openphysics.androidapp.domain

import java.io.File

data class LocalImageFile(
    val path: String,
    val mimeType: String,
    val fileName: String,
    val contentHash: String,
    val sizeBytes: Long,
) {
    fun asFile(): File = File(path)
}
