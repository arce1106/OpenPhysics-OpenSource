package cn.openphysics.androidapp.ui

import cn.openphysics.androidapp.data.api.PracticeSubmissionApi
import cn.openphysics.androidapp.domain.PracticeQuestion
import cn.openphysics.androidapp.domain.PracticeSelfReviewDraft
import cn.openphysics.androidapp.domain.SubmitResult
import java.util.UUID
import java.util.concurrent.ExecutorCompletionService
import java.util.concurrent.Executors

data class PracticeSubmission(
    val question: PracticeQuestion,
    val answer: String,
    val handwriting: PracticeHandwritingDraft? = null,
    val photo: PracticePhotoDraft? = null,
    val scratchImage: PracticePhotoDraft? = null,
    val selfReview: PracticeSelfReviewDraft? = null,
    val timeSpentMs: Long = 0L,
    val submissionId: String = UUID.randomUUID().toString(),
    val teacherPaperAttemptId: String? = null,
)

data class PracticeSubmissionOutcome(
    val submission: PracticeSubmission,
    val answer: String,
    val result: SubmitResult,
)

data class PracticeSubmissionFailure(
    val submission: PracticeSubmission,
    val error: Exception,
)

data class PracticeSubmissionBatchResult(
    val outcomes: List<PracticeSubmissionOutcome>,
    val failures: List<PracticeSubmissionFailure>,
)

fun practiceQuestionElapsedMs(startedAtMs: Long, nowMs: Long = System.currentTimeMillis()): Long {
    return (nowMs - startedAtMs).coerceAtLeast(0L)
}

object PracticeSubmissionDispatcher {
    fun submitOne(
        api: PracticeSubmissionApi,
        token: String,
        studentId: String,
        submission: PracticeSubmission,
    ): PracticeSubmissionOutcome {
        val question = submission.question
        val result = when {
            submission.selfReview != null -> api.submitSelfReview(
                token = token,
                studentId = studentId,
                questionId = question.id,
                items = submission.selfReview.items,
                timeSpentMs = submission.selfReview.timeSpentMs,
                targetKnowledgePointId = question.targetKnowledgePointId.ifBlank { null },
                submissionId = submission.submissionId,
                teacherPaperAttemptId = submission.teacherPaperAttemptId,
                topicContext = submission.question.topicContext,
            )
            question.isChoice() -> submitChoice(api, token, studentId, submission)
            submission.handwriting != null -> api.submitPhotoAnswer(
                token = token,
                studentId = studentId,
                questionId = question.id,
                image = submission.handwriting,
                timeSpentMs = submission.timeSpentMs,
                targetKnowledgePointId = question.targetKnowledgePointId.ifBlank { null },
                submissionId = submission.submissionId,
                teacherPaperAttemptId = submission.teacherPaperAttemptId,
                topicContext = submission.question.topicContext,
            )
            submission.photo != null -> api.submitPhotoAnswer(
                token = token,
                studentId = studentId,
                questionId = question.id,
                image = submission.photo,
                timeSpentMs = submission.timeSpentMs,
                targetKnowledgePointId = question.targetKnowledgePointId.ifBlank { null },
                submissionId = submission.submissionId,
                teacherPaperAttemptId = submission.teacherPaperAttemptId,
                topicContext = submission.question.topicContext,
            )
            else -> api.submitAnswer(
                token = token,
                studentId = studentId,
                questionId = question.id,
                answer = submission.answer,
                timeSpentMs = submission.timeSpentMs,
                targetKnowledgePointId = question.targetKnowledgePointId.ifBlank { null },
                submissionId = submission.submissionId,
                teacherPaperAttemptId = submission.teacherPaperAttemptId,
                topicContext = submission.question.topicContext,
            )
        }
        val answer = if (submission.selfReview != null) "[自评作答]" else submission.answer
        return PracticeSubmissionOutcome(submission, answer, result)
    }

    private fun submitChoice(
        api: PracticeSubmissionApi,
        token: String,
        studentId: String,
        submission: PracticeSubmission,
    ): SubmitResult {
        val base = api.submitAnswer(
            token = token,
            studentId = studentId,
            questionId = submission.question.id,
            answer = submission.answer,
            timeSpentMs = submission.timeSpentMs,
            targetKnowledgePointId = submission.question.targetKnowledgePointId.ifBlank { null },
            submissionId = submission.submissionId,
                teacherPaperAttemptId = submission.teacherPaperAttemptId,
                topicContext = submission.question.topicContext,
        )
        if (base.correct) return base
        val scratchImage = submission.scratchImage ?: return base
        val answerId = base.answerId ?: return base
        val scratchResult = runCatching {
            api.submitScratchImage(
                token = token,
                studentId = studentId,
                questionId = submission.question.id,
                answerId = answerId,
                image = scratchImage,
                timeSpentMs = submission.timeSpentMs,
            )
        }.getOrElse {
            return base
        }
        return base.copy(processGrading = scratchResult.processGrading, explanation = scratchResult.explanation.ifBlank { base.explanation })
    }
}

object PracticeSubmissionBatchRunner {
    fun submitConcurrently(
        submissions: List<PracticeSubmission>,
        concurrency: Int,
        submit: (PracticeSubmission) -> PracticeSubmissionOutcome,
        onSuccess: (PracticeSubmissionOutcome) -> Unit = {},
    ): PracticeSubmissionBatchResult {
        if (submissions.isEmpty()) return PracticeSubmissionBatchResult(emptyList(), emptyList())
        val executor = Executors.newFixedThreadPool(concurrency.coerceIn(1, submissions.size))
        val completionService = ExecutorCompletionService<PracticeSubmissionAttempt>(executor)
        return try {
            submissions.forEach { submission ->
                completionService.submit {
                    try {
                        PracticeSubmissionAttempt.Success(submit(submission))
                    } catch (error: Exception) {
                        PracticeSubmissionAttempt.Failure(submission, error)
                    }
                }
            }
            val outcomes = mutableListOf<PracticeSubmissionOutcome>()
            val failures = mutableListOf<PracticeSubmissionFailure>()
            repeat(submissions.size) {
                when (val attempt = completionService.take().get()) {
                    is PracticeSubmissionAttempt.Success -> {
                        outcomes += attempt.outcome
                        onSuccess(attempt.outcome)
                    }
                    is PracticeSubmissionAttempt.Failure -> failures += PracticeSubmissionFailure(
                        submission = attempt.submission,
                        error = attempt.error,
                    )
                }
            }
            PracticeSubmissionBatchResult(outcomes, failures)
        } finally {
            executor.shutdownNow()
        }
    }

    private sealed interface PracticeSubmissionAttempt {
        data class Success(val outcome: PracticeSubmissionOutcome) : PracticeSubmissionAttempt
        data class Failure(val submission: PracticeSubmission, val error: Exception) : PracticeSubmissionAttempt
    }
}
