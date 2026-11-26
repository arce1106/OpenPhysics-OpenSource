package cn.openphysics.androidapp.ui

import cn.openphysics.androidapp.domain.LocalImageFile
import cn.openphysics.androidapp.domain.PracticeOption
import cn.openphysics.androidapp.domain.PracticeQuestion
import cn.openphysics.androidapp.domain.PracticeSelfReviewDraft
import cn.openphysics.androidapp.domain.PracticeSelfReviewItem
import cn.openphysics.androidapp.ui.draft.DraftCanvasSnapshot
import cn.openphysics.androidapp.ui.draft.DraftPoint
import cn.openphysics.androidapp.ui.draft.DraftStroke
import org.junit.Assert.*
import org.junit.Test

class PracticeHandwritingPreparationTest {
    private fun question(id: String) = PracticeQuestion(id, "实验题", "experiment", emptyList(), emptyList())
    private fun ink(x: Float) = DraftCanvasSnapshot(strokes = listOf(
        DraftStroke(1, -16777216, 2f, listOf(DraftPoint(x, 30f, 1, 1f, 2))),
    ))
    private fun image(id: String) = LocalImageFile("/tmp/$id.jpg", "image/jpeg", "$id.jpg", "a".repeat(64), 10)

    @Test
    fun writingTwoQuestionsThenMovingToChoiceSubmitsBothImagesUnderTheirOwnIds() {
        val drafts = PracticeAnswerDrafts()
        val first = question("experiment-1")
        val second = question("experiment-2")
        val choice = PracticeQuestion("choice", "选择题", "single_choice", listOf(PracticeOption("A", "A")), emptyList())
        val snapshots = mapOf(first.id to ink(10f), second.id to ink(200f))
        drafts.set(choice.id, "A")
        val questions = listOf(first, second, choice)
        assertEquals(3, drafts.answeredCount(questions.map { it.id }, snapshots.keys))
        assertEquals(2, drafts.submissionSourceSummary(questions.map { it.id }, snapshots.keys).handwriting)
        val submissions = questions.map { drafts.toSubmission(it) }
        drafts.lockForSubmission(questions.map { it.id })
        val exports = mutableMapOf<String, Float>()
        val ready = PracticeHandwritingPreparation.prepare(submissions, snapshots) { q, snapshot ->
            exports[q.id] = snapshot.strokes.single().points.single().x
            image(q.id)
        }
        assertEquals(mapOf(first.id to 10f, second.id to 200f), exports)
        ready.forEach { assertTrue(drafts.cachePreparedSubmission(it)) }
        val api = RecordingPracticeSubmissionApi()
        ready.forEach { PracticeSubmissionDispatcher.submitOne(api, "test", "test", it) }
        assertEquals(listOf("photo:experiment-1", "photo:experiment-2", "answer:choice:A"), api.calls)
        assertEquals(submissions.map { it.submissionId }, api.submissionIds)
    }

    @Test
    fun exportFailurePreventsAnyGradingAndRetainsSnapshotsForRetry() {
        val drafts = listOf(PracticeSubmission(question("one"), ""), PracticeSubmission(question("two"), ""))
        val snapshots = mapOf("one" to ink(1f), "two" to ink(2f))
        val api = RecordingPracticeSubmissionApi()
        assertThrows(IllegalStateException::class.java) {
            PracticeHandwritingPreparation.prepare(drafts, snapshots) { q, _ ->
                if (q.id == "two") error("disk full") else image(q.id)
            }.forEach { PracticeSubmissionDispatcher.submitOne(api, "test", "test", it) }
        }
        assertTrue(api.calls.isEmpty())
        val retried = PracticeHandwritingPreparation.prepare(drafts, snapshots) { q, _ -> image(q.id) }
        assertEquals(drafts.map { it.submissionId }, retried.map { it.submissionId })
        assertTrue(retried.all { it.handwriting != null })
    }

    @Test
    fun photosAndSelfReviewsTakePriorityWhileBlankCanvasIsNotExported() {
        val self = PracticeSelfReviewDraft(listOf(PracticeSelfReviewItem("1", "correct")), 0L)
        val drafts = listOf(
            PracticeSubmission(question("photo"), "[图片作答]", photo = image("photo")),
            PracticeSubmission(question("self"), "[自评作答]", selfReview = self),
            PracticeSubmission(question("blank"), ""),
        )
        val ready = PracticeHandwritingPreparation.prepare(drafts,
            mapOf("photo" to ink(1f), "self" to ink(1f), "blank" to DraftCanvasSnapshot())) { _, _ ->
            error("These drafts must not export handwriting")
        }
        assertEquals(drafts, ready)
    }

    @Test
    fun erasedCanvasInvalidatesCachedHandwritingAndItsAnsweredCount() {
        val drafts = PracticeAnswerDrafts()
        drafts.setHandwriting("one", image("one"))
        val oldId = drafts.submissionId("one")
        drafts.invalidateCanvasMedia("one")
        assertNull(drafts.getHandwriting("one"))
        assertFalse(drafts.hasAnswer("one"))
        assertEquals(0, drafts.answeredCount(listOf("one")))
        assertNotEquals(oldId, drafts.submissionId("one"))
        drafts.setPhoto("one", image("photo"))
        drafts.invalidateCanvasMedia("one")
        assertNotNull(drafts.getPhoto("one"))
    }

    @Test
    fun summaryRetryHasNoPendingAnswersAndPreservesExistingReceipts() {
        val review = PracticeReviewState()
        val q = question("one")
        val api = RecordingPracticeSubmissionApi()
        val outcome = PracticeSubmissionDispatcher.submitOne(api, "test", "test",
            PracticeSubmission(q, "[手写作答]", handwriting = image("one")))
        review.record(q, outcome.answer, outcome.result)
        repeat(2) {
            val prepared = PracticeHandwritingPreparation.prepare(
                review.pendingQuestions(listOf(q)).map { PracticeSubmission(it, "") }, mapOf(q.id to ink(1f)),
            ) { _, _ -> error("Already graded") }
            assertTrue(prepared.isEmpty())
            assertEquals(outcome.result.answerId, review.reviewFor(listOf(q)).submittedDiagnosticAnswers().single().answerId)
        }
        assertEquals(listOf("photo:one"), api.calls)
    }
}
