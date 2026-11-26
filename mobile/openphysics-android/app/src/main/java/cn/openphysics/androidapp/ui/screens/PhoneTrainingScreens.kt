package cn.openphysics.androidapp.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import cn.openphysics.androidapp.domain.*
import cn.openphysics.androidapp.ui.Screen
import kotlin.math.roundToInt

@Composable
internal fun PhoneReinforcementContent(volumes: List<String>, selectedVolume: String, onVolume: (String) -> Unit,
    visible: List<ReinforcementChapterPlan>, preferred: ReinforcementChapterPlan?, latestPlan: ImprovementPlan?, report: ImprovementReport?,
    onChapter: (ReinforcementChapterPlan) -> Unit,
    onContinue: (ImprovementPlan) -> Unit, onPlan: (ImprovementPlan) -> Unit, onRediagnose: (ImprovementPlan) -> Unit,
    onReport: (ImprovementReport) -> Unit, onReports: () -> Unit, onDiagnostics: () -> Unit, onTrace: () -> Unit,
    accessRequired: Boolean, onAccountUnavailable: () -> Unit) {
    var volumesOpen by rememberSaveable { mutableStateOf(false) }
    when {
        latestPlan != null && !latestPlan.isCompleted() -> PhoneSoftSection {
            Text(if (accessRequired) "上次训练进度已保留" else "继续上次训练",
                style = MaterialTheme.typography.labelMedium, color = PhoneColors.Primary)
            Text(latestPlan.scopeName, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            if (accessRequired) {
                Text("登录后可继续本轮专项练与复测；已有检测结果和训练进度会保留。", color = PhoneColors.Muted)
                PhoneAction("登录后继续训练", onAccountUnavailable, Modifier.fillMaxWidth())
            } else {
                Text(latestPlan.currentTask()?.kpName ?: if (latestPlan.readyForRetest()) "补弱练习已完成，可以复测。" else "查看本轮检测与补弱进度。",
                    color = PhoneColors.Muted, style = MaterialTheme.typography.bodyMedium,
                    maxLines = 2, overflow = TextOverflow.Ellipsis)
                PhoneAction(reinforcementRecentPlanActionLabel(latestPlan), { onContinue(latestPlan) }, Modifier.fillMaxWidth(),
                    enabled = latestPlan.currentTask() != null || latestPlan.readyForRetest())
            }
            TextButton(onClick = { onPlan(latestPlan) }) { Text("查看检测结果与路径") }
            if (!accessRequired) TextButton(onClick = { onRediagnose(latestPlan) }) { Text("重新检测") }
        }
        preferred != null -> PhoneReinforcementRecommendation(preferred, accessRequired) { onChapter(preferred) }
        else -> Text("当前暂无可训练章节。", color = PhoneColors.Muted)
    }
    Row(Modifier.fillMaxWidth(), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        Text("选择章节", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        TextButton(onClick = { volumesOpen = true }, enabled = volumes.isNotEmpty()) { Text(mobileSyncVolumeLabel(selectedVolume)) }
    }
    if (visible.isNotEmpty()) PhoneCard {
        visible.forEachIndexed { index, plan ->
            val detail = if (plan.status == "未开始" || plan.status == "待检测")
                "已掌握 ${plan.masteredCount} / ${plan.kps.size} 个知识点 · 待检测"
            else "已掌握 ${plan.masteredCount} / ${plan.kps.size} 个知识点 · 当前 ${plan.weakCount} 个薄弱点"
            PhoneListRow(plan.chapter, detail, { onChapter(plan) }, plan.status, divider = index < visible.lastIndex)
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("学习记录", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Surface(shape = RoundedCornerShape(18.dp), color = Color.White,
            border = BorderStroke(1.dp, PhoneColors.Divider)) {
            Column {
                PhoneRecordItem(PhoneSymbol.Clock, "检测历史", "回看章节与单元检测", onDiagnostics)
                PhoneRecordDivider()
                PhoneRecordItem(PhoneSymbol.Train, "提升报告", "查看已完成的提升结果", onReports)
                report?.let {
                    PhoneRecentReportItem(it.summary.scopeName) { onReport(it) }
                }
                PhoneRecordDivider()
                PhoneRecordItem(PhoneSymbol.Review, "学习轨迹", "回看检测、补弱与复测", onTrace)
            }
        }
    }
    if (volumesOpen) PhonePracticeSheet("选择教材", { volumesOpen = false }) {
        volumes.forEach { volume -> PhoneListRow(volume, onClick = { onVolume(volume); volumesOpen = false }, badge = if (volume == selectedVolume) "当前" else "") }
    }
}

@Composable
private fun PhoneReinforcementRecommendation(plan: ReinforcementChapterPlan, accessRequired: Boolean, onClick: () -> Unit) {
    Surface(Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick),
        shape = RoundedCornerShape(18.dp), color = PhoneColors.Soft) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text("推荐章节 · ${mobileSyncVolumeLabel(plan.volume)}", style = MaterialTheme.typography.labelMedium,
                    color = PhoneColors.Primary, fontWeight = FontWeight.SemiBold)
                Text(plan.chapter, style = MaterialTheme.typography.titleMedium, color = PhoneColors.Ink,
                    fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(if (accessRequired) "登录后开启单元检测" else "单元检测 · 找出本章薄弱点",
                    style = MaterialTheme.typography.labelMedium, color = PhoneColors.Muted)
                PhoneInlineLink("进入本章")
            }
        }
    }
}

@Composable
private fun PhoneRecordItem(icon: PhoneSymbol, title: String, detail: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick)
        .padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(38.dp).background(PhoneColors.Soft, RoundedCornerShape(11.dp)),
            contentAlignment = Alignment.Center) {
            PhoneIcon(icon, Modifier.size(20.dp), PhoneColors.Primary)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
            Text(detail, style = MaterialTheme.typography.labelMedium, color = PhoneColors.Muted)
        }
        PhoneIcon(PhoneSymbol.Next, Modifier.size(17.dp), PhoneColors.Muted)
    }
}

