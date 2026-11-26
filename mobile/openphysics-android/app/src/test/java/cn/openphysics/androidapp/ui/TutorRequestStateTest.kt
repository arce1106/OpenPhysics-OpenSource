package cn.openphysics.androidapp.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TutorRequestStateTest {
    @Test
    fun `collapsing and reopening the same conversation keeps the pending prompt`() {
        val pending = TutorRequestState(pendingPrompt = "为什么是滑动摩擦？", requestId = 7L)

        assertEquals(pending, pending.forGeneration(7L))
        assertTrue(pending.forGeneration(7L).isLoading)
    }

    @Test
    fun `returning after navigation releases busy state and preserves a retryable prompt`() {
        val pending = TutorRequestState(pendingPrompt = "这个式子怎么来的？", requestId = 7L)
        val restored = pending.forGeneration(8L)

        assertFalse(restored.isLoading)
        assertEquals(pending.pendingPrompt, restored.pendingPrompt)
        assertTrue(restored.error.isNotBlank())
        assertEquals(restored, restored.forGeneration(9L))
    }

    @Test
    fun `request failure preserves the prompt and retry clears the error`() {
        val failed = TutorRequestState(pendingPrompt = "再解释一下", requestId = 3L).failed("网络暂时不可用")

        assertFalse(failed.isLoading)
        assertEquals("再解释一下", failed.pendingPrompt)
        assertEquals("网络暂时不可用", failed.error)
        val retry = TutorRequestState(pendingPrompt = failed.pendingPrompt, requestId = 4L)
        assertTrue(retry.isLoading)
        assertEquals("", retry.error)
    }

    @Test
    fun `completed or idle request is not turned into an interruption by navigation`() {
        val idle = TutorRequestState()

        assertEquals(idle, idle.forGeneration(19L))
        assertFalse(idle.isLoading)
        assertEquals("", idle.pendingPrompt)
        assertEquals("", idle.error)
    }
}
