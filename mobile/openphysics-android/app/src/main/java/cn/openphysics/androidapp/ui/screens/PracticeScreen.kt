package cn.openphysics.androidapp.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import cn.openphysics.androidapp.domain.QuestionImage
import cn.openphysics.androidapp.domain.PracticeQuestion
import cn.openphysics.androidapp.domain.PracticeSelfReviewDraft
import cn.openphysics.androidapp.domain.PracticeSelfReviewItem
import cn.openphysics.androidapp.domain.PracticeSessionTypes
import cn.openphysics.androidapp.domain.ProcessGrading
import cn.openphysics.androidapp.domain.SubmitResult
import cn.openphysics.androidapp.domain.ProcessStepScore
import cn.openphysics.androidapp.domain.RenderedRichContent
import cn.openphysics.androidapp.ui.draft.DraftCanvasSnapshot
import cn.openphysics.androidapp.ui.draft.hasAnswerInk
import cn.openphysics.androidapp.ui.draft.DraftWorkspaceAction
import cn.openphysics.androidapp.ui.draft.DraftBackgroundImage
import cn.openphysics.androidapp.ui.components.BottomActionBar
import cn.openphysics.androidapp.ui.components.LearningCard
import cn.openphysics.androidapp.ui.components.PrimaryActionButton
import cn.openphysics.androidapp.ui.components.QuestionPanel
import cn.openphysics.androidapp.ui.components.SecondaryActionButton
import cn.openphysics.androidapp.ui.components.SectionHeader
import cn.openphysics.androidapp.ui.components.StatusChip
import cn.openphysics.androidapp.ui.design.OpenPhysicsColors
import cn.openphysics.androidapp.ui.design.OpenPhysicsRadius
import cn.openphysics.androidapp.ui.design.OpenPhysicsTone
import cn.openphysics.androidapp.ui.design.tonePalette
import cn.openphysics.androidapp.ui.PracticeReview
import cn.openphysics.androidapp.ui.PracticeReviewItem
import cn.openphysics.androidapp.ui.PracticePaperBatchImage
import cn.openphysics.androidapp.ui.PracticeSetSubmissionState
import cn.openphysics.androidapp.ui.PracticeSubmissionPhase
import cn.openphysics.androidapp.ui.PracticeSubmissionSourceSummary
import cn.openphysics.androidapp.ui.ReinforcementPracticeContext
import cn.openphysics.androidapp.ui.Screen
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

private object TabletPracticeColors {
    val inactiveQuestionNumber = Color(0xFFE2E8F0)
}

internal object MobilePhotoAnswerCopy {
    const val Title = "拍照上传作答"
    const val Subtitle = "先保存本题作答，最后统一提交批改。"
    const val TakePhoto = "拍照"
    const val PickPhoto = "相册"
    const val SavePendingPhoto = "保存本题作答"
    const val SavedStatus = "本题作答已保存"
    const val SavedHint = "最后提交整套时会统一批改。"
}

internal data class PracticeNavigationSummary(
    val progressText: String,
    val currentText: String,
)

internal fun tabletPracticeNavigationSummary(
    index: Int,
    total: Int,
    answeredCount: Int,
): PracticeNavigationSummary {
    val safeTotal = total.coerceAtLeast(0)
    val completed = answeredCount.coerceIn(0, safeTotal)
    val current = (index + 1).coerceIn(1, safeTotal.coerceAtLeast(1))
    return PracticeNavigationSummary(
        progressText = "$completed/$safeTotal",
        currentText = "第 $current 题",
    )
}

enum class PracticeQuestionSubmitMode {
    Batch,
    FinalPhotoBatch,
    SingleQuestion,
}

enum class PracticeDraftSubmitBehavior {
    SaveForSetGrading,
    SubmitFinalPhotoBatch,
    SubmitCurrentQuestion,
}

enum class PracticeSelfReviewSubmitBehavior {
    SaveForSetGrading,
    SubmitCurrentQuestion,
}

internal fun practiceDraftSubmitBehavior(mode: PracticeQuestionSubmitMode): PracticeDraftSubmitBehavior = when (mode) {
    PracticeQuestionSubmitMode.Batch -> PracticeDraftSubmitBehavior.SaveForSetGrading
    PracticeQuestionSubmitMode.FinalPhotoBatch -> PracticeDraftSubmitBehavior.SubmitFinalPhotoBatch
    PracticeQuestionSubmitMode.SingleQuestion -> PracticeDraftSubmitBehavior.SubmitCurrentQuestion
}

internal fun practiceSelfReviewSubmitBehavior(
    mode: PracticeQuestionSubmitMode,
): PracticeSelfReviewSubmitBehavior = when (mode) {
    PracticeQuestionSubmitMode.Batch,
    PracticeQuestionSubmitMode.FinalPhotoBatch -> PracticeSelfReviewSubmitBehavior.SaveForSetGrading
    PracticeQuestionSubmitMode.SingleQuestion -> PracticeSelfReviewSubmitBehavior.SubmitCurrentQuestion
}

internal fun practiceSelfReviewActionLabel(mode: PracticeQuestionSubmitMode): String =
    when (practiceSelfReviewSubmitBehavior(mode)) {
        PracticeSelfReviewSubmitBehavior.SaveForSetGrading -> "保存自评"
        PracticeSelfReviewSubmitBehavior.SubmitCurrentQuestion -> "提交自评"
    }

internal fun dispatchPracticeSelfReviewAction(
    mode: PracticeQuestionSubmitMode,
    items: List<PracticeSelfReviewItem>,
    onSave: (List<PracticeSelfReviewItem>) -> Unit,
    onSubmit: (List<PracticeSelfReviewItem>) -> Unit,
) {
    when (practiceSelfReviewSubmitBehavior(mode)) {
        PracticeSelfReviewSubmitBehavior.SaveForSetGrading -> onSave(items)
        PracticeSelfReviewSubmitBehavior.SubmitCurrentQuestion -> onSubmit(items)
    }
}

internal enum class PracticeSingleQuestionSubmitPlacement {
    AnswerWorkspace,
    ChoicePrompt,
}

internal fun practiceSingleQuestionSubmitPlacement(isChoiceQuestion: Boolean): PracticeSingleQuestionSubmitPlacement =
    if (isChoiceQuestion) {
        PracticeSingleQuestionSubmitPlacement.ChoicePrompt
    } else {
        PracticeSingleQuestionSubmitPlacement.AnswerWorkspace
    }

internal data class PracticeSubmissionUiPolicy(
    val showsBatchNavigation: Boolean,
    val showsPaperBatchControls: Boolean,
    val showsStandaloneSelfReviewPanel: Boolean,
    val showsFooterSelfReviewTrigger: Boolean,
    val showsInlineSingleSubmit: Boolean,
    val showsQuestionJumpStrip: Boolean,
    val showsDraftSaveAction: Boolean,
    val submitButtonUsesFinalPhotoBatch: Boolean,
    val submitLabel: String,
)

internal fun practiceSubmissionUiPolicy(mode: PracticeQuestionSubmitMode): PracticeSubmissionUiPolicy = when (mode) {
    PracticeQuestionSubmitMode.Batch -> PracticeSubmissionUiPolicy(
        showsBatchNavigation = true,
        showsPaperBatchControls = true,
        showsStandaloneSelfReviewPanel = false,
        showsFooterSelfReviewTrigger = true,
        showsInlineSingleSubmit = false,
        showsQuestionJumpStrip = true,
        showsDraftSaveAction = false,
        submitButtonUsesFinalPhotoBatch = false,
        submitLabel = "",
    )
    PracticeQuestionSubmitMode.FinalPhotoBatch -> PracticeSubmissionUiPolicy(
        showsBatchNavigation = true,
        showsPaperBatchControls = true,
        showsStandaloneSelfReviewPanel = false,
        showsFooterSelfReviewTrigger = true,
        showsInlineSingleSubmit = false,
        showsQuestionJumpStrip = true,
        showsDraftSaveAction = false,
        submitButtonUsesFinalPhotoBatch = true,
        submitLabel = "提交批改",
    )
    PracticeQuestionSubmitMode.SingleQuestion -> PracticeSubmissionUiPolicy(
        showsBatchNavigation = false,
        showsPaperBatchControls = false,
        showsStandaloneSelfReviewPanel = false,
        showsFooterSelfReviewTrigger = true,
        showsInlineSingleSubmit = false,
        showsQuestionJumpStrip = false,
        showsDraftSaveAction = true,
        submitButtonUsesFinalPhotoBatch = false,
        submitLabel = "提交本题",
    )
}

internal fun practiceDraftCanvasActionLabel(mode: PracticeQuestionSubmitMode): String = when (practiceDraftSubmitBehavior(mode)) {
    PracticeDraftSubmitBehavior.SaveForSetGrading -> "保存本题作答"
    PracticeDraftSubmitBehavior.SubmitFinalPhotoBatch -> "提交批改"
    PracticeDraftSubmitBehavior.SubmitCurrentQuestion -> "提交本题作答"
}

enum class PracticeQuestionPresentationMode {
    Standard,
    UnitDiagnostic,
}

internal data class PracticeQuestionPresentationPolicy(
    val title: String,
    val progressPlacement: String,
    val questionNavPlacement: String,
    val showHeaderSubmit: Boolean,
    val showBottomBatchNavigation: Boolean,
    val submitLabel: String,
)

internal fun practiceQuestionPresentationPolicy(
    mode: PracticeQuestionPresentationMode,
): PracticeQuestionPresentationPolicy = when (mode) {
    PracticeQuestionPresentationMode.Standard -> PracticeQuestionPresentationPolicy(
        title = "",
        progressPlacement = "header",
        questionNavPlacement = "question_pane",
        showHeaderSubmit = true,
        showBottomBatchNavigation = false,
        submitLabel = "",
    )
    PracticeQuestionPresentationMode.UnitDiagnostic -> PracticeQuestionPresentationPolicy(
        title = "单元检测",
        progressPlacement = "header",
        questionNavPlacement = "question_pane",
        showHeaderSubmit = true,
        showBottomBatchNavigation = false,
        submitLabel = "提交批改",
    )
}

internal fun practiceQuestionJumpVisible(
    policy: PracticeQuestionPresentationPolicy,
    total: Int,
): Boolean = policy.questionNavPlacement == "question_pane" && total > 1

internal fun practiceHeaderSubmitVisible(
    policy: PracticeQuestionPresentationPolicy,
    submitMode: PracticeQuestionSubmitMode,
    isChoiceQuestion: Boolean,
): Boolean {
    if (!policy.showHeaderSubmit) return false
    if (submitMode == PracticeQuestionSubmitMode.SingleQuestion) return isChoiceQuestion
    if (submitMode == PracticeQuestionSubmitMode.FinalPhotoBatch) return true
    return !isChoiceQuestion || submitMode == PracticeQuestionSubmitMode.Batch
}

internal data class TabletPracticeHeaderPolicy(
    val backControl: String,
    val toolsPresentation: String,
    val toolsOverlayDoesNotConsumeLayoutHeight: Boolean,
    val actionHeightDp: Int,
    val toolButtonWidthDp: Int,
    val submitButtonWidthDp: Int,
    /** 打印试题 / 纸笔批改 were built for the web; like iPad, the tablet answers on screen. */
    val showsTools: Boolean = false,
)

internal fun tabletPracticeHeaderPolicy(): TabletPracticeHeaderPolicy = TabletPracticeHeaderPolicy(
    backControl = "home-circle",
    toolsPresentation = "floating-menu",
    toolsOverlayDoesNotConsumeLayoutHeight = true,
    actionHeightDp = 32,
    toolButtonWidthDp = 104,
    submitButtonWidthDp = 132,
)

internal fun practiceResultPrimaryActionLabel(
    isLastQuestion: Boolean,
    reinforcementContext: ReinforcementPracticeContext?,
    sessionType: String = "",
    openedFromSummary: Boolean = false,
): String = when {
    !isLastQuestion -> "下一题"
    openedFromSummary -> "返回练习总结"
    sessionType == PracticeSessionTypes.ReviewRetry -> "返回错题复盘页"
    reinforcementContext is ReinforcementPracticeContext.ScopeDiagnostic -> "查看检测结果"
    reinforcementContext is ReinforcementPracticeContext.Retest -> "查看复测结果"
    sessionType == PracticeSessionTypes.KpDiagnostic -> "评估结果"
    else -> "练习结果"
}

