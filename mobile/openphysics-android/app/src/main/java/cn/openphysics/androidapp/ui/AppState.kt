package cn.openphysics.androidapp.ui

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import cn.openphysics.androidapp.BuildConfig
import cn.openphysics.androidapp.data.api.ApiClient
import cn.openphysics.androidapp.data.api.ApiHttpException
import cn.openphysics.androidapp.data.api.LoginCredentials
import cn.openphysics.androidapp.data.api.AccountSecurityResult
import cn.openphysics.androidapp.data.api.SecurityAction
import cn.openphysics.androidapp.data.api.renewsAccount
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import cn.openphysics.androidapp.data.session.ChatHistoryStore
import cn.openphysics.androidapp.data.session.PrivateImageStore
import cn.openphysics.androidapp.data.session.SessionStore
import cn.openphysics.androidapp.domain.ChapterGroup
import cn.openphysics.androidapp.domain.DashboardData
import cn.openphysics.androidapp.domain.ReviewCompletion
import cn.openphysics.androidapp.domain.DailyLearningLoop
import cn.openphysics.androidapp.domain.DailyLearningLoopHistory
import cn.openphysics.androidapp.domain.DiagnosticFeedback
import cn.openphysics.androidapp.domain.DirectoryData
import cn.openphysics.androidapp.domain.TeacherHomework
import cn.openphysics.androidapp.domain.ImprovementPlan
import cn.openphysics.androidapp.domain.ImprovementReport
import cn.openphysics.androidapp.domain.ImprovementReportListResponse
import cn.openphysics.androidapp.domain.ImprovementRetestResult
import cn.openphysics.androidapp.domain.ImprovementTask
import cn.openphysics.androidapp.domain.GrowthReportData
import cn.openphysics.androidapp.domain.KpNode
import cn.openphysics.androidapp.domain.KnowledgeMasteryJudgment
import cn.openphysics.androidapp.domain.LearnBundle
import cn.openphysics.androidapp.domain.LearningTraceResponse
import cn.openphysics.androidapp.domain.LearningCatalogData
import cn.openphysics.androidapp.domain.LearningCatalogNode
import cn.openphysics.androidapp.domain.LearningCatalogTopicLayer
import cn.openphysics.androidapp.domain.LearningCatalogTopicOverview
import cn.openphysics.androidapp.domain.LocalImageFile
import cn.openphysics.androidapp.domain.AnswerHistoryRecord
import cn.openphysics.androidapp.domain.PracticeQuestion
import cn.openphysics.androidapp.domain.PracticeSelfReviewDraft
import cn.openphysics.androidapp.domain.PracticeSelfReviewItem
import cn.openphysics.androidapp.domain.PracticeSession
import cn.openphysics.androidapp.domain.PracticeSessionTypes
import cn.openphysics.androidapp.domain.ReviewData
import cn.openphysics.androidapp.domain.ReviewMistake
import cn.openphysics.androidapp.domain.ScopeDiagnosticAttemptDetail
import cn.openphysics.androidapp.domain.ScopeDiagnosticAttemptListResponse
import cn.openphysics.androidapp.domain.ScopeDiagnosticKpResult
import cn.openphysics.androidapp.domain.ScopeDiagnosticResult
import cn.openphysics.androidapp.domain.StudentAccessPolicy
import cn.openphysics.androidapp.domain.StudentSession
import cn.openphysics.androidapp.domain.SubmitResult
import cn.openphysics.androidapp.domain.TutorChatMessage
import cn.openphysics.androidapp.domain.TrainStartData
import cn.openphysics.androidapp.domain.toCompletionRequest
import cn.openphysics.androidapp.ui.draft.DraftCanvasSnapshot
import cn.openphysics.androidapp.ui.draft.DraftSnapshotExport
import cn.openphysics.androidapp.ui.draft.hasAnswerInk
import cn.openphysics.androidapp.data.api.ResourceUrls
import cn.openphysics.androidapp.ui.screens.HomeTask
import cn.openphysics.androidapp.ui.screens.HomeTaskAction
import cn.openphysics.androidapp.ui.screens.matchingReviewMistakeForHistory
import cn.openphysics.androidapp.ui.screens.PracticeSummaryAction
import cn.openphysics.androidapp.ui.screens.shouldUseConsolidationPractice
import java.io.IOException
import java.net.SocketTimeoutException
import java.security.MessageDigest
import java.util.Collections
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CancellationException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.FutureTask
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

sealed interface Screen {
    data class Login(val message: String = "", val captchaRequired: Boolean = false) : Screen
    data class Home(
        val session: StudentSession,
        val dashboard: DashboardData? = null,
        val dailyLoop: DailyLearningLoop? = null,
        val dailyLoopHistory: DailyLearningLoopHistory? = null,
        val growthReport: GrowthReportData? = null,
        val dashboardLoading: Boolean = false,
        val dashboardError: String = "",
        val teacherHomework: List<TeacherHomework> = emptyList(),
    ) : Screen
    data class Settings(val session: StudentSession) : Screen
    /** Phone-only 学习 root: the three learning entries, as on iOS. */
    data class LearnHub(val session: StudentSession) : Screen
    data class Loading(val title: String, val message: String) : Screen
    data class Error(
        val title: String,
        val message: String,
        val actionLabel: String = "",
        val actionUrl: String = "",
        val unavailableSession: StudentSession? = null,
        /** A failed page load (not a submission) that [AppController.retryFailedLoad] can run again. */
        val retryable: Boolean = false,
    ) : Screen
    data class History(val session: StudentSession, val records: List<AnswerHistoryRecord>) : Screen
    /** 作业记录: every teacher homework, newest first. */
    data class HomeworkHistory(val session: StudentSession, val items: List<TeacherHomework>) : Screen
    data class Review(val session: StudentSession, val data: ReviewData) : Screen
    data class HistoryDetail(
        val session: StudentSession,
        val record: AnswerHistoryRecord,
    ) : Screen
    data class ReviewDetail(
        val session: StudentSession,
        val data: ReviewData,
        val mistake: ReviewMistake,
        val tutorMessages: List<TutorChatMessage> = emptyList(),
        val retryMessage: String = "",
        val tutorRequest: TutorRequestState = TutorRequestState(),
    ) : Screen
    data class ReviewRetryQuestion(
        val session: StudentSession,
        val data: ReviewData,
        val mistake: ReviewMistake,
        val question: PracticeQuestion,
        val title: String = "做变式题",
        val reason: String = "",
        val retryMessage: String = "",
        val retryStartedAtMs: Long = 0L,
    ) : Screen
    data class Directory(
        val session: StudentSession,
        val data: DirectoryData,
        val focusedKpId: String = "",
        val judgmentsByKpId: Map<String, KnowledgeMasteryJudgment> = emptyMap(),
    ) : Screen
    data class GaokaoReview(
        val session: StudentSession,
        val catalog: LearningCatalogData,
        val expandedBlockId: String = "",
        val selectedTopicId: String = "",
        val overview: LearningCatalogTopicOverview? = null,
        val overviewLoading: Boolean = false,
        val message: String = "",
        val evidenceSyncMessage: String = "",
        /** The page is shown before the resumed topic's overview; the UI asks for it once on entry. */
        val autoLoadOverview: Boolean = false,
    ) : Screen
    data class ReinforcementHome(
        val session: StudentSession,
        val data: DirectoryData,
        val trainStart: TrainStartData,
        val latestPlan: ImprovementPlan? = null,
        val latestCompletedReport: ImprovementReport? = null,
        val judgmentsByKpId: Map<String, KnowledgeMasteryJudgment> = emptyMap(),
    ) : Screen
    data class ReinforcementChapterPath(
        val session: StudentSession,
        val data: DirectoryData,
        val trainStart: TrainStartData,
        val volume: String,
        val chapter: String,
        val judgmentsByKpId: Map<String, KnowledgeMasteryJudgment> = emptyMap(),
    ) : Screen
    data class ReinforcementScopeResult(
        val session: StudentSession,
        val data: DirectoryData,
        val result: ScopeDiagnosticResult,
        val plan: ImprovementPlan?,
    ) : Screen
    data class ReinforcementRetestResult(
        val session: StudentSession,
        val data: DirectoryData,
        val result: ImprovementRetestResult,
    ) : Screen
    data class ReinforcementTaskComplete(
        val session: StudentSession,
        val data: DirectoryData,
        val plan: ImprovementPlan,
        val taskId: String,
        val review: PracticeReview,
    ) : Screen
    data class ReinforcementReport(
        val session: StudentSession,
        val data: DirectoryData,
        val report: ImprovementReport,
    ) : Screen
    data class ReinforcementReportHistory(
        val session: StudentSession,
        val data: DirectoryData,
        val reports: ImprovementReportListResponse,
    ) : Screen
    data class ReinforcementDiagnosticHistory(
        val session: StudentSession,
        val data: DirectoryData,
        val attempts: ScopeDiagnosticAttemptListResponse,
    ) : Screen
    data class ReinforcementDiagnosticAttemptDetail(
        val session: StudentSession,
        val data: DirectoryData,
        val detail: ScopeDiagnosticAttemptDetail,
    ) : Screen
    data class ReinforcementLearningTrace(
        val session: StudentSession,
        val data: DirectoryData,
        val trace: LearningTraceResponse,
    ) : Screen
    data class Learn(
        val session: StudentSession,
        val data: DirectoryData,
        val chapter: ChapterGroup,
        val kp: KpNode,
        val bundle: LearnBundle,
        val chatMessages: List<TutorChatMessage> = emptyList(),
        val tutorRequest: TutorRequestState = TutorRequestState(),
        val startWithVideo: Boolean = false,
    ) : Screen
    data class PracticeQuestionScreen(
        val session: StudentSession,
        val data: DirectoryData,
        val chapter: ChapterGroup,
        val kp: KpNode,
        val practice: PracticeSession,
        val index: Int,
        val returnToHome: Boolean = false,
        val returnToReinforcement: Boolean = false,
        val reinforcementContext: ReinforcementPracticeContext? = null,
        val learningCatalogContext: LearningCatalogPracticeContext? = null,
        val paperBatchImages: List<PracticePaperBatchImage> = emptyList(),
        val submissionState: PracticeSetSubmissionState = PracticeSetSubmissionState(),
        val questionStartedAtMs: Long = System.currentTimeMillis(),
        val paperBatchSubmission: PracticePaperBatchSubmission? = null,
    ) : Screen
    data class PracticeResultScreen(
        val session: StudentSession,
        val data: DirectoryData,
        val chapter: ChapterGroup,
        val kp: KpNode,
        val practice: PracticeSession,
        val index: Int,
        val question: PracticeQuestion,
        val answer: String,
        val result: SubmitResult,
        val tutorMessages: List<TutorChatMessage> = emptyList(),
        val returnToHome: Boolean = false,
        val returnToReinforcement: Boolean = false,
        val reinforcementContext: ReinforcementPracticeContext? = null,
        val learningCatalogContext: LearningCatalogPracticeContext? = null,
        val reviewRetryMistake: ReviewMistake? = null,
        val reviewRetryMessage: String = "",
        val openedFromSummary: Boolean = false,
        val diagnosticFeedback: DiagnosticFeedback? = null,
        val summaryAutoOpen: Boolean = false,
        val preparedReinforcementCompletion: Screen? = null,
        val tutorRequest: TutorRequestState = TutorRequestState(),
    ) : Screen
    data class PracticeReviewScreen(
        val session: StudentSession,
        val data: DirectoryData,
        val chapter: ChapterGroup,
        val kp: KpNode,
        val practice: PracticeSession,
        val review: PracticeReview,
        val returnToHome: Boolean = false,
        val returnToReinforcement: Boolean = false,
        val reinforcementContext: ReinforcementPracticeContext? = null,
        val learningCatalogContext: LearningCatalogPracticeContext? = null,
        val preparedReinforcementCompletion: Screen? = null,
    ) : Screen
}

internal fun refreshReviewAfterResult(previous: Screen, result: Screen.PracticeResultScreen, review: PracticeReview): Screen {
    if (!result.openedFromSummary || previous !is Screen.PracticeReviewScreen || previous.session.studentId != result.session.studentId ||
        previous.practice.questions.map { it.id } != result.practice.questions.map { it.id } ||
        previous.practice.teacherPaper?.attemptId != result.practice.teacherPaper?.attemptId) return previous
    return previous.copy(practice = result.practice, review = review)
}

internal fun Screen.withStudentSession(session: StudentSession): Screen = when (this) {
    is Screen.Login -> this
    is Screen.Home -> copy(session = session)
    is Screen.Settings -> copy(session = session)
    is Screen.LearnHub -> copy(session = session)
    is Screen.Loading -> this
    is Screen.Error -> copy(unavailableSession = unavailableSession?.let { session })
    is Screen.History -> copy(session = session)
    is Screen.HomeworkHistory -> copy(session = session)
    is Screen.Review -> copy(session = session)
    is Screen.HistoryDetail -> copy(session = session)
    is Screen.ReviewDetail -> copy(session = session)
    is Screen.ReviewRetryQuestion -> copy(session = session)
    is Screen.Directory -> copy(session = session)
    is Screen.GaokaoReview -> copy(session = session)
    is Screen.ReinforcementHome -> copy(session = session)
    is Screen.ReinforcementChapterPath -> copy(session = session)
    is Screen.ReinforcementScopeResult -> copy(session = session)
    is Screen.ReinforcementRetestResult -> copy(session = session)
    is Screen.ReinforcementTaskComplete -> copy(session = session)
    is Screen.ReinforcementReport -> copy(session = session)
    is Screen.ReinforcementReportHistory -> copy(session = session)
    is Screen.ReinforcementDiagnosticHistory -> copy(session = session)
    is Screen.ReinforcementDiagnosticAttemptDetail -> copy(session = session)
    is Screen.ReinforcementLearningTrace -> copy(session = session)
    is Screen.Learn -> copy(session = session)
    is Screen.PracticeQuestionScreen -> copy(session = session)
    is Screen.PracticeResultScreen -> copy(session = session)
    is Screen.PracticeReviewScreen -> copy(session = session)
}

data class LearningCatalogPracticeContext(
    val catalogCode: String,
    val nodeId: String,
    val topicTitle: String,
    val layer: LearningCatalogTopicLayer,

    /** Set for a teacher's homework: the paper flow without a 高考复习 topic behind it. */
    val homeworkAttemptId: String = "",
) {
    val isTeacherHomework: Boolean get() = homeworkAttemptId.isNotBlank()
}

private data class PendingLearningCatalogEvidence(
    val context: LearningCatalogPracticeContext,
    val answerId: Int,
)

sealed interface ReinforcementPracticeContext {
    data class ScopeDiagnostic(
        val scopeType: String,
        val scopeId: String,
        val scopeName: String,
    ) : ReinforcementPracticeContext

    data class TaskPractice(
        val planId: String,
        val taskId: String,
    ) : ReinforcementPracticeContext

    data class Retest(
        val planId: String,
        val attemptId: String,
    ) : ReinforcementPracticeContext
}

enum class PracticeSubmissionPhase { PreparingImages, Grading, Finalizing }

data class PracticeSetSubmissionState(
    val submitting: Boolean = false,
    val error: String = "",
    val completed: Int = 0,
    val total: Int = 0,
    val phase: PracticeSubmissionPhase = PracticeSubmissionPhase.Grading,
)

enum class PracticePostGradingDestination {
    QuestionResult,
    ReinforcementSummary,
    PracticeSummary,
}

internal fun practicePostGradingDestination(
    hasQuestionResult: Boolean,
    reinforcementContext: ReinforcementPracticeContext?,
): PracticePostGradingDestination = when {
    reinforcementContext is ReinforcementPracticeContext.ScopeDiagnostic ||
        reinforcementContext is ReinforcementPracticeContext.Retest -> PracticePostGradingDestination.ReinforcementSummary
    hasQuestionResult -> PracticePostGradingDestination.QuestionResult
    reinforcementContext != null -> PracticePostGradingDestination.ReinforcementSummary
    else -> PracticePostGradingDestination.PracticeSummary
}

internal fun reviewBeforeReinforcementSummary(context: ReinforcementPracticeContext?): Boolean =
    context is ReinforcementPracticeContext.ScopeDiagnostic || context is ReinforcementPracticeContext.Retest

internal fun diagnosticHistoryBackStackIndex(backStack: List<Screen>, studentId: String): Int =
    backStack.indexOfLast { screen ->
        screen is Screen.ReinforcementDiagnosticHistory && screen.session.studentId == studentId
    }

/** A graded KP set stays on its retryable question screen until its summary is available. */
internal fun requireKpDiagnosticFeedback(
    practice: PracticeSession,
    review: PracticeReview,
    fetchFeedback: () -> DiagnosticFeedback?,
): DiagnosticFeedback {
    check(practice.sessionType == PracticeSessionTypes.KpDiagnostic)
    check(practice.questions.isNotEmpty() && practice.questions.all { question ->
        review.itemFor(question)?.result?.answerId != null
    }) { "评估题目尚未全部批改，请重试" }
    return fetchFeedback() ?: error("评估总结暂不可用，请重试")
}

internal fun kpAssessmentSummaryPending(
    practice: PracticeSession,
    review: PracticeReview,
    progress: KpAssessmentProgress?,
): Boolean = practice.sessionType == PracticeSessionTypes.KpDiagnostic &&
    progress != KpAssessmentProgress.Completed && practice.questions.isNotEmpty() &&
    practice.questions.all { question -> review.itemFor(question) != null }

internal fun kpQuestionsMissingReceipt(practice: PracticeSession, review: PracticeReview): List<PracticeQuestion> =
    practice.questions.filter { question -> review.itemFor(question)?.result?.answerId == null }

internal fun improvementPlanMatchesDiagnostic(
    plan: ImprovementPlan?,
    result: ScopeDiagnosticResult,
): Boolean {
    return plan != null &&
        result.diagnosticAttemptId.isNotBlank() &&
        plan.diagnosticAttemptId == result.diagnosticAttemptId
}

private const val PRACTICE_SET_GRADING_CONCURRENCY = 3
private const val GAOKAO_CATALOG_CODE = "gaokao_review"

fun practiceSetGradingConcurrencyLimit(): Int = PRACTICE_SET_GRADING_CONCURRENCY

internal class RequestGeneration {
    private val value = AtomicLong(0L)

    fun current(): Long = value.get()

    fun begin(): Long = value.incrementAndGet()

    fun invalidate() {
        value.incrementAndGet()
    }

    fun isCurrent(generation: Long): Boolean = value.get() == generation
}

internal fun shouldExpireSessionForUnauthorized(rejectedToken: String, activeToken: String?): Boolean =
    rejectedToken.isNotBlank() && rejectedToken == activeToken

internal enum class ApiFailureKind {
    Unauthorized,
    ServiceUnavailable,
    Timeout,
    NetworkUnavailable,
    Other,
}

internal fun apiFailureKind(error: Throwable): ApiFailureKind {
    val raw = error.message.orEmpty()
    return when {
        error is ApiHttpException && error.statusCode == 401 -> ApiFailureKind.Unauthorized
        error is ApiHttpException && error.statusCode >= 500 -> ApiFailureKind.ServiceUnavailable
        error is SocketTimeoutException || raw.contains("SocketTimeoutException") || raw.contains("timeout", ignoreCase = true) -> ApiFailureKind.Timeout
        error is IOException -> ApiFailureKind.NetworkUnavailable
        else -> ApiFailureKind.Other
    }
}

internal fun paperBatchSubmissionKey(
    questionIds: List<String>,
    images: List<PracticePaperBatchImage>,
): String {
    val digest = MessageDigest.getInstance("SHA-256")
    questionIds.forEach { questionId ->
        digest.update(questionId.toByteArray(Charsets.UTF_8))
        digest.update(0)
    }
    images.forEach { image ->
        digest.update(image.fileName.toByteArray(Charsets.UTF_8))
        digest.update(0)
        digest.update(image.mimeType.toByteArray(Charsets.UTF_8))
        digest.update(0)
        digest.update(image.contentHash.toByteArray(Charsets.UTF_8))
        digest.update(0)
    }
    return "paper:" + digest.digest().joinToString("") { byte -> "%02x".format(byte) }
}

data class PracticePaperBatchSubmission(val key: String, val submissionId: String) {
    companion object {
        fun forImages(previous: PracticePaperBatchSubmission?, key: String): PracticePaperBatchSubmission =
            previous?.copy(key = key) ?: PracticePaperBatchSubmission(key, UUID.randomUUID().toString())
    }
}

fun practiceFailureMessage(error: Throwable, fallback: String = "操作失败，请稍后重试"): String {
    return when (apiFailureKind(error)) {
        ApiFailureKind.Unauthorized -> "登录已失效，请重新登录。"
        ApiFailureKind.ServiceUnavailable -> "云端批改服务暂时不可用，请稍后重试；已保存的作答不会丢失。"
        ApiFailureKind.Timeout -> "批改时间较长，请稍后重试；已保存的作答不会丢失。"
        ApiFailureKind.NetworkUnavailable -> "无法连接云端批改服务，请检查网络后重试；已保存的作答不会丢失。"
        ApiFailureKind.Other -> error.message.orEmpty().ifBlank { fallback }
    }
}

fun loadFailureMessage(error: Throwable, fallback: String = "加载失败，请稍后重试"): String {
    return when (apiFailureKind(error)) {
        ApiFailureKind.Unauthorized -> "登录已失效，请重新登录。"
        ApiFailureKind.ServiceUnavailable -> "云端服务暂时不可用，请稍后重试。"
        ApiFailureKind.Timeout -> "加载时间较长，请检查网络后重试。"
        ApiFailureKind.NetworkUnavailable -> "无法连接云端服务，请检查网络后重试。"
        ApiFailureKind.Other -> error.message.orEmpty().ifBlank { fallback }
    }
}

/** Why a captcha image did not load, so students know whether to wait or to retry. */
internal const val CaptchaLoadFailedMessage = "图形验证码加载失败，请点击刷新"

internal fun captchaLoadFailureMessage(error: Throwable): String {
    if (error is ApiHttpException && error.statusCode == 429) {
        val wait = error.retryAfterSeconds
        return when {
            wait >= 60 -> "图形验证码获取过于频繁，请约 ${(wait + 59) / 60} 分钟后再刷新"
            wait > 0 -> "图形验证码获取过于频繁，请 ${wait} 秒后再刷新"
            else -> "图形验证码获取过于频繁，请稍后再刷新"
        }
    }
    return when (apiFailureKind(error)) {
        ApiFailureKind.Timeout, ApiFailureKind.NetworkUnavailable -> "网络连接不稳定，图形验证码加载失败，请点击刷新"
        ApiFailureKind.ServiceUnavailable -> "验证码服务暂时不可用，请稍后点击刷新"
        else -> CaptchaLoadFailedMessage
    }
}

internal fun isCaptchaLoadFailureMessage(message: String): Boolean =
    message == CaptchaLoadFailedMessage || message.startsWith("图形验证码获取过于频繁") ||
        message == "网络连接不稳定，图形验证码加载失败，请点击刷新" || message == "验证码服务暂时不可用，请稍后点击刷新"

internal fun reinforcementLoadMoreKeepsCurrentInBackStack(): Boolean = false
internal fun reinforcementLoadMoreKeepsCurrentOnErrorInBackStack(): Boolean = true

internal data class MainNavigationCachePolicy(
    val showsCachedMainPageBeforeRefresh: Boolean,
    val sharesDirectoryCacheForSyncAndReinforcement: Boolean,
    val cachesReviewNotebook: Boolean,
)

internal fun mainNavigationCachePolicy(): MainNavigationCachePolicy =
    MainNavigationCachePolicy(
        showsCachedMainPageBeforeRefresh = true,
        sharesDirectoryCacheForSyncAndReinforcement = true,
        cachesReviewNotebook = true,
    )

internal fun mainNavigationCacheBelongsToStudent(
    cachedStudentId: String,
    session: StudentSession,
): Boolean = cachedStudentId == session.studentId

internal fun shouldWarmReviewCache(
    canReadHistory: Boolean,
    hasCachedReview: Boolean,
    refreshInFlight: Boolean,
): Boolean = canReadHistory && !hasCachedReview && !refreshInFlight

private fun reviewRetryKp(data: ReviewData, mistake: ReviewMistake): KpNode {
    val group = data.groups.firstOrNull { group ->
        group.mistakes.any { it.answerId == mistake.answerId }
    }
    return KpNode(
        id = group?.kpId ?: "review:${mistake.answerId}",
        name = group?.kpName ?: "错题变式",
        volume = "错题复盘",
        chapter = "错题复盘",
        section = "变式题",
        mastery = 0.0,
        status = "in_progress",
    )
}

