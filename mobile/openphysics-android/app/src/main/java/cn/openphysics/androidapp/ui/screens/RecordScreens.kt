package cn.openphysics.androidapp.ui.screens

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import cn.openphysics.androidapp.ui.components.BottomActionBar
import cn.openphysics.androidapp.ui.components.LearningCard
import cn.openphysics.androidapp.ui.components.MistakeTag
import cn.openphysics.androidapp.ui.components.PrimaryActionButton
import cn.openphysics.androidapp.ui.components.QuestionPanel
import cn.openphysics.androidapp.ui.components.SecondaryActionButton
import cn.openphysics.androidapp.ui.components.StatusChip
import cn.openphysics.androidapp.ui.design.OpenPhysicsColors
import cn.openphysics.androidapp.ui.design.OpenPhysicsRadius
import cn.openphysics.androidapp.ui.design.OpenPhysicsSpacing
import cn.openphysics.androidapp.ui.design.OpenPhysicsTone
import cn.openphysics.androidapp.domain.AnswerHistoryRecord
import cn.openphysics.androidapp.domain.PracticeOption
import cn.openphysics.androidapp.domain.PracticeQuestion
import cn.openphysics.androidapp.domain.ProcessGrading
import cn.openphysics.androidapp.domain.ProcessStepScore
import cn.openphysics.androidapp.domain.QuestionImage
import cn.openphysics.androidapp.domain.RenderedRichContent
import cn.openphysics.androidapp.domain.ReviewCenter
import cn.openphysics.androidapp.domain.ReviewData
import cn.openphysics.androidapp.domain.ReviewErrorGroup
import cn.openphysics.androidapp.domain.ReviewGroup
import cn.openphysics.androidapp.domain.ReviewMistake
import cn.openphysics.androidapp.domain.TutorChatMessage
import cn.openphysics.androidapp.ui.TutorRequestState
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

fun reviewTutorQuickPrompts(): List<String> {
    return listOf("我第一步错在哪？", "为什么这个答案不对？", "给我一道类似题")
}

internal fun reviewTutorAssistantPolicy(): TutorAssistantPolicy {
    return TutorAssistantPolicy(
        dialogTitle = "AI助教",
        triggerLabel = "AI助教",
        floatsOverContent = true,
        triggerIsDraggable = true,
        triggerOpensDialog = true,
        triggerSendsPromptImmediately = false,
        quickPromptsUseVerticalPills = true,
        composerPlacesSendInsideInput = true,
        sendUsesIconOnly = true,
        quickPrompts = reviewTutorQuickPrompts(),
        placeholder = "有什么关于这道题的问题，都可以问我",
        loadingText = "助教正在看这道题...",
    )
}

internal fun reviewDetailPrimaryActionLabel(): String = "做变式题"

internal fun reviewRetryGuidanceText(reason: String): String =
    reason.trim().ifBlank { "重新应用同一知识点，答对后才会从待复盘列表移除。" }

internal data class HistoryDetailTabletWebLayoutPolicy(
    val headerTitle: String,
    val usesSingleRecordCard: Boolean,
    val sections: List<String>,
    val sideActions: List<String>,
    val showsTutorPanel: Boolean,
    val wrongRecordPrimaryAction: String,
    val primaryActionFillsWidth: Boolean,
)

internal fun historyDetailTabletWebLayoutPolicy(): HistoryDetailTabletWebLayoutPolicy {
    return HistoryDetailTabletWebLayoutPolicy(
        headerTitle = "练习记录",
        usesSingleRecordCard = true,
        sections = listOf("题目", "我的答案", "正确答案", "解析"),
        sideActions = emptyList(),
        showsTutorPanel = false,
        wrongRecordPrimaryAction = "去错题复盘",
        primaryActionFillsWidth = false,
    )
}

internal data class ReviewDetailTabletWebLayoutPolicy(
    val headerTitle: String,
    val headerSubtitle: String,
    val usesSingleQuestionCard: Boolean,
    val usesDiagnosisTwoColumnCards: Boolean,
    val cardSections: List<String>,
    val sideActions: List<String>,
    val variantPanelBelowQuestionCard: Boolean,
    val retryMessageCardBelowQuestionCard: Boolean,
)

internal fun reviewDetailTabletWebLayoutPolicy(): ReviewDetailTabletWebLayoutPolicy {
    return ReviewDetailTabletWebLayoutPolicy(
        headerTitle = "错题详情",
        headerSubtitle = "",
        usesSingleQuestionCard = true,
        usesDiagnosisTwoColumnCards = false,
        cardSections = listOf("题目", "你的答案", "正确答案", "错因类型", "AI批改依据", "解析"),
        sideActions = listOf("AI 助教", "做变式题"),
        variantPanelBelowQuestionCard = false,
        retryMessageCardBelowQuestionCard = true,
    )
}