internal fun practiceResultCanCorrectGrading(result: SubmitResult): Boolean {
    return result.answerId != null && result.processGrading != null
}

internal data class PracticeResultNavigationState(
    val available: Boolean,
    val correct: Boolean?,
)

internal enum class PracticeResultNavigationTone {
    Correct,
    Wrong,
    Pending,
}

internal data class PracticeResultNavigationVisualState(
    val tone: PracticeResultNavigationTone,
    val showsCurrentOutline: Boolean,
)

internal fun practiceResultNavigationTone(
    state: PracticeResultNavigationState,
): PracticeResultNavigationTone = when (state.correct) {
    true -> PracticeResultNavigationTone.Correct
    false -> PracticeResultNavigationTone.Wrong
    null -> PracticeResultNavigationTone.Pending
}

internal fun practiceResultNavigationVisualState(
    state: PracticeResultNavigationState,
    active: Boolean,
): PracticeResultNavigationVisualState = PracticeResultNavigationVisualState(
    tone = practiceResultNavigationTone(state),
    showsCurrentOutline = active,
)

internal fun practiceResultNavigationStates(
    questions: List<PracticeQuestion>,
    review: PracticeReview,
): List<PracticeResultNavigationState> = questions.map { question ->
    val item = review.itemFor(question)
    PracticeResultNavigationState(
        available = item != null,
        correct = item?.result?.correct,
    )
}

internal fun practiceResultTutorAssistantPolicy(): TutorAssistantPolicy =
    reviewTutorAssistantPolicy().copy(
        triggerPlacement = TutorAssistantTriggerPlacement(
            initialYOffsetPx = -132,
            minYOffsetPx = -1080,
            maxYOffsetPx = -84,
        ),
    )

internal fun practiceDiagnosticToolLabels(showPaperBatch: Boolean): List<String> = listOf(
    "打印试题",
    if (showPaperBatch) "收起纸笔批改" else "纸笔批改",
)

internal fun practicePaperBatchActionLabels(hasSelection: Boolean): List<String> =
    if (hasSelection) listOf("选择照片", "清空", "开始纸笔批改") else listOf("选择照片")

internal const val PRACTICE_PAPER_BATCH_MAX_IMAGES = 6

internal fun practicePaperBatchSelectionMessage(
    selectedCount: Int,
    originalCount: Int,
): String {
    val ignoredCount = (originalCount - selectedCount).coerceAtLeast(0)
    return if (ignoredCount > 0) {
        "已选择前 $selectedCount 张，已忽略多选的 $ignoredCount 张，最多上传 $PRACTICE_PAPER_BATCH_MAX_IMAGES 张"
    } else {
        "已选择 $selectedCount 张，最多上传 $PRACTICE_PAPER_BATCH_MAX_IMAGES 张"
    }
}

internal fun buildPracticeSelfReviewItems(question: PracticeQuestion): List<PracticeSelfReviewItem> {
    val source = "${question.correctAnswer}\n${question.stem}"
    val labels = Regex("""\(\s*\d+\s*\)""")
        .findAll(source)
        .map { it.value.replace(Regex("""\s+"""), "") }
        .distinct()
        .toList()
    return (labels.ifEmpty { listOf("整题") }).map { label ->
        PracticeSelfReviewItem(label = label, status = "")
    }
}

internal data class PracticeSelfReviewInlineLayoutPolicy(
    val maxHeightDp: Int,
    val showCollapseAction: Boolean,
)

internal fun practiceSelfReviewInlineLayoutPolicy(): PracticeSelfReviewInlineLayoutPolicy =
    PracticeSelfReviewInlineLayoutPolicy(
        maxHeightDp = 320,
        showCollapseAction = true,
    )

internal fun practiceSelfReviewComplete(items: List<PracticeSelfReviewItem>): Boolean =
    items.isNotEmpty() && items.all { it.status.isNotBlank() }

internal fun canPracticeSelfReviewQuestion(question: PracticeQuestion): Boolean {
    val rawType = question.questionType.trim()
    val normalizedType = rawType.lowercase()
        .replace("-", "_")
        .replace(" ", "_")
    if (question.isChoice()) return false
    if (
        normalizedType.contains("choice") ||
        rawType.contains("选择") ||
        rawType.contains("单选") ||
        rawType.contains("多选")
    ) {
        return false
    }
    return true
}

internal enum class PracticeWrittenAnswerActionsLayout {
    Hidden,
    SingleRow,
    Stacked,
}

internal fun practiceWrittenAnswerActionsLayout(
    layoutMode: PracticeLayoutMode,
    isChoiceQuestion: Boolean,
): PracticeWrittenAnswerActionsLayout = when {
    isChoiceQuestion -> PracticeWrittenAnswerActionsLayout.Hidden
    layoutMode == PracticeLayoutMode.TabletWorkbench -> PracticeWrittenAnswerActionsLayout.SingleRow
    else -> PracticeWrittenAnswerActionsLayout.Stacked
}