internal fun reviewRetryPractice(question: PracticeQuestion, title: String): PracticeSession =
    PracticeSession(
        objective = title.ifBlank { "做变式题" },
        questions = listOf(question),
        sessionType = PracticeSessionTypes.ReviewRetry,
        strategy = "review_variation",
    )

private fun reviewRetryResultScreen(
    retryScreen: Screen.ReviewRetryQuestion,
    answer: String,
    result: SubmitResult,
    message: String,
): Screen.PracticeResultScreen {
    val kp = reviewRetryKp(retryScreen.data, retryScreen.mistake)
    return Screen.PracticeResultScreen(
        session = retryScreen.session,
        data = DirectoryData(kps = listOf(kp), mastered = 0, inProgress = 1, total = 1),
        chapter = ChapterGroup(kp.volume, kp.chapter, listOf(kp)),
        kp = kp,
        practice = reviewRetryPractice(retryScreen.question, retryScreen.title),
        index = 0,
        question = retryScreen.question,
        answer = answer,
        result = result,
        reviewRetryMistake = retryScreen.mistake,
        reviewRetryMessage = message,
    )
}

data class ReviewRetrySubmissionOutcome(
    val result: SubmitResult,
    val shouldReturnToReviewNotebook: Boolean,
    val message: String,
)

internal fun resolveReviewRetrySubmission(
    gradedResult: SubmitResult,
    clearMistake: () -> ReviewCompletion,
): ReviewRetrySubmissionOutcome {
    if (!gradedResult.correct) {
        return ReviewRetrySubmissionOutcome(
            result = gradedResult.copy(cleared = false),
            shouldReturnToReviewNotebook = false,
            message = "还没有通过。先对照解析找到偏差，再重新完成同类题。",
        )
    }
    val completion = runCatching { clearMistake() }.getOrDefault(ReviewCompletion(cleared = false))
    val result = gradedResult.copy(cleared = completion.cleared)
    return ReviewRetrySubmissionOutcome(
        result = result,
        shouldReturnToReviewNotebook = false,
        message = when {
            completion.cleared -> "变式题已通过，原错题已移出待复盘列表。"
            // The server says why it kept the mistake (e.g. the answer awaits confirmation).
            completion.detail.isNotBlank() -> "答对了，但原错题还未清除：${completion.detail}"
            else -> "答对了，但错题状态还未清除，请稍后刷新错题复盘页确认。"
        },
    )
}

internal fun reviewWithLoadedMistake(review: ReviewData, loaded: ReviewMistake): ReviewData {
    return review.copy(
        groups = review.groups.map { group ->
            group.copy(
                mistakes = group.mistakes.map { mistake ->
                    if (mistake.answerId == loaded.answerId) loaded else mistake
                },
            )
        },
    )
}

/** A knowledge point with no question for the requested set; the page that asked stays put. */
private class NoPracticeQuestions(message: String) : Exception(message)

class AppController(context: Context, recreatedStudentId: String? = null) : ViewModel() {
    private val toastContext = context.applicationContext

    /**
     * Like iOS, an empty knowledge-point set is reported on the page that asked for it
     * instead of replacing that page with an "暂无可练题目" dead end.
     */
    private fun stayOnEmptyPracticeSet(error: Exception, previous: Screen): Screen {
        if (error !is NoPracticeQuestions) return Screen.Error("加载失败", loadFailureMessage(error))
        if (backStack.lastOrNull() === previous) backStack.removeAt(backStack.lastIndex)
        android.widget.Toast.makeText(toastContext, error.message, android.widget.Toast.LENGTH_LONG).show()
        return previous
    }

    private val sessionStore = SessionStore(context)
    private val chatHistoryStore = ChatHistoryStore(context)
    private val practiceRecoveryStore = PracticeRecoveryStore(context)
    private val draftCanvasSnapshots = mutableStateMapOf<String, DraftCanvasSnapshot>()
    private val pendingMediaCleanup = ConcurrentHashMap<String, LocalImageFile>()
    private val privateImageStore = PrivateImageStore(context)
    private val executor: ExecutorService = Executors.newSingleThreadExecutor()
    private val tutorExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private val recoveryExecutor = Executors.newSingleThreadScheduledExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val requestGeneration = RequestGeneration()
    private val api = ApiClient(::handleUnauthorized)
    private var accountMutationToken: String? = null
    private var accountMutationUnauthorized = false
    private val backStack = mutableListOf<Screen>()
    private val answerDrafts = PracticeAnswerDrafts()
    private val practiceReviewState = PracticeReviewState()
    private val kpAssessmentProgressStore = KpAssessmentProgressStore(context)
    private val initialSession = sessionStore.read()
    private var pendingRecoverySave: ScheduledFuture<*>? = null
    private val pendingCanvasSaves = HashMap<String, ScheduledFuture<*>>()
    private var latestRecoverySnapshot: PracticeRecoverySnapshot? = null
    private val learnChatMessages = mutableMapOf<String, List<TutorChatMessage>>()
    private var mainCacheStudentId: String = ""
    private var cachedDirectory: DirectoryData? = null
    @Volatile private var latestMasteryDirectory: LearningDirectorySnapshot? = null
    @Volatile private var masteryRefreshVersion = 0L
    private var pendingMasteryRefresh: Runnable? = null
    private var cachedJudgmentsByKpId: Map<String, KnowledgeMasteryJudgment> = emptyMap()
    private var cachedReview: ReviewData? = null
    private var cachedTrainStart: TrainStartData? = null
    private var cachedLatestPlan: ImprovementPlan? = null
    private var cachedLatestCompletedReport: ImprovementReport? = null
    @Volatile private var cachedGaokaoReview: Screen.GaokaoReview? = null
    private var reviewRefreshInFlight: Boolean = false
    private var sessionRefreshInFlight: Boolean = false
    private val pendingLearningCatalogEvidence = Collections.synchronizedSet(
        mutableSetOf<PendingLearningCatalogEvidence>(),
    )

    private fun resetPracticeDrafts(practice: PracticeSession) {
        val questionIds = practice.questions.map { it.id }
        answerDrafts.clearSession(questionIds)
        questionIds.forEach(draftCanvasSnapshots::remove)
        practiceReviewState.clearSession(practice.questions)
    }

    private fun freshPracticeQuestionScreen(screen: Screen.PracticeQuestionScreen): Screen.PracticeQuestionScreen {
        resetPracticeDrafts(screen.practice)
        return screen
    }

    // An interrupted practice resumes whether Android recreated the activity or the process
    // was killed outright (common on aggressive OEM battery managers).
    private val recreatedPractice = practiceRecoveryStore.restoreVisit(initialSession, recreatedStudentId)
    private var currentScreen by mutableStateOf<Screen>(
        recreatedPractice?.let(::resumedScreen) ?: practiceRecoveryStore.startVisit(initialSession),
    )
    var screen: Screen
        get() = currentScreen
        private set(value) {
            val restored = value.withTutorConversation(value.tutorRequestState().forGeneration(requestGeneration.current()))
            currentScreen = latestMasteryDirectory?.apply(restored) ?: restored
            if (restored is Screen.PracticeResultScreen) syncRecoveryForResult(restored)
        }

    init {
        recreatedPractice?.let(::adoptRecoveredPractice)
    }

    private fun adoptRecoveredPractice(snapshot: PracticeRecoverySnapshot) {
        answerDrafts.restore(snapshot.drafts)
        practiceReviewState.restore(snapshot.completedItems)
        draftCanvasSnapshots.putAll(snapshot.canvasSnapshots)
        latestRecoverySnapshot = snapshot
        // A resumed practice has nothing underneath it: back must land somewhere, not close the app.
        backStack.add(Screen.Home(snapshot.screen.session))
        snapshot.reviewRetry?.let { retry -> backStack.add(Screen.ReviewDetail(retry.session, retry.data, retry.mistake)) }
    }

    private fun resumedScreen(snapshot: PracticeRecoverySnapshot): Screen {
        val resumed = resumedPracticeScreen(snapshot)
        if (resumed !is Screen.PracticeResultScreen) return resumed
        val history = resumed.result.answerId?.let { chatHistoryStore.read(resumed.session.studentId, questionChatScope(it)) }
        return resumed.copy(tutorMessages = history.orEmpty())
    }

    /**
     * A per-question result is the moment students most often switch apps. Keep the saved practice
     * pointing at the next question (with this answer recorded), so a resume never repeats it.
     */
    private fun syncRecoveryForResult(result: Screen.PracticeResultScreen) {
        if (result.openedFromSummary) return
        if (result.practice.sessionType == PracticeSessionTypes.ReviewRetry) {
            // A spent variation must never reopen.
            if (latestRecoverySnapshot?.reviewRetry != null) clearPracticeRecovery(result.session.studentId)
            return
        }
        if (result.practice.teacherPaper != null) return
        val saved = latestRecoverySnapshot?.takeIf {
            it.screen.session.studentId == result.session.studentId && it.screen.practice.samePracticeAs(result.practice)
        } ?: return
        if (saved.screen.paperBatchSubmission != null) return
        val completed = practiceReviewState.completedItems(result.practice.questions)
        val completedIds = completed.mapTo(HashSet()) { it.question.id }
        val index = practiceResumeIndex(result.practice.questions, completedIds, result.index)
        // Tutor replies update this screen often; save only when the saved progress changes.
        if (saved.screen.index == index && saved.completedItems == completed) return
        scheduleRecoverySnapshot(recoverySnapshot(saved.screen.copy(session = result.session, index = index)), immediate = true)
    }

    /** A stack reset leaves an unfinished result flow behind for good. Teacher papers stay saved. */
    private fun endPracticeLeftBehind() {
        val result = (backStack + screen).filterIsInstance<Screen.PracticeResultScreen>()
            .lastOrNull { it.practice.teacherPaper == null } ?: return
        clearPracticeRecovery(result.session.studentId)
    }

    fun checkpointPracticeForRecreation(): String? {
        val snapshot = activeRecoverySnapshot() ?: (screen as? Screen.PracticeResultScreen)?.let { result ->
            latestRecoverySnapshot?.takeIf {
                !result.openedFromSummary && it.screen.session.studentId == result.session.studentId &&
                    it.screen.practice.samePracticeAs(result.practice)
            }
        } ?: return null
        pendingRecoverySave?.cancel(false)
        return runCatching {
            recoveryExecutor.submit { practiceRecoveryStore.save(snapshot) }.get()
            latestRecoverySnapshot = snapshot
            snapshot.screen.session.studentId
        }.getOrNull()
    }

    override fun onCleared() {
        pendingMasteryRefresh?.let(mainHandler::removeCallbacks)
        masteryRefreshVersion += 1
        requestGeneration.invalidate()
        pendingRecoverySave?.cancel(false)
        val snapshot = activeRecoverySnapshot() ?: latestRecoverySnapshot
        snapshot?.let { runCatching { recoveryExecutor.submit { practiceRecoveryStore.save(it) }.get() } }
        recoveryExecutor.shutdownNow()
        executor.shutdownNow()
        tutorExecutor.shutdownNow()
        super.onCleared()
    }

    fun goBack(): Boolean {
        val current = screen
        if (current is Screen.ReinforcementDiagnosticAttemptDetail) {
            returnToScopeDiagnosticHistory(current)
            return true
        }
        if (current is Screen.PracticeResultScreen && !current.openedFromSummary &&
            current.practice.sessionType == PracticeSessionTypes.ReviewRetry &&
            current.index + 1 >= current.practice.questions.size) {
            // Leaving a variation's result returns to the refreshed mistake, never to the spent attempt.
            nextQuestion(current)
            return true
        }
        if (current is Screen.ReinforcementDiagnosticHistory) {
            loadReinforcementHome(current.session, asRoot = true)
            return true
        }
        if (current is Screen.PracticeQuestionScreen) {
            leavePractice(current)
            return true
        }
        if (current is Screen.ReviewRetryQuestion) {
            if (!answerDrafts.isLocked(current.question.id)) pendingPracticeExit = current
            return true
        }
        return goBackWithoutPracticeGuard()
    }

    private fun goBackWithoutPracticeGuard(): Boolean {
        val current = screen
        var previous = backStack.removeLastOrNull() ?: return false
        while (current is Screen.PracticeReviewScreen && previous.isSamePracticeFlow(current.practice)) {
            previous = backStack.removeLastOrNull() ?: return false
        }
        requestGeneration.invalidate()
        if (current is Screen.PracticeResultScreen) {
            previous = refreshReviewAfterResult(previous, current, practiceReviewFor(current))
            // Backing out past the practice ends it; only an interruption resumes later.
            if (current.practice.teacherPaper == null && !previous.isSamePracticeFlow(current.practice)) {
                clearPracticeRecovery(current.session.studentId)
            }
        }
        screen = previous
        if (previous is Screen.PracticeQuestionScreen) schedulePracticeRecovery(previous, immediate = true)
        return true
    }

    var loginBusy by mutableStateOf(false)
        private set

    suspend fun loadLoginCaptcha() = withContext(Dispatchers.IO) { api.getLoginCaptcha() }
    suspend fun loadAccountSettings(owner: StudentSession) = withContext(Dispatchers.IO) {
        api.getAccountSettings(owner.token)
    }

    private suspend fun <T> classRequest(owner: StudentSession, action: () -> T): T {
        check(ownsSession(owner)) { "登录状态已变化，请重新打开个人中心" }
        check(accountMutationToken == null) { "账号设置正在保存，请稍候" }
        val result = withContext(Dispatchers.IO) { action() }
        check(ownsSession(owner)) { "登录状态已变化，请重新打开个人中心" }
        return result
    }

    suspend fun loadStudentClasses(owner: StudentSession) = classRequest(owner) { api.getStudentClasses(owner.token) }
    suspend fun previewClassInvitation(code: String, owner: StudentSession) = classRequest(owner) { api.previewClassInvitation(code, owner.token) }

    suspend fun joinStudentClass(code: String, disclosureVersion: String, name: String, owner: StudentSession): cn.openphysics.androidapp.data.api.StudentClassJoinResult {
        val result = classRequest(owner) { api.joinStudentClass(code, disclosureVersion, name, owner.token) }
        val current = checkNotNull(sessionStore.read())
        val named = current.copy(displayName = result.studentName)
        sessionStore.save(named)
        screen = screen.withStudentSession(named)
        backStack.indices.forEach { index -> backStack[index] = backStack[index].withStudentSession(named) }
        return result
    }

    suspend fun renameStudent(name: String, owner: StudentSession): String {
        val saved = classRequest(owner) { api.renameStudent(name, owner.token) }
        val named = checkNotNull(sessionStore.read()).copy(displayName = saved)
        sessionStore.save(named)
        screen = screen.withStudentSession(named)
        backStack.indices.forEach { index -> backStack[index] = backStack[index].withStudentSession(named) }
        return saved
    }

    suspend fun leaveStudentClass(membership: cn.openphysics.androidapp.data.api.StudentClassMembership, owner: StudentSession) {
        classRequest(owner) { api.leaveStudentClass(membership.id, owner.token) }
    }

    suspend fun updateAccountSecurity(action: SecurityAction, fields: Map<String, String>, owner: StudentSession): AccountSecurityResult {
        check(ownsSession(owner)) { "登录状态已变化，请重新打开个人中心" }
        check(accountMutationToken == null) { "账号设置正在保存，请稍候" }
        if (action.renewsAccount) {
            accountMutationToken = owner.token
            accountMutationUnauthorized = false
        }
        try {
            val result = withContext(Dispatchers.IO) { api.requestAccountSecurity(action, fields, owner) }
            check(ownsSession(owner)) { "登录状态已变化，请重新打开个人中心" }
            result.session?.let { renewed ->
                // Renew the same account throughout navigation; preserve its learning drafts.
                requestGeneration.invalidate()
                sessionStore.save(renewed)
                screen = screen.withStudentSession(renewed)
                backStack.indices.forEach { index -> backStack[index] = backStack[index].withStudentSession(renewed) }
            }
            return result
        } catch (failure: Exception) {
            val status = (failure as? ApiHttpException)?.statusCode
            if (action.renewsAccount && (status == null || status !in 400..499)) {
                // A cancelled/lost response may hide a successful write. Never replay it.
                withContext(NonCancellable + Dispatchers.Main) {
                    if (ownsSession(owner)) {
                        requestGeneration.invalidate()
                        clearSessionState(preservePractice = true)
                        screen = Screen.Login("保存结果未能确认，请重新登录后核对账号设置。")
                    }
                }
            }
            throw failure
        } finally {
            if (action.renewsAccount) {
                accountMutationToken = null
                val rejected = accountMutationUnauthorized
                accountMutationUnauthorized = false
                if (rejected) handleUnauthorized(owner.token)
            }
        }
    }


    /** After signing in with a teacher's invitation: whether the class was joined. Shown once. */
    var loginClassNotice by mutableStateOf("")

    fun login(credentials: LoginCredentials) {
        if (loginBusy) return
        if (credentials.identifier.isBlank() || credentials.secret.isBlank()) {
            screen = Screen.Login("请完整填写登录信息")
            return
        }
        loginBusy = true
        pendingRecoverySave?.cancel(false)
        pendingRecoverySave = null
        cancelPendingCanvasSaves()
        val requestId = requestGeneration.begin()
        executor.execute {
            try {
                val session = api.login(credentials.copy(identifier = credentials.identifier.trim()))
                // Serialize cleanup after any save from the previous login session.
                // A sign-in after an expired token picks the interrupted practice back up.
                val resumed = recoveryExecutor.submit<PracticeRecoverySnapshot?> {
                    practiceRecoveryStore.restoreVisit(session, recreatedStudentId = null)
                }.get()
                val entry = resumed?.let(::resumedScreen) ?: recoveryExecutor.submit<Screen> {
                    practiceRecoveryStore.startVisit(session)
                }.get()
                postForRequest(requestId) {
                    loginBusy = false
                    sessionStore.save(session)
                    backStack.clear()
                    answerDrafts.clearAll()
                    practiceReviewState.clearAll()
                    draftCanvasSnapshots.clear()
                    latestRecoverySnapshot = null
                    pendingPracticeExit = null
                    resumed?.let(::adoptRecoveredPractice)
                    loginClassNotice = ""
                    screen = entry
                }
            } catch (error: Exception) {
                postForRequest(requestId) {
                    loginBusy = false
                    screen = Screen.Login(if (error is ApiHttpException) error.message.orEmpty() else loadFailureMessage(error),
                        captchaRequired = (error as? ApiHttpException)?.captchaRequired == true
                            || (screen as? Screen.Login)?.captchaRequired == true)
                }
            }
        }
    }

    fun refreshStudentSession() {
        val cached = sessionStore.read() ?: return
        if (accountMutationToken != null) return
        if (sessionRefreshInFlight) return
        sessionRefreshInFlight = true
        executor.execute {
            try {
                val refreshed = currentStudentSession(cached)
                mainHandler.post {
                    // A mutation in flight owns the token; renewal waits for the next resume.
                    if (accountMutationToken == null && sessionStore.read()?.token == cached.token) {
                        sessionStore.save(refreshed)
                        screen = screen.withStudentSession(refreshed)
                        backStack.indices.forEach { index ->
                            backStack[index] = backStack[index].withStudentSession(refreshed)
                        }
                    }
                    sessionRefreshInFlight = false
                }
            } catch (_: Exception) {
                mainHandler.post { sessionRefreshInFlight = false }
            }
        }
    }

    @Volatile private var lastTokenRenewalFailureMs = 0L

    /** Renews a token nearing expiry; any failure but a rejection falls back to the old read. */
    private fun currentStudentSession(cached: StudentSession): StudentSession {
        val nowMs = System.currentTimeMillis()
        if (StudentTokenRenewal.shouldRenew(cached.token, nowMs / 1_000L) &&
            StudentTokenRenewal.mayRetry(lastTokenRenewalFailureMs, nowMs)
        ) {
            try {
                return api.refreshStudentToken(cached).also { lastTokenRenewalFailureMs = 0L }
            } catch (failure: Exception) {
                if (failure is ApiHttpException && failure.statusCode == 401) throw failure
                lastTokenRenewalFailureMs = nowMs
            }
        }
        return api.getCurrentStudent(cached)
    }

    /** Back from an error with nothing underneath: home while signed in, never a silent sign-out. */
    fun leaveRootError() {
        val session = sessionStore.read()
        if (session != null) showHome(session) else logout()
    }

    fun logout() {
        requestGeneration.invalidate()
        clearSessionState()
        screen = Screen.Login()
    }


    /** Erases the shared account (web, Android and iOS) after a fresh password or SMS proof. */
    suspend fun deleteAccount(owner: StudentSession, password: String) {
        check(ownsSession(owner)) { "登录状态已变化，请重新登录后再注销" }
        withContext(Dispatchers.IO) { api.deleteAccount(owner.token, password) }
        withContext(NonCancellable + Dispatchers.Main) {
            if (ownsSession(owner)) {
                requestGeneration.invalidate()
                chatHistoryStore.clearStudent(owner.studentId)
                clearSessionState()
                screen = Screen.Login("账号已注销，个人资料及学习数据已删除。")
            }
        }
    }

    fun credentialsChanged() {
        requestGeneration.invalidate()
        clearSessionState(preservePractice = true)
        screen = Screen.Login("账号信息已更新，请重新登录")
    }

    private fun clearSessionState(preservePractice: Boolean = false) {
        pendingPracticeExit = null
        if (preservePractice) {
            val currentPractice = (screen as? Screen.PracticeQuestionScreen)
                ?: backStack.filterIsInstance<Screen.PracticeQuestionScreen>().lastOrNull()
            currentPractice?.let { schedulePracticeRecovery(it, immediate = true) }
        } else {
            sessionStore.read()?.studentId?.let(::clearPracticeRecovery)
        }
        sessionStore.clear()
        backStack.clear()
        answerDrafts.clearAll()
        practiceReviewState.clearAll()
        draftCanvasSnapshots.clear()
        pendingMediaCleanup.clear()
        pendingLearningCatalogEvidence.clear()
        clearMainNavigationCache()
    }


    private fun handleUnauthorized(rejectedToken: String) {
        mainHandler.post {
            // An earlier read may see the old token revoked before the save response arrives.
            if (accountMutationToken == rejectedToken) {
                accountMutationUnauthorized = true
                return@post
            }
            if (!shouldExpireSessionForUnauthorized(rejectedToken, sessionStore.read()?.token)) return@post
            requestGeneration.invalidate()
            clearSessionState(preservePractice = true)
            screen = Screen.Login("登录已失效，请重新登录。")
        }
    }

    fun showSettings(session: StudentSession) {
        navigate(Screen.Settings(session))
    }

    /** Tablet sidebar: 个人中心 is a section root like the others, not a page pushed on top. */
    fun showSettingsRoot(session: StudentSession) {
        showMainNavigationScreen(Screen.Settings(session), replaceStack = true)
    }

    fun showLearnHub(session: StudentSession) {
        showMainNavigationScreen(Screen.LearnHub(session), replaceStack = true)
    }

    fun showHome(session: StudentSession) {
        pendingPracticeExit = null
        // Choosing home ends the practice; only an interruption resumes it later.
        if (screen is Screen.PracticeQuestionScreen) clearPracticeRecovery(session.studentId) else endPracticeLeftBehind()
        requestGeneration.invalidate()
        backStack.clear()
        screen = Screen.Home(session)
    }

    fun openHomeTask(session: StudentSession, task: HomeTask) {
        when (task.actionType) {
            HomeTaskAction.Review -> {
                loadReview(session)
                return
            }
            HomeTaskAction.Sync -> if (task.kpId.isBlank()) {
                loadDirectory(session)
                return
            }
            HomeTaskAction.Reinforcement -> if (task.kpId.isBlank()) {
                loadReinforcementHome(session)
                return
            }
        }
        runWithLoading(
            title = if (task.actionType == HomeTaskAction.Sync) "同步学习" else "巩固提升",
            message = "正在打开今日推荐的知识点...",
        ) {
            ensureMainCacheFor(session)
            val cached = cachedDirectory
            val directory = if (cached?.kps?.any { it.id == task.kpId } == true) {
                cached
            } else {
                api.getDirectory(session.token, session.studentId).also {
                    cacheDirectory(session, it, emptyMap())
                }
            }
            val kp = directory.kps.firstOrNull { it.id == task.kpId }
                ?: return@runWithLoading Screen.Error("今日任务不可用", "推荐知识点已更新，请返回首页刷新今日任务。")
            if (!StudentAccessPolicy.canAccessKp(session, kp)) {
                return@runWithLoading accountUnavailableScreen(
                    if (task.actionType == HomeTaskAction.Sync) "同步学习" else "巩固提升",
                )
            }
            val chapter = chapterGroupFor(directory, kp)
            when (task.actionType) {
                HomeTaskAction.Sync -> Screen.Learn(
                    session = session,
                    data = directory,
                    chapter = chapter,
                    kp = kp,
                    bundle = api.getLearnBundle(session.token, session.studentId, kp.id),
                    chatMessages = learnChatMessages[kp.id]
                        ?: chatHistoryStore.read(session.studentId, learnChatScope(kp.id)),
                )
                HomeTaskAction.Reinforcement -> {
                    val practice = api.getPracticeSession(session.token, session.studentId, kp.id, 5)
                    if (practice.questions.isEmpty()) {
                        Screen.Error("暂无可练题目", "今日推荐知识点暂时没有可用于巩固的题目。")
                    } else {
                        freshPracticeQuestionScreen(
                            Screen.PracticeQuestionScreen(
                                session = session,
                                data = directory,
                                chapter = chapter,
                                kp = kp,
                                practice = practice,
                                index = 0,
                                returnToHome = true,
                            ),
                        )
                    }
                }
                HomeTaskAction.Review -> error("Review task returns before loading a knowledge point")
            }
        }
    }

