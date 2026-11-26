package cn.openphysics.androidapp.ui

import cn.openphysics.androidapp.domain.PracticeOption
import cn.openphysics.androidapp.domain.LocalImageFile
import cn.openphysics.androidapp.domain.PracticeQuestion
import cn.openphysics.androidapp.domain.PracticeSelfReviewDraft
import cn.openphysics.androidapp.domain.PracticeSelfReviewItem
import cn.openphysics.androidapp.domain.QuestionImage
import cn.openphysics.androidapp.domain.SubmitResult
import cn.openphysics.androidapp.data.api.PracticeSubmissionApi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PracticeSubmissionDispatcherTest {
    @Test
    fun `all question submission methods retain owning teacher paper attempt on retry`() {
        val api = RecordingPracticeSubmissionApi()
        val attempts = listOf(
            PracticeSubmission(choiceQuestion("choice"), "A", teacherPaperAttemptId = "attempt-1"),
            PracticeSubmission(problemQuestion("photo"), "", photo = photoDraft(), teacherPaperAttemptId = "attempt-1"),
            PracticeSubmission(problemQuestion("self"), "", selfReview = PracticeSelfReviewDraft(listOf(PracticeSelfReviewItem("1", "correct")), 0L), teacherPaperAttemptId = "attempt-1"),
            PracticeSubmission(problemQuestion("blank"), "", teacherPaperAttemptId = "attempt-1"),
        )
        repeat(2) { submitAll(api, "token", "student-1", attempts) }
        assertEquals(List(8) { "attempt-1" }, api.teacherPaperAttemptIds)
        assertEquals(api.submissionIds.take(4), api.submissionIds.drop(4))
    }

    @Test
    fun `submits full set with choice answer and final handwriting image`() {
        val api = RecordingPracticeSubmissionApi()
        val choice = choiceQuestion("q_choice")
        val problem = problemQuestion("q_problem")
        val submissions = listOf(
            PracticeSubmission(question = choice, answer = "B"),
            PracticeSubmission(
                question = problem,
                answer = "[手写作答]",
                handwriting = handwritingDraft(),
            ),
        )

        val results = submitAll(
            api = api,
            token = "token",
            studentId = "student-1",
            submissions = submissions,
        )

        assertEquals(listOf("answer:q_choice:B", "photo:q_problem"), api.calls)
        assertEquals("B", results[0].answer)
        assertEquals("[手写作答]", results[1].answer)
    }

    @Test
    fun `submits correct choice answer without uploading scratch image`() {
        val api = RecordingPracticeSubmissionApi()
        val question = choiceQuestion("q_choice")
        val handwriting = handwritingDraft()

        val results = submitAll(
            api = api,
            token = "token",
            studentId = "student-1",
            submissions = listOf(
                PracticeSubmission(
                    question = question,
                    answer = "B",
                    handwriting = handwriting,
                ),
            ),
        )

        assertEquals(listOf("answer:q_choice:B"), api.calls)
        assertEquals("B", results.single().answer)
        assertTrue(api.scratchImageMimeTypes.isEmpty())
    }

    @Test
    fun `attaches final scratch image for wrong choice answer`() {
        val api = RecordingPracticeSubmissionApi(wrongAnswers = setOf("B"))

        submitAll(
            api = api,
            token = "token",
            studentId = "student-1",
            submissions = listOf(
                PracticeSubmission(
                    question = choiceQuestion("q_choice"),
                    answer = "B",
                    scratchImage = photoDraft(),
                ),
            ),
        )

        assertEquals(listOf("answer:q_choice:B", "process:q_choice:101"), api.calls)
        assertEquals("image/jpeg", api.scratchImageMimeTypes.single())
    }

    @Test
    fun `keeps base choice grading when scratch image upload times out`() {
        val api = RecordingPracticeSubmissionApi(failScratchImageUpload = true, wrongAnswers = setOf("A"))
        val question = choiceQuestion("q_choice")

        val results = submitAll(
            api = api,
            token = "token",
            studentId = "student-1",
            submissions = listOf(
                PracticeSubmission(
                    question = question,
                    answer = "A",
                    scratchImage = photoDraft(),
                ),
            ),
        )

        assertEquals(listOf("answer:q_choice:A", "process:q_choice:101"), api.calls)
        assertEquals("answer:q_choice", results.single().result.explanation)
        assertEquals(null, results.single().result.processGrading)
    }

    @Test
    fun `submits self review draft before handwriting or photo grading`() {
        val api = RecordingPracticeSubmissionApi()
        val results = submitAll(
            api = api,
            token = "token",
            studentId = "student-1",
            submissions = listOf(
                PracticeSubmission(
                    question = problemQuestion("q_problem"),
                    answer = "[手写作答]",
                    handwriting = handwritingDraft(),
                    selfReview = PracticeSelfReviewDraft(
                        items = listOf(PracticeSelfReviewItem(label = "整题", status = "partial")),
                    ),
                ),
            ),
        )

        assertEquals(listOf("self-review:q_problem:整题=partial"), api.calls)
        assertEquals("[自评作答]", results.single().answer)
        assertEquals("self-review:q_problem", results.single().result.explanation)
    }

    @Test
    fun `passes elapsed time to shared text and final image grading`() {
        val api = RecordingPracticeSubmissionApi()

        submitAll(
            api = api,
            token = "token",
            studentId = "student-1",
            submissions = listOf(
                PracticeSubmission(
                    question = problemQuestion("q_text"),
                    answer = "文字答案",
                    timeSpentMs = 1200L,
                ),
                PracticeSubmission(
                    question = problemQuestion("q_handwriting"),
                    answer = "[手写作答]",
                    handwriting = handwritingDraft(),
                    timeSpentMs = 3400L,
                ),
            ),
        )

        assertEquals(listOf(1200L, 3400L), api.timeSpentCalls)
    }

    @Test
    fun `passes the question target knowledge point through every grading path`() {
        val api = RecordingPracticeSubmissionApi()
        val targetQuestion = problemQuestion("q_target").copy(targetKnowledgePointId = "kp_critical")

        submitAll(
            api = api,
            token = "token",
            studentId = "student-1",
            submissions = listOf(
                PracticeSubmission(question = targetQuestion, answer = "文字答案"),
                PracticeSubmission(question = targetQuestion, answer = "[图片作答]", photo = photoDraft()),
                PracticeSubmission(
                    question = targetQuestion,
                    answer = "[自评作答]",
                    selfReview = PracticeSelfReviewDraft(
                        items = listOf(PracticeSelfReviewItem(label = "整题", status = "partial")),
                    ),
                ),
            ),
        )

        assertEquals(listOf("kp_critical", "kp_critical", "kp_critical"), api.targetKnowledgePointIds)
    }

    @Test
    fun `reuses the submission id when the same submission is retried`() {
        val api = RecordingPracticeSubmissionApi()
        val submission = PracticeSubmission(
            question = problemQuestion("q_retry"),
            answer = "答案",
            submissionId = "submission-q-retry",
        )

        repeat(2) {
            PracticeSubmissionDispatcher.submitOne(api, "token", "student-1", submission)
        }

        assertEquals(listOf("submission-q-retry", "submission-q-retry"), api.submissionIds)
    }

    @Test
    fun `batch runner preserves successful outcomes when one submission fails`() {
        val submissions = listOf("q_1", "q_2", "q_3").map { id ->
            PracticeSubmission(question = problemQuestion(id), answer = "答案-$id")
        }
        val completed = mutableListOf<String>()

        val batch = PracticeSubmissionBatchRunner.submitConcurrently(
            submissions = submissions,
            concurrency = 3,
            submit = { submission ->
                if (submission.question.id == "q_2") throw java.net.SocketTimeoutException("timeout")
                PracticeSubmissionOutcome(
                    submission = submission,
                    answer = submission.answer,
                    result = SubmitResult(
                        answerId = 1,
                        correct = true,
                        correctAnswer = "答案",
                        explanation = "解析",
                        aiFeedback = "",
                    ),
                )
            },
            onSuccess = { outcome -> synchronized(completed) { completed += outcome.submission.question.id } },
        )

        assertEquals(setOf("q_1", "q_3"), batch.outcomes.map { it.submission.question.id }.toSet())
        assertEquals(listOf("q_2"), batch.failures.map { it.submission.question.id })
        assertEquals(setOf("q_1", "q_3"), completed.toSet())
    }

    @Test
    fun `passes elapsed time to scratch image process evidence`() {
        val api = RecordingPracticeSubmissionApi(wrongAnswers = setOf("A"))

        submitAll(
            api = api,
            token = "token",
            studentId = "student-1",
            submissions = listOf(
                PracticeSubmission(
                    question = choiceQuestion("q_choice"),
                    answer = "A",
                    scratchImage = photoDraft(),
                    timeSpentMs = 2200L,
                ),
            ),
        )

        assertEquals(listOf(2200L, 2200L), api.timeSpentCalls)
    }

    @Test
    fun `practice question elapsed time matches web question timer behavior`() {
        assertEquals(4500L, practiceQuestionElapsedMs(startedAtMs = 1_000L, nowMs = 5_500L))
        assertEquals(0L, practiceQuestionElapsedMs(startedAtMs = 5_500L, nowMs = 1_000L))
    }

    @Test
    fun `does not call handwriting trace grading for written drafts`() {
        val api = RecordingPracticeSubmissionApi()

        submitAll(
            api = api,
            token = "token",
            studentId = "student-1",
            submissions = listOf(
                PracticeSubmission(
                    question = problemQuestion("q_handwriting"),
                    answer = "[手写作答]",
                    handwriting = handwritingDraft(),
                    timeSpentMs = 3400L,
                ),
            ),
        )

        assertEquals(listOf("photo:q_handwriting"), api.calls)
    }


    @Test
    fun `handwriting draft stores only final image contract`() {
        val draft = handwritingDraft()

        assertEquals("image/jpeg", draft.mimeType)
        assertEquals("010203", draft.contentHash)
    }

    private fun submitAll(
        api: PracticeSubmissionApi,
        token: String,
        studentId: String,
        submissions: List<PracticeSubmission>,
    ): List<PracticeSubmissionOutcome> {
        return submissions.map { submission ->
            PracticeSubmissionDispatcher.submitOne(api, token, studentId, submission)
        }
    }

    private fun choiceQuestion(id: String) = PracticeQuestion(
        id = id,
        stem = "选择题",
        questionType = "single_choice",
        options = listOf(PracticeOption("A", "选项A"), PracticeOption("B", "选项B")),
        images = emptyList<QuestionImage>(),
    )

    private fun problemQuestion(id: String) = PracticeQuestion(
        id = id,
        stem = "解答题",
        questionType = "problem_solving",
        options = emptyList(),
        images = emptyList<QuestionImage>(),
    )

    private fun handwritingDraft() = PracticeHandwritingDraft(
        path = "/tmp/010203.img",
        mimeType = "image/jpeg",
        fileName = "handwriting.jpg",
        contentHash = "010203",
        sizeBytes = 3L,
    )

    private fun photoDraft() = PracticePhotoDraft(
        path = "/tmp/010203.img",
        mimeType = "image/jpeg",
        fileName = "answer.jpg",
        contentHash = "010203",
        sizeBytes = 3L,
    )
}