internal data class ReviewDetailQuestionPanePolicy(
    val usesLearningContentPane: Boolean,
    val usesDynamicHeight: Boolean,
    val minimumHeightDp: Int,
)

internal fun reviewDetailQuestionPanePolicy(): ReviewDetailQuestionPanePolicy {
    return ReviewDetailQuestionPanePolicy(
        usesLearningContentPane = true,
        usesDynamicHeight = true,
        minimumHeightDp = 180,
    )
}

internal data class ReviewRetryPracticePresentationPolicy(
    val opensDedicatedQuestionPage: Boolean,
    val usesSharedPracticeQuestionScreen: Boolean,
    val rendersInlineBelowReviewCard: Boolean,
    val keepsQuestionPageOnSubmitFailure: Boolean,
    val pageTitle: String,
    val submitLabel: String,
)

internal fun reviewRetryPracticePresentationPolicy(): ReviewRetryPracticePresentationPolicy {
    return ReviewRetryPracticePresentationPolicy(
        opensDedicatedQuestionPage = true,
        usesSharedPracticeQuestionScreen = true,
        rendersInlineBelowReviewCard = false,
        keepsQuestionPageOnSubmitFailure = true,
        pageTitle = "做变式题",
        submitLabel = "提交变式题",
    )
}

internal data class ReviewNotebookTabletPolicy(
    val maxMistakesPerGroup: Int,
)

internal fun reviewNotebookTabletPolicy(): ReviewNotebookTabletPolicy {
    return ReviewNotebookTabletPolicy(
        maxMistakesPerGroup = 5,
    )
}

internal data class ReviewNotebookTabletWebLayoutPolicy(
    val headerTitle: String,
    val headerSubtitle: String,
    val usesTwoColumnWorkspace: Boolean,
    val controlPanelSections: List<String>,
    val poolEyebrow: String,
    val poolTitle: String,
)

internal fun reviewNotebookTabletWebLayoutPolicy(): ReviewNotebookTabletWebLayoutPolicy {
    return ReviewNotebookTabletWebLayoutPolicy(
        headerTitle = "错题本",
        headerSubtitle = "",
        usesTwoColumnWorkspace = true,
        controlPanelSections = listOf("复盘概览", "本轮重点", "复盘流程"),
        poolEyebrow = "",
        poolTitle = "待复盘错题",
    )
}

internal enum class HistoryResultFilter {
    All,
    Correct,
    Wrong,
}

internal data class HistoryFilterOption(
    val filter: HistoryResultFilter,
    val label: String,
    val count: Int,
)

internal fun filterHistoryRecords(
    records: List<AnswerHistoryRecord>,
    filter: HistoryResultFilter,
): List<AnswerHistoryRecord> {
    return when (filter) {
        HistoryResultFilter.All -> records
        HistoryResultFilter.Correct -> records.filter { it.isCorrect }
        HistoryResultFilter.Wrong -> records.filter { !it.isCorrect }
    }
}

internal fun historyFilterOptions(records: List<AnswerHistoryRecord>): List<HistoryFilterOption> {
    return listOf(
        HistoryFilterOption(HistoryResultFilter.All, "全部", records.size),
        HistoryFilterOption(HistoryResultFilter.Correct, "做对", records.count { it.isCorrect }),
        HistoryFilterOption(HistoryResultFilter.Wrong, "做错", records.count { !it.isCorrect }),
    )
}

internal fun matchingReviewMistakeForHistory(
    record: AnswerHistoryRecord,
    review: ReviewData,
): ReviewMistake? {
    val mistakes = reviewAllMistakes(review)
    return mistakes.firstOrNull { it.answerId == record.id }
        ?: mistakes.firstOrNull { it.questionId == record.questionId }
}

@Composable
fun HistoryScreen(
    records: List<AnswerHistoryRecord>,
    onBack: () -> Unit,
    onRecord: (AnswerHistoryRecord) -> Unit,
    onOpenReview: (AnswerHistoryRecord) -> Unit = onRecord,
    studentToken: String = "",
) {
    if (LocalPhonePresentation.current) {
        var activeFilter by remember(records) { mutableStateOf(HistoryResultFilter.All) }
        val filterOptions = historyFilterOptions(records)
        val visibleRecords = filterHistoryRecords(records, activeFilter)
        PhoneDetailPage("练习记录", onBack, showFooter = false) {
            Text("共 ${records.size} 条作答", color = PhoneColors.Muted,
                style = androidx.compose.material3.MaterialTheme.typography.labelMedium)
            PhoneHistoryFilterBar(filterOptions, activeFilter) { activeFilter = it }
            if (records.isEmpty()) Text("还没有练习记录。完成练习后，可在这里查看作答和解析。", color = PhoneColors.Muted)
            else if (visibleRecords.isEmpty()) Text("暂无符合条件的练习记录。", color = PhoneColors.Muted)
            visibleRecords.forEach { record -> PhoneHistoryRecordRow(record) { onRecord(record) } }
        }
        return
    }
    TabletHistoryContent(records = records, onBack = onBack, onOpenReview = onOpenReview, studentToken = studentToken)
}