    fun loadDirectory(session: StudentSession, asRoot: Boolean = false) {
        if (!StudentAccessPolicy.canReadOwnHistory(session)) {
            navigate(accountUnavailableScreen("同步学习"))
            return
        }
        ensureMainCacheFor(session)
        val policy = mainNavigationCachePolicy()
        val directory = cachedDirectory
        if (policy.showsCachedMainPageBeforeRefresh && directory != null) {
            showMainNavigationScreen(
                Screen.Directory(
                    session = session,
                    data = directory,
                    judgmentsByKpId = cachedJudgmentsByKpId,
                ),
                replaceStack = asRoot,
            )
            refreshDirectoryInBackground(session)
            warmReviewCacheInBackground(session)
            warmGaokaoCacheInBackground(session)
            return
        }
        runWithLoading("同步学习", "正在加载教材目录...", asRoot) {
            val (directory, judgments) = fetchDirectoryAndJudgments(session)
            mainHandler.post { warmGaokaoCacheInBackground(session) }
            Screen.Directory(
                session = session,
                data = directory,
                judgmentsByKpId = judgments,
            )
        }
    }

    fun loadGaokaoReview(session: StudentSession, asRoot: Boolean = false) {
        ensureMainCacheFor(session)
        val cached = cachedGaokaoReview
        if (mainNavigationCachePolicy().showsCachedMainPageBeforeRefresh && cached != null) {
            // Same as 同步学习 / 巩固提升: show the last catalog at once, refresh it quietly.
            showMainNavigationScreen(
                cached.copy(session = session, message = "", overviewLoading = false, autoLoadOverview = false),
                replaceStack = asRoot,
            )
            refreshGaokaoReviewInBackground(session)
            return
        }
        // Only the catalog blocks the page; the resumed topic's overview loads inside it.
        runWithLoading("高考复习", "正在加载复习专题...", replaceStack = asRoot) {
            val catalog = api.getLearningCatalog(session.token, GAOKAO_CATALOG_CODE)
            // Resume is a convenience read: old servers or a transient failure must not hide the catalog.
            val resumeTopicId = runCatching {
                api.getLearningCatalogResumeTopicId(session.token, GAOKAO_CATALOG_CODE)
            }.getOrDefault("")
            val entry = gaokaoReviewEntry(catalog, resumeTopicId)
            Screen.GaokaoReview(
                session = session,
                catalog = catalog,
                expandedBlockId = entry?.blockId.orEmpty(),
                selectedTopicId = entry?.topic?.id.orEmpty(),
                overviewLoading = entry != null,
                autoLoadOverview = entry != null,
            ).also { cacheGaokaoReview(session, it) }
        }
    }

    private fun refreshGaokaoReviewInBackground(session: StudentSession) {
        val requestId = requestGeneration.current()
        val selectedTopicId = cachedGaokaoReview?.selectedTopicId.orEmpty()
        executor.execute {
            runCatching {
                val catalog = api.getLearningCatalog(session.token, GAOKAO_CATALOG_CODE)
                val topic = catalog.topic(selectedTopicId)
                val context = topic?.let {
                    LearningCatalogPracticeContext(catalog.code, it.id, it.title, LearningCatalogTopicLayer.Foundation)
                }
                val overview = context?.let {
                    retryLearningCatalogEvidence(session, it)
                    runCatching { api.getLearningCatalogTopicOverview(session.token, catalog.code, it.nodeId) }
                        .getOrNull()?.takeIf { overview -> overview.nodeId == it.nodeId }
                }
                Triple(catalog, overview, context)
            }.onSuccess { (catalog, overview, context) ->
                postForRequest(requestId) {
                    val latest = screen as? Screen.GaokaoReview ?: return@postForRequest
                    if (latest.session.studentId != session.studentId) return@postForRequest
                    val sameTopic = latest.selectedTopicId == selectedTopicId
                    val next = latest.copy(
                        catalog = catalog,
                        overview = if (sameTopic && overview != null) overview else latest.overview,
                        evidenceSyncMessage = if (sameTopic && context != null) learningCatalogEvidenceMessage(context) else latest.evidenceSyncMessage,
                    )
                    screen = next
                    cacheGaokaoReview(session, next)
                }
            }
        }
    }

    private fun cacheGaokaoReview(session: StudentSession, review: Screen.GaokaoReview) {
        if (!ownsSession(session)) return
        ensureMainCacheFor(session)
        cachedGaokaoReview = review.copy(message = "", overviewLoading = false, autoLoadOverview = false)
    }

    fun toggleGaokaoBlock(reviewScreen: Screen.GaokaoReview, block: LearningCatalogNode) {
        val current = screen as? Screen.GaokaoReview ?: return
        if (current.session.studentId != reviewScreen.session.studentId) return
        screen = current.copy(
            expandedBlockId = if (current.expandedBlockId == block.id) "" else block.id,
        ).also { cacheGaokaoReview(it.session, it) }
    }

    fun selectGaokaoTopic(reviewScreen: Screen.GaokaoReview, topic: LearningCatalogNode) {
        val current = screen as? Screen.GaokaoReview ?: return
        if (current.session.studentId != reviewScreen.session.studentId) return
        val requestId = requestGeneration.begin()
        val context = LearningCatalogPracticeContext(
            catalogCode = current.catalog.code,
            nodeId = topic.id,
            topicTitle = topic.title,
            layer = LearningCatalogTopicLayer.Foundation,
        )
        screen = current.copy(
            selectedTopicId = topic.id,
            overview = null,
            overviewLoading = true,
            message = "",
            evidenceSyncMessage = "",
            autoLoadOverview = false,
        )
        executor.execute {
            try {
                retryLearningCatalogEvidence(current.session, context)
                val overview = api.getLearningCatalogTopicOverview(
                    token = current.session.token,
                    catalogCode = current.catalog.code,
                    nodeId = topic.id,
                )
                check(overview.nodeId == topic.id) { "专题学习状态不匹配，请重新加载" }
                postForRequest(requestId) {
                    val active = screen as? Screen.GaokaoReview ?: return@postForRequest
                    if (active.selectedTopicId != topic.id) return@postForRequest
                    screen = active.copy(
                        overview = overview,
                        overviewLoading = false,
                        message = "",
                        evidenceSyncMessage = learningCatalogEvidenceMessage(context),
                    ).also { cacheGaokaoReview(it.session, it) }
                }
            } catch (error: Exception) {
                postForRequest(requestId) {
                    val active = screen as? Screen.GaokaoReview ?: return@postForRequest
                    if (active.selectedTopicId != topic.id) return@postForRequest
                    screen = active.copy(
                        overview = null,
                        overviewLoading = false,
                        message = loadFailureMessage(error),
                        evidenceSyncMessage = learningCatalogEvidenceMessage(context),
                    )
                }
            }
        }
    }

    fun refreshGaokaoTopic(reviewScreen: Screen.GaokaoReview) {
        val topic = reviewScreen.catalog.topic(reviewScreen.selectedTopicId) ?: return
        selectGaokaoTopic(reviewScreen, topic)
    }

    fun startGaokaoTopicSession(
        reviewScreen: Screen.GaokaoReview,
        topic: LearningCatalogNode,
        layer: LearningCatalogTopicLayer,

    ) {
        if (!StudentAccessPolicy.hasFullLearningAccess(reviewScreen.session)) {
            screen = reviewScreen.copy(session = reviewScreen.session.copy())
            return
        }
        runWithLoading(layer.title, "正在按「${topic.title}」组织${layer.title}题目...", onError = { error, previous ->
            if (backStack.lastOrNull() == previous) backStack.removeLastOrNull()
            reviewScreen.copy(
                session = if ((error as? ApiHttpException)?.statusCode == 401)
                    reviewScreen.session.copy() else reviewScreen.session,
                message = if ((error as? ApiHttpException)?.statusCode == 401) "" else loadFailureMessage(error),
            )
        }) {
            val context = LearningCatalogPracticeContext(
                catalogCode = reviewScreen.catalog.code,
                nodeId = topic.id,
                topicTitle = topic.title,
                layer = layer,

            )
            val practice = api.getLearningCatalogTopicSession(
                token = reviewScreen.session.token,
                catalogCode = reviewScreen.catalog.code,
                nodeId = topic.id,
                layer = layer,
                questionCount = layer.questionCount,

            )
            learningCatalogPracticeScreen(reviewScreen.session, context, practice)
        }
    }

    /** Teacher homework uses assignment ownership: the server opens it to its own student only. */
    fun startTeacherHomework(session: StudentSession, homework: TeacherHomework) {
        runWithLoading("老师作业", "正在打开「${homework.title}」...") {
            val context = LearningCatalogPracticeContext(
                catalogCode = "teacher_homework",
                nodeId = homework.attemptId,
                topicTitle = homework.title,
                layer = LearningCatalogTopicLayer.Paper,
                homeworkAttemptId = homework.attemptId,
            )
            learningCatalogPracticeScreen(session, context, api.getTeacherHomeworkSession(session.token, homework.attemptId))
        }
    }

    fun refreshHomeDashboard(session: StudentSession) {
        val current = screen
        if (current is Screen.Home && current.dashboardLoading) return
        val requestId = requestGeneration.begin()
        val currentHome = current as? Screen.Home
        screen = Screen.Home(
            session = session,
            dashboard = currentHome?.dashboard,
            dailyLoop = currentHome?.dailyLoop,
            dailyLoopHistory = currentHome?.dailyLoopHistory,
            growthReport = currentHome?.growthReport,
            dashboardLoading = true,
            teacherHomework = currentHome?.teacherHomework.orEmpty(),
        )
        executor.execute {
            try {
                val dashboard = api.getDashboard(session.token, session.studentId)
                val dailyLoop = runCatching {
                    api.getDailyLearningLoop(session.token, session.studentId)
                }.getOrNull()
                val dailyLoopHistory = runCatching {
                    api.getDailyLearningLoopHistory(session.token, session.studentId, days = 35)
                }.getOrNull()
                val growthReport = runCatching {
                    api.getGrowthReport(session.token, session.studentId)
                        ?: api.generateGrowthReport(session.token, session.studentId)
                }.getOrNull()
                // The card is extra: a failure keeps the last list and the rest of home loads.
                val teacherHomework = runCatching { api.getTeacherHomework(session.token) }.getOrNull()
                postForRequest(requestId) {
                    val latest = screen
                    if (latest is Screen.Home && latest.session.studentId == session.studentId) {
                        screen = latest.copy(
                            teacherHomework = teacherHomework ?: latest.teacherHomework,
                            dashboard = dashboard,
                            dailyLoop = dailyLoop,
                            dailyLoopHistory = dailyLoopHistory,
                            growthReport = growthReport,
                            dashboardLoading = false,
                            dashboardError = "",
                        )
                        warmReviewCacheInBackground(session)
                    }
                }
            } catch (e: Exception) {
                postForRequest(requestId) {
                    val latest = screen
                    if (latest is Screen.Home && latest.session.studentId == session.studentId) {
                        screen = latest.copy(
                            dashboardLoading = false,
                            dashboardError = e.message ?: "首页建议加载失败",
                        )
                    }
                }
            }
        }
    }

    fun loadHistory(session: StudentSession, asRoot: Boolean = false) {
        if (!StudentAccessPolicy.canReadOwnHistory(session)) {
            navigate(accountUnavailableScreen("练习记录"))
            return
        }
        runWithLoading("练习记录", "正在加载最近答题记录...", asRoot) {
            Screen.History(session, api.getAnswerHistory(session.token, session.studentId))
        }
    }

    /** Homework uses assignment ownership, so neither does its record. */
    fun loadHomeworkHistory(session: StudentSession) {
        runWithLoading("作业记录", "正在加载老师作业...") {
            Screen.HomeworkHistory(session, api.getTeacherHomework(session.token, history = true))
        }
    }

    private fun refreshHomeworkHistory(session: StudentSession) {
        executor.execute {
            val items = runCatching { api.getTeacherHomework(session.token, history = true) }.getOrNull() ?: return@execute
            mainHandler.post {
                val latest = screen
                if (latest is Screen.HomeworkHistory && latest.session.studentId == session.studentId) {
                    screen = latest.copy(items = items)
                }
            }
        }
    }

    fun loadGrowthReportHistory(session: StudentSession, report: GrowthReportData) {
        if (!StudentAccessPolicy.canReadOwnHistory(session)) {
            navigate(accountUnavailableScreen("练习记录"))
            return
        }
        runWithLoading("练习记录", "正在加载成长回顾对应的答题记录...") {
            Screen.History(
                session,
                api.getAnswerHistory(
                    token = session.token,
                    studentId = session.studentId,
                    limit = 100,
                    fromDate = report.startDate,
                    toDate = report.endDate,
                ),
            )
        }
    }

    fun loadReview(session: StudentSession, asRoot: Boolean = false) {
        if (!StudentAccessPolicy.canReadOwnHistory(session)) {
            navigate(accountUnavailableScreen("错题复盘"))
            return
        }
        ensureMainCacheFor(session)
        val policy = mainNavigationCachePolicy()
        val review = cachedReview
        if (policy.showsCachedMainPageBeforeRefresh && policy.cachesReviewNotebook && review != null) {
            showMainNavigationScreen(
                Screen.Review(session, review),
                replaceStack = asRoot,
            )
            refreshReviewInBackground(session)
            return
        }
        runWithLoading("错题复盘", "正在整理待复盘错题...", asRoot) {
            Screen.Review(session, cachedReview ?: fetchReviewAndCache(session))
        }
    }

    fun openReviewFromHistory(session: StudentSession, record: AnswerHistoryRecord) {
        if (!StudentAccessPolicy.canReadOwnHistory(session)) {
            navigate(accountUnavailableScreen("错题复盘"))
            return
        }
        runWithLoading("错题复盘", "正在定位这道错题...", true) {
            val review = fetchReviewAndCache(session)
            val summary = matchingReviewMistakeForHistory(record, review)
            if (summary != null) {
                val mistake = api.getReviewMistake(session.token, summary.answerId)
                val detailedReview = reviewWithLoadedMistake(review, mistake)
                cacheReview(session, detailedReview)
                Screen.ReviewDetail(
                    session = session,
                    data = detailedReview,
                    mistake = mistake,
                    tutorMessages = chatHistoryStore.read(session.studentId, questionChatScope(mistake.answerId)),
                )
            } else {
                Screen.Review(session, review)
            }
        }
    }

    fun loadReinforcementHome(session: StudentSession, asRoot: Boolean = false) {
        if (!StudentAccessPolicy.canReadOwnHistory(session)) {
            navigate(accountUnavailableScreen("巩固提升"))
            return
        }
        ensureMainCacheFor(session)
        val policy = mainNavigationCachePolicy()
        val directory = cachedDirectory
        if (
            policy.showsCachedMainPageBeforeRefresh &&
            policy.sharesDirectoryCacheForSyncAndReinforcement &&
            directory != null
        ) {
            showMainNavigationScreen(
                Screen.ReinforcementHome(
                    session = session,
                    data = directory,
                    trainStart = cachedTrainStart ?: defaultTrainStart(),
                    latestPlan = cachedLatestPlan,
                    latestCompletedReport = cachedLatestCompletedReport,
                    judgmentsByKpId = cachedJudgmentsByKpId,
                ),
                replaceStack = asRoot,
            )
            refreshReinforcementHomeInBackground(session)
            warmReviewCacheInBackground(session)
            warmGaokaoCacheInBackground(session)
            return
        }
        runWithLoading("巩固提升", "正在整理薄弱点和章节训练路径...", asRoot) {
            fetchReinforcementHomeAndCache(session).also { mainHandler.post { warmGaokaoCacheInBackground(session) } }
        }
    }

    fun showReinforcementChapterPath(
        session: StudentSession,
        data: DirectoryData,
        trainStart: TrainStartData,
        volume: String,
        chapter: String,
        judgmentsByKpId: Map<String, KnowledgeMasteryJudgment> = emptyMap(),
    ) {
        navigate(Screen.ReinforcementChapterPath(session, data, trainStart, volume, chapter, judgmentsByKpId))
    }

    fun loadLearn(
        session: StudentSession,
        data: DirectoryData,
        chapter: ChapterGroup,
        kp: KpNode,
        keepCurrent: Boolean = true,
        startWithVideo: Boolean = false,
    ) {
        if (!StudentAccessPolicy.canAccessKp(session, kp)) {
            navigate(accountUnavailableScreen("同步学习"))
            return
        }
        val loadingMessage = if (startWithVideo) "正在加载视频讲解..." else "正在加载知识卡片..."
        runWithLoading("同步学习", loadingMessage, keepCurrent = keepCurrent) {
            Screen.Learn(
                session = session,
                data = data,
                chapter = chapter,
                kp = kp,
                bundle = api.getLearnBundle(session.token, session.studentId, kp.id),
                chatMessages = learnChatMessages[kp.id] ?: chatHistoryStore.read(session.studentId, learnChatScope(kp.id)),
                startWithVideo = startWithVideo,
            )
        }
    }

    fun showHistoryDetail(session: StudentSession, record: AnswerHistoryRecord) {
        navigate(
            Screen.HistoryDetail(
                session = session,
                record = record,
            ),
        )
    }

    fun showReviewDetail(session: StudentSession, data: ReviewData, mistake: ReviewMistake) {
        ensureMainCacheFor(session)
        val availableData = cachedReview ?: data
        val availableMistake = if (mistake.isDetailLoaded) {
            mistake
        } else {
            availableData.groups
                .asSequence()
                .flatMap { it.mistakes.asSequence() }
                .firstOrNull { it.answerId == mistake.answerId && it.isDetailLoaded }
        }
        if (availableMistake != null) {
            navigate(
                Screen.ReviewDetail(
                    session = session,
                    data = availableData,
                    mistake = availableMistake,
                    tutorMessages = chatHistoryStore.read(
                        session.studentId,
                        questionChatScope(availableMistake.answerId),
                    ),
                ),
            )
            return
        }
        runWithLoading("错题复盘", "正在打开这道错题...") {
            val detail = api.getReviewMistake(session.token, mistake.answerId)
            val detailedReview = reviewWithLoadedMistake(availableData, detail)
            cacheReview(session, detailedReview)
            Screen.ReviewDetail(
                session = session,
                data = detailedReview,
                mistake = detail,
                tutorMessages = chatHistoryStore.read(session.studentId, questionChatScope(detail.answerId)),
            )
        }
    }

    /**
     * 巩固小练 draws from a smaller pool than 掌握评估. When it is empty, fall back to the
     * assessment set (what iOS offers for every point) instead of stranding the student on
     * "暂无可练题目". The flag says whether the returned set is an assessment.
     */
    private fun consolidationOrAssessment(session: StudentSession, kp: KpNode): Pair<PracticeSession, Boolean> {
        val practice = api.getPracticeSession(session.token, session.studentId, kp.id, 5)
        if (practice.questions.isNotEmpty()) return practice to false
        return api.getKpDiagnosticSession(session.token, session.studentId, kp.id, 3) to true
    }

    fun kpAssessmentProgress(session: StudentSession, kpId: String): KpAssessmentProgress? =
        kpAssessmentProgressStore.get(session.studentId, kpId)

    private fun shouldUseKpConsolidation(session: StudentSession, kp: KpNode): Boolean =
        shouldUseConsolidationPractice(kp, kpAssessmentProgress(session, kp.id))

    fun loadKpCheck(session: StudentSession, data: DirectoryData, chapter: ChapterGroup, kp: KpNode) {
        if (shouldUseKpConsolidation(session, kp)) {
            loadKpTrain(session, data, chapter, kp)
            return
        }
        if (!StudentAccessPolicy.canAccessKp(session, kp)) {
            navigate(accountUnavailableScreen("掌握评估"))
            return
        }
        runWithLoading("掌握评估", "正在按当前知识点组织评估题...") {
            val practice = api.getKpDiagnosticSession(session.token, session.studentId, kp.id, 3)
            if (practice.questions.isEmpty()) {
                Screen.Error("暂无可练题目", "当前知识点暂时没有可用于评估的题目。")
            } else {
                kpAssessmentProgressStore.markInProgress(session.studentId, kp.id)
                freshPracticeQuestionScreen(Screen.PracticeQuestionScreen(session, data, chapter, kp, practice, 0))
            }
        }
    }

    fun loadKpTrain(
        session: StudentSession,
        data: DirectoryData,
        chapter: ChapterGroup,
        kp: KpNode,
        keepCurrent: Boolean = true,
    ) {
        if (!StudentAccessPolicy.canAccessKp(session, kp)) {
            navigate(accountUnavailableScreen("巩固小练"))
            return
        }
        runWithLoading("巩固小练", "正在围绕当前知识点组织巩固题...", keepCurrent = keepCurrent,
            onError = ::stayOnEmptyPracticeSet) {
            val (practice, assessment) = consolidationOrAssessment(session, kp)
            if (practice.questions.isEmpty()) {
                throw NoPracticeQuestions("当前知识点暂时没有可用于巩固或评估的题目。")
            } else {
                if (assessment) kpAssessmentProgressStore.markInProgress(session.studentId, kp.id)
                freshPracticeQuestionScreen(Screen.PracticeQuestionScreen(session, data, chapter, kp, practice, 0))
            }
        }
    }

    fun loadReinforcementPractice(session: StudentSession, data: DirectoryData? = null) {
        if (!StudentAccessPolicy.canUseAdaptivePractice(session)) {
            navigate(accountUnavailableScreen("巩固提升"))
            return
        }
        runWithLoading("巩固提升", "正在根据你的薄弱点组织练习...") {
            val practice = api.getPracticeSession(session.token, session.studentId, null, 5)
            if (practice.questions.isEmpty()) {
                Screen.Error("暂无可练题目", "系统暂时没有找到适合当前画像的巩固提升题。")
            } else {
                val directory = data ?: api.getDirectory(session.token, session.studentId)
                val kp = KpNode(
                    id = "reinforcement",
                    name = "巩固提升",
                    volume = "综合练习",
                    chapter = "自适应巩固",
                    section = "按薄弱点组题",
                    mastery = 0.0,
                    status = "in_progress",
                )
                val chapter = ChapterGroup(kp.volume, kp.chapter, listOf(kp))
                freshPracticeQuestionScreen(Screen.PracticeQuestionScreen(
                    session = session,
                    data = directory,
                    chapter = chapter,
                    kp = kp,
                    practice = practice,
                    index = 0,
                    returnToReinforcement = true,
                ))
            }
        }
    }

    fun loadReinforcementChapterMixedPractice(
        session: StudentSession,
        data: DirectoryData,
        volume: String,
        chapterName: String,
        recommendedKpIds: List<String>,
    ) {
        if (!StudentAccessPolicy.canUseAdaptivePractice(session)) {
            navigate(accountUnavailableScreen("混合提升"))
            return
        }
        runWithLoading("混合提升", "正在从本章薄弱点组织混合练习...") {
            val chapterKps = data.kps.filter { it.volume == volume && it.chapter == chapterName }
            val targetKps = chapterMixedPracticeTargets(chapterKps, recommendedKpIds)
            val selectedQuestions = mutableListOf<PracticeQuestion>()
            val seenQuestionIds = mutableSetOf<String>()

            for (kp in targetKps) {
                val remaining = 5 - selectedQuestions.size
                if (remaining <= 0) break
                val count = if (selectedQuestions.size < 3) minOf(2, remaining) else 1
                val practice = api.getPracticeSession(session.token, session.studentId, kp.id, count)
                practice.questions.forEach { question ->
                    if (selectedQuestions.size < 5 && seenQuestionIds.add(question.id)) {
                        selectedQuestions += question
                    }
                }
            }

            if (selectedQuestions.isEmpty()) {
                Screen.Error("暂无可练题目", "当前章节暂时没有可用于混合提升的题目。")
            } else {
                val kp = KpNode(
                    id = "chapter-mixed:$volume:$chapterName",
                    name = "混合提升",
                    volume = volume,
                    chapter = chapterName,
                    section = "本章混合",
                    mastery = if (chapterKps.isEmpty()) 0.0 else chapterKps.sumOf { it.mastery } / chapterKps.size,
                    status = "in_progress",
                )
                val practice = PracticeSession(
                    objective = "$chapterName · 混合提升",
                    questions = selectedQuestions,
                    sessionType = "practice",
                    strategy = "chapter_mixed",
                )
                freshPracticeQuestionScreen(Screen.PracticeQuestionScreen(
                    session = session,
                    data = data,
                    chapter = ChapterGroup(volume, chapterName, chapterKps.ifEmpty { listOf(kp) }),
                    kp = kp,
                    practice = practice,
                    index = 0,
                    returnToReinforcement = true,
                ))
            }
        }
    }

