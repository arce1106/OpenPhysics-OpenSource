package cn.openphysics.androidapp.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import cn.openphysics.androidapp.domain.DirectoryData
import cn.openphysics.androidapp.domain.ImprovementPlan
import cn.openphysics.androidapp.domain.ImprovementReport
import cn.openphysics.androidapp.domain.ImprovementReportListItem
import cn.openphysics.androidapp.domain.ImprovementReportListResponse
import cn.openphysics.androidapp.domain.ImprovementReportSummary
import cn.openphysics.androidapp.domain.ImprovementReportTask
import cn.openphysics.androidapp.domain.ImprovementRetestResult
import cn.openphysics.androidapp.domain.ImprovementTask
import cn.openphysics.androidapp.domain.KpNode
import cn.openphysics.androidapp.domain.KnowledgeMasteryJudgment
import cn.openphysics.androidapp.domain.LearningTraceEvent
import cn.openphysics.androidapp.domain.LearningTraceResponse
import cn.openphysics.androidapp.domain.ScopeDiagnosticAttemptDetail
import cn.openphysics.androidapp.domain.ScopeDiagnosticAttemptListItem
import cn.openphysics.androidapp.domain.ScopeDiagnosticAttemptListResponse
import cn.openphysics.androidapp.domain.ScopeDiagnosticKpResult
import cn.openphysics.androidapp.domain.ScopeDiagnosticResult
import cn.openphysics.androidapp.domain.TrainStartData
import cn.openphysics.androidapp.ui.KnowledgeMasteryDisplayFallback
import cn.openphysics.androidapp.ui.PracticeReview
import cn.openphysics.androidapp.ui.mapKnowledgeMasteryJudgmentToMasteryDisplay
import cn.openphysics.androidapp.ui.components.LearningCard
import cn.openphysics.androidapp.ui.components.PrimaryActionButton
import cn.openphysics.androidapp.ui.components.SecondaryActionButton
import cn.openphysics.androidapp.ui.components.StatusChip
import cn.openphysics.androidapp.ui.design.OpenPhysicsColors
import cn.openphysics.androidapp.ui.design.OpenPhysicsRadius
import cn.openphysics.androidapp.ui.design.OpenPhysicsTone

private val VOLUME_ORDER = listOf(
    "必修 第一册",
    "必修 第二册",
    "必修 第三册",
    "选择性必修 第一册",
    "选择性必修 第二册",
    "选择性必修 第三册",
)

private val SHORT_VOLUME_LABELS = mapOf(
    "必修 第一册" to "必修一",
    "必修 第二册" to "必修二",
    "必修 第三册" to "必修三",
    "选择性必修 第一册" to "选必一",
    "选择性必修 第二册" to "选必二",
    "选择性必修 第三册" to "选必三",
)

data class ReinforcementChapterPlan(
    val volume: String,
    val chapter: String,
    val kps: List<KpNode>,
    val recommendedKps: List<KpNode>,
    val averageMastery: Double,
    val judgmentWeakKpIds: Set<String> = emptySet(),
) {
    val masteredCount: Int = kps.count { learningStateFor(it) == "mastered" }
    val weakCount: Int = recommendedKps.size
    // Rounded like iOS (0.488 -> 49%); truncation showed one point less on tablet.
    val averageMasteryPercent: Int = kotlin.math.round(averageMastery.coerceIn(0.0, 1.0) * 100).toInt()
    val firstWeakKp: KpNode? = recommendedKps.firstOrNull()
    val latestLastPracticed: String = kps.map { it.lastPracticed }.filter { it.isNotBlank() }.maxOrNull().orEmpty()
    private val hasWeakEvidence: Boolean =
        hasLearningState(recommendedKps, "practice") || recommendedKps.any { it.id in judgmentWeakKpIds }
    // iOS ReinforcementChapterPlan.statusLabel's ladder and wording; an untouched recommendation stays 未开始.
    val status: String = when {
        hasWeakEvidence -> "有薄弱"
        kps.isEmpty() || averageMasteryPercent == 0 -> "未开始"
        averageMasteryPercent < 40 -> "待检测"
        averageMasteryPercent < 70 -> "可提升"
        kps.isNotEmpty() && masteredCount >= kps.size -> "已稳定"
        else -> "可提升"
    }
}

fun buildReinforcementChapterPlans(
    data: DirectoryData,
    trainStart: TrainStartData,
    judgmentsByKpId: Map<String, KnowledgeMasteryJudgment> = emptyMap(),
): List<ReinforcementChapterPlan> {
    val recommendedById = trainStart.recommendedKps.associateBy { it.kpId }
    val trainOrderById = trainStart.recommendedKps.withIndex().associate { it.value.kpId to it.index }
    return data.kps
        .groupBy { it.volume to it.chapter }
        .map { (key, kps) ->
            val recommended = kps
                .filter { recommendedById.containsKey(it.id) || isReinforcementJudgmentTarget(judgmentsByKpId[it.id]) }
                .sortedWith(
                    compareBy<KpNode> { kp -> trainOrderById[kp.id] ?: Int.MAX_VALUE }
                        .thenByDescending { kp -> reinforcementJudgmentPriority(judgmentsByKpId[kp.id]) }
                        .thenBy { kp -> kps.indexOf(kp) },
                )
            ReinforcementChapterPlan(
                volume = key.first,
                chapter = key.second,
                kps = kps,
                recommendedKps = recommended,
                averageMastery = if (kps.isEmpty()) 0.0 else kps.sumOf { it.mastery } / kps.size,
                judgmentWeakKpIds = kps
                    .filter { isReinforcementJudgmentTarget(judgmentsByKpId[it.id]) }
                    .map { it.id }
                    .toSet(),
            )
        }
        .sortedWith(compareBy<ReinforcementChapterPlan> { volumeOrder(it.volume) }.thenBy { data.kps.indexOf(it.kps.first()) })
}

private fun isReinforcementJudgmentTarget(judgment: KnowledgeMasteryJudgment?): Boolean {
    if (judgment == null || judgment.confidence == "low") return false
    return judgment.masteryLevel == "weak" ||
        judgment.interventionStatus in setOf("needs_learning", "needs_practice") ||
        judgment.nextAction in setOf("learn", "practice", "retest")
}

private fun reinforcementJudgmentPriority(judgment: KnowledgeMasteryJudgment?): Int {
    if (judgment == null) return 0
    return when {
        judgment.confidence == "low" -> 1
        judgment.masteryLevel == "weak" -> 4
        judgment.interventionStatus in setOf("needs_learning", "needs_practice") -> 3
        judgment.masteryLevel == "developing" -> 2
        else -> 1
    }
}

fun selectPreferredChapterPlan(
    plans: List<ReinforcementChapterPlan>,
    trainStart: TrainStartData,
): ReinforcementChapterPlan? {
    plans.filter { it.latestLastPracticed.isNotBlank() }
        .maxByOrNull { it.latestLastPracticed }
        ?.let { return it }
    trainStart.recommendedKps.forEach { recommendation ->
        plans.firstOrNull { plan -> plan.kps.any { it.id == recommendation.kpId } }?.let { return it }
    }
    return plans.firstOrNull { it.weakCount > 0 }
        ?: plans.firstOrNull { it.averageMastery < 0.7 }
        ?: plans.firstOrNull { hasLearningState(it.kps, "learning", "practice") }
        ?: plans.firstOrNull()
}

internal data class ImprovementTaskGroup(
    val groupName: String,
    val tasks: List<ImprovementTask>,
)

internal data class ReinforcementTaskPracticeAction(
    val label: String,
    val enabled: Boolean,
)

internal data class ReinforcementReportOverviewMetric(
    val label: String,
    val value: String,
    val detail: String,
)

internal enum class ReinforcementTraceTarget {
    DiagnosticAttempt,
    Plan,
    Report,
}

internal data class ReinforcementTraceAction(
    val label: String,
    val target: ReinforcementTraceTarget,
    val targetId: String,
    val primary: Boolean,
)

internal data class ReinforcementDiagnosticHistoryAction(
    val label: String,
    val target: ReinforcementTraceTarget,
    val targetId: String,
)

internal data class ReinforcementListFooterState(
    val summary: String,
    val canLoadMore: Boolean,
    val loadMoreLabel: String,
)

internal enum class ReinforcementNativeBackTarget {
    Plan,
}

internal fun groupImprovementTasks(tasks: List<ImprovementTask>): List<ImprovementTaskGroup> {
    return tasks
        .sortedBy { it.priority }
        .groupBy { task -> task.groupName.ifBlank { "未分组知识点" } }
        .map { (groupName, groupTasks) -> ImprovementTaskGroup(groupName, groupTasks) }
}

