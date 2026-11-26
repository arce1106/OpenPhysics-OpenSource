package cn.openphysics.androidapp.data.api

import org.junit.Assert.*
import org.junit.Test

class AuthContractTest {
    @Test fun `credential setup requires authentication and cannot select another phone or student`() {
        val json = securityPayload(SecurityAction.Credentials, mapOf("username" to "physics_user", "code" to "001234", "new_password" to "test-password", "phone" to "19999990002", "student_id" to "other"))
        assertTrue(SecurityAction.Credentials.authenticated)
        assertEquals("account-credentials", SecurityAction.Credentials.path)
        assertEquals("physics_user", json.getString("username"))
        assertFalse(json.has("phone"))
        assertFalse(json.has("student_id"))
    }


    @Test fun `password login remains compatible and omits unused captcha`() {
        val credentials = LoginCredentials("school-account", "test-password")
        val payload = loginPayload(credentials)
        assertEquals("/auth/login", loginPath(credentials))
        assertEquals("school-account", payload.getString("username"))
        assertEquals("test-password", payload.getString("password"))
        assertFalse(payload.has("phone"))
        assertFalse(payload.has("captcha_id"))
    }


    @Test fun `password login supplies the adaptive challenge without phone proof`() {
        val payload = loginPayload(LoginCredentials("school", "password", "challenge", "ABCD"))
        assertEquals("challenge", payload.getString("captcha_id"))
        assertEquals("ABCD", payload.getString("captcha_answer"))
        assertFalse(payload.has("code"))
    }
}