@Composable
private fun PhoneRecordDivider() {
    HorizontalDivider(Modifier.padding(start = 66.dp, end = 16.dp), color = PhoneColors.Divider)
}

@Composable
private fun PhoneRecentReportItem(scopeName: String, onClick: () -> Unit) {
    Surface(onClick = onClick, modifier = Modifier.fillMaxWidth().padding(start = 66.dp, end = 16.dp, bottom = 12.dp)
        .heightIn(min = 48.dp), shape = RoundedCornerShape(10.dp), color = PhoneColors.Soft) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("最近完成", style = MaterialTheme.typography.labelSmall, color = PhoneColors.Muted)
                Text(scopeName, style = MaterialTheme.typography.labelMedium, color = PhoneColors.Primary,
                    maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            Text("查看", style = MaterialTheme.typography.labelMedium, color = PhoneColors.Primary)
        }
    }
}

@Composable
internal fun PhoneReinforcementChapter(plan: ReinforcementChapterPlan, onBack: () -> Unit,
    onDiagnostic: (ReinforcementChapterPlan) -> Unit, onDiagnostics: () -> Unit,
    accessRequired: Boolean, onAccountUnavailable: () -> Unit) {
    PhoneDetailPage("章节训练", onBack, footer = {
        PhoneAction(if (accessRequired) "登录后检测" else "开始单元检测",
            { if (accessRequired) onAccountUnavailable() else onDiagnostic(plan) }, Modifier.fillMaxWidth())
    }) {
        if (accessRequired) AccountUnavailableBanner(ReinforcementLockTitle, ReinforcementLockMessage, onAccountUnavailable)
        Text(mobileSyncVolumeLabel(plan.volume), color = PhoneColors.Muted, style = MaterialTheme.typography.labelMedium)
        val longChapterTitle = plan.chapter.length > 12
        Text(if (longChapterTitle) plan.chapter.replaceFirst(" ", "\n") else plan.chapter,
            style = if (longChapterTitle) MaterialTheme.typography.titleLarge else MaterialTheme.typography.headlineSmall)
        Text("${plan.kps.size} 个知识点 · ${plan.status}", color = PhoneColors.Muted)
        PhoneSoftSection {
            Text("单元检测", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text("先用一组题找出本章薄弱点，检测后按结果进入专项练和阶段复测。", color = PhoneColors.Muted)
        }
        PhoneListRow("检测历史", "查看以往检测结果和对应薄弱点", onDiagnostics)
    }
}

@Composable
internal fun PhoneGaokaoScreen(screen: Screen.GaokaoReview,
    onHome: () -> Unit, onLearn: () -> Unit, onPractice: () -> Unit, onReview: () -> Unit, onMe: () -> Unit,
    onSelect: (LearningCatalogNode) -> Unit, onToggle: (LearningCatalogNode) -> Unit,
    onLayer: (LearningCatalogNode, LearningCatalogTopicLayer) -> Unit,
    onRefresh: () -> Unit, onAccountUnavailable: () -> Unit) {
    // Keep the catalogue visible until the student chooses a topic; server selection still owns its data.
    val holder = LocalPhoneDirectoryState.current
    val content: @Composable () -> Unit = {
        var details by rememberSaveable { mutableStateOf(false) }
        val topic = screen.catalog.topic(screen.selectedTopicId)
        val hasAccess = StudentAccessPolicy.hasFullLearningAccess(screen.session)
        val start: (LearningCatalogTopicLayer) -> Unit = { layer ->
            // Locked entries open 账号状态 directly, as on the tablet and iOS.
            if (!hasAccess) onAccountUnavailable() else topic?.let { onLayer(it, layer) }
        }
        BackHandler(enabled = details) { details = false }
        if (details && topic != null) {
            PhoneDetailPage("专题复习", { details = false }, showFooter = false) {
                if (!hasAccess) AccountUnavailableBanner(GaokaoLockTitle, GaokaoLockMessage, onAccountUnavailable)
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("高考专题 ${topic.topicDisplayCode().toIntOrNull() ?: topic.topicDisplayCode()}",
                        color = PhoneColors.Primary, style = MaterialTheme.typography.labelMedium)
                    val longTopicTitle = topic.title.length > 12
                    Text(if (longTopicTitle) topic.title.replaceFirst("、", "、\n") else topic.title,
                        style = if (longTopicTitle) MaterialTheme.typography.titleLarge else MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold)
                }
                val overview = screen.overview?.takeIf { it.nodeId == topic.id }
                when {
                    screen.overviewLoading -> Text("正在读取专题进度…", color = PhoneColors.Muted)
                    overview == null -> {
                        Text(screen.message.ifBlank { "专题进度暂不可用，请重试。" }, color = PhoneColors.Muted)
                        PhoneAction("重新加载", onRefresh)
                    }
                    else -> {
                        PhoneGaokaoProgress(overview)
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            PhoneGaokaoRecommendedEntry(overview, hasAccess) { start(overview.recommendedLayer) }
                            Text("其他训练", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            Surface(shape = RoundedCornerShape(16.dp), color = Color.White,
                                border = BorderStroke(1.dp, PhoneColors.Divider)) {
                                Column {
                                    val otherLayers = (listOf(LearningCatalogTopicLayer.Diagnostic) + gaokaoTrainingLayers())
                                        .filterNot { it == overview.recommendedLayer }
                                    otherLayers.forEachIndexed { index, layer ->
                                        PhoneGaokaoLayerRow(layer) { start(layer) }
                                        if (index < otherLayers.lastIndex) HorizontalDivider(
                                            Modifier.padding(start = 62.dp), color = PhoneColors.Divider)
                                    }
                                }
                            }
                        }
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text("整卷训练", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            PhoneGaokaoPaperEntry("专题套卷", "10 题 · 整卷提交后统一批改", if (hasAccess) "" else "登录后开启",
                                { start(LearningCatalogTopicLayer.Paper) })

                        }
                        Text("专题表现按已作答题目计算。", style = MaterialTheme.typography.labelMedium,
                            color = PhoneColors.Muted)
                    }
                }
                if (screen.evidenceSyncMessage.isNotBlank()) {
                    Text(screen.evidenceSyncMessage, color = PhoneColors.Muted)
                    TextButton(onClick = onRefresh) { Text("重试同步") }
                }
            }
        } else MainPage(MainTab.Learn, onHome, onLearn, onPractice, onReview, onMe) {
            val blocks = screen.catalog.knowledgeBlocks()
            // iOS: a count line, then one card per knowledge block; the open block is tinted
            // and lists its topics with two-digit numbers.
            Text("${blocks.size} 个知识板块 · ${blocks.sumOf { it.topics().size }} 个专题",
                style = MaterialTheme.typography.labelMedium, color = PhoneColors.Muted)
            if (blocks.isEmpty()) Text("暂无可用专题。", color = PhoneColors.Muted)
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                blocks.forEach { block ->
                    val expanded = screen.expandedBlockId == block.id
                    val topics = block.topics()
                    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Color.White)
                        .border(1.dp, if (expanded) PhoneColors.Primary.copy(alpha = 0.25f) else PhoneColors.CardStroke, RoundedCornerShape(18.dp))) {
                        Row(Modifier.fillMaxWidth().background(if (expanded) PhoneColors.Soft else Color.White)
                            .clickable(role = Role.Button) { onToggle(block) }.padding(horizontal = 16.dp, vertical = 14.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Text(block.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                                Text("${topics.size} 个专题", style = MaterialTheme.typography.labelMedium, color = PhoneColors.Muted)
                            }
                            PhoneIcon(if (expanded) PhoneSymbol.Up else PhoneSymbol.Down, Modifier.size(18.dp),
                                if (expanded) PhoneColors.Primary else PhoneColors.Muted)
                        }
                        if (expanded) topics.forEachIndexed { index, child ->
                            HorizontalDivider(color = PhoneColors.Divider)
                            val current = child.id == screen.selectedTopicId
                            Row(Modifier.fillMaxWidth().background(if (current) PhoneColors.Soft else Color.White)
                                .clickable(role = Role.Button) { details = true; onSelect(child) }
                                .padding(horizontal = 16.dp, vertical = 13.dp),
                                horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                                // Gaokao topics keep their catalogue number across blocks (14, 15, 16…), as on iOS.
                                val code = child.topicDisplayCode().toIntOrNull()?.let { "%02d".format(it) } ?: child.topicDisplayCode().ifBlank { "%02d".format(index + 1) }
                                Text(code, style = MaterialTheme.typography.titleMedium,
                                    color = PhoneColors.Primary, fontWeight = FontWeight.SemiBold)
                                Text(child.title, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium,
                                    color = if (current) PhoneColors.Primary else PhoneColors.Ink)
                                if (current) Text("最近", style = MaterialTheme.typography.labelSmall, color = PhoneColors.Primary)
                            }
                        }
                    }
                }
            }
        }
    }
    if (holder != null) holder.SaveableStateProvider("gaokao") { content() } else content()
}

