package cn.openphysics.androidapp.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Test

class ReviewNotebookDisplayTest {
    @Test
    fun `review tutor quick prompts match web review prompts`() {
        assertEquals(
            listOf("我第一步错在哪？", "为什么这个答案不对？", "给我一道类似题"),
            reviewTutorQuickPrompts(),
        )
    }


    @Test
    fun `review tutor uses the shared draggable assistant template`() {
        val policy = reviewTutorAssistantPolicy()

        assertEquals("AI助教", policy.dialogTitle)
        assertEquals("AI助教", policy.triggerLabel)
        assertEquals(true, policy.floatsOverContent)
        assertEquals(true, policy.triggerIsDraggable)
        assertEquals(true, policy.triggerOpensDialog)
        assertEquals(false, policy.triggerSendsPromptImmediately)
        assertEquals(true, policy.quickPromptsUseVerticalPills)
        assertEquals(true, policy.composerPlacesSendInsideInput)
        assertEquals(true, policy.sendUsesIconOnly)
        assertEquals(reviewTutorQuickPrompts(), policy.quickPrompts)
        assertEquals("有什么关于这道题的问题，都可以问我", policy.placeholder)
        assertEquals("助教正在看这道题...", policy.loadingText)
    }


    @Test
    fun `tablet review notebook starts compact while keeping every mistake reachable`() {
        val policy = reviewNotebookTabletPolicy()

        assertEquals(5, policy.maxMistakesPerGroup)
    }

    @Test
    fun `tablet review notebook mirrors web two column mistake pool layout`() {
        val policy = reviewNotebookTabletWebLayoutPolicy()

        assertEquals("错题本", policy.headerTitle)
        assertEquals("", policy.headerSubtitle)
        assertEquals(true, policy.usesTwoColumnWorkspace)
        assertEquals(listOf("复盘概览", "本轮重点", "复盘流程"), policy.controlPanelSections)
        assertEquals("", policy.poolEyebrow)
        assertEquals("待复盘错题", policy.poolTitle)
    }

    @Test
    fun `review detail primary action starts a variation`() {
        assertEquals("做变式题", reviewDetailPrimaryActionLabel())
    }

    @Test
    fun `review retry keeps backend guidance and supplies a closed loop fallback`() {
        assertEquals("针对受力分析再练一次", reviewRetryGuidanceText("  针对受力分析再练一次  "))
        assertEquals(
            "重新应用同一知识点，答对后才会从待复盘列表移除。",
            reviewRetryGuidanceText(""),
        )
    }

    @Test
    fun `tablet review detail mirrors web single mistake page layout`() {
        val policy = reviewDetailTabletWebLayoutPolicy()

        assertEquals("错题详情", policy.headerTitle)
        assertEquals("", policy.headerSubtitle)
        assertEquals(true, policy.usesSingleQuestionCard)
        assertEquals(false, policy.usesDiagnosisTwoColumnCards)
        assertEquals(listOf("题目", "你的答案", "正确答案", "错因类型", "AI批改依据", "解析"), policy.cardSections)
        assertEquals(listOf("AI 助教", "做变式题"), policy.sideActions)
        assertEquals(false, policy.variantPanelBelowQuestionCard)
        assertEquals(true, policy.retryMessageCardBelowQuestionCard)
    }

    @Test
    fun `review retry submission failures stay on the retry question page`() {
        val policy = reviewRetryPracticePresentationPolicy()

        assertEquals(true, policy.keepsQuestionPageOnSubmitFailure)
    }


    @Test
    fun `review variant practice opens a dedicated question page`() {
        val policy = reviewRetryPracticePresentationPolicy()

        assertEquals(true, policy.opensDedicatedQuestionPage)
        assertEquals(true, policy.usesSharedPracticeQuestionScreen)
        assertEquals(false, policy.rendersInlineBelowReviewCard)
        assertEquals("做变式题", policy.pageTitle)
        assertEquals("提交变式题", policy.submitLabel)
    }
}