internal class RecordingPracticeSubmissionApi(
    private val failScratchImageUpload: Boolean = false,
    private val wrongAnswers: Set<String> = emptySet(),
) : PracticeSubmissionApi {
    val calls = mutableListOf<String>()
    val timeSpentCalls = mutableListOf<Long>()
    val scratchImageMimeTypes = mutableListOf<String>()
    val submissionIds = mutableListOf<String>()
    val targetKnowledgePointIds = mutableListOf<String?>()
    val teacherPaperAttemptIds = mutableListOf<String?>()

    override fun submitAnswer(
        token: String,
        studentId: String,
        questionId: String,
        answer: String,
        timeSpentMs: Long,
        targetKnowledgePointId: String?,
        submissionId: String,
        teacherPaperAttemptId: String?,
        topicContext: String?,
    ): SubmitResult {
        calls.add("answer:$questionId:$answer")
        timeSpentCalls.add(timeSpentMs)
        submissionIds.add(submissionId)
        targetKnowledgePointIds.add(targetKnowledgePointId)
        teacherPaperAttemptIds.add(teacherPaperAttemptId)
        return result(
            answerId = 101,
            explanation = "answer:$questionId",
            extractedAnswer = answer,
            correct = !wrongAnswers.contains(answer),
        )
    }

    override fun submitPhotoAnswer(
        token: String,
        studentId: String,
        questionId: String,
        image: LocalImageFile,
        timeSpentMs: Long,
        targetKnowledgePointId: String?,
        submissionId: String,
        teacherPaperAttemptId: String?,
        topicContext: String?,
    ): SubmitResult {
        calls.add("photo:$questionId")
        timeSpentCalls.add(timeSpentMs)
        submissionIds.add(submissionId)
        targetKnowledgePointIds.add(targetKnowledgePointId)
        teacherPaperAttemptIds.add(teacherPaperAttemptId)
        return result(answerId = 102, explanation = "photo:$questionId")
    }

    override fun submitScratchImage(
        token: String,
        studentId: String,
        questionId: String,
        answerId: Int,
        image: LocalImageFile,
        timeSpentMs: Long,
    ): SubmitResult {
        calls.add("process:$questionId:$answerId")
        if (failScratchImageUpload) {
            throw java.net.SocketTimeoutException("timeout")
        }
        timeSpentCalls.add(timeSpentMs)
        scratchImageMimeTypes.add(image.mimeType)
        return result(answerId = answerId, explanation = "process:$questionId")
    }

    override fun submitSelfReview(
        token: String,
        studentId: String,
        questionId: String,
        items: List<PracticeSelfReviewItem>,
        timeSpentMs: Long,
        targetKnowledgePointId: String?,
        submissionId: String,
        teacherPaperAttemptId: String?,
        topicContext: String?,
    ): SubmitResult {
        calls.add("self-review:$questionId:${items.joinToString { "${it.label}=${it.status}" }}")
        submissionIds.add(submissionId)
        targetKnowledgePointIds.add(targetKnowledgePointId)
        teacherPaperAttemptIds.add(teacherPaperAttemptId)
        return result(answerId = 104, explanation = "self-review:$questionId", extractedAnswer = "[自评作答]")
    }

    private fun result(
        answerId: Int,
        explanation: String,
        extractedAnswer: String = "",
        correct: Boolean = true,
    ) = SubmitResult(
        answerId = answerId,
        correct = correct,
        correctAnswer = "A",
        explanation = explanation,
        aiFeedback = "",
        extractedAnswer = extractedAnswer,
    )
}
