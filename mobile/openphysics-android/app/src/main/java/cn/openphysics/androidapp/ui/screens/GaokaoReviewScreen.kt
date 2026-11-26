package cn.openphysics.androidapp.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import cn.openphysics.androidapp.domain.LearningCatalogData
import cn.openphysics.androidapp.domain.LearningCatalogNode
import cn.openphysics.androidapp.domain.LearningCatalogTopicLayer
import cn.openphysics.androidapp.domain.LearningCatalogTopicOverview
import cn.openphysics.androidapp.ui.Screen
import cn.openphysics.androidapp.ui.components.PrimaryActionButton
import cn.openphysics.androidapp.ui.components.SecondaryActionButton
import cn.openphysics.androidapp.ui.components.StatusChip
import cn.openphysics.androidapp.ui.design.OpenPhysicsColors
import cn.openphysics.androidapp.ui.design.OpenPhysicsRadius
import cn.openphysics.androidapp.ui.design.OpenPhysicsTone
import cn.openphysics.androidapp.domain.StudentAccessPolicy

private object GaokaoColors {
    val warmBackground = Color(0xFFFFFAF0)
    val warmBorder = Color(0xFFF2C66D)
    val teacherBackground = Color(0xFFF7F8FC)
    val teacherAccent = Color(0xFF526AA0)
}

fun gaokaoTrainingLayers(): List<LearningCatalogTopicLayer> = listOf(
    LearningCatalogTopicLayer.Foundation,
    LearningCatalogTopicLayer.Breakthrough,
    LearningCatalogTopicLayer.Transfer,
)

fun gaokaoRecentPracticeLabel(lastPracticed: String): String {
    if (lastPracticed.isBlank()) return "暂无复习记录"
    val parts = lastPracticed.substringBefore('T').split('-')
    if (parts.size == 3) {
        val month = parts[1].toIntOrNull()
        val day = parts[2].toIntOrNull()
        if (month != null && day != null) return "最近复习 ${month}月${day}日"
    }
    return "已有复习记录"
}

internal enum class GaokaoTopicWorkbenchState {
    Empty,
    Loading,
    Ready,
    Unavailable,
}

internal fun gaokaoTopicWorkbenchState(
    hasSelectedTopic: Boolean,
    overviewLoading: Boolean,
    hasOverview: Boolean,
): GaokaoTopicWorkbenchState = when {
    overviewLoading -> GaokaoTopicWorkbenchState.Loading
    !hasSelectedTopic -> GaokaoTopicWorkbenchState.Empty
    hasOverview -> GaokaoTopicWorkbenchState.Ready
    else -> GaokaoTopicWorkbenchState.Unavailable
}

@Composable
fun GaokaoReviewScreen(
    screen: Screen.GaokaoReview,
    onHome: () -> Unit,
    onLearn: () -> Unit,
    onPractice: () -> Unit,
    onReview: () -> Unit,
    onMe: () -> Unit,
    onToggleBlock: (LearningCatalogNode) -> Unit,
    onSelectTopic: (LearningCatalogNode) -> Unit,
    onStartLayer: (LearningCatalogNode, LearningCatalogTopicLayer) -> Unit,

    onRefreshTopic: () -> Unit,
    onAccountUnavailable: () -> Unit,
) {
    if (LocalPhonePresentation.current) {
        PhoneGaokaoScreen(screen, onHome, onLearn, onPractice, onReview, onMe, onSelectTopic, onToggleBlock,
            onStartLayer, onRefreshTopic, onAccountUnavailable)
        return
    }
    val startLayer: (LearningCatalogNode, LearningCatalogTopicLayer) -> Unit = { topic, layer ->
        if (StudentAccessPolicy.hasFullLearningAccess(screen.session)) onStartLayer(topic, layer)
        else onAccountUnavailable()
    }
    MainPage(
        activeTab = MainTab.Home,
        onHome = onHome,
        onLearn = onLearn,
        onPractice = onPractice,
        onReview = onReview,
        onMe = onMe,
        showTabletTopBar = false,
        tabletContentMode = TabletMainContentMode.FillAvailableHeight,
    ) {
        TabletLearningPageHeader(
            title = "高考复习",
            onHome = onHome,
            badge = "${screen.catalog.knowledgeBlocks().size} 个知识板块 · ${screen.catalog.topicCount} 个专题",
        )

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            horizontalArrangement = Arrangement.spacedBy(LearningLayoutSpec.PaneGap),
        ) {
            GaokaoCatalogPanel(
                catalog = screen.catalog,
                expandedBlockId = screen.expandedBlockId,
                selectedTopicId = screen.selectedTopicId,
                onToggleBlock = onToggleBlock,
                onSelectTopic = onSelectTopic,
                compact = true,
                modifier = Modifier
                    .width(tabletLearningSidebarWidth())
                    .fillMaxHeight()
                    .verticalScroll(rememberScrollState()),
            )
            GaokaoTopicWorkbench(
                screen = screen,
                onStartLayer = startLayer,
                onAccountUnavailable = onAccountUnavailable,
                onRefreshTopic = onRefreshTopic,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .verticalScroll(rememberScrollState()),
            )
        }

    }
}

