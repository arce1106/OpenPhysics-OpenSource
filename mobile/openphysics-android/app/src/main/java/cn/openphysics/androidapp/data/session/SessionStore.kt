package cn.openphysics.androidapp.data.session

import android.content.Context
import cn.openphysics.androidapp.domain.StudentSession

class SessionStore(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun read(): StudentSession? {
        val token = prefs.getString(KEY_TOKEN, null)
        if (token.isNullOrBlank()) return null
        return StudentSession(
            token = token,
            studentId = prefs.getString(KEY_STUDENT_ID, "").orEmpty(),
            username = prefs.getString(KEY_USERNAME, "").orEmpty(),
            displayName = prefs.getString(KEY_DISPLAY_NAME, "").orEmpty(),
            accountStatus = prefs.getString(KEY_ACCOUNT_STATUS, "active").orEmpty(),
        )
    }

    fun save(session: StudentSession) {
        prefs.edit()
            .putString(KEY_TOKEN, session.token)
            .putString(KEY_STUDENT_ID, session.studentId)
            .putString(KEY_USERNAME, session.username)
            .putString(KEY_DISPLAY_NAME, session.displayName)
            .putString(KEY_ACCOUNT_STATUS, session.accountStatus)
            .apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    private companion object {
        const val PREFS = "openphysics_session"
        const val KEY_TOKEN = "token"
        const val KEY_STUDENT_ID = "student_id"
        const val KEY_USERNAME = "username"
        const val KEY_DISPLAY_NAME = "display_name"
        const val KEY_ACCOUNT_STATUS = "account_status"
    }
}
