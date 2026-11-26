package cn.openphysics.androidapp.ui.theme

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AppFontSizeTest {
    @Test
    fun `default font size follows the standard design scale`() {
        assertEquals(AppFontSize.Standard, AppFontSize.default)
        assertEquals(1.0f, AppFontSize.default.scale)
    }

    @Test
    fun `stored font size keys are parsed safely`() {
        assertEquals(AppFontSize.Compact, AppFontSize.fromKey("compact"))
        assertEquals(AppFontSize.Large, AppFontSize.fromKey("large"))
        assertEquals(AppFontSize.default, AppFontSize.fromKey("missing"))
        assertEquals(AppFontSize.default, AppFontSize.fromKey(null))
    }

    @Test
    fun `font size presets stay within phone layout limits`() {
        assertTrue(AppFontSize.values().all { it.scale in 0.94f..1.22f })
    }
}
