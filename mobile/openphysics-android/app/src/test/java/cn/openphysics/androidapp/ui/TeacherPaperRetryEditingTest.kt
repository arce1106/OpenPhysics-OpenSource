package cn.openphysics.androidapp.ui

import cn.openphysics.androidapp.domain.LocalImageFile
import cn.openphysics.androidapp.domain.PracticeQuestion
import cn.openphysics.androidapp.domain.SubmitResult
import org.junit.Assert.*
import org.junit.Test

class TeacherPaperRetryEditingTest {
    private val questions = (1..4).map {
        PracticeQuestion("q$it", "题目", "problem_solving", emptyList(), emptyList())
    }

    @Test
    fun `failed final question accepts replacement photo and retries without resubmitting three receipts`() {
        val drafts = PracticeAnswerDrafts()
        val review = PracticeReviewState()
        questions.forEach { drafts.set(it.id, "原作答") }
        val submissions = questions.map { drafts.toSubmission(it) }
        drafts.lockForSubmission(questions.map { it.id })
        val batch = PracticeSubmissionBatchRunner.submitConcurrently(
            submissions = submissions,
            concurrency = 2,
            submit = {
                if (it.question.id == "q4") error("AI result format error")
                PracticeSubmissionOutcome(it, it.answer, SubmitResult(
                    it.question.id.last().digitToInt(), true, "答案", "解析", "",
                ))
            },
            onSuccess = { review.record(it.submission.question, it.answer, it.result) },
        )
        drafts.unlockAfterSubmission(questions.map { it.id })
        assertEquals(1, batch.failures.size)
        val firstThree = review.reviewFor(questions).items
        questions.take(3).forEach {
            assertTrue(practiceAnswerEditingLocked("grading", false, review.itemFor(it) != null))
        }
        assertFalse(practiceAnswerEditingLocked("grading", false, review.itemFor(questions.last()) != null))
        val previousSubmissionId = drafts.submissionId("q4")
        drafts.setPhoto("q4", LocalImageFile("/qa/retaken.jpg", "image/jpeg", "retaken.jpg", "new-image", 10L))
        assertNotEquals(previousSubmissionId, drafts.submissionId("q4"))
        assertEquals(listOf("q4"), review.pendingQuestions(questions).map { it.id })
        assertEquals(3, teacherPaperResumeIndex(questions, review.reviewFor(questions), null))
        assertEquals(3, teacherPaperResumeIndex(questions, review.reviewFor(questions), 0))
        val api = RecordingPracticeSubmissionApi()
        review.pendingQuestions(questions).forEach {
            val outcome = PracticeSubmissionDispatcher.submitOne(api, "qa-token", "qa-student",
                drafts.toSubmission(it).copy(teacherPaperAttemptId = "same-attempt"))
            review.record(it, outcome.answer, outcome.result)
        }
        assertEquals(firstThree, review.reviewFor(questions).items.take(3))
        assertEquals(4, review.reviewFor(questions).items.size)
        assertEquals(1, api.calls.size)
        assertTrue(api.calls.single().startsWith("photo:q4"))
        assertEquals(listOf("same-attempt"), api.teacherPaperAttemptIds)
    }

    @Test
    fun `active submissions and completed papers stay locked while ordinary practice is unchanged`() {
        assertTrue(practiceAnswerEditingLocked("grading", true, false))
        assertTrue(practiceAnswerEditingLocked("completed", false, false))
        assertFalse(practiceAnswerEditingLocked("in_progress", false, false))
        assertFalse(practiceAnswerEditingLocked(null, false, true))
    }
}
