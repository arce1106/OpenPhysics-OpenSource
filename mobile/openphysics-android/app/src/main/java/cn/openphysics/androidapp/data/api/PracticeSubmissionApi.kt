package cn.openphysics.androidapp.data.api

import cn.openphysics.androidapp.domain.LocalImageFile
import cn.openphysics.androidapp.domain.PracticeSelfReviewItem
import cn.openphysics.androidapp.domain.SubmitResult

interface PracticeSubmissionApi {
    fun submitAnswer(
        token: String,
        studentId: String,
        questionId: String,
        answer: String,
        timeSpentMs: Long = 0L,
        targetKnowledgePointId: String? = null,
        submissionId: String,
        teacherPaperAttemptId: String? = null,
        topicContext: String? = null,
    ): SubmitResult

    fun submitPhotoAnswer(
        token: String,
        studentId: String,
        questionId: String,
        image: LocalImageFile,
        timeSpentMs: Long = 0L,
        targetKnowledgePointId: String? = null,
        submissionId: String,
        teacherPaperAttemptId: String? = null,
        topicContext: String? = null,
    ): SubmitResult

    fun submitScratchImage(
        token: String,
        studentId: String,
        questionId: String,
        answerId: Int,
        image: LocalImageFile,
        timeSpentMs: Long = 0L,
    ): SubmitResult

    fun submitSelfReview(
        token: String,
        studentId: String,
        questionId: String,
        items: List<PracticeSelfReviewItem>,
        timeSpentMs: Long = 0L,
        targetKnowledgePointId: String? = null,
        submissionId: String,
        teacherPaperAttemptId: String? = null,
        topicContext: String? = null,
    ): SubmitResult
}