    fun loadReinforcementKpPractice(session: StudentSession, data: DirectoryData, kp: KpNode) {
        if (!StudentAccessPolicy.canAccessKp(session, kp)) {
            navigate(accountUnavailableScreen("补齐薄弱点"))
            return
        }
        runWithLoading("补齐薄弱点", "正在按当前薄弱知识点组题...") {
            val practice = api.getPracticeSession(session.token, session.studentId, kp.id, 3)
            if (practice.questions.isEmpty()) {
                Screen.Error("暂无可练题目", "当前知识点暂时没有可用于巩固的题目。")
            } else {
                val chapter = chapterGroupFor(data, kp)
                freshPracticeQuestionScreen(Screen.PracticeQuestionScreen(
                    session = session,
                    data = data,
                    chapter = chapter,
                    kp = kp,
                    practice = practice,
                    index = 0,
                    returnToReinforcement = true,
                ))
            }
        }
    }

    fun loadReinforcementScopeDiagnostic(
        session: StudentSession,
        data: DirectoryData,
        volume: String,
        chapterName: String,
    ) {
        if (!StudentAccessPolicy.canUseAdaptivePractice(session)) {
            navigate(accountUnavailableScreen("本章定位"))
            return
        }
        runWithLoading("本章定位", "正在按本章知识点组织定位练习...") {
            val practice = api.getScopeDiagnosticSession(
                token = session.token,
                studentId = session.studentId,
                scopeType = "chapter",
                scopeId = chapterName,
                questionCount = 10,
            )
            if (practice.questions.isEmpty()) {
                Screen.Error("暂无可练题目", "当前章节暂时没有可用于定位的题目。")
            } else {
                val chapterKps = data.kps.filter { it.volume == volume && it.chapter == chapterName }
                val kp = KpNode(
                    id = "scope:$chapterName",
                    name = "本章定位",
                    volume = volume,
                    chapter = chapterName,
                    section = "本章定位",
                    mastery = 0.0,
                    status = "in_progress",
                )
                freshPracticeQuestionScreen(Screen.PracticeQuestionScreen(
                    session = session,
                    data = data,
                    chapter = ChapterGroup(volume, chapterName, chapterKps.ifEmpty { listOf(kp) }),
                    kp = kp,
                    practice = practice,
                    index = 0,
                    returnToReinforcement = true,
                    reinforcementContext = ReinforcementPracticeContext.ScopeDiagnostic(
                        scopeType = "chapter",
                        scopeId = chapterName,
                        scopeName = chapterName,
                    ),
                ))
            }
        }
    }

    fun loadReinforcementSectionDiagnostic(
        session: StudentSession,
        data: DirectoryData,
        volume: String,
        chapterName: String,
        sectionName: String,
    ) {
        val sectionKps = data.kps.filter { kp ->
            kp.volume == volume && kp.chapter == chapterName && kp.section == sectionName
        }
        if (sectionKps.isEmpty()) {
            navigate(Screen.Error("本节检测", "当前小节暂无可检测的知识点。"))
            return
        }
        if (!StudentAccessPolicy.hasFullLearningAccess(session) &&
            (!StudentAccessPolicy.canReadOwnHistory(session) ||
                sectionKps.isEmpty())
        ) {
            navigate(accountUnavailableScreen("本节检测"))
            return
        }
        val scopeId = "$chapterName||$sectionName"
        runWithLoading("本节检测", "正在按本节知识点组织检测题...") {
            val practice = api.getScopeDiagnosticSession(
                token = session.token,
                studentId = session.studentId,
                scopeType = "section",
                scopeId = scopeId,
                questionCount = 6,
            )
            if (practice.questions.isEmpty()) {
                Screen.Error("暂无可练题目", "当前小节暂时没有可用于检测的题目。")
            } else {
                val kp = KpNode(
                    id = "scope:$scopeId",
                    name = "本节检测",
                    volume = volume,
                    chapter = chapterName,
                    section = sectionName,
                    mastery = 0.0,
                    status = "in_progress",
                )
                freshPracticeQuestionScreen(Screen.PracticeQuestionScreen(
                    session = session,
                    data = data,
                    chapter = ChapterGroup(volume, chapterName, sectionKps),
                    kp = kp,
                    practice = practice,
                    index = 0,
                    returnToReinforcement = true,
                    reinforcementContext = ReinforcementPracticeContext.ScopeDiagnostic(
                        scopeType = "section",
                        scopeId = scopeId,
                        scopeName = sectionName,
                    ),
                ))
            }
        }
    }

    fun startImprovementTaskPractice(
        session: StudentSession,
        data: DirectoryData,
        plan: ImprovementPlan,
        task: ImprovementTask,
    ) {
        if (!StudentAccessPolicy.canUseAdaptivePractice(session)) {
            navigate(accountUnavailableScreen("专项练"))
            return
        }
        runWithLoading("专项练", "正在围绕「${task.kpName}」组织提升练习...") {
            val updatedPlan = api.updateImprovementTaskStatus(session.token, session.studentId, plan.id, task.id, "in_progress")
            val practice = api.getPracticeSession(session.token, session.studentId, task.kpId, 3)
            if (practice.questions.isEmpty()) {
                Screen.Error("暂无可练题目", "当前知识点暂时没有可用于专项提升的题目。")
            } else {
                val kp = kpForTask(data, task)
                freshPracticeQuestionScreen(Screen.PracticeQuestionScreen(
                    session = session,
                    data = data,
                    chapter = chapterGroupFor(data, kp),
                    kp = kp,
                    practice = practice.copy(objective = "专项练 · ${task.kpName}"),
                    index = 0,
                    returnToReinforcement = true,
                    reinforcementContext = ReinforcementPracticeContext.TaskPractice(
                        planId = updatedPlan.id,
                        taskId = task.id,
                    ),
                ))
            }
        }
    }

    fun startImprovementRetest(session: StudentSession, data: DirectoryData, plan: ImprovementPlan) {
        if (!StudentAccessPolicy.canUseAdaptivePractice(session)) {
            navigate(accountUnavailableScreen("阶段复测"))
            return
        }
        runWithLoading("阶段复测", "正在生成本轮提升的复测题...") {
            val retest = api.startImprovementRetest(session.token, session.studentId, plan.id)
            if (retest.session.questions.isEmpty()) {
                Screen.Error("暂无复测题目", "当前提升路径暂时没有可用于复测的题目。")
            } else {
                val kp = KpNode(
                    id = "retest:${plan.id}",
                    name = "阶段复测",
                    volume = "巩固提升",
                    chapter = plan.scopeName,
                    section = "阶段复测",
                    mastery = 0.0,
                    status = "in_progress",
                )
                freshPracticeQuestionScreen(Screen.PracticeQuestionScreen(
                    session = session,
                    data = data,
                    chapter = ChapterGroup(kp.volume, kp.chapter, listOf(kp)),
                    kp = kp,
                    practice = retest.session,
                    index = 0,
                    returnToReinforcement = true,
                    reinforcementContext = ReinforcementPracticeContext.Retest(
                        planId = retest.plan.id,
                        attemptId = retest.attemptId,
                    ),
                ))
            }
        }
    }

    fun showImprovementReport(session: StudentSession, data: DirectoryData, planId: String) {
        runWithLoading("提升报告", "正在整理本轮提升报告...") {
            Screen.ReinforcementReport(
                session = session,
                data = data,
                report = api.getImprovementReport(session.token, session.studentId, planId),
            )
        }
    }

    fun showImprovementReportHistory(session: StudentSession, data: DirectoryData) {
        runWithLoading("提升报告历史", "正在加载已完成的提升报告...") {
            Screen.ReinforcementReportHistory(
                session = session,
                data = data,
                reports = api.listImprovementReports(session.token, session.studentId, limit = 10, offset = 0),
            )
        }
    }

    fun loadMoreImprovementReportHistory(screen: Screen.ReinforcementReportHistory) {
        if (screen.reports.items.size >= screen.reports.total) return
        runWithLoading(
            title = "提升报告历史",
            message = "正在加载更多报告...",
            keepCurrent = reinforcementLoadMoreKeepsCurrentInBackStack(),
            keepCurrentOnError = reinforcementLoadMoreKeepsCurrentOnErrorInBackStack(),
        ) {
            val next = api.listImprovementReports(
                token = screen.session.token,
                studentId = screen.session.studentId,
                limit = screen.reports.limit.ifZero(10),
                offset = screen.reports.items.size,
            )
            screen.copy(
                reports = next.copy(
                    items = screen.reports.items + next.items,
                    offset = 0,
                ),
            )
        }
    }

    fun showScopeDiagnosticHistory(session: StudentSession, data: DirectoryData, keepCurrent: Boolean = true) {
        runWithLoading("检测历史", "正在加载章节检测记录...",
            keepCurrent = keepCurrent, keepCurrentOnError = true) {
            Screen.ReinforcementDiagnosticHistory(
                session = session,
                data = data,
                attempts = api.listScopeDiagnosticAttempts(session.token, session.studentId, limit = 10, offset = 0),
            )
        }
    }

    fun returnToScopeDiagnosticHistory(detail: Screen.ReinforcementDiagnosticAttemptDetail) {
        val historyIndex = diagnosticHistoryBackStackIndex(backStack, detail.session.studentId)
        if (historyIndex >= 0) {
            requestGeneration.invalidate()
            val history = backStack[historyIndex]
            backStack.subList(historyIndex, backStack.size).clear()
            screen = history
            return
        }
        // A detail can also be opened from the learning trace. Replace it instead of
        // pushing it under History, or Back would alternate between these two pages.
        showScopeDiagnosticHistory(detail.session, detail.data, keepCurrent = false)
    }

    fun loadMoreScopeDiagnosticHistory(screen: Screen.ReinforcementDiagnosticHistory) {
        if (screen.attempts.items.size >= screen.attempts.total) return
        runWithLoading(
            title = "检测历史",
            message = "正在加载更多检测记录...",
            keepCurrent = reinforcementLoadMoreKeepsCurrentInBackStack(),
            keepCurrentOnError = reinforcementLoadMoreKeepsCurrentOnErrorInBackStack(),
        ) {
            val next = api.listScopeDiagnosticAttempts(
                token = screen.session.token,
                studentId = screen.session.studentId,
                limit = screen.attempts.limit.ifZero(10),
                offset = screen.attempts.items.size,
            )
            screen.copy(
                attempts = next.copy(
                    items = screen.attempts.items + next.items,
                    offset = 0,
                ),
            )
        }
    }

    fun showScopeDiagnosticAttemptDetail(session: StudentSession, data: DirectoryData, attemptId: String) {
        if (attemptId.isBlank()) return
        runWithLoading("检测结果", "正在加载本次检测明细...") {
            Screen.ReinforcementDiagnosticAttemptDetail(
                session = session,
                data = data,
                detail = api.getScopeDiagnosticAttempt(session.token, session.studentId, attemptId),
            )
        }
    }

    fun rediagnoseFromAttempt(session: StudentSession, data: DirectoryData, detail: ScopeDiagnosticAttemptDetail) {
        when (detail.scopeType) {
            "chapter" -> {
                val chapterName = detail.scopeId.ifBlank { detail.scopeName }
                val volume = data.kps.firstOrNull { it.chapter == chapterName }?.volume ?: return
                loadReinforcementScopeDiagnostic(session, data, volume, chapterName)
            }
            "section" -> {
                val scopeParts = detail.scopeId.split("||", limit = 2)
                if (scopeParts.size != 2) return
                val (chapterName, sectionName) = scopeParts
                val volume = data.kps.firstOrNull {
                    it.chapter == chapterName && it.section == sectionName
                }?.volume ?: return
                loadReinforcementSectionDiagnostic(session, data, volume, chapterName, sectionName)
            }
        }
    }

    fun showLearningTrace(session: StudentSession, data: DirectoryData) {
        runWithLoading("学习轨迹", "正在加载检测、提升和复测轨迹...") {
            Screen.ReinforcementLearningTrace(
                session = session,
                data = data,
                trace = api.listLearningTrace(session.token, session.studentId, limit = 20, offset = 0),
            )
        }
    }

    fun loadMoreLearningTrace(screen: Screen.ReinforcementLearningTrace) {
        if (screen.trace.items.size >= screen.trace.total) return
        runWithLoading(
            title = "学习轨迹",
            message = "正在加载更多轨迹...",
            keepCurrent = reinforcementLoadMoreKeepsCurrentInBackStack(),
            keepCurrentOnError = reinforcementLoadMoreKeepsCurrentOnErrorInBackStack(),
        ) {
            val next = api.listLearningTrace(
                token = screen.session.token,
                studentId = screen.session.studentId,
                limit = screen.trace.limit.ifZero(20),
                offset = screen.trace.items.size,
            )
            screen.copy(
                trace = next.copy(
                    items = screen.trace.items + next.items,
                    offset = 0,
                ),
            )
        }
    }

    fun showImprovementPlan(session: StudentSession, data: DirectoryData, plan: ImprovementPlan) {
        navigate(
            Screen.ReinforcementScopeResult(
                session = session,
                data = data,
                result = scopeResultFromPlan(plan),
                plan = plan,
            ),
        )
    }

    fun continueAfterImprovementTaskComplete(screen: Screen.ReinforcementTaskComplete) {
        runWithLoading("专项练", "正在准备下一步提升任务...") {
            val movedPlan = api.moveToNextImprovementTask(
                token = screen.session.token,
                studentId = screen.session.studentId,
                planId = screen.plan.id,
            )
            val nextTask = movedPlan.currentTask()
            if (nextTask == null) {
                Screen.ReinforcementScopeResult(
                    session = screen.session,
                    data = screen.data,
                    result = scopeResultFromPlan(movedPlan),
                    plan = movedPlan,
                )
            } else {
                val practice = api.getPracticeSession(screen.session.token, screen.session.studentId, nextTask.kpId, 3)
                if (practice.questions.isEmpty()) {
                    Screen.Error("暂无可练题目", "当前知识点暂时没有可用于专项提升的题目。")
                } else {
                    val kp = kpForTask(screen.data, nextTask)
                    freshPracticeQuestionScreen(Screen.PracticeQuestionScreen(
                        session = screen.session,
                        data = screen.data,
                        chapter = chapterGroupFor(screen.data, kp),
                        kp = kp,
                        practice = practice.copy(objective = "专项练 · ${nextTask.kpName}"),
                        index = 0,
                        returnToReinforcement = true,
                        reinforcementContext = ReinforcementPracticeContext.TaskPractice(
                            planId = movedPlan.id,
                            taskId = nextTask.id,
                        ),
                    ))
                }
            }
        }
    }

    fun showImprovementPlan(session: StudentSession, data: DirectoryData, planId: String) {
        if (planId.isBlank()) return
        runWithLoading("提升路径", "正在加载已保存的提升路径...") {
            val plan = api.getImprovementPlan(session.token, session.studentId, planId)
            Screen.ReinforcementScopeResult(
                session = session,
                data = data,
                result = scopeResultFromPlan(plan),
                plan = plan,
            )
        }
    }

    fun loadReinforcementLearn(session: StudentSession, data: DirectoryData, kp: KpNode) {
        loadLearn(session, data, chapterGroupFor(data, kp), kp)
    }

    fun loadImprovementTaskLearn(session: StudentSession, data: DirectoryData, task: ImprovementTask) {
        loadReinforcementLearn(session, data, kpForTask(data, task))
    }

    fun completeLearningThenPractice(
        session: StudentSession,
        data: DirectoryData,
        chapter: ChapterGroup,
        kp: KpNode,
        bundle: LearnBundle,
    ) {
        if (!StudentAccessPolicy.canAccessKp(session, kp)) {
            navigate(accountUnavailableScreen("同步学习"))
            return
        }
        runWithLoading("同步学习", "正在记录学习进度并准备评估...", onError = ::stayOnEmptyPracticeSet) {
            val card = bundle.card
            if (card != null && !card.consumed) {
                api.markLearnComplete(session.token, session.studentId, card.toCompletionRequest(bundle.kpId.ifBlank { kp.id }))
            }
            val useConsolidation = shouldUseKpConsolidation(session, kp)
            val (practice, assessment) = if (useConsolidation) {
                consolidationOrAssessment(session, kp)
            } else {
                api.getKpDiagnosticSession(session.token, session.studentId, kp.id, 3) to true
            }
            if (practice.questions.isEmpty()) {
                throw NoPracticeQuestions("当前知识点暂时没有可用于评估的题目。")
            } else {
                if (assessment) kpAssessmentProgressStore.markInProgress(session.studentId, kp.id)
                freshPracticeQuestionScreen(Screen.PracticeQuestionScreen(session, data, chapter, kp, practice, 0))
            }
        }
    }

    fun submitAnswer(
        session: StudentSession,
        data: DirectoryData,
        chapter: ChapterGroup,
        kp: KpNode,
        practice: PracticeSession,
        index: Int,
        question: PracticeQuestion,
        answer: String,
        returnToHome: Boolean = false,
        returnToReinforcement: Boolean = false,
        reinforcementContext: ReinforcementPracticeContext? = null,
    ) {
        if (!canEditPracticeDraft(question.id)) return
        answerDrafts.set(question.id, answer)
        practiceReviewState.remove(question.id)
        val submissionId = answerDrafts.submissionId(question.id)
        answerDrafts.lockForSubmission(listOf(question.id))
        runWithLoadingRequest(
            "正在批改",
            "正在提交答案并更新学习画像...",
            onError = { e, _ -> Screen.Error("正在批改", practiceFailureMessage(e, "批改失败，请稍后重试")) },
        ) { requestId ->
            val result = api.submitAnswer(
                token = session.token,
                studentId = session.studentId,
                questionId = question.id,
                answer = answer,
                targetKnowledgePointId = question.targetKnowledgePointId.ifBlank { null },
                topicContext = question.topicContext,
                submissionId = submissionId,
            )
            val accepted = applyForCurrentRequest(requestId) {
                if (!answerDrafts.isCurrentSubmission(question.id, submissionId)) return@applyForCurrentRequest false
                practiceReviewState.record(question, answer, result)
                enqueueMasteryRefresh(session)
                releaseConfirmedMedia(question.id, submissionId)
                true
            }
            if (!accepted) throw CancellationException("作答状态已变化，请重新提交。")
            Screen.PracticeResultScreen(
                session, data, chapter, kp, practice, index, question, answer, result,
                tutorMessages = result.answerId?.let { chatHistoryStore.read(session.studentId, questionChatScope(it)) }.orEmpty(),
                returnToHome = returnToHome,
                returnToReinforcement = returnToReinforcement,
                reinforcementContext = reinforcementContext,
            )
        }
    }

    fun submitPhotoAnswer(
        session: StudentSession,
        data: DirectoryData,
        chapter: ChapterGroup,
        kp: KpNode,
        practice: PracticeSession,
        index: Int,
        question: PracticeQuestion,
        imageBytes: ByteArray,
        mimeType: String,
        returnToHome: Boolean = false,
        returnToReinforcement: Boolean = false,
        reinforcementContext: ReinforcementPracticeContext? = null,
    ) {
        if (!canEditPracticeDraft(question.id)) return
        val answer = "[图片作答]"
        val image = savePrivateImage(question.id, imageBytes, mimeType, "photo")
        answerDrafts.setPhoto(question.id, image)
        practiceReviewState.remove(question.id)
        val submissionId = answerDrafts.submissionId(question.id)
        answerDrafts.lockForSubmission(listOf(question.id))
        runWithLoadingRequest(
            "AI 批改",
            "正在上传作答图片并批改...",
            onError = { e, _ -> Screen.Error("AI 批改", practiceFailureMessage(e, "批改失败，请稍后重试")) },
        ) { requestId ->
            val result = api.submitPhotoAnswer(
                token = session.token,
                studentId = session.studentId,
                questionId = question.id,
                image = image,
                targetKnowledgePointId = question.targetKnowledgePointId.ifBlank { null },
                topicContext = question.topicContext,
                submissionId = submissionId,
            )
            val accepted = applyForCurrentRequest(requestId) {
                if (!answerDrafts.isCurrentSubmission(question.id, submissionId)) return@applyForCurrentRequest false
                practiceReviewState.record(question, answer, result)
                enqueueMasteryRefresh(session)
                releaseConfirmedMedia(question.id, submissionId)
                true
            }
            if (!accepted) throw CancellationException("作答状态已变化，请重新提交。")
            Screen.PracticeResultScreen(
                session, data, chapter, kp, practice, index, question, answer, result,
                tutorMessages = result.answerId?.let { chatHistoryStore.read(session.studentId, questionChatScope(it)) }.orEmpty(),
                returnToHome = returnToHome,
                returnToReinforcement = returnToReinforcement,
                reinforcementContext = reinforcementContext,
            )
        }
    }

    fun savePhotoDraft(questionId: String, imageBytes: ByteArray, mimeType: String) {
        if (!canEditPracticeDraft(questionId)) return
        answerDrafts.setPhoto(questionId, savePrivateImage(questionId, imageBytes, mimeType, "photo"))
        practiceReviewState.remove(questionId)
        scheduleActivePracticeRecovery(questionId, immediate = true)
    }

    fun clearPhotoDraft(questionId: String) {
        if (!canEditPracticeDraft(questionId)) return
        val removed = answerDrafts.removePhoto(questionId) ?: return
        pendingMediaCleanup[removed.path] = removed
        practiceReviewState.remove(questionId)
        scheduleActivePracticeRecovery(questionId, immediate = true)
    }

    fun saveHandwritingDraft(questionId: String, imageBytes: ByteArray, mimeType: String) {
        if (!canEditPracticeDraft(questionId)) return
        answerDrafts.setHandwriting(questionId, savePrivateImage(questionId, imageBytes, mimeType, "handwriting"))
        practiceReviewState.remove(questionId)
        scheduleActivePracticeRecovery(questionId, immediate = true)
    }

    fun saveScratchImageDraft(questionId: String, imageBytes: ByteArray?, mimeType: String) {
        if (!canEditPracticeDraft(questionId)) return
        if (imageBytes == null || imageBytes.isEmpty()) {
            answerDrafts.clearScratchImage(questionId)
            scheduleActivePracticeRecovery(questionId, immediate = true)
            return
        }
        answerDrafts.setScratchImage(questionId, savePrivateImage(questionId, imageBytes, mimeType, "scratch"))
        scheduleActivePracticeRecovery(questionId, immediate = true)
    }

    fun getDraftCanvasSnapshots(questionIds: List<String>): Map<String, DraftCanvasSnapshot> {
        val allowed = questionIds.toSet()
        return draftCanvasSnapshots.filterKeys { it in allowed }
    }

    fun saveDraftCanvasSnapshot(questionId: String, snapshot: DraftCanvasSnapshot) {
        if (!canEditPracticeDraft(questionId)) return
        val question = activeDraftQuestions().firstOrNull { it.id == questionId } ?: return
        if (practiceReviewState.itemFor(question) != null) return
        val previous = draftCanvasSnapshots[questionId]
        if (previous == snapshot || (previous == null && !snapshot.hasAnswerInk())) return
        if (!snapshot.hasAnswerInk()) {
            draftCanvasSnapshots.remove(questionId)
        } else {
            draftCanvasSnapshots[questionId] = snapshot
        }
        answerDrafts.invalidateCanvasMedia(questionId).forEach { pendingMediaCleanup[it.path] = it }
        scheduleCanvasRecovery(questionId)
    }

    fun preparePaperBatchImage(
        studentId: String,
        bytes: ByteArray,
        mimeType: String,
        fileName: String,
    ): PracticePaperBatchImage = privateImageStore.save(studentId, bytes, mimeType, fileName)

    fun savePaperBatchImages(screen: Screen.PracticeQuestionScreen, images: List<PracticePaperBatchImage>) {
        val current = this.screen as? Screen.PracticeQuestionScreen ?: return
        if (!current.practice.samePracticeAs(screen.practice) || current.session.studentId != screen.session.studentId) return
        if (current.submissionState.submitting || current.practice.teacherPaper?.status == "grading" ||
            current.practice.questions.any { answerDrafts.isLocked(it.id) }) return
        val next = current.copy(paperBatchImages = images.take(6))
        this.screen = next
        schedulePracticeRecovery(next, immediate = true)
    }

