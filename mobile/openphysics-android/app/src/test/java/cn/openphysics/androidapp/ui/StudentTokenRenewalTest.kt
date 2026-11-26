package cn.openphysics.androidapp.ui

import cn.openphysics.androidapp.data.api.ApiHttpException
import java.io.IOException
import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StudentTokenRenewalTest {
    private fun token(payload: String): String {
        val encoder = Base64.getUrlEncoder().withoutPadding()
        val header = encoder.encodeToString("""{"alg":"HS256","typ":"JWT"}""".toByteArray())
        return "$header.${encoder.encodeToString(payload.toByteArray())}.signature"
    }

    @Test
    fun `reads the expiry of a server token`() {
        assertEquals(1_900_000_000L, StudentTokenRenewal.expiresAtSeconds(token("""{"sub":"学生-1","ver":2,"exp":1900000000}""")))
        assertNull(StudentTokenRenewal.expiresAtSeconds("not-a-token"))
        assertNull(StudentTokenRenewal.expiresAtSeconds(token("""{"sub":"s"}""")))
        assertNull(StudentTokenRenewal.expiresAtSeconds("a.%%%.c"))
    }

    @Test
    fun `renews tokens nearing expiry but not fresh or already expired ones`() {
        val now = 1_800_000_000L
        val day = 86_400L
        assertTrue(StudentTokenRenewal.shouldRenew(token("""{"exp":${now + 6 * day}}"""), now))
        assertTrue(StudentTokenRenewal.shouldRenew(token("""{"exp":${now + 19 * day}}"""), now))
        assertFalse(StudentTokenRenewal.shouldRenew(token("""{"exp":${now + 29 * day}}"""), now))
        assertFalse(StudentTokenRenewal.shouldRenew(token("""{"exp":${now - 1}}"""), now))
        assertFalse(StudentTokenRenewal.shouldRenew("opaque", now))
    }

    @Test
    fun `waits an hour after a failed renewal`() {
        assertTrue(StudentTokenRenewal.mayRetry(0L, 5_000L))
        assertFalse(StudentTokenRenewal.mayRetry(5_000L, 5_000L + 59 * 60_000L))
        assertTrue(StudentTokenRenewal.mayRetry(5_000L, 5_000L + 60 * 60_000L))
        assertTrue(StudentTokenRenewal.mayRetry(5_000L, 1_000L))
    }

    @Test
    fun `captcha failures explain rate limits and network problems`() {
        val limited = ApiHttpException(429, """{"detail":"操作频繁，请稍后重试"}""", "操作频繁，请稍后重试").apply { retryAfterSeconds = 300 }
        assertEquals("图形验证码获取过于频繁，请约 5 分钟后再刷新", captchaLoadFailureMessage(limited))
        val soon = ApiHttpException(429, "", "x").apply { retryAfterSeconds = 20 }
        assertEquals("图形验证码获取过于频繁，请 20 秒后再刷新", captchaLoadFailureMessage(soon))
        assertEquals("网络连接不稳定，图形验证码加载失败，请点击刷新", captchaLoadFailureMessage(IOException("reset")))
        assertEquals("验证码服务暂时不可用，请稍后点击刷新", captchaLoadFailureMessage(ApiHttpException(503, "", "x")))
        assertEquals(CaptchaLoadFailedMessage, captchaLoadFailureMessage(IllegalStateException("bad image")))
        listOf(limited, soon, IOException("reset"), ApiHttpException(503, "", "x"), IllegalStateException()).forEach {
            assertTrue(isCaptchaLoadFailureMessage(captchaLoadFailureMessage(it)))
        }
        assertFalse(isCaptchaLoadFailureMessage("用户名或密码错误"))
    }
}