@Composable
fun ReinforcementHomeScreen(
    data: DirectoryData,
    trainStart: TrainStartData,
    latestPlan: ImprovementPlan?,
    latestCompletedReport: ImprovementReport?,
    judgmentsByKpId: Map<String, KnowledgeMasteryJudgment> = emptyMap(),
    onHome: () -> Unit,
    onLearn: () -> Unit,
    onReview: () -> Unit,
    onMe: () -> Unit,
    onScopeDiagnostic: (ReinforcementChapterPlan) -> Unit,
    onWeakPractice: (KpNode) -> Unit,
    onMixedPractice: (ReinforcementChapterPlan?) -> Unit,
    onLearnKp: (KpNode) -> Unit,
    onChapterPath: (ReinforcementChapterPlan) -> Unit,
    onReportHistory: () -> Unit,
    onDiagnosticHistory: () -> Unit,
    onLearningTrace: () -> Unit,
    onOpenLatestPlan: (ImprovementPlan) -> Unit,
    onContinueLatestPlan: (ImprovementPlan) -> Unit,
    onRediagnoseLatestPlan: (ImprovementPlan) -> Unit,
    onOpenLatestReport: (ImprovementReport) -> Unit,
    accessRequired: Boolean = false,
    onAccountUnavailable: () -> Unit = {},
) {
    // Weak points are counted as iOS does — only the server's training recommendations — so phone,
    // tablet, iPhone and iPad all show the same "N 个薄弱点" for a chapter.
    val phone = LocalPhonePresentation.current
    val plans = remember(data, trainStart, judgmentsByKpId, phone) {
        buildReinforcementChapterPlans(data, trainStart, emptyMap())
    }
    val preferred = remember(plans, trainStart) { selectPreferredChapterPlan(plans, trainStart) }
    val volumes = remember(plans) { plans.map { it.volume }.distinct() }
    var selectedVolume by remember(preferred?.volume, volumes) { mutableStateOf(preferred?.volume ?: volumes.firstOrNull().orEmpty()) }
    val visiblePlans = remember(plans, selectedVolume) { plans.filter { it.volume == selectedVolume } }

    MainPage(
        activeTab = MainTab.Practice,
        onHome = onHome,
        onLearn = onLearn,
        onPractice = {},
        onReview = onReview,
        onMe = onMe,
        showTabletTopBar = false,
        tabletContentMode = reinforcementTabletContentMode(),
    ) {
        // Disabled accounts can browse the directory while account access is restored.
        if (accessRequired) {
            AccountUnavailableBanner(ReinforcementLockTitle, ReinforcementLockMessage, onAccountUnavailable)
        }
        if (LocalPhonePresentation.current) {
            PhoneReinforcementContent(
                volumes = volumes,
                selectedVolume = selectedVolume,
                onVolume = { selectedVolume = it },
                visible = visiblePlans,
                preferred = preferred,
                latestPlan = latestPlan,
                report = latestCompletedReport,
                onChapter = onChapterPath,
                onContinue = onContinueLatestPlan,
                onPlan = onOpenLatestPlan,
                onRediagnose = onRediagnoseLatestPlan,
                onReport = onOpenLatestReport,
                onReports = onReportHistory,
                onDiagnostics = onDiagnosticHistory,
                onTrace = onLearningTrace,
                accessRequired = accessRequired,
                onAccountUnavailable = onAccountUnavailable,
            )
        } else {
            TabletReinforcementContent(
                volumes = volumes,
                selectedVolume = selectedVolume,
                onSelectVolume = { selectedVolume = it },
                plans = plans,
                visiblePlans = visiblePlans,
                preferred = preferred,
                trainStart = trainStart,
                onScopeDiagnostic = onScopeDiagnostic,
                onWeakPractice = onWeakPractice,
                onMixedPractice = onMixedPractice,
                onLearnKp = onLearnKp,
                onChapterPath = onChapterPath,
                onReportHistory = onReportHistory,
                onDiagnosticHistory = onDiagnosticHistory,
                onLearningTrace = onLearningTrace,
                latestPlan = latestPlan,
                latestCompletedReport = latestCompletedReport,
                judgmentsByKpId = judgmentsByKpId,
                onOpenLatestPlan = onOpenLatestPlan,
                onContinueLatestPlan = onContinueLatestPlan,
                onRediagnoseLatestPlan = onRediagnoseLatestPlan,
                onOpenLatestReport = onOpenLatestReport,
                onHome = onHome,
                accessRequired = accessRequired,
            )
        }
    }
}

internal const val ReinforcementLockTitle = "登录后开启巩固提升"
internal const val ReinforcementLockMessage =
    "可先浏览全部章节和训练路径，登录后开始单元检测、补弱路径和混合提升。已有记录和草稿会保留。"

fun reinforcementTabletContentMode(): TabletMainContentMode {
    return TabletMainContentMode.FillAvailableHeight
}

internal data class ReinforcementTabletPathWorkspacePolicy(
    val controlPanelFillsAvailableHeight: Boolean,
    val chapterListMaximumHeightDp: Int,
    val pathCardFillsAvailableHeight: Boolean,
    val pathCardMinimumHeightDp: Int,
)

internal data class ReinforcementScopeResultLayoutPolicy(
    val headerStyle: String,
    val showDiagnosticDetailList: Boolean,
    val chapterTitle: String,
    val masteryProgressStyle: String,
    val taskActionsAlignment: String,
    val currentTaskActions: List<String>,
    val pathTaskActions: List<String>,
)

internal data class ReinforcementDiagnosticAttemptDetailLayoutPolicy(
    val chapterTitle: String,
    val sectionTitle: String,
    val usesReinforcementTitle: Boolean,
    val linkedPlanActionsAlignment: String,
    val linkedPlanActions: List<String>,
    val showLongProgressBar: Boolean,
)

internal fun reinforcementScopeResultLayoutPolicy(): ReinforcementScopeResultLayoutPolicy {
    return ReinforcementScopeResultLayoutPolicy(
        headerStyle = "hero",
        showDiagnosticDetailList = false,
        chapterTitle = "本章检测完成",
        masteryProgressStyle = "compact",
        taskActionsAlignment = "right",
        currentTaskActions = listOf("继续本步提升", "回看知识"),
        pathTaskActions = listOf("回看知识", "专项练"),
    )
}

internal fun reinforcementDiagnosticAttemptDetailLayoutPolicy(): ReinforcementDiagnosticAttemptDetailLayoutPolicy {
    return ReinforcementDiagnosticAttemptDetailLayoutPolicy(
        chapterTitle = "本章检测结果",
        sectionTitle = "本节检测结果",
        usesReinforcementTitle = false,
        linkedPlanActionsAlignment = "right",
        linkedPlanActions = listOf("查看提升路径", "查看提升报告"),
        showLongProgressBar = false,
    )
}

internal fun reinforcementTabletPathWorkspacePolicy(): ReinforcementTabletPathWorkspacePolicy {
    return ReinforcementTabletPathWorkspacePolicy(
        controlPanelFillsAvailableHeight = true,
        chapterListMaximumHeightDp = 620,
        pathCardFillsAvailableHeight = true,
        pathCardMinimumHeightDp = 0,
    )
}

@Composable
private fun TabletReinforcementContent(
    volumes: List<String>,
    selectedVolume: String,
    onSelectVolume: (String) -> Unit,
    plans: List<ReinforcementChapterPlan>,
    visiblePlans: List<ReinforcementChapterPlan>,
    preferred: ReinforcementChapterPlan?,
    trainStart: TrainStartData,
    onScopeDiagnostic: (ReinforcementChapterPlan) -> Unit,
    onWeakPractice: (KpNode) -> Unit,
    onMixedPractice: (ReinforcementChapterPlan?) -> Unit,
    onLearnKp: (KpNode) -> Unit,
    onChapterPath: (ReinforcementChapterPlan) -> Unit,
    onReportHistory: () -> Unit,
    onDiagnosticHistory: () -> Unit,
    onLearningTrace: () -> Unit,
    latestPlan: ImprovementPlan?,
    latestCompletedReport: ImprovementReport?,
    judgmentsByKpId: Map<String, KnowledgeMasteryJudgment>,
    onOpenLatestPlan: (ImprovementPlan) -> Unit,
    onContinueLatestPlan: (ImprovementPlan) -> Unit,
    onRediagnoseLatestPlan: (ImprovementPlan) -> Unit,
    onOpenLatestReport: (ImprovementReport) -> Unit,
    onHome: () -> Unit,
    accessRequired: Boolean = false,
) {
    val defaultPlan = preferred?.takeIf { it.volume == selectedVolume }
        ?: selectPreferredChapterPlan(visiblePlans, trainStart)
        ?: visiblePlans.firstOrNull()
    var selectedChapter by remember(selectedVolume, defaultPlan?.chapter) {
        mutableStateOf(defaultPlan?.chapter)
    }
    val activePlan = visiblePlans.firstOrNull { it.chapter == selectedChapter }
        ?: defaultPlan

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .fillMaxHeight(),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        TabletReinforcementHero(onHome = onHome)
        TabletLearningWorkspace(
            modifier = Modifier.weight(1f),
            left = {
                TabletReinforcementControlPanel(
                    volumes = volumes,
                    selectedVolume = selectedVolume,
                    onSelectVolume = onSelectVolume,
                    plans = plans,
                    chapters = visiblePlans,
                    activePlan = activePlan,
                    onChapterClick = { selectedChapter = it.chapter },
                )
            },
            right = {
                TabletReinforcementRouteColumn(
                    plan = activePlan,
                    trainStart = trainStart,
                    onScopeDiagnostic = onScopeDiagnostic,
                    onDiagnosticHistory = onDiagnosticHistory,
                    latestPlan = latestPlan,
                    latestCompletedReport = latestCompletedReport,
                    onOpenLatestPlan = onOpenLatestPlan,
                    onContinueLatestPlan = onContinueLatestPlan,
                    onRediagnoseLatestPlan = onRediagnoseLatestPlan,
                    onOpenLatestReport = onOpenLatestReport,
                    onReportHistory = onReportHistory,
                    accessRequired = accessRequired,
                )
            },
        )
    }
}

@Composable
private fun TabletReinforcementControlPanel(
    volumes: List<String>,
    selectedVolume: String,
    onSelectVolume: (String) -> Unit,
    plans: List<ReinforcementChapterPlan>,
    chapters: List<ReinforcementChapterPlan>,
    activePlan: ReinforcementChapterPlan?,
    onChapterClick: (ReinforcementChapterPlan) -> Unit,
) {
    var volumeMenuOpen by remember(selectedVolume) { mutableStateOf(false) }
    val pathPolicy = reinforcementTabletPathWorkspacePolicy()
    Column(
        modifier = Modifier
            .then(if (pathPolicy.controlPanelFillsAvailableHeight) Modifier.fillMaxHeight() else Modifier)
            .background(Color.White, RoundedCornerShape(OpenPhysicsRadius.Large))
            .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Large)),
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text("学习控制面板", color = OpenPhysicsColors.PrimaryDeep, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
            Text("选择教材与章节", color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        }
        Column(
            modifier = Modifier.padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(OpenPhysicsColors.SurfaceSoft, RoundedCornerShape(999.dp))
                    .border(1.dp, OpenPhysicsColors.PrimarySoft, RoundedCornerShape(999.dp))
                    .clickable { volumeMenuOpen = !volumeMenuOpen }
                    .padding(horizontal = 13.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("☰", color = OpenPhysicsColors.PrimaryDeep, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(
                    text = selectedVolume.ifBlank { "选择教材" },
                    modifier = Modifier.weight(1f),
                    color = OpenPhysicsColors.Ink,
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(if (volumeMenuOpen) "⌃" else "⌄", color = OpenPhysicsColors.Muted, style = MaterialTheme.typography.labelLarge)
            }
            if (volumeMenuOpen) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color.White, RoundedCornerShape(OpenPhysicsRadius.Medium))
                        .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Medium))
                        .padding(6.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    volumes.forEach { volume ->
                        val selected = selectedVolume == volume
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(if (selected) OpenPhysicsColors.PrimarySoft else Color.Transparent, RoundedCornerShape(12.dp))
                                .clickable {
                                    onSelectVolume(volume)
                                    volumeMenuOpen = false
                                }
                                .padding(horizontal = 10.dp, vertical = 9.dp),
                        ) {
                            Text(
                                text = shortVolumeLabel(volume),
                                color = if (selected) OpenPhysicsColors.PrimaryDeep else OpenPhysicsColors.Muted,
                                style = MaterialTheme.typography.labelLarge,
                                fontWeight = FontWeight.Bold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            }
        }
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .then(
                    if (pathPolicy.controlPanelFillsAvailableHeight) {
                        Modifier.weight(1f)
                    } else {
                        Modifier.heightIn(max = pathPolicy.chapterListMaximumHeightDp.dp)
                    },
                )
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            chapters.forEach { plan ->
                TabletReinforcementChapterRow(
                    plan = plan,
                    selected = plan == activePlan,
                    onClick = { onChapterClick(plan) },
                )
            }
        }
    }
}

