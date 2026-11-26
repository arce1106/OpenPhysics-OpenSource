package cn.openphysics.androidapp.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CommonTextTest {
    @Test
    fun `clean text removes markdown emphasis left by knowledge cards`() {
        val cleaned = cleanText("**核心：** 通过磁通量变化判断方向，`先看变化`。")

        assertEquals("核心： 通过磁通量变化判断方向，先看变化。", cleaned)
    }

    @Test
    fun `compact text keeps phone previews short`() {
        val compacted = compactText("第一步先确定研究对象。第二步判断磁通量如何变化。第三步用楞次定律判断感应电流方向。", 28)

        assertTrue(compacted.length <= 31)
        assertTrue(compacted.endsWith("..."))
        assertFalse(compacted.contains("\n"))
    }
}
