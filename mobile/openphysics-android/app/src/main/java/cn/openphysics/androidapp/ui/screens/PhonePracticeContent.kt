package cn.openphysics.androidapp.ui.screens

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import cn.openphysics.androidapp.domain.LocalImageFile
import cn.openphysics.androidapp.domain.PracticeQuestion
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Presentation only: drafts, grading and self-review remain owned by PracticeQuestionScreen. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PhonePracticeContent(
    question: PracticeQuestion,
    index: Int,
    total: Int,
    title: String,
    guidance: String,
    answer: String,
    currentAnswered: Boolean,
    answeredIndexes: Set<Int>,
    singleQuestion: Boolean,
    locked: Boolean,
    pendingPhoto: PreparedAnswerPhoto?,
    preparingPhoto: Boolean,
    savedPhoto: LocalImageFile?,
    selfReviewSaved: Boolean,
    error: String,
    canSelfReview: Boolean,
    onBack: () -> Unit,
    onAnswerChange: (String, String) -> Unit,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onQuestionSelect: (Int) -> Unit,
    onSubmit: () -> Unit,
    onTakePhoto: () -> Unit,
    onPickPhoto: () -> Unit,
    onCancelPhoto: () -> Unit,
    onRetakePhoto: () -> Unit,
    onRotatePhoto: () -> Unit,
    onCropPhoto: () -> Unit,
    onSavePhoto: () -> Unit,
    onRemovePhoto: () -> Unit,
    selfReviewContent: @Composable (() -> Unit) -> Unit,
    paperBatchCount: Int,
    paperBatchContent: (@Composable (() -> Unit) -> Unit)?,
) {
    var answerCard by remember { mutableStateOf(false) }
    var selfReview by remember(question.id) { mutableStateOf(false) }
    var paperBatch by remember { mutableStateOf(false) }
    var viewPhoto by remember(question.id) { mutableStateOf(false) }
    val scroll = rememberScrollState()
    LaunchedEffect(question.id) { scroll.scrollTo(0) }
    val busy = locked || preparingPhoto || pendingPhoto != null
    val bitmap = rememberPhoneAnswerBitmap(savedPhoto)
    val primaryLabel = when {
        !question.isChoice() && !currentAnswered -> "拍照作答"
        singleQuestion -> "提交本题"
        index == total - 1 -> "交卷批改"
        else -> "下一题"
    }
    val primaryAction = when {
        !question.isChoice() && !currentAnswered -> onTakePhoto
        singleQuestion || index == total - 1 -> onSubmit
        else -> onNext
    }
    Scaffold(
        containerColor = Color.White,
        contentWindowInsets = WindowInsets(0),
        topBar = {
            Column {
                PhoneTopBar(title, onBack) {
                    if (!singleQuestion) TextButton(onClick = onSubmit, enabled = !busy) { Text("交卷") }
                }
                Row(
                    Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("${index + 1} / $total", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text("已答 ${answeredIndexes.size} 题", Modifier.weight(1f).padding(start = 16.dp),
                        color = PhoneColors.Muted, style = MaterialTheme.typography.labelMedium)
                    if (!singleQuestion) TextButton(onClick = { answerCard = true }, enabled = !busy) { Text("答题卡") }
                }
                LinearProgressIndicator(
                    progress = { if (total > 0) answeredIndexes.size.toFloat() / total else 0f },
                    modifier = Modifier.fillMaxWidth().padding(top = 6.dp).height(2.dp),
                    color = PhoneColors.Primary, trackColor = PhoneColors.Divider, gapSize = 0.dp, drawStopIndicator = {},
                )
            }
        },
        bottomBar = {
            Column(Modifier.background(Color.White)) {
                HorizontalDivider(color = PhoneColors.Divider)
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (!singleQuestion) PhoneAction("上一题", onPrevious, Modifier.weight(1f), primary = false, enabled = index > 0 && !busy)
                    PhoneAction(primaryLabel, primaryAction, Modifier.weight(1.6f),
                        enabled = !busy && (!singleQuestion || !question.isChoice() || currentAnswered))
                }
            }
        },
    ) { insets ->
        Column(Modifier.fillMaxSize().padding(insets).verticalScroll(scroll).padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)) {
            Spacer(Modifier.height(0.dp))
            if (guidance.isNotBlank()) Text(guidance, color = PhoneColors.Muted, style = MaterialTheme.typography.bodyMedium)
            LeftQuestionWebView(
                question = question, index = index, total = total, answer = answer,
                onAnswerChange = onAnswerChange, includeSolution = false,
                interactionLocked = busy, expandToContent = true, phonePresentation = true,
            )
            if (!question.isChoice()) {
                HorizontalDivider(color = PhoneColors.Divider)
                Text("我的作答", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                when {
                    savedPhoto != null -> {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Text("照片已保存到本题", Modifier.weight(1f), color = PhoneColors.Primary, style = MaterialTheme.typography.bodyMedium)
                            TextButton(onClick = onRemovePhoto, enabled = !busy) { Text("移除") }
                        }
                        if (bitmap != null) Image(
                            bitmap.asImageBitmap(), "已保存的作答图片，点击查看",
                            Modifier.fillMaxWidth().heightIn(min = 100.dp, max = 200.dp)
                                .background(PhoneColors.Background, RoundedCornerShape(12.dp))
                                .clickable { viewPhoto = true }.padding(8.dp),
                            contentScale = ContentScale.Fit,
                        ) else Text("照片已保留，预览暂不可用。", color = PhoneColors.Muted)
                    }
                    selfReviewSaved -> Text("自评已保存，交卷时计入本次结果。", color = PhoneColors.Primary)
                    else -> Text("在纸上完成，再拍照上传清晰的解题过程。", color = PhoneColors.Muted, style = MaterialTheme.typography.bodyMedium)
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (savedPhoto != null || selfReviewSaved) PhoneAction("重新拍照", onTakePhoto, Modifier.weight(1f),
                        primary = false, enabled = !busy)
                    PhoneAction("从相册选择", onPickPhoto, Modifier.weight(1f), primary = false, enabled = !busy)
                }
                if (canSelfReview) {
                    HorizontalDivider(color = PhoneColors.Divider)
                    TextButton(onClick = { selfReview = true }, enabled = !busy, contentPadding = PaddingValues(0.dp)) {
                        Text(if (selfReviewSaved) "查看或修改自评" else "对照解析自评")
                        Spacer(Modifier.weight(1f))
                        PhoneIcon(PhoneSymbol.Next, Modifier.size(20.dp), PhoneColors.Primary)
                    }
                }
            }
            if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            if (preparingPhoto) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                Text("正在准备照片…", color = PhoneColors.Muted)
            }
            Spacer(Modifier.height(4.dp))
        }
    }
    if (answerCard) PhonePracticeSheet("答题卡", { answerCard = false }) {
        Text("已答 ${answeredIndexes.size} / $total 题", color = PhoneColors.Muted)
        (0 until total).chunked(5).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEach { questionIndex ->
                    val completed = questionIndex in answeredIndexes
                    val current = questionIndex == index
                    OutlinedButton(
                        onClick = { answerCard = false; onQuestionSelect(questionIndex) },
                        modifier = Modifier.weight(1f).heightIn(min = 48.dp).semantics {
                            contentDescription = "第 ${questionIndex + 1} 题，${if (completed) "已答" else "未答"}${if (current) "，当前题" else ""}"
                        },
                        shape = RoundedCornerShape(10.dp), contentPadding = PaddingValues(0.dp),
                        border = androidx.compose.foundation.BorderStroke(if (current) 2.dp else 1.dp,
                            if (current || completed) PhoneColors.Primary else PhoneColors.Divider),
                        colors = ButtonDefaults.outlinedButtonColors(containerColor = if (completed) PhoneColors.Soft else Color.White),
                    ) { Text("${questionIndex + 1}") }
                }
                repeat(5 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
        if (paperBatchContent != null) TextButton(onClick = { answerCard = false; paperBatch = true }) {
            Text(if (paperBatchCount > 0) "整卷照片 · 已选 $paperBatchCount 张" else "上传整卷作答照片")
        }
        PhoneAction("交卷批改", { answerCard = false; onSubmit() }, Modifier.fillMaxWidth(), enabled = !busy)
    }
    if (selfReview && !locked) PhonePracticeSheet("解析与自评", { selfReview = false }) {
        selfReviewContent { selfReview = false }
    }
    if (paperBatch && paperBatchContent != null && !locked) PhonePracticeSheet("整卷作答照片", { paperBatch = false }) {
        paperBatchContent { paperBatch = false }
    }
    if (pendingPhoto != null && !locked) PhonePracticeSheet("确认作答照片", onCancelPhoto) {
        Text("检查题号与解题过程是否清晰、完整。", color = PhoneColors.Muted, style = MaterialTheme.typography.bodyMedium)
        Image(pendingPhoto.previewBitmap.asImageBitmap(), "待确认的作答图片",
            Modifier.fillMaxWidth().heightIn(min = 120.dp, max = 320.dp).background(PhoneColors.Background, RoundedCornerShape(12.dp)),
            contentScale = ContentScale.Fit)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            PhoneAction("旋转", onRotatePhoto, Modifier.weight(1f), primary = false)
            PhoneAction("裁剪", onCropPhoto, Modifier.weight(1f), primary = false)
            PhoneAction("重拍", onRetakePhoto, Modifier.weight(1f), primary = false)
        }
        if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
        PhoneAction(if (singleQuestion) "确认并批改" else "保存到本题", onSavePhoto, Modifier.fillMaxWidth())
        TextButton(onClick = onCancelPhoto, modifier = Modifier.align(Alignment.CenterHorizontally)) { Text("取消，保留原作答") }
    }
    if (viewPhoto && bitmap != null) ImagePreviewDialog(
        bitmap.asImageBitmap(), "已保存的完整作答图片", onDismiss = { viewPhoto = false },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PhonePracticeSheet(title: String, close: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    val maximumHeight = (LocalConfiguration.current.screenHeightDp * 0.86f).dp
    ModalBottomSheet(onDismissRequest = close, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Color.White) {
        Column(Modifier.fillMaxWidth().heightIn(max = maximumHeight).padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
                IconButton(onClick = close, modifier = Modifier.semantics { contentDescription = "关闭$title" }) { PhoneIcon(PhoneSymbol.Close) }
            }
            Column(Modifier.fillMaxWidth().weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(bottom = 20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp), content = content)
        }
    }
}