@Composable
fun PracticeQuestionScreen(
    question: PracticeQuestion,
    index: Int,
    total: Int,
    preloadQuestions: List<PracticeQuestion> = listOf(question),
    draftAnswersByQuestionId: Map<String, String> = emptyMap(),
    draftAnswer: String,
    hasSavedPhoto: Boolean,
    savedPhotoFile: cn.openphysics.androidapp.domain.LocalImageFile? = null,
    onClearSavedPhoto: () -> Unit = {},
    selfReviewDraft: PracticeSelfReviewDraft? = null,
    initialDraftCanvasSnapshots: Map<String, DraftCanvasSnapshot> = emptyMap(),
    answeredIndexes: Set<Int>,
    answeredCount: Int,
    submissionState: PracticeSetSubmissionState = PracticeSetSubmissionState(),
    submissionSourceSummary: PracticeSubmissionSourceSummary = PracticeSubmissionSourceSummary(0, 0, 0, 0, total),
    pageTitle: String = "",
    guidanceText: String = "",
    submitMode: PracticeQuestionSubmitMode = PracticeQuestionSubmitMode.Batch,
    wholePaper: Boolean = false,
    presentationMode: PracticeQuestionPresentationMode = PracticeQuestionPresentationMode.Standard,
    submitLabel: String = "",
    submitConfirmTitle: String = "开始整套 AI 批改？",
    submitConfirmText: String = "批改会在后台进行，当前题页面会保持可见，完成后自动进入本次结果。",
    submitConfirmActionText: String = "开始AI批改",
    onBack: () -> Unit,
    onDraftAnswerChange: (String, String) -> Unit,
    onSavePhoto: (ByteArray, String) -> Unit,
    onSaveHandwriting: (ByteArray, String) -> Unit,
    onSaveScratchImage: (ByteArray?, String) -> Unit,
    onDraftCanvasSnapshotChange: (String, DraftCanvasSnapshot) -> Unit = { _, _ -> },
    onSaveSelfReview: (List<PracticeSelfReviewItem>) -> Unit = {},
    onSubmitSelfReview: (List<PracticeSelfReviewItem>) -> Unit = {},
    onPrintSet: () -> Unit = {},
    initialPaperBatchImages: List<PracticePaperBatchImage> = emptyList(),
    onPreparePaperBatchImage: (ByteArray, String, String) -> PracticePaperBatchImage = { _, _, _ ->
        error("Paper batch image storage is unavailable")
    },
    onPaperBatchImagesChange: (List<PracticePaperBatchImage>) -> Unit = {},
    onSubmitPaperBatch: (List<PracticePaperBatchImage>) -> Unit = {},
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onQuestionSelect: (Int) -> Unit,
    onSubmitSet: () -> Unit,
    answerEditingLocked: Boolean = false,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val layoutMode = if (isTabletLayout()) PracticeLayoutMode.TabletWorkbench else PracticeLayoutMode.PortraitFlow
    var answer by remember(question.id, draftAnswer) { mutableStateOf(draftAnswer) }
    var error by remember(question.id) { mutableStateOf("") }
    var pendingCameraPath by rememberSaveable(question.id) { mutableStateOf<String?>(null) }
    var pendingPhoto by remember(question.id) { mutableStateOf<PreparedAnswerPhoto?>(null) }
    var preparingPhoto by remember(question.id) { mutableStateOf(false) }
    var savedPhoto by remember(question.id, hasSavedPhoto) { mutableStateOf(hasSavedPhoto) }
    // The photo just saved here, until the stored draft is read back; then the stored file.
    var savedPhotoPreview by remember(question.id) { mutableStateOf<android.graphics.Bitmap?>(null) }
    val storedPhotoBitmap = rememberPhoneAnswerBitmap(savedPhotoFile)
    val viewableSavedPhoto = if (savedPhoto) savedPhotoPreview ?: storedPhotoBitmap else null
    var viewingSavedPhoto by remember(question.id) { mutableStateOf(false) }
    var croppingPhoto by remember(question.id) { mutableStateOf(false) }
    val selfReviewItems = remember(question.id, question.correctAnswer, question.stem) {
        buildPracticeSelfReviewItems(question)
    }
    var selfReviewStatuses by remember(question.id, selfReviewDraft, selfReviewItems) {
        mutableStateOf(
            selfReviewItems.associate { item ->
                item.label to (selfReviewDraft?.items?.firstOrNull { it.label == item.label }?.status.orEmpty())
            },
        )
    }
    var selfReviewSaved by remember(question.id, selfReviewDraft) {
        mutableStateOf(selfReviewDraft?.items?.isNotEmpty() == true)
    }
    var showFooterSelfReview by remember(question.id) { mutableStateOf(false) }
    val submitPolicy = practiceSubmissionUiPolicy(submitMode)
    val selfReviewSubmitBehavior = practiceSelfReviewSubmitBehavior(submitMode)
    val presentationPolicy = practiceQuestionPresentationPolicy(presentationMode)
    val effectiveSubmitLabel = submitLabel.ifBlank { submitPolicy.submitLabel }
    val effectivePageTitle = pageTitle.ifBlank { presentationPolicy.title.ifBlank { "做题" } }
    val effectiveGuidanceText = guidanceText.trim()
    val effectiveHeaderSubmitLabel = effectiveSubmitLabel.ifBlank { presentationPolicy.submitLabel.ifBlank { "提交批改" } }
    val canSelfReview = canPracticeSelfReviewQuestion(question)
    var showSubmitSetConfirm by remember { mutableStateOf(false) }
    var exportCurrentScratchImage by remember(question.id) { mutableStateOf<(() -> Unit)?>(null) }
    val draftSnapshotScope = preloadQuestions.map { it.id }
    val draftSnapshots = remember(draftSnapshotScope) {
        mutableStateMapOf<String, DraftCanvasSnapshot>().apply {
            putAll(initialDraftCanvasSnapshots)
        }
    }
    val promptImageForDraft = stemImages(question).firstOrNull()
    val promptBitmapForDraft = rememberQuestionBitmap(promptImageForDraft)
    var showPromptImageInDraft by remember(question.id) {
        mutableStateOf(initialDraftCanvasSnapshots[question.id]?.backgroundImage != null)
    }
    var diagnosticToolsExpanded by remember(question.id) { mutableStateOf(false) }
    var paperUploadExpanded by remember(question.id) { mutableStateOf(false) }
    var paperBatchExpanded by remember(question.id) { mutableStateOf(false) }
    var paperBatchImages by remember(initialPaperBatchImages) { mutableStateOf(initialPaperBatchImages) }
    var paperBatchOriginalSelectedCount by remember { mutableIntStateOf(0) }
    var paperBatchError by remember { mutableStateOf("") }
    val requestSubmitSet = {
        if (!submissionState.submitting) {
            when {
                preparingPhoto -> { error = "正在处理照片，请稍候再提交。" }
                pendingPhoto != null -> { error = "请先确认并保存预览中的答案图片，再提交整套作答。" }
                submitPolicy.submitButtonUsesFinalPhotoBatch -> {
                    showSubmitSetConfirm = true
                }
                submitMode == PracticeQuestionSubmitMode.SingleQuestion -> {
                    exportCurrentScratchImage?.invoke()
                    onSubmitSet()
                }
                else -> {
                    showSubmitSetConfirm = true
                }
            }
        }
    }
    val confirmSubmitSet = {
        showSubmitSetConfirm = false
        if (paperBatchImages.isNotEmpty()) {
            onSubmitPaperBatch(paperBatchImages)
        } else {
            onSubmitSet()
        }
    }
    val activePromptBitmapForDraft = if (showPromptImageInDraft) promptBitmapForDraft else null
    val activePromptImageMetadata = if (activePromptBitmapForDraft != null && promptImageForDraft != null) {
        DraftBackgroundImage(
            imagePath = promptImageForDraft.imagePath,
            description = promptImageForDraft.description,
            naturalWidth = activePromptBitmapForDraft.width,
            naturalHeight = activePromptBitmapForDraft.height,
            x = 0f,
            y = 0f,
            scale = 1f,
        )
    } else {
        null
    }

    fun preparePhoto(bytes: ByteArray) {
        preparingPhoto = true
        error = ""
        scope.launch {
            try {
                pendingPhoto = withContext(Dispatchers.Default) { prepareAnswerPhoto(bytes) }
            } catch (_: Exception) {
                error = "图片无法预览，请重新拍照或选择清晰图片"
            } finally {
                preparingPhoto = false
            }
        }
    }

    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val mimeType = runCatching { context.contentResolver.getType(uri) }.getOrNull().orEmpty().ifBlank { "image/jpeg" }
        if (!mimeType.startsWith("image/")) {
            error = "请选择图片文件"
            return@rememberLauncherForActivityResult
        }
        val bytes = try {
            context.contentResolver.openInputStream(uri)?.use { readUploadImageBytesWithLimit(it) }
        } catch (_: UploadImageTooLargeException) {
            error = "图片过大，请选择 12MB 以内的清晰图片"
            return@rememberLauncherForActivityResult
        } catch (_: Exception) {
            error = "图片读取失败，请重新选择图片"
            return@rememberLauncherForActivityResult
        }
        if (bytes == null || bytes.isEmpty()) {
            error = "图片读取失败，请重试"
            return@rememberLauncherForActivityResult
        }
        preparePhoto(bytes)
    }
    val cameraCapture = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { captured ->
        val file = pendingCameraPath?.let(::File)
        pendingCameraPath = null
        if (!captured || file == null || !file.exists() || file.length() == 0L) {
            file?.delete()
            if (captured) error = "拍照失败，请重试"
            return@rememberLauncherForActivityResult
        }
        val bytes = try {
            file.inputStream().use { readUploadImageBytesWithLimit(it) }
        } catch (_: UploadImageTooLargeException) {
            error = "图片过大，请重新拍摄或裁剪后提交"
            return@rememberLauncherForActivityResult
        } catch (_: Exception) {
            error = "照片读取失败，请重新拍照"
            return@rememberLauncherForActivityResult
        } finally {
            file.delete()
        }
        preparePhoto(bytes)
    }
    val paperBatchPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        scope.launch {
            val originalCount = uris.size
            var oversizedCount = 0
            val images = withContext(Dispatchers.IO) {
                uris.take(PRACTICE_PAPER_BATCH_MAX_IMAGES).mapIndexedNotNull { index, uri ->
                    val sourceMimeType = runCatching { context.contentResolver.getType(uri) }.getOrNull().orEmpty().ifBlank { "image/jpeg" }
                    if (!sourceMimeType.startsWith("image/")) return@mapIndexedNotNull null
                    val bytes = try {
                        context.contentResolver.openInputStream(uri)?.use { readUploadImageBytesWithLimit(it) }
                    } catch (_: UploadImageTooLargeException) {
                        oversizedCount += 1
                        null
                    } catch (_: Exception) {
                        null
                    }
                    if (bytes == null || bytes.isEmpty()) return@mapIndexedNotNull null
                    val prepared = runCatching { prepareAnswerPhoto(bytes) }.getOrNull()
                        ?: return@mapIndexedNotNull null
                    try {
                        onPreparePaperBatchImage(
                            prepared.bytes,
                            prepared.mimeType,
                            "paper-page-${index + 1}.jpg",
                        )
                    } catch (_: Exception) {
                        null
                    } finally {
                        prepared.previewBitmap.recycle()
                    }
                }
            }
            if (images.isEmpty()) {
                paperBatchError = "请选择清晰的图片文件"
            } else {
                paperBatchImages = images
                onPaperBatchImagesChange(images)
                paperBatchOriginalSelectedCount = originalCount
                paperBatchError = if (oversizedCount > 0) {
                    "已忽略 $oversizedCount 张超过 12MB 的图片"
                } else {
                    ""
                }
            }
        }
    }

    fun updateAnswer(questionId: String, next: String) {
        if (submissionState.submitting || answerEditingLocked) return
        if (questionId !in draftSnapshotScope) return
        if (questionId == question.id) {
            answer = next
        }
        onDraftAnswerChange(questionId, next)
    }

    fun takeAnswerPhoto() {
        runCatching {
            val file = createAnswerPhotoFile(context.cacheDir, question.id)
            pendingCameraPath = file.absolutePath
            val uri = FileProvider.getUriForFile(context, answerPhotoAuthority(context.packageName), file)
            cameraCapture.launch(uri)
        }.onFailure {
            pendingCameraPath?.let { File(it).delete() }
            pendingCameraPath = null
            error = "无法打开相机，请检查系统相机是否可用"
        }
    }

    fun completedSelfReviewItems(): List<PracticeSelfReviewItem> =
        selfReviewItems.map { item ->
            item.copy(status = selfReviewStatuses[item.label].orEmpty())
        }

    fun submitSelfReview() {
        if (!practiceSelfReviewComplete(completedSelfReviewItems())) {
            error = "请先完成每一小问的自评"
            return
        }
        val items = completedSelfReviewItems()
        dispatchPracticeSelfReviewAction(
            mode = submitMode,
            items = items,
            onSave = onSaveSelfReview,
            onSubmit = onSubmitSelfReview,
        )
        selfReviewSaved = selfReviewSubmitBehavior == PracticeSelfReviewSubmitBehavior.SaveForSetGrading
        error = ""
    }

    val hasCanvasAnswer = !question.isChoice() && draftSnapshots[question.id]?.hasAnswerInk() == true
    val selfReviewComplete = practiceSelfReviewComplete(completedSelfReviewItems())
    val hasSelfReviewSelection = selfReviewStatuses.values.any { it.isNotBlank() }
    val questionPaneLearningState = buildQuestionPaneLearningState(
        isChoiceQuestion = question.isChoice(),
        answer = answer,
        hasSavedPhoto = savedPhoto || hasCanvasAnswer,
        hasPendingPhoto = pendingPhoto != null,
        hasSelfReviewSelection = hasSelfReviewSelection,
        selfReviewComplete = selfReviewComplete,
        canSelfReview = canSelfReview,
        submissionState = submissionState,
    )
    val questionPaneVisibleLearningState = questionPaneVisibleLearningState(
        canSelfReview = canSelfReview,
        learningState = questionPaneLearningState,
    )
    val currentOriginallyAnswered = index in answeredIndexes
    val currentAnswered = answer.isNotBlank() || savedPhoto || hasCanvasAnswer || selfReviewDraft != null
    val visibleAnsweredCount = when {
        currentAnswered && !currentOriginallyAnswered -> answeredCount + 1
        !currentAnswered && currentOriginallyAnswered -> answeredCount - 1
        else -> answeredCount
    }.coerceIn(0, total)
    val singleSubmitPlacement = if (submitMode == PracticeQuestionSubmitMode.SingleQuestion) {
        practiceSingleQuestionSubmitPlacement(question.isChoice())
    } else {
        null
    }
    val showHeaderSubmit = practiceHeaderSubmitVisible(
        policy = presentationPolicy,
        submitMode = submitMode,
        isChoiceQuestion = question.isChoice(),
    )
    val showChoicePromptSubmit = singleSubmitPlacement == PracticeSingleQuestionSubmitPlacement.ChoicePrompt

    val promptContent: @Composable ColumnScope.() -> Unit = {
        if (layoutMode == PracticeLayoutMode.TabletWorkbench) {
            if (practiceQuestionJumpVisible(presentationPolicy, total)) {
                QuestionJumpStrip(
                    total = total,
                    currentIndex = index,
                    answeredIndexes = answeredIndexes,
                    onQuestionSelect = onQuestionSelect,
                    compact = true,
                )
            }
            TabletQuestionReadPane(
                question = question,
                index = index,
                total = total,
                answer = answer,
                learningState = questionPaneVisibleLearningState,
                interactionLocked = submissionState.submitting || answerEditingLocked,
                onAnswerChange = ::updateAnswer,
                modifier = Modifier.fillMaxWidth().weight(1f),
            )
        } else {
            QuestionPrompt(
                question = question,
                index = index,
                total = total,
                answer = answer,
                answeredIndexes = answeredIndexes,
                onQuestionSelect = onQuestionSelect,
                onAnswerChange = ::updateAnswer,
                showQuestionJumpStrip = submitPolicy.showsQuestionJumpStrip,
                interactionLocked = submissionState.submitting || answerEditingLocked,
                inlineSubmitLabel = if (showChoicePromptSubmit) {
                    if (submissionState.submitting) "提交中" else effectiveSubmitLabel
                } else {
                    ""
                },
                inlineSubmitEnabled = currentAnswered && !submissionState.submitting,
                onInlineSubmit = if (showChoicePromptSubmit) requestSubmitSet else null,
            )
        }
    }
    val answerContent: @Composable ColumnScope.() -> Unit = {
        val writtenActionsLayout = practiceWrittenAnswerActionsLayout(
            layoutMode = layoutMode,
            isChoiceQuestion = question.isChoice(),
        )
        val paperAnswerControls: (@Composable ColumnScope.() -> Unit)? =
            if (!question.isChoice() && (submitPolicy.showsDraftSaveAction || submitPolicy.submitButtonUsesFinalPhotoBatch)) {
                val savePendingPhoto = {
                    val photo = pendingPhoto
                    if (photo == null) {
                        error = "请先拍照或选择作答图片"
                    } else {
                        try {
                            onSavePhoto(photo.bytes, photo.mimeType)
                            savedPhotoPreview = photo.previewBitmap
                            pendingPhoto = null
                            savedPhoto = true
                            error = ""
                            if (submitMode == PracticeQuestionSubmitMode.SingleQuestion) requestSubmitSet()
                        } catch (_: Exception) {
                            error = "照片保存失败，请检查设备剩余空间后重试"
                        }
                    }
                }
                {
                    AnswerControls(
                        error = error,
                        pendingPhoto = pendingPhoto,
                        preparingPhoto = preparingPhoto,
                        hasSavedPhoto = savedPhoto,
                        onTakePhoto = ::takeAnswerPhoto,
                        onPickPhoto = { imagePicker.launch("image/*") },
                        onClearPhoto = { pendingPhoto = null },
                        onRotatePhotoLeft = {
                            pendingPhoto?.let { pendingPhoto = rotatePreparedAnswerPhoto(it, -90f) }
                        },
                        onRotatePhotoRight = {
                            pendingPhoto?.let { pendingPhoto = rotatePreparedAnswerPhoto(it, 90f) }
                        },
                        onCropPhoto = { if (pendingPhoto != null) croppingPhoto = true },
                        onViewSavedPhoto = viewableSavedPhoto?.let { { viewingSavedPhoto = true } },
                        tabletWorkbench = layoutMode == PracticeLayoutMode.TabletWorkbench,
                        onSavePhoto = savePendingPhoto,
                    )
                }
            } else {
                null
            }
        if (layoutMode == PracticeLayoutMode.TabletWorkbench) {
            TabletDraftWorkspace(
                questionId = question.id,
                snapshots = draftSnapshots,
                answer = answer,
                isChoice = question.isChoice(),
                modifier = Modifier.fillMaxWidth().weight(1f),
                hasImageBackground = activePromptBitmapForDraft != null,
                backgroundBitmap = activePromptBitmapForDraft,
                backgroundImageMetadata = activePromptImageMetadata,
                imageToggleAvailable = promptBitmapForDraft != null,
                imageEnabled = activePromptBitmapForDraft != null,
                onToggleImage = { showPromptImageInDraft = !showPromptImageInDraft },
                showSaveBelowCanvas = !question.isChoice() && submitPolicy.showsDraftSaveAction,
                saveActionLabel = practiceDraftCanvasActionLabel(submitMode),
                belowCanvasActionContent = if (writtenActionsLayout == PracticeWrittenAnswerActionsLayout.SingleRow) {
                    {
                        if (submitPolicy.showsFooterSelfReviewTrigger && canSelfReview) {
                            DraftWorkspaceAction(
                                text = "解析自评",
                                onClick = { showFooterSelfReview = !showFooterSelfReview },
                            )
                        }
                        if (paperAnswerControls != null) {
                            DraftWorkspaceAction(
                                text = "上传解答",
                                onClick = { paperUploadExpanded = true },
                            )
                        }
                    }
                } else {
                    null
                },
                onSaveAsAnswer = if (question.isChoice() || !submitPolicy.showsDraftSaveAction) null else { bytes, mimeType ->
                    onSaveHandwriting(bytes, mimeType)
                    savedPhotoPreview = null
                    savedPhoto = true
                    error = ""
                    if (submitMode == PracticeQuestionSubmitMode.SingleQuestion) {
                        requestSubmitSet()
                    }
                },
                onScratchImageChange = if (question.isChoice()) onSaveScratchImage else null,
                onScratchImageExporterChange = if (question.isChoice()) {
                    { exporter -> exportCurrentScratchImage = exporter }
                } else {
                    null
                },
                onSnapshotChange = { snapshot ->
                    onDraftCanvasSnapshotChange(question.id, snapshot)
                },
            )
        }
        if (
            !question.isChoice() &&
            canSelfReview &&
            submitPolicy.showsFooterSelfReviewTrigger &&
            showFooterSelfReview &&
            !submissionState.submitting && !answerEditingLocked &&
            layoutMode == PracticeLayoutMode.TabletWorkbench
        ) {
            TabletPracticeActionDialog(onDismiss = { showFooterSelfReview = false }) {
                PracticeSelfReviewInlineBody(
                    question = question,
                    itemStatuses = selfReviewStatuses,
                    submitText = practiceSelfReviewActionLabel(submitMode),
                    submitEnabled = selfReviewComplete,
                    savedForSetGrading = selfReviewSaved &&
                        selfReviewSubmitBehavior == PracticeSelfReviewSubmitBehavior.SaveForSetGrading,
                    onCollapse = { showFooterSelfReview = false },
                    onSelect = { label, status ->
                        selfReviewStatuses = selfReviewStatuses + (label to status)
                        selfReviewSaved = false
                        error = ""
                    },
                    onSubmit = ::submitSelfReview,
                    collapseLabel = "关闭",
                )
            }
        }
        if (writtenActionsLayout == PracticeWrittenAnswerActionsLayout.SingleRow && paperUploadExpanded && paperAnswerControls != null && !submissionState.submitting && !answerEditingLocked) {
            TabletPracticeActionDialog(onDismiss = { paperUploadExpanded = false }) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("拍照上传纸面解答", modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                    TextButton(onClick = { paperUploadExpanded = false }) { Text("关闭") }
                }
                paperAnswerControls()
            }
        }
        if (writtenActionsLayout == PracticeWrittenAnswerActionsLayout.Stacked && paperAnswerControls != null) {
            MobilePhotoAnswerPanel(
                error = error,
                pendingPhoto = pendingPhoto,
                preparingPhoto = preparingPhoto,
                hasSavedPhoto = savedPhoto,
                onTakePhoto = ::takeAnswerPhoto,
                onPickPhoto = { imagePicker.launch("image/*") },
                onClearPhoto = { pendingPhoto = null },
                onRotatePhotoLeft = {
                    pendingPhoto?.let { pendingPhoto = rotatePreparedAnswerPhoto(it, -90f) }
                },
                onRotatePhotoRight = {
                    pendingPhoto?.let { pendingPhoto = rotatePreparedAnswerPhoto(it, 90f) }
                },
                onCropPhoto = { if (pendingPhoto != null) croppingPhoto = true },
                onViewSavedPhoto = viewableSavedPhoto?.let { { viewingSavedPhoto = true } },
                onSavePhoto = {
                    val photo = pendingPhoto
                    if (photo == null) {
                        error = "请先拍照或选择作答图片"
                    } else {
                        try {
                            onSavePhoto(photo.bytes, photo.mimeType)
                            savedPhotoPreview = photo.previewBitmap
                            pendingPhoto = null
                            savedPhoto = true
                            error = ""
                            if (submitMode == PracticeQuestionSubmitMode.SingleQuestion) requestSubmitSet()
                        } catch (_: Exception) {
                            error = "照片保存失败，请检查设备剩余空间后重试"
                        }
                    }
                },
            )
        }
        if (
            !question.isChoice() &&
            canSelfReview &&
            submitPolicy.showsFooterSelfReviewTrigger &&
            layoutMode != PracticeLayoutMode.TabletWorkbench
        ) {
            SecondaryActionButton(
                text = "对照解析自评",
                onClick = { showFooterSelfReview = !showFooterSelfReview },
                modifier = Modifier.fillMaxWidth(),
            )
            if (showFooterSelfReview) {
                PracticeSelfReviewInlineBody(
                    question = question,
                    itemStatuses = selfReviewStatuses,
                    submitText = practiceSelfReviewActionLabel(submitMode),
                    submitEnabled = selfReviewComplete,
                    savedForSetGrading = selfReviewSaved &&
                        selfReviewSubmitBehavior == PracticeSelfReviewSubmitBehavior.SaveForSetGrading,
                    onCollapse = { showFooterSelfReview = false },
                    onSelect = { label, status ->
                        selfReviewStatuses = selfReviewStatuses + (label to status)
                        selfReviewSaved = false
                        error = ""
                    },
                    onSubmit = ::submitSelfReview,
                )
            }
        }
        if (submitPolicy.showsPaperBatchControls && paperBatchExpanded) {
            val batchControls: @Composable ColumnScope.() -> Unit = {
                PracticePaperBatchControls(
                    selectedCount = paperBatchImages.size,
                    originalSelectedCount = paperBatchOriginalSelectedCount,
                    error = paperBatchError,
                    onPickImages = { paperBatchPicker.launch("image/*") },
                    onClearImages = {
                        paperBatchImages = emptyList()
                        onPaperBatchImagesChange(emptyList())
                        paperBatchOriginalSelectedCount = 0
                        paperBatchError = ""
                    },
                    onSubmit = {
                        if (paperBatchImages.isEmpty()) {
                            paperBatchError = "请先选择整套纸笔作答照片"
                        } else {
                            onSubmitPaperBatch(paperBatchImages)
                        }
                    },
                )
            }
            if (layoutMode == PracticeLayoutMode.TabletWorkbench) {
                if (!submissionState.submitting && !answerEditingLocked) {
                    TabletPracticeActionDialog(onDismiss = { paperBatchExpanded = false }) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                            TextButton(onClick = { paperBatchExpanded = false }) { Text("关闭") }
                        }
                        batchControls()
                    }
                }
            } else {
                batchControls()
            }
        }
        if (!question.isChoice() && canSelfReview && submitPolicy.showsStandaloneSelfReviewPanel) {
            PracticeSelfReviewControls(
                question = question,
                itemStatuses = selfReviewStatuses,
                saveEnabled = selfReviewComplete,
                onSelect = { label, status ->
                    selfReviewStatuses = selfReviewStatuses + (label to status)
                    error = ""
                },
                onSave = {
                    if (selfReviewComplete) {
                        answer = "[自评作答]"
                        onSaveSelfReview(completedSelfReviewItems())
                    } else {
                        error = "请先完成每一小问的自评"
                    }
                },
            )
        }
        if (submitPolicy.showsInlineSingleSubmit && question.isChoice()) {
            PracticeSetSubmissionNotice(submissionState)
            PrimaryActionButton(
                text = if (submissionState.submitting) "提交中" else effectiveSubmitLabel,
                onClick = requestSubmitSet,
                enabled = currentAnswered && !submissionState.submitting,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (layoutMode != PracticeLayoutMode.TabletWorkbench && submitPolicy.showsBatchNavigation) {
            PracticeSetSubmissionNotice(submissionState)
            PracticeNavigationControls(
                index = index,
                total = total,
                answeredCount = visibleAnsweredCount,
                onPrevious = onPrevious,
                onNext = onNext,
                onSubmitSet = requestSubmitSet,
                submissionState = submissionState,
                submitLabel = effectiveSubmitLabel,
            )
        } else if (submitPolicy.showsInlineSingleSubmit && !question.isChoice()) {
            PracticeSetSubmissionNotice(submissionState)
        }
    }

    if (LocalPhonePresentation.current) {
        PhonePracticeContent(
            question = question,
            index = index,
            total = total,
            title = effectivePageTitle,
            guidance = effectiveGuidanceText,
            answer = answer,
            currentAnswered = currentAnswered,
            answeredIndexes = if (currentAnswered) answeredIndexes + index else answeredIndexes - index,
            singleQuestion = submitMode == PracticeQuestionSubmitMode.SingleQuestion,
            locked = submissionState.submitting || answerEditingLocked,
            pendingPhoto = pendingPhoto,
            preparingPhoto = preparingPhoto,
            savedPhoto = savedPhotoFile,
            selfReviewSaved = selfReviewDraft != null,
            error = error,
            canSelfReview = canSelfReview,
            onBack = onBack,
            onAnswerChange = ::updateAnswer,
            onPrevious = onPrevious,
            onNext = onNext,
            onQuestionSelect = onQuestionSelect,
            onSubmit = requestSubmitSet,
            onTakePhoto = ::takeAnswerPhoto,
            onPickPhoto = { imagePicker.launch("image/*") },
            onCancelPhoto = { pendingPhoto = null },
            onRetakePhoto = { pendingPhoto = null; takeAnswerPhoto() },
            onRotatePhoto = { pendingPhoto?.let { pendingPhoto = rotatePreparedAnswerPhoto(it, 90f) } },
            onCropPhoto = { if (pendingPhoto != null) croppingPhoto = true },
            onSavePhoto = {
                pendingPhoto?.let { photo ->
                    try {
                        onSavePhoto(photo.bytes, photo.mimeType)
                        savedPhotoPreview = photo.previewBitmap
                        pendingPhoto = null
                        savedPhoto = true
                        error = ""
                        if (submitMode == PracticeQuestionSubmitMode.SingleQuestion) requestSubmitSet()
                    } catch (_: Exception) {
                        error = "照片保存失败，请检查设备剩余空间后重试"
                    }
                }
            },
            onRemovePhoto = { onClearSavedPhoto(); savedPhoto = false; savedPhotoPreview = null },
            selfReviewContent = { close ->
                PracticeSelfReviewInlineBody(
                    question = question,
                    itemStatuses = selfReviewStatuses,
                    submitText = practiceSelfReviewActionLabel(submitMode),
                    submitEnabled = selfReviewComplete,
                    savedForSetGrading = selfReviewSaved &&
                        selfReviewSubmitBehavior == PracticeSelfReviewSubmitBehavior.SaveForSetGrading,
                    onCollapse = close,
                    onSelect = { label, status ->
                        selfReviewStatuses = selfReviewStatuses + (label to status)
                        selfReviewSaved = false
                        error = ""
                    },
                    onSubmit = { submitSelfReview(); if (selfReviewComplete) close() },
                )
            },
            paperBatchCount = paperBatchImages.size,
            paperBatchContent = if (submitPolicy.showsPaperBatchControls) {
                { close ->
                    PracticePaperBatchControls(
                        selectedCount = paperBatchImages.size,
                        originalSelectedCount = paperBatchOriginalSelectedCount,
                        error = paperBatchError,
                        onPickImages = { paperBatchPicker.launch("image/*") },
                        onClearImages = {
                            paperBatchImages = emptyList()
                            onPaperBatchImagesChange(emptyList())
                            paperBatchOriginalSelectedCount = 0
                            paperBatchError = ""
                        },
                        onSubmit = {
                            if (paperBatchImages.isEmpty()) paperBatchError = "请先选择整套纸笔作答照片"
                            else { close(); requestSubmitSet() }
                        },
                    )
                }
            } else null,
        )
    } else if (layoutMode == PracticeLayoutMode.TabletWorkbench) {
        val promptWeight = if (question.isChoice()) 0.45f else 0.42f
        val answerWeight = if (question.isChoice()) 0.55f else 0.58f
        TabletPracticeQuestionScreen(
            topContent = if (presentationPolicy.progressPlacement == "header") {
                {
                    TabletPracticeDiagnosticHeader(
                        title = effectivePageTitle,
                        subtitle = effectiveGuidanceText,
                        answeredCount = visibleAnsweredCount,
                        total = total,
                        submitting = submissionState.submitting,
                        submitLabel = effectiveHeaderSubmitLabel,
                        showSubmit = showHeaderSubmit,
                        submitEnabled = !submissionState.submitting &&
                            (currentAnswered || submitMode != PracticeQuestionSubmitMode.SingleQuestion),
                        toolsExpanded = diagnosticToolsExpanded,
                        paperBatchExpanded = paperBatchExpanded,
                        onBack = onBack,
                        onTools = { diagnosticToolsExpanded = !diagnosticToolsExpanded },
                        onDismissTools = { diagnosticToolsExpanded = false },
                        onPrintSet = {
                            diagnosticToolsExpanded = false
                            onPrintSet()
                        },
                        onTogglePaperBatch = {
                            val nextExpanded = !paperBatchExpanded
                            paperBatchExpanded = nextExpanded
                            diagnosticToolsExpanded = false
                            if (nextExpanded) {
                                paperBatchError = ""
                            }
                        },
                        onSubmit = requestSubmitSet,
                    )
                }
            } else {
                null
            },
            promptContent = promptContent,
            answerContent = { PracticeSubmissionInputLock(submissionState.submitting || answerEditingLocked, answerContent) },
            bottomContent = if (submitPolicy.showsBatchNavigation && presentationPolicy.showBottomBatchNavigation) {
                {
                    PracticeSetSubmissionNotice(submissionState)
                    TabletPracticeNavigationControls(
                        index = index,
                        total = total,
                        answeredCount = visibleAnsweredCount,
                        onPrevious = onPrevious,
                        onNext = onNext,
                        onSubmitSet = requestSubmitSet,
                        submissionState = submissionState,
                        submitLabel = effectiveSubmitLabel,
                    )
                }
            } else {
                null
            },
            promptWeight = promptWeight,
            answerWeight = answerWeight,
            promptScrollable = false,
        )
    } else {
        val pageScrollState = rememberScrollState()
        LaunchedEffect(question.id) { pageScrollState.scrollTo(0) }
        Page(scrollState = pageScrollState) {
            Column(
                modifier = Modifier.practiceSwipe(index, total, onPrevious, onNext),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (effectiveGuidanceText.isNotBlank()) {
                    LearningCard(meta = "本题目标") {
                        MutedText(effectiveGuidanceText)
                    }
                }
                promptContent()
                LearningCard {
                    PracticeSubmissionInputLock(submissionState.submitting || answerEditingLocked, answerContent, spacing = 12.dp)
                }
            }
        }
    }
    PracticeGradingProgressDialog(submissionState, onRetry = {
        if (paperBatchImages.isNotEmpty()) onSubmitPaperBatch(paperBatchImages) else onSubmitSet()
    })
    pendingPhoto?.takeIf { croppingPhoto }?.let { photo ->
        AnswerPhotoCropDialog(photo.previewBitmap, onCancel = { croppingPhoto = false }) { crop ->
            pendingPhoto = cropPreparedAnswerPhoto(photo, crop)
            croppingPhoto = false
        }
    }
    viewableSavedPhoto?.takeIf { viewingSavedPhoto }?.let { bitmap ->
        ImagePreviewDialog(bitmap.asImageBitmap(), "已保存的完整作答图片", onDismiss = { viewingSavedPhoto = false })
    }
    if (showSubmitSetConfirm) {
        AlertDialog(
            onDismissRequest = { showSubmitSetConfirm = false },
            title = { Text(if (wholePaper) "确认提交整卷？" else submitConfirmTitle) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(submitConfirmText)
                    Text(
                        text = if (paperBatchImages.isNotEmpty()) "已选择 ${paperBatchImages.size} 张整卷作答照片，将按题号识别批改。" else submissionSourceSummary.displayText(),
                        color = OpenPhysicsColors.Muted,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    if (paperBatchImages.isEmpty()) {
                        val unanswered = (0 until total).filter { it !in answeredIndexes && !(it == index && currentAnswered) }
                        if (unanswered.isNotEmpty()) {
                            Text("未作答题号：${unanswered.joinToString("、") { (it + 1).toString() }}。确认提交后将按未作答记录。")
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = confirmSubmitSet) {
                    Text(if (wholePaper) "确认交卷并批改" else submitConfirmActionText)
                }
            },
            dismissButton = {
                TextButton(onClick = { showSubmitSetConfirm = false }) {
                    Text(if (wholePaper) "返回检查" else "暂不提交")
                }
            },
        )
    }
}

@Composable
internal fun PracticeGradingProgressDialog(state: PracticeSetSubmissionState, onRetry: () -> Unit) {
    var errorDismissed by remember(state.error, state.submitting) { mutableStateOf(false) }
    if (state.submitting) {
        Dialog(onDismissRequest = {}, properties = DialogProperties(
            dismissOnBackPress = false, dismissOnClickOutside = false, usePlatformDefaultWidth = false,
        )) {
            Surface(modifier = Modifier.padding(24.dp).widthIn(max = 360.dp).fillMaxWidth(),
                shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surface) {
                Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(modifier = Modifier.size(32.dp))
                    Text(when (state.phase) {
                        PracticeSubmissionPhase.PreparingImages -> "正在准备作答图片"
                        PracticeSubmissionPhase.Grading -> "AI 正在批改"
                        PracticeSubmissionPhase.Finalizing -> "正在保存检测结果"
                    }, style = MaterialTheme.typography.titleMedium)
                    if (state.phase == PracticeSubmissionPhase.Grading && state.total > 0) {
                        Text("已完成 ${state.completed}/${state.total} 题")
                        LinearProgressIndicator(progress = { state.completed.toFloat() / state.total }, modifier = Modifier.fillMaxWidth())
                    } else {
                        Text(if (state.phase == PracticeSubmissionPhase.PreparingImages) "正在整理每道题的手写作答，请稍候" else "正在整理本次结果，请稍候",
                            style = MaterialTheme.typography.bodyMedium, color = OpenPhysicsColors.Muted)
                    }
                }
            }
        }
    } else if (state.error == cn.openphysics.androidapp.ui.PracticeRecoveredMessage && !errorDismissed) {
        // Nothing was submitted, so nothing here may submit a half-finished practice.
        AlertDialog(onDismissRequest = { errorDismissed = true },
            title = { Text("已恢复练习") },
            text = { Text(state.error) },
            confirmButton = { TextButton(onClick = { errorDismissed = true }) { Text("继续作答") } },
        )
    } else if (state.error.isNotBlank() && !errorDismissed) {
        AlertDialog(onDismissRequest = { errorDismissed = true },
            title = { Text(if (state.phase == PracticeSubmissionPhase.Finalizing) "检测结果尚未保存" else "本次提交未完成") },
            text = { Text(state.error) },
            confirmButton = { TextButton(onClick = onRetry) { Text("重试未完成部分") } },
            dismissButton = { TextButton(onClick = { errorDismissed = true }) { Text("返回检查") } },
        )
    }
}

@Composable
private fun PracticeSubmissionInputLock(
    locked: Boolean,
    content: @Composable ColumnScope.() -> Unit,
    spacing: Dp = 8.dp,
) {
    Box(Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(spacing), content = content)
        if (locked) {
            Box(Modifier.matchParentSize().pointerInput(Unit) {
                awaitPointerEventScope {
                    while (true) awaitPointerEvent().changes.forEach { it.consume() }
                }
            })
        }
    }
}