@Composable
private fun TabletReinforcementChapterRow(
    plan: ReinforcementChapterPlan,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(if (selected) OpenPhysicsColors.PrimarySoft else OpenPhysicsColors.SurfaceSoft, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .border(1.dp, if (selected) OpenPhysicsColors.PrimarySoft else OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = plan.chapter,
                modifier = Modifier.weight(1f),
                color = if (selected) OpenPhysicsColors.PrimaryDeep else OpenPhysicsColors.Ink,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            StatusChip(reinforcementChapterListStatus(plan), tone = reinforcementChapterListTone(plan))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("${plan.masteredCount}/${plan.kps.size} 已掌握", color = OpenPhysicsColors.Muted, style = MaterialTheme.typography.labelMedium)
            Text("${plan.averageMasteryPercent}%", color = OpenPhysicsColors.PrimaryDeep, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
        }
        ProgressLine(plan.averageMastery)
    }
}

@Composable
private fun TabletReinforcementHero(onHome: () -> Unit) {
    TabletLearningPageHeader(title = "巩固提升", onHome = onHome)
}

@Composable
private fun TabletReinforcementRouteColumn(
    plan: ReinforcementChapterPlan?,
    trainStart: TrainStartData,
    latestPlan: ImprovementPlan?,
    latestCompletedReport: ImprovementReport?,
    onScopeDiagnostic: (ReinforcementChapterPlan) -> Unit,
    onDiagnosticHistory: () -> Unit,
    onOpenLatestPlan: (ImprovementPlan) -> Unit,
    onContinueLatestPlan: (ImprovementPlan) -> Unit,
    onRediagnoseLatestPlan: (ImprovementPlan) -> Unit,
    onOpenLatestReport: (ImprovementReport) -> Unit,
    onReportHistory: () -> Unit,
    accessRequired: Boolean = false,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .fillMaxHeight()
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        latestPlan?.let { currentPlan ->
            TabletRecentScopeDiagnosticCard(
                plan = currentPlan,
                onView = { onOpenLatestPlan(currentPlan) },
                onContinue = { onContinueLatestPlan(currentPlan) },
                onRediagnose = { onRediagnoseLatestPlan(currentPlan) },
            )
        } ?: latestCompletedReport?.let { report ->
            TabletRecentReportCard(
                report = report,
                onOpenReport = { onOpenLatestReport(report) },
                onReportHistory = onReportHistory,
            )
        }
        TabletCurrentChapterRouteCard(
            plan = plan,
            hasDiagnosed = trainStart.hasDiagnosed,
            onScopeDiagnostic = onScopeDiagnostic,
            onDiagnosticHistory = onDiagnosticHistory,
            accessRequired = accessRequired,
        )
    }
}

@Composable
private fun TabletRecentScopeDiagnosticCard(
    plan: ImprovementPlan,
    onView: () -> Unit,
    onContinue: () -> Unit,
    onRediagnose: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Color(0xFFFFFBF4), RoundedCornerShape(OpenPhysicsRadius.Large))
            .border(1.dp, Color(0xFFF7C76B), RoundedCornerShape(OpenPhysicsRadius.Large))
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                Text("最近检测结果", color = OpenPhysicsColors.PrimaryDeep, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                Text(reinforcementRecentPlanTitle(plan), color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                MetaText("正确 ${plan.correctCount}/${plan.totalCount}   发现 ${plan.weakCount} 个薄弱点")
                val nextText = reinforcementRecentPlanNextText(plan)
                if (nextText.isNotBlank()) {
                    Text(nextText, color = OpenPhysicsColors.PrimaryDeep, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                }
            }
            StatusChip(if (plan.readyForRetest()) "待复测" else "提升中", tone = OpenPhysicsTone.Warning)
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 1.dp)
                .background(Color(0xFFF5DBA5)),
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.End),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SecondaryActionButton("查看检测结果", onView, modifier = Modifier.width(132.dp))
            PrimaryActionButton(
                reinforcementRecentPlanActionLabel(plan),
                onContinue,
                modifier = Modifier.width(154.dp),
                enabled = plan.currentTask() != null || plan.readyForRetest(),
            )
            SecondaryActionButton("重新检测", onRediagnose, modifier = Modifier.width(104.dp))
        }
    }
}

@Composable
private fun TabletRecentReportCard(
    report: ImprovementReport,
    onOpenReport: () -> Unit,
    onReportHistory: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(OpenPhysicsColors.SuccessSoft, RoundedCornerShape(OpenPhysicsRadius.Large))
            .border(1.dp, Color(0xFFB7E4C5), RoundedCornerShape(OpenPhysicsRadius.Large))
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("最近提升报告", color = OpenPhysicsColors.PrimaryDeep, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
        Text(reinforcementRecentReportTitle(report), color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        MetaText(reinforcementRecentReportMeta(report))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.End)) {
            PrimaryActionButton("查看报告", onOpenReport, modifier = Modifier.width(112.dp))
            SecondaryActionButton("历史报告", onReportHistory, modifier = Modifier.width(112.dp))
        }
    }
}

@Composable
private fun TabletCurrentChapterRouteCard(
    plan: ReinforcementChapterPlan?,
    hasDiagnosed: Boolean,
    onScopeDiagnostic: (ReinforcementChapterPlan) -> Unit,
    onDiagnosticHistory: () -> Unit,
    accessRequired: Boolean = false,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Color.White, RoundedCornerShape(OpenPhysicsRadius.Large))
            .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Large)),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 18.dp, vertical = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("当前章节训练路径", color = OpenPhysicsColors.PrimaryDeep, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                Text(
                    plan?.let { "${shortVolumeLabel(it.volume)} · ${it.chapter}" } ?: "暂无推荐章节",
                    color = OpenPhysicsColors.Muted,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    plan?.chapter ?: "暂无可提升章节",
                    color = OpenPhysicsColors.Ink,
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            StatusChip(
                text = plan?.status ?: if (hasDiagnosed) "待检测" else "建议先评估",
                tone = plan?.let { reinforcementPlanTone(it) } ?: OpenPhysicsTone.Warning,
            )
        }
        TabletRouteStats(plan)
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            TabletRouteActionRow(
                title = "单元检测",
                text = "先用少量题判断本章哪些知识点还不稳。",
                actionText = if (accessRequired) "登录后检测" else "开始检测",
                primary = true,
                enabled = plan != null,
                onClick = { plan?.let(onScopeDiagnostic) },
            )
            TabletRouteActionRow(
                title = "检测历史",
                text = "查看本章以往检测结果和对应薄弱点。",
                actionText = "查看检测历史",
                primary = false,
                enabled = true,
                onClick = onDiagnosticHistory,
            )
        }
    }
}

@Composable
private fun TabletRouteStats(plan: ReinforcementChapterPlan?) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(OpenPhysicsColors.SurfaceSoft)
            .border(1.dp, OpenPhysicsColors.Divider),
    ) {
        TabletRouteStatCell("知识点", "${plan?.kps?.size ?: 0}", Modifier.weight(1f))
        TabletRouteStatCell("已掌握", "${plan?.masteredCount ?: 0}", Modifier.weight(1f))
        TabletRouteStatCell("薄弱点", "${plan?.weakCount ?: 0}", Modifier.weight(1f))
        TabletRouteStatCell("平均掌握", "${plan?.averageMasteryPercent ?: 0}%", Modifier.weight(1f))
    }
}

