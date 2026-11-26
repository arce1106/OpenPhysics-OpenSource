package cn.openphysics.androidapp.data.session

import android.content.Context
import cn.openphysics.androidapp.domain.TutorChatMessage
import org.json.JSONArray
import org.json.JSONObject

class ChatHistoryStore(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun read(studentId: String, scope: String): List<TutorChatMessage> {
        val raw = prefs.getString(key(studentId, scope), null) ?: return emptyList()
        return runCatching {
            val json = JSONArray(raw)
            List(json.length()) { index ->
                val item = json.getJSONObject(index)
                TutorChatMessage(
                    role = item.optString("role"),
                    content = item.optString("content"),
                )
            }.filter { it.role.isNotBlank() && it.content.isNotBlank() }
        }.getOrDefault(emptyList())
    }

    fun save(studentId: String, scope: String, messages: List<TutorChatMessage>) {
        val json = JSONArray().apply {
            messages.takeLast(MAX_MESSAGES).forEach { message ->
                put(JSONObject().put("role", message.role).put("content", message.content))
            }
        }
        prefs.edit().putString(key(studentId, scope), json.toString()).apply()
    }

    fun clearStudent(studentId: String) {
        val prefix = "$studentId:"
        val keys = prefs.all.keys.filter { it.startsWith(prefix) }
        prefs.edit().apply {
            keys.forEach(::remove)
        }.apply()
    }

    private fun key(studentId: String, scope: String): String = "$studentId:$scope"

    private companion object {
        const val PREFS = "openphysics_chat_history"
        const val MAX_MESSAGES = 30
    }
}
