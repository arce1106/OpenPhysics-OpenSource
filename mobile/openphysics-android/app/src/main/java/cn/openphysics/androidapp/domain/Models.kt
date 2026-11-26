package cn.openphysics.androidapp.domain

import kotlin.math.roundToInt

data class StudentSession(
    val token: String,
    val studentId: String,
    val username: String,
    val displayName: String,
    val accountStatus: String = "active",
) {
    fun displayLabel(): String = displayName.ifBlank { username.ifBlank { studentId } }
}

data class KpNode(
    val id: String,
    val name: String,
    val volume: String,
    val chapter: String,
    val section: String,
    val mastery: Double,
    val status: String,
    val lastPracticed: String = "",
    val learningState: String = "",
    val learningStateLabel: String = "",
    val learningStateTone: String = "",
    val contentAvailable: Boolean = true,
    val practiceAvailable: Boolean = true,
) {
    val contentPending: Boolean get() = status == "pending_content" || !contentAvailable
    // Rounded like iOS and the web (0.935 -> 94%); truncation showed one point less on Android.
    fun masteryPercent(): Int = (mastery.coerceIn(0.0, 1.0) * 100).roundToInt()
}

data class DirectoryData(
    val kps: List<KpNode>,
    val mastered: Int,
    val inProgress: Int,
    val total: Int,
    val relations: List<DirectoryRelation> = emptyList(),
)

data class DirectoryRelation(
    val id: Int,
    val sourceId: String,
    val targetId: String,
    val relationType: String,
    val reason: String = "",
)

data class LearningCatalogMappingSummary(
    val knowledgePointCount: Int = 0,
    val labelRuleCount: Int = 0,
    val questionOverrideCount: Int = 0,
)

data class LearningCatalogNode(
    val id: String,
    val code: String,
    val nodeType: String,
    val title: String,
    val description: String = "",
    val sortOrder: Int = 0,
    val displayCode: String = "",
    val mappingSummary: LearningCatalogMappingSummary = LearningCatalogMappingSummary(),
    val children: List<LearningCatalogNode> = emptyList(),
) {
    fun topics(): List<LearningCatalogNode> = children.filter { it.nodeType == "topic" }

    fun topicDisplayCode(): String {
        if (displayCode.isNotBlank()) return displayCode
        return code.removePrefix("topic_").ifBlank { code }
    }
}

data class LearningCatalogData(
    val id: String,
    val code: String,
    val name: String,
    val description: String = "",
    val version: Int = 0,
    val enabled: Boolean = true,
    val sortOrder: Int = 0,
    val nodeCount: Int = 0,
    val topicCount: Int = 0,
    val nodes: List<LearningCatalogNode> = emptyList(),
) {
    fun knowledgeBlocks(): List<LearningCatalogNode> = nodes.filter { it.nodeType == "block" }

    fun topic(nodeId: String): LearningCatalogNode? = knowledgeBlocks()
        .asSequence()
        .flatMap { it.topics().asSequence() }
        .firstOrNull { it.id == nodeId }
}

enum class LearningCatalogTopicLayer(
    val apiValue: String,
    val title: String,
    val questionCount: Int,
    val number: String,
    val description: String,
) {
    Diagnostic(
        apiValue = "diagnostic",
        title = "专题摸底",
        questionCount = 8,
        number = "",
        description = "先完成整组题目，再统一查看批改结果。",
    ),
    Foundation(
        apiValue = "foundation",
        title = "基础巩固",
        questionCount = 5,
        number = "01",
        description = "5 题 · 专题内基础梯度 · 题型按专题特点安排。",
    ),
    Breakthrough(
        apiValue = "breakthrough",
        title = "典型突破",
        questionCount = 4,
        number = "02",
        description = "4 题 · 专题内中段梯度 · 突出典型模型与关键方法。",
    ),
    Transfer(
        apiValue = "transfer",
        title = "综合迁移",
        questionCount = 4,
        number = "03",
        description = "4 题 · 专题内较高梯度 · 侧重综合迁移与复杂情境。",
    ),
    Paper(
        apiValue = "paper",
        title = "专题套卷",
        questionCount = 10,
        number = "",
        description = "混合基础、典型和综合题，共 10 题，适合阶段验收与限时训练。",
    );

    companion object {
        fun fromApi(value: String): LearningCatalogTopicLayer = entries
            .firstOrNull { it.apiValue == value }
            ?: Foundation
    }
}