@Composable
private fun PhoneGaokaoProgress(overview: LearningCatalogTopicOverview) {
    val gradingPapers = overview.teacherPapers.count { it.status == "grading" }
    val coverage = if (overview.coreKnowledgePointCount > 0)
        (overview.attemptedKnowledgePointCount.toFloat() / overview.coreKnowledgePointCount).coerceIn(0f, 1f)
        else 0f
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        val performance: @Composable (Modifier) -> Unit = { modifier ->
            Column(modifier, verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(overview.performanceScore?.let { "${(it * 100).roundToInt().coerceIn(0, 100)}%" } ?: "—",
                    style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = PhoneColors.Ink)
                Text(if (overview.performanceScore == null) "专题表现待检测" else "专题作答表现",
                    style = MaterialTheme.typography.labelMedium, color = PhoneColors.Muted)
            }
        }
        val tested: @Composable (Modifier, Alignment.Horizontal) -> Unit = { modifier, alignment ->
            Column(modifier, horizontalAlignment = alignment, verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text("${overview.attemptedKnowledgePointCount}/${overview.coreKnowledgePointCount}",
                    style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text("知识点已检测", style = MaterialTheme.typography.labelMedium, color = PhoneColors.Muted)
            }
        }
        if (LocalConfiguration.current.screenWidthDp < 340 || LocalDensity.current.fontScale > 1.25f) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                performance(Modifier)
                tested(Modifier, Alignment.Start)
            }
        } else {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Bottom) {
                performance(Modifier.weight(1f))
                tested(Modifier, Alignment.End)
            }
        }
        LinearProgressIndicator(progress = { coverage }, modifier = Modifier.fillMaxWidth().height(4.dp),
            color = PhoneColors.Primary, trackColor = PhoneColors.Soft, gapSize = 0.dp, drawStopIndicator = {})
        Text("${overview.statusLabel} · ${overview.evidenceCount} 条作答记录",
            style = MaterialTheme.typography.labelMedium, color = PhoneColors.Muted)
        if (gradingPapers > 0) Text("$gradingPapers 份套卷批改中，可在下方查看进度。",
            style = MaterialTheme.typography.labelMedium, color = PhoneColors.Primary)
    }
}