    private fun savePrivateImage(
        questionId: String,
        bytes: ByteArray,
        mimeType: String,
        kind: String,
    ): LocalImageFile {
        val studentId = sessionStore.read()?.studentId
            ?: error("Student session is required before saving an answer image")
        val extension = if (mimeType.contains("png")) "png" else "jpg"
        return privateImageStore.save(studentId, bytes, mimeType, "$kind-$questionId.$extension")
    }

    private fun exportPracticeHandwriting(studentId: String, question: PracticeQuestion, snapshot: DraftCanvasSnapshot): LocalImageFile {
        val background = snapshot.backgroundImage?.let { metadata ->
            val image = question.images.firstOrNull { it.imagePath == metadata.imagePath || it.imageUrl == metadata.imagePath }
                ?: error("手写题图与当前题目不一致，请重新打开本题后重试")
            DraftSnapshotExport.loadBackground(ResourceUrls.resolve(BuildConfig.API_BASE_URL, image.imageUrl.ifBlank { image.imagePath }))
        }
        return try {
            privateImageStore.save(studentId, DraftSnapshotExport.jpeg(snapshot, background), "image/jpeg", "handwriting-${question.id}.jpg")
        } finally {
            background?.recycle()
        }
    }

    private fun releaseConfirmedMedia(questionId: String, submissionId: String) {
        answerDrafts.clearSubmittedMedia(questionId, submissionId).forEach { pendingMediaCleanup[it.path] = it }
    }

    fun isPracticeAnswerEditingLocked(questionId: String): Boolean = !canEditPracticeDraft(questionId)

    private fun canEditPracticeDraft(questionId: String): Boolean {
        if (answerDrafts.isLocked(questionId)) return false
        return when (val current = screen) {
            is Screen.PracticeQuestionScreen -> {
                val question = current.practice.questions.firstOrNull { it.id == questionId } ?: return false
                !practiceAnswerEditingLocked(
                    teacherPaperStatus = current.practice.teacherPaper?.status,
                    submitting = current.submissionState.submitting,
                    hasSavedResult = practiceReviewState.itemFor(question) != null,
                )
            }
            is Screen.ReviewRetryQuestion -> current.question.id == questionId
            else -> false
        }
    }

    private fun cleanupUnreferencedMedia(savedSnapshot: PracticeRecoverySnapshot) {
        val references = answerDrafts.referencedMedia() + savedSnapshot.drafts.flatMap {
            listOfNotNull(it.photo, it.handwriting, it.scratchImage)
        } + savedSnapshot.screen.paperBatchImages +
            (screen as? Screen.PracticeQuestionScreen)?.paperBatchImages.orEmpty() +
            backStack.filterIsInstance<Screen.PracticeQuestionScreen>().flatMap { it.paperBatchImages }
        unreferencedPracticeMedia(pendingMediaCleanup.values.toList(), references).forEach {
            privateImageStore.delete(it)
            pendingMediaCleanup.remove(it.path)
        }
    }

    fun goToPracticeQuestion(screen: Screen.PracticeQuestionScreen, index: Int) {
        val current = this.screen as? Screen.PracticeQuestionScreen ?: return
        if (current.submissionState.submitting || current.practice.questions.any { answerDrafts.isLocked(it.id) }) return
        if (!current.practice.samePracticeAs(screen.practice) || current.session.studentId != screen.session.studentId) return
        val next = screen.copy(
            index = index.coerceIn(0, screen.practice.questions.lastIndex),
            questionStartedAtMs = System.currentTimeMillis(),
        )
        this.screen = next
        schedulePracticeRecovery(next, immediate = true)
    }

    var pendingPracticeExit by mutableStateOf<Screen?>(null)
        private set

    fun pendingPracticeExitDropsKpSummary(): Boolean {
        val pending = pendingPracticeExit as? Screen.PracticeQuestionScreen ?: return false
        return kpAssessmentSummaryPending(
            pending.practice,
            practiceReviewState.reviewFor(pending.practice.questions),
            kpAssessmentProgressStore.get(pending.session.studentId, pending.kp.id),
        )
    }

    fun cancelPracticeExit() { pendingPracticeExit = null }

    fun confirmPracticeExit() {
        val pending = pendingPracticeExit ?: return
        pendingPracticeExit = null
        if (pending is Screen.ReviewRetryQuestion) {
            if ((screen as? Screen.ReviewRetryQuestion)?.question?.id != pending.question.id ||
                answerDrafts.isLocked(pending.question.id)) return
            answerDrafts.clearSession(listOf(pending.question.id))
            draftCanvasSnapshots.remove(pending.question.id)
            clearPracticeRecovery(pending.session.studentId)
            if (!goBackWithoutPracticeGuard()) showHome(pending.session)
            return
        }
        if (pending !is Screen.PracticeQuestionScreen) return
        val current = screen as? Screen.PracticeQuestionScreen ?: return
        if (!current.practice.samePracticeAs(pending.practice) || current.session.studentId != pending.session.studentId) return
        if (current.submissionState.submitting || current.practice.questions.any { answerDrafts.isLocked(it.id) }) return
        clearCompletedPracticeState(current.session, current.practice)
        // Leave the old screen before loading a destination, otherwise that loader
        // would persist the very practice the student just discarded.
        if (current.returnToReinforcement || current.reinforcementContext != null) {
            returnFromReinforcementPractice(current)
            return
        }
        showHome(current.session)
        current.learningCatalogContext?.let { openLearningCatalogTopic(current.session, it) }
    }

    fun leavePractice(practiceScreen: Screen.PracticeQuestionScreen) {
        val current = screen as? Screen.PracticeQuestionScreen ?: return
        if (!current.practice.samePracticeAs(practiceScreen.practice) || current.session.studentId != practiceScreen.session.studentId) return
        if (current.submissionState.submitting || current.practice.questions.any { answerDrafts.isLocked(it.id) }) return
        val pendingCount = practiceReviewState.pendingQuestions(current.practice.questions).size
        val summaryPending = kpAssessmentSummaryPending(
            current.practice,
            practiceReviewState.reviewFor(current.practice.questions),
            kpAssessmentProgressStore.get(current.session.studentId, current.kp.id),
        )
        if (practiceExitNeedsConfirmation(current.practice, pendingCount) || summaryPending) {
            pendingPracticeExit = current
            return
        }
        if (current.returnToReinforcement || current.reinforcementContext != null) {
            clearCompletedPracticeState(current.session, current.practice)
            returnFromReinforcementPractice(current)
            return
        }
        val context = practiceScreen.learningCatalogContext
        if (context == null) {
            showHome(practiceScreen.session)
            return
        }
        if (practiceScreen.practice.teacherPaper != null) {
            schedulePracticeRecovery(practiceScreen, immediate = true)
        } else {
            clearCompletedPracticeState(practiceScreen.session, practiceScreen.practice)
        }
        openLearningCatalogTopic(practiceScreen.session, context)
    }

    private fun returnFromReinforcementPractice(practiceScreen: Screen.PracticeQuestionScreen) {
        pendingPracticeExit = null
        val destinationIndex = backStack.indexOfLast { previous ->
            when (previous) {
                is Screen.ReinforcementHome -> previous.session.studentId == practiceScreen.session.studentId
                is Screen.ReinforcementChapterPath -> previous.session.studentId == practiceScreen.session.studentId
                is Screen.ReinforcementScopeResult -> previous.session.studentId == practiceScreen.session.studentId
                is Screen.ReinforcementRetestResult -> previous.session.studentId == practiceScreen.session.studentId
                is Screen.ReinforcementTaskComplete -> previous.session.studentId == practiceScreen.session.studentId
                is Screen.ReinforcementReport -> previous.session.studentId == practiceScreen.session.studentId
                is Screen.ReinforcementReportHistory -> previous.session.studentId == practiceScreen.session.studentId
                is Screen.ReinforcementDiagnosticHistory -> previous.session.studentId == practiceScreen.session.studentId
                is Screen.ReinforcementDiagnosticAttemptDetail -> previous.session.studentId == practiceScreen.session.studentId
                is Screen.ReinforcementLearningTrace -> previous.session.studentId == practiceScreen.session.studentId
                else -> false
            }
        }
        if (destinationIndex >= 0) {
            val destination = backStack[destinationIndex].withStudentSession(practiceScreen.session)
            requestGeneration.invalidate()
            backStack.subList(destinationIndex, backStack.size).clear()
            screen = destination
        } else {
            showHome(practiceScreen.session)
            loadReinforcementHome(practiceScreen.session, asRoot = true)
        }
    }

    fun submitPracticeSet(requestedScreen: Screen.PracticeQuestionScreen) {
        val screen = this.screen as? Screen.PracticeQuestionScreen ?: return
        if (!screen.practice.samePracticeAs(requestedScreen.practice) || screen.session.studentId != requestedScreen.session.studentId) return
        if (screen.submissionState.submitting || screen.practice.questions.any { answerDrafts.isLocked(it.id) }) return
        if (
            screen.reinforcementContext is ReinforcementPracticeContext.TaskPractice ||
            (screen.practice.teacherPaper == null && screen.learningCatalogContext?.layer?.let { !it.defersGrading() } == true)
        ) {
            submitPracticeQuestion(screen)
            return
        }
        if (screen.submissionState.submitting) return
        val elapsedMs = practiceQuestionElapsedMs(screen.questionStartedAtMs)
        val pendingQuestions = if (screen.practice.sessionType == PracticeSessionTypes.KpDiagnostic) {
            kpQuestionsMissingReceipt(screen.practice, practiceReviewState.reviewFor(screen.practice.questions))
        } else {
            practiceReviewState.pendingQuestions(screen.practice.questions)
        }
        val pendingDrafts = pendingQuestions.map { question ->
            PracticeSubmission(
                question = question,
                answer = answerDrafts.get(question.id),
                handwriting = answerDrafts.getHandwriting(question.id),
                photo = answerDrafts.getPhoto(question.id),
                scratchImage = answerDrafts.getScratchImage(question.id),
                selfReview = answerDrafts.getSelfReview(question.id),
                timeSpentMs = elapsedMs,
                submissionId = answerDrafts.submissionId(question.id),
                teacherPaperAttemptId = screen.practice.teacherPaper?.attemptId?.ifBlank { null },
            )
        }
        val submittingScreen = screen.copy(
            practice = screen.practice.copy(teacherPaper = screen.practice.teacherPaper?.copy(status = "grading")),
            submissionState = PracticeSetSubmissionState(
                submitting = true,
                phase = PracticeSubmissionPhase.PreparingImages,
                completed = screen.practice.questions.size - pendingDrafts.size,
                total = screen.practice.questions.size,
            ),
        )
        val frozenSnapshots = getDraftCanvasSnapshots(pendingQuestions.map { it.id })
        val requestId = requestGeneration.begin()
        answerDrafts.lockForSubmission(pendingDrafts.map { it.question.id })
        this.screen = submittingScreen
        val submissionSnapshot = recoverySnapshot(submittingScreen)
        schedulePracticeRecovery(submittingScreen, immediate = true)
        executor.execute {
            val exportedMedia = mutableListOf<LocalImageFile>()
            try {
                persistBeforeSubmission(submissionSnapshot, requestId)
                val pendingSubmissions = PracticeHandwritingPreparation.prepare(pendingDrafts, frozenSnapshots) { question, snapshot ->
                    if (!requestGeneration.isCurrent(requestId)) throw CancellationException()
                    exportPracticeHandwriting(screen.session.studentId, question, snapshot).also { exportedMedia += it }
                }
                var preparedRecovery: PracticeRecoverySnapshot? = null
                val prepared = applyForCurrentRequest(requestId) {
                    if (!pendingSubmissions.all(answerDrafts::cachePreparedSubmission)) return@applyForCurrentRequest false
                    val current = this.screen as? Screen.PracticeQuestionScreen ?: return@applyForCurrentRequest false
                    this.screen = current.copy(submissionState = current.submissionState.copy(phase = PracticeSubmissionPhase.Grading))
                    preparedRecovery = recoverySnapshot(this.screen as Screen.PracticeQuestionScreen)
                    true
                }
                if (!prepared) throw CancellationException()
                persistBeforeSubmission(checkNotNull(preparedRecovery), requestId)
                screen.practice.teacherPaper?.attemptId?.takeIf { it.isNotBlank() }?.let {
                    api.submitTeacherPaperAttempt(screen.session.token, it)
                }
                val batch = PracticeSubmissionBatchRunner.submitConcurrently(
                    submissions = pendingSubmissions,
                    concurrency = practiceSetGradingConcurrencyLimit(),
                    submit = { submission ->
                        if (!requestGeneration.isCurrent(requestId)) throw CancellationException()
                        val outcome = PracticeSubmissionDispatcher.submitOne(
                            api = api,
                            token = screen.session.token,
                            studentId = screen.session.studentId,
                            submission = submission,
                        )
                        if (screen.practice.sessionType == PracticeSessionTypes.KpDiagnostic && outcome.result.answerId == null) {
                            error("评估答案尚未获得保存凭证，请重试")
                        }
                        outcome
                    },
                    onSuccess = { outcome ->
                        val accepted = applyForCurrentRequest(requestId) {
                            val questionId = outcome.submission.question.id
                            if (!answerDrafts.isCurrentSubmission(questionId, outcome.submission.submissionId)) {
                                return@applyForCurrentRequest false
                            }
                            practiceReviewState.record(outcome.submission.question, outcome.answer, outcome.result)
                            enqueueMasteryRefresh(screen.session)
                            releaseConfirmedMedia(questionId, outcome.submission.submissionId)
                            true
                        }
                        if (!accepted) throw CancellationException("作答状态已变化，请重新提交。")
                        synchronizeLearningCatalogEvidence(
                            session = screen.session,
                            context = screen.learningCatalogContext,
                            result = outcome.result,
                        )
                        postForRequest(requestId) {
                            val current = this.screen
                            if (current is Screen.PracticeQuestionScreen && current.practice.samePracticeAs(screen.practice)) {
                                val state = current.submissionState
                                this.screen = current.copy(
                                    submissionState = state.copy(
                                        completed = (state.completed + 1).coerceAtMost(state.total),
                                    ),
                                )
                                schedulePracticeRecovery(this.screen as Screen.PracticeQuestionScreen, immediate = true)
                            }
                        }
                    },
                )
                if (batch.failures.isNotEmpty()) {
                    val currentReview = practiceReviewState.reviewFor(screen.practice.questions)
                    val completed = if (screen.practice.sessionType == PracticeSessionTypes.KpDiagnostic) {
                        screen.practice.questions.size - kpQuestionsMissingReceipt(screen.practice, currentReview).size
                    } else currentReview.items.size
                    val remaining = (screen.practice.questions.size - completed).coerceAtLeast(0)
                    val failureMessage = practiceFailureMessage(batch.failures.first().error, "批改失败，请稍后重试")
                    postForRequest(requestId) {
                        answerDrafts.unlockAfterSubmission(pendingDrafts.map { it.question.id })
                        val current = this.screen
                        if (current is Screen.PracticeQuestionScreen && current.practice.samePracticeAs(screen.practice)) {
                            this.screen = current.copy(
                                submissionState = PracticeSetSubmissionState(
                                    submitting = false,
                                    completed = completed,
                                    total = screen.practice.questions.size,
                                    error = "$failureMessage 已完成 $completed/${screen.practice.questions.size}，剩余 $remaining 题可重试。",
                                ),
                            )
                            schedulePracticeRecovery(this.screen as Screen.PracticeQuestionScreen, immediate = true)
                        }
                    }
                    return@execute
                }
                if (screen.practice.teacherPaper != null && screen.learningCatalogContext != null) {
                    val next = refreshedTeacherPaperResult(screen.session, screen.learningCatalogContext, screen.practice)
                    postForRequest(requestId) {
                        answerDrafts.unlockAfterSubmission(pendingDrafts.map { it.question.id })
                        this.screen = next
                    }
                    return@execute
                }
                postForRequest(requestId) {
                    val current = this.screen as? Screen.PracticeQuestionScreen
                    if (current != null) this.screen = current.copy(
                        submissionState = current.submissionState.copy(phase = PracticeSubmissionPhase.Finalizing),
                    )
                }
                val review = practiceReviewState.reviewFor(screen.practice.questions)
                val feedback = if (screen.reinforcementContext == null && screen.learningCatalogContext == null) {
                    diagnosticFeedbackForCompletion(screen.session, screen.kp, screen.practice, review)
                } else {
                    null
                }
                val completedReview = review.withDiagnosticFeedback(feedback)
                val reviewScreen = Screen.PracticeReviewScreen(
                    session = screen.session,
                    data = screen.data,
                    chapter = screen.chapter,
                    kp = screen.kp,
                    practice = screen.practice,
                    review = completedReview,
                    returnToHome = screen.returnToHome,
                    returnToReinforcement = screen.returnToReinforcement,
                    reinforcementContext = screen.reinforcementContext,
                    learningCatalogContext = screen.learningCatalogContext,
                )
                val resultScreen = practiceSetCompletionResultIndex(
                    currentIndex = screen.index,
                    questions = screen.practice.questions,
                    review = completedReview,
                )?.let { resultIndex ->
                    screen.practice.questions.getOrNull(resultIndex)?.let { currentQuestion ->
                        completedReview.itemFor(currentQuestion)?.let { item ->
                            Screen.PracticeResultScreen(
                                session = screen.session,
                                data = screen.data,
                                chapter = screen.chapter,
                                kp = screen.kp,
                                practice = screen.practice,
                                index = resultIndex,
                                question = item.question,
                                answer = item.answer,
                                result = item.result,
                                tutorMessages = item.result.answerId?.let {
                                    chatHistoryStore.read(screen.session.studentId, questionChatScope(it))
                                }.orEmpty(),
                                returnToHome = screen.returnToHome,
                                returnToReinforcement = screen.returnToReinforcement,
                                reinforcementContext = screen.reinforcementContext,
                                learningCatalogContext = screen.learningCatalogContext,
                                diagnosticFeedback = completedReview.diagnosticFeedback,
                                summaryAutoOpen = screen.reinforcementContext == null,
                            )
                        }
                    }
                }
                val next: Screen = when (practicePostGradingDestination(resultScreen != null, screen.reinforcementContext)) {
                    PracticePostGradingDestination.QuestionResult -> resultScreen ?: reviewScreen
                    PracticePostGradingDestination.ReinforcementSummary -> {
                        val reviewBeforeSummary = reviewBeforeReinforcementSummary(screen.reinforcementContext)
                        val completion = reinforcementCompletionScreen(
                            session = screen.session,
                            data = screen.data,
                            practice = screen.practice,
                            review = completedReview,
                            context = screen.reinforcementContext,
                            clearCompletedState = !reviewBeforeSummary,
                        )
                        if (reviewBeforeSummary && completion != null) {
                            resultScreen?.copy(preparedReinforcementCompletion = completion)
                                ?: reviewScreen.copy(preparedReinforcementCompletion = completion)
                        } else completion ?: reviewScreen
                    }
                    PracticePostGradingDestination.PracticeSummary -> reviewScreen
                }
                postForRequest(requestId) {
                    answerDrafts.unlockAfterSubmission(pendingDrafts.map { it.question.id })
                    if (next is Screen.PracticeResultScreen) {
                        schedulePracticeRecovery(submittingScreen, immediate = true)
                    } else if (next is Screen.PracticeReviewScreen) {
                        clearPracticeRecovery(next.session.studentId)
                    }
                    this.screen = next
                }
            } catch (e: Exception) {
                postForRequest(requestId) {
                    answerDrafts.unlockAfterSubmission(pendingDrafts.map { it.question.id })
                    exportedMedia.forEach { pendingMediaCleanup[it.path] = it }
                    val current = this.screen
                    if (current is Screen.PracticeQuestionScreen && current.practice.samePracticeAs(screen.practice)) {
                        this.screen = current.copy(
                            submissionState = PracticeSetSubmissionState(
                                submitting = false,
                                completed = practiceReviewState.reviewFor(screen.practice.questions).items.size,
                                total = screen.practice.questions.size,
                                phase = current.submissionState.phase,
                                error = practiceFailureMessage(e, when (current.submissionState.phase) {
                                    PracticeSubmissionPhase.PreparingImages -> "手写图片准备失败，草稿已保留，请重试"
                                    PracticeSubmissionPhase.Finalizing -> "检测结果保存失败，已批改答案已保留，请重试"
                                    PracticeSubmissionPhase.Grading -> "批改失败，请稍后重试"
                                }),
                            ),
                        )
                        schedulePracticeRecovery(this.screen as Screen.PracticeQuestionScreen, immediate = true)
                    } else {
                        this.screen = Screen.Error("正在批改", practiceFailureMessage(e, "批改失败，请稍后重试"))
                    }
                }
            }
        }
    }

    private fun submitPracticeQuestion(screen: Screen.PracticeQuestionScreen) {
        if (screen.submissionState.submitting) return
        val question = screen.practice.questions.getOrNull(screen.index) ?: return
        val submission = answerDrafts.toSubmission(
            question,
            timeSpentMs = practiceQuestionElapsedMs(screen.questionStartedAtMs),
        )
        val submittingScreen = screen.copy(
            submissionState = PracticeSetSubmissionState(
                submitting = true,
                completed = 0,
                total = 1,
            ),
        )
        val requestId = requestGeneration.begin()
        answerDrafts.lockForSubmission(listOf(question.id))
        this.screen = submittingScreen
        val submissionSnapshot = recoverySnapshot(submittingScreen)
        schedulePracticeRecovery(submittingScreen, immediate = true)
        executor.execute {
            try {
                persistBeforeSubmission(submissionSnapshot, requestId)
                val outcome = PracticeSubmissionDispatcher.submitOne(
                    api = api,
                    token = screen.session.token,
                    studentId = screen.session.studentId,
                    submission = submission,
                )
                val accepted = applyForCurrentRequest(requestId) {
                    if (!answerDrafts.isCurrentSubmission(question.id, submission.submissionId)) {
                        return@applyForCurrentRequest false
                    }
                    practiceReviewState.record(outcome.submission.question, outcome.answer, outcome.result)
                    enqueueMasteryRefresh(screen.session)
                    releaseConfirmedMedia(question.id, submission.submissionId)
                    true
                }
                if (!accepted) throw CancellationException("作答状态已变化，请重新提交。")
                synchronizeLearningCatalogEvidence(
                    session = screen.session,
                    context = screen.learningCatalogContext,
                    result = outcome.result,
                )
                val resultScreen = Screen.PracticeResultScreen(
                    session = screen.session,
                    data = screen.data,
                    chapter = screen.chapter,
                    kp = screen.kp,
                    practice = screen.practice,
                    index = screen.index,
                    question = outcome.submission.question,
                    answer = outcome.answer,
                    result = outcome.result,
                    tutorMessages = outcome.result.answerId?.let {
                        chatHistoryStore.read(screen.session.studentId, questionChatScope(it))
                    }.orEmpty(),
                    returnToHome = screen.returnToHome,
                    returnToReinforcement = screen.returnToReinforcement,
                    reinforcementContext = screen.reinforcementContext,
                    learningCatalogContext = screen.learningCatalogContext,
                )
                postForRequest(requestId) {
                    answerDrafts.unlockAfterSubmission(listOf(question.id))
                    schedulePracticeRecovery(submittingScreen, immediate = true)
                    this.screen = resultScreen
                }
            } catch (e: Exception) {
                postForRequest(requestId) {
                    answerDrafts.unlockAfterSubmission(listOf(question.id))
                    val current = this.screen
                    if (current is Screen.PracticeQuestionScreen && current.practice.samePracticeAs(screen.practice)) {
                        this.screen = current.copy(
                            submissionState = PracticeSetSubmissionState(
                                submitting = false,
                                error = practiceFailureMessage(e, "批改失败，请稍后重试"),
                            ),
                        )
                    } else {
                        this.screen = Screen.Error("正在批改", practiceFailureMessage(e, "批改失败，请稍后重试"))
                    }
                }
            }
        }
    }