data class TeacherPaper(
    val id: String,
    val title: String,
    val questionCount: Int,
    val hasVideo: Boolean = false,
    val attemptToken: String = "",
    val attemptId: String = "",
    val status: String = "not_started",
    val submittedAt: String = "",
    val completedAt: String = "",
    /** Teacher homework once finished. */
    val score: HomeworkScore? = null,
) {
    val entryLabel: String get() = when (status) {
        "completed" -> "查看答卷"
        "grading" -> "查看批改进度"
        "in_progress" -> "继续作答"
        else -> "开始作答"
    }
}

/**
 * A finished homework's score on the teacher's points, also out of 100. Until [released]
 * it is the app's own grading, which the teacher's review may still change.
 */
data class HomeworkScore(
    val score: Double,
    val maxScore: Double,
    val percent: Int,
    val released: Boolean,
) {
    val label: String get() = "$percent 分"
    val note: String get() = if (released) "老师已审核" else "AI 批改，老师审核后可能调整"
}

/** Personalized homework a teacher sent to this account; answered like a fixed paper. */
data class TeacherHomework(
    val attemptId: String,
    val assignmentId: String,
    val title: String,
    val className: String,
    val questionCount: Int,
    val gradedCount: Int,
    /** in_progress: answering; grading: submitted, answers being graded; completed: done. */
    val status: String,
    val publishedAt: String = "",
    /** "paper": handed in on paper and scored by the teacher; the results are in the practice record. */
    val delivery: String = "",
    val score: HomeworkScore? = null,
) {
    val isPaper: Boolean get() = delivery == "paper"
    val actionTitle: String get() = when (status) {
        "completed" -> "查看结果"
        "grading" -> "继续批改"
        else -> "去作答"
    }
    val detail: String get() = when (status) {
        "completed" -> "$className · ${if (isPaper) "纸质作业" else "$questionCount 题"} · ${score?.label ?: if (isPaper) "已出成绩" else "已完成"}"
        "grading" -> "$className · 已批改 $gradedCount/$questionCount"
        else -> "$className · $questionCount 题"
    }
}

data class QuestionLessonVideo(
    val id: String,
    val title: String,
    val durationSeconds: Int,
    val available: Boolean,
    val lockedReason: String = "",
)

data class TeacherPaperQuestionVideo(
    val questionId: String,
    val title: String,
    val videoUrl: String,
    val durationSeconds: Int,
)

data class LearningCatalogTopicOverview(
    val catalogCode: String,
    val nodeId: String,
    val topicCode: String,
    val title: String,
    val description: String = "",
    val status: String,
    val statusLabel: String,
    val recommendedLayer: LearningCatalogTopicLayer,
    val recommendedLayerName: String,
    val nextAction: String,
    val coreKnowledgePointCount: Int,
    val attemptedKnowledgePointCount: Int,
    val masteredKnowledgePointCount: Int,
    val needsReviewKnowledgePointCount: Int,
    val averageMastery: Double,
    val performanceScore: Double? = null,
    val evidenceCount: Int = 0,
    val lastPracticed: String = "",
    val teacherPapers: List<TeacherPaper> = emptyList(),
) {
    fun averageMasteryPercent(): Int = (averageMastery * 100).roundToInt().coerceIn(0, 100)

    fun topicPerformanceLabel(): String = performanceScore?.let { "${(it * 100).roundToInt().coerceIn(0, 100)}% 专题作答表现" } ?: "专题表现待检测"
    fun untestedKnowledgePointCount(): Int = (coreKnowledgePointCount - attemptedKnowledgePointCount).coerceAtLeast(0)
    fun hasLearningEvidence(): Boolean = attemptedKnowledgePointCount > 0
}

data class KnowledgeMasteryEvidence(
    val source: String,
    val weight: Double,
    val summary: String = "",
)

