package cn.openphysics.androidapp.data.api

import org.json.JSONObject

data class LoginCredentials(val identifier: String, val secret: String,
    val captchaId: String = "", val captchaAnswer: String = "")

enum class SecurityAction(val path: String, val authenticated: Boolean) {
    Credentials("account-credentials", true),
}
internal fun securityPayload(action: SecurityAction, fields: Map<String, String>, renewSession: Boolean = false): JSONObject {
    require(!fields["username"].isNullOrBlank() || !fields["new_password"].isNullOrBlank()) { "请填写需要修改的内容" }
    val allowed = setOf("username", "new_password", "current_password")
    return JSONObject(fields.filter { it.key in allowed && it.value.isNotBlank() }).apply {
        if (renewSession) put("renew_session", true)
    }
}
data class LoginCaptcha(val id: String, val imageBase64: String)
internal fun loginPath(credentials: LoginCredentials): String = "/auth/login"
internal fun loginPayload(credentials: LoginCredentials): JSONObject = JSONObject().apply {
    put("username", credentials.identifier)
    put("password", credentials.secret)
    if (credentials.captchaId.isNotBlank() && credentials.captchaAnswer.isNotBlank()) {
        put("captcha_id", credentials.captchaId); put("captcha_answer", credentials.captchaAnswer)
    }
}
