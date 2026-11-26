package cn.openphysics.androidapp.ui

import androidx.compose.runtime.mutableStateMapOf
import cn.openphysics.androidapp.domain.LocalImageFile
import cn.openphysics.androidapp.domain.PracticeSelfReviewDraft
import cn.openphysics.androidapp.domain.PracticeQuestion
import java.util.UUID

typealias PracticePhotoDraft = LocalImageFile
typealias PracticeHandwritingDraft = LocalImageFile

data class PracticeAnswerDraftSnapshot(
    val questionId: String,
    val answer: String,
    val photo: PracticePhotoDraft? = null,
    val handwriting: PracticeHandwritingDraft? = null,
    val scratchImage: PracticePhotoDraft? = null,
    val selfReview: PracticeSelfReviewDraft? = null,
    val submissionId: String? = null,
)

data class PracticeSubmissionSourceSummary(
    val textOrChoice: Int,
    val photo: Int,
    val handwriting: Int,
    val selfReview: Int,
    val unanswered: Int,
) {
    fun displayText(): String =
        "选择/文字 $textOrChoice · 照片 $photo · 手写 $handwriting · 自评 $selfReview · 未作答 $unanswered"
}

class PracticeAnswerDrafts {
    // Counts, question navigation and the submit dialog read these maps in
    // composition. Notify those readers on save, without requiring a page turn.
    private val answers = mutableStateMapOf<String, String>()
    private val photos = mutableStateMapOf<String, PracticePhotoDraft>()
    private val handwriting = mutableStateMapOf<String, PracticeHandwritingDraft>()
    private val scratchImage = mutableStateMapOf<String, PracticePhotoDraft>()
    private val selfReviews = mutableStateMapOf<String, PracticeSelfReviewDraft>()
    private val submissionIds = mutableMapOf<String, String>()
    private val lockedQuestions = mutableSetOf<String>()

    @Synchronized
    fun lockForSubmission(questionIds: List<String>) {
        lockedQuestions.addAll(questionIds)
    }

    @Synchronized
    fun unlockAfterSubmission(questionIds: List<String>) {
        lockedQuestions.removeAll(questionIds.toSet())
    }

    @Synchronized
    fun isLocked(questionId: String): Boolean = questionId in lockedQuestions

    @Synchronized
    fun isCurrentSubmission(questionId: String, submissionId: String): Boolean =
        submissionIds[questionId] == submissionId

    @Synchronized
    fun referencedMedia(): List<LocalImageFile> = photos.values.toList() + handwriting.values + scratchImage.values

    @Synchronized
    fun clearSubmittedMedia(questionId: String, submissionId: String): List<LocalImageFile> =
        if (isCurrentSubmission(questionId, submissionId)) clearMedia(questionId) else emptyList()

    @Synchronized
    fun get(questionId: String): String = answers[questionId].orEmpty()

    @Synchronized
    fun getPhoto(questionId: String): PracticePhotoDraft? = photos[questionId]

    @Synchronized
    fun getHandwriting(questionId: String): PracticeHandwritingDraft? = handwriting[questionId]

    @Synchronized
    fun getScratchImage(questionId: String): PracticePhotoDraft? = scratchImage[questionId]

    @Synchronized
    fun getSelfReview(questionId: String): PracticeSelfReviewDraft? = selfReviews[questionId]

    @Synchronized
    fun submissionId(key: String): String = submissionIds.getOrPut(key) { UUID.randomUUID().toString() }

    @Synchronized
    fun hasAnswer(questionId: String, hasCanvasAnswer: Boolean = false): Boolean =
        get(questionId).isNotBlank() || photos.containsKey(questionId) || handwriting.containsKey(questionId) || selfReviews.containsKey(questionId) || hasCanvasAnswer

    @Synchronized
    fun answeredCount(questionIds: List<String>, canvasAnswerIds: Set<String> = emptySet()): Int =
        questionIds.count { hasAnswer(it, it in canvasAnswerIds) }

