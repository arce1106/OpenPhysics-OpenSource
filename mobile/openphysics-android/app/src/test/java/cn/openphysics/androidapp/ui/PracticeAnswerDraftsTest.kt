package cn.openphysics.androidapp.ui

import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.runtime.snapshots.SnapshotStateObserver
import cn.openphysics.androidapp.domain.PracticeSelfReviewDraft
import cn.openphysics.androidapp.domain.PracticeSelfReviewItem
import cn.openphysics.androidapp.domain.PracticeQuestion
import cn.openphysics.androidapp.domain.LocalImageFile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class PracticeAnswerDraftsTest {
    @Test
    fun removingPhotoReopensOnlyThatQuestionAndInvalidatesItsSubmission() {
        val drafts = PracticeAnswerDrafts()
        val image = testImage(byteArrayOf(1, 2, 3))
        drafts.setPhoto("q1", image)
        drafts.set("q2", "B")
        val oldId = drafts.submissionId("q1")
        assertEquals(image, drafts.removePhoto("q1"))
        assertFalse(drafts.hasAnswer("q1"))
        assertEquals("B", drafts.get("q2"))
        assertEquals(1, drafts.submissionSourceSummary(listOf("q1", "q2")).unanswered)
        assertFalse(drafts.isCurrentSubmission("q1", oldId))
        assertNull(drafts.removePhoto("q2"))
        assertEquals("B", drafts.get("q2"))
    }

    @Test
    fun removingPhotoCannotChangeFrozenSubmission() {
        val drafts = PracticeAnswerDrafts()
        val image = testImage(byteArrayOf(1))
        drafts.setPhoto("q1", image)
        val id = drafts.submissionId("q1")
        drafts.lockForSubmission(listOf("q1"))
        assertNull(drafts.removePhoto("q1"))
        assertEquals(image, drafts.getPhoto("q1"))
        assertEquals(id, drafts.submissionId("q1"))
        assertEquals(1, drafts.answeredCount(listOf("q1")))
    }

    @Test
    fun lastChoiceUpdatesObservedSummaryAndSubmissionWithoutChangingQuestions() {
        val drafts = PracticeAnswerDrafts()
        val ids = listOf("q1", "q2", "q3")
        drafts.set("q1", "A")
        drafts.set("q2", "C")
        Snapshot.sendApplyNotifications()
        val observer = SnapshotStateObserver { it() }
        var changed = false
        observer.start()
        try {
            observer.observeReads(Any(), { _: Any -> changed = true }) {
                assertEquals(2, drafts.answeredCount(ids))
                assertEquals(1, drafts.submissionSourceSummary(ids).unanswered)
            }
            drafts.set("q3", "B")
            Snapshot.sendApplyNotifications()

            assertEquals(true, changed)
            assertEquals(3, drafts.answeredCount(ids))
            assertEquals(0, drafts.submissionSourceSummary(ids).unanswered)
            val lastQuestion = PracticeQuestion("q3", "末题", "single_choice", emptyList(), emptyList())
            assertEquals("B", drafts.toSubmission(lastQuestion).answer)
        } finally {
            observer.stop()
            observer.clear()
        }
    }

    @Test
    fun editingTheSamePhotoNotifiesReadersEvenWhenItsAnswerPlaceholderIsUnchanged() {
        val drafts = PracticeAnswerDrafts()
        val first = testImage(byteArrayOf(1))
        val replacement = testImage(byteArrayOf(2))
        drafts.setPhoto("q1", first)
        Snapshot.sendApplyNotifications()
        val observer = SnapshotStateObserver { it() }
        var changed = false
        observer.start()
        try {
            observer.observeReads(Any(), { _: Any -> changed = true }) {
                assertEquals(first, drafts.getPhoto("q1"))
            }
            drafts.setPhoto("q1", replacement)
            Snapshot.sendApplyNotifications()

            assertEquals(true, changed)
            assertEquals(replacement, drafts.getPhoto("q1"))
            assertEquals(1, drafts.answeredCount(listOf("q1")))
        } finally {
            observer.stop()
            observer.clear()
        }
    }

    @Test
    fun lockedSubmissionRejectsEditsAndLateResultCannotReleaseNewerPhoto() {
        val drafts = PracticeAnswerDrafts()
        val oldPhoto = testImage(byteArrayOf(1, 2))
        val newPhoto = testImage(byteArrayOf(3, 4))
        drafts.setPhoto("q1", oldPhoto)
        val submittedId = drafts.submissionId("q1")
        drafts.lockForSubmission(listOf("q1"))
        drafts.set("q1", "B")
        drafts.setPhoto("q1", newPhoto)
        drafts.setSelfReview("q1", PracticeSelfReviewDraft(listOf(PracticeSelfReviewItem("整题", "correct"))))
        assertEquals(oldPhoto, drafts.getPhoto("q1"))
        assertEquals(submittedId, drafts.submissionId("q1"))

        drafts.unlockAfterSubmission(listOf("q1"))
        drafts.setPhoto("q1", newPhoto)
        assertFalse(drafts.isCurrentSubmission("q1", submittedId))
        assertEquals(emptyList<LocalImageFile>(), drafts.clearSubmittedMedia("q1", submittedId))
        assertEquals(newPhoto, drafts.getPhoto("q1"))
    }

    @Test
    fun sharedPhotoIsKeptForOtherQuestionAndPaperBatchUntilLastReferenceLeaves() {
        val drafts = PracticeAnswerDrafts()
        val image = testImage(byteArrayOf(1, 2, 3))
        drafts.setPhoto("q1", image)
        drafts.setPhoto("q2", image)
        val candidates = drafts.clearSubmittedMedia("q1", drafts.submissionId("q1"))
        assertEquals(emptyList<LocalImageFile>(), unreferencedPracticeMedia(candidates, drafts.referencedMedia()))
        drafts.clearSession(listOf("q2"))
        assertEquals(emptyList<LocalImageFile>(), unreferencedPracticeMedia(candidates, listOf(image)))
        assertEquals(listOf(image), unreferencedPracticeMedia(candidates, emptyList()))
    }

    @Test
    fun storesDraftAnswerByQuestionId() {
        val drafts = PracticeAnswerDrafts()

        drafts.set("q_1", "AC")
        drafts.set("q_2", "文字答案")

        assertEquals("AC", drafts.get("q_1"))
        assertEquals("文字答案", drafts.get("q_2"))
    }


    @Test
    fun clearingSessionRemovesOnlySessionQuestions() {
        val drafts = PracticeAnswerDrafts()
        drafts.set("q_1", "A")
        drafts.set("q_2", "B")
        drafts.set("q_other", "C")

        drafts.clearSession(listOf("q_1", "q_2"))

        assertEquals("", drafts.get("q_1"))
        assertEquals("", drafts.get("q_2"))
        assertEquals("C", drafts.get("q_other"))
    }

    @Test
    fun clearAllRemovesDraftsAndSubmissionIdsBetweenStudents() {
        val drafts = PracticeAnswerDrafts()
        drafts.set("q_1", "A")
        val firstStudentId = drafts.submissionId("q_1")

        drafts.clearAll()

        assertEquals("", drafts.get("q_1"))
        assertFalse(firstStudentId == drafts.submissionId("q_1"))
    }

    @Test
    fun storesPhotoDraftAsAnsweredQuestion() {
        val drafts = PracticeAnswerDrafts()

        drafts.setPhoto("q_photo", testImage(byteArrayOf(1, 2, 3)))

        assertEquals("[图片作答]", drafts.get("q_photo"))
        assertNotNull(drafts.getPhoto("q_photo"))
        assertEquals(1, drafts.answeredCount(listOf("q_photo", "q_empty")))
    }

    @Test
    fun clearingSessionRemovesPhotoDrafts() {
        val drafts = PracticeAnswerDrafts()
        drafts.setPhoto("q_photo", testImage(byteArrayOf(1)))

        drafts.clearSession(listOf("q_photo"))

        assertEquals("", drafts.get("q_photo"))
        assertNull(drafts.getPhoto("q_photo"))
    }

    @Test
    fun storesChoiceScratchImageWithoutReplacingSelectedAnswer() {
        val drafts = PracticeAnswerDrafts()
        drafts.set("q_choice", "B")

        drafts.setScratchImage("q_choice", testImage(byteArrayOf(9)))

        assertEquals("B", drafts.get("q_choice"))
        assertNotNull(drafts.getScratchImage("q_choice"))
        assertEquals(1, drafts.answeredCount(listOf("q_choice")))
    }

    @Test
    fun clearingSessionRemovesPhotoHandwritingScratchAndSelfReviewDrafts() {
        val drafts = PracticeAnswerDrafts()
        drafts.setPhoto("q_photo", testImage(byteArrayOf(1)))
        drafts.setHandwriting("q_handwriting", testImage(byteArrayOf(2)))
        drafts.setScratchImage("q_scratch", testImage(byteArrayOf(3)))
        drafts.setSelfReview(
            "q_review",
            PracticeSelfReviewDraft(items = listOf(PracticeSelfReviewItem(label = "整题", status = "done"))),
        )

        drafts.clearSession(listOf("q_photo", "q_handwriting", "q_scratch", "q_review"))

        assertNull(drafts.getPhoto("q_photo"))
        assertNull(drafts.getHandwriting("q_handwriting"))
        assertNull(drafts.getScratchImage("q_scratch"))
        assertNull(drafts.getSelfReview("q_review"))
        assertEquals(0, drafts.answeredCount(listOf("q_photo", "q_handwriting", "q_scratch", "q_review")))
    }

    @Test
    fun storesSelfReviewDraftAsAnsweredQuestion() {
        val drafts = PracticeAnswerDrafts()

        drafts.setSelfReview(
            "q_problem",
            PracticeSelfReviewDraft(items = listOf(PracticeSelfReviewItem(label = "整题", status = "partial"))),
        )

        assertEquals("[自评作答]", drafts.get("q_problem"))
        assertEquals("partial", drafts.getSelfReview("q_problem")?.items?.single()?.status)
        assertEquals(1, drafts.answeredCount(listOf("q_problem", "q_empty")))

        drafts.clearSession(listOf("q_problem"))

        assertEquals("", drafts.get("q_problem"))
        assertNull(drafts.getSelfReview("q_problem"))
    }

    @Test
    fun buildsSubmissionFromHandwritingDraftWithoutTextAnswer() {
        val drafts = PracticeAnswerDrafts()
        drafts.setHandwriting("q_problem", testImage(byteArrayOf(1, 2, 3), "image/png"))

        val submission = drafts.toSubmission(
            PracticeQuestion(
                id = "q_problem",
                stem = "题干",
                questionType = "problem_solving",
                options = emptyList(),
                images = emptyList(),
            ),
        )

        assertEquals("[手写作答]", submission.answer)
        assertNotNull(submission.handwriting)
        assertEquals("image/png", submission.handwriting?.mimeType)
        assertEquals("010203", submission.handwriting?.contentHash)
        assertNull(submission.photo)
        assertNull(submission.selfReview)
    }

    @Test
    fun handwritingDraftModelDoesNotCarryStrokeTraceJson() {
        val fieldNames = PracticeHandwritingDraft::class.java.declaredFields.map { it.name }

        assertFalse(fieldNames.any { it.contains("stroke", ignoreCase = true) })
    }

    @Test
    fun buildsBlankSubmissionForUnansweredQuestionLikeWebDeferredGrading() {
        val drafts = PracticeAnswerDrafts()

        val submission = drafts.toSubmission(
            PracticeQuestion(
                id = "q_blank",
                stem = "题干",
                questionType = "problem_solving",
                options = emptyList(),
                images = emptyList(),
            ),
            timeSpentMs = 4500L,
        )

        assertEquals("", submission.answer)
        assertEquals(4500L, submission.timeSpentMs)
    }

    @Test
    fun submissionIdIsStableForRetryAndChangesAfterAnswerEdit() {
        val drafts = PracticeAnswerDrafts()
        val question = PracticeQuestion(
            id = "q_retry",
            stem = "题干",
            questionType = "problem_solving",
            options = emptyList(),
            images = emptyList(),
        )
        drafts.set(question.id, "第一次答案")

        val first = drafts.toSubmission(question).submissionId
        val retry = drafts.toSubmission(question).submissionId
        drafts.set(question.id, "修改后的答案")
        val edited = drafts.toSubmission(question).submissionId

        assertEquals(first, retry)
        assertFalse(first == edited)
    }

    @Test
    fun submissionIdStaysStableWhenSamePhotoOrSelfReviewIsSavedForRetry() {
        val drafts = PracticeAnswerDrafts()
        val bytes = byteArrayOf(1, 2, 3)
        val image = testImage(bytes)
        drafts.setPhoto("q_photo", image)
        val photoId = drafts.submissionId("q_photo")
        drafts.setPhoto("q_photo", image.copy())
        assertEquals(photoId, drafts.submissionId("q_photo"))

        val items = listOf(PracticeSelfReviewItem(label = "整题", status = "partial"))
        drafts.setSelfReview("q_review", PracticeSelfReviewDraft(items = items, timeSpentMs = 1_000L))
        val selfReviewId = drafts.submissionId("q_review")
        drafts.setSelfReview("q_review", PracticeSelfReviewDraft(items = items, timeSpentMs = 2_000L))
        assertEquals(selfReviewId, drafts.submissionId("q_review"))
    }

    @Test
    fun restoresDraftMediaAndStableSubmissionIdAfterProcessRecreation() {
        val drafts = PracticeAnswerDrafts()

        drafts.restore(
            listOf(
                PracticeAnswerDraftSnapshot(
                    questionId = "q_restore",
                    answer = "[手写作答]",
                    handwriting = testImage(byteArrayOf(4, 5), "image/png"),
                    scratchImage = testImage(byteArrayOf(6)),
                    submissionId = "stable-id",
                ),
            ),
        )

        assertEquals("[手写作答]", drafts.get("q_restore"))
        assertEquals("0405", drafts.getHandwriting("q_restore")?.contentHash)
        assertEquals("06", drafts.getScratchImage("q_restore")?.contentHash)
        assertEquals("stable-id", drafts.submissionId("q_restore"))
    }

    @Test
    fun submissionSourceSummaryCountsEachQuestionOnceAndKeepsRestoredMediaLabels() {
        val drafts = PracticeAnswerDrafts()
        drafts.set("q_text", "B")
        drafts.setPhoto("q_photo", testImage(byteArrayOf(1)))
        drafts.setHandwriting("q_handwriting", testImage(byteArrayOf(2)))
        drafts.setSelfReview(
            "q_review",
            PracticeSelfReviewDraft(listOf(PracticeSelfReviewItem("整题", "done"))),
        )
        drafts.clearMedia("q_photo")
        drafts.clearMedia("q_handwriting")

        val summary = drafts.submissionSourceSummary(
            listOf("q_text", "q_photo", "q_handwriting", "q_review", "q_blank"),
        )

        assertEquals(PracticeSubmissionSourceSummary(1, 1, 1, 1, 1), summary)
        assertEquals("选择/文字 1 · 照片 1 · 手写 1 · 自评 1 · 未作答 1", summary.displayText())
    }

    private fun testImage(bytes: ByteArray, mimeType: String = "image/jpeg"): LocalImageFile {
        val hash = bytes.joinToString("") { "%02x".format(it) }
        return LocalImageFile(
            path = "/tmp/$hash.img",
            mimeType = mimeType,
            fileName = if (mimeType.contains("png")) "answer.png" else "answer.jpg",
            contentHash = hash,
            sizeBytes = bytes.size.toLong(),
        )
    }
}
