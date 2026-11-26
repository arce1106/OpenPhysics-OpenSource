package cn.openphysics.androidapp.ui

import cn.openphysics.androidapp.domain.DiagnosticFeedback
import cn.openphysics.androidapp.domain.PracticeOption
import cn.openphysics.androidapp.domain.PracticeQuestion
import cn.openphysics.androidapp.domain.PracticeSession
import cn.openphysics.androidapp.domain.PracticeSessionTypes
import cn.openphysics.androidapp.domain.SubmitResult
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class KpDiagnosticFeedbackRetryTest {
    @Test
    fun `failed summary can be retried without grading the three accepted answers again`() {
        val questions = (1..3).map { number -> question("q_$number") }
        val practice = PracticeSession("掌握评估", questions, PracticeSessionTypes.KpDiagnostic)
        val state = PracticeReviewState()
        questions.forEachIndexed { index, question ->
            state.record(question, "A", result(index + 1))
        }
        val review = state.reviewFor(questions)
        var gradeCalls = 0
        var feedbackCalls = 0

        fun pendingBatch() = PracticeSubmissionBatchRunner.submitConcurrently(
            submissions = state.pendingQuestions(questions).map { PracticeSubmission(it, "A") },
            concurrency = 3,
            submit = { submission ->
                gradeCalls += 1
                PracticeSubmissionOutcome(submission, "A", result(4))
            },
        )

        assertEquals(0, pendingBatch().outcomes.size)
        assertThrows(IOException::class.java) {
            requireKpDiagnosticFeedback(practice, review) {
                feedbackCalls += 1
                throw IOException("反馈服务暂不可用")
            }
        }
        assertEquals(0, pendingBatch().outcomes.size)

        val feedback = DiagnosticFeedback("质点", "进入巩固练习", "practice", 2, 3, 0.2, 0.5)
        assertEquals(feedback, requireKpDiagnosticFeedback(practice, state.reviewFor(questions)) {
            feedbackCalls += 1
            feedback
        })
        assertEquals(0, gradeCalls)
        assertEquals(2, feedbackCalls)
        assertEquals(0, state.pendingQuestions(questions).size)
        assertEquals(emptyList<PracticeQuestion>(), kpQuestionsMissingReceipt(practice, state.reviewFor(questions)))
    }

    @Test
    fun `summary is never requested before every answer has a server receipt`() {
        val questions = (1..3).map { number -> question("q_$number") }
        val practice = PracticeSession("掌握评估", questions, PracticeSessionTypes.KpDiagnostic)
        val review = PracticeReview(questions.mapIndexed { index, question ->
            PracticeReviewItem(question, "A", result(if (index == 2) null else index + 1))
        })
        var feedbackCalls = 0

        assertThrows(IllegalStateException::class.java) {
            requireKpDiagnosticFeedback(practice, review) {
                feedbackCalls += 1
                DiagnosticFeedback("质点", "评估结果", "practice", 2, 3, 0.2, 0.5)
            }
        }
        assertEquals(0, feedbackCalls)
        assertEquals(listOf("q_3"), kpQuestionsMissingReceipt(practice, review).map { it.id })
    }

    @Test
    fun `graded assessment awaiting summary still needs an exit confirmation`() {
        val questions = (1..3).map { number -> question("q_$number") }
        val practice = PracticeSession("掌握评估", questions, PracticeSessionTypes.KpDiagnostic)
        val review = PracticeReview(questions.mapIndexed { index, question ->
            PracticeReviewItem(question, "A", result(index + 1))
        })

        assertTrue(kpAssessmentSummaryPending(practice, review, KpAssessmentProgress.InProgress))
        assertFalse(kpAssessmentSummaryPending(practice, review, KpAssessmentProgress.Completed))
        assertFalse(kpAssessmentSummaryPending(practice, review.copy(items = review.items.dropLast(1)), KpAssessmentProgress.InProgress))
        assertFalse(kpAssessmentSummaryPending(
            practice.copy(sessionType = PracticeSessionTypes.ScopeDiagnostic), review, KpAssessmentProgress.InProgress,
        ))
    }

    private fun question(id: String) = PracticeQuestion(
        id = id, stem = id, questionType = "single_choice",
        options = listOf(PracticeOption("A", "选项 A")), images = emptyList(),
    )

    private fun result(answerId: Int?) = SubmitResult(
        answerId = answerId, correct = true, correctAnswer = "A", explanation = "", aiFeedback = "",
    )
}
