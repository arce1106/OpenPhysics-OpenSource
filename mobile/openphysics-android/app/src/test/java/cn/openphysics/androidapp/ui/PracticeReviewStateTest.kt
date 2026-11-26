package cn.openphysics.androidapp.ui

import cn.openphysics.androidapp.domain.PracticeOption
import cn.openphysics.androidapp.domain.PracticeQuestion
import cn.openphysics.androidapp.domain.PracticeSession
import cn.openphysics.androidapp.domain.PracticeSessionTypes
import cn.openphysics.androidapp.domain.QuestionImage
import cn.openphysics.androidapp.domain.DiagnosticFeedback
import cn.openphysics.androidapp.domain.SubmitResult
import org.junit.Assert.assertEquals
import org.junit.Test

class PracticeReviewStateTest {
    @Test
    fun storesResultsByQuestionIdAndComputesSummary() {
        val state = PracticeReviewState()
        val q1 = question("q_1")
        val q2 = question("q_2")

        state.record(q1, "A", result(correct = true))
        state.record(q2, "B", result(correct = false))

        val review = state.reviewFor(listOf(q1, q2))

        assertEquals(2, review.items.size)
        assertEquals(1, review.correctCount)
        assertEquals(2, review.totalCount)
        assertEquals("B", review.items[1].answer)
        assertEquals(false, review.items[1].result.correct)
    }

    @Test
    fun clearSessionRemovesOnlyGivenQuestions() {
        val state = PracticeReviewState()
        val q1 = question("q_1")
        val q2 = question("q_2")
        val other = question("q_other")

        state.record(q1, "A", result(correct = true))
        state.record(q2, "B", result(correct = false))
        state.record(other, "C", result(correct = true))

        state.clearSession(listOf(q1, q2))

        assertEquals(0, state.reviewFor(listOf(q1, q2)).items.size)
        assertEquals(1, state.reviewFor(listOf(other)).items.size)
    }

    @Test
    fun reviewCanCarryBackendDiagnosticFeedback() {
        val review = PracticeReview(emptyList()).withDiagnosticFeedback(
            DiagnosticFeedback(
                title = "质点",
                feedback = "后端评估反馈",
                recommendation = "practice",
                correctCount = 2,
                totalCount = 3,
                masteryBefore = 0.2,
                masteryAfter = 0.68,
            ),
        )

        assertEquals("后端评估反馈", review.diagnosticFeedback?.feedback)
        assertEquals("practice", review.diagnosticFeedback?.recommendation)
    }

    @Test
    fun pendingQuestionsExcludeResultsAlreadyConfirmedByServer() {
        val state = PracticeReviewState()
        val completed = question("q_completed")
        val failed = question("q_failed")
        state.record(completed, "A", result(correct = true))

        assertEquals(listOf("q_failed"), state.pendingQuestions(listOf(completed, failed)).map { it.id })

        state.remove(completed.id)
        assertEquals(
            listOf("q_completed", "q_failed"),
            state.pendingQuestions(listOf(completed, failed)).map { it.id },
        )
    }

    @Test
    fun completedSetOpensCurrentQuestionResultBeforeSummary() {
        val q1 = question("q_1")
        val q2 = question("q_2")
        val q3 = question("q_3")
        val review = PracticeReview(
            listOf(
                PracticeReviewItem(q1, "A", result(correct = true)),
                PracticeReviewItem(q2, "B", result(correct = true)),
                PracticeReviewItem(q3, "C", result(correct = false)),
            ),
        )

        assertEquals(2, practiceSetCompletionResultIndex(currentIndex = 2, questions = listOf(q1, q2, q3), review = review))
    }

    @Test
    fun summaryItemOpensMatchingQuestionEvenWhenReviewOrderDiffers() {
        val q1 = question("q_1")
        val q2 = question("q_2")
        val q3 = question("q_3")
        val review = PracticeReview(
            listOf(
                PracticeReviewItem(q3, "C", result(correct = false)),
                PracticeReviewItem(q1, "A", result(correct = true)),
            ),
        )

        assertEquals(
            2,
            practiceReviewQuestionIndex(
                questions = listOf(q1, q2, q3),
                review = review,
                itemIndex = 0,
            ),
        )
        assertEquals(
            0,
            practiceReviewQuestionIndex(
                questions = listOf(q1, q2, q3),
                review = review,
                itemIndex = 1,
            ),
        )
        assertEquals(null, practiceReviewQuestionIndex(listOf(q1, q2, q3), review, itemIndex = 2))
    }

    private fun question(id: String): PracticeQuestion {
        return PracticeQuestion(
            id = id,
            stem = "题干 $id",
            questionType = "single_choice",
            options = listOf(PracticeOption("A", "选项A")),
            images = emptyList<QuestionImage>(),
        )
    }

    private fun result(correct: Boolean): SubmitResult {
        return SubmitResult(
            answerId = 1,
            correct = correct,
            correctAnswer = "A",
            explanation = "解析",
            aiFeedback = "",
        )
    }
}
