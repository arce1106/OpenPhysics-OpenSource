package cn.openphysics.androidapp.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Test

/** Windows that get the tablet workbench; every other window is presented as a phone. */
class MainLayoutModeTest {
    @Test
    fun `landscape tablets including scaled displays use the workbench`() {
        listOf(1280 to 800, 1180 to 760, 1024 to 552, 960 to 540, 853 to 533, 800 to 500, 720 to 480).forEach { (width, height) ->
            assertEquals("$width x $height", true, supportsTabletWorkbench(width, height))
        }
    }

    @Test
    fun `portrait tablets keep the tablet workbench like iPad`() {
        listOf(800 to 1280, 600 to 960, 834 to 1194, 640 to 800, 719 to 480).forEach { (width, height) ->
            assertEquals("$width x $height", true, supportsTabletWorkbench(width, height))
        }
    }

    @Test
    fun `phone sized windows are presented as phones`() {
        listOf(393 to 851, 851 to 393, 1280 to 450, 599 to 960, 720 to 479).forEach { (width, height) ->
            assertEquals("$width x $height", false, supportsTabletWorkbench(width, height))
        }
    }

    @Test
    fun `sidebar opens over the page below the inline width`() {
        assertEquals(true, tabletSidebarOverlays(800))
        assertEquals(true, tabletSidebarOverlays(959))
        assertEquals(false, tabletSidebarOverlays(960))
        assertEquals(false, tabletSidebarOverlays(1280))
    }
}