@Composable
private fun PhoneHistoryRecordRow(record: AnswerHistoryRecord, onClick: () -> Unit) {
    PhoneCompactQuestionRow(
        title = record.kpNames.firstOrNull()?.takeIf { it.isNotBlank() }?.let { name ->
            if (record.kpNames.size > 1) "$name 等 ${record.kpNames.size} 个知识点" else name
        } ?: questionTypeLabel(record.questionType),
        status = if (record.isCorrect) "正确" else "需订正",
        meta = "${questionTypeLabel(record.questionType)} · ${displayTime(record.createdAt)}",
        preview = phoneQuestionPreview(record.stemText, 100),
        hasAnswerImage = record.answerImages.isNotEmpty() || record.processGrading?.answerImagePaths?.isNotEmpty() == true,
        onClick = onClick,
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PhoneHistoryFilterBar(
    options: List<HistoryFilterOption>,
    activeFilter: HistoryResultFilter,
    onFilter: (HistoryResultFilter) -> Unit,
) {
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        options.forEach { option ->
            val active = option.filter == activeFilter
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .background(if (active) PhoneColors.Soft else PhoneColors.Background)
                    .border(
                        1.dp,
                        if (active) PhoneColors.Primary else PhoneColors.Divider,
                        RoundedCornerShape(999.dp),
                    )
                    .clickable(role = Role.Tab) { onFilter(option.filter) }
                    .semantics { selected = active }
                    .heightIn(min = 44.dp)
                    .padding(horizontal = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(7.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    option.label,
                    color = if (active) PhoneColors.Primary else PhoneColors.Muted,
                    style = androidx.compose.material3.MaterialTheme.typography.labelLarge,
                    fontWeight = if (active) FontWeight.Bold else FontWeight.Medium,
                )
                Text(
                    option.count.toString(),
                    color = if (active) PhoneColors.Primary else PhoneColors.Muted,
                    style = androidx.compose.material3.MaterialTheme.typography.labelMedium,
                )
            }
        }
    }
}

@Composable
private fun TabletHistoryContent(
    records: List<AnswerHistoryRecord>,
    onBack: () -> Unit,
    onOpenReview: (AnswerHistoryRecord) -> Unit,
    studentToken: String = "",
) {
    val correctCount = records.count { it.isCorrect }
    val correctionCount = records.size - correctCount
    val accuracy = if (records.isEmpty()) 0 else correctCount * 100 / records.size
    var activeFilter by remember(records) { mutableStateOf(HistoryResultFilter.All) }
    val filterOptions = historyFilterOptions(records)
    val visibleRecords = filterHistoryRecords(records, activeFilter)
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(OpenPhysicsColors.Background)
            .verticalScroll(rememberScrollState())
            .padding(OpenPhysicsSpacing.PageHorizontal),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        TabletWorkspaceTopBar(
            title = "练习记录",
            subtitle = "按时间查看最近完成的题目、作答、批改和解析。",
            onHome = onBack,
            primaryBadge = "${records.size} 最近记录",
            primaryTone = OpenPhysicsTone.Primary,
            secondaryBadge = "$correctionCount 需订正",
            secondaryTone = if (correctionCount > 0) OpenPhysicsTone.Warning else OpenPhysicsTone.Success,
        )
        LearningCard(
            title = "练习记录时间线",
            subtitle = if (records.isEmpty()) {
                "暂无练习记录"
            } else {
                "共 ${records.size} 道 · 正确 $correctCount · 需订正 $correctionCount · 正确率 $accuracy%"
            },
        ) {
            TabletHistoryFilterBar(
                options = filterOptions,
                activeFilter = activeFilter,
                onFilter = { activeFilter = it },
            )
            if (records.isEmpty()) {
                MutedText("完成练习后会自动生成学习记录。")
            } else if (visibleRecords.isEmpty()) {
                MutedText("暂无符合条件的练习记录。")
            } else {
                HistoryRecordsPaneWebView(
                    studentToken = studentToken,
                    records = visibleRecords,
                    onOpenReview = onOpenReview,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
private fun TabletHistoryFilterBar(
    options: List<HistoryFilterOption>,
    activeFilter: HistoryResultFilter,
    onFilter: (HistoryResultFilter) -> Unit,
) {
    Row(
        modifier = Modifier
            .background(OpenPhysicsColors.SurfaceSoft, RoundedCornerShape(999.dp))
            .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(999.dp))
            .padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        options.forEach { option ->
            val active = option.filter == activeFilter
            Row(
                modifier = Modifier
                    .background(
                        if (active) Color.White else Color.Transparent,
                        RoundedCornerShape(999.dp),
                    )
                    .border(
                        1.dp,
                        if (active) OpenPhysicsColors.Primary else Color.Transparent,
                        RoundedCornerShape(999.dp),
                    )
                    .clickable(onClick = { onFilter(option.filter) })
                    .padding(horizontal = 13.dp, vertical = 7.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = option.label,
                    color = if (active) OpenPhysicsColors.PrimaryDeep else OpenPhysicsColors.Muted,
                    style = androidx.compose.material3.MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    text = option.count.toString(),
                    color = if (active) OpenPhysicsColors.PrimaryDeep else OpenPhysicsColors.Muted,
                    style = androidx.compose.material3.MaterialTheme.typography.labelSmall,
                )
            }
        }
    }
}



@Composable
fun ReviewNotebookScreen(
    review: ReviewData,
    onHome: () -> Unit,
    onLearn: () -> Unit,
    onPractice: () -> Unit,
    onMe: () -> Unit,
    onMistake: (ReviewMistake) -> Unit,
) {
    MainPage(
        activeTab = MainTab.Review,
        onHome = onHome,
        onLearn = onLearn,
        onPractice = onPractice,
        onReview = {},
        onMe = onMe,
        tabletContentMode = TabletMainContentMode.FillAvailableHeight,
    ) {
        val firstMistake = review.groups.firstNotNullOfOrNull { it.mistakes.firstOrNull() }
        val primaryFocus = review.reviewCenter?.primaryFocus
        var expandedGroupIds by remember(review) { mutableStateOf<Set<String>>(emptySet()) }
        val toggleGroupExpansion: (ReviewGroup) -> Unit = { group ->
            expandedGroupIds = if (group.kpId in expandedGroupIds) {
                expandedGroupIds - group.kpId
            } else {
                expandedGroupIds + group.kpId
            }
        }
        if (LocalPhonePresentation.current) {
            PhoneReviewNotebookContent(review, onMistake)
        } else {
            TabletReviewNotebookContent(
                review = review,
                firstMistake = firstMistake,
                primaryFocus = primaryFocus,
                expandedGroupIds = expandedGroupIds,
                onToggleGroupExpansion = toggleGroupExpansion,
                onMistake = onMistake,
                onHome = onHome,
            )
        }
    }
}

@Composable
private fun TabletReviewNotebookContent(
    review: ReviewData,
    firstMistake: ReviewMistake?,
    primaryFocus: ReviewErrorGroup?,
    expandedGroupIds: Set<String>,
    onToggleGroupExpansion: (ReviewGroup) -> Unit,
    onMistake: (ReviewMistake) -> Unit,
    onHome: () -> Unit,
) {
    val policy = reviewNotebookTabletPolicy()
    val webPolicy = reviewNotebookTabletWebLayoutPolicy()
    Column(modifier = Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        TabletLearningPageHeader(
            title = webPolicy.headerTitle,
            onHome = onHome,
        )
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            horizontalArrangement = Arrangement.spacedBy(LearningLayoutSpec.PaneGap),
        ) {
            TabletReviewControlPanel(
                modifier = Modifier
                    .width(tabletLearningSidebarWidth())
                    .fillMaxHeight(),
                review = review,
                primaryFocus = primaryFocus,
                firstMistake = firstMistake,
                onMistake = onMistake,
            )
            TabletReviewMistakePoolPanel(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight(),
                review = review,
                maxMistakesPerGroup = policy.maxMistakesPerGroup,
                expandedGroupIds = expandedGroupIds,
                onToggleGroupExpansion = onToggleGroupExpansion,
                onMistake = onMistake,
            )
        }
    }
}

@Composable
private fun TabletReviewControlPanel(
    modifier: Modifier = Modifier,
    review: ReviewData,
    primaryFocus: ReviewErrorGroup?,
    firstMistake: ReviewMistake?,
    onMistake: (ReviewMistake) -> Unit,
) {
    val progress = if (review.totalCount <= 0) 0 else (review.reviewedCount * 100 / review.totalCount).coerceIn(0, 100)
    Column(
        modifier = modifier
            .background(Color.White, RoundedCornerShape(OpenPhysicsRadius.Large))
            .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Large))
            .clip(RoundedCornerShape(OpenPhysicsRadius.Large))
            .verticalScroll(rememberScrollState()),
    ) {
        Text(
            reviewNotebookTabletWebLayoutPolicy().controlPanelSections.first(),
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 18.dp, vertical = 16.dp),
            color = OpenPhysicsColors.Ink,
            style = androidx.compose.material3.MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
        )
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .border(1.dp, OpenPhysicsColors.Divider)
                .padding(horizontal = 18.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SectionTitle("本轮重点")
            TabletReviewPrioritySummary(primaryFocus = primaryFocus, firstMistake = firstMistake, onMistake = onMistake)
            TabletReviewStatsGrid(
                pending = review.reviewCenter?.totalPending ?: review.pendingCount,
                reviewed = review.reviewedCount,
                progress = progress,
                errorTypes = review.reviewCenter?.errorGroups?.size ?: 0,
            )
        }
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 18.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SectionTitle("复盘流程")
            TabletReviewPathSteps()
        }
    }
}

