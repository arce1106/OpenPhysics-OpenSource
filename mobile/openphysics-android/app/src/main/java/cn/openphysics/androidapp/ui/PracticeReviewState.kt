package cn.openphysics.androidapp.ui

import cn.openphysics.androidapp.domain.PracticeQuestion
import cn.openphysics.androidapp.domain.PracticeSession
import cn.openphysics.androidapp.domain.PracticeSessionTypes
import cn.openphysics.androidapp.domain.DiagnosticFeedback
import cn.openphysics.androidapp.domain.SubmitResult
import cn.openphysics.androidapp.domain.SubmittedDiagnosticAnswer
import java.util.concurrent.ConcurrentHashMap

data class PracticeReviewItem(
    val question: PracticeQuestion,
    val answer: String,
    val result: SubmitResult,
)

data class PracticeReview(
    val items: List<PracticeReviewItem>,
    val diagnosticFeedback: DiagnosticFeedback? = null,
) {
    val correctCount: Int = items.count { it.result.correct }
    val totalCount: Int = items.size

    fun withDiagnosticFeedback(feedback: DiagnosticFeedback?): PracticeReview {
        return copy(diagnosticFeedback = feedback)
    }

    fun submittedDiagnosticAnswers(): List<SubmittedDiagnosticAnswer> {
        return items.mapNotNull { item ->
            item.result.answerId?.let { answerId ->
                SubmittedDiagnosticAnswer(answerId, item.result.masteryUpdate)
            }
        }
    }

    fun itemFor(question: PracticeQuestion): PracticeReviewItem? {
        return items.firstOrNull { it.question.id == question.id }
    }
}

class PracticeReviewState {
    private val itemsByQuestionId = ConcurrentHashMap<String, PracticeReviewItem>()

    fun record(question: PracticeQuestion, answer: String, result: SubmitResult) {
        itemsByQuestionId[question.id] = PracticeReviewItem(question, answer, result)
    }

    fun reviewFor(questions: List<PracticeQuestion>): PracticeReview {
        return PracticeReview(
            questions.mapNotNull { question -> itemsByQuestionId[question.id] },
        )
    }

    fun itemFor(question: PracticeQuestion): PracticeReviewItem? {
        return itemsByQuestionId[question.id]
    }

    fun pendingQuestions(questions: List<PracticeQuestion>): List<PracticeQuestion> {
        return questions.filterNot { itemsByQuestionId.containsKey(it.id) }
    }

    fun remove(questionId: String) {
        itemsByQuestionId.remove(questionId)
    }

    fun clearSession(questions: List<PracticeQuestion>) {
        questions.forEach { question -> itemsByQuestionId.remove(question.id) }
    }

    fun clearAll() {
        itemsByQuestionId.clear()
    }

    fun completedItems(questions: List<PracticeQuestion>): List<PracticeReviewItem> {
        return questions.mapNotNull { question -> itemsByQuestionId[question.id] }
    }

    fun restore(items: List<PracticeReviewItem>) {
        itemsByQuestionId.clear()
        items.forEach { item -> itemsByQuestionId[item.question.id] = item }
    }
}

fun practiceSetCompletionResultIndex(
    currentIndex: Int,
    questions: List<PracticeQuestion>,
    review: PracticeReview,
): Int? {
    val currentQuestion = questions.getOrNull(currentIndex) ?: return null
    return if (review.itemFor(currentQuestion) != null) currentIndex else null
}

fun practiceReviewQuestionIndex(
    questions: List<PracticeQuestion>,
    review: PracticeReview,
    itemIndex: Int,
): Int? {
    val item = review.items.getOrNull(itemIndex) ?: return null
    return questions.indexOfFirst { it.id == item.question.id }.takeIf { it >= 0 }
}

internal fun teacherPaperReview(practice: cn.openphysics.androidapp.domain.PracticeSession): PracticeReview = PracticeReview(
    practice.questions.mapNotNull { question -> practice.answers[question.id]?.let { result ->
        PracticeReviewItem(question, result.givenAnswer.ifBlank { result.extractedAnswer }, result)
    } },
)