@Composable
internal fun rememberPhoneAnswerBitmap(photo: LocalImageFile?): Bitmap? {
    val bitmap by produceState<Bitmap?>(null, photo?.path, photo?.contentHash) {
        value = null
        value = withContext(Dispatchers.IO) {
            photo?.let {
                runCatching {
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeFile(it.path, bounds)
                    BitmapFactory.decodeFile(it.path, BitmapFactory.Options().apply {
                        inSampleSize = answerPhotoDecodeSampleSize(bounds.outWidth, bounds.outHeight)
                    })
                }.getOrNull()
            }
        }
    }
    return bitmap
}


@Composable
internal fun PhoneQuestionImagePreview(url: String, onDismiss: () -> Unit) {
    var attempt by remember(url) { mutableIntStateOf(0) }
    val result by produceState<Pair<Bitmap?, Boolean>>(null to false, url, attempt) {
        value = null to false
        val bitmap = withContext(Dispatchers.IO) {
            runCatching {
                val connection = java.net.URL(url).openConnection().apply {
                    connectTimeout = 10_000
                    readTimeout = 15_000
                }
                connection.getInputStream().use { BitmapFactory.decodeStream(it) }
            }.getOrNull()
        }
        value = bitmap to true
    }
    val bitmap = result.first
    if (bitmap != null) ImagePreviewDialog(bitmap.asImageBitmap(), "图片，可双指缩放", onDismiss)
    else AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (result.second) "图片暂时未能打开" else "正在打开图片") },
        text = { if (result.second) Text("请检查网络后重试。") else CircularProgressIndicator(Modifier.size(28.dp)) },
        confirmButton = { if (result.second) TextButton(onClick = { attempt += 1 }) { Text("重试") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("关闭") } },
    )
}