    @Synchronized
    fun submissionSourceSummary(questionIds: List<String>, canvasAnswerIds: Set<String> = emptySet()): PracticeSubmissionSourceSummary {
        var textOrChoice = 0
        var photoCount = 0
        var handwritingCount = 0
        var selfReviewCount = 0
        var unansweredCount = 0
        questionIds.distinct().forEach { questionId ->
            when {
                selfReviews.containsKey(questionId) || answers[questionId] == "[自评作答]" -> selfReviewCount += 1
                photos.containsKey(questionId) || answers[questionId] == "[图片作答]" -> photoCount += 1
                handwriting.containsKey(questionId) || answers[questionId] == "[手写作答]" || questionId in canvasAnswerIds -> handwritingCount += 1
                answers[questionId].orEmpty().isNotBlank() -> textOrChoice += 1
                else -> unansweredCount += 1
            }
        }
        return PracticeSubmissionSourceSummary(
            textOrChoice = textOrChoice,
            photo = photoCount,
            handwriting = handwritingCount,
            selfReview = selfReviewCount,
            unanswered = unansweredCount,
        )
    }

    @Synchronized
    fun set(questionId: String, answer: String) {
        if (isLocked(questionId)) return
        val trimmed = answer.trim()
        if (answers[questionId].orEmpty() != trimmed) submissionIds.remove(questionId)
        if (trimmed.isBlank()) {
            answers.remove(questionId)
        } else {
            answers[questionId] = trimmed
        }
    }

    @Synchronized
    fun setPhoto(questionId: String, image: PracticePhotoDraft) {
        if (isLocked(questionId)) return
        val next = image
        val changed = photos[questionId] != next ||
            handwriting.containsKey(questionId) || selfReviews.containsKey(questionId) ||
            answers[questionId] != "[图片作答]"
        if (changed) submissionIds.remove(questionId)
        photos[questionId] = next
        handwriting.remove(questionId)
        scratchImage.remove(questionId)
        selfReviews.remove(questionId)
        answers[questionId] = "[图片作答]"
    }

    /** Clear only this answer photo; in-flight submissions retain their frozen media. */
    @Synchronized
    fun removePhoto(questionId: String): PracticePhotoDraft? {
        if (isLocked(questionId)) return null
        val photo = photos.remove(questionId) ?: return null
        submissionIds.remove(questionId)
        if (answers[questionId] == "[图片作答]") answers.remove(questionId)
        return photo
    }

    @Synchronized
    fun setHandwriting(questionId: String, image: PracticeHandwritingDraft) {
        if (isLocked(questionId)) return
        val next = image
        val changed = handwriting[questionId] != next ||
            photos.containsKey(questionId) || selfReviews.containsKey(questionId) ||
            answers[questionId] != "[手写作答]"
        if (changed) submissionIds.remove(questionId)
        handwriting[questionId] = next
        photos.remove(questionId)
        scratchImage.remove(questionId)
        selfReviews.remove(questionId)
        answers[questionId] = "[手写作答]"
    }

    @Synchronized
    fun setSelfReview(questionId: String, draft: PracticeSelfReviewDraft) {
        if (isLocked(questionId)) return
        val changed = selfReviews[questionId]?.items != draft.items ||
            photos.containsKey(questionId) || handwriting.containsKey(questionId) ||
            answers[questionId] != "[自评作答]"
        if (changed) submissionIds.remove(questionId)
        selfReviews[questionId] = draft
        photos.remove(questionId)
        handwriting.remove(questionId)
        scratchImage.remove(questionId)
        answers[questionId] = "[自评作答]"
    }

    @Synchronized
    fun setScratchImage(questionId: String, image: PracticePhotoDraft) {
        if (isLocked(questionId)) return
        scratchImage[questionId] = image
    }

    @Synchronized
    fun clearScratchImage(questionId: String) {
        if (isLocked(questionId)) return
        scratchImage.remove(questionId)
    }

    @Synchronized
    fun invalidateCanvasMedia(questionId: String): List<LocalImageFile> {
        if (isLocked(questionId)) return emptyList()
        submissionIds.remove(questionId)
        if (answers[questionId] == "[手写作答]") answers.remove(questionId)
        return listOfNotNull(handwriting.remove(questionId), scratchImage.remove(questionId))
    }