// Tablet practice question

@Composable
private fun TabletQuestionReadPane(
    question: PracticeQuestion,
    index: Int,
    total: Int,
    answer: String,
    learningState: QuestionPaneLearningState?,
    onAnswerChange: (String, String) -> Unit,
    interactionLocked: Boolean = false,
    modifier: Modifier = Modifier,
) {
    LeftQuestionWebView(
        question = question,
        index = index,
        total = total,
        answer = answer,
        learningState = learningState,
        onAnswerChange = onAnswerChange,
        interactionLocked = interactionLocked,
        modifier = modifier,
    )
}

@Composable
private fun TabletPracticeActionDialog(
    onDismiss: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    val maxHeight = (LocalConfiguration.current.screenHeightDp - 64).coerceAtLeast(240).dp
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            modifier = Modifier.padding(16.dp).widthIn(max = 760.dp).fillMaxWidth()
                .heightIn(max = maxHeight)
                .background(OpenPhysicsColors.Surface, RoundedCornerShape(OpenPhysicsRadius.Large))
                .padding(12.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            content = content,
        )
    }
}

@Composable
private fun QuestionPrompt(
    question: PracticeQuestion,
    index: Int,
    total: Int,
    answer: String,
    answeredIndexes: Set<Int>,
    onQuestionSelect: (Int) -> Unit,
    onAnswerChange: (String, String) -> Unit,
    embeddedInPane: Boolean = false,
    showQuestionJumpStrip: Boolean = true,
    inlineSubmitLabel: String = "",
    inlineSubmitEnabled: Boolean = false,
    onInlineSubmit: (() -> Unit)? = null,
    interactionLocked: Boolean = false,
) {
    val paneContent: @Composable ColumnScope.() -> Unit = {
        if (showQuestionJumpStrip) {
            QuestionJumpStrip(
                total = total,
                currentIndex = index,
                answeredIndexes = answeredIndexes,
                onQuestionSelect = onQuestionSelect,
            )
        }
        LeftQuestionWebView(
            question = question,
            index = index,
            total = total,
            answer = answer,
            onAnswerChange = onAnswerChange,
            interactionLocked = interactionLocked,
            expandToContent = !embeddedInPane,
            modifier = if (embeddedInPane) {
                Modifier.fillMaxSize()
            } else {
                Modifier.fillMaxWidth()
            },
        )
        if (inlineSubmitLabel.isNotBlank() && onInlineSubmit != null && answer.isNotBlank()) {
            PrimaryActionButton(
                text = inlineSubmitLabel,
                onClick = onInlineSubmit,
                enabled = inlineSubmitEnabled,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
    if (embeddedInPane) {
        SectionHeader(title = "第 ${index + 1}/$total 题")
        Column(verticalArrangement = Arrangement.spacedBy(10.dp), content = paneContent)
    } else {
        QuestionPanel(title = "第 ${index + 1}/$total 题") {
            paneContent()
        }
    }
}

@Composable
private fun QuestionJumpStrip(
    total: Int,
    currentIndex: Int,
    answeredIndexes: Set<Int>,
    onQuestionSelect: (Int) -> Unit,
    compact: Boolean = false,
) {
    val scrollState = rememberScrollState()
    val density = androidx.compose.ui.platform.LocalDensity.current
    val chipWidth = 40.dp
    val chipGap = 4.dp
    LaunchedEffect(currentIndex, compact, scrollState.viewportSize) {
        if (compact) {
            val start = with(density) { ((chipWidth + chipGap) * currentIndex).roundToPx() }
            val end = start + with(density) { chipWidth.roundToPx() }
            if (start < scrollState.value) scrollState.animateScrollTo(start)
            else if (end > scrollState.value + scrollState.viewportSize) {
                scrollState.animateScrollTo((end - scrollState.viewportSize).coerceAtLeast(0))
            }
        }
    }
    Row(
        modifier = Modifier.fillMaxWidth().then(if (compact) Modifier.horizontalScroll(scrollState) else Modifier),
        horizontalArrangement = Arrangement.spacedBy(chipGap),
    ) {
        repeat(total) { index ->
            val active = index == currentIndex
            val answered = index in answeredIndexes
            val background = when {
                active -> OpenPhysicsColors.Primary
                answered -> OpenPhysicsColors.Success
                else -> TabletPracticeColors.inactiveQuestionNumber
            }
            val foreground = if (active || answered) OpenPhysicsColors.Surface else OpenPhysicsColors.Muted
            Box(
                modifier = Modifier
                    .then(if (compact) Modifier.size(chipWidth, 40.dp) else Modifier.weight(1f).heightIn(min = 30.dp))
                    .clickable { onQuestionSelect(index) },
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    modifier = Modifier.matchParentSize()
                        .then(if (compact) Modifier.padding(horizontal = 3.dp, vertical = 6.dp) else Modifier)
                        .background(background, RoundedCornerShape(6.dp)),
                )
                Text(
                    text = "${index + 1}",
                    color = foreground,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Normal,
                )
            }
        }
    }
}

@Composable
private fun ResultQuestionJumpStrip(
    states: List<PracticeResultNavigationState>,
    currentIndex: Int,
    onQuestionSelect: (Int) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        states.forEachIndexed { index, state ->
            val active = index == currentIndex
            val visualState = practiceResultNavigationVisualState(state, active)
            val shape = RoundedCornerShape(6.dp)
            val background = when (visualState.tone) {
                PracticeResultNavigationTone.Correct -> OpenPhysicsColors.Success
                PracticeResultNavigationTone.Wrong -> OpenPhysicsColors.Danger
                PracticeResultNavigationTone.Pending -> TabletPracticeColors.inactiveQuestionNumber
            }
            val foreground = if (state.available) OpenPhysicsColors.Surface else OpenPhysicsColors.Muted
            Box(
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = 30.dp)
                    .background(background, shape)
                    .then(
                        if (visualState.showsCurrentOutline) {
                            Modifier.border(2.dp, OpenPhysicsColors.PrimaryDeep, shape)
                        } else {
                            Modifier
                        },
                    )
                    .then(
                        if (state.available) {
                            Modifier.clickable { onQuestionSelect(index) }
                        } else {
                            Modifier
                        },
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = "${index + 1}",
                    color = foreground,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Normal,
                )
            }
        }
    }
}

