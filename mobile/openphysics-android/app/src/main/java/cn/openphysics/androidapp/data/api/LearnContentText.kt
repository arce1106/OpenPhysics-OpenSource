package cn.openphysics.androidapp.data.api

import org.json.JSONArray
import org.json.JSONObject

object LearnContentText {
    fun extract(content: JSONObject?): String {
        if (content == null) return ""
        val parts = buildList {
            addLabeled(content, "题目", "stem")
            addLabeled(content, "解答", "solution")
            addLabeled(content, "提醒", "key_takeaway")
            if (isEmpty()) {
                listOf("text", "html", "latex", "formula").forEach { key ->
                    val value = content.optCleanText(key)
                    if (value.isNotBlank()) add(value)
                }
                content.optJSONArray("items").forEachValue { add("· $it") }
                content.optJSONArray("steps").forEachValue { add("· $it") }
            }
        }
        return parts.joinToString("\n\n").ifBlank { content.toString() }
    }

    private fun MutableList<String>.addLabeled(content: JSONObject, label: String, key: String) {
        val value = content.optCleanText(key)
        if (value.isNotBlank()) add("$label：$value")
    }

    private fun JSONObject.optCleanText(key: String): String {
        if (!has(key) || isNull(key)) return ""
        return optString(key, "")
            .takeUnless { it == "null" }
            .orEmpty()
            .replace("\\n", "\n")
            .replace(Regex("n(?=\\d+\\.)"), "\n")
            .trim()
    }

    private inline fun JSONArray?.forEachValue(block: (String) -> Unit) {
        if (this == null) return
        for (index in 0 until length()) {
            val value = opt(index)?.toString().orEmpty()
            if (value.isNotBlank()) block(value)
        }
    }
}