    /** Prepared media keeps the frozen submission ID, including retries after a timeout. */
    @Synchronized
    fun cachePreparedSubmission(submission: PracticeSubmission): Boolean {
        val id = submission.question.id
        if (!isLocked(id) || !isCurrentSubmission(id, submission.submissionId)) return false
        submission.handwriting?.let { handwriting[id] = it }
        submission.scratchImage?.let { scratchImage[id] = it }
        if (submission.answer.isNotBlank()) answers[id] = submission.answer
        return true
    }

    @Synchronized
    fun clearMedia(questionId: String): List<LocalImageFile> = buildList {
        photos.remove(questionId)?.let(::add)
        handwriting.remove(questionId)?.let(::add)
        scratchImage.remove(questionId)?.let(::add)
    }

    @Synchronized
    fun clearSession(questionIds: List<String>) {
        questionIds.forEach {
            answers.remove(it)
            photos.remove(it)
            handwriting.remove(it)
            scratchImage.remove(it)
            selfReviews.remove(it)
            submissionIds.remove(it)
            lockedQuestions.remove(it)
        }
    }

    @Synchronized
    fun clearAll() {
        answers.clear()
        photos.clear()
        handwriting.clear()
        scratchImage.clear()
        selfReviews.clear()
        submissionIds.clear()
        lockedQuestions.clear()
    }

    @Synchronized
    fun snapshots(questionIds: List<String>): List<PracticeAnswerDraftSnapshot> {
        return questionIds.distinct().mapNotNull { questionId ->
            val answer = answers[questionId].orEmpty()
            val photo = photos[questionId]
            val handwritingDraft = handwriting[questionId]
            val scratch = scratchImage[questionId]
            val selfReview = selfReviews[questionId]
            val submissionId = submissionIds[questionId]
            if (
                answer.isBlank() && photo == null && handwritingDraft == null && scratch == null &&
                selfReview == null && submissionId == null
            ) {
                null
            } else {
                PracticeAnswerDraftSnapshot(
                    questionId = questionId,
                    answer = answer,
                    photo = photo,
                    handwriting = handwritingDraft,
                    scratchImage = scratch,
                    selfReview = selfReview,
                    submissionId = submissionId,
                )
            }
        }
    }

    @Synchronized
    fun restore(snapshots: List<PracticeAnswerDraftSnapshot>) {
        clearAll()
        snapshots.forEach { snapshot ->
            when {
                snapshot.selfReview != null -> setSelfReview(snapshot.questionId, snapshot.selfReview)
                snapshot.photo != null -> setPhoto(snapshot.questionId, snapshot.photo)
                snapshot.handwriting != null -> setHandwriting(snapshot.questionId, snapshot.handwriting)
                snapshot.answer.isNotBlank() && snapshot.answer !in RestoredMediaPlaceholders ->
                    set(snapshot.questionId, snapshot.answer)
            }
            snapshot.scratchImage?.let { scratch ->
                setScratchImage(snapshot.questionId, scratch)
            }
            snapshot.submissionId?.takeIf { it.isNotBlank() }?.let { submissionId ->
                submissionIds[snapshot.questionId] = submissionId
            }
        }
    }

    @Synchronized
    fun toSubmission(question: PracticeQuestion, timeSpentMs: Long = 0L): PracticeSubmission {
        return PracticeSubmission(
            question = question,
            answer = get(question.id),
            handwriting = getHandwriting(question.id),
            photo = getPhoto(question.id),
            scratchImage = getScratchImage(question.id),
            selfReview = getSelfReview(question.id),
            timeSpentMs = timeSpentMs,
            submissionId = submissionId(question.id),
        )
    }

    private companion object {
        val RestoredMediaPlaceholders = setOf("[图片作答]", "[手写作答]", "[自评作答]")
    }
}

internal fun unreferencedPracticeMedia(
    candidates: List<LocalImageFile>,
    references: List<LocalImageFile>,
): List<LocalImageFile> {
    val referencedPaths = references.mapTo(mutableSetOf()) { it.path }
    return candidates.distinctBy { it.path }.filterNot { it.path in referencedPaths }
}