private fun Modifier.practiceSwipe(
    index: Int,
    total: Int,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
): Modifier {
    return pointerInput(index, total) {
        var totalDrag = 0f
        detectHorizontalDragGestures(
            onDragStart = { totalDrag = 0f },
            onHorizontalDrag = { _, dragAmount ->
                totalDrag += dragAmount
            },
            onDragEnd = {
                when {
                    totalDrag < -90f && index + 1 < total -> onNext()
                    totalDrag > 90f && index > 0 -> onPrevious()
                }
                totalDrag = 0f
            },
            onDragCancel = { totalDrag = 0f },
        )
    }
}

@Composable
private fun AnswerControls(
    error: String,
    pendingPhoto: PreparedAnswerPhoto?,
    preparingPhoto: Boolean,
    hasSavedPhoto: Boolean,
    onTakePhoto: () -> Unit,
    onPickPhoto: () -> Unit,
    onClearPhoto: () -> Unit,
    onRotatePhotoLeft: () -> Unit,
    onRotatePhotoRight: () -> Unit,
    onCropPhoto: () -> Unit,
    tabletWorkbench: Boolean = false,
    onViewSavedPhoto: (() -> Unit)? = null,
    onSavePhoto: () -> Unit,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        PrimaryActionButton(
            if (tabletWorkbench) "拍摄纸面解答" else "拍照",
            onTakePhoto,
            modifier = Modifier.weight(1f),
        )
        SecondaryActionButton(
            if (tabletWorkbench) "选择作答图片" else "相册",
            onPickPhoto,
            modifier = Modifier.weight(1f),
        )
    }
    if (hasSavedPhoto) SavedAnswerPhotoStatus("图片已保存", onViewSavedPhoto)
    if (preparingPhoto) {
        MetaText("正在处理图片...")
    }
    pendingPhoto?.let { photo ->
        AnswerPhotoPreview(
            photo = photo,
            onRotateLeft = onRotatePhotoLeft,
            onRotateRight = onRotatePhotoRight,
            onCrop = onCropPhoto,
        )
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SecondaryActionButton("重拍", onClearPhoto, modifier = Modifier.weight(1f))
            PrimaryActionButton(if (tabletWorkbench) "保存答案图片" else "保存", onSavePhoto, modifier = Modifier.weight(1f))
        }
    }
    if (error.isNotBlank()) MutedText(error)
}