@Composable
private fun TabletRouteStatCell(label: String, value: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .border(1.dp, OpenPhysicsColors.Divider)
            .padding(horizontal = 18.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(label, color = OpenPhysicsColors.Muted, style = MaterialTheme.typography.bodyMedium)
        Text(value, color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun TabletRouteActionRow(
    title: String,
    text: String,
    actionText: String,
    primary: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(OpenPhysicsColors.SurfaceSoft, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .padding(14.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text(text, color = OpenPhysicsColors.Muted, style = MaterialTheme.typography.bodyMedium)
        }
        if (primary) {
            // "登录后检测" needs the wider button to stay on one line.
            PrimaryActionButton(actionText, onClick, modifier = Modifier.width(if (actionText.length > 6) 156.dp else 120.dp), enabled = enabled)
        } else {
            SecondaryActionButton(actionText, onClick, modifier = Modifier.width(132.dp), enabled = enabled)
        }
    }
}

@Composable
fun ReinforcementChapterPathScreen(
    plan: ReinforcementChapterPlan,
    judgmentsByKpId: Map<String, KnowledgeMasteryJudgment> = emptyMap(),
    onBack: () -> Unit,
    onHome: () -> Unit,
    onLearnTab: () -> Unit,
    onPracticeTab: () -> Unit,
    onReview: () -> Unit,
    onMe: () -> Unit,
    onScopeDiagnostic: (ReinforcementChapterPlan) -> Unit,
    onWeakPractice: (KpNode) -> Unit,
    onMixedPractice: (ReinforcementChapterPlan) -> Unit,
    onLearn: (KpNode) -> Unit,
    onDiagnosticHistory: () -> Unit,
    accessRequired: Boolean,
    onAccountUnavailable: () -> Unit,
) {
    if (LocalPhonePresentation.current) {
        PhoneReinforcementChapter(plan, onBack, onScopeDiagnostic, onDiagnosticHistory,
            accessRequired, onAccountUnavailable)
        return
    }
    MainPage(
        activeTab = MainTab.Practice,
        onHome = onHome,
        onLearn = onLearnTab,
        onPractice = onPracticeTab,
        onReview = onReview,
        onMe = onMe,
    ) {
        TabletReinforcementChapterPathContent(
            plan = plan,
            judgmentsByKpId = judgmentsByKpId,
            onBack = onBack,
            onScopeDiagnostic = onScopeDiagnostic,
            onWeakPractice = onWeakPractice,
            onMixedPractice = onMixedPractice,
            onLearn = onLearn,
            accessRequired = accessRequired,
            onAccountUnavailable = onAccountUnavailable,
        )
    }
}

@Composable
private fun TabletReinforcementChapterPathContent(
    plan: ReinforcementChapterPlan,
    judgmentsByKpId: Map<String, KnowledgeMasteryJudgment>,
    onBack: () -> Unit,
    onScopeDiagnostic: (ReinforcementChapterPlan) -> Unit,
    onWeakPractice: (KpNode) -> Unit,
    onMixedPractice: (ReinforcementChapterPlan) -> Unit,
    onLearn: (KpNode) -> Unit,
    accessRequired: Boolean = false,
    onAccountUnavailable: () -> Unit = {},
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (accessRequired) AccountUnavailableBanner(ReinforcementLockTitle, ReinforcementLockMessage, onAccountUnavailable)
        LearningCard {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                AndroidNativeBackButton(onClick = onBack)
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    MetaText("巩固提升 / ${plan.volume}")
                    Text(
                        text = plan.chapter,
                        style = MaterialTheme.typography.headlineSmall,
                        color = OpenPhysicsColors.Ink,
                        fontWeight = FontWeight.Bold,
                    )
                }
                StatusChip(plan.status, tone = reinforcementPlanTone(plan))
            }
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            LearningCard(
                modifier = Modifier
                    .weight(0.42f)
                    .fillMaxHeight(),
                title = "诊断 → 补弱 → 混合提升",
            ) {
                TabletReinforcementActionStep(
                    index = "1",
                    title = "本章定位",
                    subtitle = "用小组题确认当前薄弱环节",
                    primaryText = "开始定位",
                    onPrimary = { onScopeDiagnostic(plan) },
                )
                TabletReinforcementActionStep(
                    index = "2",
                    title = "补齐薄弱点",
                    subtitle = plan.firstWeakKp?.name ?: "暂无明显薄弱点",
                    primaryText = "练习薄弱点",
                    onPrimary = { plan.firstWeakKp?.let(onWeakPractice) },
                    enabled = plan.firstWeakKp != null,
                )
                TabletReinforcementActionStep(
                    index = "3",
                    title = "回看知识点",
                    subtitle = plan.firstWeakKp?.name ?: "需要时回到同步学习",
                    primaryText = "回看知识",
                    onPrimary = { plan.firstWeakKp?.let(onLearn) },
                    enabled = plan.firstWeakKp != null,
                    secondary = true,
                )
                TabletReinforcementActionStep(
                    index = "4",
                    title = "混合提升",
                    subtitle = "完成本章综合训练，检查迁移应用能力",
                    primaryText = "混合提升",
                    onPrimary = { onMixedPractice(plan) },
                    secondary = true,
                )
            }
            Column(modifier = Modifier.weight(0.58f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                LearningPathHeroCard(
                    meta = "",
                    title = plan.chapter,
                    subtitle = "",
                    statusText = plan.status,
                    statusTone = reinforcementPlanTone(plan),
                    primaryActionText = "本章定位",
                    onPrimaryAction = { onScopeDiagnostic(plan) },
                    secondaryActionText = "混合提升",
                    onSecondaryAction = { onMixedPractice(plan) },
                    stats = {
                        StatCell("知识点", "${plan.kps.size}")
                        StatCell("薄弱点", "${plan.weakCount}")
                        StatCell("平均", "${plan.averageMasteryPercent}%")
                    },
                    progress = { ProgressLine(plan.averageMastery) },
                    body = {},
                )
                if (plan.recommendedKps.isNotEmpty()) {
                    LearningCard(title = "薄弱点列表") {
                        plan.recommendedKps.take(6).forEach { kp ->
                            TabletWeakKpActionRow(
                                kp = kp,
                                judgment = judgmentsByKpId[kp.id],
                                onPractice = onWeakPractice,
                                onLearn = onLearn,
                            )
                        }
                    }
                } else {
                    KnowledgePointCompactList(
                        title = "推荐知识点",
                        subtitle = "",
                        kps = plan.kps.take(5),
                        actionText = "回看",
                        onSelectKp = onLearn,
                        onAction = onLearn,
                    )
                }
            }
        }
    }
}

@Composable
fun ReinforcementScopeResultScreen(
    result: ScopeDiagnosticResult,
    plan: ImprovementPlan?,
    onBack: () -> Unit,
    onHome: () -> Unit,
    onLearn: () -> Unit,
    onPractice: () -> Unit,
    onReview: () -> Unit,
    onMe: () -> Unit,
    onLearnTask: (ImprovementTask) -> Unit,
    onStartTask: (ImprovementTask) -> Unit,
    onStartRetest: () -> Unit,
    onViewReport: () -> Unit,
    onAccountUnavailable: () -> Unit,
) {
    val layoutPolicy = reinforcementScopeResultLayoutPolicy()
    val resultTitle = if (result.scopeType == "section") "本节检测完成" else layoutPolicy.chapterTitle
    if (plan == null) {
        if (LocalPhonePresentation.current) {
            PhoneScopeResult(result, null, onPractice, onLearnTask, onStartTask, onStartRetest,
                onViewReport, onAccountUnavailable, onPractice)
            return
        }
        BackHandler(onBack = onPractice)
        MainPage(
            activeTab = MainTab.Practice,
            onHome = onHome,
            onLearn = onLearn,
            onPractice = onPractice,
            onReview = onReview,
            onMe = onMe,
        ) {
            ReinforcementSubpageHeader(resultTitle, "${result.scopeName}：正确 ${result.correctCount}/${result.totalCount}", onPractice)
            LearningCard(title = "检测结果") {
                StatusChip(
                    text = if (result.weakKpIds.isNotEmpty()) "发现薄弱点" else "整体稳定",
                    tone = if (result.weakKpIds.isNotEmpty()) OpenPhysicsTone.Warning else OpenPhysicsTone.Success,
                )
                if (result.feedback.isNotBlank()) Text(result.feedback, color = OpenPhysicsColors.Ink)
                if (result.recommendation.isNotBlank()) MutedText(result.recommendation)
                MutedText("登录后可使用完整的提升路径、专项练和阶段复测。")
            }
            LearningCard(title = "知识点表现") {
                if (result.kpResults.isEmpty()) MutedText("暂无知识点明细。")
                result.kpResults.forEach { ScopeDiagnosticKpRow(it) }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                PrimaryActionButton(AccountUnavailableActionLabel, onAccountUnavailable, modifier = Modifier.weight(1f))
                SecondaryActionButton("返回巩固提升", onPractice, modifier = Modifier.weight(1f))
            }
        }
        return
    }
    if (LocalPhonePresentation.current) {
        PhoneScopeResult(result, plan, onBack, onLearnTask, onStartTask, onStartRetest,
            onViewReport, onAccountUnavailable, onPractice)
        return
    }
    val currentTask = plan.currentTask()
    BackHandler(enabled = reinforcementScopeResultBackTarget(plan) == ReinforcementNativeBackTarget.Plan) {
        onBack()
    }
    MainPage(
        activeTab = MainTab.Practice,
        onHome = onHome,
        onLearn = onLearn,
        onPractice = onPractice,
        onReview = onReview,
        onMe = onMe,
    ) {
        ReinforcementSubpageHeader(resultTitle, "${result.scopeName}：正确 ${result.correctCount}/${result.totalCount}", onBack)
        LearningCard(title = "定位结论") {
            StatusChip(
                text = if (plan.weakCount > 0) "发现薄弱点" else "整体稳定",
                tone = if (plan.weakCount > 0) OpenPhysicsTone.Warning else OpenPhysicsTone.Success,
            )
            if (result.feedback.isNotBlank()) {
                Text(result.feedback, color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.bodyMedium)
            }
            if (result.recommendation.isNotBlank()) {
                MutedText(result.recommendation)
            }
            MutedText(reinforcementScopeGuidanceText(plan.weakCount > 0 || result.weakKpIds.isNotEmpty()))
            val nextTaskText = reinforcementScopeNextTaskText(plan)
            if (nextTaskText.isNotBlank()) {
                MutedText(nextTaskText)
            }
            MutedText(reinforcementScopePlanTaskSummaryText(plan))
        }
        if (currentTask != null) {
            CurrentImprovementTaskCard(
                task = currentTask,
                onLearn = { onLearnTask(currentTask) },
                onStart = { onStartTask(currentTask) },
            )
        } else {
            CurrentImprovementEmptyCard(
                plan = plan,
                onPrimaryAction = {
                    if (plan.isCompleted()) onViewReport() else onStartRetest()
                },
            )
        }
        LearningCard(title = "提升任务") {
            if (plan.tasks.isEmpty()) {
                MutedText("本轮定位暂未生成专项任务。")
            } else {
                groupImprovementTasks(plan.tasks).forEach { group ->
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            group.groupName,
                            color = OpenPhysicsColors.PrimaryDeep,
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.Bold,
                        )
                        group.tasks.forEach { task ->
                            ImprovementTaskRow(
                                task = task,
                                planStatus = plan.status,
                                onLearn = { onLearnTask(task) },
                                onPractice = { onStartTask(task) },
                            )
                        }
                    }
                }
            }
            if (plan.readyForRetest()) {
                PrimaryActionButton("进入阶段复测", onStartRetest)
            }
        }
    }
}

@Composable
fun ReinforcementRetestResultScreen(
    result: ImprovementRetestResult,
    onBackToPlan: () -> Unit,
    onContinueWeak: (ImprovementTask) -> Unit,
    onViewReport: () -> Unit,
    onHome: () -> Unit,
    onLearn: () -> Unit,
    onPractice: () -> Unit,
    onReview: () -> Unit,
    onMe: () -> Unit,
) {
    if (LocalPhonePresentation.current) {
        PhoneRetestResult(result, onBackToPlan, onContinueWeak, onViewReport)
        return
    }
    val nextTask = result.plan.currentTask()
    BackHandler(enabled = reinforcementRetestResultBackTarget(result.plan) == ReinforcementNativeBackTarget.Plan) {
        onBackToPlan()
    }
    MainPage(
        activeTab = MainTab.Practice,
        onHome = onHome,
        onLearn = onLearn,
        onPractice = onPractice,
        onReview = onReview,
        onMe = onMe,
    ) {
        LearningPathHeroCard(
            meta = "",
            title = "阶段复测",
            subtitle = "",
            statusText = if (result.needsRetestCount == 0) "已通过" else "继续补弱",
            statusTone = if (result.needsRetestCount == 0) OpenPhysicsTone.Success else OpenPhysicsTone.Warning,
            primaryActionText = nextTask?.let { "继续专项练" } ?: "回到路径",
            onPrimaryAction = { nextTask?.let(onContinueWeak) ?: onBackToPlan() },
            secondaryActionText = "提升报告",
            onSecondaryAction = onViewReport,
            stats = {
                StatCell("复测", "${result.correctCount}/${result.totalCount}")
                StatCell("通过", "${result.passedCount}")
                StatCell("待补", "${result.needsRetestCount}")
            },
            progress = {
                ProgressLine(if (result.taskResults.isEmpty()) 0.0 else result.passedCount.toDouble() / result.taskResults.size)
            },
            body = {},
        )
        LearningCard(title = "复测明细") {
            if (result.taskResults.isEmpty()) {
                MutedText("暂无复测明细。")
            } else {
                result.taskResults.forEach { task ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(OpenPhysicsColors.SurfaceSoft, RoundedCornerShape(OpenPhysicsRadius.Medium))
                            .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Medium))
                            .padding(12.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(task.kpName, color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            MetaText("${task.correctCount}/${task.totalCount} · ${task.feedback.ifBlank { "已记录本次复测结果" }}")
                        }
                        StatusChip(if (task.passed) "通过" else "待补", tone = if (task.passed) OpenPhysicsTone.Success else OpenPhysicsTone.Warning)
                    }
                }
            }
        }
    }
}