data class KnowledgeMasteryJudgment(
    val kpId: String,
    val kpName: String,
    val masteryScore: Double?,
    val masteryLevel: String,
    val interventionStatus: String,
    val confidence: String,
    val nextAction: String,
    val reason: String = "",
    val evidenceSources: List<String> = emptyList(),
    val evidences: List<KnowledgeMasteryEvidence> = emptyList(),
    val lastAnsweredAt: String = "",
    val lastDiagnosticAt: String = "",
    val lastRetestAt: String = "",
    val recentCorrectCount: Int = 0,
    val recentTotalCount: Int = 0,
    val recentCorrectRate: Double? = null,
    val latestDiagnosticAttemptId: String = "",
    val latestDiagnosticCorrectCount: Int? = null,
    val latestDiagnosticTotalCount: Int? = null,
    val latestDiagnosticIsWeak: Boolean? = null,
    val activePlanId: String = "",
    val activeTaskId: String = "",
    val activeTaskStatus: String = "",
    val latestRetestAttemptId: String = "",
    val latestRetestPassed: Boolean? = null,
    val updatedAt: String = "",
)

data class DashboardData(
    val diagnosis: DiagnosisSummary,
    val plan: PlanRecommendation?,
    val motivation: MotivationPanel,
)

data class GrowthReportData(
    val id: String,
    val summary: String,
    val totalAnswers: Int,
    val startDate: String = "",
    val endDate: String = "",
)

data class TrainStartData(
    val isFirstTime: Boolean,
    val hasDiagnosed: Boolean,
    val recommendedKps: List<RecommendedKp>,
)

data class RecommendedKp(
    val kpId: String,
    val kpName: String,
    val mastery: Double,
    val reason: String,
)

data class DiagnosisSummary(
    val overallMastery: Double,
    val masteredCount: Int,
    val inProgressCount: Int,
    val lockedCount: Int,
    val weakPoints: List<WeakPoint>,
)

data class WeakPoint(
    val kpId: String,
    val kpName: String,
    val mastery: Double,
)

data class PlanRecommendation(
    val kpId: String,
    val kpName: String,
    val mastery: Double,
    val reason: String,
    val estimatedQuestions: Int,
    val estimatedMinutes: Int,
)

data class MotivationPanel(
    val streakDays: Int,
    val weeklyKpsMastered: Int,
    val mistakeBacklogCount: Int,
    val nextMilestone: String,
)

data class DailyLoopRing(
    val key: String,
    val label: String,
    val completed: Boolean,
    val current: Int,
    val actualCurrent: Int,
    val target: Int,
    val overflow: Int,
    val autoCompleted: Boolean,
    val pendingMistakes: Int? = null,
    val evidence: String,
)

data class DailyLoopRings(
    val practice: DailyLoopRing,
    val review: DailyLoopRing,
)

data class DailyLearningLoopDay(
    val date: String,
    val isEffectiveDay: Boolean,
    val isHighQualityDay: Boolean,
    val rings: DailyLoopRings,
    val summary: String,
    val nextAction: String,
)

data class DailyLearningLoop(
    val date: String,
    val isEffectiveDay: Boolean,
    val isHighQualityDay: Boolean,
    val rings: DailyLoopRings,
    val summary: String,
    val nextAction: String,
    val streakDays: Int,
)

data class DailyLearningLoopHistorySummary(
    val practiceTotal: Int,
    val reviewTotal: Int,
    val practiceClosedDays: Int,
    val reviewClosedDays: Int,
    val dualClosedDays: Int,
    val effectiveDays: Int,
)

data class DailyLearningLoopHistory(
    val startDate: String,
    val endDate: String,
    val practiceTarget: Int,
    val reviewTarget: Int,
    val summary: DailyLearningLoopHistorySummary,
    val days: List<DailyLearningLoopDay>,
)

data class ChapterGroup(
    val volume: String,
    val chapter: String,
    val kps: List<KpNode>,
) {
    fun masteredCount(): Int = kps.count { it.learningState == "mastered" }

    fun averageMasteryPercent(): Int {
        val ready = kps.filterNot { it.contentPending }
        if (ready.isEmpty()) return 0
        return (ready.sumOf { it.mastery.coerceIn(0.0, 1.0) } * 100 / ready.size).roundToInt()
    }
}

data class LearnBundle(
    val kpId: String,
    val kpName: String,
    val card: KnowledgeCard?,
    val videos: List<VideoItem>,
    val slides: SlideDeck? = null,
    val simulations: List<SimulationContent> = emptyList(),
    val examples: List<LearnExample> = emptyList(),
    val progress: Map<String, LearnProgressItem> = emptyMap(),
)

