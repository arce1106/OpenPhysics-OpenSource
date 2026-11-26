package cn.openphysics.androidapp.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Test

class TabletSidebarStateTest {
    @Test
    fun `launching in portrait collapses it and landscape opens it`() {
        val portrait = TabletSidebarState().afterWidth(narrow = true)
        assertEquals(true, portrait.collapsed)
        assertEquals(false, portrait.afterWidth(narrow = false).collapsed)
    }

    @Test
    fun `rotating an open landscape sidebar to portrait and back restores it`() {
        val landscape = TabletSidebarState().afterWidth(narrow = false)
        assertEquals(false, landscape.collapsed)
        val portrait = landscape.afterWidth(narrow = true)
        assertEquals(true, portrait.collapsed)
        assertEquals(false, portrait.afterWidth(narrow = false).collapsed)
    }

    @Test
    fun `a sidebar the student closed in landscape stays closed after rotating`() {
        val closed = TabletSidebarState().afterWidth(narrow = false).copy(collapsed = true)
        val back = closed.afterWidth(narrow = true).afterWidth(narrow = false)
        assertEquals(true, back.collapsed)
    }

    @Test
    fun `same width keeps whatever the student chose`() {
        val opened = TabletSidebarState().afterWidth(narrow = true).copy(collapsed = false)
        assertEquals(false, opened.afterWidth(narrow = true).collapsed)
    }
}