@Composable
private fun TabletReviewPrioritySummary(
    primaryFocus: ReviewErrorGroup?,
    firstMistake: ReviewMistake?,
    onMistake: (ReviewMistake) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(OpenPhysicsColors.SurfaceSoft, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .clickable(enabled = firstMistake != null) { firstMistake?.let(onMistake) }
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = primaryFocus?.errorName ?: "暂无集中错因",
                modifier = Modifier.weight(1f),
                color = OpenPhysicsColors.Ink,
                style = androidx.compose.material3.MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
            StatusChip(if (primaryFocus != null) "优先处理" else "待开始", tone = OpenPhysicsTone.Primary)
        }
        MutedText(
            primaryFocus?.let {
                "${it.count} 道错题集中在这一类，先从这里开始清理。"
            } ?: "先选择一道错题开始复盘。",
        )
    }
}

@Composable
private fun TabletReviewStatsGrid(
    pending: Int,
    reviewed: Int,
    progress: Int,
    errorTypes: Int,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ReviewControlStat("待复盘", "$pending", Modifier.weight(1f))
            ReviewControlStat("已清除", "$reviewed", Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ReviewControlStat("清零进度", "$progress%", Modifier.weight(1f))
            ReviewControlStat("错因类型", "$errorTypes", Modifier.weight(1f))
        }
    }
}