@Composable
private fun PhoneGaokaoRecommendedEntry(overview: LearningCatalogTopicOverview, hasAccess: Boolean,
    onClick: () -> Unit) {
    Surface(Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick),
        shape = RoundedCornerShape(16.dp), color = PhoneColors.Soft,
        border = BorderStroke(1.dp, PhoneColors.Primary.copy(alpha = 0.22f))) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(if (!hasAccess) "登录后开启" else if (overview.evidenceCount > 0) "依据近期作答推荐" else "建议从这里开始",
                style = MaterialTheme.typography.labelMedium,
                color = PhoneColors.Primary, fontWeight = FontWeight.SemiBold)
            Text(overview.recommendedLayer.title, style = MaterialTheme.typography.titleLarge,
                color = PhoneColors.Ink, fontWeight = FontWeight.Bold)
            Text("${overview.recommendedLayer.questionCount} 题 · ${gaokaoLayerPurpose(overview.recommendedLayer)}",
                style = MaterialTheme.typography.labelMedium, color = PhoneColors.Muted)
            PhoneInlineLink(if (hasAccess) "开始训练" else "登录后开始")
        }
    }
}

private fun gaokaoLayerPurpose(layer: LearningCatalogTopicLayer): String = when (layer) {
    LearningCatalogTopicLayer.Diagnostic -> "找薄弱"
    LearningCatalogTopicLayer.Foundation -> "稳基础"
    LearningCatalogTopicLayer.Breakthrough -> "练模型"
    LearningCatalogTopicLayer.Transfer -> "做综合"
    else -> ""
}

