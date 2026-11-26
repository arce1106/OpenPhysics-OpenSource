package cn.openphysics.androidapp.ui.draft

import org.junit.Assert.assertEquals
import org.junit.Test

class DraftCanvasPanelTest {
    @Test
    fun `below canvas web actions remain visible when save action is hidden`() {
        val policy = draftCanvasBelowActionsPolicy(
            showSaveBelowCanvas = false,
            hasSaveAction = false,
            hasCustomActions = true,
        )

        assertEquals(true, policy.showActionRow)
        assertEquals(false, policy.showSaveAction)
    }

    @Test
    fun `below canvas save action still shows when enabled`() {
        val policy = draftCanvasBelowActionsPolicy(
            showSaveBelowCanvas = true,
            hasSaveAction = true,
            hasCustomActions = false,
        )

        assertEquals(true, policy.showActionRow)
        assertEquals(true, policy.showSaveAction)
    }

    @Test
    fun `below canvas row is hidden without save or custom actions`() {
        val policy = draftCanvasBelowActionsPolicy(
            showSaveBelowCanvas = false,
            hasSaveAction = false,
            hasCustomActions = false,
        )

        assertEquals(false, policy.showActionRow)
        assertEquals(false, policy.showSaveAction)
    }
}
