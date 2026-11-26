package cn.openphysics.androidapp.data.api

import java.net.URLEncoder

object ResourceUrls {
    fun resolve(apiBaseUrl: String, imagePath: String): String {
        val trimmed = imagePath.trim()
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed
        val origin = apiBaseUrl.substringBefore("/api/")
        // Signed answer URLs carry their credentials in the query. Encode only
        // the path, retaining both that query and existing percent escapes.
        val suffixStart = trimmed.indexOfFirst { it == '?' || it == '#' }
            .takeIf { it >= 0 } ?: trimmed.length
        val relativePath = trimmed.substring(0, suffixStart)
        val path = if (relativePath.startsWith("/")) relativePath else "/$relativePath"
        return origin + encodePath(path) + trimmed.substring(suffixStart)
    }

    private fun encodePath(path: String): String {
        return path.split("/").joinToString("/") { segment ->
            URLEncoder.encode(segment, "UTF-8").replace("+", "%20")
                .replace(Regex("%25([0-9a-fA-F]{2})")) { "%" + it.groupValues[1] }
        }
    }
}