    fun submitPracticePaperBatch(screen: Screen.PracticeQuestionScreen, images: List<PracticePaperBatchImage>) {
        if (images.isEmpty()) return
        val current = this.screen as? Screen.PracticeQuestionScreen ?: return
        if (!current.practice.samePracticeAs(screen.practice) || current.session.studentId != screen.session.studentId) return
        if (current.submissionState.submitting || current.practice.questions.any { answerDrafts.isLocked(it.id) }) return
        val batchImages = images.take(6)
        val pendingQuestions = if (current.practice.sessionType == PracticeSessionTypes.KpDiagnostic) {
            kpQuestionsMissingReceipt(current.practice, practiceReviewState.reviewFor(current.practice.questions))
        } else {
            practiceReviewState.pendingQuestions(current.practice.questions)
        }
        if (current.paperBatchSubmission == null && pendingQuestions.size < current.practice.questions.size) {
            this.screen = current.copy(paperBatchImages = emptyList(), submissionState = PracticeSetSubmissionState(
                error = "已有部分题目完成批改，请继续按题重试未完成部分；本次不能切换为整套照片批改。"))
            return
        }
        if (current.practice.teacherPaper?.status == "grading" && current.paperBatchImages.map { it.contentHash } != batchImages.map { it.contentHash }) return
        val identity = PracticePaperBatchSubmission.forImages(
            current.paperBatchSubmission,
            paperBatchSubmissionKey(current.practice.questions.map { it.id }, batchImages),
        )
        val preparedScreen = current.copy(paperBatchImages = batchImages, paperBatchSubmission = identity,
            submissionState = PracticeSetSubmissionState(submitting = true,
                completed = current.practice.questions.size - pendingQuestions.size, total = current.practice.questions.size),
            practice = current.practice.copy(teacherPaper = current.practice.teacherPaper?.copy(status = "grading")))
        val draftVersions = current.practice.questions.associate { it.id to answerDrafts.submissionId(it.id) }
        answerDrafts.lockForSubmission(current.practice.questions.map { it.id })
        this.screen = preparedScreen
        runWithLoadingRequest(
            "纸笔批改",
            "正在上传整套纸笔作答并批改...",
            keepCurrent = false,
            keepCurrentOnError = true,
            inlinePracticeProgress = true,
            onError = { e, _ ->
                val currentReview = practiceReviewState.reviewFor(preparedScreen.practice.questions)
                val completed = if (preparedScreen.practice.sessionType == PracticeSessionTypes.KpDiagnostic) {
                    preparedScreen.practice.questions.size - kpQuestionsMissingReceipt(preparedScreen.practice, currentReview).size
                } else currentReview.items.size
                val phase = if (completed == preparedScreen.practice.questions.size &&
                    preparedScreen.practice.sessionType == PracticeSessionTypes.KpDiagnostic
                ) PracticeSubmissionPhase.Finalizing else PracticeSubmissionPhase.Grading
                val failedScreen = preparedScreen.copy(
                    paperBatchImages = images,
                    submissionState = PracticeSetSubmissionState(
                        completed = completed,
                        total = preparedScreen.practice.questions.size,
                        phase = phase,
                        error = practiceFailureMessage(e, "批改失败，请稍后重试"),
                    ),
                )
                schedulePracticeRecovery(failedScreen, immediate = true)
                failedScreen
            },
        ) { requestId ->
            persistBeforeSubmission(recoverySnapshot(preparedScreen), requestId)
            preparedScreen.practice.teacherPaper?.attemptId?.takeIf { it.isNotBlank() }?.let {
                api.submitTeacherPaperAttempt(preparedScreen.session.token, it)
            }
            val response = if (pendingQuestions.isEmpty()) null else api.submitPaperBatch(
                token = preparedScreen.session.token,
                studentId = preparedScreen.session.studentId,
                images = images.take(6),
                questionIds = preparedScreen.practice.questions.map { it.id },
                timeSpentMs = practiceQuestionElapsedMs(preparedScreen.questionStartedAtMs),
                targetKnowledgePointIds = preparedScreen.practice.questions
                    .filter { it.targetKnowledgePointId.isNotBlank() }
                    .associate { it.id to it.targetKnowledgePointId },
                submissionId = identity.submissionId,
                teacherPaperAttemptId = preparedScreen.practice.teacherPaper?.attemptId?.ifBlank { null },
                topicContext = preparedScreen.practice.questions.firstOrNull()?.topicContext,
            )
            preparedScreen.practice.questions.forEach { question ->
                response?.results?.get(question.id)?.takeIf { result ->
                    preparedScreen.practice.sessionType != PracticeSessionTypes.KpDiagnostic || result.answerId != null
                }?.let { result ->
                    val accepted = applyForCurrentRequest(requestId) {
                        if (!answerDrafts.isCurrentSubmission(question.id, draftVersions.getValue(question.id))) {
                            return@applyForCurrentRequest false
                        }
                        practiceReviewState.record(
                            question = question,
                            answer = result.extractedAnswer.ifBlank { "[整套纸笔照片]" },
                            result = result,
                        )
                        enqueueMasteryRefresh(preparedScreen.session)
                        true
                    }
                    if (!accepted) throw CancellationException("作答状态已变化，请重新提交。")
                    synchronizeLearningCatalogEvidence(
                        session = preparedScreen.session,
                        context = preparedScreen.learningCatalogContext,
                        result = result,
                    )
                }
            }
            val review = practiceReviewState.reviewFor(preparedScreen.practice.questions)
            if (review.items.isNotEmpty() && review.items.size < preparedScreen.practice.questions.size) {
                val completed = review.items.size
                val remaining = (preparedScreen.practice.questions.size - completed).coerceAtLeast(0)
                return@runWithLoadingRequest preparedScreen.copy(
                    paperBatchImages = images,
                    submissionState = PracticeSetSubmissionState(
                        submitting = false,
                        completed = completed,
                        total = preparedScreen.practice.questions.size,
                        error = "整套纸笔批改已完成 $completed/${preparedScreen.practice.questions.size}，剩余 $remaining 题可直接重试，已完成题目不会重复批改。",
                    ),
                )
            }
            if (review.items.isEmpty()) {
                preparedScreen.copy(
                    paperBatchImages = images,
                    submissionState = PracticeSetSubmissionState(
                        error = response?.errors?.values?.firstOrNull()
                            ?: "未能从整套照片中识别到可批改的题目，请重新拍摄清晰图片。",
                    ),
                )
            } else {
                if (preparedScreen.practice.teacherPaper != null && preparedScreen.learningCatalogContext != null &&
                    review.items.size == preparedScreen.practice.questions.size) {
                    return@runWithLoadingRequest refreshedTeacherPaperResult(preparedScreen.session, preparedScreen.learningCatalogContext, preparedScreen.practice)
                }
                val answerMediaPaths = answerDrafts.snapshots(preparedScreen.practice.questions.map { it.id })
                    .flatMap { listOfNotNull(it.photo, it.handwriting, it.scratchImage) }
                    .mapTo(mutableSetOf()) { it.path }
                images.filterNot { it.path in answerMediaPaths }.forEach { pendingMediaCleanup[it.path] = it }
                val completedReview = review.withDiagnosticFeedback(
                    if (preparedScreen.reinforcementContext == null && preparedScreen.learningCatalogContext == null) {
                        diagnosticFeedbackForCompletion(preparedScreen.session, preparedScreen.kp, preparedScreen.practice, review)
                    } else {
                        null
                    },
                )
                val summaryDestination = completedReview.items.size == preparedScreen.practice.questions.size &&
                    practicePostGradingDestination(true, preparedScreen.reinforcementContext) == PracticePostGradingDestination.ReinforcementSummary
                val reviewBeforeSummary = reviewBeforeReinforcementSummary(preparedScreen.reinforcementContext)
                val preparedCompletion = if (summaryDestination) {
                    reinforcementCompletionScreen(
                        preparedScreen.session, preparedScreen.data, preparedScreen.practice,
                        completedReview, preparedScreen.reinforcementContext,
                        clearCompletedState = !reviewBeforeSummary,
                    )
                } else null
                if (summaryDestination && !reviewBeforeSummary) {
                    return@runWithLoadingRequest checkNotNull(preparedCompletion)
                }
                practiceSetCompletionResultIndex(
                    currentIndex = preparedScreen.index,
                    questions = preparedScreen.practice.questions,
                    review = completedReview,
                )?.let { resultIndex ->
                    preparedScreen.practice.questions.getOrNull(resultIndex)?.let { question ->
                        completedReview.itemFor(question)?.let { item ->
                            Screen.PracticeResultScreen(
                                session = preparedScreen.session,
                                data = preparedScreen.data,
                                chapter = preparedScreen.chapter,
                                kp = preparedScreen.kp,
                                practice = preparedScreen.practice,
                                index = resultIndex,
                                question = item.question,
                                answer = item.answer,
                                result = item.result,
                                tutorMessages = item.result.answerId?.let {
                                    chatHistoryStore.read(preparedScreen.session.studentId, questionChatScope(it))
                                }.orEmpty(),
                                returnToHome = preparedScreen.returnToHome,
                                returnToReinforcement = preparedScreen.returnToReinforcement,
                                reinforcementContext = preparedScreen.reinforcementContext,
                                learningCatalogContext = preparedScreen.learningCatalogContext,
                                diagnosticFeedback = completedReview.diagnosticFeedback,
                                summaryAutoOpen = preparedScreen.reinforcementContext == null,
                                preparedReinforcementCompletion = preparedCompletion,
                            )
                        }
                    }
                } ?: Screen.PracticeReviewScreen(
                    session = preparedScreen.session,
                    data = preparedScreen.data,
                    chapter = preparedScreen.chapter,
                    kp = preparedScreen.kp,
                    practice = preparedScreen.practice,
                    review = completedReview,
                    returnToHome = preparedScreen.returnToHome,
                    returnToReinforcement = preparedScreen.returnToReinforcement,
                    reinforcementContext = preparedScreen.reinforcementContext,
                    learningCatalogContext = preparedScreen.learningCatalogContext,
                    preparedReinforcementCompletion = preparedCompletion,
                )
            }
        }
    }

    fun practiceReviewFor(resultScreen: Screen.PracticeResultScreen): PracticeReview {
        val review = (if (resultScreen.practice.teacherPaper != null && resultScreen.practice.answers.isNotEmpty()) {
            teacherPaperReview(resultScreen.practice)
        } else practiceReviewState.reviewFor(resultScreen.practice.questions))
            .withDiagnosticFeedback(resultScreen.diagnosticFeedback)
        if (review.itemFor(resultScreen.question) != null) return review
        return PracticeReview(
            items = review.items + PracticeReviewItem(
                question = resultScreen.question,
                answer = resultScreen.answer,
                result = resultScreen.result,
            ),
            diagnosticFeedback = resultScreen.diagnosticFeedback,
        )
    }

    fun goToPracticeResultQuestion(resultScreen: Screen.PracticeResultScreen, targetIndex: Int) {
        val target = practiceResultScreenAt(resultScreen, targetIndex) ?: return
        requestGeneration.invalidate()
        screen = target
    }

    fun openPracticeReviewQuestion(reviewScreen: Screen.PracticeReviewScreen, itemIndex: Int) {
        val item = reviewScreen.review.items.getOrNull(itemIndex) ?: return
        val questionIndex = practiceReviewQuestionIndex(
            questions = reviewScreen.practice.questions,
            review = reviewScreen.review,
            itemIndex = itemIndex,
        ) ?: return
        navigate(
            Screen.PracticeResultScreen(
                session = reviewScreen.session,
                data = reviewScreen.data,
                chapter = reviewScreen.chapter,
                kp = reviewScreen.kp,
                practice = reviewScreen.practice,
                index = questionIndex,
                question = item.question,
                answer = item.answer,
                result = item.result,
                tutorMessages = item.result.answerId?.let {
                    chatHistoryStore.read(reviewScreen.session.studentId, questionChatScope(it))
                }.orEmpty(),
                returnToHome = reviewScreen.returnToHome,
                returnToReinforcement = reviewScreen.returnToReinforcement,
                reinforcementContext = reviewScreen.reinforcementContext,
                learningCatalogContext = reviewScreen.learningCatalogContext,
                openedFromSummary = true,
                diagnosticFeedback = reviewScreen.review.diagnosticFeedback,
            ),
        )
    }

    private fun practiceResultScreenAt(
        resultScreen: Screen.PracticeResultScreen,
        targetIndex: Int,
    ): Screen.PracticeResultScreen? {
        val question = resultScreen.practice.questions.getOrNull(targetIndex) ?: return null
        val item = (if (resultScreen.practice.teacherPaper != null && resultScreen.practice.answers.isNotEmpty()) {
            teacherPaperReview(resultScreen.practice).itemFor(question)
        } else practiceReviewState.itemFor(question))
            ?: if (question.id == resultScreen.question.id) {
                PracticeReviewItem(question, resultScreen.answer, resultScreen.result)
            } else {
                null
            }
            ?: return null
        return resultScreen.copy(
            index = targetIndex,
            question = item.question,
            answer = item.answer,
            result = item.result,
            summaryAutoOpen = false,
            tutorMessages = item.result.answerId?.let {
                chatHistoryStore.read(resultScreen.session.studentId, questionChatScope(it))
            }.orEmpty(),
        )
    }

    fun nextQuestion(resultScreen: Screen.PracticeResultScreen) {
        val nextIndex = resultScreen.index + 1
        if (nextIndex >= resultScreen.practice.questions.size) {
            if (resultScreen.openedFromSummary) {
                goBack()
                return
            }
            if (resultScreen.practice.sessionType == PracticeSessionTypes.ReviewRetry) {
                // The spent attempt and the mistake page it was opened from are replaced, not stacked:
                // back from the refreshed page must never reopen an already-submitted variation.
                val keepsMistake = !resultScreen.result.cleared && resultScreen.reviewRetryMistake != null
                while (backStack.lastOrNull().let { it is Screen.ReviewRetryQuestion || it is Screen.ReviewDetail }) {
                    backStack.removeAt(backStack.lastIndex)
                }
                if (!keepsMistake && backStack.lastOrNull() is Screen.Review) backStack.removeAt(backStack.lastIndex)
                runWithLoadingRequest("错题复盘", "正在回到错题复盘页...", keepCurrent = false) { requestId ->
                    answerDrafts.clearSession(resultScreen.practice.questions.map { it.id })
                    val reviewData = fetchReviewAndCache(resultScreen.session)
                    if (keepsMistake) postForRequest(requestId) {
                        // The list underneath shows the same refreshed counts when the student goes back.
                        if (backStack.lastOrNull() is Screen.Review) {
                            backStack[backStack.lastIndex] = Screen.Review(resultScreen.session, reviewData)
                        }
                    }
                    if (!resultScreen.result.cleared && resultScreen.reviewRetryMistake != null) {
                        Screen.ReviewDetail(
                            session = resultScreen.session,
                            data = reviewData,
                            mistake = resultScreen.reviewRetryMistake,
                            retryMessage = resultScreen.reviewRetryMessage,
                        )
                    } else {
                        Screen.Review(resultScreen.session, reviewData)
                    }
                }
                return
            }
            resultScreen.preparedReinforcementCompletion?.let { completion ->
                showPreparedReinforcementCompletion(resultScreen.session, resultScreen.practice, completion)
                return
            }
            runWithLoading(
                "评估结果", "正在整理本次结果...", keepCurrent = false,
                onError = { e, _ ->
                    if (resultScreen.practice.sessionType != PracticeSessionTypes.KpDiagnostic) {
                        Screen.Error("评估结果", loadFailureMessage(e))
                    } else {
                        Screen.PracticeQuestionScreen(
                            session = resultScreen.session,
                            data = resultScreen.data,
                            chapter = resultScreen.chapter,
                            kp = resultScreen.kp,
                            practice = resultScreen.practice,
                            index = resultScreen.index,
                            returnToHome = resultScreen.returnToHome,
                            returnToReinforcement = resultScreen.returnToReinforcement,
                            reinforcementContext = resultScreen.reinforcementContext,
                            learningCatalogContext = resultScreen.learningCatalogContext,
                            submissionState = PracticeSetSubmissionState(
                                completed = practiceReviewState.reviewFor(resultScreen.practice.questions).items.size,
                                total = resultScreen.practice.questions.size,
                                phase = PracticeSubmissionPhase.Finalizing,
                                error = practiceFailureMessage(e, "评估总结尚未保存，已批改答案已保留，请重试"),
                            ),
                        ).also { schedulePracticeRecovery(it, immediate = true) }
                    }
                },
            ) {
                val review = practiceReviewState.reviewFor(resultScreen.practice.questions)
                val feedback = if (
                    resultScreen.reinforcementContext == null &&
                    resultScreen.learningCatalogContext == null
                ) {
                    diagnosticFeedbackForCompletion(resultScreen.session, resultScreen.kp, resultScreen.practice, review)
                } else {
                    null
                }
                val completedReview = review.withDiagnosticFeedback(feedback)
                reinforcementCompletionScreen(
                    session = resultScreen.session,
                    data = resultScreen.data,
                    practice = resultScreen.practice,
                    review = completedReview,
                    context = resultScreen.reinforcementContext,
                ) ?: Screen.PracticeReviewScreen(
                    session = resultScreen.session,
                    data = resultScreen.data,
                    chapter = resultScreen.chapter,
                    kp = resultScreen.kp,
                    practice = resultScreen.practice,
                    review = completedReview,
                    returnToHome = resultScreen.returnToHome,
                    returnToReinforcement = resultScreen.returnToReinforcement,
                    reinforcementContext = resultScreen.reinforcementContext,
                    learningCatalogContext = resultScreen.learningCatalogContext,
                )
            }
            return
        }
        practiceResultScreenAt(resultScreen, nextIndex)?.let { nextResult ->
            requestGeneration.invalidate()
            screen = nextResult
            return
        }
        val nextScreen: Screen = Screen.PracticeQuestionScreen(
            session = resultScreen.session,
            data = resultScreen.data,
            chapter = resultScreen.chapter,
            kp = resultScreen.kp,
            practice = resultScreen.practice,
            index = nextIndex,
            returnToHome = resultScreen.returnToHome,
            returnToReinforcement = resultScreen.returnToReinforcement,
            reinforcementContext = resultScreen.reinforcementContext,
            learningCatalogContext = resultScreen.learningCatalogContext,
        )
        navigate(
            nextScreen,
        )
    }

    fun correctGrading(
        resultScreen: Screen.PracticeResultScreen,
        correctedAnswer: String,
        isCorrect: Boolean,
    ) {
        val answerId = resultScreen.result.answerId ?: return
        val normalizedAnswer = correctedAnswer.trim().ifBlank { resultScreen.answer }
        runWithLoading("修正批改", "正在按你的确认修正学习记录...", keepCurrent = false, keepCurrentOnError = true) {
            val corrected = api.correctAnswerGrading(
                token = resultScreen.session.token,
                answerId = answerId,
                correctedAnswer = normalizedAnswer,
                isCorrect = isCorrect,
                correctionReason = if (isCorrect) {
                    "学生确认 AI 批改偏严，本题应按正确记录。"
                } else {
                    "学生确认本题仍需订正，按错误记录。"
                },
            )
            practiceReviewState.record(resultScreen.question, normalizedAnswer, corrected)
            enqueueMasteryRefresh(resultScreen.session)
            synchronizeLearningCatalogEvidence(
                session = resultScreen.session,
                context = resultScreen.learningCatalogContext,
                result = corrected,
            )
            resultScreen.copy(answer = normalizedAnswer, result = corrected,
                practice = if (resultScreen.practice.teacherPaper != null) resultScreen.practice.copy(
                    answers = resultScreen.practice.answers + (resultScreen.question.id to corrected.copy(givenAnswer = normalizedAnswer)),
                ) else resultScreen.practice,
            )
        }
    }

    fun askQuestionTutor(resultScreen: Screen.PracticeResultScreen, message: String) {
        runTutorRequest(resultScreen, message) { current, prompt, history ->
            val result = current as Screen.PracticeResultScreen
            api.questionTutorChat(
                token = result.session.token,
                questionId = result.question.id,
                givenAnswer = result.answer,
                message = prompt,
                history = history,
                processGrading = result.result.processGrading,
            )
        }
    }

    fun askLearningTutor(learnScreen: Screen.Learn, message: String) {
        if (!StudentAccessPolicy.canAccessKp(learnScreen.session, learnScreen.kp)) {
            navigate(accountUnavailableScreen("AI 助教"))
            return
        }
        runTutorRequest(learnScreen, message) { current, prompt, history ->
            val learn = current as Screen.Learn
            api.learnChat(
                token = learn.session.token,
                kpId = learn.kp.id,
                message = prompt,
                history = history,
            )
        }
    }

    fun askReviewTutor(detailScreen: Screen.ReviewDetail, message: String) {
        if (!StudentAccessPolicy.hasFullLearningAccess(detailScreen.session)) {
            navigate(accountUnavailableScreen("AI 助教"))
            return
        }
        runTutorRequest(detailScreen, message) { current, prompt, history ->
            val detail = current as Screen.ReviewDetail
            api.questionTutorChat(
                token = detail.session.token,
                questionId = detail.mistake.questionId,
                givenAnswer = detail.mistake.givenAnswer,
                message = prompt,
                history = history,
                processGrading = detail.mistake.processGrading,
            )
        }
    }

    private fun runTutorRequest(
        expected: Screen,
        message: String,
        work: (Screen, String, List<TutorChatMessage>) -> String,
    ) {
        val current = screen
        val owner = expected.tutorOwner() ?: return
        val prompt = message.trim()
        if (prompt.isBlank() || current.tutorOwner() != owner || current.tutorRequestState().isLoading) return
        val history = current.tutorConversationMessages()
        val requestId = requestGeneration.begin()
        // Keep the same page and Compose subtree; never push a tutor request
        // onto the navigation stack or replace its dialog with Screen.Loading.
        screen = current.withTutorConversation(TutorRequestState(pendingPrompt = prompt, requestId = requestId))
        tutorExecutor.execute {
            try {
                if (!requestGeneration.isCurrent(requestId)) return@execute
                val reply = work(current, prompt, history)
                postForRequest(requestId) {
                    val latest = screen
                    if (latest.tutorOwner() != owner || latest.tutorRequestState().requestId != requestId) return@postForRequest
                    val messages = (history + TutorChatMessage("user", prompt) + TutorChatMessage("assistant", reply)).takeLast(30)
                    val saved = runCatching { saveTutorConversation(latest, messages) }
                    screen = latest.withTutorConversation(
                        request = TutorRequestState(error = if (saved.isFailure) "回复已生成，但未能保存到本机。" else ""),
                        messages = messages,
                    )
                }
            } catch (error: Exception) {
                postForRequest(requestId) {
                    val latest = screen
                    if (latest.tutorOwner() == owner && latest.tutorRequestState().requestId == requestId) {
                        screen = latest.withTutorConversation(latest.tutorRequestState().failed(loadFailureMessage(error)))
                    }
                }
            }
        }
    }

    private fun saveTutorConversation(current: Screen, messages: List<TutorChatMessage>) {
        when (current) {
            is Screen.Learn -> {
                learnChatMessages[current.kp.id] = messages
                chatHistoryStore.save(current.session.studentId, learnChatScope(current.kp.id), messages)
            }
            is Screen.ReviewDetail -> chatHistoryStore.save(
                current.session.studentId, questionChatScope(current.mistake.answerId), messages,
            )
            is Screen.PracticeResultScreen -> current.result.answerId?.let {
                chatHistoryStore.save(current.session.studentId, questionChatScope(it), messages)
            }
            else -> Unit
        }
    }

    fun startReviewRetry(detailScreen: Screen.ReviewDetail) {
        if (!StudentAccessPolicy.hasFullLearningAccess(detailScreen.session)) {
            navigate(accountUnavailableScreen("错题复盘"))
            return
        }
        runWithLoading("错题复盘", "正在准备同类变式题...") {
            val variation = runCatching {
                api.getReviewVariations(detailScreen.session.token, detailScreen.mistake.answerId).firstOrNull()
            }.getOrNull()
            val fallbackQuestion = if (variation == null) {
                runCatching { api.retrySimilarQuestion(detailScreen.session.token, detailScreen.mistake.answerId) }.getOrNull()
            } else {
                null
            }
            val question = variation?.question ?: fallbackQuestion
            if (question == null) {
                detailScreen.copy(
                    retryMessage = "暂时没有可用变式题，请稍后再试。",
                )
            } else {
                answerDrafts.clearSession(listOf(question.id))
                Screen.ReviewRetryQuestion(
                    session = detailScreen.session,
                    data = detailScreen.data,
                    mistake = detailScreen.mistake,
                    question = question,
                    title = variation?.title?.takeIf { it.isNotBlank() } ?: "做变式题",
                    reason = variation?.reason?.takeIf { it.isNotBlank() } ?: "答对后，这道错题会从待复盘列表移除。",
                    retryStartedAtMs = System.currentTimeMillis(),
                )
            }
        }
    }

