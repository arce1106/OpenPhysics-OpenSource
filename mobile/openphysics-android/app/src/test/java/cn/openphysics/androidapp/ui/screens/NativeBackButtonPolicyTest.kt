package cn.openphysics.androidapp.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Test

class NativeBackButtonPolicyTest {
    @Test
    fun `android return controls use shared circular chevron button style`() {
        val policy = androidNativeBackButtonPolicy()

        assertEquals("chevron", policy.icon)
        assertEquals("circle", policy.shape)
        assertEquals(false, policy.usesTextLabel)
        assertEquals(48, policy.defaultSizeDp)
        assertEquals(36, policy.visibleSizeDp)
    }
}