@Composable
fun ReinforcementTaskCompleteScreen(
    plan: ImprovementPlan,
    review: PracticeReview,
    onBackToPlan: () -> Unit,
    onContinueNextTask: () -> Unit,
    onBackToEntry: () -> Unit,
    onHome: () -> Unit,
    onLearn: () -> Unit,
    onPractice: () -> Unit,
    onReview: () -> Unit,
    onMe: () -> Unit,
) {
    if (LocalPhonePresentation.current) {
        PhoneTaskComplete(plan, review, onBackToPlan, onContinueNextTask, onBackToEntry)
        return
    }
    BackHandler(enabled = reinforcementTaskCompleteBackTarget(plan) == ReinforcementNativeBackTarget.Plan) {
        onBackToPlan()
    }
    MainPage(
        activeTab = MainTab.Practice,
        onHome = onHome,
        onLearn = onLearn,
        onPractice = onPractice,
        onReview = onReview,
        onMe = onMe,
    ) {
        LearningCard(title = "本轮练习完成") {
            val accuracy = accuracyPercent(review.correctCount, review.totalCount)
            Text(
                text = "得分 ${review.correctCount}/${review.totalCount} · 得分率 $accuracy%",
                color = OpenPhysicsColors.PrimaryDeep,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = reinforcementTaskCompleteNote(plan),
                color = OpenPhysicsColors.Ink,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        if (review.items.isNotEmpty()) {
            LearningCard(title = "本步题目") {
                review.items.take(3).forEachIndexed { index, item ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(OpenPhysicsColors.SurfaceSoft, RoundedCornerShape(OpenPhysicsRadius.Medium))
                            .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Medium))
                            .padding(12.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text("第 ${index + 1} 题", color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            MetaText(item.question.stem.take(36))
                        }
                        StatusChip(if (item.result.correct) "正确" else "待复盘", tone = if (item.result.correct) OpenPhysicsTone.Success else OpenPhysicsTone.Warning)
                    }
                }
            }
        }
        LearningCard(title = "下一步") {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PrimaryActionButton("回到提升路径", onBackToPlan, modifier = Modifier.weight(1f))
                SecondaryActionButton(
                    text = reinforcementTaskCompleteContinueLabel(plan),
                    onClick = onContinueNextTask,
                    modifier = Modifier.weight(1f),
                    enabled = reinforcementTaskCompleteCanContinue(plan),
                )
            }
            SecondaryActionButton("回到巩固提升首页", onBackToEntry)
        }
    }
}

@Composable
fun ReinforcementReportScreen(
    report: ImprovementReport,
    onBack: () -> Unit,
    onBackToPlan: (String) -> Unit,
    onHome: () -> Unit,
    onLearn: () -> Unit,
    onPractice: () -> Unit,
    onReview: () -> Unit,
    onMe: () -> Unit,
) {
    if (LocalPhonePresentation.current) {
        PhoneImprovementReport(report, onBack, onBackToPlan, onPractice, onHome)
        return
    }
    val clipboardManager = LocalClipboardManager.current
    var copyStatus by remember(report.summary.planId) { mutableStateOf("") }

    MainPage(
        activeTab = MainTab.Practice,
        onHome = onHome,
        onLearn = onLearn,
        onPractice = onPractice,
        onReview = onReview,
        onMe = onMe,
    ) {
        LearningCard {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                AndroidNativeBackButton(onClick = onBack)
                MetaText("巩固提升 / ${report.summary.scopeName}")
            }
        }
        LearningPathHeroCard(
            meta = "",
            title = "提升报告",
            subtitle = "",
            statusText = if (report.summary.completed) "已完成" else "进行中",
            statusTone = if (report.summary.completed) OpenPhysicsTone.Success else OpenPhysicsTone.Primary,
            primaryActionText = "回到巩固提升",
            onPrimaryAction = onPractice,
            secondaryActionText = "首页",
            onSecondaryAction = onHome,
            stats = {
                StatCell("定位", "${report.summary.diagnosticCorrectCount}/${report.summary.diagnosticTotalCount}")
                StatCell("已通过", "${report.summary.passedTaskCount}")
                StatCell("复测", "${report.summary.retestAttemptCount}")
            },
            progress = {
                ProgressLine(if (report.summary.taskCount == 0) 0.0 else report.summary.passedTaskCount.toDouble() / report.summary.taskCount)
            },
            body = {},
        )
        LearningCard(title = "报告概览") {
            reinforcementReportOverviewMetrics(report.summary).chunked(2).forEach { rowMetrics ->
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    rowMetrics.forEach { metric ->
                        ReportOverviewMetricTile(metric, modifier = Modifier.weight(1f))
                    }
                    if (rowMetrics.size == 1) {
                        Box(modifier = Modifier.weight(1f))
                    }
                }
            }
        }
        LearningCard(title = "报告操作") {
            SecondaryActionButton(
                "回到提升路径",
                { onBackToPlan(reinforcementReportBackToPlanId(report)) },
                enabled = reinforcementReportBackToPlanId(report).isNotBlank(),
            )
            SecondaryActionButton(
                "复制摘要",
                {
                    clipboardManager.setText(AnnotatedString(reinforcementReportShareText(report)))
                    copyStatus = "报告摘要已复制"
                },
            )
            if (copyStatus.isNotBlank()) {
                MetaText(copyStatus)
            }
        }
        LearningCard(title = "检测总结") {
            val diagnosticFeedback = report.diagnosticResult?.feedback.orEmpty()
            Text(
                text = diagnosticFeedback.ifBlank { "本轮检测结果已生成提升路径。" },
                color = OpenPhysicsColors.Ink,
                style = MaterialTheme.typography.bodyMedium,
            )
            MetaText("初始薄弱点 ${report.summary.weakTaskCount} 个")
        }
        ReportTextList("优势", reinforcementReportStrengths(report.strengths))
        ReportTextList("仍需关注", report.remainingWeaknesses.ifEmpty { listOf("暂无需要继续补弱的知识点。") })
        ReportTextList("下一步建议", report.nextActions.ifEmpty { listOf("回到巩固提升首页选择新的范围。") })
        LearningCard(title = "任务明细") {
            if (report.tasks.isEmpty()) {
                MutedText("暂无任务结果。")
            } else {
                report.tasks.sortedBy { it.priority }.forEach { task ->
                    ReportTaskRow(task)
                }
            }
        }
        LearningCard(title = "复测记录") {
            if (report.retestAttempts.isEmpty()) {
                MutedText("暂无复测记录")
            } else {
                report.retestAttempts.forEach { attempt ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(OpenPhysicsColors.SurfaceSoft, RoundedCornerShape(OpenPhysicsRadius.Medium))
                            .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Medium))
                            .padding(12.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(shortDate(attempt.submittedAt.ifBlank { attempt.createdAt }), color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            MetaText("${attempt.correctCount}/${attempt.totalCount} · 通过 ${attempt.passedCount} · 补弱 ${attempt.needsRetestCount}")
                        }
                        StatusChip(attempt.status.ifBlank { "已记录" }, tone = OpenPhysicsTone.Primary)
                    }
                }
            }
        }
    }
}

@Composable
fun ReinforcementReportHistoryScreen(
    reports: ImprovementReportListResponse,
    onBack: () -> Unit,
    onHome: () -> Unit,
    onLearn: () -> Unit,
    onPractice: () -> Unit,
    onReview: () -> Unit,
    onMe: () -> Unit,
    onOpenReport: (String) -> Unit,
    onLoadMore: () -> Unit,
) {
    if (LocalPhonePresentation.current) {
        PhoneReportHistory(reports, onBack, onOpenReport, onLoadMore)
        return
    }
    MainPage(
        activeTab = MainTab.Practice,
        onHome = onHome,
        onLearn = onLearn,
        onPractice = onPractice,
        onReview = onReview,
        onMe = onMe,
    ) {
        ReinforcementSubpageHeader("提升报告历史", "查看已经完成的章节 / 单元提升闭环", onBack)
        if (reports.items.isEmpty()) {
            EmptyReinforcementList("暂无提升报告", "完成一次阶段复测后，会在这里生成报告。")
        } else {
            reports.items.forEach { item ->
                ReportHistoryRow(item, onOpenReport)
            }
            ReinforcementListFooter(
                shown = reports.items.size,
                total = reports.total,
                onLoadMore = onLoadMore,
            )
        }
    }
}

@Composable
fun ReinforcementDiagnosticHistoryScreen(
    attempts: ScopeDiagnosticAttemptListResponse,
    onBack: () -> Unit,
    onHome: () -> Unit,
    onLearn: () -> Unit,
    onPractice: () -> Unit,
    onReview: () -> Unit,
    onMe: () -> Unit,
    onOpenAttempt: (String) -> Unit,
    onOpenLinkedPlan: (String) -> Unit,
    onLoadMore: () -> Unit,
) {
    if (LocalPhonePresentation.current) {
        PhoneDiagnosticHistory(attempts, onBack, onOpenAttempt, onOpenLinkedPlan, onLoadMore)
        return
    }
    MainPage(
        activeTab = MainTab.Practice,
        onHome = onHome,
        onLearn = onLearn,
        onPractice = onPractice,
        onReview = onReview,
        onMe = onMe,
    ) {
        ReinforcementSubpageHeader("检测历史", "查看每次章节 / 单元检测结果和对应提升路径。", onBack)
        if (attempts.items.isEmpty()) {
            EmptyReinforcementList("暂无检测记录", "完成一次章节或单元检测后，会在这里生成历史记录。")
        } else {
            attempts.items.forEach { item ->
                DiagnosticHistoryRow(item, onOpenAttempt, onOpenLinkedPlan)
            }
            ReinforcementListFooter(
                shown = attempts.items.size,
                total = attempts.total,
                onLoadMore = onLoadMore,
            )
        }
    }
}