@Composable
private fun PhoneGaokaoLayerRow(layer: LearningCatalogTopicLayer, onClick: () -> Unit) {
    val icon = when (layer) {
        LearningCatalogTopicLayer.Diagnostic -> PhoneSymbol.Clock
        LearningCatalogTopicLayer.Foundation -> PhoneSymbol.Book
        LearningCatalogTopicLayer.Breakthrough -> PhoneSymbol.Train
        LearningCatalogTopicLayer.Transfer -> PhoneSymbol.Graduation
        else -> PhoneSymbol.Review
    }
    Row(Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick)
        .padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.size(34.dp).background(PhoneColors.Soft, RoundedCornerShape(10.dp)),
            contentAlignment = Alignment.Center) {
            PhoneIcon(icon, Modifier.size(19.dp), PhoneColors.Primary)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(layer.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
            Text("${layer.questionCount} 题 · ${gaokaoLayerPurpose(layer)}",
                style = MaterialTheme.typography.labelMedium, color = PhoneColors.Muted)
        }
        PhoneIcon(PhoneSymbol.Next, Modifier.size(17.dp), PhoneColors.Muted)
    }
}

@Composable
private fun PhoneGaokaoPaperEntry(title: String, detail: String, status: String, onClick: () -> Unit) {
    Surface(Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick),
        shape = RoundedCornerShape(16.dp), color = Color.White, border = BorderStroke(1.dp, PhoneColors.Divider)) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(40.dp).background(PhoneColors.Soft, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                PhoneIcon(PhoneSymbol.Review, Modifier.size(22.dp), PhoneColors.Primary)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Bold)
                Text(detail, style = MaterialTheme.typography.labelMedium, color = PhoneColors.Muted)
                if (status.isNotBlank()) Text(status, style = MaterialTheme.typography.labelMedium, color = PhoneColors.Primary)
            }
            PhoneIcon(PhoneSymbol.Next, Modifier.size(18.dp), PhoneColors.Muted)
        }
    }
}

/** A tappable card's call to action: accent label plus the shared chevron instead of a text arrow. */
@Composable
internal fun PhoneInlineLink(text: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(text, style = MaterialTheme.typography.labelMedium, color = PhoneColors.Primary, fontWeight = FontWeight.SemiBold)
        PhoneIcon(PhoneSymbol.Next, Modifier.size(14.dp), PhoneColors.Primary)
    }
}