data class KnowledgeCard(
    val contentId: String,
    val title: String,
    val sections: List<CardSection>,
    val consumed: Boolean = false,
)

data class LearnCompleteRequest(
    val kpId: String,
    val contentId: String,
    val contentType: String,
    val timeSpentSeconds: Int,
)

fun KnowledgeCard.toCompletionRequest(kpId: String, timeSpentSeconds: Int = 0): LearnCompleteRequest {
    return LearnCompleteRequest(
        kpId = kpId,
        contentId = contentId,
        contentType = "card",
        timeSpentSeconds = timeSpentSeconds,
    )
}

data class CardSection(
    val title: String,
    val text: String,
    val type: String = "concept",
    val rendered: RenderedRichContent? = null,
    val content: CardSectionContent = CardSectionContent(),
)

data class CardSectionContent(
    val html: String = "",
    val latex: String = "",
    val variableTable: List<FormulaVariable> = emptyList(),
    val svg: String = "",
    val stem: String = "",
    val solution: String = "",
    val keyTakeaway: String = "",
    val items: List<String> = emptyList(),
)

data class FormulaVariable(
    val symbol: String,
    val name: String,
    val unit: String = "",
)

data class VideoItem(
    val title: String,
    val url: String,
    val uploader: String,
    val category: String,
)

data class SlideDeck(
    val title: String,
    val items: List<SlideItem>,
)

data class SlideItem(
    val title: String,
    val body: String,
    val rendered: RenderedRichContent? = null,
)

data class SimulationContent(
    val id: String,
    val title: String,
    val type: String,
    val html: String = "",
    val consumed: Boolean = false,
)

data class LearnExample(
    val title: String,
    val body: String = "",
    val consumed: Boolean = false,
)

data class LearnProgressItem(
    val consumed: Int,
    val total: Int,
)

data class PracticeSession(
    val objective: String,
    val questions: List<PracticeQuestion>,
    val sessionType: String = "practice",
    val strategy: String = "",
    val teacherPaper: TeacherPaper? = null,
    val answers: Map<String, SubmitResult> = emptyMap(),
)

object PracticeSessionTypes {
    const val Practice = "practice"
    const val KpDiagnostic = "kp_diagnostic"
    const val ScopeDiagnostic = "scope_diagnostic"
    const val ReviewRetry = "review_retry"
}

data class DiagnosticFeedback(
    val title: String,
    val feedback: String,
    val recommendation: String,
    val correctCount: Int,
    val totalCount: Int,
    val masteryBefore: Double,
    val masteryAfter: Double,
)

data class ScopeDiagnosticKpResult(
    val id: String,
    val kpId: String,
    val kpName: String,
    val groupId: String = "",
    val groupName: String = "",
    val correctCount: Int,
    val totalCount: Int,
    val masteryBefore: Double,
    val masteryAfter: Double,
    val isWeak: Boolean,
)

data class ScopeDiagnosticResult(
    val diagnosticAttemptId: String,
    val scopeType: String,
    val scopeId: String,
    val scopeName: String,
    val kpResults: List<ScopeDiagnosticKpResult>,
    val correctCount: Int,
    val totalCount: Int,
    val weakKpIds: List<String>,
    val recommendation: String,
    val feedback: String,
)

data class ImprovementTask(
    val id: String,
    val planId: String,
    val kpId: String,
    val kpName: String,
    val groupId: String = "",
    val groupName: String = "",
    val correctCount: Int,
    val totalCount: Int,
    val masteryBefore: Double,
    val masteryAfter: Double,
    val isWeak: Boolean,
    val priority: Int,
    val status: String,
    val recommendedAction: String,
    val reason: String,
) {
    fun canPractice(planStatus: String): Boolean {
        if (status == "passed") return false
        if (status == "practiced") return false
        if (planStatus == "completed") return false
        return true
    }
}