@Composable
fun ReinforcementDiagnosticAttemptDetailScreen(
    detail: ScopeDiagnosticAttemptDetail,
    onBackToHistory: () -> Unit,
    onBackToEntry: () -> Unit,
    onViewPlan: (String) -> Unit,
    onViewReport: (String) -> Unit,
    onRediagnose: () -> Unit,
    onHome: () -> Unit,
    onLearn: () -> Unit,
    onPractice: () -> Unit,
    onReview: () -> Unit,
    onMe: () -> Unit,
) {
    if (LocalPhonePresentation.current) {
        PhoneDiagnosticAttemptDetail(detail, onBackToHistory, onBackToEntry, onViewPlan, onViewReport, onRediagnose)
        return
    }
    val layoutPolicy = reinforcementDiagnosticAttemptDetailLayoutPolicy()
    val title = if (detail.scopeType == "section") layoutPolicy.sectionTitle else layoutPolicy.chapterTitle
    MainPage(
        activeTab = MainTab.Practice,
        onHome = onHome,
        onLearn = onLearn,
        onPractice = onPractice,
        onReview = onReview,
        onMe = onMe,
    ) {
        ReinforcementSubpageHeader(title, "${detail.scopeName} · 正确 ${detail.correctCount}/${detail.totalCount}", onBackToHistory)
        LearningCard(title = "检测概览") {
            StatStrip {
                StatCell("正确率", "${accuracyPercent(detail.correctCount, detail.totalCount)}%")
                StatCell("薄弱点", "${detail.weakCount}")
                StatCell("题目", "${detail.totalCount}")
            }
            if (detail.feedback.isNotBlank()) {
                MutedText(detail.feedback)
            }
        }
        LearningCard(title = "知识点表现") {
            if (detail.kpResults.isEmpty()) {
                MutedText("暂无知识点明细")
            } else {
                detail.kpResults.sortedByDescending { it.isWeak }.forEach { item ->
                    ScopeDiagnosticKpRow(item)
                }
            }
        }
        LearningCard(title = "关联提升路径") {
            if (detail.linkedPlanId.isBlank()) {
                MutedText("本次检测尚未关联提升路径。")
            } else {
                MetaText("本次检测已关联提升路径：${improvementPlanStatusLabel(detail.linkedPlanStatus)}")
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    SecondaryActionButton("查看提升路径", { onViewPlan(detail.linkedPlanId) }, modifier = Modifier.width(132.dp))
                    if (reinforcementDiagnosticDetailShowsReport(detail)) {
                        PrimaryActionButton(
                            text = "查看提升报告",
                            onClick = { onViewReport(detail.linkedPlanId) },
                            modifier = Modifier.width(132.dp),
                        )
                    }
                }
            }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SecondaryActionButton("回到巩固提升", onBackToEntry, modifier = Modifier.weight(1f))
                SecondaryActionButton("重新检测", onRediagnose, modifier = Modifier.weight(1f), enabled = reinforcementDiagnosticRediagnoseEnabled(detail.scopeType))
            }
        }
    }
}

@Composable
fun ReinforcementLearningTraceScreen(
    trace: LearningTraceResponse,
    onBack: () -> Unit,
    onHome: () -> Unit,
    onLearn: () -> Unit,
    onPractice: () -> Unit,
    onReview: () -> Unit,
    onMe: () -> Unit,
    onOpenDiagnosticAttempt: (String) -> Unit,
    onOpenPlan: (String) -> Unit,
    onOpenReport: (String) -> Unit,
    onLoadMore: () -> Unit,
) {
    if (LocalPhonePresentation.current) {
        PhoneLearningTrace(trace, onBack, onOpenDiagnosticAttempt, onOpenPlan, onOpenReport, onLoadMore)
        return
    }
    MainPage(
        activeTab = MainTab.Practice,
        onHome = onHome,
        onLearn = onLearn,
        onPractice = onPractice,
        onReview = onReview,
        onMe = onMe,
    ) {
        ReinforcementSubpageHeader("学习轨迹", "按时间回顾检测、提升、复测和报告记录。", onBack)
        if (trace.items.isEmpty()) {
            EmptyReinforcementList("暂无学习轨迹", "完成一次检测、提升或复测后，会在这里生成时间线。")
        } else {
            trace.items.forEach { event ->
                LearningTraceRow(
                    event = event,
                    onOpenDiagnosticAttempt = onOpenDiagnosticAttempt,
                    onOpenPlan = onOpenPlan,
                    onOpenReport = onOpenReport,
                )
            }
            ReinforcementListFooter(
                shown = trace.items.size,
                total = trace.total,
                onLoadMore = onLoadMore,
            )
        }
    }
}

@Composable
private fun ReinforcementSubpageHeader(title: String, subtitle: String, onBack: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Color.White, RoundedCornerShape(OpenPhysicsRadius.Large))
            .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Large))
            .padding(horizontal = 20.dp, vertical = 18.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AndroidNativeBackButton(onClick = onBack)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                title,
                color = OpenPhysicsColors.Ink,
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
            )
            Text(
                subtitle,
                color = OpenPhysicsColors.Muted,
                style = MaterialTheme.typography.bodyLarge,
            )
        }
    }
}

@Composable
private fun EmptyReinforcementList(title: String, subtitle: String) {
    LearningCard {
        Text(title, color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        MutedText(subtitle)
    }
}

@Composable
private fun ReportHistoryRow(item: ImprovementReportListItem, onOpenReport: (String) -> Unit) {
    LearningCard {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                MetaText(item.summaryLabel.ifBlank { "提升报告" })
                Text(item.scopeName, color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                MetaText("完成于 ${shortDate(item.completedAt)} · 检测 ${item.diagnosticCorrectCount}/${item.diagnosticTotalCount}")
                if (item.highlight.isNotBlank()) {
                    MutedText(item.highlight)
                }
            }
            Column(modifier = Modifier.width(112.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                reinforcementReportHistoryMetrics(item).forEach { metric ->
                    Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                        Text(metric.value, color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                        MetaText(metric.label)
                    }
                }
                PrimaryActionButton("查看报告", { onOpenReport(item.planId) })
            }
        }
    }
}

@Composable
private fun DiagnosticHistoryRow(
    item: ScopeDiagnosticAttemptListItem,
    onOpenAttempt: (String) -> Unit,
    onOpenLinkedPlan: (String) -> Unit,
) {
    val cardTarget = reinforcementDiagnosticHistoryCardTarget(item)
    LearningCard(
        onClick = {
            when (cardTarget.target) {
                ReinforcementTraceTarget.Plan -> onOpenLinkedPlan(cardTarget.targetId)
                ReinforcementTraceTarget.DiagnosticAttempt -> onOpenAttempt(cardTarget.targetId)
                ReinforcementTraceTarget.Report -> Unit
            }
        },
    ) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                MetaText(if (item.linkedPlanId.isNotBlank()) "对应提升路径" else "检测记录")
                Text(item.scopeName, color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                MetaText(reinforcementDiagnosticHistoryMeta(item))
                if (item.feedback.isNotBlank()) {
                    MutedText(item.feedback)
                }
            }
        }
    }
}

@Composable
private fun LearningTraceRow(
    event: LearningTraceEvent,
    onOpenDiagnosticAttempt: (String) -> Unit,
    onOpenPlan: (String) -> Unit,
    onOpenReport: (String) -> Unit,
) {
    val action = reinforcementTraceAction(event)
    LearningCard {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                MetaText("${event.statusLabel.ifBlank { event.eventType }} · ${shortDateTime(event.eventTime)}")
                Text(event.title, color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                MetaText(reinforcementTraceMeta(event))
                if (event.description.isNotBlank()) {
                    MutedText(event.description)
                }
            }
            if (action != null) {
                Column(modifier = Modifier.width(112.dp)) {
                    val onActionClick = {
                        when (action.target) {
                            ReinforcementTraceTarget.DiagnosticAttempt -> onOpenDiagnosticAttempt(action.targetId)
                            ReinforcementTraceTarget.Plan -> onOpenPlan(action.targetId)
                            ReinforcementTraceTarget.Report -> onOpenReport(action.targetId)
                        }
                    }
                    if (action.primary) {
                        PrimaryActionButton(action.label, onActionClick)
                    } else {
                        SecondaryActionButton(action.label, onActionClick)
                    }
                }
            }
        }
    }
}

@Composable
private fun ReinforcementListFooter(shown: Int, total: Int, onLoadMore: () -> Unit) {
    val footer = reinforcementListFooterState(shown, total)
    LearningCard {
        MetaText(footer.summary)
        if (footer.canLoadMore) {
            PrimaryActionButton(footer.loadMoreLabel, onLoadMore)
        }
    }
}

@Composable
private fun CurrentImprovementTaskCard(
    task: ImprovementTask,
    onLearn: () -> Unit,
    onStart: () -> Unit,
) {
    LearningCard(title = "当前推荐任务") {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(OpenPhysicsColors.SurfaceSoft, RoundedCornerShape(OpenPhysicsRadius.Medium))
                .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Medium))
                .padding(12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    StatusChip("${task.priority}", tone = OpenPhysicsTone.Primary)
                    Text(
                        reinforcementCurrentTaskTitle(task),
                        modifier = Modifier.weight(1f),
                        color = OpenPhysicsColors.Ink,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                    )
                }
                if (task.reason.isNotBlank()) {
                    MutedText(task.reason)
                }
                MetaText(reinforcementCurrentTaskMasteryText(task))
                AccessibleTaskProgressLine(task, modifier = Modifier.width(360.dp))
            }
            Column(modifier = Modifier.width(160.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                PrimaryActionButton(reinforcementCurrentTaskPrimaryActionLabel(task), onStart)
                SecondaryActionButton("回看知识", onLearn)
            }
        }
    }
}

@Composable
private fun CurrentImprovementEmptyCard(
    plan: ImprovementPlan,
    onPrimaryAction: () -> Unit,
) {
    LearningCard(title = "当前推荐任务") {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(OpenPhysicsColors.SurfaceSoft, RoundedCornerShape(OpenPhysicsRadius.Medium))
                .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Medium))
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                reinforcementCurrentEmptyTitle(plan),
                color = OpenPhysicsColors.Ink,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )
            MutedText(reinforcementCurrentEmptyReason(plan))
            PrimaryActionButton(
                text = reinforcementCurrentEmptyPrimaryActionLabel(plan),
                onClick = onPrimaryAction,
                enabled = reinforcementCurrentEmptyPrimaryActionEnabled(plan),
            )
        }
    }
}

