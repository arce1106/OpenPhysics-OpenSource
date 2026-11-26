package cn.openphysics.androidapp.ui

import org.json.JSONObject

/**
 * Student tokens expire a fixed time after they are issued. While the app is in use it trades
 * the current token for a fresh one well before that, so an active student is never signed out
 * mid-practice. Credential changes still revoke tokens on the server.
 */
internal object StudentTokenRenewal {
    /** With 30-day tokens this renews about ten days after sign-in, and old 7-day tokens at once. */
    const val RenewWithinSeconds = 20L * 24L * 60L * 60L
    /** After a failed renewal (offline, older server) wait before trying again. */
    const val RetryAfterFailureMs = 60L * 60L * 1_000L

    fun expiresAtSeconds(token: String): Long? = runCatching {
        val payload = token.split('.').takeIf { it.size == 3 }?.get(1) ?: return null
        val exp = JSONObject(String(decodeBase64Url(payload), Charsets.UTF_8)).optLong("exp", 0L)
        exp.takeIf { it > 0L }
    }.getOrNull()

    fun shouldRenew(token: String, nowSeconds: Long): Boolean {
        val expiresAt = expiresAtSeconds(token) ?: return false
        return expiresAt > nowSeconds && expiresAt - nowSeconds < RenewWithinSeconds
    }

    fun mayRetry(lastFailureMs: Long, nowMs: Long): Boolean =
        lastFailureMs <= 0L || nowMs - lastFailureMs >= RetryAfterFailureMs || nowMs < lastFailureMs

    // java.util.Base64 needs API 26; minSdk is 24.
    private fun decodeBase64Url(value: String): ByteArray {
        val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
        val out = java.io.ByteArrayOutputStream(value.length * 3 / 4)
        var buffer = 0
        var bits = 0
        for (char in value.trimEnd('=')) {
            val digit = alphabet.indexOf(char)
            require(digit >= 0) { "invalid base64url" }
            buffer = (buffer shl 6) or digit
            bits += 6
            if (bits >= 8) {
                bits -= 8
                out.write((buffer shr bits) and 0xFF)
            }
        }
        return out.toByteArray()
    }
}
