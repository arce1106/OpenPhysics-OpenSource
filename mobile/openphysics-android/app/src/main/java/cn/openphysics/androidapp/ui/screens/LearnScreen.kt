package cn.openphysics.androidapp.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.font.FontWeight
import cn.openphysics.androidapp.domain.KpNode
import cn.openphysics.androidapp.domain.LearnBundle
import cn.openphysics.androidapp.domain.KnowledgeCard
import cn.openphysics.androidapp.domain.VideoItem
import cn.openphysics.androidapp.domain.TutorChatMessage
import cn.openphysics.androidapp.ui.KpAssessmentProgress
import cn.openphysics.androidapp.ui.TutorRequestState
import cn.openphysics.androidapp.ui.components.LearningCard
import cn.openphysics.androidapp.ui.components.StatusChip
import cn.openphysics.androidapp.ui.design.OpenPhysicsColors
import cn.openphysics.androidapp.ui.design.OpenPhysicsElevation
import cn.openphysics.androidapp.ui.design.OpenPhysicsRadius
import cn.openphysics.androidapp.ui.design.OpenPhysicsSpacing
import cn.openphysics.androidapp.ui.design.OpenPhysicsTone
import cn.openphysics.androidapp.ui.toLearnResourceGroups
import java.net.URI

private val LEARN_QUICK_PROMPTS = listOf(
    "这个知识点怎么理解？",
    "换一种说法讲",
    "问我一道检查题",
    "这个知识点常错在哪？",
)

data class LearnResourceCard(
    val source: String,
    val badge: String,
    val title: String,
    val subtitle: String,
    val tone: OpenPhysicsTone,
    val video: VideoItem? = null,
)

fun learnTutorQuickPrompts(): List<String> = LEARN_QUICK_PROMPTS

fun learnResourceCards(lecture: VideoItem?, demonstration: VideoItem?): List<LearnResourceCard> {
    return buildList {
        lecture?.let { video ->
            add(
                LearnResourceCard(
                    source = "讲解视频",
                    badge = "最相关讲解",
                    title = video.title.takeIf { it.startsWith("B站搜索") } ?: "B站搜索：${video.title}",
                    subtitle = video.uploader,
                    tone = OpenPhysicsTone.Primary,
                    video = video,
                ),
            )
        }
        demonstration?.let { video ->
            add(
                LearnResourceCard(
                    source = "实验演示",
                    badge = "看现象",
                    title = video.title,
                    subtitle = video.uploader,
                    tone = OpenPhysicsTone.Warning,
                    video = video,
                ),
            )
        }
    }
}

fun learnResourceCards(bundle: LearnBundle): List<LearnResourceCard> {
    val resources = bundle.toLearnResourceGroups()
    return learnResourceCards(resources.lecture, resources.demonstration)
}

/** Search fallbacks are links to results, not a curated video lesson. */
internal fun isBilibiliSearchResource(video: VideoItem): Boolean {
    if (video.title.startsWith("B站搜索")) return true
    return runCatching { URI(video.url).host?.equals("search.bilibili.com", ignoreCase = true) == true }
        .getOrDefault(false)
}

internal enum class LearnTab(val title: String) {
    Card("卡片"),
    Resource("讲解"),
    Slides("微课"),
    Interactive("互动"),
}

internal fun availableLearnTabs(bundle: LearnBundle): List<LearnTab> = buildList {
    if (bundle.card != null) add(LearnTab.Card)
    add(LearnTab.Resource)
    if (bundle.slides?.items?.isNotEmpty() == true) add(LearnTab.Slides)
    if (bundle.simulations.isNotEmpty() || bundle.examples.isNotEmpty()) add(LearnTab.Interactive)
}

internal fun learnProgressText(bundle: LearnBundle): String {
    val total = bundle.progress.values.sumOf { it.total }
    if (total <= 0) return ""
    val consumed = bundle.progress.values.sumOf { it.consumed }.coerceAtMost(total)
    return "学习进度 $consumed/$total"
}

