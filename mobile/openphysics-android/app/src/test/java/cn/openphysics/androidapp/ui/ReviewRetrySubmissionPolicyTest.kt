package cn.openphysics.androidapp.ui

import cn.openphysics.androidapp.domain.ReviewCompletion
import cn.openphysics.androidapp.domain.SubmitResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReviewRetrySubmissionPolicyTest {
    @Test
    fun `correct retry clears the original mistake but stays on question result`() {
        val result = correctResult()

        val outcome = resolveReviewRetrySubmission(result) { ReviewCompletion(cleared = true) }

        assertTrue(outcome.result.cleared)
        assertFalse(outcome.shouldReturnToReviewNotebook)
        assertEquals("变式题已通过，原错题已移出待复盘列表。", outcome.message)
    }

    @Test
    fun `wrong retry keeps the mistake pending`() {
        val result = correctResult(correct = false)

        val outcome = resolveReviewRetrySubmission(result) {
            error("wrong answers must not clear the mistake")
        }

        assertFalse(outcome.result.cleared)
        assertFalse(outcome.shouldReturnToReviewNotebook)
        assertEquals("还没有通过。先对照解析找到偏差，再重新完成同类题。", outcome.message)
    }

    @Test
    fun `correct retry keeps graded result when clearing the mistake fails`() {
        val result = correctResult()

        val outcome = resolveReviewRetrySubmission(result) { ReviewCompletion(cleared = false) }

        assertTrue(outcome.result.correct)
        assertFalse(outcome.result.cleared)
        assertFalse(outcome.shouldReturnToReviewNotebook)
        assertEquals("答对了，但错题状态还未清除，请稍后刷新错题复盘页确认。", outcome.message)
    }

    @Test
    fun `correct retry shows why the server kept the mistake open`() {
        val outcome = resolveReviewRetrySubmission(correctResult()) {
            ReviewCompletion(cleared = false, detail = "做对一道这道错题的变式题后，才能完成复盘。")
        }

        assertFalse(outcome.result.cleared)
        assertEquals("答对了，但原错题还未清除：做对一道这道错题的变式题后，才能完成复盘。", outcome.message)
    }

    private fun correctResult(correct: Boolean = true) = SubmitResult(
        answerId = 42,
        correct = correct,
        correctAnswer = "A",
        explanation = "解析",
        aiFeedback = "",
    )
}
