package cn.openphysics.androidapp.ui.theme

import org.junit.Assert.assertTrue
import org.junit.Test

class MobileDesignTokensTest {
    @Test
    fun `mobile typography follows the OpenPhysics reading scale`() {
        assertTrue(AppTextScale.headlineSmallSp in 20..21)
        assertTrue(AppTextScale.titleLargeSp in 16..17)
        assertTrue(AppTextScale.titleMediumSp in 14..15)
        assertTrue(AppTextScale.bodyMediumSp in 14..15)
        assertTrue(AppTextScale.bodyLineHeightSp in 21..23)
        assertTrue(AppTextScale.labelLargeSp in 14..15)
        assertTrue(AppTextScale.labelMediumSp in 12..13)
    }

    @Test
    fun `mobile layout spacing keeps a clean app rhythm`() {
        assertTrue(AppSpacing.pageHorizontalDp in 14..16)
        assertTrue(AppSpacing.pageTopDp in 14..16)
        assertTrue(AppSpacing.pageGapDp in 10..12)
        assertTrue(AppSpacing.panelPaddingDp in 14..16)
        assertTrue(AppSpacing.panelGapDp in 10..12)
        assertTrue(AppSpacing.actionMinHeightDp in 44..48)
    }

    @Test
    fun `mobile app caps system font scaling for dense physics content`() {
        assertTrue(AppFontScale.maxSystemFontScale <= 1.05f)
        assertTrue(AppFontScale.maxFontScale <= 1.22f)
    }


}
