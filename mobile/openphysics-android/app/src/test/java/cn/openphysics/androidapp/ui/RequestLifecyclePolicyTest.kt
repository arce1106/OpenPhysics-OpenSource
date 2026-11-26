package cn.openphysics.androidapp.ui

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RequestLifecyclePolicyTest {
    @Test
    fun `new request invalidates earlier request result`() {
        val generation = RequestGeneration()
        val first = generation.begin()
        val second = generation.begin()

        assertFalse(generation.isCurrent(first))
        assertTrue(generation.isCurrent(second))
    }

    @Test
    fun `navigation invalidation rejects pending result`() {
        val generation = RequestGeneration()
        val pending = generation.begin()

        generation.invalidate()

        assertFalse(generation.isCurrent(pending))
    }

    @Test
    fun `unauthorized response expires only the matching active session`() {
        assertTrue(shouldExpireSessionForUnauthorized("old-token", "old-token"))
        assertFalse(shouldExpireSessionForUnauthorized("old-token", "new-token"))
        assertFalse(shouldExpireSessionForUnauthorized("", ""))
    }
}
