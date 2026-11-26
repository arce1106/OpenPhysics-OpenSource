package cn.openphysics.androidapp.data.api

import cn.openphysics.androidapp.domain.StudentSession
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AccountSecurityModelsTest {
    private val owner = StudentSession(token = "qa-old-token", studentId = "qa-id", username = "qa-user", displayName = "")
    private fun settings() = JSONObject("""{"username":"qa-user","has_password":true,"masked_phone":null,"username_change_limit":3,"username_change_window_days":365,"username_changes_remaining":2,"username_next_change_at":null}""")
    private fun response() = JSONObject().put("changed", true).put("access_token", "qa-new-token")
        .put("student", JSONObject("""{"id":"qa-id","username":"qa-user","status":"active"}"""))
        .put("settings", settings())

    @Test fun parsesServerQuotaAndNullablePhone() {
        val value = parseAccountSettings(settings())
        assertEquals("", value.maskedPhone); assertEquals(2, value.changesRemaining); assertEquals(365, value.changeWindowDays)
        assertThrows(IllegalArgumentException::class.java) { parseAccountSettings(settings().put("username_changes_remaining", 4)) }
    }
    @Test fun allMutationsRequireRenewedSameAccountSession() {
        for (action in listOf(SecurityAction.Credentials)) {
            val result = parseAccountSecurityResult(action, response(), owner)
            assertEquals("qa-new-token", result.session!!.token)
            assertEquals(owner.studentId, result.session!!.studentId)
            assertTrue(result.session!!.accountStatus == "active")
            assertEquals(2, result.settings!!.changesRemaining)
        }
    }
    @Test fun refusesMissingOrReusedTokenAndFalseSuccess() {
        assertThrows(Exception::class.java) { parseAccountSecurityResult(SecurityAction.Credentials, JSONObject("""{"changed":true}"""), owner) }
        assertThrows(IllegalArgumentException::class.java) { parseAccountSecurityResult(SecurityAction.Credentials, response().put("access_token", owner.token), owner) }
        assertThrows(IllegalArgumentException::class.java) { parseAccountSecurityResult(SecurityAction.Credentials, response().put("changed", false), owner) }
    }
    @Test fun refusesDifferentAccountInactiveAccountAndMismatchedSettings() {
        for (student in listOf("""{"id":"other","username":"qa-user"}""", """{"id":"qa-id","username":"qa-user","status":"disabled"}""", """{"id":"qa-id","username":"other"}""")) {
            assertThrows(IllegalArgumentException::class.java) { parseAccountSecurityResult(SecurityAction.Credentials, response().put("student", JSONObject(student)), owner) }
        }
    }

    @Test fun credentialPayloadOmitsBlankLegacyProofAndUsesBooleanRenewal() {
        val payload = securityPayload(SecurityAction.Credentials, mapOf("username" to "new_user", "new_password" to "", "current_password" to "", "code" to "001234"), renewSession = true)
        assertEquals(setOf("username", "renew_session"), payload.keySet())
        assertEquals(true, payload.get("renew_session"))
    }


}