@Composable
private fun ReviewControlStat(label: String, value: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .background(OpenPhysicsColors.SurfaceSoft, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .padding(horizontal = 10.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(value, color = OpenPhysicsColors.PrimaryDeep, style = androidx.compose.material3.MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text(label, color = OpenPhysicsColors.Muted, style = androidx.compose.material3.MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun TabletReviewPathSteps() {
    val steps = listOf("发现错题", "定位错因", "修正解法", "变式确认", "清除错题")
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        steps.forEachIndexed { index, step ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(30.dp)
                        .background(OpenPhysicsColors.PrimarySoft, RoundedCornerShape(999.dp))
                        .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(999.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("${index + 1}", color = OpenPhysicsColors.PrimaryDeep, style = androidx.compose.material3.MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                }
                Text(step, color = OpenPhysicsColors.Ink, style = androidx.compose.material3.MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun TabletReviewMistakePoolPanel(
    modifier: Modifier = Modifier,
    review: ReviewData,
    maxMistakesPerGroup: Int,
    expandedGroupIds: Set<String>,
    onToggleGroupExpansion: (ReviewGroup) -> Unit,
    onMistake: (ReviewMistake) -> Unit,
) {
    Column(
        modifier = modifier
            .background(Color.White, RoundedCornerShape(OpenPhysicsRadius.Large))
            .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Large))
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            "待复盘错题",
            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
            color = OpenPhysicsColors.Ink,
            style = androidx.compose.material3.MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
        )
        if (review.groups.isEmpty()) {
            TabletReviewEmptyState()
        } else {
            ReviewNotebookPaneWebView(
                review = review,
                maxMistakesPerGroup = maxMistakesPerGroup,
                onMistake = onMistake,
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
            )
        }
    }
}

@Composable
private fun TabletReviewEmptyState() {
    LearningCard(
        meta = "复盘完成",
        title = "当前没有待复盘错题",
        subtitle = "继续同步学习或巩固提升，新的薄弱点会自动进入这里。",
    ) {
        MutedText("错题复盘会按知识点和错因聚合需要处理的问题。")
    }
}



@Composable
fun HistoryDetailScreen(
    record: AnswerHistoryRecord,
    onBack: () -> Unit,
    onOpenReview: (AnswerHistoryRecord) -> Unit,
    studentToken: String = "",
) {
    if (LocalPhonePresentation.current) {
        PhoneRecordDetail("练习记录", record.toPracticeQuestion(), record.givenAnswer,
            cn.openphysics.androidapp.domain.SubmitResult(record.id, record.isCorrect, record.correctAnswer, record.explanation, "",
                givenAnswer = record.givenAnswer, processGrading = phoneRecordGrading(record.processGrading, record.answerImages),
                correctAnswerRendered = record.correctAnswerRendered, explanationRendered = record.explanationRendered),
            onBack, if (record.isCorrect) "" else "去错题复盘",
            { if (record.isCorrect) onBack() else onOpenReview(record) }, studentToken, record.lessonVideo)
        return
    }
    TabletHistoryDetailContent(
        studentToken = studentToken,
        record = record,
        onBack = onBack,
        onOpenReview = onOpenReview,
    )
}

@Composable
private fun TabletHistoryDetailContent(
    record: AnswerHistoryRecord,
    onBack: () -> Unit,
    onOpenReview: (AnswerHistoryRecord) -> Unit,
    studentToken: String = "",
) {
    val policy = historyDetailTabletWebLayoutPolicy()
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(OpenPhysicsColors.Background)
            .verticalScroll(rememberScrollState())
            .padding(OpenPhysicsSpacing.PageHorizontal),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        LearningCard(
            meta = "练习记录",
            title = if (record.isCorrect) "本题作答正确" else "本题需要订正",
            subtitle = record.kpNames.joinToString(" · "),
            trailing = {
                StatusChip(
                    if (record.isCorrect) "正确" else "需订正",
                    tone = if (record.isCorrect) OpenPhysicsTone.Success else OpenPhysicsTone.Warning,
                )
            },
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                StatusChip(questionTypeLabel(record.questionType), tone = OpenPhysicsTone.Neutral)
                if (record.answerImages.isNotEmpty()) StatusChip("有作答图", tone = OpenPhysicsTone.Primary)
                MetaText(displayTime(record.createdAt))
            }
        }
        LearningCard(
            title = policy.headerTitle,
            subtitle = "按网页学生端练习记录组织，完整查看题目、作答、答案和解析。",
        ) {
            QuestionLessonVideoAction(studentToken, record.questionId, record.id, record.lessonVideo)
            HistoryQuestionPanePanel(record)
            HistoryAnswerCompareSection(record)
            ReviewSectionBox(title = "解析") {
                if (record.explanation.isBlank()) {
                    MutedText("暂无解析。")
                } else {
                    RecordRenderedOrFallbackText(
                        text = record.explanation,
                        rendered = record.explanationRendered,
                    )
                }
            }
            if (!record.isCorrect) {
                PrimaryActionButton(
                    text = policy.wrongRecordPrimaryAction,
                    onClick = { onOpenReview(record) },
                    modifier = Modifier.width(172.dp),
                )
            } else {
                PrimaryActionButton(
                    text = "返回练习记录",
                    onClick = onBack,
                    modifier = Modifier.width(144.dp),
                )
            }
        }
    }
}

@Composable
fun ReviewDetailScreen(
    mistake: ReviewMistake,
    chatMessages: List<TutorChatMessage>,
    retryMessage: String = "",
    onBack: () -> Unit,
    onAskTutor: (String) -> Unit,
    onStartRetry: () -> Unit,
    studentToken: String = "",
    requestState: TutorRequestState = TutorRequestState(),
) {
    if (LocalPhonePresentation.current) {
        PhoneRecordDetail("错题详情", mistake.toPracticeQuestion(), mistake.givenAnswer, phoneMistakeResult(mistake),
            onBack, reviewDetailPrimaryActionLabel(), onStartRetry, studentToken, mistake.lessonVideo,
            chatMessages, requestState, onAskTutor, retryMessage)
        return
    }
    TabletReviewDetailContent(
        studentToken = studentToken,
        mistake = mistake,
        chatMessages = chatMessages,
        retryMessage = retryMessage,
        onBack = onBack,
        onAskTutor = onAskTutor,
        onStartRetry = onStartRetry,
        requestState = requestState,
    )
}

@Composable
private fun TabletReviewDetailContent(
    mistake: ReviewMistake,
    chatMessages: List<TutorChatMessage>,
    retryMessage: String,
    onBack: () -> Unit,
    onAskTutor: (String) -> Unit,
    onStartRetry: () -> Unit,
    studentToken: String = "",
    requestState: TutorRequestState = TutorRequestState(),
) {
    val layoutPolicy = reviewDetailTabletWebLayoutPolicy()
    val focusManager = LocalFocusManager.current
    var tutorOpen by remember(mistake.answerId) { mutableStateOf(false) }
    var tutorInput by remember(mistake.answerId) { mutableStateOf("") }
    var tutorError by remember(mistake.answerId) { mutableStateOf("") }

    fun submitTutorQuestion(text: String) {
        val trimmed = text.trim()
        if (trimmed.isBlank()) {
            tutorError = "请先写下你想问的问题"
            return
        }
        tutorError = ""
        tutorInput = ""
        onAskTutor(trimmed)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(OpenPhysicsColors.Background)
            .padding(OpenPhysicsSpacing.PageHorizontal),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        TabletReviewSingleHeader(
            policy = layoutPolicy,
            onBack = onBack,
            onOpenTutor = {
                if (tutorOpen) focusManager.clearFocus()
                tutorOpen = !tutorOpen
            },
            onStartRetry = onStartRetry,
        )
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .fillMaxHeight()
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                QuestionLessonVideoAction(studentToken, mistake.questionId, mistake.answerId, mistake.lessonVideo)
                ReviewSingleQuestionCard(
                    mistake = mistake,
                )
                if (layoutPolicy.retryMessageCardBelowQuestionCard && retryMessage.isNotBlank()) {
                    LearningCard(title = reviewRetryPracticePresentationPolicy().pageTitle) {
                        MutedText(retryMessage)
                        SecondaryActionButton("重新获取变式题", onStartRetry)
                    }
                }
            }
            if (tutorOpen) {
                TutorAssistantPanel(
                    policy = reviewTutorAssistantPolicy(),
                    chatMessages = chatMessages,
                    requestState = requestState,
                    input = tutorInput,
                    error = tutorError,
                    onInputChange = {
                        tutorInput = it
                        tutorError = ""
                    },
                    onSubmit = ::submitTutorQuestion,
                    onDismiss = { tutorOpen = false },
                    reserveTriggerSpace = false,
                )
            }
        }
    }
}

@Composable
private fun TabletReviewSingleHeader(
    policy: ReviewDetailTabletWebLayoutPolicy,
    onBack: () -> Unit,
    onOpenTutor: () -> Unit,
    onStartRetry: () -> Unit,
) {
    // iPad 错题详情: back, title, then the page actions in the bar instead of floating over the question.
    TabletDetailTitleBar(title = policy.headerTitle, onBack = onBack) {
        TabletBarAction(policy.sideActions[0], onOpenTutor, primary = false, symbol = PhoneSymbol.Sparkle)
        TabletBarAction(policy.sideActions[1], onStartRetry, primary = true)
    }
}

@Composable
private fun ReviewSingleQuestionCard(
    mistake: ReviewMistake,
) {
    val panePolicy = reviewDetailQuestionPanePolicy()
    ReviewMistakeDetailPaneWebView(
        mistake = mistake,
        minimumHeightDp = panePolicy.minimumHeightDp,
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(OpenPhysicsRadius.Large)),
    )
}

@Composable
private fun HistoryQuestionPanePanel(
    record: AnswerHistoryRecord,
    minHeightDp: Int = 520,
    maxHeightDp: Int = 760,
) {
    QuestionPanel(
        title = "题目",
        subtitle = record.kpNames.joinToString(" · "),
        chipText = questionTypeLabel(record.questionType),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            StatusChip(
                if (record.isCorrect) "正确" else "需订正",
                tone = if (record.isCorrect) OpenPhysicsTone.Success else OpenPhysicsTone.Warning,
            )
            if (record.answerImages.isNotEmpty()) StatusChip("有作答图", tone = OpenPhysicsTone.Primary)
            MetaText(displayTime(record.createdAt))
        }
        ReadOnlyQuestionWebView(
            question = record.toPracticeQuestion(),
            answer = record.givenAnswer,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = minHeightDp.dp, max = maxHeightDp.dp),
        )
    }
}