/** A submitted paper may have failed questions that still need a replacement answer. */
internal fun practiceAnswerEditingLocked(
    teacherPaperStatus: String?,
    submitting: Boolean,
    hasSavedResult: Boolean,
): Boolean = submitting || teacherPaperStatus == "completed" ||
    (teacherPaperStatus != null && hasSavedResult)

internal fun teacherPaperResumeIndex(
    questions: List<PracticeQuestion>,
    review: PracticeReview,
    savedIndex: Int?,
): Int = savedIndex?.takeIf { it in questions.indices && review.itemFor(questions[it]) == null }
    ?: questions.indexOfFirst { review.itemFor(it) == null }.coerceAtLeast(0)

/** The first unanswered question from [savedIndex] on; the saved one when all are answered. */
internal fun practiceResumeIndex(questions: List<PracticeQuestion>, completedIds: Set<String>, savedIndex: Int): Int {
    if (questions.isEmpty()) return 0
    val start = savedIndex.coerceIn(questions.indices)
    return (start until questions.size).firstOrNull { questions[it].id !in completedIds }
        ?: questions.indices.firstOrNull { questions[it].id !in completedIds }
        ?: start
}

/** Where a recovered practice reopens. */
internal fun resumedPracticeScreen(snapshot: PracticeRecoverySnapshot): Screen {
    snapshot.reviewRetry?.let { return it }
    val restored = restoredTeacherPaperScreen(snapshot)
    if (restored !is Screen.PracticeQuestionScreen || restored.practice.teacherPaper != null) return restored
    val questions = restored.practice.questions
    val completedIds = snapshot.completedItems.mapTo(HashSet()) { it.question.id }
    if (questions.isNotEmpty() && questions.all { it.id in completedIds }) {
        // Nothing left to answer: reopen the last result, whose next step finishes the practice.
        val item = snapshot.completedItems.firstOrNull { it.question.id == questions.last().id }
        val needsReceipt = restored.practice.sessionType == PracticeSessionTypes.KpDiagnostic &&
            snapshot.completedItems.any { it.result.answerId == null }
        if (item != null && !needsReceipt) return Screen.PracticeResultScreen(
            session = restored.session, data = restored.data, chapter = restored.chapter, kp = restored.kp,
            practice = restored.practice, index = questions.lastIndex, question = item.question,
            answer = item.answer, result = item.result, returnToHome = restored.returnToHome,
            returnToReinforcement = restored.returnToReinforcement, reinforcementContext = restored.reinforcementContext,
            learningCatalogContext = restored.learningCatalogContext,
        )
    }
    return restored.copy(index = practiceResumeIndex(questions, completedIds, restored.index))
}

internal fun restoredTeacherPaperScreen(snapshot: PracticeRecoverySnapshot): Screen {
    val screen = snapshot.screen
    val paper = screen.practice.teacherPaper ?: return screen
    if (paper.attemptId.isBlank()) return screen
    val completed = snapshot.completedItems.associateBy { it.question.id }
    if (screen.practice.questions.any { completed[it.id]?.result?.answerId == null }) return screen
    val practice = screen.practice.copy(
        teacherPaper = paper.copy(status = "completed"),
        answers = completed.mapValues { (_, value) -> value.result.copy(
            givenAnswer = value.answer,
            lessonVideo = (value.result.lessonVideo ?: value.question.lessonVideo)?.copy(available = true, lockedReason = ""),
        ) },
    )
    return Screen.PracticeReviewScreen(
        session = screen.session, data = screen.data, chapter = screen.chapter, kp = screen.kp,
        practice = practice, review = teacherPaperReview(practice),
        learningCatalogContext = screen.learningCatalogContext,
    )
}

internal fun practiceExitNeedsConfirmation(
    practice: cn.openphysics.androidapp.domain.PracticeSession,
    pendingQuestionCount: Int,
): Boolean = pendingQuestionCount > 0 && practice.teacherPaper?.status !in setOf("grading", "completed")