@Composable
private fun MobilePhotoAnswerPanel(
    error: String,
    pendingPhoto: PreparedAnswerPhoto?,
    preparingPhoto: Boolean,
    hasSavedPhoto: Boolean,
    onTakePhoto: () -> Unit,
    onPickPhoto: () -> Unit,
    onClearPhoto: () -> Unit,
    onRotatePhotoLeft: () -> Unit,
    onRotatePhotoRight: () -> Unit,
    onCropPhoto: () -> Unit,
    onViewSavedPhoto: (() -> Unit)? = null,
    onSavePhoto: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        SectionHeader(
            title = MobilePhotoAnswerCopy.Title,
            subtitle = MobilePhotoAnswerCopy.Subtitle,
        )
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PrimaryActionButton(
                MobilePhotoAnswerCopy.TakePhoto,
                onTakePhoto,
                modifier = Modifier.weight(1f),
            )
            SecondaryActionButton(
                MobilePhotoAnswerCopy.PickPhoto,
                onPickPhoto,
                modifier = Modifier.weight(1f),
            )
        }
        if (hasSavedPhoto && pendingPhoto == null) {
            SavedAnswerPhotoStatus(MobilePhotoAnswerCopy.SavedStatus, onViewSavedPhoto)
            MetaText(MobilePhotoAnswerCopy.SavedHint)
        }
        if (preparingPhoto) {
            MetaText("正在处理图片...")
        }
        pendingPhoto?.let { photo ->
            AnswerPhotoPreview(
                photo = photo,
                onRotateLeft = onRotatePhotoLeft,
                onRotateRight = onRotatePhotoRight,
                onCrop = onCropPhoto,
            )
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SecondaryActionButton("重拍", onClearPhoto, modifier = Modifier.weight(1f))
                PrimaryActionButton(
                    MobilePhotoAnswerCopy.SavePendingPhoto,
                    onSavePhoto,
                    modifier = Modifier.weight(1f),
                )
            }
        }
        if (error.isNotBlank()) MutedText(error)
    }
}

@Composable
private fun PracticeSetSubmissionNotice(submissionState: PracticeSetSubmissionState) {
    when {
        submissionState.submitting -> {
            val progress = if (submissionState.total > 0) {
                " ${submissionState.completed}/${submissionState.total}"
            } else {
                ""
            }
            StatusChip("AI 正在后台批改$progress，完成后自动进入结果", tone = OpenPhysicsTone.Primary)
        }
        submissionState.error.isNotBlank() -> MutedText(submissionState.error)
    }
}

@Composable
private fun PracticeSelfReviewControls(
    question: PracticeQuestion,
    itemStatuses: Map<String, String>,
    saveEnabled: Boolean,
    onSelect: (String, String) -> Unit,
    onSave: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(OpenPhysicsColors.SurfaceSoft, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        SectionHeader(title = "对照解析自评")
        SelfReviewSolutionPaneWebView(question = question, minimumHeightDp = 150)
        buildPracticeSelfReviewItems(question).forEach { item ->
            Text(
                text = item.label,
                color = OpenPhysicsColors.Ink,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Bold,
            )
            SelfReviewOptionRow(
                selectedStatus = itemStatuses[item.label].orEmpty(),
                onSelect = { status -> onSelect(item.label, status) },
            )
        }
        PrimaryActionButton("保存自评", onSave, modifier = Modifier.fillMaxWidth(), enabled = saveEnabled)
    }
}

