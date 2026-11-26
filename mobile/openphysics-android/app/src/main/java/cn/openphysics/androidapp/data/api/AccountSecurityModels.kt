package cn.openphysics.androidapp.data.api

import cn.openphysics.androidapp.domain.StudentSession
import org.json.JSONObject

data class AccountSettings(
    val username: String,
    val maskedPhone: String,
    val hasPassword: Boolean,
    val changeLimit: Int,
    val changeWindowDays: Int,
    val changesRemaining: Int,
    val nextChangeAt: String,
)

data class AccountSecurityResult(
    val sent: Boolean = false,
    val verified: Boolean = false,
    val retryAfterSeconds: Int = 60,
    val session: StudentSession? = null,
    val settings: AccountSettings? = null,
)

val SecurityAction.renewsAccount: Boolean
    get() = this == SecurityAction.Credentials

internal fun parseAccountSettings(json: JSONObject): AccountSettings {
    fun optional(name: String) = if (json.isNull(name)) "" else json.optString(name, "")
    val limit = json.getInt("username_change_limit")
    val remaining = json.getInt("username_changes_remaining")
    val days = json.getInt("username_change_window_days")
    require(limit >= 0 && remaining in 0..limit && days > 0) { "账号设置返回异常，请重新登录核对" }
    return AccountSettings(json.getString("username"), optional("masked_phone"), json.getBoolean("has_password"),
        limit, days, remaining, optional("username_next_change_at"))
}

internal fun parseAccountSecurityResult(action: SecurityAction, json: JSONObject, owner: StudentSession): AccountSecurityResult {
    if (action.renewsAccount) {
        require(json.getBoolean("changed")) { "无法确认保存结果，请重新登录核对" }
        val token = json.getString("access_token")
        val student = json.getJSONObject("student")
        require(token.isNotBlank() && token != owner.token && student.getString("id") == owner.studentId) { "登录状态未能续接" }
        val session = parseStudentSession(student, token)
        val settings = parseAccountSettings(json.getJSONObject("settings"))
        require(session.accountStatus == "active" && session.username == settings.username) { "账号设置返回异常" }
        return AccountSecurityResult(session = session, settings = settings)
    }
    error("不支持的账号操作")
}
