package cn.openphysics.androidapp.ui

import cn.openphysics.androidapp.data.api.ApiHttpException
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Test

class PracticeSetSubmissionPolicyTest {

    @Test
    fun `practice set grading uses bounded parallelism`() {
        assertEquals(3, practiceSetGradingConcurrencyLimit())
    }

    @Test
    fun `timeout error message is student friendly`() {
        assertEquals(
            "批改时间较长，请稍后重试；已保存的作答不会丢失。",
            practiceFailureMessage(Exception("java.net.SocketTimeoutException: timeout")),
        )
    }

    @Test
    fun `loading timeout message is not grading specific`() {
        assertEquals(
            "加载时间较长，请检查网络后重试。",
            loadFailureMessage(Exception("java.net.SocketTimeoutException: timeout")),
        )
    }

    @Test
    fun `http and network failures have distinct student messages`() {
        assertEquals(
            "登录已失效，请重新登录。",
            loadFailureMessage(ApiHttpException(401, "", "expired")),
        )
        assertEquals(
            "account",
            loadFailureMessage(ApiHttpException(403, "", "account")),
        )
        assertEquals(
            "云端服务暂时不可用，请稍后重试。",
            loadFailureMessage(ApiHttpException(503, "", "unavailable")),
        )
        assertEquals(
            "无法连接云端服务，请检查网络后重试。",
            loadFailureMessage(IOException("offline")),
        )
    }
}
