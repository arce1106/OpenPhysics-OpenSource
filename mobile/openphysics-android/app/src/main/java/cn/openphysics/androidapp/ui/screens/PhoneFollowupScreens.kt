package cn.openphysics.androidapp.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import cn.openphysics.androidapp.domain.*
import cn.openphysics.androidapp.ui.PracticeReview
import cn.openphysics.androidapp.ui.Screen
import cn.openphysics.androidapp.ui.TutorRequestState

@Composable
internal fun PhoneDetailPage(title: String, onBack: () -> Unit,
    footer: @Composable RowScope.() -> Unit = {}, showFooter: Boolean = true,
    background: Color = Color.White,
    tabBar: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit) {
    Scaffold(containerColor = background, contentWindowInsets = WindowInsets(0),
        topBar = { PhoneTopBar(title, onBack) }, bottomBar = {
            if (!showFooter && tabBar != null) tabBar()
            else if (showFooter) {
                Column(Modifier.background(Color.White)) {
                    HorizontalDivider(color = PhoneColors.Divider)
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically, content = footer)
                }
            }
        }) { insets ->
        Column(Modifier.fillMaxSize().padding(insets).verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp), content = content)
    }
}

@Composable
internal fun PhoneListRow(title: String, detail: String = "", onClick: () -> Unit,
    badge: String = "", enabled: Boolean = true, showChevron: Boolean = true,
    titleStyle: TextStyle? = null, titleWeight: FontWeight = FontWeight.Medium,
    trailing: PhoneSymbol? = PhoneSymbol.Next, titleColor: Color = Color.Unspecified, divider: Boolean = true) {
    Row(Modifier.fillMaxWidth().clickable(enabled = enabled, role = Role.Button, onClick = onClick).padding(vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(title, style = titleStyle ?: MaterialTheme.typography.bodyLarge, fontWeight = titleWeight, color = titleColor)
            if (detail.isNotBlank()) Text(detail, color = PhoneColors.Muted, style = MaterialTheme.typography.labelMedium)
        }
        if (badge.isNotBlank()) Text(badge, color = PhoneColors.Primary, style = MaterialTheme.typography.labelMedium)
        // Navigation rows end in a muted chevron; a selected option ends in an accent checkmark, like iOS lists.
        if (enabled && showChevron && trailing != null) PhoneIcon(trailing, Modifier.size(if (trailing == PhoneSymbol.Check) 20.dp else 18.dp),
            if (trailing == PhoneSymbol.Check) PhoneColors.Primary else PhoneColors.Muted)
    }
    if (divider) HorizontalDivider(color = PhoneColors.Divider)
}

@Composable
internal fun PhoneSoftSection(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().background(PhoneColors.Soft, RoundedCornerShape(16.dp)).padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
}

internal fun phoneQuestionPreview(stem: String, maxChars: Int = 86): String {
    val plain = stem.replace(Regex("""\\(?:mathrm|mathbf|mathit|operatorname)\{([^{}]*)\}"""), "$1")
        .replace(Regex("""\\[,;!:]"""), " ")
    return compactText(toReadablePhysicsText(plain), maxChars)
}