data class ImprovementPlan(
    val id: String,
    val studentId: String,
    val diagnosticAttemptId: String,
    val scopeType: String,
    val scopeId: String,
    val scopeName: String,
    val createdAt: String,
    val updatedAt: String = "",
    val completedAt: String = "",
    val correctCount: Int,
    val totalCount: Int,
    val weakCount: Int,
    val status: String,
    val currentTaskId: String = "",
    val sourceResult: ScopeDiagnosticResult? = null,
    val tasks: List<ImprovementTask>,
) {
    fun isCompleted(): Boolean = status == "completed"

    fun currentTask(): ImprovementTask? {
        if (isCompleted()) return null
        if (currentTaskId.isNotBlank()) {
            tasks.firstOrNull { it.id == currentTaskId && it.canPractice(status) }?.let { return it }
        }
        return tasks.sortedBy { it.priority }.firstOrNull { it.canPractice(status) }
    }

    fun readyForRetest(): Boolean {
        return !isCompleted() && currentTask() == null && status == "ready_for_retest"
    }
}

data class ImprovementRetestSession(
    val attemptId: String,
    val plan: ImprovementPlan,
    val session: PracticeSession,
)

data class ImprovementRetestTaskResult(
    val taskId: String,
    val kpId: String,
    val kpName: String,
    val correctCount: Int,
    val totalCount: Int,
    val masteryBefore: Double?,
    val masteryAfter: Double?,
    val passed: Boolean,
    val nextStatus: String,
    val feedback: String,
)

data class ImprovementRetestResult(
    val attemptId: String,
    val plan: ImprovementPlan,
    val correctCount: Int,
    val totalCount: Int,
    val passedCount: Int,
    val needsRetestCount: Int,
    val taskResults: List<ImprovementRetestTaskResult>,
)

data class ImprovementReportSummary(
    val planId: String,
    val scopeType: String,
    val scopeId: String,
    val scopeName: String,
    val planStatus: String,
    val diagnosticCorrectCount: Int,
    val diagnosticTotalCount: Int,
    val diagnosticAccuracy: Double,
    val taskCount: Int,
    val weakTaskCount: Int,
    val passedTaskCount: Int,
    val needsRetestTaskCount: Int,
    val practicedTaskCount: Int,
    val pendingTaskCount: Int,
    val retestAttemptCount: Int,
    val latestRetestAccuracy: Double?,
    val completed: Boolean,
) {
    fun diagnosticAccuracyPercent(): Int = (diagnosticAccuracy * 100).toInt()
}

data class ImprovementReportTask(
    val taskId: String,
    val kpId: String,
    val kpName: String,
    val priority: Int,
    val status: String,
    val recommendedAction: String,
    val reason: String,
    val diagnosticCorrectCount: Int,
    val diagnosticTotalCount: Int,
    val masteryBefore: Double,
    val masteryAfterDiagnostic: Double,
    val latestRetestCorrectCount: Int?,
    val latestRetestTotalCount: Int?,
    val latestRetestPassed: Boolean?,
    val finalLabel: String,
)

data class ImprovementReportRetestAttempt(
    val attemptId: String,
    val status: String,
    val correctCount: Int,
    val totalCount: Int,
    val passedCount: Int,
    val needsRetestCount: Int,
    val createdAt: String = "",
    val submittedAt: String = "",
)

data class ImprovementReport(
    val summary: ImprovementReportSummary,
    val diagnosticResult: ScopeDiagnosticResult?,
    val tasks: List<ImprovementReportTask>,
    val retestAttempts: List<ImprovementReportRetestAttempt>,
    val strengths: List<String>,
    val remainingWeaknesses: List<String>,
    val nextActions: List<String>,
) {
    fun summaryLabel(): String = "检测准确率 ${summary.diagnosticAccuracyPercent()}%"
}

data class ImprovementReportListItem(
    val planId: String,
    val scopeType: String,
    val scopeId: String,
    val scopeName: String,
    val createdAt: String = "",
    val completedAt: String = "",
    val diagnosticCorrectCount: Int,
    val diagnosticTotalCount: Int,
    val diagnosticAccuracy: Double,
    val taskCount: Int,
    val passedTaskCount: Int,
    val needsRetestTaskCount: Int,
    val latestRetestAccuracy: Double?,
    val summaryLabel: String,
    val highlight: String,
)

data class ImprovementReportListResponse(
    val items: List<ImprovementReportListItem>,
    val total: Int,
    val limit: Int,
    val offset: Int,
)

data class ScopeDiagnosticAttemptListItem(
    val attemptId: String,
    val scopeType: String,
    val scopeId: String,
    val scopeName: String,
    val diagnosticType: String,
    val createdAt: String,
    val submittedAt: String,
    val correctCount: Int,
    val totalCount: Int,
    val weakCount: Int,
    val recommendation: String = "",
    val feedback: String = "",
    val linkedPlanId: String = "",
    val linkedPlanStatus: String = "",
    val linkedReportAvailable: Boolean,
)