    fun submitReviewRetry(retryScreen: Screen.ReviewRetryQuestion) {
        if (!answerDrafts.hasAnswer(retryScreen.question.id)) {
            screen = retryScreen.copy(retryMessage = "请先完成变式题作答。")
            return
        }
        runWithLoading(
            title = "错题复盘",
            message = "正在提交变式题...",
            onError = ::reviewRetrySubmitFailureScreen,
        ) {
            val elapsedMs = (System.currentTimeMillis() - retryScreen.retryStartedAtMs).coerceAtLeast(0L)
            val outcome = PracticeSubmissionDispatcher.submitOne(
                api = api,
                token = retryScreen.session.token,
                studentId = retryScreen.session.studentId,
                submission = answerDrafts.toSubmission(retryScreen.question, timeSpentMs = elapsedMs),
            )
            enqueueMasteryRefresh(retryScreen.session)
            val reviewOutcome = resolveReviewRetrySubmission(outcome.result) {
                api.completeReview(
                    token = retryScreen.session.token,
                    answerId = retryScreen.mistake.answerId,
                    retryAnswerId = outcome.result.answerId,
                )
            }
            reviewRetryResultScreen(
                retryScreen = retryScreen,
                answer = outcome.answer,
                result = reviewOutcome.result,
                message = reviewOutcome.message,
            )
        }
    }

    fun submitReviewRetrySelfReview(retryScreen: Screen.ReviewRetryQuestion, items: List<PracticeSelfReviewItem>) {
        if (items.isEmpty() || items.any { it.status.isBlank() }) {
            screen = retryScreen.copy(retryMessage = "请先完成每一小问的自评。")
            return
        }
        runWithLoading(
            title = "错题复盘",
            message = "正在提交自评...",
            onError = ::reviewRetrySubmitFailureScreen,
        ) {
            val elapsedMs = (System.currentTimeMillis() - retryScreen.retryStartedAtMs).coerceAtLeast(0L)
            answerDrafts.setSelfReview(
                retryScreen.question.id,
                PracticeSelfReviewDraft(items = items, timeSpentMs = elapsedMs),
            )
            val result = api.submitSelfReview(
                token = retryScreen.session.token,
                studentId = retryScreen.session.studentId,
                questionId = retryScreen.question.id,
                items = items,
                timeSpentMs = elapsedMs,
                targetKnowledgePointId = retryScreen.question.targetKnowledgePointId.ifBlank { null },
                topicContext = retryScreen.question.topicContext,
                submissionId = answerDrafts.submissionId(retryScreen.question.id),
            )
            enqueueMasteryRefresh(retryScreen.session)
            val outcome = resolveReviewRetrySubmission(result) {
                api.completeReview(
                    token = retryScreen.session.token,
                    answerId = retryScreen.mistake.answerId,
                    retryAnswerId = result.answerId,
                )
            }
            reviewRetryResultScreen(
                retryScreen = retryScreen,
                answer = "[学生自评]",
                result = outcome.result,
                message = outcome.message,
            )
        }
    }

    fun finishPractice(reviewScreen: Screen.PracticeReviewScreen) {
        reviewScreen.preparedReinforcementCompletion?.let { completion ->
            showPreparedReinforcementCompletion(reviewScreen.session, reviewScreen.practice, completion)
            return
        }
        reviewScreen.learningCatalogContext?.let { context ->
            clearCompletedPracticeState(reviewScreen.session, reviewScreen.practice)
            openLearningCatalogTopic(reviewScreen.session, context)
            return
        }
        if (reviewScreen.returnToHome) {
            clearCompletedPracticeState(reviewScreen.session, reviewScreen.practice)
            navigate(Screen.Home(reviewScreen.session))
            return
        }
        if (reviewScreen.returnToReinforcement) {
            reviewScreen.reinforcementContext?.let { context ->
                runWithLoading("巩固提升", "正在回到训练路径...") {
                    reinforcementCompletionScreen(
                        session = reviewScreen.session,
                        data = reviewScreen.data,
                        practice = reviewScreen.practice,
                        review = reviewScreen.review,
                        context = context,
                    ) ?: error("Reinforcement context must produce a completion screen")
                }
                return
            }
            runWithLoading("巩固提升", "正在回到训练路径...") {
                val next = fetchReinforcementHomeAndCache(reviewScreen.session)
                clearCompletedPracticeState(reviewScreen.session, reviewScreen.practice)
                next
            }
            return
        }
        clearCompletedPracticeState(reviewScreen.session, reviewScreen.practice)
        dropCompletedPracticeFlow(reviewScreen)
        runWithLoading("同步学习", "正在更新知识点状态...", keepCurrent = false) {
            val (directory, judgments) = fetchDirectoryAndJudgments(reviewScreen.session)
            Screen.Directory(
                session = reviewScreen.session,
                data = directory,
                focusedKpId = reviewScreen.kp.id,
                judgmentsByKpId = judgments,
            )
        }
    }

    fun completePracticeSummary(
        resultScreen: Screen.PracticeResultScreen,
        action: PracticeSummaryAction,
    ) {
        val review = practiceReviewFor(resultScreen)
        clearPracticeRecovery(resultScreen.session.studentId)
        answerDrafts.clearSession(resultScreen.practice.questions.map { it.id })
        practiceReviewState.clearSession(resultScreen.practice.questions)
        dropCompletedPracticeFlow(
            Screen.PracticeReviewScreen(
                session = resultScreen.session,
                data = resultScreen.data,
                chapter = resultScreen.chapter,
                kp = resultScreen.kp,
                practice = resultScreen.practice,
                review = review,
                returnToHome = resultScreen.returnToHome,
                returnToReinforcement = resultScreen.returnToReinforcement,
                reinforcementContext = resultScreen.reinforcementContext,
                learningCatalogContext = resultScreen.learningCatalogContext,
            ),
        )
        when (action) {
            PracticeSummaryAction.Learn -> loadLearn(
                session = resultScreen.session,
                data = resultScreen.data,
                chapter = resultScreen.chapter,
                kp = resultScreen.kp,
                keepCurrent = false,
            )
            PracticeSummaryAction.Practice -> loadKpTrain(
                session = resultScreen.session,
                data = resultScreen.data,
                chapter = resultScreen.chapter,
                kp = resultScreen.kp,
                keepCurrent = false,
            )
            PracticeSummaryAction.GaokaoReturn -> {
                val context = resultScreen.learningCatalogContext ?: return
                openLearningCatalogTopic(resultScreen.session, context)
            }
            PracticeSummaryAction.GaokaoRepeat -> {
                val context = resultScreen.learningCatalogContext ?: return
                repeatLearningCatalogLayer(resultScreen.session, context)
            }
        }
    }

    fun getDraft(questionId: String): String = answerDrafts.get(questionId)

    fun getPhotoDraft(questionId: String): PracticePhotoDraft? = answerDrafts.getPhoto(questionId)

    fun getHandwritingDraft(questionId: String): PracticeHandwritingDraft? = answerDrafts.getHandwriting(questionId)

    fun getSelfReviewDraft(questionId: String): PracticeSelfReviewDraft? = answerDrafts.getSelfReview(questionId)

    private fun activeDraftQuestions(): List<PracticeQuestion> = when (val current = screen) {
        is Screen.PracticeQuestionScreen -> current.practice.questions
        is Screen.ReviewRetryQuestion -> listOf(current.question)
        else -> emptyList()
    }

    private fun canvasAnswerIds(): Set<String> = activeDraftQuestions().filter {
        !it.isChoice() && draftCanvasSnapshots[it.id]?.hasAnswerInk() == true
    }.map { it.id }.toSet()

    fun hasDraftAnswer(questionId: String): Boolean = answerDrafts.hasAnswer(questionId, questionId in canvasAnswerIds())

    fun getAnsweredCount(questionIds: List<String>): Int = answerDrafts.answeredCount(questionIds, canvasAnswerIds())

    /** A submitted paper reopened later has no local drafts; its graded questions still count as answered. */
    fun isAnsweredOrGraded(question: PracticeQuestion): Boolean =
        hasDraftAnswer(question.id) || practiceReviewState.itemFor(question) != null

    fun getSubmissionSourceSummary(questionIds: List<String>): PracticeSubmissionSourceSummary =
        answerDrafts.submissionSourceSummary(questionIds, canvasAnswerIds())

    fun saveDraft(questionId: String, answer: String) {
        if (!canEditPracticeDraft(questionId)) return
        answerDrafts.set(questionId, answer)
        practiceReviewState.remove(questionId)
        scheduleActivePracticeRecovery(questionId)
    }

    fun saveSelfReviewDraft(questionId: String, items: List<PracticeSelfReviewItem>) {
        if (!canEditPracticeDraft(questionId)) return
        answerDrafts.setSelfReview(
            questionId,
            PracticeSelfReviewDraft(
                items = items,
            ),
        )
        practiceReviewState.remove(questionId)
        scheduleActivePracticeRecovery(questionId)
    }

    fun groupByVolume(kps: List<KpNode>): Map<String, List<ChapterGroup>> {
        return kps.groupBy { it.volume }
            .mapValues { (_, volumeKps) ->
                volumeKps.groupBy { it.chapter }
                    .map { (chapter, chapterKps) ->
                        ChapterGroup(chapterKps.first().volume, chapter, chapterKps)
                    }
            }
    }

    private fun defaultTrainStart(): TrainStartData =
        TrainStartData(isFirstTime = false, hasDiagnosed = false, recommendedKps = emptyList())

    private fun ensureMainCacheFor(session: StudentSession) {
        if (!mainNavigationCacheBelongsToStudent(mainCacheStudentId, session)) {
            clearMainNavigationCache()
            mainCacheStudentId = session.studentId
        }
    }

    private fun clearMainNavigationCache() {
        latestMasteryDirectory = null
        masteryRefreshVersion += 1
        pendingMasteryRefresh?.let(mainHandler::removeCallbacks)
        mainCacheStudentId = ""
        cachedDirectory = null
        cachedJudgmentsByKpId = emptyMap()
        cachedReview = null
        cachedTrainStart = null
        cachedLatestPlan = null
        cachedLatestCompletedReport = null
        cachedGaokaoReview = null
        reviewRefreshInFlight = false
    }

    private fun cacheDirectory(
        session: StudentSession,
        directory: DirectoryData,
        judgmentsByKpId: Map<String, KnowledgeMasteryJudgment>,
    ) {
        if (!ownsSession(session)) return
        ensureMainCacheFor(session)
        latestMasteryDirectory?.takeIf { it.owner.studentId == session.studentId }?.let {
            latestMasteryDirectory = LearningDirectorySnapshot(session, directory, judgmentsByKpId)
        }
        cachedDirectory = directory
        cachedJudgmentsByKpId = judgmentsByKpId
    }

    private fun cacheReview(session: StudentSession, review: ReviewData) {
        ensureMainCacheFor(session)
        cachedReview = review
    }

    private fun cacheReinforcementHome(
        session: StudentSession,
        directory: DirectoryData,
        judgmentsByKpId: Map<String, KnowledgeMasteryJudgment>,
        trainStart: TrainStartData,
        latestPlan: ImprovementPlan?,
        latestCompletedReport: ImprovementReport?,
    ) {
        cacheDirectory(session, directory, judgmentsByKpId)
        cachedTrainStart = trainStart
        cachedLatestPlan = latestPlan
        cachedLatestCompletedReport = latestCompletedReport
    }

    private fun fetchDirectoryAndJudgments(
        session: StudentSession,
    ): Pair<DirectoryData, Map<String, KnowledgeMasteryJudgment>> {
        val directory = api.getDirectory(session.token, session.studentId)
        val judgmentsByKpId = loadKnowledgeMasteryJudgments(session, directory)
        cacheDirectory(session, directory, judgmentsByKpId)
        return directory to judgmentsByKpId
    }

    private fun fetchReviewAndCache(session: StudentSession): ReviewData {
        val review = api.getReview(session.token, session.studentId)
        cacheReview(session, review)
        return review
    }

    private fun fetchReinforcementHomeAndCache(session: StudentSession): Screen.ReinforcementHome {
        val (directory, judgmentsByKpId) = fetchDirectoryAndJudgments(session)
        var accessSession = session
        val trainStart = if (StudentAccessPolicy.hasFullLearningAccess(session)) {
            try {
                api.getTrainStart(session.token, session.studentId)
            } catch (error: ApiHttpException) {
                if (error.statusCode != 403) throw error
                accessSession = session.copy()
                defaultTrainStart()
            }
        } else {
            defaultTrainStart()
        }
        val latestPlan = runCatching {
            api.getLatestImprovementPlan(session.token, session.studentId)
        }.getOrNull()?.takeUnless { it.isCompleted() }
        val latestCompletedReport = runCatching {
            api.getLatestCompletedImprovementReport(session.token, session.studentId)
        }.getOrNull()
        cacheReinforcementHome(
            session = session,
            directory = directory,
            judgmentsByKpId = judgmentsByKpId,
            trainStart = trainStart,
            latestPlan = latestPlan,
            latestCompletedReport = latestCompletedReport,
        )
        return Screen.ReinforcementHome(
            session = accessSession,
            data = directory,
            trainStart = trainStart,
            latestPlan = latestPlan,
            latestCompletedReport = latestCompletedReport,
            judgmentsByKpId = judgmentsByKpId,
        )
    }

    private fun showMainNavigationScreen(next: Screen, replaceStack: Boolean) {
        requestGeneration.invalidate()
        if (replaceStack) {
            endPracticeLeftBehind()
            backStack.clear()
        } else {
            backStack.add(screen)
        }
        screen = next
    }

    private fun enqueueMasteryRefresh(session: StudentSession, retry: Boolean = true) {
        mainHandler.post {
            if (executor.isShutdown || !ownsSession(session)) return@post
            val version = ++masteryRefreshVersion
            pendingMasteryRefresh?.let(mainHandler::removeCallbacks)
            val refresh = Runnable {
                if (executor.isShutdown || version != masteryRefreshVersion) return@Runnable
                executor.execute {
                    if (version != masteryRefreshVersion || !ownsSession(session)) return@execute
                    // Queue behind grading; fetching the final server value avoids out-of-order per-answer updates.
                    runCatching {
                        val directory = api.getDirectory(session.token, session.studentId)
                        directory to loadKnowledgeMasteryJudgments(session, directory)
                    }.onSuccess { (directory, judgments) ->
                        mainHandler.post {
                            if (version != masteryRefreshVersion || !ownsSession(session)) return@post
                            cacheDirectory(session, directory, judgments)
                            latestMasteryDirectory = LearningDirectorySnapshot(session, directory, judgments)
                            screen = screen
                            backStack.indices.forEach { index ->
                                backStack[index] = latestMasteryDirectory!!.apply(backStack[index])
                            }
                        }
                    }.onFailure {
                        if (retry) mainHandler.postDelayed({
                            if (version == masteryRefreshVersion) enqueueMasteryRefresh(session, retry = false)
                        }, 2_000L)
                    }
                }
            }
            pendingMasteryRefresh = refresh
            mainHandler.postDelayed(refresh, 150L)
        }
    }

    private fun refreshDirectoryInBackground(session: StudentSession) {
        val requestId = requestGeneration.current()
        executor.execute {
            runCatching { fetchDirectoryAndJudgments(session) }.onSuccess { (directory, judgmentsByKpId) ->
                postForRequest(requestId) {
                    when (val latest = screen) {
                        is Screen.Directory -> if (latest.session.studentId == session.studentId) {
                            screen = latest.copy(data = directory, judgmentsByKpId = judgmentsByKpId)
                        }
                        is Screen.ReinforcementHome -> if (latest.session.studentId == session.studentId) {
                            screen = latest.copy(data = directory, judgmentsByKpId = judgmentsByKpId)
                        }
                        else -> Unit
                    }
                }
            }
        }
    }

    private fun refreshReviewInBackground(session: StudentSession) {
        if (!tryBeginReviewRefresh(session, allowCachedRefresh = true)) return
        val requestId = requestGeneration.current()
        executor.execute {
            runCatching { fetchReviewAndCache(session) }.onSuccess { review ->
                postForRequest(requestId) {
                    val latest = screen
                    if (latest is Screen.Review && latest.session.studentId == session.studentId) {
                        screen = latest.copy(data = review)
                    }
                }
            }.also {
                mainHandler.post { reviewRefreshInFlight = false }
            }
        }
    }

    private var gaokaoWarmInFlight = false

    /** Prefetches the 高考复习 catalog while the student is on a sibling tab, so its first switch is instant. */
    private fun warmGaokaoCacheInBackground(session: StudentSession) {
        ensureMainCacheFor(session)
        if (cachedGaokaoReview != null || gaokaoWarmInFlight) return
        gaokaoWarmInFlight = true
        executor.execute {
            runCatching {
                val catalog = api.getLearningCatalog(session.token, GAOKAO_CATALOG_CODE)
                val resumeTopicId = runCatching {
                    api.getLearningCatalogResumeTopicId(session.token, GAOKAO_CATALOG_CODE)
                }.getOrDefault("")
                val entry = gaokaoReviewEntry(catalog, resumeTopicId)
                Screen.GaokaoReview(session, catalog, entry?.blockId.orEmpty(), entry?.topic?.id.orEmpty())
            }.also { result ->
                mainHandler.post {
                    gaokaoWarmInFlight = false
                    result.getOrNull()?.let { if (cachedGaokaoReview == null) cacheGaokaoReview(session, it) }
                }
            }
        }
    }

    private fun warmReviewCacheInBackground(session: StudentSession) {
        if (!tryBeginReviewRefresh(session, allowCachedRefresh = false)) return
        executor.execute {
            runCatching { fetchReviewAndCache(session) }
                .also { mainHandler.post { reviewRefreshInFlight = false } }
        }
    }

    private fun tryBeginReviewRefresh(session: StudentSession, allowCachedRefresh: Boolean): Boolean {
        if (!StudentAccessPolicy.canReadOwnHistory(session)) return false
        ensureMainCacheFor(session)
        val hasCachedReview = cachedReview != null
        if (!allowCachedRefresh && !shouldWarmReviewCache(
                canReadHistory = true,
                hasCachedReview = hasCachedReview,
                refreshInFlight = reviewRefreshInFlight,
            )
        ) {
            return false
        }
        if (reviewRefreshInFlight) return false
        reviewRefreshInFlight = true
        return true
    }

    private fun refreshReinforcementHomeInBackground(session: StudentSession) {
        val requestId = requestGeneration.current()
        executor.execute {
            runCatching { fetchReinforcementHomeAndCache(session) }.onSuccess { refreshed ->
                postForRequest(requestId) {
                    val latest = screen
                    if (latest is Screen.ReinforcementHome && latest.session.studentId == session.studentId) {
                        screen = refreshed
                    }
                }
            }
        }
    }

    private fun loadKnowledgeMasteryJudgments(
        session: StudentSession,
        data: DirectoryData,
    ): Map<String, KnowledgeMasteryJudgment> {
        return runCatching {
            api.getKnowledgeMasteryJudgments(
                token = session.token,
                studentId = session.studentId,
                kpIds = data.kps.filterNot { it.contentPending }.map { it.id },
            ).associateBy { it.kpId }
        }.getOrDefault(emptyMap())
    }

    private fun chapterGroupFor(data: DirectoryData, kp: KpNode): ChapterGroup {
        val chapterKps = data.kps.filter { it.volume == kp.volume && it.chapter == kp.chapter }
        return ChapterGroup(kp.volume, kp.chapter, chapterKps.ifEmpty { listOf(kp) })
    }

    private fun gaokaoSyntheticKp(topic: LearningCatalogNode): KpNode {
        return KpNode(
            id = "gaokao:${topic.id}",
            name = topic.title,
            volume = "高考复习",
            chapter = topic.title,
            section = "专题训练",
            mastery = 0.0,
            status = "in_progress",
        )
    }

    private fun synchronizeLearningCatalogEvidence(
        session: StudentSession,
        context: LearningCatalogPracticeContext?,
        result: SubmitResult,
    ) {
        val answerId = result.answerId ?: return
        synchronizeLearningCatalogEvidence(session, context, answerId)
    }

    private fun synchronizeLearningCatalogEvidence(
        session: StudentSession,
        context: LearningCatalogPracticeContext?,
        answerId: Int,
    ) {
        // Homework has no 高考复习 topic; its answers reach the teacher through the paper attempt.
        val activeContext = context?.takeUnless { it.isTeacherHomework } ?: return
        val pending = PendingLearningCatalogEvidence(activeContext, answerId)
        runCatching {
            api.recordLearningCatalogTopicEvidence(
                token = session.token,
                catalogCode = activeContext.catalogCode,
                nodeId = activeContext.nodeId,
                layer = activeContext.layer,
                answerId = answerId,
            )
        }.onSuccess {
            pendingLearningCatalogEvidence.remove(pending)
        }.onFailure {
            pendingLearningCatalogEvidence.add(pending)
        }
    }

    private fun retryLearningCatalogEvidence(
        session: StudentSession,
        context: LearningCatalogPracticeContext,
    ) {
        val candidates = synchronized(pendingLearningCatalogEvidence) {
            pendingLearningCatalogEvidence.filter {
                it.context.catalogCode == context.catalogCode && it.context.nodeId == context.nodeId
            }
        }
        candidates.forEach { candidate ->
            synchronizeLearningCatalogEvidence(
                session = session,
                context = candidate.context,
                answerId = candidate.answerId,
            )
        }
    }

    private fun learningCatalogEvidenceMessage(context: LearningCatalogPracticeContext): String {
        val pendingCount = synchronized(pendingLearningCatalogEvidence) {
            pendingLearningCatalogEvidence.count {
                it.context.catalogCode == context.catalogCode && it.context.nodeId == context.nodeId
            }
        }
        return if (pendingCount > 0) {
            "$pendingCount 道题的专题进度尚未同步，返回本页或刷新时会自动重试。"
        } else {
            ""
        }
    }

    private fun openLearningCatalogTopic(
        session: StudentSession,
        context: LearningCatalogPracticeContext,
    ) {
        if (context.isTeacherHomework) {
            clearPracticeRecovery(session.studentId)
            // Opened from 作业记录: return there, with this homework's new status and score.
            val records = backStack.indexOfLast { it is Screen.HomeworkHistory && it.session.studentId == session.studentId }
            if (records >= 0) {
                requestGeneration.invalidate()
                while (backStack.size > records + 1) backStack.removeAt(backStack.lastIndex)
                screen = backStack.removeAt(records)
                refreshHomeworkHistory(session)
                return
            }
            showHome(session)
            return
        }
        clearPracticeRecovery(session.studentId)
        backStack.removeAll { it is Screen.GaokaoReview }
        runWithLoading(
            title = "高考复习",
            message = "正在更新「${context.topicTitle}」的专题状态...",
            keepCurrent = false,
        ) {
            retryLearningCatalogEvidence(session, context)
            val catalog = api.getLearningCatalog(session.token, context.catalogCode)
            val overview = api.getLearningCatalogTopicOverview(
                token = session.token,
                catalogCode = context.catalogCode,
                nodeId = context.nodeId,
            )
            val expandedBlockId = catalog.knowledgeBlocks()
                .firstOrNull { block -> block.topics().any { it.id == context.nodeId } }
                ?.id
                .orEmpty()
            Screen.GaokaoReview(
                session = session,
                catalog = catalog,
                expandedBlockId = expandedBlockId,
                selectedTopicId = context.nodeId,
                overview = overview,
                evidenceSyncMessage = learningCatalogEvidenceMessage(context),
            ).also { cacheGaokaoReview(session, it) }
        }
    }

    private fun repeatLearningCatalogLayer(
        session: StudentSession,
        context: LearningCatalogPracticeContext,
    ) {
        if (context.isTeacherHomework) return
        runWithLoading(
            title = context.layer.title,
            message = "正在重新组织「${context.topicTitle}」的${context.layer.title}题目...",
            keepCurrent = false,
        ) {
            val practice = api.getLearningCatalogTopicSession(
                token = session.token,
                catalogCode = context.catalogCode,
                nodeId = context.nodeId,
                layer = context.layer,
                questionCount = context.layer.questionCount,

            )
            learningCatalogPracticeScreen(session, context, practice)
        }
    }