@Composable
private fun GaokaoCatalogPanel(
    catalog: LearningCatalogData,
    expandedBlockId: String,
    selectedTopicId: String,
    onToggleBlock: (LearningCatalogNode) -> Unit,
    onSelectTopic: (LearningCatalogNode) -> Unit,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(OpenPhysicsRadius.Large),
        colors = CardDefaults.cardColors(containerColor = OpenPhysicsColors.Surface),
        border = BorderStroke(1.dp, OpenPhysicsColors.Border),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.padding(horizontal = if (compact) 12.dp else 18.dp, vertical = if (compact) 10.dp else 16.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    text = "复习目录",
                    color = OpenPhysicsColors.PrimaryDeep,
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Bold,
                )
                if (!compact) Text(
                    text = "选择知识板块",
                    color = OpenPhysicsColors.Ink,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.ExtraBold,
                )
            }
            Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(OpenPhysicsColors.Border))
            Column(
                modifier = Modifier.padding(if (compact) 8.dp else 12.dp),
                verticalArrangement = Arrangement.spacedBy(if (compact) 8.dp else 10.dp),
            ) {
                catalog.knowledgeBlocks().sortedBy { it.sortOrder }.forEach { block ->
                    GaokaoBlockSection(
                        block = block,
                        expanded = expandedBlockId == block.id,
                        selectedTopicId = selectedTopicId,
                        onToggle = { onToggleBlock(block) },
                        onSelectTopic = onSelectTopic,
                        compact = compact,
                    )
                }
            }
        }
    }
}

