package cn.openphysics.androidapp.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Test

class PracticeWrittenAnswerActionsLayoutTest {
    @Test
    fun `tablet written answer actions share one row`() {
        assertEquals(
            PracticeWrittenAnswerActionsLayout.SingleRow,
            practiceWrittenAnswerActionsLayout(
                layoutMode = PracticeLayoutMode.TabletWorkbench,
                isChoiceQuestion = false,
            ),
        )
    }

    @Test
    fun `choice questions do not show written answer actions`() {
        assertEquals(
            PracticeWrittenAnswerActionsLayout.Hidden,
            practiceWrittenAnswerActionsLayout(
                layoutMode = PracticeLayoutMode.TabletWorkbench,
                isChoiceQuestion = true,
            ),
        )
    }
}