@Composable
fun LearnScreen(
    kp: KpNode,
    bundle: LearnBundle,
    startWithVideo: Boolean = false,
    onBack: () -> Unit,
    onPractice: () -> Unit,
    chatMessages: List<TutorChatMessage>,
    onAskTutor: (String) -> Unit,
    onVideo: (String) -> Unit,
    requestState: TutorRequestState = TutorRequestState(),
    assessmentProgress: KpAssessmentProgress? = null,
) {
    var tutorInput by remember(kp.id) { mutableStateOf("") }
    var tutorError by remember(kp.id) { mutableStateOf("") }
    val availableTabs = remember(bundle) { availableLearnTabs(bundle) }
    var selectedTab by remember(kp.id, availableTabs, startWithVideo) {
        mutableStateOf(if (startWithVideo) LearnTab.Resource else availableTabs.first())
    }

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

    if (LocalPhonePresentation.current) {
        PhoneLearnContent(kp, bundle, onBack, onPractice, onVideo, assessmentProgress, availableTabs, selectedTab,
            { selectedTab = it }, chatMessages, tutorInput, tutorError,
            { tutorInput = it; tutorError = "" }, ::submitTutorQuestion, requestState)
        return
    }
    // iPad: AI 助教 is a title-bar action that opens the panel, never a button floating over the card.
    var tutorOpen by remember(kp.id) { mutableStateOf(false) }
    Box(modifier = Modifier.fillMaxSize()) {
        TabletLearnWorkbench(
            kp = kp,
            bundle = bundle,
            assessmentProgress = assessmentProgress,
            availableTabs = availableTabs,
            selectedTab = selectedTab,
            onSelectTab = { selectedTab = it },
            onBack = onBack,
            onPractice = onPractice,
            onVideo = onVideo,
            onOpenTutor = { tutorOpen = !tutorOpen },
        )
        if (tutorOpen) {
            TutorAssistantPanel(
                policy = learnTutorAssistantPolicy(),
                chatMessages = chatMessages,
                input = tutorInput,
                error = tutorError,
                onInputChange = {
                    tutorInput = it
                    tutorError = ""
                },
                onSubmit = ::submitTutorQuestion,
                onDismiss = { tutorOpen = false },
                requestState = requestState,
                reserveTriggerSpace = false,
            )
        }
    }
}

@Composable
private fun TabletLearnWorkbench(
    kp: KpNode,
    bundle: LearnBundle,
    assessmentProgress: KpAssessmentProgress?,
    availableTabs: List<LearnTab>,
    selectedTab: LearnTab,
    onSelectTab: (LearnTab) -> Unit,
    onBack: () -> Unit,
    onPractice: () -> Unit,
    onVideo: (String) -> Unit,
    onOpenTutor: () -> Unit,
) {
    val title = bundle.kpName.ifBlank { kp.name }
    val card = bundle.card
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(OpenPhysicsColors.Background)
            .padding(OpenPhysicsSpacing.PageHorizontal),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        TabletLearnHeader(
            kp = kp,
            title = title,
            bundle = bundle,
            availableTabs = availableTabs,
            selectedTab = selectedTab,
            onSelectTab = onSelectTab,
            onBack = onBack,
            onOpenTutor = onOpenTutor,
        )
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            when (selectedTab) {
                LearnTab.Card -> Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    TabletKnowledgeCardPanel(card = card)
                }
                LearnTab.Resource -> Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    TabletResourcePanel(
                        modifier = Modifier.fillMaxWidth(),
                        bundle = bundle,
                        onVideo = onVideo,
                    )
                }
                LearnTab.Slides -> Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    SlideDeckPanel(bundle)
                }
                LearnTab.Interactive -> Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    InteractiveResourcePanel(bundle)
                }
            }
        }
        // iPad: the confirmation sits in a fixed bar under the card, where reading ends.
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(OpenPhysicsColors.Surface, RoundedCornerShape(OpenPhysicsRadius.Large))
                .padding(start = 18.dp, end = 10.dp, top = 8.dp, bottom = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "ⓘ  " + learnPracticeHintText(kp, card, assessmentProgress),
                modifier = Modifier.weight(1f),
                color = OpenPhysicsColors.Muted,
                style = MaterialTheme.typography.bodyMedium,
            )
            TabletBarAction(learnPracticeActionText(kp, card, assessmentProgress), onPractice)
        }
    }
}