@Composable
private fun GaokaoBlockSection(
    block: LearningCatalogNode,
    expanded: Boolean,
    selectedTopicId: String,
    onToggle: () -> Unit,
    onSelectTopic: (LearningCatalogNode) -> Unit,
    compact: Boolean,
) {
    val shape = RoundedCornerShape(14.dp)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(if (expanded) OpenPhysicsColors.PrimarySoft else Color.White, shape)
            .border(
                1.dp,
                if (expanded) OpenPhysicsColors.Primary.copy(alpha = 0.4f) else OpenPhysicsColors.Border,
                shape,
            ),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onToggle)
                .padding(horizontal = if (compact) 10.dp else 14.dp, vertical = if (compact) 9.dp else 13.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    text = block.title,
                    color = if (expanded) OpenPhysicsColors.PrimaryDeep else OpenPhysicsColors.Ink,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    text = "${block.topics().size} 个专题",
                    color = OpenPhysicsColors.Muted,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            Text(
                text = if (expanded) "⌃" else "⌄",
                color = if (expanded) OpenPhysicsColors.PrimaryDeep else OpenPhysicsColors.Muted,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )
        }
        if (expanded) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color.White),
            ) {
                block.topics().sortedBy { it.sortOrder }.forEachIndexed { index, topic ->
                    GaokaoTopicRow(
                        topic = topic,
                        selected = selectedTopicId == topic.id,
                        onClick = { onSelectTopic(topic) },
                        compact = compact,
                    )
                    if (index < block.topics().lastIndex) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(start = 48.dp)
                                .height(1.dp)
                                .background(OpenPhysicsColors.Border),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun GaokaoTopicRow(
    topic: LearningCatalogNode,
    selected: Boolean,
    onClick: () -> Unit,
    compact: Boolean,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(if (selected) OpenPhysicsColors.PrimarySoft else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(horizontal = if (compact) 10.dp else 14.dp, vertical = if (compact) 9.dp else 12.dp),
        horizontalArrangement = Arrangement.spacedBy(if (compact) 6.dp else 10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Text(
            text = topic.topicDisplayCode(),
            color = OpenPhysicsColors.PrimaryDeep,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.ExtraBold,
            modifier = Modifier.width(if (compact) 24.dp else 30.dp),
        )
        Text(
            text = topic.title,
            color = if (selected) OpenPhysicsColors.PrimaryDeep else OpenPhysicsColors.Ink,
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun GaokaoTopicWorkbench(
    screen: Screen.GaokaoReview,
    onStartLayer: (LearningCatalogNode, LearningCatalogTopicLayer) -> Unit,

    onAccountUnavailable: () -> Unit,
    onRefreshTopic: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val topic = screen.catalog.topic(screen.selectedTopicId)
    val accessRequired = !StudentAccessPolicy.hasFullLearningAccess(screen.session)
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(OpenPhysicsRadius.Large),
        colors = CardDefaults.cardColors(containerColor = OpenPhysicsColors.Surface),
        border = BorderStroke(1.dp, OpenPhysicsColors.Border),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        if (accessRequired) {
            Column(modifier = Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(GaokaoLockTitle, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(GaokaoLockMessage,
                    color = OpenPhysicsColors.Muted)
                PrimaryActionButton(text = AccountUnavailableActionLabel, onClick = onAccountUnavailable, modifier = Modifier.width(180.dp))
            }
        }
        if (screen.overview != null && screen.message.isNotBlank()) {
            Text(screen.message, modifier = Modifier.padding(18.dp), color = OpenPhysicsColors.Muted)
        }
        when (
            gaokaoTopicWorkbenchState(
                hasSelectedTopic = topic != null,
                overviewLoading = screen.overviewLoading,
                hasOverview = screen.overview?.nodeId == topic?.id && screen.overview != null,
            )
        ) {
            GaokaoTopicWorkbenchState.Empty -> GaokaoEmptyTopic()
            GaokaoTopicWorkbenchState.Loading -> GaokaoOverviewLoading(topic?.title.orEmpty())
            GaokaoTopicWorkbenchState.Unavailable -> GaokaoOverviewUnavailable(screen.message, onRefreshTopic)
            GaokaoTopicWorkbenchState.Ready -> GaokaoTopicPath(
                topic = requireNotNull(topic),
                overview = requireNotNull(screen.overview),
                evidenceSyncMessage = screen.evidenceSyncMessage,
                accessRequired = accessRequired,
                onStartLayer = onStartLayer,

                onRefreshTopic = onRefreshTopic,
            )
        }
    }
}

@Composable
private fun GaokaoEmptyTopic() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 360.dp)
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            modifier = Modifier
                .width(78.dp)
                .height(78.dp)
                .background(OpenPhysicsColors.PrimarySoft, RoundedCornerShape(999.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Text("专题", color = OpenPhysicsColors.PrimaryDeep, fontWeight = FontWeight.Bold)
        }
        Spacer(modifier = Modifier.height(14.dp))
        Text("暂无可用复习专题", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Spacer(modifier = Modifier.height(6.dp))
        Text(
            "专题目录正在准备中，请稍后再来查看。",
            color = OpenPhysicsColors.Muted,
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun GaokaoOverviewLoading(topicTitle: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 320.dp)
            .padding(28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        CircularProgressIndicator(color = OpenPhysicsColors.PrimaryDeep)
        Spacer(modifier = Modifier.height(14.dp))
        Text(
            text = if (topicTitle.isBlank()) "正在恢复最近复习专题..." else "正在加载「$topicTitle」的专题复习路径...",
            color = OpenPhysicsColors.Muted,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun GaokaoOverviewUnavailable(message: String, onRefresh: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 320.dp)
            .padding(28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = message.ifBlank { "专题学习状态暂不可用。" },
            color = OpenPhysicsColors.Muted,
            textAlign = TextAlign.Center,
        )
        Spacer(modifier = Modifier.height(14.dp))
        PrimaryActionButton(text = "重新加载", onClick = onRefresh, modifier = Modifier.width(180.dp))
    }
}

@Composable
private fun GaokaoTopicPath(
    topic: LearningCatalogNode,
    overview: LearningCatalogTopicOverview,
    evidenceSyncMessage: String,
    accessRequired: Boolean,
    onStartLayer: (LearningCatalogNode, LearningCatalogTopicLayer) -> Unit,

    onRefreshTopic: () -> Unit,
) {
    Column(
        modifier = Modifier.padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (overview.hasLearningEvidence()) {
            GaokaoRecentStatus(overview, topic, onStartLayer, compact = true)
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(
                    "当前专题复习路径 · ${overview.topicCode}",
                    color = OpenPhysicsColors.PrimaryDeep,
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    overview.title,
                    color = OpenPhysicsColors.Ink,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.ExtraBold,
                )
            }
            PrimaryActionButton(
                text = if (accessRequired) "登录后摸底" else "专题摸底",
                onClick = { onStartLayer(topic, LearningCatalogTopicLayer.Diagnostic) },
                modifier = Modifier.width(if (accessRequired) 156.dp else 120.dp),
            )
        }
        GaokaoStatistics(overview, compact = true)
        Text("专题表现按已作答题目的得分计算；未练知识点待检测，不计零分。", color = OpenPhysicsColors.Muted, style = MaterialTheme.typography.bodySmall)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Bottom,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text("专题训练入口", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(
                    if (accessRequired) "登录后可按需要选择三个复习层级。" else "三个复习层级都可以直接进入，按当前需要选择。",
                    color = OpenPhysicsColors.Muted,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            Text(
                overview.topicPerformanceLabel(),
                color = OpenPhysicsColors.PrimaryDeep,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )
        }
        BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
            // Keep the three levels in one row on landscape tablets. Narrow windows
            // scroll horizontally instead of turning into three full-width cards.
            val gap = 8.dp
            val minimumCardWidth = (144f * LocalDensity.current.fontScale + 28f).dp
            val cardWidth = ((maxWidth - gap * 2) / 3).coerceAtLeast(minimumCardWidth)
            Row(
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).height(IntrinsicSize.Min),
                horizontalArrangement = Arrangement.spacedBy(gap),
            ) {
                gaokaoTrainingLayers().forEach { layer ->
                    GaokaoLayerCard(layer, accessRequired, overview.recommendedLayer == layer,
                        { onStartLayer(topic, layer) }, Modifier.width(cardWidth).fillMaxHeight(), compact = true)
                }
            }
        }
        GaokaoPaperCard(
            title = "专题套卷",
            description = LearningCatalogTopicLayer.Paper.description,
            buttonText = if (accessRequired) "登录后开启" else "开始专题套卷",
            onClick = { onStartLayer(topic, LearningCatalogTopicLayer.Paper) },
            background = OpenPhysicsColors.PrimarySoft,
            compact = true,
        )
        if (evidenceSyncMessage.isNotBlank()) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(GaokaoColors.warmBackground, RoundedCornerShape(12.dp))
                    .border(1.dp, GaokaoColors.warmBorder, RoundedCornerShape(12.dp))
                    .padding(13.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(evidenceSyncMessage, color = OpenPhysicsColors.Muted, style = MaterialTheme.typography.bodyMedium)
                SecondaryActionButton("重试同步", onRefreshTopic, modifier = Modifier.width(140.dp))
            }
        }
    }
}

@Composable
private fun GaokaoRecentStatus(
    overview: LearningCatalogTopicOverview,
    topic: LearningCatalogNode,
    onStartLayer: (LearningCatalogNode, LearningCatalogTopicLayer) -> Unit,
    compact: Boolean,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(GaokaoColors.warmBackground, RoundedCornerShape(14.dp))
            .border(1.dp, GaokaoColors.warmBorder, RoundedCornerShape(14.dp))
            .padding(if (compact) 10.dp else 16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(if (compact) "最近专题状态 · ${overview.statusLabel}" else "最近专题状态", color = OpenPhysicsColors.PrimaryDeep, fontWeight = FontWeight.Bold)
            if (!compact) Text("「${overview.title}」${overview.statusLabel}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text(
                "${gaokaoRecentPracticeLabel(overview.lastPracticed)} · 待检测 ${overview.untestedKnowledgePointCount()} 个",
                color = OpenPhysicsColors.Muted,
                style = MaterialTheme.typography.bodyMedium,
            )
            Text(
                "推荐进入「${overview.recommendedLayerName}」",
                color = OpenPhysicsColors.PrimaryDeep,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Bold,
            )
        }
        PrimaryActionButton(
            text = "继续复习",
            onClick = { onStartLayer(topic, overview.recommendedLayer) },
            modifier = Modifier.width(118.dp),
        )
    }
}

@Composable
private fun GaokaoStatistics(overview: LearningCatalogTopicOverview, compact: Boolean) {
    val stats = listOf(
        "核心知识点" to overview.coreKnowledgePointCount,
        "已检测" to overview.attemptedKnowledgePointCount,
        "待检测" to overview.untestedKnowledgePointCount(),
        "作答记录" to overview.evidenceCount,
    )
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(OpenPhysicsColors.Background, RoundedCornerShape(13.dp))
            .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(13.dp)),
    ) {
        stats.chunked(if (compact) 4 else 2).forEachIndexed { rowIndex, rowItems ->
            Row(modifier = Modifier.fillMaxWidth()) {
                rowItems.forEach { (title, value) ->
                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .padding(if (compact) 8.dp else 13.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Text(title, color = OpenPhysicsColors.Muted, style = MaterialTheme.typography.labelMedium)
                        Text(value.toString(), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                    }
                }
            }
            if (!compact && rowIndex == 0) {
                Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(OpenPhysicsColors.Border))
            }
        }
    }
}

@Composable
private fun GaokaoLayerCard(
    layer: LearningCatalogTopicLayer,
    accessRequired: Boolean,
    recommended: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = if (compact) 88.dp else 104.dp)
            .background(
                if (recommended) OpenPhysicsColors.PrimarySoft else OpenPhysicsColors.Background,
                RoundedCornerShape(14.dp),
            )
            .border(
                if (recommended) 1.5.dp else 1.dp,
                if (recommended) OpenPhysicsColors.Primary else OpenPhysicsColors.Border,
                RoundedCornerShape(14.dp),
            )
            .clickable(onClick = onClick)
            .padding(if (compact) 10.dp else 14.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        if (!compact) Text(layer.number, color = OpenPhysicsColors.PrimaryDeep, fontWeight = FontWeight.ExtraBold)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(if (compact) 5.dp else 7.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(if (compact) 4.dp else 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (compact) Text(layer.number, color = OpenPhysicsColors.PrimaryDeep,
                    style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.ExtraBold)
                Text(
                    layer.title, modifier = Modifier.weight(1f, fill = false),
                    style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                if (accessRequired) StatusChip("登录后开启", tone = OpenPhysicsTone.Primary)
                else if (recommended) StatusChip("当前建议", tone = OpenPhysicsTone.Primary)
            }
            Text(layer.description, color = OpenPhysicsColors.Muted, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun GaokaoPaperCard(
    title: String,
    description: String,
    buttonText: String,
    onClick: (() -> Unit)?,
    background: Color,
    accent: Color = OpenPhysicsColors.PrimaryDeep,
    compact: Boolean = false,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(background, RoundedCornerShape(14.dp))
            .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(14.dp))
            .padding(if (compact) 12.dp else 16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(title, color = accent, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
            Text(description, color = OpenPhysicsColors.Muted, style = MaterialTheme.typography.bodyMedium)
        }
        if (onClick != null) {
            // Locked labels ("登录后开启") need a little more room to stay on one line.
            PrimaryActionButton(text = buttonText, onClick = onClick,
                modifier = Modifier.width(if (buttonText.length > 6) 156.dp else if (compact) 140.dp else 160.dp))
        } else {
            Box(
                modifier = Modifier
                    .background(Color.White, RoundedCornerShape(10.dp))
                    .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(10.dp))
                    .padding(horizontal = 13.dp, vertical = 10.dp),
            ) {
                Text(buttonText, color = OpenPhysicsColors.Muted, fontWeight = FontWeight.Bold)
            }
        }
    }
}

internal const val GaokaoLockTitle = "登录后开启高考复习"
internal const val GaokaoLockMessage = "可先浏览全部专题和复习路径，登录后开始摸底、分层训练和专题套卷。已有记录和草稿会保留。"