@Composable
private fun ImprovementTaskRow(
    task: ImprovementTask,
    planStatus: String,
    onLearn: () -> Unit,
    onPractice: () -> Unit,
) {
    val practiceAction = reinforcementTaskPracticeAction(task, planStatus)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(OpenPhysicsColors.SurfaceSoft, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(task.kpName, modifier = Modifier.weight(1f), color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                if (reinforcementTaskStatusBadgeVisible(task)) {
                    StatusChip(improvementTaskStatusLabel(task.status), tone = improvementTaskTone(task.status))
                }
            }
            if (task.reason.isNotBlank()) {
                MutedText(task.reason)
            }
            Row(modifier = Modifier.width(360.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                MetaText(reinforcementTaskMasteryPrimaryText(task))
                MetaText(reinforcementTaskMasteryAfterText(task))
            }
            AccessibleTaskProgressLine(task, modifier = Modifier.width(360.dp))
            MetaText(reinforcementTaskMasteryChangeText(task))
        }
        Row(modifier = Modifier.width(196.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SecondaryActionButton(reinforcementTaskReviewActionLabel(), onLearn, modifier = Modifier.weight(1f))
            PrimaryActionButton(practiceAction.label, onPractice, modifier = Modifier.weight(1f), enabled = practiceAction.enabled)
        }
    }
}

@Composable
private fun AccessibleTaskProgressLine(task: ImprovementTask, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier.semantics {
            contentDescription = reinforcementTaskMasteryAccessibilityLabel(task)
            progressBarRangeInfo = ProgressBarRangeInfo(
                current = reinforcementTaskMasteryProgressFraction(task).toFloat(),
                range = 0f..1f,
            )
        },
    ) {
        TaskMasteryProgressLine(task)
    }
}

@Composable
private fun TaskMasteryProgressLine(task: ImprovementTask) {
    val fraction = reinforcementTaskMasteryProgressFraction(task).toFloat()
    if (!reinforcementTaskMasteryProgressTrackVisible(task)) return
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 4.dp)
            .background(OpenPhysicsColors.Divider, RoundedCornerShape(999.dp)),
    ) {
        if (fraction > 0f) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(fraction)
                    .heightIn(min = 4.dp)
                    .background(MaterialTheme.colorScheme.primary, RoundedCornerShape(999.dp)),
            )
        }
    }
}

@Composable
private fun ScopeDiagnosticKpRow(result: ScopeDiagnosticKpResult) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(if (result.isWeak) OpenPhysicsColors.WarningSoft else OpenPhysicsColors.SurfaceSoft, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(result.kpName, color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            MetaText("${result.correctCount}/${result.totalCount} · ${percent(result.masteryBefore)}% → ${percent(result.masteryAfter)}%")
        }
        StatusChip(if (result.isWeak) "薄弱" else "稳定", tone = if (result.isWeak) OpenPhysicsTone.Warning else OpenPhysicsTone.Success)
    }
}

