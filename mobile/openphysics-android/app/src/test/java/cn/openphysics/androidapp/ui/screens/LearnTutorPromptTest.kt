package cn.openphysics.androidapp.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Test

class LearnTutorPromptTest {

    @Test
    fun `learning tutor quick prompts stay focused and useful`() {
        assertEquals(
            listOf(
                "这个知识点怎么理解？",
                "换一种说法讲",
                "问我一道检查题",
                "这个知识点常错在哪？",
            ),
            learnTutorQuickPrompts(),
        )
    }

    @Test
    fun `learning tutor mirrors web floating assistant shell`() {
        val policy = learnTutorAssistantPolicy()

        assertEquals("AI助教", policy.dialogTitle)
        assertEquals("AI助教", policy.triggerLabel)
        assertEquals(true, policy.floatsOverContent)
        assertEquals(true, policy.triggerIsDraggable)
        assertEquals(true, policy.triggerOpensDialog)
        assertEquals(false, policy.triggerSendsPromptImmediately)
        assertEquals(true, policy.quickPromptsUseVerticalPills)
        assertEquals(true, policy.composerPlacesSendInsideInput)
        assertEquals(true, policy.sendUsesIconOnly)
        assertEquals(learnTutorQuickPrompts(), policy.quickPrompts)
        assertEquals("有什么关于这个知识点的问题，都可以问我", policy.placeholder)
        assertEquals("助教正在梳理这个知识点...", policy.loadingText)
    }

    @Test
    fun `learning tutor trigger starts higher and can be dragged near top`() {
        val placement = learnTutorTriggerPlacement()

        assertEquals(-180, placement.initialYOffsetPx)
        assertEquals(-1080, placement.minYOffsetPx)
        assertEquals(24, placement.maxYOffsetPx)
    }



}