data class ScopeDiagnosticAttemptListResponse(
    val items: List<ScopeDiagnosticAttemptListItem>,
    val total: Int,
    val limit: Int,
    val offset: Int,
)

data class ScopeDiagnosticAttemptDetail(
    val attemptId: String,
    val studentId: String,
    val scopeType: String,
    val scopeId: String,
    val scopeName: String,
    val diagnosticType: String,
    val status: String,
    val createdAt: String,
    val submittedAt: String,
    val questionIds: List<String>,
    val answerIds: List<String>,
    val correctCount: Int,
    val totalCount: Int,
    val weakCount: Int,
    val weakKpIds: List<String>,
    val recommendation: String = "",
    val feedback: String = "",
    val kpResults: List<ScopeDiagnosticKpResult>,
    val linkedPlanId: String = "",
    val linkedPlanStatus: String = "",
    val linkedReportAvailable: Boolean,
)

data class LearningTraceEvent(
    val id: String,
    val eventType: String,
    val eventTime: String,
    val studentId: String,
    val scopeType: String = "",
    val scopeId: String = "",
    val scopeName: String = "",
    val title: String,
    val description: String,
    val attemptId: String = "",
    val planId: String = "",
    val taskId: String = "",
    val retestAttemptId: String = "",
    val kpId: String = "",
    val kpName: String = "",
    val statusLabel: String = "",
    val primaryAction: String = "",
    val reportAvailable: Boolean,
)

data class LearningTraceResponse(
    val items: List<LearningTraceEvent>,
    val total: Int,
    val limit: Int,
    val offset: Int,
)

data class MasteryUpdateValue(
    val before: Double,
    val after: Double,
    val name: String,
)

data class SubmittedDiagnosticAnswer(
    val answerId: Int,
    val masteryUpdate: Map<String, MasteryUpdateValue>,
)

data class PracticeQuestion(
    val id: String,
    val stem: String,
    val questionType: String,
    val options: List<PracticeOption>,
    val images: List<QuestionImage>,
    val correctAnswer: String = "",
    val explanation: String = "",
    val stemRendered: RenderedRichContent? = null,
    val correctAnswerRendered: RenderedRichContent? = null,
    val explanationRendered: RenderedRichContent? = null,
    val targetKnowledgePointId: String = "",
    val topicContext: String? = null,
    val lessonVideo: QuestionLessonVideo? = null,
) {
    fun isChoice(): Boolean = options.isNotEmpty()
}

data class PracticeOption(
    val label: String,
    val text: String,
    val rendered: RenderedRichContent? = null,
    val textRendered: RenderedRichContent? = null,
)

data class RenderedRichContent(
    val html: String = "",
    val plainText: String = "",
    val renderer: String = "",
    val rendererVersion: String = "",
    val contentHash: String = "",
    val hasMath: Boolean = false,
    val hasImage: Boolean = false,
    val hasMarkdownTable: Boolean = false,
    val errors: List<RenderedRichContentError> = emptyList(),
)

data class RenderedRichContentError(
    val type: String = "",
    val message: String = "",
    val latex: String = "",
    val position: Int? = null,
)

data class QuestionImage(
    val id: Int,
    val imagePath: String,
    val imageUrl: String,
    val imageType: String,
    val description: String,
)

data class SubmitResult(
    val answerId: Int?,
    val correct: Boolean,
    val correctAnswer: String,
    val explanation: String,
    val aiFeedback: String,
    val extractedAnswer: String = "",
    val detectedMisconceptionName: String = "",
    val processGrading: ProcessGrading? = null,
    val masteryUpdate: Map<String, MasteryUpdateValue> = emptyMap(),
    val cleared: Boolean = false,
    val correctAnswerRendered: RenderedRichContent? = null,
    val explanationRendered: RenderedRichContent? = null,
    val aiFeedbackRendered: RenderedRichContent? = null,
    val extractedAnswerRendered: RenderedRichContent? = null,
    val givenAnswer: String = "",
    val lessonVideo: QuestionLessonVideo? = null,
)

data class PracticeSelfReviewItem(
    val label: String,
    val status: String,
)