@Composable
private fun PracticeSelfReviewInlineBody(
    question: PracticeQuestion,
    itemStatuses: Map<String, String>,
    submitText: String,
    submitEnabled: Boolean,
    savedForSetGrading: Boolean,
    onCollapse: () -> Unit,
    onSelect: (String, String) -> Unit,
    onSubmit: () -> Unit,
    collapseLabel: String = "收起",
) {
    if (LocalPhonePresentation.current) {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            Text("阅读解析后，逐项判断自己的作答。", style = MaterialTheme.typography.bodyMedium, color = PhoneColors.Muted)
            SelfReviewSolutionPaneWebView(question = question, minimumHeightDp = 150)
            buildPracticeSelfReviewItems(question).forEach { item ->
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(item.label, style = MaterialTheme.typography.titleMedium, color = PhoneColors.Ink)
                    selfReviewOptions().forEach { option ->
                        val selected = itemStatuses[item.label] == option.status
                        androidx.compose.material3.OutlinedButton(
                            onClick = { onSelect(item.label, option.status) },
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                            shape = RoundedCornerShape(12.dp),
                            border = androidx.compose.foundation.BorderStroke(1.dp, if (selected) PhoneColors.Primary else PhoneColors.Divider),
                            colors = ButtonDefaults.outlinedButtonColors(
                                containerColor = if (selected) PhoneColors.Soft else Color.White,
                                contentColor = if (selected) PhoneColors.Primary else PhoneColors.Ink,
                            ),
                        ) {
                            Text(option.label + if (selected) " ✓" else "", style = MaterialTheme.typography.labelLarge)
                        }
                    }
                }
            }
            PhoneAction(submitText, onSubmit, Modifier.fillMaxWidth(), enabled = submitEnabled)
            if (savedForSetGrading) Text("已保存，整套提交时会按自评记录入库。", color = PhoneColors.Primary,
                style = MaterialTheme.typography.bodyMedium)
        }
        return
    }
    val layoutPolicy = practiceSelfReviewInlineLayoutPolicy()
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(OpenPhysicsColors.SurfaceSoft, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        SectionHeader(
            title = "对照解析自评",
            actionText = if (layoutPolicy.showCollapseAction) collapseLabel else "",
            onAction = onCollapse,
        )
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = layoutPolicy.maxHeightDp.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            SelfReviewSolutionPaneWebView(question = question, minimumHeightDp = 150)
            buildPracticeSelfReviewItems(question).forEach { item ->
                Text(
                    text = item.label,
                    color = OpenPhysicsColors.Ink,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Bold,
                )
                SelfReviewOptionRow(
                    selectedStatus = itemStatuses[item.label].orEmpty(),
                    onSelect = { status -> onSelect(item.label, status) },
                )
            }
        }
        PrimaryActionButton(submitText, onSubmit, modifier = Modifier.fillMaxWidth(), enabled = submitEnabled)
        if (savedForSetGrading) {
            Text(
                text = "已保存，整套提交时会按自评记录入库。",
                color = OpenPhysicsColors.Success,
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
private fun PracticeRenderedOrFallbackText(
    text: String,
    rendered: RenderedRichContent?,
    modifier: Modifier = Modifier,
    compact: Boolean = true,
) {
    val decision = decideRichContentDisplay(text, rendered)
    if (decision.path == RichContentRenderPath.PreRenderedKatexHtml) {
        RenderedRichText(
            rendered = rendered!!,
            compact = compact,
            modifier = modifier,
        )
    } else {
        PhysicsRichText(text, compact = compact, modifier = modifier)
    }
}

private fun hasRenderedOrText(text: String, rendered: RenderedRichContent?): Boolean =
    text.isNotBlank() || decideRichContentDisplay(text, rendered).path == RichContentRenderPath.PreRenderedKatexHtml

@Composable
private fun SelfReviewOptionRow(
    selectedStatus: String,
    onSelect: (String) -> Unit,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        selfReviewOptions().forEach { option ->
            val selected = selectedStatus == option.status
            SecondaryActionButton(
                if (selected) "${option.label} ✓" else option.label,
                { onSelect(option.status) },
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun PracticePaperBatchControls(
    selectedCount: Int,
    originalSelectedCount: Int,
    error: String,
    onPickImages: () -> Unit,
    onClearImages: () -> Unit,
    onSubmit: () -> Unit,
) {
    val actionLabels = practicePaperBatchActionLabels(hasSelection = selectedCount > 0)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(OpenPhysicsColors.SurfaceSoft, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        SectionHeader(title = "纸笔批改")
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SecondaryActionButton(actionLabels.first(), onPickImages, modifier = Modifier.weight(1f))
        }
        if (selectedCount > 0) {
            StatusChip(
                practicePaperBatchSelectionMessage(
                    selectedCount = selectedCount,
                    originalCount = originalSelectedCount,
                ),
                tone = OpenPhysicsTone.Primary,
            )
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SecondaryActionButton(actionLabels[1], onClearImages, modifier = Modifier.weight(1f))
                PrimaryActionButton(actionLabels[2], onSubmit, modifier = Modifier.weight(1f))
            }
        }
        if (error.isNotBlank()) {
            MutedText(error)
        }
    }
}

private data class PracticeSelfReviewOption(val status: String, val label: String)

private fun selfReviewOptions(): List<PracticeSelfReviewOption> = listOf(
    PracticeSelfReviewOption("correct", "完全正确"),
    PracticeSelfReviewOption("partial", "部分正确"),
    PracticeSelfReviewOption("wrong", "不会"),
)

@Composable
private fun PracticeNavigationControls(
    index: Int,
    total: Int,
    answeredCount: Int,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onSubmitSet: () -> Unit,
    submissionState: PracticeSetSubmissionState,
    submitLabel: String = "",
) {
    val isLastQuestion = index + 1 >= total
    StatStrip {
        StatCell("已完成", "${answeredCount.coerceAtMost(total)}/$total")
        StatCell("当前", "${index + 1}")
        StatCell("剩余", "${(total - answeredCount).coerceAtLeast(0)}")
    }
    BottomActionBar(
        secondaryText = if (index > 0) "上一题" else "",
        onSecondary = if (index > 0) onPrevious else null,
        primaryText = when {
            !isLastQuestion -> "下一题"
            submissionState.submitting -> "AI批改中"
            submitLabel.isNotBlank() -> submitLabel
            else -> "提交评估"
        },
        primaryEnabled = !isLastQuestion || !submissionState.submitting,
        onPrimary = {
            if (!isLastQuestion) {
                onNext()
            } else if (!submissionState.submitting) {
                onSubmitSet()
            }
        },
    )
}

@Composable
private fun TabletPracticeNavigationControls(
    index: Int,
    total: Int,
    answeredCount: Int,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onSubmitSet: () -> Unit,
    submissionState: PracticeSetSubmissionState,
    submitLabel: String = "",
) {
    val summary = tabletPracticeNavigationSummary(index, total, answeredCount)
    val isLastQuestion = index + 1 >= total
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            modifier = Modifier
                .weight(0.44f)
                .background(OpenPhysicsColors.SurfaceSoft, RoundedCornerShape(OpenPhysicsRadius.Medium))
                .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Medium))
                .padding(horizontal = 12.dp, vertical = 9.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                summary.progressText,
                color = MaterialTheme.colorScheme.primary,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )
            Text(
                summary.currentText,
                color = OpenPhysicsColors.Muted,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Bold,
            )
        }
        Row(
            modifier = Modifier.weight(0.56f),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SecondaryActionButton(
                text = "上一题",
                onClick = onPrevious,
                enabled = index > 0,
                modifier = Modifier.weight(1f),
            )
            PrimaryActionButton(
                text = when {
                    !isLastQuestion -> "下一题"
                    submissionState.submitting -> "AI批改中"
                    submitLabel.isNotBlank() -> submitLabel
                    else -> "提交整套"
                },
                onClick = {
                    if (!isLastQuestion) {
                        onNext()
                    } else if (!submissionState.submitting) {
                        onSubmitSet()
                    }
                },
                enabled = !isLastQuestion || !submissionState.submitting,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun TabletPracticeDiagnosticHeader(
    title: String,
    subtitle: String,
    answeredCount: Int,
    total: Int,
    submitting: Boolean,
    submitLabel: String,
    showSubmit: Boolean = true,
    submitEnabled: Boolean,
    toolsExpanded: Boolean,
    paperBatchExpanded: Boolean,
    onBack: () -> Unit,
    onTools: () -> Unit,
    onDismissTools: () -> Unit,
    onPrintSet: () -> Unit,
    onTogglePaperBatch: () -> Unit,
    onSubmit: () -> Unit,
) {
    val headerPolicy = tabletPracticeHeaderPolicy()
    val toolLabels = practiceDiagnosticToolLabels(showPaperBatch = paperBatchExpanded)
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AndroidNativeBackButton(onClick = onBack)
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                text = if (subtitle.isBlank()) title else "$title · $subtitle",
                color = OpenPhysicsColors.Ink,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        StatusChip(
            text = "${answeredCount.coerceIn(0, total)}/$total",
            tone = OpenPhysicsTone.Neutral,
        )
        if (headerPolicy.showsTools) Box {
            TabletCompactActionButton(
                text = "工具",
                onClick = onTools,
                width = headerPolicy.toolButtonWidthDp.dp,
                height = headerPolicy.actionHeightDp.dp,
            )
            DropdownMenu(
                expanded = toolsExpanded && headerPolicy.toolsPresentation == "floating-menu",
                onDismissRequest = onDismissTools,
            ) {
                DropdownMenuItem(
                    text = { Text(toolLabels[0]) },
                    onClick = onPrintSet,
                )
                DropdownMenuItem(
                    text = { Text(toolLabels[1]) },
                    onClick = onTogglePaperBatch,
                )
            }
        }
        if (showSubmit) {
            TabletCompactActionButton(
                text = if (submitting) "AI批改中" else submitLabel,
                onClick = onSubmit,
                enabled = submitEnabled,
                primary = true,
                width = headerPolicy.submitButtonWidthDp.dp,
                height = headerPolicy.actionHeightDp.dp,
            )
        }
    }
}

/** The saved-photo status; with a photo to show, tapping 查看 opens it full screen, as on iOS. */
@Composable
private fun SavedAnswerPhotoStatus(label: String, onView: (() -> Unit)?) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        StatusChip(label, tone = OpenPhysicsTone.Success)
        if (onView != null) TextButton(onClick = onView) { Text("查看已保存的作答照片") }
    }
}

@Composable
private fun AnswerPhotoPreview(
    photo: PreparedAnswerPhoto,
    onRotateLeft: () -> Unit,
    onRotateRight: () -> Unit,
    onCrop: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        SectionTitle("预览")
        Image(
            bitmap = photo.previewBitmap.asImageBitmap(),
            contentDescription = "作答图片预览",
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = 280.dp)
                .background(OpenPhysicsColors.SurfaceSoft, RoundedCornerShape(OpenPhysicsRadius.Medium))
                .padding(5.dp),
            contentScale = ContentScale.Fit,
        )
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            androidx.compose.material3.OutlinedButton(onClick = onRotateLeft, modifier = Modifier.weight(1f)) {
                Text("左转")
            }
            androidx.compose.material3.OutlinedButton(onClick = onRotateRight, modifier = Modifier.weight(1f)) {
                Text("右转")
            }
            androidx.compose.material3.OutlinedButton(onClick = onCrop, modifier = Modifier.weight(1f)) {
                Text("裁剪")
            }
        }
    }
}

// Tablet practice result

@Composable
fun PracticeResultScreen(
    screen: Screen.PracticeResultScreen,
    review: PracticeReview,
    onBack: () -> Unit,
    onCorrectGrading: (String, Boolean) -> Unit,
    onAskTutor: (String) -> Unit,
    onPrevious: () -> Unit,
    onQuestionSelect: (Int) -> Unit,
    onNext: () -> Unit,
    onSummaryAction: (PracticeSummaryAction) -> Unit,
) {
    val canCorrectGrading = practiceResultCanCorrectGrading(screen.result)
    var tutorQuestion by remember(screen.question.id) { mutableStateOf("") }
    var tutorError by remember(screen.question.id) { mutableStateOf("") }
    val isLastQuestion = screen.index + 1 >= screen.practice.questions.size
    val usesSummaryDialog = isLastQuestion &&
        screen.reinforcementContext == null &&
        screen.practice.sessionType != PracticeSessionTypes.ReviewRetry &&
        !screen.openedFromSummary
    var showSummary by remember(screen.practice.objective, screen.index) {
        mutableStateOf(screen.summaryAutoOpen && screen.reinforcementContext == null && !screen.openedFromSummary)
    }
    if (LocalPhonePresentation.current) {
        PhonePracticeResultContent(screen, review, canCorrectGrading, tutorQuestion, tutorError,
            { tutorQuestion = it; tutorError = "" }, onCorrectGrading, onAskTutor, onBack, onPrevious, onQuestionSelect,
            { if (usesSummaryDialog) showSummary = true else onNext() })
    } else FullH5PracticeResultScreen(
        screen = screen,
        review = review,
        canCorrectGrading = canCorrectGrading,
        tutorQuestion = tutorQuestion,
        tutorError = tutorError,
        onTutorQuestionChange = {
            tutorQuestion = it
            tutorError = ""
        },
        onCorrectGrading = onCorrectGrading,
        onAskTutor = onAskTutor,
        onBack = onBack,
        onPrevious = onPrevious,
        onQuestionSelect = onQuestionSelect,
        onNext = {
            if (usesSummaryDialog) {
                showSummary = true
            } else {
                onNext()
            }
        },
    )
    if (showSummary) {
        PracticeSummaryDialog(
            model = buildPracticeSummaryDialogModel(
                kpName = screen.kp.name,
                practice = screen.practice,
                review = review,
                learningCatalogContext = screen.learningCatalogContext,
            ),
            onDismiss = { showSummary = false },
            onPrimary = { action ->
                showSummary = false
                onSummaryAction(action)
            },
        )
    }
}

@Composable
private fun PracticeSummaryDialog(
    model: PracticeSummaryDialogModel,
    onDismiss: () -> Unit,
    onPrimary: (PracticeSummaryAction) -> Unit,
) {
    if (LocalPhonePresentation.current) {
        PhonePracticeSheet(model.title, onDismiss) {
            Text(model.scoreText, style = MaterialTheme.typography.titleMedium)
            PhoneSoftSection {
                Text(model.label, style = MaterialTheme.typography.titleMedium)
                Text(model.feedback, color = PhoneColors.Muted)
                model.meta?.let { Text(it, color = PhoneColors.Primary) }
            }
            PhoneAction(model.primaryLabel, { onPrimary(model.primaryAction) }, Modifier.fillMaxWidth())
            if (model.secondaryLabel != null && model.secondaryAction != null)
                PhoneAction(model.secondaryLabel, { onPrimary(model.secondaryAction) }, Modifier.fillMaxWidth(), primary = false)
            TextButton(onClick = onDismiss) { Text("继续查看本题") }
        }
        return
    }
    val tone = when (model.tone) {
        PracticeSummaryTone.Mastered -> OpenPhysicsTone.Success
        PracticeSummaryTone.Practice -> OpenPhysicsTone.Warning
        PracticeSummaryTone.Study -> OpenPhysicsTone.Primary
        PracticeSummaryTone.Neutral -> OpenPhysicsTone.Neutral
    }
    val palette = tonePalette(tone)
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Column(
            modifier = Modifier
                .padding(horizontal = 24.dp)
                .widthIn(max = 680.dp)
                .fillMaxWidth()
                .background(OpenPhysicsColors.Surface, RoundedCornerShape(OpenPhysicsRadius.Large))
                .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Large))
                .padding(28.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(modifier = Modifier.fillMaxWidth()) {
                Text(
                    text = model.title,
                    style = MaterialTheme.typography.headlineSmall,
                    color = OpenPhysicsColors.Ink,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.align(Alignment.Center),
                )
                TextButton(
                    onClick = onDismiss,
                    modifier = Modifier
                        .align(Alignment.CenterEnd)
                        .size(46.dp)
                        .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Pill)),
                ) {
                    Text("×", color = OpenPhysicsColors.Muted, style = MaterialTheme.typography.headlineSmall)
                }
            }
            Text(
                text = model.scoreText,
                style = MaterialTheme.typography.titleMedium,
                color = OpenPhysicsColors.Muted,
            )
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(palette.background, RoundedCornerShape(OpenPhysicsRadius.Medium))
                    .border(1.dp, palette.border, RoundedCornerShape(OpenPhysicsRadius.Medium))
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    text = model.label,
                    style = MaterialTheme.typography.titleMedium,
                    color = palette.foreground,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    text = model.feedback,
                    style = MaterialTheme.typography.bodyLarge,
                    color = OpenPhysicsColors.Muted,
                )
                model.meta?.let { meta ->
                    Text(
                        text = meta,
                        style = MaterialTheme.typography.bodyMedium,
                        color = OpenPhysicsColors.Muted,
                    )
                }
            }
            PrimaryActionButton(
                text = model.primaryLabel,
                onClick = { onPrimary(model.primaryAction) },
                modifier = Modifier.widthIn(min = 180.dp, max = 280.dp),
            )
            if (model.secondaryLabel != null && model.secondaryAction != null) {
                SecondaryActionButton(
                    text = model.secondaryLabel,
                    onClick = { onPrimary(model.secondaryAction) },
                    modifier = Modifier.widthIn(min = 180.dp, max = 280.dp),
                )
            }
        }
    }
}

