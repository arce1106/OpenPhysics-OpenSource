package cn.openphysics.androidapp.data.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ApiHttpExceptionTest {
    @Test
    fun `account error preserves status and response with a friendly message`() {
        val error = apiHttpException(401, """{"detail":"Student account unavailable"}""")

        assertEquals(401, error.statusCode)
        assertEquals("""{"detail":"Student account unavailable"}""", error.responseBody)
        assertEquals(cn.openphysics.androidapp.domain.StudentAccessPolicy.accountRequiredMessage(), error.message)
    }


    @Test
    fun `http error keeps a useful fallback for an empty response`() {
        val error = apiHttpException(503, "")

        assertEquals(503, error.statusCode)
        assertEquals("API error: 503", error.message)
    }

    @Test
    fun `only authenticated unauthorized response reports rejected token`() {
        var rejectedToken: String? = null

        notifyUnauthorized(401, "expired-token") { rejectedToken = it }
        assertEquals("expired-token", rejectedToken)

        rejectedToken = null
        notifyUnauthorized(401, null) { rejectedToken = it }
        notifyUnauthorized(503, "active-token") { rejectedToken = it }
        assertNull(rejectedToken)
    }
}