data class PracticeSelfReviewDraft(
    val items: List<PracticeSelfReviewItem>,
    val timeSpentMs: Long = 0L,
)

data class PaperBatchSolution(
    val correctAnswer: String,
    val explanation: String,
)

data class PaperBatchGradeResponse(
    val results: Map<String, SubmitResult>,
    val errors: Map<String, String>,
    val solutions: Map<String, PaperBatchSolution>,
)

data class ProcessGrading(
    val feedback: String,
    val firstError: String,
    val nextAction: String,
    val answerImagePaths: List<String>,
    val confidenceLevel: String,
    val needsHumanReview: Boolean,
    val processScore: Int? = null,
    val processScorePercent: Double? = null,
    val score: Double? = null,
    val maxScore: Double? = null,
    val modelCorrect: Boolean? = null,
    val equationCorrect: Boolean? = null,
    val calculationCorrect: Boolean? = null,
    val unitCorrect: Boolean? = null,
    val errorTypeName: String = "",
    val gradingBasis: String = "",
    val gradingConfidence: Double? = null,
    val stepScores: List<ProcessStepScore> = emptyList(),
    val feedbackRendered: RenderedRichContent? = null,
    val firstErrorRendered: RenderedRichContent? = null,
    val nextActionRendered: RenderedRichContent? = null,
    val gradingBasisRendered: RenderedRichContent? = null,
)

data class ProcessStepScore(
    val name: String,
    val score: Double,
    val maxScore: Double,
    val comment: String = "",
)

data class TutorChatMessage(
    val role: String,
    val content: String,
)

data class AnswerHistoryRecord(
    val id: Int,
    val questionId: String,
    val stemText: String,
    val stemRendered: RenderedRichContent? = null,
    val questionType: String,
    val options: List<PracticeOption>,
    val images: List<QuestionImage>,
    val kpNames: List<String>,
    val givenAnswer: String,
    val isCorrect: Boolean,
    val correctAnswer: String,
    val correctAnswerRendered: RenderedRichContent? = null,
    val explanation: String,
    val explanationRendered: RenderedRichContent? = null,
    val createdAt: String,
    val answerImages: List<QuestionImage> = emptyList(),
    val processGrading: ProcessGrading? = null,
    val lessonVideo: QuestionLessonVideo? = null,
)

data class ReviewMistake(
    val answerId: Int,
    val questionId: String,
    val stemText: String,
    val stemRendered: RenderedRichContent? = null,
    val questionType: String,
    val options: List<PracticeOption>,
    val images: List<QuestionImage>,
    val givenAnswer: String,
    val correctAnswer: String,
    val correctAnswerRendered: RenderedRichContent? = null,
    val explanation: String,
    val explanationRendered: RenderedRichContent? = null,
    val misconceptionName: String,
    val createdAt: String,
    val answerImages: List<QuestionImage> = emptyList(),
    val processGrading: ProcessGrading? = null,
    val isDetailLoaded: Boolean = true,
    val lessonVideo: QuestionLessonVideo? = null,
) {
    val needsReview: Boolean = true
}

/** The server's answer to closing a mistake; [detail] says why it stayed open. */
data class ReviewCompletion(
    val cleared: Boolean,
    val detail: String = "",
)

data class ReviewVariationQuestion(
    val variationType: String,
    val title: String,
    val reason: String,
    val question: PracticeQuestion,
)

data class ReviewGroup(
    val kpId: String,
    val kpName: String,
    val wrongCount: Int,
    val mistakes: List<ReviewMistake>,
)

data class ReviewData(
    val groups: List<ReviewGroup>,
    val reviewedCount: Int,
    val totalCount: Int,
    val reviewCenter: ReviewCenter? = null,
) {
    val pendingCount: Int = groups.sumOf { it.wrongCount }
}

data class ReviewCenter(
    val totalPending: Int,
    val primaryFocus: ReviewErrorGroup?,
    val errorGroups: List<ReviewErrorGroup>,
    val reviewSteps: List<ReviewStep>,
    val stageCounts: Map<String, Int>,
)

data class ReviewErrorGroup(
    val errorType: String,
    val errorName: String,
    val count: Int,
    val kpNames: List<String>,
    val sampleAnswerId: Int?,
    val firstError: String,
    val nextAction: String,
)

data class ReviewStep(
    val title: String,
    val description: String,
)