@Composable
private fun TabletLearnHeader(
    kp: KpNode,
    title: String,
    bundle: LearnBundle,
    availableTabs: List<LearnTab>,
    selectedTab: LearnTab,
    onSelectTab: (LearnTab) -> Unit,
    onBack: () -> Unit,
    onOpenTutor: () -> Unit,
) {
    val status = learningKpStatus(kp)
    val breadcrumb = listOf(kp.volume, kp.chapter, kp.section).filter { it.isNotBlank() }.joinToString(" / ")
    val total = bundle.progress.values.sumOf { it.total }
    val consumed = bundle.progress.values.sumOf { it.consumed }.coerceAtMost(total)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(OpenPhysicsColors.Surface, RoundedCornerShape(OpenPhysicsRadius.Large))
            .padding(start = 6.dp, end = 12.dp, top = 8.dp, bottom = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TabletSidebarRestoreButton()
            TabletBackButton(onClick = onBack)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(title, color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (breadcrumb.isNotBlank()) {
                    Text(breadcrumb, color = OpenPhysicsColors.Muted, style = MaterialTheme.typography.labelMedium,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            StatusChip(status.label, tone = status.tone)
            TabletLearnMetric("${kp.masteryPercent()}%", "当前掌握")
            if (total > 0) TabletLearnMetric("$consumed/$total", "学习进度")
            TabletBarAction("AI 助教", onOpenTutor, primary = false, symbol = PhoneSymbol.Sparkle)
        }
        if (availableTabs.size > 1) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 6.dp).selectableGroup(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                availableTabs.forEach { tab ->
                    val active = tab == selectedTab
                    val content = if (active) Color.White else OpenPhysicsColors.PrimaryDeep
                    Row(
                        modifier = Modifier
                            .weight(1f)
                            .heightIn(min = 42.dp)
                            .clip(RoundedCornerShape(OpenPhysicsRadius.Pill))
                            .background(if (active) OpenPhysicsColors.PrimaryDeep else OpenPhysicsColors.PrimarySoft)
                            .selectable(selected = active, role = Role.Tab) { onSelectTab(tab) },
                        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        when (tab) {
                            LearnTab.Card -> PhoneIcon(PhoneSymbol.Cards, Modifier.size(18.dp), content)
                            LearnTab.Resource -> PhoneIcon(PhoneSymbol.Play, Modifier.size(18.dp), content)
                            else -> Unit
                        }
                        Text(tab.title, color = content, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}

@Composable
private fun TabletLearnMetric(value: String, label: String) {
    Column(
        modifier = Modifier
            .background(OpenPhysicsColors.NeutralSoft, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .padding(horizontal = 14.dp, vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(value, color = OpenPhysicsColors.PrimaryDeep, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Text(label, color = OpenPhysicsColors.Muted, style = MaterialTheme.typography.labelSmall)
    }
}

@Composable
private fun TabletKnowledgeCardPanel(card: KnowledgeCard?) {
    // The Pane already titles the card; a second card header only repeated it.
    if (card == null || card.sections.isEmpty()) {
        LearningCard(title = "概念、公式与例题") {
            MutedText("暂无知识卡片，可以先进入掌握评估确认当前掌握情况。")
        }
        return
    }
    KnowledgeCardPaneWebView(
        card = card,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(OpenPhysicsRadius.Large)),
        minimumHeightDp = 420,
    )
}

@Composable
private fun TabletResourcePanel(
    modifier: Modifier = Modifier,
    bundle: LearnBundle,
    onVideo: (String) -> Unit,
) {
    val cards = learnResourceCards(bundle)
    TabletFilledPanel(
        modifier = modifier,
        title = "视频 / 演示推荐",
    ) {
        if (cards.isEmpty()) {
            MutedText("暂无学习资源推荐。")
            return@TabletFilledPanel
        }
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            cards.forEach { card ->
                TabletResourceItem(
                    source = card.source,
                    badge = card.badge,
                    title = card.title,
                    subtitle = card.subtitle,
                    tone = card.tone,
                    onClick = { card.video?.url?.let(onVideo) },
                )
            }
        }
    }
}

@Composable
private fun TabletResourceItem(
    source: String,
    badge: String,
    title: String,
    subtitle: String,
    tone: OpenPhysicsTone,
    onClick: () -> Unit,
) {
    val accent = when (tone) {
        OpenPhysicsTone.Success -> Color(0xFF16A34A)
        OpenPhysicsTone.Warning -> Color(0xFFD97706)
        OpenPhysicsTone.Primary -> OpenPhysicsColors.Primary
        OpenPhysicsTone.Danger -> Color(0xFFDC2626)
        OpenPhysicsTone.Neutral -> OpenPhysicsColors.Muted
    }
    val soft = when (tone) {
        OpenPhysicsTone.Warning -> Color(0xFFFFFBEB)
        OpenPhysicsTone.Success -> Color(0xFFF0FDF4)
        else -> OpenPhysicsColors.PrimarySoft
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(soft.copy(alpha = 0.55f), RoundedCornerShape(OpenPhysicsRadius.Medium))
            .border(BorderStroke(1.dp, OpenPhysicsColors.Border), RoundedCornerShape(OpenPhysicsRadius.Medium))
            .clickable(onClick = onClick)
            .padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .width(104.dp)
                .height(68.dp)
                .background(OpenPhysicsColors.NeutralSoft, RoundedCornerShape(OpenPhysicsRadius.Small)),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = source,
                color = OpenPhysicsColors.PrimaryDeep,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Normal,
            )
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                text = badge,
                color = accent,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Normal,
            )
            Text(
                text = title,
                color = OpenPhysicsColors.Ink,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Normal,
            )
            Text(
                text = subtitle,
                color = OpenPhysicsColors.Muted,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}

@Composable
private fun TabletFilledPanel(
    modifier: Modifier = Modifier,
    title: String = "",
    subtitle: String = "",
    meta: String = "",
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(OpenPhysicsRadius.Large),
        colors = CardDefaults.cardColors(containerColor = OpenPhysicsColors.Surface),
        elevation = CardDefaults.cardElevation(defaultElevation = OpenPhysicsElevation.Card),
        border = BorderStroke(1.dp, OpenPhysicsColors.Border),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(OpenPhysicsSpacing.CardPadding),
            verticalArrangement = Arrangement.spacedBy(OpenPhysicsSpacing.CardGap),
        ) {
            if (title.isNotBlank() || subtitle.isNotBlank() || meta.isNotBlank()) {
                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    if (meta.isNotBlank()) {
                        Text(
                            text = meta,
                            color = OpenPhysicsColors.PrimaryDeep,
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.Normal,
                        )
                    }
                    if (title.isNotBlank()) {
                        Text(
                            text = title,
                            color = OpenPhysicsColors.Ink,
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Normal,
                        )
                    }
                    if (subtitle.isNotBlank()) {
                        Text(
                            text = subtitle,
                            color = OpenPhysicsColors.Muted,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }
            }
            content()
        }
    }
}

@Composable
internal fun SlideDeckPanel(bundle: LearnBundle) {
    val deck = bundle.slides
    if (LocalPhonePresentation.current) {
        Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
            Text(deck?.title?.takeIf { it.isNotBlank() } ?: "微课",
                style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            if (deck == null || deck.items.isEmpty()) {
                Text("暂无微课内容。", style = MaterialTheme.typography.bodyMedium, color = PhoneColors.Muted)
            } else {
                deck.items.forEachIndexed { index, item ->
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("第 ${index + 1} 段", style = MaterialTheme.typography.labelMedium, color = PhoneColors.Primary)
                        if (item.title.isNotBlank()) Text(item.title, style = MaterialTheme.typography.titleMedium)
                        if (item.rendered?.html?.isNotBlank() == true) RenderedRichText(item.rendered)
                        else PhysicsRichText(item.body)
                    }
                    if (index < deck.items.lastIndex) HorizontalDivider(color = PhoneColors.Divider)
                }
            }
        }
        return
    }
    LearningCard(
        title = deck?.title?.takeIf { it.isNotBlank() } ?: "微课",
        subtitle = "按网页学习顺序补充关键概念和例题。",
    ) {
        if (deck == null || deck.items.isEmpty()) {
            MutedText("暂无微课内容。")
            return@LearningCard
        }
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            deck.items.forEachIndexed { index, item ->
                LearningCard(
                    meta = "第 ${index + 1} 段",
                    title = item.title,
                ) {
                    if (item.rendered?.html?.isNotBlank() == true) {
                        RenderedRichText(item.rendered)
                    } else {
                        PhysicsRichText(item.body)
                    }
                }
            }
        }
    }
}

@Composable
internal fun InteractiveResourcePanel(bundle: LearnBundle) {
    if (LocalPhonePresentation.current) {
        Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
            Text("互动与示例", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            if (bundle.simulations.isEmpty() && bundle.examples.isEmpty()) {
                Text("暂无互动或示例资源。", style = MaterialTheme.typography.bodyMedium, color = PhoneColors.Muted)
            }
            bundle.simulations.forEach { simulation ->
                Column(Modifier.fillMaxWidth().background(PhoneColors.Soft, RoundedCornerShape(14.dp)).padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(if (simulation.consumed) "互动资源 · 已学习" else "互动资源",
                        style = MaterialTheme.typography.labelMedium, color = PhoneColors.Primary)
                    Text(simulation.title.ifBlank { "互动模拟" }, style = MaterialTheme.typography.titleMedium)
                    Text("围绕这个模型观察变量关系，再结合知识卡完成推理并进入评估验证。",
                        style = MaterialTheme.typography.bodyMedium, color = PhoneColors.Muted)
                }
            }
            bundle.examples.forEachIndexed { index, example ->
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("示例", style = MaterialTheme.typography.labelMedium, color = PhoneColors.Primary)
                    Text(example.title, style = MaterialTheme.typography.titleMedium)
                    if (example.body.isNotBlank()) PhysicsRichText(example.body)
                    else Text("带着这个示例回看知识卡，再进入掌握评估确认是否理解。",
                        style = MaterialTheme.typography.bodyMedium, color = PhoneColors.Muted)
                }
                if (index < bundle.examples.lastIndex) HorizontalDivider(color = PhoneColors.Divider)
            }
        }
        return
    }
    LearningCard(
        title = "互动与示例",
        subtitle = "先明确观察任务，再回到知识卡和评估验证理解。",
    ) {
        if (bundle.simulations.isEmpty() && bundle.examples.isEmpty()) {
            MutedText("暂无互动或示例资源。")
            return@LearningCard
        }
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            bundle.simulations.forEach { simulation ->
                LearningCard(
                    meta = if (simulation.consumed) "互动资源 · 已学习" else "互动资源",
                    title = simulation.title.ifBlank { "互动模拟" },
                ) {
                    MutedText("围绕这个模型观察变量关系，再结合知识卡完成推理并进入评估验证。")
                }
            }
            bundle.examples.forEach { example ->
                LearningCard(meta = "示例", title = example.title) {
                    if (example.body.isNotBlank()) {
                        PhysicsRichText(example.body)
                    } else {
                        MutedText("带着这个示例回看知识卡，再进入掌握评估确认是否理解。")
                    }
                }
            }
        }
    }
}

internal fun learnPracticeActionText(kp: KpNode, card: KnowledgeCard?, assessmentProgress: KpAssessmentProgress? = null): String {
    if (phoneKpAssessmentAction(kp, assessmentProgress).isConsolidation) return "去巩固小练"
    if (assessmentProgress == KpAssessmentProgress.InProgress) return "重新评估"
    return if (card?.consumed == true || card == null) "开始掌握评估" else "我已理解，开始评估"
}

private fun learnPracticeHintText(kp: KpNode, card: KnowledgeCard?, assessmentProgress: KpAssessmentProgress? = null): String {
    if (shouldUseConsolidationPractice(kp, assessmentProgress)) return "已进入巩固阶段，可通过练习保持熟练"
    return if (card?.consumed == true) "已学习知识卡片" else "先完成知识卡片，再进入掌握评估"
}