@Composable
private fun FullH5PracticeResultScreen(
    screen: Screen.PracticeResultScreen,
    review: PracticeReview,
    canCorrectGrading: Boolean,
    tutorQuestion: String,
    tutorError: String,
    onTutorQuestionChange: (String) -> Unit,
    onCorrectGrading: (String, Boolean) -> Unit,
    onAskTutor: (String) -> Unit,
    onBack: () -> Unit,
    onPrevious: () -> Unit,
    onQuestionSelect: (Int) -> Unit,
    onNext: () -> Unit,
) {
    // Like the tablet 错题详情 page: AI 助教 is a page action opening an in-page panel,
    // never a draggable button floating over the question.
    val focusManager = LocalFocusManager.current
    var tutorOpen by remember(screen.question.id) { mutableStateOf(false) }
    fun submitTutorQuestion(message: String) {
        val text = message.trim()
        if (text.isNotBlank()) {
            onTutorQuestionChange("")
            onAskTutor(text)
        }
    }
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(OpenPhysicsColors.Background),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(start = 12.dp, top = 10.dp, end = 12.dp, bottom = 10.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ResultQuestionJumpStrip(
                states = practiceResultNavigationStates(screen.practice.questions, review),
                currentIndex = screen.index,
                onQuestionSelect = onQuestionSelect,
            )
            QuestionLessonVideoAction(
                studentToken = screen.session.token, questionId = screen.question.id,
                answerId = screen.result.answerId,
                lessonVideo = (screen.result.lessonVideo ?: screen.question.lessonVideo)?.let {
                    if (screen.practice.teacherPaper?.status == "completed") it.copy(available = true, lockedReason = "") else it
                },
            )
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .background(OpenPhysicsColors.Surface, RoundedCornerShape(OpenPhysicsRadius.Large))
                    .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Large)),
            ) {
                ReadOnlyQuestionWebView(
                    question = screen.question,
                    answer = screen.answer,
                    result = screen.result,
                    includeSolution = true,
                    resultPresentation = true,
                    canCorrectGrading = canCorrectGrading,
                    onCorrectGrading = { correction ->
                        onCorrectGrading(correction.correctedAnswer, correction.correct)
                    },
                    modifier = Modifier.fillMaxSize(),
                )
                if (tutorOpen) {
                    TutorAssistantPanel(
                        policy = practiceResultTutorAssistantPolicy(),
                        chatMessages = screen.tutorMessages,
                        requestState = screen.tutorRequest,
                        input = tutorQuestion,
                        error = tutorError,
                        onInputChange = onTutorQuestionChange,
                        onSubmit = ::submitTutorQuestion,
                        onDismiss = { tutorOpen = false },
                        reserveTriggerSpace = false,
                    )
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TabletBarAction("AI 助教", {
                    if (tutorOpen) focusManager.clearFocus()
                    tutorOpen = !tutorOpen
                }, primary = false, symbol = PhoneSymbol.Sparkle)
                SecondaryActionButton(
                    text = if (screen.index > 0) "上一题" else "返回",
                    onClick = if (screen.index > 0) onPrevious else onBack,
                    modifier = Modifier.weight(0.55f),
                )
                PrimaryActionButton(
                    text = practiceResultPrimaryActionLabel(
                        isLastQuestion = screen.index + 1 >= screen.practice.questions.size,
                        reinforcementContext = screen.reinforcementContext,
                        sessionType = screen.practice.sessionType,
                        openedFromSummary = screen.openedFromSummary,
                    ),
                    onClick = onNext,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

// Tablet practice review

@Composable
internal fun PracticeReviewScreen(
    screen: Screen.PracticeReviewScreen,
    onBackToReview: () -> Unit,
    onOpenQuestion: (Int) -> Unit,
    onDone: () -> Unit,
    onRefresh: () -> Unit = {},
    onRestart: (() -> Unit)? = null,
    onCorrectGrading: (QuestionPaneGradingCorrection) -> Unit = {},
) {
    if (LocalPhonePresentation.current) {
        PhonePracticeSummary(screen, onOpenQuestion, onDone, onRefresh, onRestart)
        return
    }
    if (screen.practice.teacherPaper != null &&
        (screen.practice.teacherPaper.status == "grading" || screen.review.items.size < screen.practice.questions.size)) {
        Page {
            LearningCard(title = "套卷批改进度", subtitle = screen.practice.teacherPaper.title) {
                Text("已完成 ${screen.review.items.size}/${screen.practice.questions.size} 题批改")
                Text("这份答卷已经提交。请在原作答设备完成未上传的作答；这里可以刷新查看批改结果。")
                SecondaryActionButton("刷新批改进度", onRefresh)
            }
            screen.review.items.forEachIndexed { index, item ->
                SecondaryActionButton("第 ${screen.practice.questions.indexOfFirst { it.id == item.question.id } + 1} 题 · 查看批改", { onOpenQuestion(index) })
            }
            SecondaryActionButton(if (screen.learningCatalogContext?.isTeacherHomework == true) "返回首页" else "返回专题路径", onDone)
        }
        return
    }
    if (screen.practice.teacherPaper?.status == "completed") {
        TeacherPaperAnswerSheet(screen = screen, onDone = onDone, onRestart = onRestart, onCorrectGrading = onCorrectGrading)
        return
    }
    TabletPracticeReviewScreen(
        screen = screen,
        onBackToReview = onBackToReview,
        onOpenQuestion = onOpenQuestion,
        onDone = onDone,
    )
}

@Composable
private fun TabletPracticeReviewScreen(
    screen: Screen.PracticeReviewScreen,
    onBackToReview: () -> Unit,
    onOpenQuestion: (Int) -> Unit,
    onDone: () -> Unit,
) {
    val total = screen.review.totalCount.coerceAtLeast(1)
    val correctRate = ((screen.review.correctCount * 100) / total).coerceIn(0, 100)
    val diagnostic = screen.review.diagnosticFeedback
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(OpenPhysicsColors.Background)
            .padding(start = 12.dp, top = 14.dp, end = 12.dp, bottom = 10.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        LearningCard(
            meta = "",
            title = diagnostic?.title ?: "${screen.review.correctCount}/${screen.review.totalCount} 题正确",
            subtitle = diagnostic?.feedback ?: screen.kp.name,
            trailing = {
                StatusChip(
                    text = diagnostic?.let { diagnosticRecommendationLabel(it.recommendation) } ?: "正确率 $correctRate%",
                    tone = diagnostic?.let { diagnosticRecommendationTone(it.recommendation) }
                        ?: if (correctRate >= 80) OpenPhysicsTone.Success else OpenPhysicsTone.Warning,
                )
            },
        ) {
            StatStrip {
                StatCell("正确", "${diagnostic?.correctCount ?: screen.review.correctCount}")
                StatCell("总题数", "${diagnostic?.totalCount ?: screen.review.totalCount}")
                if (diagnostic == null) {
                    StatCell("正确率", "$correctRate%")
                } else {
                    StatCell("掌握度", "${percentText(diagnostic.masteryAfter)}")
                }
            }
            diagnostic?.let {
                MutedText("掌握度 ${percentText(it.masteryBefore)} → ${percentText(it.masteryAfter)}")
            }
        }
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            screen.review.items.chunked(2).forEachIndexed { rowIndex, rowItems ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    rowItems.forEachIndexed { columnIndex, item ->
                        TabletReviewItemCard(
                            index = rowIndex * 2 + columnIndex,
                            total = screen.review.totalCount,
                            item = item,
                            onClick = { onOpenQuestion(rowIndex * 2 + columnIndex) },
                            modifier = Modifier.weight(1f),
                        )
                    }
                    if (rowItems.size == 1) {
                        Box(modifier = Modifier.weight(1f))
                    }
                }
            }
        }
        LearningCard {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                SecondaryActionButton(
                    text = "返回逐题复盘",
                    onClick = onBackToReview,
                    modifier = Modifier.weight(1f),
                )
                PrimaryActionButton(
                    text = "回到知识点",
                    onClick = onDone,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun TabletReviewItemCard(
    index: Int,
    total: Int,
    item: PracticeReviewItem,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LearningCard(
        modifier = modifier,
        onClick = onClick,
        meta = "${index + 1}/$total",
        title = if (item.result.correct) "答对了" else "需要订正",
        subtitle = compactText(cleanText(item.question.stem), 60),
        trailing = {
            StatusChip(
                text = if (item.result.correct) "正确" else "需订正",
                tone = if (item.result.correct) OpenPhysicsTone.Success else OpenPhysicsTone.Warning,
            )
        },
    ) {
        MetaText("你的答案：${compactText(item.answer.ifBlank { "未作答" }, 42)}")
        MetaText("点击查看完整题目与批改过程")
        SectionTitle("正确答案")
        PracticeRenderedOrFallbackText(
            text = item.result.correctAnswer.ifBlank { "暂无" },
            rendered = item.result.correctAnswerRendered,
            compact = true,
        )
        if (hasRenderedOrText(item.result.explanation, item.result.explanationRendered)) {
            SectionTitle("简短解析")
            PracticeRenderedOrFallbackText(
                text = compactText(cleanText(item.result.explanation), 100),
                rendered = item.result.explanationRendered,
                compact = true,
            )
        } else if (hasRenderedOrText(item.result.aiFeedback, item.result.aiFeedbackRendered)) {
            SectionTitle("AI 提示")
            PracticeRenderedOrFallbackText(
                text = compactText(cleanText(item.result.aiFeedback), 100),
                rendered = item.result.aiFeedbackRendered,
                compact = true,
            )
        }
    }
}

private fun diagnosticRecommendationLabel(recommendation: String): String {
    return when (recommendation) {
        "mastered" -> "已掌握"
        "practice" -> "需巩固"
        "study" -> "先学习"
        else -> "评估完成"
    }
}

private fun diagnosticRecommendationTone(recommendation: String): OpenPhysicsTone {
    return when (recommendation) {
        "mastered" -> OpenPhysicsTone.Success
        "practice" -> OpenPhysicsTone.Warning
        "study" -> OpenPhysicsTone.Primary
        else -> OpenPhysicsTone.Neutral
    }
}

private fun percentText(value: Double): String = "${(value * 100).toInt().coerceIn(0, 100)}%"

@Composable
private fun GradingCheckRow(label: String, value: Boolean?) {
    val text = when (value) {
        true -> "正确"
        false -> "需修正"
        null -> "未判断"
    }
    val tone = when (value) {
        true -> OpenPhysicsTone.Success
        false -> OpenPhysicsTone.Warning
        null -> OpenPhysicsTone.Neutral
    }
    StatusChip("$label：$text", tone = tone)
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

fun stemImages(question: PracticeQuestion): List<QuestionImage> {
    return promptQuestionImages(question.stem, question.options, question.images)
}