/** A compact, result-first row for phone history and review lists. */
@Composable
internal fun PhoneCompactQuestionRow(
    title: String,
    status: String,
    meta: String,
    preview: String,
    hasAnswerImage: Boolean,
    onClick: () -> Unit,
    enabled: Boolean = true,
) {
    Column(
        Modifier.fillMaxWidth().clickable(enabled = enabled, role = Role.Button, onClick = onClick).padding(vertical = 13.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(status, color = when (status) {
                "正确" -> Color(0xFF287761)
                "需订正" -> Color(0xFF9A6338)
                else -> PhoneColors.Muted
            },
                style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Medium)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Text(meta, Modifier.weight(1f), color = PhoneColors.Muted,
                style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (hasAnswerImage) Text("有作答图", color = PhoneColors.Muted,
                style = MaterialTheme.typography.labelMedium)
        }
        Text(preview.ifBlank { "查看完整题目与作答" }, color = PhoneColors.Ink,
            style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
    HorizontalDivider(color = PhoneColors.Divider)
}

@Composable
internal fun PhoneReviewNotebookContent(review: ReviewData, onMistake: (ReviewMistake) -> Unit) {
    var expanded by rememberSaveable { mutableStateOf("") }
    // Like iOS, each knowledge point's card folds from its header; all start open.
    var collapsed by rememberSaveable { mutableStateOf(listOf<String>()) }
    PhoneRootTitle("错题复盘")
    Text("待复盘 ${review.pendingCount} 道 · 已清除 ${review.reviewedCount} 道", color = PhoneColors.Muted,
        style = MaterialTheme.typography.bodyMedium)
    val first = review.groups.firstNotNullOfOrNull { it.mistakes.firstOrNull() }
    if (first == null) {
        Text("当前没有待复盘错题。继续学习，遇到的问题会保存在这里。", color = PhoneColors.Muted)
        return
    }
    // iOS 错题复盘: one white card per knowledge point, a count badge in its header,
    // each mistake tagged with its type and error before the stem preview.
    review.groups.forEach { group ->
        val open = expanded == group.kpId
        val folded = group.kpId in collapsed
        PhoneCard(padding = PaddingValues(0.dp)) {
            Row(Modifier.fillMaxWidth().background(PhoneColors.Background)
                .clickable(role = Role.Button) { collapsed = if (folded) collapsed - group.kpId else collapsed + group.kpId }
                .padding(horizontal = 16.dp, vertical = 13.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PhoneIcon(if (folded) PhoneSymbol.Next else PhoneSymbol.Down, Modifier.size(16.dp), PhoneColors.Muted)
                Text(group.kpName, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("${group.mistakes.size} 题", style = MaterialTheme.typography.labelMedium, color = PhoneColors.Warning,
                    fontWeight = FontWeight.SemiBold, modifier = Modifier.background(Color(0xFFFFF4E5), RoundedCornerShape(10.dp))
                        .border(1.dp, Color(0x33C2620F), RoundedCornerShape(10.dp)).padding(horizontal = 9.dp, vertical = 2.dp))
            }
            val visible = if (folded) emptyList() else reviewVisibleMistakes(group, open, 3)
            visible.forEachIndexed { index, mistake ->
                HorizontalDivider(color = PhoneColors.Divider)
                PhoneMistakeCardRow(mistake) { onMistake(mistake) }
            }
            if (!folded && group.mistakes.size > 3) {
                HorizontalDivider(color = PhoneColors.Divider)
                TextButton(onClick = { expanded = if (open) "" else group.kpId }, modifier = Modifier.fillMaxWidth()) {
                    Text(if (open) "收起" else "展开其余 ${group.mistakes.size - 3} 题")
                }
            }
        }
    }
}

@Composable
private fun PhoneMistakeCardRow(mistake: ReviewMistake, onClick: () -> Unit) {
    val error = mistake.misconceptionName.takeUnless { it.isBlank() || it == "未能判断" }
    val hasImage = mistake.answerImages.isNotEmpty() || mistake.processGrading?.answerImagePaths?.isNotEmpty() == true
    Column(Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick).padding(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            PhoneChip(phoneChoiceAwareTypeLabel(mistake.questionType))
            error?.let { PhoneChip(it) }
            if (hasImage) PhoneChip("有作答图")
        }
        Text(phoneQuestionPreview(mistake.stemText, 140).ifBlank { "查看完整题目与作答" }, color = PhoneColors.Ink,
            style = MaterialTheme.typography.bodyMedium, maxLines = 4, overflow = TextOverflow.Ellipsis)
        Text(mistake.createdAt.take(10).replace('-', '/'), color = PhoneColors.Muted, style = MaterialTheme.typography.labelMedium)
    }
}

/** Mistake tags name single vs multiple choice, as iOS does; other types keep the shared label. */
internal fun phoneChoiceAwareTypeLabel(questionType: String): String {
    val raw = questionType.trim().lowercase().replace("-", "_").replace(" ", "_")
    return when {
        raw.startsWith("multi") || questionType.contains("多选") -> "多选题"
        raw.startsWith("single") || questionType.contains("单选") -> "单选题"
        else -> questionTypeLabel(questionType)
    }
}

@Composable
internal fun PhoneChip(text: String) {
    Text(text, style = MaterialTheme.typography.labelSmall, color = PhoneColors.Muted, fontWeight = FontWeight.SemiBold,
        maxLines = 1, overflow = TextOverflow.Ellipsis,
        modifier = Modifier.background(PhoneColors.Background, RoundedCornerShape(8.dp))
            .border(1.dp, PhoneColors.Divider, RoundedCornerShape(8.dp)).padding(horizontal = 8.dp, vertical = 3.dp))
}

/** Images from both record formats remain attached, even when grading metadata is absent. */
internal fun phoneRecordGrading(grading: ProcessGrading?, images: List<QuestionImage>): ProcessGrading? {
    val paths = (grading?.answerImagePaths.orEmpty() + images.map { it.imageUrl.ifBlank { it.imagePath } }).filter { it.isNotBlank() }.distinct()
    if (grading == null && paths.isEmpty()) return null
    return (grading ?: ProcessGrading("", "", "", emptyList(), "", false)).copy(answerImagePaths = paths)
}

internal fun phoneMistakeResult(m: ReviewMistake) = SubmitResult(
    answerId = m.answerId, correct = false, correctAnswer = m.correctAnswer, explanation = m.explanation,
    aiFeedback = "", givenAnswer = m.givenAnswer, detectedMisconceptionName = m.misconceptionName,
    processGrading = phoneRecordGrading(m.processGrading, m.answerImages),
    correctAnswerRendered = m.correctAnswerRendered, explanationRendered = m.explanationRendered,
)

@Composable
internal fun PhoneRecordDetail(title: String, question: PracticeQuestion, answer: String, result: SubmitResult,
    onBack: () -> Unit, primaryLabel: String, onPrimary: () -> Unit,
    studentToken: String, lessonVideo: QuestionLessonVideo?,
    messages: List<TutorChatMessage> = emptyList(), request: TutorRequestState = TutorRequestState(),
    onAskTutor: ((String) -> Unit)? = null, notice: String = "") {
    var tutorOpen by rememberSaveable(question.id) { mutableStateOf(false) }
    var input by rememberSaveable(question.id) { mutableStateOf("") }
    PhoneDetailPage(title, onBack, showFooter = primaryLabel.isNotBlank() || onAskTutor != null, footer = {
        if (onAskTutor != null) PhoneAction("AI 助教", { tutorOpen = true }, Modifier.weight(0.4f), primary = false)
        if (primaryLabel.isNotBlank()) PhoneAction(primaryLabel, onPrimary,
            if (onAskTutor == null) Modifier.fillMaxWidth() else Modifier.weight(0.6f))
    }) {
        LeftQuestionWebView(question, 0, 1, answer, { _, _ -> }, result = result,
            readOnly = true, resultPresentation = true, phonePresentation = true, expandToContent = true)
        QuestionLessonVideoAction(studentToken, question.id, result.answerId, lessonVideo)
        if (notice.isNotBlank()) Text(notice, color = PhoneColors.Muted)
    }
    if (tutorOpen && onAskTutor != null) PhoneTutorSheet(reviewTutorAssistantPolicy(), messages, input, "", { input = it },
        { if (it.isNotBlank()) { onAskTutor(it.trim()); input = "" } }, { tutorOpen = false }, request)
}

@Composable
internal fun PhonePracticeResultContent(screen: Screen.PracticeResultScreen, review: PracticeReview,
    canCorrectGrading: Boolean, input: String, error: String, onInput: (String) -> Unit,
    onCorrect: (String, Boolean) -> Unit, onAskTutor: (String) -> Unit,
    onBack: () -> Unit, onPrevious: () -> Unit, onSelect: (Int) -> Unit, onNext: () -> Unit) {
    var tutorOpen by rememberSaveable(screen.question.id) { mutableStateOf(false) }
    var listOpen by rememberSaveable { mutableStateOf(false) }
    var correctionOpen by rememberSaveable(screen.question.id) { mutableStateOf(false) }
    var correction by rememberSaveable(screen.question.id, screen.result) {
        mutableStateOf(screen.result.extractedAnswer.ifBlank { screen.answer }.takeUnless { it.startsWith("[") }.orEmpty())
    }
    val nextQuestion = screen.practice.questions.getOrNull(screen.index + 1)
    val returnToProgress = screen.openedFromSummary && nextQuestion != null && review.items.none { it.question.id == nextQuestion.id }
    PhoneDetailPage("作答复盘", onBack, footer = {
        PhoneAction("AI 助教", { tutorOpen = true }, Modifier.weight(0.38f), primary = false)
        PhoneAction(if (returnToProgress) "返回批改进度" else practiceResultPrimaryActionLabel(screen.index + 1 >= screen.practice.questions.size,
            screen.reinforcementContext, screen.practice.sessionType, screen.openedFromSummary),
            if (returnToProgress) onBack else onNext, Modifier.weight(0.62f))
    }) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("${screen.index + 1} / ${screen.practice.questions.size}", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            TextButton(onClick = onPrevious, enabled = screen.practice.questions.getOrNull(screen.index - 1)?.let { q -> review.items.any { it.question.id == q.id } } == true) { Text("上一题") }
            TextButton(onClick = { listOpen = true }) { Text("全部题目") }
        }
        // A variation's outcome for the original mistake (cleared, or why not) belongs on this page.
        if (screen.reviewRetryMessage.isNotBlank()) Text(screen.reviewRetryMessage,
            color = if (screen.result.cleared) PhoneColors.Primary else Color(0xFF9A6338),
            style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
        key(screen.question.id) {
            LeftQuestionWebView(screen.question, screen.index, screen.practice.questions.size, screen.answer, { _, _ -> },
                result = screen.result, readOnly = true, resultPresentation = true,
                canCorrectGrading = false, expandToContent = true, phonePresentation = true)
        }
        if (canCorrectGrading) TextButton(onClick = { correctionOpen = true }) { Text("修正识别或批改") }
        QuestionLessonVideoAction(screen.session.token, screen.question.id, screen.result.answerId,
            (screen.result.lessonVideo ?: screen.question.lessonVideo)?.let {
                if (screen.practice.teacherPaper?.status == "completed") it.copy(available = true, lockedReason = "") else it
            })
    }
    if (listOpen) PhonePracticeSheet("全部题目", { listOpen = false }) {
        screen.practice.questions.forEachIndexed { index, q ->
            val result = review.items.firstOrNull { it.question.id == q.id }?.result
            PhoneListRow("第 ${index + 1} 题", questionTypeLabel(q.questionType), { listOpen = false; onSelect(index) },
                result?.let { if (it.correct) "正确" else "需订正" } ?: "待批改", enabled = result != null)
        }
    }
    if (tutorOpen) PhoneTutorSheet(practiceResultTutorAssistantPolicy(), screen.tutorMessages, input, error, onInput,
        { if (it.isNotBlank()) { onInput(""); onAskTutor(it.trim()) } }, { tutorOpen = false }, screen.tutorRequest)
    if (correctionOpen) PhonePracticeSheet("修正批改", { correctionOpen = false }) {
        Text("AI 判断不准时，可修正识别内容并确认对错，本题记录和掌握度会同步更新。", color = PhoneColors.Muted)
        OutlinedTextField(correction, { correction = it }, Modifier.fillMaxWidth(), label = { Text("正确识别的答案") }, minLines = 2, maxLines = 4)
        PhoneAction("改为正确", { correctionOpen = false; onCorrect(correction, true) }, Modifier.fillMaxWidth())
        PhoneAction("改为错误", { correctionOpen = false; onCorrect(correction, false) }, Modifier.fillMaxWidth(), primary = false)
    }
}

@Composable
internal fun PhonePracticeSummary(screen: Screen.PracticeReviewScreen, onOpen: (Int) -> Unit, onDone: () -> Unit,
    onRefresh: () -> Unit, onRestart: (() -> Unit)?) {
    var restart by remember { mutableStateOf(false) }
    val paper = screen.practice.teacherPaper
    val waiting = paper != null && (paper.status == "grading" || screen.review.items.size < screen.practice.questions.size)
    val model = buildPracticeSummaryDialogModel(screen.kp.name, screen.practice, screen.review, screen.learningCatalogContext)
    PhoneDetailPage(if (waiting) "批改进度" else model.title, onDone, footer = {
        PhoneAction(if (waiting) "刷新批改进度" else if (screen.learningCatalogContext?.isTeacherHomework == true) "返回首页" else if (screen.learningCatalogContext != null) "返回专题路径" else "返回学习", if (waiting) onRefresh else onDone, Modifier.fillMaxWidth())
    }) {
        Text(paper?.title ?: screen.kp.name, style = MaterialTheme.typography.titleLarge)
        PhoneSoftSection {
            Text(if (waiting) "已批改 ${screen.review.items.size}/${screen.practice.questions.size} 题" else model.scoreText,
                style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text(if (waiting) "答卷已提交，可刷新查看批改结果。未上传的作答请在原设备继续提交。" else model.feedback, color = PhoneColors.Muted)
            model.meta?.let { Text(it, color = PhoneColors.Primary) }
        }
        Text("逐题复盘", style = MaterialTheme.typography.titleMedium)
        screen.practice.questions.forEachIndexed { position, question ->
            val index = screen.review.items.indexOfFirst { it.question.id == question.id }
            val item = screen.review.items.getOrNull(index)
            PhoneCompactQuestionRow(
                title = "第 ${position + 1} 题",
                status = item?.let { if (it.result.correct) "正确" else "需订正" } ?: "待批改",
                meta = questionTypeLabel(question.questionType),
                preview = phoneQuestionPreview(question.stem, 100),
                hasAnswerImage = item?.result?.processGrading?.answerImagePaths?.isNotEmpty() == true,
                onClick = { if (index >= 0) onOpen(index) },
                enabled = item != null,
            )
        }
        if (onRestart != null && !waiting) TextButton(onClick = { restart = true }) { Text("重新作答这份套卷") }
    }
    if (restart && onRestart != null) AlertDialog(onDismissRequest = { restart = false }, title = { Text("重新作答这份套卷？") },
        text = { Text("将开始一份新答卷，原作答记录会保留。") },
        confirmButton = { TextButton(onClick = { restart = false; onRestart() }) { Text("重新作答") } },
        dismissButton = { TextButton(onClick = { restart = false }) { Text("取消") } })
}