@Composable
private fun ReportOverviewMetricTile(metric: ReinforcementReportOverviewMetric, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .background(OpenPhysicsColors.SurfaceSoft, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Text(metric.value, color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        MetaText(metric.label)
        MutedText(metric.detail)
    }
}

@Composable
private fun ReportTextList(title: String, items: List<String>) {
    if (items.isEmpty()) return
    LearningCard(title = title) {
        items.forEach { item ->
            Text("• $item", color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun ReportTaskRow(task: ImprovementReportTask) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(OpenPhysicsColors.SurfaceSoft, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(task.kpName, color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            MetaText(reinforcementReportTaskDetailText(task))
            if (task.reason.isNotBlank()) {
                Text(task.reason, color = OpenPhysicsColors.Muted, style = MaterialTheme.typography.bodySmall)
            }
        }
        StatusChip(task.finalLabel.ifBlank { improvementTaskStatusLabel(task.status) }, tone = improvementTaskTone(task.status))
    }
}

@Composable
private fun TabletReinforcementActionStep(
    index: String,
    title: String,
    subtitle: String,
    primaryText: String,
    onPrimary: () -> Unit,
    enabled: Boolean = true,
    secondary: Boolean = false,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(OpenPhysicsColors.SurfaceSoft, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .padding(10.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StatusChip(index, tone = OpenPhysicsTone.Primary)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = OpenPhysicsColors.Ink, fontWeight = FontWeight.Bold)
            Text(subtitle, style = MaterialTheme.typography.labelMedium, color = OpenPhysicsColors.Muted)
        }
        Column(modifier = Modifier.width(104.dp)) {
            if (secondary) {
                SecondaryActionButton(primaryText, onPrimary, enabled = enabled)
            } else {
                PrimaryActionButton(primaryText, onPrimary, enabled = enabled)
            }
        }
    }
}

@Composable
private fun TabletWeakKpActionRow(
    kp: KpNode,
    judgment: KnowledgeMasteryJudgment?,
    onPractice: (KpNode) -> Unit,
    onLearn: (KpNode) -> Unit,
) {
    val display = reinforcementKpMasteryDisplay(kp, judgment)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(OpenPhysicsColors.SurfaceSoft, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .padding(10.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(kp.name, style = MaterialTheme.typography.titleMedium, color = OpenPhysicsColors.Ink, fontWeight = FontWeight.Bold)
                StatusChip(display.label, tone = display.tone)
                StatusChip("掌握 ${display.masteryPct ?: kp.masteryPercent()}%", tone = OpenPhysicsTone.Primary)
            }
            ProgressLine(((display.masteryPct ?: kp.masteryPercent()) / 100.0).coerceIn(0.0, 1.0))
        }
        Column(modifier = Modifier.width(82.dp)) {
            SecondaryActionButton("回看", { onLearn(kp) })
        }
        Column(modifier = Modifier.width(82.dp)) {
            PrimaryActionButton("练习", { onPractice(kp) })
        }
    }
}

private fun reinforcementKpMasteryDisplay(
    kp: KpNode,
    judgment: KnowledgeMasteryJudgment?,
) = mapKnowledgeMasteryJudgmentToMasteryDisplay(
    judgment = judgment,
    fallback = KnowledgeMasteryDisplayFallback(
        label = learningKpStatus(kp).label,
        reason = "",
        tone = learningKpStatus(kp).tone,
        masteryPct = kp.masteryPercent(),
    ),
)

private fun volumeOrder(volume: String): Int {
    val index = VOLUME_ORDER.indexOf(volume)
    return if (index >= 0) index else VOLUME_ORDER.size
}

private fun shortVolumeLabel(volume: String): String = SHORT_VOLUME_LABELS[volume] ?: volume

private fun reinforcementPlanTone(plan: ReinforcementChapterPlan): OpenPhysicsTone {
    return when {
        plan.weakCount > 0 -> OpenPhysicsTone.Warning
        plan.averageMastery >= 0.8 -> OpenPhysicsTone.Success
        plan.averageMastery > 0.0 -> OpenPhysicsTone.Primary
        else -> OpenPhysicsTone.Neutral
    }
}

internal fun reinforcementChapterListStatus(plan: ReinforcementChapterPlan): String {
    return plan.status
}

internal fun reinforcementChapterListTone(plan: ReinforcementChapterPlan): OpenPhysicsTone {
    return when (plan.status) {
        "有薄弱", "待检测", "可提升" -> OpenPhysicsTone.Warning
        "已稳定" -> OpenPhysicsTone.Success
        "学习中" -> OpenPhysicsTone.Primary
        else -> OpenPhysicsTone.Neutral
    }
}

private fun improvementPlanStatusLabel(status: String): String {
    return when (status) {
        "active" -> "进行中"
        "ready_for_retest" -> "待复测"
        "completed" -> "已完成"
        else -> "进行中"
    }
}

internal fun improvementTaskStatusLabel(status: String): String {
    return when (status) {
        "pending" -> "待练"
        "in_progress" -> "练习中"
        "practiced" -> "已练"
        "passed" -> "通过"
        "needs_retest" -> "待补"
        else -> "待练"
    }
}

private fun improvementTaskTone(status: String): OpenPhysicsTone {
    return when (status) {
        "passed" -> OpenPhysicsTone.Success
        "needs_retest" -> OpenPhysicsTone.Warning
        "practiced", "in_progress" -> OpenPhysicsTone.Primary
        else -> OpenPhysicsTone.Neutral
    }
}

internal fun reinforcementCurrentTaskTitle(task: ImprovementTask): String {
    return "修复「${task.kpName}」"
}

internal fun reinforcementCurrentTaskPrimaryActionLabel(task: ImprovementTask): String {
    return if (task.status == "in_progress") "继续本步提升" else "开始本步提升"
}

internal fun reinforcementCurrentTaskMasteryText(task: ImprovementTask): String {
    val masteryAfter = reinforcementTaskDiagnosticMasteryAfter(task)
    return "${task.correctCount}/${task.totalCount} 正确 · 掌握度 ${percent(masteryAfter)}% · ${percent(task.masteryBefore)}% → ${percent(masteryAfter)}%"
}

internal fun reinforcementTaskMasteryPrimaryText(task: ImprovementTask): String {
    return "${task.correctCount}/${task.totalCount} 正确"
}

internal fun reinforcementTaskMasteryAfterText(task: ImprovementTask): String {
    return "掌握度 ${percent(reinforcementTaskDiagnosticMasteryAfter(task))}%"
}

internal fun reinforcementTaskMasteryChangeText(task: ImprovementTask): String {
    return "${percent(task.masteryBefore)}% → ${percent(reinforcementTaskDiagnosticMasteryAfter(task))}%"
}

internal fun reinforcementTaskStatusBadgeVisible(task: ImprovementTask): Boolean {
    return false
}

internal fun reinforcementTaskMasteryProgressFraction(task: ImprovementTask): Double {
    return reinforcementTaskDiagnosticMasteryAfter(task).coerceIn(0.0, 1.0)
}

internal fun reinforcementTaskMasteryProgressTrackVisible(task: ImprovementTask): Boolean {
    return true
}

internal fun reinforcementTaskMasteryAccessibilityLabel(task: ImprovementTask): String {
    val masteryAfter = reinforcementTaskDiagnosticMasteryAfter(task)
    return "${task.kpName}掌握度 ${percent(masteryAfter)}%，本轮变化 ${percent(task.masteryBefore)}% 到 ${percent(masteryAfter)}%，${task.correctCount}/${task.totalCount} 正确"
}

private fun reinforcementTaskDiagnosticMasteryAfter(task: ImprovementTask): Double {
    return if (task.totalCount > 0 && task.correctCount <= 0 && task.masteryAfter > task.masteryBefore) {
        task.masteryBefore
    } else {
        task.masteryAfter
    }
}

internal fun reinforcementDiagnosticRediagnoseEnabled(scopeType: String): Boolean {
    return scopeType == "chapter" || scopeType == "section"
}

internal fun reinforcementTaskPracticeAction(task: ImprovementTask, planStatus: String): ReinforcementTaskPracticeAction {
    if (task.status == "passed") {
        return ReinforcementTaskPracticeAction("已通过", enabled = false)
    }
    if (planStatus == "completed") {
        return ReinforcementTaskPracticeAction("本轮已完成", enabled = false)
    }
    if (task.status == "practiced" && planStatus == "ready_for_retest") {
        return ReinforcementTaskPracticeAction("待复测", enabled = false)
    }
    return ReinforcementTaskPracticeAction("专项练", enabled = true)
}

internal fun reinforcementTaskReviewActionLabel(): String = "回看知识"

internal fun reinforcementScopeGuidanceText(hasWeakKps: Boolean): String {
    return if (hasWeakKps) {
        "已经找到薄弱点，建议先完成一组针对性训练，再回看知识和复测。"
    } else {
        "本轮检测整体较稳定，可以继续做一组提升训练，检查综合应用能力。"
    }
}

internal fun reinforcementScopeNextTaskText(plan: ImprovementPlan): String {
    return plan.currentTask()?.let { "推荐下一步：先处理「${it.kpName}」。" }.orEmpty()
}

internal fun reinforcementScopePlanTaskSummaryText(plan: ImprovementPlan): String {
    val nextName = plan.currentTask()?.kpName ?: "阶段复测"
    return "已生成 ${plan.tasks.size} 个提升任务，当前建议先处理「$nextName」。"
}

internal fun reinforcementScopeResultBackTarget(plan: ImprovementPlan): ReinforcementNativeBackTarget {
    return ReinforcementNativeBackTarget.Plan
}

internal fun reinforcementRetestResultBackTarget(plan: ImprovementPlan): ReinforcementNativeBackTarget {
    return ReinforcementNativeBackTarget.Plan
}

internal fun reinforcementTaskCompleteBackTarget(plan: ImprovementPlan): ReinforcementNativeBackTarget {
    return ReinforcementNativeBackTarget.Plan
}

internal fun reinforcementCurrentEmptyTitle(plan: ImprovementPlan): String {
    return when {
        plan.isCompleted() -> "本轮提升已通过"
        plan.readyForRetest() -> "本轮提升任务已完成，可以进入阶段复测。"
        else -> "暂无可提升任务"
    }
}

internal fun reinforcementCurrentEmptyReason(plan: ImprovementPlan): String {
    return when {
        plan.isCompleted() -> "本轮提升报告已生成，可以查看报告，或回到首页选择新的巩固范围。"
        plan.readyForRetest() -> "用一组阶段复测确认刚才补弱是否真正稳定。"
        else -> "本轮检测没有生成可执行任务，可以返回首页重新检测。"
    }
}

internal fun reinforcementCurrentEmptyPrimaryActionLabel(plan: ImprovementPlan): String {
    return when {
        plan.isCompleted() -> "查看提升报告"
        plan.readyForRetest() -> "开始阶段复测"
        else -> "暂无可提升任务"
    }
}

internal fun reinforcementCurrentEmptyPrimaryActionEnabled(plan: ImprovementPlan): Boolean {
    return plan.isCompleted() || plan.readyForRetest()
}

private fun percent(value: Double): Int = (value * 100).toInt().coerceIn(0, 100)

private fun accuracyPercent(correct: Int, total: Int): Int {
    if (total <= 0) return 0
    return ((correct.toDouble() / total) * 100).toInt().coerceIn(0, 100)
}

internal fun reinforcementRecentPlanTitle(plan: ImprovementPlan): String {
    return "「${plan.scopeName}」检测完成"
}

internal fun reinforcementRecentPlanActionLabel(plan: ImprovementPlan): String {
    val nextTask = plan.currentTask()
    return when {
        nextTask == null && !plan.readyForRetest() -> "暂无可提升知识点"
        plan.readyForRetest() -> "阶段复测"
        plan.weakCount > 0 -> "继续薄弱点提升"
        else -> "继续提升"
    }
}

internal fun reinforcementRecentPlanNextText(plan: ImprovementPlan): String {
    return plan.currentTask()?.let { "推荐先修复「${it.kpName}」" }.orEmpty()
}

internal fun reinforcementRecentReportTitle(report: ImprovementReport): String {
    return "「${report.summary.scopeName}」提升闭环已完成"
}

internal fun reinforcementRecentReportMeta(report: ImprovementReport): String {
    return "已通过 ${report.summary.passedTaskCount}/${report.summary.taskCount} · 复测正确率 ${formatNullablePercent(report.summary.latestRetestAccuracy)}"
}

internal fun reinforcementReportHistoryMetrics(item: ImprovementReportListItem): List<ReinforcementReportOverviewMetric> {
    return listOf(
        ReinforcementReportOverviewMetric("提升任务", "${item.passedTaskCount}/${item.taskCount}", ""),
        ReinforcementReportOverviewMetric("复测正确率", formatNullablePercent(item.latestRetestAccuracy), ""),
    )
}

internal fun reinforcementReportOverviewMetrics(summary: ImprovementReportSummary): List<ReinforcementReportOverviewMetric> {
    return listOf(
        ReinforcementReportOverviewMetric("检测正确率", "${summary.diagnosticCorrectCount}/${summary.diagnosticTotalCount}", "${percent(summary.diagnosticAccuracy)}%"),
        ReinforcementReportOverviewMetric("提升任务", "${summary.taskCount}", "薄弱 ${summary.weakTaskCount}"),
        ReinforcementReportOverviewMetric("已通过", "${summary.passedTaskCount}", "仍需 ${summary.needsRetestTaskCount}"),
        ReinforcementReportOverviewMetric("阶段复测", formatNullablePercent(summary.latestRetestAccuracy), "${summary.retestAttemptCount} 次记录"),
    )
}

internal fun reinforcementReportStrengths(strengths: List<String>): List<String> {
    return strengths.ifEmpty { listOf("本轮提升数据已记录。") }
}

internal fun reinforcementReportBackToPlanId(report: ImprovementReport): String {
    return report.summary.planId
}

internal fun reinforcementReportShareText(report: ImprovementReport): String {
    val summary = report.summary
    val latestAttempt = report.retestAttempts.firstOrNull()
    val retestLabel = latestAttempt?.let { "${it.correctCount}/${it.totalCount}" }
        ?: formatNullablePercent(summary.latestRetestAccuracy)
    val conclusion = if (summary.completed) "本轮提升已完成" else "本轮提升仍在进行"
    val nextAction = report.nextActions.firstOrNull { it.isNotBlank() }
        ?: "可以回到巩固提升首页选择新的章节或单元继续检测。"

    return listOf(
        "OpenPhysics提升报告",
        "范围：${summary.scopeName}",
        "检测：${summary.diagnosticCorrectCount}/${summary.diagnosticTotalCount}",
        "提升任务：已通过 ${summary.passedTaskCount}/${summary.taskCount}",
        "阶段复测：$retestLabel",
        "结论：$conclusion",
        "下一步：$nextAction",
    ).joinToString("\n")
}

internal fun reinforcementReportTaskDetailText(task: ImprovementReportTask): String {
    return "检测：${task.diagnosticCorrectCount}/${task.diagnosticTotalCount} · " +
        "掌握度：${percent(task.masteryBefore)}% → ${percent(task.masteryAfterDiagnostic)}% · " +
        "复测：${reinforcementReportTaskRetestScore(task.latestRetestCorrectCount, task.latestRetestTotalCount)}"
}

private fun reinforcementReportTaskRetestScore(correct: Int?, total: Int?): String {
    return if (correct == null || total == null) "未复测" else "$correct/$total"
}

private fun formatNullablePercent(value: Double?): String {
    return value?.let { "${percent(it)}%" } ?: "未完成"
}

internal fun reinforcementTaskCompleteNote(plan: ImprovementPlan): String {
    val nextTask = plan.currentTask()
    return if (nextTask != null) {
        "本步提升已记录，建议回到提升路径继续下一步。 下一步：${nextTask.kpName}。"
    } else {
        "本步提升已记录，建议回到提升路径继续下一步。 本轮任务已完成，下一阶段将进行复测。"
    }
}

internal fun reinforcementTaskCompleteContinueLabel(plan: ImprovementPlan): String {
    return if (plan.currentTask() != null) "继续下一步" else "回到提升路径"
}

internal fun reinforcementTaskCompleteCanContinue(plan: ImprovementPlan): Boolean {
    return plan.currentTask() != null
}

internal fun reinforcementTraceAction(event: LearningTraceEvent): ReinforcementTraceAction? {
    return when (event.primaryAction) {
        "view_diagnostic" -> event.attemptId.takeIf { it.isNotBlank() }?.let {
            ReinforcementTraceAction("查看检测结果", ReinforcementTraceTarget.DiagnosticAttempt, it, primary = false)
        }
        "view_plan" -> event.planId.takeIf { it.isNotBlank() }?.let {
            ReinforcementTraceAction("查看提升路径", ReinforcementTraceTarget.Plan, it, primary = false)
        }
        "view_report" -> event.planId.takeIf { it.isNotBlank() }?.let {
            ReinforcementTraceAction("查看提升报告", ReinforcementTraceTarget.Report, it, primary = true)
        }
        else -> null
    }
}

internal fun reinforcementTraceMeta(event: LearningTraceEvent): String {
    val scope = scopeLabel(event)
    return if (event.kpName.isBlank()) scope else "$scope · ${event.kpName}"
}

internal fun reinforcementDiagnosticHistoryPrimaryAction(item: ScopeDiagnosticAttemptListItem): ReinforcementDiagnosticHistoryAction {
    return if (item.linkedPlanId.isNotBlank()) {
        ReinforcementDiagnosticHistoryAction("查看提升路径", ReinforcementTraceTarget.Plan, item.linkedPlanId)
    } else {
        ReinforcementDiagnosticHistoryAction("查看检测记录", ReinforcementTraceTarget.DiagnosticAttempt, item.attemptId)
    }
}

internal fun reinforcementDiagnosticHistoryCardTarget(item: ScopeDiagnosticAttemptListItem): ReinforcementDiagnosticHistoryAction {
    return reinforcementDiagnosticHistoryPrimaryAction(item)
}

internal fun reinforcementDiagnosticHistoryMeta(item: ScopeDiagnosticAttemptListItem): String {
    return "${shortDateTime(item.submittedAt.ifBlank { item.createdAt })} · 正确 ${item.correctCount}/${item.totalCount} · 薄弱点 ${item.weakCount} 个"
}

internal fun reinforcementDiagnosticDetailShowsReport(detail: ScopeDiagnosticAttemptDetail): Boolean {
    return detail.linkedPlanId.isNotBlank() && detail.linkedReportAvailable
}

internal fun reinforcementListFooterState(shown: Int, total: Int): ReinforcementListFooterState {
    return ReinforcementListFooterState(
        summary = "已显示 $shown/$total",
        canLoadMore = shown < total,
        loadMoreLabel = "加载更多",
    )
}

private fun scopeLabel(event: LearningTraceEvent): String {
    val scope = event.scopeName.ifBlank { return "全部范围" }
    val prefix = if (event.scopeType == "section") "小节" else "章节"
    return "$prefix · $scope"
}

private fun shortDate(value: String): String {
    if (value.length >= 10) return value.substring(5, 10)
    return value.ifBlank { "未记录" }
}

private fun shortDateTime(value: String): String {
    if (value.length >= 16) return value.substring(5, 16).replace('T', ' ')
    return value.ifBlank { "未记录" }
}