@Composable
private fun HistoryAnswerCompareSection(record: AnswerHistoryRecord) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ReviewSectionBox(
            modifier = Modifier
                .weight(1f)
                .fillMaxHeight(),
            title = "我的作答",
            titleColor = if (record.isCorrect) Color(0xFF389E0D) else Color(0xFFCF1322),
            background = if (record.isCorrect) Color(0xFFF6FFED) else Color(0xFFFFF2F0),
            border = if (record.isCorrect) Color(0xFFB7EB8F) else Color(0xFFFFCCC7),
        ) {
            AnswerText(answerTextForDisplay(record.givenAnswer, record.answerImages.isNotEmpty()).ifBlank { "未作答" })
            AnswerImages(record.answerImages)
        }
        ReviewSectionBox(
            modifier = Modifier
                .weight(1f)
                .fillMaxHeight(),
            title = "正确答案",
            titleColor = Color(0xFF389E0D),
            background = Color(0xFFF6FFED),
            border = Color(0xFFB7EB8F),
        ) {
            RecordRenderedOrFallbackText(
                text = record.correctAnswer.ifBlank { "暂无" },
                rendered = record.correctAnswerRendered,
            )
        }
    }
}

@Composable
private fun ReviewSectionBox(
    modifier: Modifier = Modifier,
    title: String,
    titleColor: Color = OpenPhysicsColors.Ink,
    background: Color = Color.White,
    border: Color = OpenPhysicsColors.Border,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(background, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .border(1.dp, border, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (title.isNotBlank()) {
            Text(title, color = titleColor, style = androidx.compose.material3.MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
        }
        content()
    }
}

private fun ReviewMistake.toPracticeQuestion(): PracticeQuestion {
    return PracticeQuestion(
        id = questionId,
        stem = stemText,
        questionType = questionType,
        options = options,
        images = images,
        stemRendered = stemRendered,
        correctAnswerRendered = correctAnswerRendered,
        explanationRendered = explanationRendered,
    )
}

private fun AnswerHistoryRecord.toPracticeQuestion(): PracticeQuestion {
    return PracticeQuestion(
        id = questionId,
        stem = stemText,
        questionType = questionType,
        options = options,
        images = images,
        correctAnswer = correctAnswer,
        explanation = explanation,
        stemRendered = stemRendered,
        correctAnswerRendered = correctAnswerRendered,
        explanationRendered = explanationRendered,
    )
}

@Composable
private fun GradingCheckRow(label: String, value: Boolean?) {
    val text = when (value) {
        true -> "正确"
        false -> "需修正"
        null -> "未判断"
    }
    val color = when (value) {
        true -> OpenPhysicsColors.Success
        false -> OpenPhysicsColors.Danger
        null -> OpenPhysicsColors.Muted
    }
    Text(
        "$label：$text",
        color = color,
        fontWeight = FontWeight.Normal,
        style = androidx.compose.material3.MaterialTheme.typography.bodyMedium,
    )
}

@Composable
private fun StepScoreText(step: ProcessStepScore) {
    val score = if (step.score % 1.0 == 0.0) step.score.toInt().toString() else step.score.toString()
    val max = if (step.maxScore % 1.0 == 0.0) step.maxScore.toInt().toString() else step.maxScore.toString()
    val comment = if (step.comment.isBlank()) "" else "：${step.comment}"
    MutedText("${step.name} $score/$max$comment")
}

private fun confidenceLabel(value: String): String {
    return when (value) {
        "high" -> "置信度高"
        "medium" -> "置信度中"
        "low" -> "置信度低"
        else -> "置信度$value"
    }
}

internal fun reviewAllMistakes(review: ReviewData): List<ReviewMistake> {
    return review.groups.flatMap { it.mistakes }
}

internal fun reviewVisibleMistakes(group: ReviewGroup, expanded: Boolean, limit: Int): List<ReviewMistake> {
    if (expanded) return group.mistakes
    return group.mistakes.take(limit.coerceAtLeast(0))
}

private fun answerTextForDisplay(answer: String, hasAnswerImages: Boolean): String {
    val trimmed = cleanText(answer)
    if (hasAnswerImages && Regex("^\\s*\\[(图片|图片作答|手写图片|手写过程|整套纸笔照片)\\]\\s*$").matches(trimmed)) {
        return ""
    }
    return trimmed
}

@Composable
private fun RecordRenderedOrFallbackText(
    text: String,
    rendered: RenderedRichContent?,
    compact: Boolean = false,
) {
    val decision = decideRichContentDisplay(text, rendered)
    if (decision.path == RichContentRenderPath.PreRenderedKatexHtml) {
        RenderedRichText(rendered = rendered!!, compact = compact)
    } else {
        PhysicsRichText(text, compact = compact)
    }
}

@Composable
private fun AnswerText(text: String, compact: Boolean = false) {
    PhysicsRichText(text, compact = compact)
}

@Composable
private fun AnswerImages(images: List<QuestionImage>) {
    if (images.isEmpty()) return
    SectionTitle("学生作答图片")
    QuestionImageList(images)
}

private fun displayTime(raw: String): String {
    if (raw.length < 16) return raw
    return raw
        .replace("T", " ")
        .substring(0, 16)
}