    private fun learningCatalogPracticeScreen(
        session: StudentSession,
        context: LearningCatalogPracticeContext,
        practice: PracticeSession,
    ): Screen {
        if (practice.questions.isEmpty()) {
            return Screen.Error(
                "暂无可练题目",
                "当前专题暂时没有可用于${context.layer.title}的题目。",
            )
        }
        val topic = LearningCatalogNode(
            id = context.nodeId,
            code = context.nodeId,
            nodeType = "topic",
            title = context.topicTitle,
        )
        val kp = gaokaoSyntheticKp(topic)
        val directory = DirectoryData(
            kps = listOf(kp),
            mastered = 0,
            inProgress = 1,
            total = 1,
        )
        val base = Screen.PracticeQuestionScreen(
            session = session, data = directory, chapter = ChapterGroup(kp.volume, kp.chapter, listOf(kp)),
            kp = kp, practice = practice, index = 0, learningCatalogContext = context,
        )
        val paper = practice.teacherPaper ?: return freshPracticeQuestionScreen(base)
        val saved = (latestRecoverySnapshot ?: practiceRecoveryStore.restore(session))?.takeIf {
            it.screen.session.studentId == session.studentId &&
                it.screen.practice.teacherPaper?.attemptId == paper.attemptId && paper.attemptId.isNotBlank()
        }
        resetPracticeDrafts(practice)
        if (saved != null) {
            answerDrafts.restore(saved.drafts)
            draftCanvasSnapshots.putAll(saved.canvasSnapshots)
        }
        val review = teacherPaperReview(practice)
        practiceReviewState.restore(review.items)
        if (paper.status == "completed") {
            return Screen.PracticeReviewScreen(session, directory, base.chapter, kp, practice, review, learningCatalogContext = context)
        }
        return base.copy(
            index = teacherPaperResumeIndex(practice.questions, review, saved?.screen?.index),
            paperBatchImages = saved?.screen?.paperBatchImages.orEmpty(),
            paperBatchSubmission = saved?.screen?.paperBatchSubmission,
            submissionState = if (paper.status == "grading") PracticeSetSubmissionState(
                completed = review.items.size, total = practice.questions.size,
                error = "本套卷已提交，已完成 ${review.items.size}/${practice.questions.size}。可重试尚未完成的批改。",
            ) else PracticeSetSubmissionState(),
        )
    }

    private fun teacherPaperSession(session: StudentSession, context: LearningCatalogPracticeContext): PracticeSession =
        if (context.isTeacherHomework) api.getTeacherHomeworkSession(session.token, context.homeworkAttemptId)
        else api.getLearningCatalogTopicSession(session.token, context.catalogCode, context.nodeId, context.layer,
            context.layer.questionCount)

    private fun refreshedTeacherPaperResult(session: StudentSession, context: LearningCatalogPracticeContext, practice: PracticeSession): Screen {
        val fresh = runCatching {
            teacherPaperSession(session, context)
        }.getOrElse {
            val review = practiceReviewState.reviewFor(practice.questions)
            practice.copy(
                teacherPaper = practice.teacherPaper?.copy(status = "completed"),
                questions = practice.questions.map { q -> q.copy(lessonVideo = q.lessonVideo?.copy(available = true, lockedReason = "")) },
                answers = review.items.associate { it.question.id to it.result.copy(givenAnswer = it.answer,
                    lessonVideo = (it.result.lessonVideo ?: it.question.lessonVideo)?.copy(available = true, lockedReason = "")) },
            )
        }
        return learningCatalogPracticeScreen(session, context, fresh)
    }

    fun restartTeacherPaper(reviewScreen: Screen.PracticeReviewScreen) {
        val context = reviewScreen.learningCatalogContext ?: return
        if (reviewScreen.practice.teacherPaper?.status != "completed") return
        repeatLearningCatalogLayer(reviewScreen.session, context)
    }

    fun correctTeacherPaperGrading(reviewScreen: Screen.PracticeReviewScreen, questionId: String, answer: String, correct: Boolean) {
        val item = reviewScreen.review.items.firstOrNull { it.question.id == questionId } ?: return
        val answerId = item.result.answerId ?: return
        if (item.result.processGrading == null) return
        val normalized = answer.trim().ifBlank { item.answer }
        runWithLoading("修正批改", "正在按你的确认修正学习记录...") {
            val updated = api.correctAnswerGrading(reviewScreen.session.token, answerId, normalized, correct,
                if (correct) "学生确认 AI 批改偏严，本题应按正确记录。" else "学生确认本题仍需订正，按错误记录。")
                .copy(givenAnswer = normalized, lessonVideo = item.result.lessonVideo ?: item.question.lessonVideo)
            practiceReviewState.record(item.question, normalized, updated)
            enqueueMasteryRefresh(reviewScreen.session)
            synchronizeLearningCatalogEvidence(reviewScreen.session, reviewScreen.learningCatalogContext, result = updated)
            val practice = reviewScreen.practice.copy(answers = reviewScreen.practice.answers + (questionId to updated))
            reviewScreen.copy(practice = practice, review = PracticeReview(reviewScreen.review.items.map {
                if (it.question.id == questionId) it.copy(answer = normalized, result = updated) else it
            }))
        }
    }

    fun refreshTeacherPaperProgress(reviewScreen: Screen.PracticeReviewScreen) {
        val context = reviewScreen.learningCatalogContext ?: return
        runWithLoading("批改进度", "正在同步已保存的答卷…", keepCurrent = false) {
            learningCatalogPracticeScreen(reviewScreen.session, context, teacherPaperSession(reviewScreen.session, context))
        }
    }

    private fun chapterMixedPracticeTargets(chapterKps: List<KpNode>, recommendedKpIds: List<String>): List<KpNode> {
        val orderByRecommended = recommendedKpIds.withIndex().associate { it.value to it.index }
        val recommended = chapterKps
            .filter { orderByRecommended.containsKey(it.id) }
            .sortedBy { orderByRecommended[it.id] ?: Int.MAX_VALUE }
        val recommendedIds = recommended.map { it.id }.toSet()
        val unstable = chapterKps
            .filter { it.id !in recommendedIds && (it.status != "mastered" || it.mastery < 0.8) }
            .sortedWith(compareBy<KpNode> { it.mastery }.thenBy { chapterKps.indexOf(it) })
        val unstableIds = unstable.map { it.id }.toSet()
        val rest = chapterKps.filter { it.id !in recommendedIds && it.id !in unstableIds }
        return (recommended + unstable + rest).distinctBy { it.id }.take(8)
    }

    private fun navigate(next: Screen) {
        (screen as? Screen.PracticeQuestionScreen)?.let {
            if (it.practice.teacherPaper != null) schedulePracticeRecovery(it, immediate = true)
            else clearPracticeRecovery(it.session.studentId)
        }
        requestGeneration.invalidate()
        backStack.add(screen)
        screen = next
        if (next is Screen.PracticeQuestionScreen) schedulePracticeRecovery(next, immediate = true)
    }

    private fun accountUnavailableScreen(title: String): Screen {
        // Fallback for entries a page can't mark as locked beforehand (home tasks, restored routes).
        return Screen.Error(
            title = "登录后使用$title",
            message = StudentAccessPolicy.accountRequiredMessage(),
            actionLabel = "查看账号状态",
            unavailableSession = currentSession(),
        )
    }


    private fun currentSession(): StudentSession? {
        return when (val current = screen) {
            is Screen.Home -> current.session
            is Screen.Settings -> current.session
            is Screen.LearnHub -> current.session
            is Screen.History -> current.session
            is Screen.HomeworkHistory -> current.session
            is Screen.Review -> current.session
            is Screen.HistoryDetail -> current.session
            is Screen.ReviewDetail -> current.session
            is Screen.ReviewRetryQuestion -> current.session
            is Screen.Directory -> current.session
            is Screen.GaokaoReview -> current.session
            is Screen.ReinforcementHome -> current.session
            is Screen.ReinforcementChapterPath -> current.session
            is Screen.ReinforcementScopeResult -> current.session
            is Screen.ReinforcementRetestResult -> current.session
            is Screen.ReinforcementTaskComplete -> current.session
            is Screen.ReinforcementReport -> current.session
            is Screen.ReinforcementReportHistory -> current.session
            is Screen.ReinforcementDiagnosticHistory -> current.session
            is Screen.ReinforcementDiagnosticAttemptDetail -> current.session
            is Screen.ReinforcementLearningTrace -> current.session
            is Screen.Learn -> current.session
            is Screen.PracticeQuestionScreen -> current.session
            is Screen.PracticeResultScreen -> current.session
            is Screen.PracticeReviewScreen -> current.session
            is Screen.Login,
            is Screen.Loading,
            is Screen.Error -> null
        }
    }

    private fun runWithLoading(
        title: String,
        message: String,
        replaceStack: Boolean = false,
        keepCurrent: Boolean = true,
        keepCurrentOnError: Boolean = keepCurrent,
        onError: ((Exception, Screen) -> Screen)? = null,
        work: () -> Screen,
    ) = runWithLoadingRequest(title, message, replaceStack, keepCurrent, keepCurrentOnError, onError) { work() }

    private fun runWithLoadingRequest(
        title: String,
        message: String,
        replaceStack: Boolean = false,
        keepCurrent: Boolean = true,
        keepCurrentOnError: Boolean = keepCurrent,
        onError: ((Exception, Screen) -> Screen)? = null,
        inlinePracticeProgress: Boolean = false,
        work: (Long) -> Screen,
    ) {
        val requestId = requestGeneration.begin()
        val previous = screen
        val previousSnapshot = (previous as? Screen.PracticeQuestionScreen)?.let(::recoverySnapshot)
        if (previous is Screen.PracticeQuestionScreen) schedulePracticeRecovery(previous, immediate = true)
        if (replaceStack) {
            endPracticeLeftBehind()
            backStack.clear()
        } else if (keepCurrent) {
            backStack.add(previous)
        }
        if (!inlinePracticeProgress) screen = Screen.Loading(title, message)
        executor.execute {
            try {
                previousSnapshot?.let { persistBeforeSubmission(it, requestId) }
                if (!requestGeneration.isCurrent(requestId)) return@execute
                val next = work(requestId)
                postForRequest(requestId) {
                    if (previous is Screen.PracticeQuestionScreen) {
                        answerDrafts.unlockAfterSubmission(previous.practice.questions.map { it.id })
                    }
                    when {
                        next is Screen.PracticeQuestionScreen -> schedulePracticeRecovery(next, immediate = true)
                        next is Screen.PracticeReviewScreen && next.practice.teacherPaper?.status != "grading" -> clearPracticeRecovery(next.session.studentId)
                        // A finished practice (reinforcement summary) must not be saved back.
                        previous is Screen.PracticeQuestionScreen && (next is Screen.PracticeResultScreen || previous.practice.teacherPaper != null) ->
                            schedulePracticeRecovery(previous, immediate = true)
                    }
                    screen = next
                }
            } catch (e: Exception) {
                postForRequest(requestId) {
                    if (previous is Screen.PracticeQuestionScreen) {
                        answerDrafts.unlockAfterSubmission(previous.practice.questions.map { it.id })
                    }
                    if (!keepCurrent && keepCurrentOnError) {
                        backStack.add(previous)
                    }
                    // A plain load can be retried in place; a practice submission never re-sends itself.
                    val retryable = onError == null && !inlinePracticeProgress && previous !is Screen.PracticeQuestionScreen
                    failedLoad = if (retryable) FailedLoad(title, message, work) else null
                    screen = onError?.invoke(e, previous) ?: Screen.Error(title, loadFailureMessage(e), retryable = retryable)
                }
            }
        }
    }

    private class FailedLoad(val title: String, val message: String, val work: (Long) -> Screen)
    private var failedLoad: FailedLoad? = null

    /** Runs the load that just failed again; the page underneath stays where it was in the stack. */
    fun retryFailedLoad() {
        val load = failedLoad ?: return
        if ((screen as? Screen.Error)?.retryable != true) return
        failedLoad = null
        runWithLoadingRequest(load.title, load.message, keepCurrent = false, keepCurrentOnError = false, work = load.work)
    }

    private fun postForRequest(requestId: Long, action: () -> Unit) {
        mainHandler.post {
            if (requestGeneration.isCurrent(requestId)) action()
        }
    }

    private fun applyForCurrentRequest(requestId: Long, action: () -> Boolean): Boolean {
        val task = FutureTask { if (requestGeneration.isCurrent(requestId)) action() else false }
        mainHandler.post(task)
        return task.get()
    }

    private fun persistBeforeSubmission(snapshot: PracticeRecoverySnapshot, requestId: Long) {
        recoveryExecutor.submit {
            if (!requestGeneration.isCurrent(requestId)) throw CancellationException()
            practiceRecoveryStore.save(snapshot)
        }.get()
        if (!requestGeneration.isCurrent(requestId)) throw CancellationException()
    }

    private fun scheduleActivePracticeRecovery(questionId: String, immediate: Boolean = false) {
        val snapshot = activeRecoverySnapshot() ?: return
        if (snapshot.screen.practice.questions.none { it.id == questionId }) return
        scheduleRecoverySnapshot(snapshot, immediate)
    }

    /**
     * A stroke rewrites only its own question's canvas file. The practice itself is saved once
     * (and again whenever answers or navigation change it), never per stroke.
     */
    private fun scheduleCanvasRecovery(questionId: String) {
        val snapshot = activeRecoverySnapshot() ?: return
        if (snapshot.screen.practice.questions.none { it.id == questionId }) return
        val saved = latestRecoverySnapshot
        if (saved == null || saved.screen.session.studentId != snapshot.screen.session.studentId ||
            !saved.screen.practice.samePracticeAs(snapshot.screen.practice)
        ) {
            scheduleRecoverySnapshot(snapshot, immediate = false)
            return
        }
        latestRecoverySnapshot = saved.copy(canvasSnapshots = snapshot.canvasSnapshots)
        val studentId = snapshot.screen.session.studentId
        val canvas = snapshot.canvasSnapshots[questionId]
        pendingCanvasSaves.remove(questionId)?.cancel(false)
        pendingCanvasSaves[questionId] = recoveryExecutor.schedule({
            runCatching { practiceRecoveryStore.saveCanvas(studentId, questionId, canvas) }
        }, RecoveryDebounceMs, TimeUnit.MILLISECONDS)
    }

    private fun cancelPendingCanvasSaves() {
        pendingCanvasSaves.values.forEach { it.cancel(false) }
        pendingCanvasSaves.clear()
    }

    private fun schedulePracticeRecovery(practiceScreen: Screen.PracticeQuestionScreen, immediate: Boolean) {
        scheduleRecoverySnapshot(recoverySnapshot(practiceScreen), immediate)
    }

    private fun scheduleRecoverySnapshot(snapshot: PracticeRecoverySnapshot, immediate: Boolean) {
        latestRecoverySnapshot = snapshot
        pendingRecoverySave?.cancel(false)
        pendingRecoverySave = recoveryExecutor.schedule({
            runCatching { practiceRecoveryStore.save(snapshot) }.onSuccess {
                mainHandler.post { cleanupUnreferencedMedia(snapshot) }
            }
        }, if (immediate) 0L else RecoveryDebounceMs, TimeUnit.MILLISECONDS)
    }

    private fun activeRecoverySnapshot(): PracticeRecoverySnapshot? = when (val current = screen) {
        is Screen.PracticeQuestionScreen -> recoverySnapshot(current)
        is Screen.ReviewRetryQuestion -> {
            // Reuse the same draft/media codec for a one-question review attempt.
            val kp = KpNode("review-retry", "错题变式", "", "", "", 0.0, "in_progress")
            val practice = Screen.PracticeQuestionScreen(current.session, DirectoryData(listOf(kp), 0, 1, 1),
                ChapterGroup("", "", listOf(kp)), kp, reviewRetryPractice(current.question, current.title), 0)
            recoverySnapshot(practice).copy(reviewRetry = current)
        }
        else -> null
    }

    private fun recoverySnapshot(practiceScreen: Screen.PracticeQuestionScreen): PracticeRecoverySnapshot {
        val questions = practiceScreen.practice.questions
        return PracticeRecoverySnapshot(
            screen = practiceScreen.copy(
                submissionState = PracticeSetSubmissionState(),
                questionStartedAtMs = System.currentTimeMillis(),
            ),
            drafts = answerDrafts.snapshots(questions.map { it.id }),
            completedItems = practiceReviewState.completedItems(questions),
            canvasSnapshots = getDraftCanvasSnapshots(questions.map { it.id }),
        )
    }

    /** Token renewal swaps the token mid-session, so what owns a request is the student. */
    private fun ownsSession(owner: StudentSession): Boolean = sessionStore.read()?.studentId == owner.studentId

    private fun clearPracticeRecovery(studentId: String) {
        if (latestRecoverySnapshot?.screen?.session?.studentId == studentId) latestRecoverySnapshot = null
        pendingRecoverySave?.cancel(false)
        pendingRecoverySave = null
        cancelPendingCanvasSaves()
        draftCanvasSnapshots.clear()
        recoveryExecutor.execute { practiceRecoveryStore.clear(studentId) }
    }

    companion object {
        private const val RecoveryDebounceMs = 250L

        fun factory(context: Context, recreatedStudentId: String? = null): ViewModelProvider.Factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T {
                require(modelClass.isAssignableFrom(AppController::class.java))
                return AppController(context.applicationContext, recreatedStudentId) as T
            }
        }
    }

    private fun reviewRetrySubmitFailureScreen(error: Exception, previous: Screen): Screen {
        if (backStack.lastOrNull() === previous) {
            backStack.removeAt(backStack.lastIndex)
        }
        val message = practiceFailureMessage(error, "变式题提交失败，请稍后重试")
        return when (previous) {
            is Screen.ReviewRetryQuestion -> previous.copy(retryMessage = message)
            is Screen.ReviewDetail -> previous.copy(retryMessage = message)
            else -> Screen.Error("错题复盘", message)
        }
    }

    private fun learnChatScope(kpId: String): String = "learn:$kpId"

    private fun questionChatScope(answerId: Int): String = "question-answer:$answerId"

    private fun Int.ifZero(fallback: Int): Int = if (this <= 0) fallback else this

    private fun diagnosticFeedbackFor(
        session: StudentSession,
        kp: KpNode,
        practice: PracticeSession,
        review: PracticeReview,
    ): DiagnosticFeedback? {
        val answers = review.submittedDiagnosticAnswers()
        if (answers.isEmpty()) return null
        return when (practice.sessionType) {
            PracticeSessionTypes.KpDiagnostic -> api.getKpSubmittedDiagnosticFeedback(
                token = session.token,
                studentId = session.studentId,
                kpId = kp.id,
                answers = answers,
            )
            PracticeSessionTypes.ScopeDiagnostic -> api.getScopeSubmittedDiagnosticFeedback(
                token = session.token,
                studentId = session.studentId,
                scopeType = "chapter",
                scopeId = kp.chapter,
                answers = answers,
            )
            else -> null
        }
    }

    private fun diagnosticFeedbackSafely(
        session: StudentSession,
        kp: KpNode,
        practice: PracticeSession,
        review: PracticeReview,
    ): DiagnosticFeedback? {
        return runCatching { diagnosticFeedbackFor(session, kp, practice, review) }.getOrNull()
    }

    private fun diagnosticFeedbackForCompletion(
        session: StudentSession,
        kp: KpNode,
        practice: PracticeSession,
        review: PracticeReview,
    ): DiagnosticFeedback? {
        if (practice.sessionType != PracticeSessionTypes.KpDiagnostic) {
            return diagnosticFeedbackSafely(session, kp, practice, review)
        }
        val feedback = requireKpDiagnosticFeedback(practice, review) {
            diagnosticFeedbackFor(session, kp, practice, review)
        }
        kpAssessmentProgressStore.markCompleted(session.studentId, kp.id)
        return feedback
    }

    private fun reinforcementCompletionScreen(
        session: StudentSession,
        data: DirectoryData,
        practice: PracticeSession,
        review: PracticeReview,
        context: ReinforcementPracticeContext?,
        clearCompletedState: Boolean = true,
    ): Screen? {
        if (context == null) return null
        val next = when (context) {
            is ReinforcementPracticeContext.ScopeDiagnostic -> {
                val result = api.getScopeSubmittedDiagnosticResult(
                    token = session.token,
                    studentId = session.studentId,
                    scopeType = context.scopeType,
                    scopeId = context.scopeId,
                    answers = review.submittedDiagnosticAnswers(),
                )
                val plan = if (context.scopeType == "section" && !StudentAccessPolicy.hasFullLearningAccess(session)) {
                    null
                } else {
                    resolveImprovementPlan(session, result)
                }
                Screen.ReinforcementScopeResult(session, data, result, plan)
            }
            is ReinforcementPracticeContext.TaskPractice -> {
                val plan = api.updateImprovementTaskStatus(
                    token = session.token,
                    studentId = session.studentId,
                    planId = context.planId,
                    taskId = context.taskId,
                    status = "practiced",
                )
                Screen.ReinforcementTaskComplete(
                    session = session,
                    data = data,
                    plan = plan,
                    taskId = context.taskId,
                    review = review,
                )
            }
            is ReinforcementPracticeContext.Retest -> {
                Screen.ReinforcementRetestResult(
                    session = session,
                    data = data,
                    result = api.submitImprovementRetestFeedback(
                        token = session.token,
                        studentId = session.studentId,
                        planId = context.planId,
                        attemptId = context.attemptId,
                        answers = review.submittedDiagnosticAnswers(),
                    ),
                )
            }
        }
        if (clearCompletedState) clearCompletedPracticeState(session, practice)
        return next
    }

    private fun resolveImprovementPlan(
        session: StudentSession,
        result: ScopeDiagnosticResult,
    ): ImprovementPlan {
        fun latestMatchingPlan(): ImprovementPlan? {
            return runCatching {
                api.getLatestImprovementPlan(
                    token = session.token,
                    studentId = session.studentId,
                    scopeType = result.scopeType,
                    scopeId = result.scopeId,
                )
            }.getOrNull()?.takeIf { improvementPlanMatchesDiagnostic(it, result) }
        }

        latestMatchingPlan()?.let { return it }
        return try {
            api.createImprovementPlanFromScopeResult(
                token = session.token,
                studentId = session.studentId,
                result = result,
            )
        } catch (error: Exception) {
            latestMatchingPlan() ?: throw error
        }
    }

    private fun clearCompletedPracticeState(
        session: StudentSession,
        practice: PracticeSession,
    ) {
        clearPracticeRecovery(session.studentId)
        answerDrafts.clearSession(practice.questions.map { it.id })
        practiceReviewState.clearSession(practice.questions)
    }

    private fun showPreparedReinforcementCompletion(
        session: StudentSession,
        practice: PracticeSession,
        completion: Screen,
    ) {
        requestGeneration.invalidate()
        clearCompletedPracticeState(session, practice)
        backStack.removeAll { it.isSamePracticeFlow(practice) }
        screen = completion
    }

    private fun scopeResultFromPlan(plan: ImprovementPlan): ScopeDiagnosticResult {
        return plan.sourceResult ?: ScopeDiagnosticResult(
            diagnosticAttemptId = plan.diagnosticAttemptId,
            scopeType = plan.scopeType,
            scopeId = plan.scopeId,
            scopeName = plan.scopeName,
            kpResults = plan.tasks.map { task ->
                ScopeDiagnosticKpResult(
                    id = task.id,
                    kpId = task.kpId,
                    kpName = task.kpName,
                    groupId = task.groupId,
                    groupName = task.groupName,
                    correctCount = task.correctCount,
                    totalCount = task.totalCount,
                    masteryBefore = task.masteryBefore,
                    masteryAfter = task.masteryAfter,
                    isWeak = task.isWeak,
                )
            },
            correctCount = plan.correctCount,
            totalCount = plan.totalCount,
            weakKpIds = plan.tasks.filter { it.isWeak }.map { it.kpId },
            recommendation = "按当前提升路径继续完成专项练习。",
            feedback = "本轮定位已生成 ${plan.tasks.size} 个提升任务。",
        )
    }

    private fun kpForTask(data: DirectoryData, task: ImprovementTask): KpNode {
        return data.kps.firstOrNull { it.id == task.kpId } ?: KpNode(
            id = task.kpId,
            name = task.kpName,
            volume = "巩固提升",
            chapter = task.groupName.ifBlank { "专项提升" },
            section = task.recommendedAction.ifBlank { "专项练" },
            mastery = task.masteryAfter,
            status = if (task.isWeak) "practice" else "in_progress",
        )
    }

    private fun PracticeSession.samePracticeAs(other: PracticeSession): Boolean {
        return questions.map { it.id } == other.questions.map { it.id } &&
            teacherPaper?.attemptId == other.teacherPaper?.attemptId
    }

    private fun Screen.isSamePracticeFlow(practice: PracticeSession): Boolean {
        return when (this) {
            is Screen.PracticeQuestionScreen -> this.practice.samePracticeAs(practice)
            is Screen.PracticeResultScreen -> this.practice.samePracticeAs(practice)
            is Screen.PracticeReviewScreen -> this.practice.samePracticeAs(practice)
            else -> false
        }
    }

    private fun dropCompletedPracticeFlow(reviewScreen: Screen.PracticeReviewScreen) {
        backStack.removeAll { target ->
            when (target) {
                is Screen.PracticeQuestionScreen -> target.practice.samePracticeAs(reviewScreen.practice)
                is Screen.PracticeResultScreen -> target.practice.samePracticeAs(reviewScreen.practice)
                is Screen.PracticeReviewScreen -> target.practice.samePracticeAs(reviewScreen.practice)
                is Screen.Learn -> target.kp.id == reviewScreen.kp.id
                else -> false
            }
        }
    }
}
