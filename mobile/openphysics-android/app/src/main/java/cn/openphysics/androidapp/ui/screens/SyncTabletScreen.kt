package cn.openphysics.androidapp.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import cn.openphysics.androidapp.domain.ChapterGroup
import cn.openphysics.androidapp.domain.DirectoryData
import cn.openphysics.androidapp.domain.DirectoryRelation
import cn.openphysics.androidapp.domain.KpNode
import cn.openphysics.androidapp.ui.KpAssessmentProgress
import cn.openphysics.androidapp.domain.KnowledgeMasteryJudgment
import cn.openphysics.androidapp.ui.KnowledgeMasteryDisplayFallback
import cn.openphysics.androidapp.ui.mapKnowledgeMasteryJudgmentToMasteryDisplay
import cn.openphysics.androidapp.ui.components.PrimaryActionButton
import cn.openphysics.androidapp.ui.components.SecondaryActionButton
import cn.openphysics.androidapp.ui.components.StatusChip
import cn.openphysics.androidapp.ui.design.OpenPhysicsColors
import cn.openphysics.androidapp.ui.design.OpenPhysicsRadius
import cn.openphysics.androidapp.ui.design.OpenPhysicsTone
import java.time.Instant
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

private object SyncTabletColors {
    val selectedBorder = Color(0xFFC9EEF2)
    val graphBackground = Color(0xFFFBFEFE)
    val graphBorder = Color(0xFFDDF2F4)
    val inactiveNode = Color(0xFF94A3B8)
    val inactiveNodeSoft = Color(0xFFF8FAFC)
    val successNode = Color(0xFF28A745)
    val successNodeSoft = Color(0xFFEFFAF0)
    val warningNode = Color(0xFFF59E0B)
    val warningNodeSoft = Color(0xFFFFF6E8)
    val edge = Color(0xFF476885)
}

private object SyncTabletGraphSpec {
    const val Rows = 3
    const val NodeWidth = 148
    const val NodeHeight = 96
    const val NodeDotSize = 62
    const val ColumnGap = 58
    const val RowGap = 88
    const val PaddingX = 22
    const val PaddingY = 46
    val offsets = listOf(
        0 to 10,
        16 to -8,
        -12 to 14,
        18 to 6,
        -8 to -18,
        12 to 12,
        -16 to 0,
        8 to -10,
    )
}

@Composable
fun SyncTabletScreen(
    data: DirectoryData,
    grouped: Map<String, List<ChapterGroup>>,
    volumes: List<String>,
    focusedKpId: String = "",
    judgmentsByKpId: Map<String, KnowledgeMasteryJudgment> = emptyMap(),
    assessmentProgressFor: (String) -> KpAssessmentProgress? = { null },
    onHome: () -> Unit,
    onKpAction: (ChapterGroup, KpNode, SyncKpActionKind) -> Unit,
    canAccessKp: (KpNode) -> Boolean = { true },
    onAccountUnavailable: () -> Unit = {},
) {
    val initialSelection = remember(grouped, volumes, focusedKpId) {
        syncTabletInitialSelection(grouped, volumes, focusedKpId)
    }
    var selectedVolume by remember(initialSelection.volume) {
        mutableStateOf(initialSelection.volume)
    }
    var selectedChapterName by remember(initialSelection.volume, initialSelection.chapterName) {
        mutableStateOf(initialSelection.chapterName)
    }
    val chapters = grouped[selectedVolume].orEmpty()
    val selectedChapter = chapters.firstOrNull { it.chapter == selectedChapterName }
        ?: selectSyncRecommendedChapter(chapters)
        ?: chapters.firstOrNull()
    var activeKpId by remember(initialSelection.activeKpId, selectedChapter?.volume, selectedChapter?.chapter) {
        mutableStateOf(
            initialSelection.activeKpId
                ?.takeIf { id -> selectedChapter?.kps?.any { it.id == id } == true }
                ?: selectedChapter?.let { pickSyncRecommendedKp(it.kps)?.id },
        )
    }
    var sideMode by remember(initialSelection.showKpPanel, initialSelection.activeKpId) {
        mutableStateOf(if (initialSelection.showKpPanel) SyncTabletSideMode.Kp else SyncTabletSideMode.Directory)
    }
    val activeKp = selectedChapter?.kps?.firstOrNull { it.id == activeKpId }
        ?: selectedChapter?.let { pickSyncRecommendedKp(it.kps) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(OpenPhysicsColors.Background)
            .padding(TabletLearningPagePadding),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        SyncTabletTopBar(
            selectedVolume = selectedVolume,
            selectedChapter = selectedChapter,
            onHome = onHome,
        )
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            horizontalArrangement = Arrangement.spacedBy(LearningLayoutSpec.PaneGap),
        ) {
            SyncTabletSidePanel(
                modifier = Modifier
                    .width(tabletLearningSidebarWidth())
                    .fillMaxHeight(),
                mode = sideMode,
                volumes = volumes,
                selectedVolume = selectedVolume,
                onSelectVolume = { volume ->
                    selectedVolume = volume
                    val nextChapter = selectSyncRecommendedChapter(grouped[volume].orEmpty())
                        ?: grouped[volume].orEmpty().firstOrNull()
                    selectedChapterName = nextChapter?.chapter
                    activeKpId = nextChapter?.let { pickSyncRecommendedKp(it.kps)?.id }
                    sideMode = SyncTabletSideMode.Directory
                },
                chapters = chapters,
                selectedChapter = selectedChapter,
                activeKp = activeKp,
                activeKpRecommended = activeKp?.id == selectedChapter?.let { pickSyncRecommendedKp(it.kps)?.id },
                judgmentsByKpId = judgmentsByKpId,
                assessmentProgressFor = assessmentProgressFor,
                canAccessKp = canAccessKp,
                onAccountUnavailable = onAccountUnavailable,
                onSelectChapter = { chapter ->
                    selectedChapterName = chapter.chapter
                    activeKpId = pickSyncRecommendedKp(chapter.kps)?.id
                    sideMode = SyncTabletSideMode.Directory
                },
                onBackDirectory = { sideMode = SyncTabletSideMode.Directory },
                onKpAction = { action ->
                    val chapter = selectedChapter ?: return@SyncTabletSidePanel
                    val kp = activeKp ?: return@SyncTabletSidePanel
                    onKpAction(chapter, kp, action)
                },
            )
            SyncTabletMapMain(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight(),
                chapter = selectedChapter,
                relations = data.relations,
                activeKpId = activeKp?.id,
                judgmentsByKpId = judgmentsByKpId,
                onOpenKp = { kp ->
                    activeKpId = kp.id
                    sideMode = SyncTabletSideMode.Kp
                },
            )
        }
    }
}

private enum class SyncTabletSideMode {
    Directory,
    Kp,
}

@Composable
private fun SyncTabletTopBar(
    selectedVolume: String,
    selectedChapter: ChapterGroup?,
    onHome: () -> Unit,
) {
    TabletLearningPageHeader(
        title = "同步学习",
        onHome = onHome,
        badge = listOf(selectedVolume, selectedChapter?.chapter.orEmpty()).filter { it.isNotBlank() }.joinToString(" · "),
    )
}

@Composable
private fun SyncTabletSidePanel(
    modifier: Modifier,
    mode: SyncTabletSideMode,
    volumes: List<String>,
    selectedVolume: String,
    onSelectVolume: (String) -> Unit,
    chapters: List<ChapterGroup>,
    selectedChapter: ChapterGroup?,
    activeKp: KpNode?,
    activeKpRecommended: Boolean,
    judgmentsByKpId: Map<String, KnowledgeMasteryJudgment>,
    assessmentProgressFor: (String) -> KpAssessmentProgress?,
    canAccessKp: (KpNode) -> Boolean,
    onAccountUnavailable: () -> Unit,
    onSelectChapter: (ChapterGroup) -> Unit,
    onBackDirectory: () -> Unit,
    onKpAction: (SyncKpActionKind) -> Unit,
) {
    Column(
        modifier = modifier
            .background(Color.White, RoundedCornerShape(OpenPhysicsRadius.Large))
            .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Large)),
    ) {
        if (mode == SyncTabletSideMode.Kp && activeKp != null) {
            SyncTabletKpPanel(
                kp = activeKp,
                recommended = activeKpRecommended,
                judgment = judgmentsByKpId[activeKp.id],
                assessmentProgress = assessmentProgressFor(activeKp.id),
                locked = !canAccessKp(activeKp),
                onAccountUnavailable = onAccountUnavailable,
                onBackDirectory = onBackDirectory,
                onKpAction = onKpAction,
            )
        } else {
            SyncTabletDirectoryPanel(
                volumes = volumes,
                selectedVolume = selectedVolume,
                onSelectVolume = onSelectVolume,
                chapters = chapters,
                selectedChapter = selectedChapter,
                onSelectChapter = onSelectChapter,
            )
        }
    }
}

@Composable
private fun SyncTabletDirectoryPanel(
    volumes: List<String>,
    selectedVolume: String,
    onSelectVolume: (String) -> Unit,
    chapters: List<ChapterGroup>,
    selectedChapter: ChapterGroup?,
    onSelectChapter: (ChapterGroup) -> Unit,
) {
    var volumeMenuOpen by remember(selectedVolume) { mutableStateOf(false) }
    Column(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
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
                    .border(1.dp, SyncTabletColors.selectedBorder, RoundedCornerShape(999.dp))
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
                                text = shortSyncVolumeLabel(volume),
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
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            chapters.forEach { chapter ->
                SyncTabletChapterRow(
                    chapter = chapter,
                    selected = chapter == selectedChapter,
                    onClick = { onSelectChapter(chapter) },
                )
            }
        }
    }
}

@Composable
private fun SyncTabletChapterRow(chapter: ChapterGroup, selected: Boolean, onClick: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(if (selected) OpenPhysicsColors.PrimarySoft else OpenPhysicsColors.SurfaceSoft, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .border(1.dp, if (selected) SyncTabletColors.selectedBorder else OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = chapter.chapter,
                modifier = Modifier.weight(1f),
                color = if (selected) OpenPhysicsColors.PrimaryDeep else OpenPhysicsColors.Ink,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            StatusChip(syncChapterStatus(chapter), tone = syncChapterTone(chapter))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("${chapter.masteredCount()}/${chapter.kps.size} 已掌握", color = OpenPhysicsColors.Muted, style = MaterialTheme.typography.labelMedium)
            Text(if (chapter.kps.all { it.contentPending }) "—" else "${chapter.averageMasteryPercent()}%", color = OpenPhysicsColors.PrimaryDeep, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
        }
        ProgressLine(chapter.averageMasteryPercent() / 100.0)
    }
}

@Composable
private fun SyncTabletKpPanel(
    kp: KpNode,
    recommended: Boolean,
    judgment: KnowledgeMasteryJudgment?,
    assessmentProgress: KpAssessmentProgress?,
    locked: Boolean,
    onAccountUnavailable: () -> Unit,
    onBackDirectory: () -> Unit,
    onKpAction: (SyncKpActionKind) -> Unit,
) {
    if (kp.contentPending) {
        Column(Modifier.padding(20.dp)) {
            Text("返回目录", modifier = Modifier.clickable(onClick = onBackDirectory))
            PendingContentNotice(kp.name)
        }
        return
    }

    val display = syncKpMasteryDisplay(kp, judgment, recommended)
    val actions = syncKpActions(kp, assessmentProgress)
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            SyncTabletBackDirectoryButton(onBackDirectory)
            Text(
                kp.name,
                color = OpenPhysicsColors.Ink,
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                listOf(kp.volume, kp.chapter, kp.section).filter { it.isNotBlank() }.joinToString(" / "),
                color = OpenPhysicsColors.Muted,
                style = MaterialTheme.typography.bodyLarge,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                StatusChip(display.label, tone = display.tone)
                StatusChip("掌握度 ${display.masteryPct ?: kp.masteryPercent()}%", tone = OpenPhysicsTone.Primary)
            }
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(OpenPhysicsColors.SurfaceSoft, RoundedCornerShape(OpenPhysicsRadius.Medium))
                    .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Medium))
                    .padding(horizontal = 14.dp, vertical = 13.dp),
            ) {
                Text(
                    display.reason,
                    color = OpenPhysicsColors.Muted,
                    style = MaterialTheme.typography.bodyLarge,
                )
            }
            if (locked) AccountUnavailableBanner(LockedKnowledgePointTitle, LockedKnowledgePointMessage, onAccountUnavailable)
        }
        PrimaryActionButton(syncKpActionLabel(actions.primary, locked), { onKpAction(actions.primary.kind) })
        SecondaryActionButton(syncKpActionLabel(actions.secondary, locked), { onKpAction(actions.secondary.kind) })
    }
}

@Composable
private fun SyncTabletBackDirectoryButton(onClick: () -> Unit) {
    // iPad: a quiet "‹ 返回章节目录" link above the knowledge point, not a bordered pill.
    Row(
        modifier = Modifier
            .heightIn(min = 40.dp)
            .clickable(role = androidx.compose.ui.semantics.Role.Button, onClick = onClick),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PhoneIcon(PhoneSymbol.Back, Modifier.size(16.dp), OpenPhysicsColors.PrimaryDeep)
        Text("返回章节目录", color = OpenPhysicsColors.PrimaryDeep, style = MaterialTheme.typography.labelLarge)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SyncTabletMapMain(
    modifier: Modifier,
    chapter: ChapterGroup?,
    relations: List<DirectoryRelation>,
    activeKpId: String?,
    judgmentsByKpId: Map<String, KnowledgeMasteryJudgment>,
    onOpenKp: (KpNode) -> Unit,
) {
    Column(
        modifier = modifier
            .background(Color.White, RoundedCornerShape(OpenPhysicsRadius.Large))
            .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Large)),
    ) {
        if (chapter == null) {
            Column(modifier = Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("当前册别暂无章节", color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text("请选择其它教材册别。", color = OpenPhysicsColors.Muted, style = MaterialTheme.typography.bodyMedium)
            }
            return
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(chapter.chapter, color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            }
            SyncTabletMapStat("${chapter.kps.size}", "知识点")
            SyncTabletMapStat("${chapter.masteredCount()}", "已掌握")
            SyncTabletMapStat(if (chapter.kps.all { it.contentPending }) "—" else "${chapter.averageMasteryPercent()}%", "平均")
        }
        HorizontalDivider(color = OpenPhysicsColors.Divider)
        val recommendedKp = remember(chapter.kps) { pickSyncRecommendedKp(chapter.kps) }
        // iPad: the map is titled, and says where to pick up before the reader has to search for it.
        Row(
            modifier = Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 2.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("章节学习路径", Modifier.weight(1f), color = OpenPhysicsColors.Ink, style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold)
            recommendedKp?.let {
                Text("推荐从「${it.name}」继续", color = OpenPhysicsColors.Muted, style = MaterialTheme.typography.labelLarge,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        // Wraps in portrait, where the map column is too narrow for both legends on one line.
        FlowRow(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            listOf(0 to "0–39%", 40 to "40–69%", 70 to "70–79%", 80 to "80–100%").forEach { (percent, label) ->
                val palette = syncMasteryPalette(percent)
                Row(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(10.dp).background(palette.border, CircleShape))
                    Text(label, color = palette.ink, style = MaterialTheme.typography.labelMedium)
                }
            }
            Spacer(Modifier.weight(1f))
            // The darkest lines belong to the selected point, which is the recommended one on arrival.
            if (activeKpId != null) {
                SyncTabletEdgeLegend(SyncTabletEdgeKind.Frontier,
                    if (activeKpId == recommendedKp?.id) "推荐路径" else "所选知识点", emphasized = true)
            }
            SyncTabletEdgeLegend(SyncTabletEdgeKind.Frontier, "可以接着学")
            SyncTabletEdgeLegend(SyncTabletEdgeKind.Future, "前置未掌握")
        }
        Box(
            modifier = Modifier
                .weight(1f)
                .padding(start = 18.dp, end = 18.dp, bottom = 14.dp),
        ) {
            val recommendedKpId = recommendedKp?.id
            SyncTabletChapterMap(
                kps = chapter.kps,
                relations = relations,
                recommendedKpId = recommendedKpId,
                activeKpId = activeKpId,
                judgmentsByKpId = judgmentsByKpId,
                onOpenKp = onOpenKp,
            )
        }
    }
}

@Composable
private fun SyncTabletMapStat(value: String, label: String) {
    Column(
        modifier = Modifier
            .background(OpenPhysicsColors.SurfaceSoft, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Medium))
            .padding(horizontal = 14.dp, vertical = 9.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(value, color = OpenPhysicsColors.PrimaryDeep, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text(label, color = OpenPhysicsColors.Muted, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun SyncTabletChapterMap(
    kps: List<KpNode>,
    relations: List<DirectoryRelation>,
    recommendedKpId: String?,
    activeKpId: String?,
    judgmentsByKpId: Map<String, KnowledgeMasteryJudgment>,
    onOpenKp: (KpNode) -> Unit,
) {
    val graph = remember(kps, relations) { buildSyncTabletGraphLayout(kps, relations) }
    Box(
        modifier = Modifier
            .fillMaxSize()
            .horizontalScroll(rememberScrollState())
            .verticalScroll(rememberScrollState())
            .background(SyncTabletColors.graphBackground, RoundedCornerShape(OpenPhysicsRadius.Large))
            .border(1.dp, SyncTabletColors.graphBorder, RoundedCornerShape(OpenPhysicsRadius.Large))
            .padding(horizontal = 22.dp, vertical = 14.dp),
    ) {
        Box(
            modifier = Modifier
                .width(graph.width.dp)
                .height(graph.height.dp),
        ) {
            // Lines carry learning progress: mastered→mastered recedes, mastered→not yet is the
            // "ready to learn next" route, anything starting from an unmastered point is dashed.
            // A selected point lifts its own lines above the rest.
            val masteredIds = remember(kps, judgmentsByKpId) { syncTabletMasteredKpIds(kps, judgmentsByKpId) }
            val styledEdges = remember(graph, masteredIds, activeKpId) {
                graph.edges
                    .map { edge -> SyncTabletStyledEdge(edge, syncTabletEdgeKind(edge, masteredIds), activeKpId != null &&
                        (edge.from.kp.id == activeKpId || edge.to.kp.id == activeKpId)) }
                    .sortedBy { (if (it.focused) 10 else 0) + it.kind.ordinal }
            }
            Canvas(modifier = Modifier.fillMaxSize()) {
                val dash = PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 5.dp.toPx()))
                val related = activeKpId?.let { id ->
                    graph.relatedEdges.filter { it.from.kp.id == id || it.to.kp.id == id }
                }.orEmpty()
                val dots = PathEffect.dashPathEffect(floatArrayOf(1.dp.toPx(), 5.dp.toPx()))
                related.forEach { edge ->
                    val geometry = syncTabletEdgeGeometry(edge, this)
                    drawPath(geometry.path, SyncTabletColors.edge.copy(alpha = 0.45f),
                        style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round, pathEffect = dots))
                }
                styledEdges.forEach { styled ->
                    val edge = styled.edge
                    val geometry = syncTabletEdgeGeometry(edge, this)
                    val path = geometry.path
                    val base = when (styled.kind) {
                        SyncTabletEdgeKind.Done -> SyncTabletColors.edge.copy(alpha = 0.16f)
                        SyncTabletEdgeKind.Future -> SyncTabletColors.edge.copy(alpha = 0.30f)
                        SyncTabletEdgeKind.Frontier -> OpenPhysicsColors.Primary.copy(alpha = 0.78f)
                    }
                    val color = when {
                        styled.focused && styled.kind == SyncTabletEdgeKind.Frontier -> OpenPhysicsColors.PrimaryDeep
                        styled.focused -> SyncTabletColors.edge.copy(alpha = 0.75f)
                        activeKpId != null -> base.copy(alpha = base.alpha * 0.45f)
                        else -> base
                    }
                    val width = when (styled.kind) {
                        SyncTabletEdgeKind.Done -> 1.2.dp
                        SyncTabletEdgeKind.Future -> 1.4.dp
                        SyncTabletEdgeKind.Frontier -> 2.2.dp
                    } + if (styled.focused) 0.6.dp else 0.dp
                    drawPath(
                        path = path,
                        color = color,
                        style = Stroke(
                            width = width.toPx(),
                            cap = StrokeCap.Round,
                            pathEffect = if (styled.kind == SyncTabletEdgeKind.Future) dash else null,
                        ),
                    )
                    drawSyncTabletArrowHead(
                        tip = geometry.tip,
                        previous = geometry.beforeTip,
                        color = color,
                    )
                }
            }
            graph.sections.forEach { section ->
                Box(
                    modifier = Modifier
                        .offset(x = (section.centerX - 85).dp, y = 8.dp)
                        .width(170.dp)
                        .background(OpenPhysicsColors.PrimarySoft, RoundedCornerShape(999.dp))
                        .border(1.dp, SyncTabletColors.selectedBorder, RoundedCornerShape(999.dp))
                        .padding(horizontal = 10.dp, vertical = 5.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = section.title,
                        color = OpenPhysicsColors.PrimaryDeep,
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            graph.nodes.forEach { placement ->
                SyncTabletGraphKpNode(
                    kp = placement.kp,
                    judgment = judgmentsByKpId[placement.kp.id],
                    selected = placement.kp.id == activeKpId,
                    recommended = placement.kp.id == recommendedKpId,
                    modifier = Modifier.offset(
                        x = placement.x.dp,
                        y = placement.y.dp,
                    ),
                    onClick = { onOpenKp(placement.kp) },
                )
            }
        }
    }
}

@Composable
private fun SyncTabletGraphKpNode(
    kp: KpNode,
    judgment: KnowledgeMasteryJudgment?,
    selected: Boolean,
    recommended: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val display = syncKpMasteryDisplay(kp, judgment, recommended)
    val emphasized = selected || recommended
    val palette = if (kp.contentPending) SyncMasteryPalette(Color(0xFFF1F5F9), Color(0xFFCBD5E1), Color(0xFF64748B))
        else syncMasteryPalette(display.masteryPct ?: kp.masteryPercent())
    val toneColor = palette.ink
    val fillColor = palette.fill
    val statusText = when {
        recommended -> "推荐 · ${display.label}"
        else -> display.label
    }
    // Not started yet: a lighter, quieter circle — but the text keeps full contrast, and the
    // recommended or selected point is never toned down.
    val untouched = (display.masteryPct ?: kp.masteryPercent()) == 0 && !emphasized
    Column(
        modifier = modifier
            .width(SyncTabletGraphSpec.NodeWidth.dp)
            .clickable(onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Box(
            modifier = Modifier
                .size(SyncTabletGraphSpec.NodeDotSize.dp)
                .background(if (untouched) Color.White else fillColor, CircleShape)
                .border(
                    if (emphasized) 3.dp else if (untouched) 1.5.dp else 2.dp,
                    if (untouched) palette.border.copy(alpha = 0.55f) else palette.border,
                    CircleShape,
                ),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                if (kp.contentPending) "待补充" else "${display.masteryPct ?: kp.masteryPercent()}%",
                color = toneColor,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )
        }
        Text(
            kp.name,
            color = toneColor,
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(7.dp)
                    .background(toneColor, CircleShape),
            )
            Text(
                statusText,
                color = toneColor,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

private class SyncTabletEdgeGeometry(val path: Path, val tip: Offset, val beforeTip: Offset)

/**
 * Lines flow left to right as smooth S-curves leaving and entering each circle at its rim, so the
 * arrowhead stays visible and no line runs through the circles it connects.
 */
private fun syncTabletEdgeGeometry(edge: SyncTabletGraphEdge, density: DrawScope): SyncTabletEdgeGeometry = with(density) {
    val from = Offset(edge.from.centerX.dp.toPx(), edge.from.dotCenterY.dp.toPx())
    val to = Offset(edge.to.centerX.dp.toPx(), edge.to.dotCenterY.dp.toPx())
    val dx = to.x - from.x
    val dy = to.y - from.y
    val horizontal = kotlin.math.abs(dx) >= kotlin.math.abs(dy) * 0.6f
    val controlA = if (horizontal) Offset(from.x + dx * 0.5f, from.y) else Offset(from.x, from.y + dy * 0.5f)
    val controlB = if (horizontal) Offset(to.x - dx * 0.5f, to.y) else Offset(to.x, to.y - dy * 0.5f)
    val radius = (SyncTabletGraphSpec.NodeDotSize / 2 + 3).dp.toPx()
    fun rim(center: Offset, toward: Offset): Offset {
        val vx = toward.x - center.x
        val vy = toward.y - center.y
        val length = kotlin.math.sqrt(vx * vx + vy * vy)
        return if (length < 1f) center else Offset(center.x + vx / length * radius, center.y + vy / length * radius)
    }
    val start = rim(from, controlA)
    val end = rim(to, controlB)
    val path = Path().apply {
        moveTo(start.x, start.y)
        cubicTo(controlA.x, controlA.y, controlB.x, controlB.y, end.x, end.y)
    }
    SyncTabletEdgeGeometry(path, end, controlB)
}

private fun DrawScope.drawSyncTabletArrowHead(tip: Offset, previous: Offset, color: Color) {
    val angle = atan2(tip.y - previous.y, tip.x - previous.x)
    val size = 8.dp.toPx()
    val spread = 0.55f
    val left = Offset(
        x = tip.x - cos(angle - spread) * size,
        y = tip.y - sin(angle - spread) * size,
    )
    val right = Offset(
        x = tip.x - cos(angle + spread) * size,
        y = tip.y - sin(angle + spread) * size,
    )
    drawPath(
        path = Path().apply {
            moveTo(tip.x, tip.y)
            lineTo(left.x, left.y)
            lineTo(right.x, right.y)
            close()
        },
        color = color,
    )
}

internal enum class SyncTabletEdgeKind { Done, Future, Frontier }

private val SyncTabletPrerequisiteTypes = setOf("prerequisite_of", "prerequisite")

/**
 * Drops an arrow A→C when A already reaches C through other arrows (A→B→C): the dependency is
 * still shown, just once. Cycles are left untouched rather than broken arbitrarily.
 */
internal fun syncTabletTransitiveReduction(pairs: List<Pair<String, String>>): List<Pair<String, String>> {
    val unique = pairs.distinct()
    val next = unique.groupBy({ it.first }, { it.second }).mapValues { it.value.toMutableSet() }
    fun reaches(from: String, to: String): Boolean {
        val stack = ArrayDeque(listOf(from))
        val seen = mutableSetOf<String>()
        while (stack.isNotEmpty()) {
            val node = stack.removeLast()
            if (node == to) return true
            if (!seen.add(node)) continue
            next[node].orEmpty().forEach(stack::addLast)
        }
        return false
    }
    return unique.filter { (from, to) ->
        if (reaches(to, from)) true
        else {
            next[from]?.remove(to)
            if (reaches(from, to)) false
            else { next[from]?.add(to); true }
        }
    }
}

private data class SyncTabletStyledEdge(val edge: SyncTabletGraphEdge, val kind: SyncTabletEdgeKind, val focused: Boolean)

/** "已掌握" exactly as the node itself is labelled, so a line never disagrees with its circle. */
private fun syncTabletMasteredKpIds(
    kps: List<KpNode>,
    judgmentsByKpId: Map<String, KnowledgeMasteryJudgment>,
): Set<String> = kps.filter { syncKpMasteryDisplay(it, judgmentsByKpId[it.id]).label == "已掌握" }.map { it.id }.toSet()

internal fun syncTabletEdgeKind(edge: SyncTabletGraphEdge, masteredIds: Set<String>): SyncTabletEdgeKind = when {
    edge.from.kp.id !in masteredIds -> SyncTabletEdgeKind.Future
    edge.to.kp.id in masteredIds -> SyncTabletEdgeKind.Done
    else -> SyncTabletEdgeKind.Frontier
}

@Composable
private fun SyncTabletEdgeLegend(kind: SyncTabletEdgeKind, label: String, emphasized: Boolean = false) {
    Row(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically) {
        Canvas(Modifier.width(22.dp).height(10.dp)) {
            val y = size.height / 2
            drawLine(
                color = when {
                    emphasized -> OpenPhysicsColors.PrimaryDeep
                    kind == SyncTabletEdgeKind.Frontier -> OpenPhysicsColors.Primary
                    else -> SyncTabletColors.edge.copy(alpha = 0.45f)
                },
                start = Offset(0f, y),
                end = Offset(size.width, y),
                strokeWidth = (if (emphasized) 2.8.dp else if (kind == SyncTabletEdgeKind.Frontier) 2.2.dp else 1.4.dp).toPx(),
                cap = StrokeCap.Round,
                pathEffect = if (kind == SyncTabletEdgeKind.Future) PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx())) else null,
            )
        }
        Text(label, color = OpenPhysicsColors.Muted, style = MaterialTheme.typography.labelMedium)
    }
}

internal data class SyncTabletGraphLayout(
    val width: Int,
    val height: Int,
    val sections: List<SyncTabletGraphSection>,
    val nodes: List<SyncTabletGraphNodePlacement>,
    /** Prerequisite arrows, with any arrow already implied by a longer chain removed. */
    val edges: List<SyncTabletGraphEdge>,
    /** confused_with / applied_to / transfer: drawn only around the selected point. */
    val relatedEdges: List<SyncTabletGraphEdge> = emptyList(),
)

internal data class SyncTabletGraphSection(val title: String, val centerX: Int)

internal data class SyncTabletGraphNodePlacement(
    val kp: KpNode,
    val index: Int,
    val row: Int,
    val col: Int,
    val x: Int,
    val y: Int,
) {
    val centerX: Int get() = x + SyncTabletGraphSpec.NodeWidth / 2
    val dotCenterY: Int get() = y + SyncTabletGraphSpec.NodeDotSize / 2
}

internal data class SyncTabletGraphEdge(val from: SyncTabletGraphNodePlacement, val to: SyncTabletGraphNodePlacement)

internal fun buildSyncTabletGraphLayout(kps: List<KpNode>, relations: List<DirectoryRelation>): SyncTabletGraphLayout {
    if (kps.isEmpty()) return SyncTabletGraphLayout(width = 760, height = 480, sections = emptyList(), nodes = emptyList(), edges = emptyList())

    val placements = kps.mapIndexed { index, kp ->
        val col = index / SyncTabletGraphSpec.Rows
        val row = index % SyncTabletGraphSpec.Rows
        val offset = SyncTabletGraphSpec.offsets[index % SyncTabletGraphSpec.offsets.size]
        SyncTabletGraphNodePlacement(
            kp = kp,
            index = index,
            row = row,
            col = col,
            x = SyncTabletGraphSpec.PaddingX + col * (SyncTabletGraphSpec.NodeWidth + SyncTabletGraphSpec.ColumnGap) + offset.first,
            y = SyncTabletGraphSpec.PaddingY + row * (SyncTabletGraphSpec.NodeHeight + SyncTabletGraphSpec.RowGap) + offset.second,
        )
    }
    val width = (placements.maxOfOrNull { it.x } ?: 0) + SyncTabletGraphSpec.NodeWidth + SyncTabletGraphSpec.PaddingX
    val height = ((placements.maxOfOrNull { it.y } ?: 0) + SyncTabletGraphSpec.NodeHeight + SyncTabletGraphSpec.PaddingY).coerceAtLeast(620)
    val sections = buildSyncTabletGraphSectionMarkers(placements)

    val byId = placements.associateBy { it.kp.id }
    val scoped = relations.filter { relation ->
        relation.sourceId in byId && relation.targetId in byId && relation.sourceId != relation.targetId
    }
    val (prerequisites, related) = scoped.partition { it.relationType in SyncTabletPrerequisiteTypes }
    val prerequisitePairs = prerequisites.map { it.sourceId to it.targetId }.distinct()
    // Only real prerequisites are reduced; the keyword fallback for chapters without data stays as drawn on iOS.
    val visiblePairs = when {
        prerequisitePairs.isNotEmpty() -> syncTabletTransitiveReduction(prerequisitePairs)
        scoped.isEmpty() -> buildSyncTabletFallbackRelationPairs(kps)
        else -> emptyList()
    }
    fun toEdges(pairs: List<Pair<String, String>>) = pairs.mapNotNull { (sourceId, targetId) ->
        val from = byId[sourceId]
        val to = byId[targetId]
        if (from != null && to != null) SyncTabletGraphEdge(from, to) else null
    }.distinct()
    val relatedPairs = related
        .map { it.sourceId to it.targetId }
        .distinctBy { (a, b) -> if (a < b) a to b else b to a }

    return SyncTabletGraphLayout(
        width = width,
        height = height,
        sections = sections,
        nodes = placements,
        edges = toEdges(visiblePairs),
        relatedEdges = toEdges(relatedPairs),
    )
}

private fun buildSyncTabletGraphSectionMarkers(nodes: List<SyncTabletGraphNodePlacement>): List<SyncTabletGraphSection> {
    val seen = mutableSetOf<String>()
    return nodes.mapNotNull { node ->
        val section = node.kp.section.trim()
        if (section.isBlank() || !seen.add(section)) return@mapNotNull null
        SyncTabletGraphSection(title = section, centerX = node.centerX)
    }
}

private fun buildSyncTabletFallbackRelationPairs(kps: List<KpNode>): List<Pair<String, String>> {
    val dependencies = linkedMapOf<String, MutableSet<String>>()
    kps.forEachIndexed { index, kp ->
        if (index > 0) dependencies.getOrPut(kp.id) { linkedSetOf() }.add(kps[index - 1].id)
    }

    val particle = findFirstSyncKpByKeywords(kps, "质点")
    val reference = findFirstSyncKpByKeywords(kps, "参考系")
    val coordinate = findFirstSyncKpByKeywords(kps, "坐标系")
    val time = findFirstSyncKpByKeywords(kps, "时刻", "时间间隔")
    val displacement = findFirstSyncKpByKeywords(kps, "位移")
    val velocity = findFirstSyncKpByKeywords(kps, "速度")
    val acceleration = findFirstSyncKpByKeywords(kps, "加速度")
    val vtGraph = findFirstSyncKpByKeywords(kps, "v-t", "v－t", "v–t")
    val xtGraph = findFirstSyncKpByKeywords(kps, "x-t", "x－t", "x–t")

    addSyncDependency(dependencies, reference, particle)
    addSyncDependency(dependencies, coordinate, reference)
    addSyncDependency(dependencies, displacement, coordinate)
    addSyncDependency(dependencies, velocity, displacement)
    addSyncDependency(dependencies, velocity, time)
    addSyncDependency(dependencies, acceleration, velocity)
    addSyncDependency(dependencies, vtGraph, velocity)
    addSyncDependency(dependencies, vtGraph, acceleration)
    addSyncDependency(dependencies, xtGraph, displacement)
    addSyncDependency(dependencies, xtGraph, time)

    return dependencies.flatMap { (targetId, sourceIds) -> sourceIds.map { sourceId -> sourceId to targetId } }.distinct()
}

private fun addSyncDependency(dependencies: MutableMap<String, MutableSet<String>>, target: KpNode?, source: KpNode?) {
    if (target == null || source == null || target.id == source.id) return
    dependencies.getOrPut(target.id) { linkedSetOf() }.add(source.id)
}

private fun findFirstSyncKpByKeywords(kps: List<KpNode>, vararg keywords: String): KpNode? {
    return kps.find { kp ->
        val normalizedName = normalizeSyncKpName(kp.name)
        keywords.any { keyword -> normalizedName.contains(normalizeSyncKpName(keyword)) }
    }
}

private fun normalizeSyncKpName(value: String): String = value.replace("\\s+".toRegex(), "").lowercase()

internal data class SyncKpStatus(val label: String, val tone: OpenPhysicsTone)

internal data class SyncTabletInitialSelection(
    val volume: String,
    val chapterName: String?,
    val activeKpId: String?,
    val showKpPanel: Boolean,
)

internal fun syncTabletInitialSelection(
    grouped: Map<String, List<ChapterGroup>>,
    volumes: List<String>,
    focusedKpId: String,
): SyncTabletInitialSelection {
    val focusedKp = grouped.values.flatten()
        .flatMap { it.kps }
        .firstOrNull { it.id == focusedKpId }
    if (focusedKp != null) {
        val volume = focusedKp.volume.takeIf { it in volumes } ?: volumes.firstOrNull().orEmpty()
        val chapter = grouped[volume].orEmpty().firstOrNull { chapter ->
            chapter.kps.any { it.id == focusedKp.id }
        } ?: grouped[volume].orEmpty().firstOrNull { it.chapter == focusedKp.chapter }
        return SyncTabletInitialSelection(
            volume = volume,
            chapterName = chapter?.chapter,
            activeKpId = focusedKp.id,
            showKpPanel = true,
        )
    }

    val allKps = grouped.values.flatten().flatMap { it.kps }
    val globalRecommended = pickSyncRecommendedKp(allKps)
    val volume = globalRecommended?.volume?.takeIf { it in volumes } ?: volumes.firstOrNull().orEmpty()
    val chapters = grouped[volume].orEmpty()
    val chapter = chapters.firstOrNull { chapter -> globalRecommended?.id in chapter.kps.map { it.id } }
        ?: selectSyncRecommendedChapter(chapters)
        ?: chapters.firstOrNull()
    return SyncTabletInitialSelection(
        volume = volume,
        chapterName = chapter?.chapter,
        activeKpId = chapter?.let { pickSyncRecommendedKp(it.kps)?.id },
        showKpPanel = false,
    )
}

private fun pickSyncRecommendedKp(kps: List<KpNode>): KpNode? {
    val kps = kps.filterNot { it.contentPending }
    return kps.map { kp -> kp to parseLastPracticedMillis(kp.lastPracticed) }
        .filter { (_, time) -> time > Long.MIN_VALUE }
        .maxByOrNull { (_, time) -> time }
        ?.first
        ?: firstKpByLearningState(kps, "learning", "practice", "to_learn")
        ?: kps.firstOrNull { learningStateFor(it) != "mastered" }
        ?: kps.firstOrNull()
}

private fun selectSyncRecommendedChapter(chapters: List<ChapterGroup>): ChapterGroup? {
    return chapters.map { chapter -> chapter to chapterMostRecentPracticeMillis(chapter) }
        .filter { (_, time) -> time > Long.MIN_VALUE }
        .maxByOrNull { (_, time) -> time }
        ?.first
        ?: chapters.firstOrNull { chapter ->
            hasLearningState(chapter.kps, "learning", "practice")
        }
        ?: chapters.firstOrNull { chapter ->
            hasLearningState(chapter.kps, "to_learn", "locked")
        }
        ?: chapters.firstOrNull()
}

private fun chapterMostRecentPracticeMillis(chapter: ChapterGroup): Long {
    return chapter.kps.maxOfOrNull { parseLastPracticedMillis(it.lastPracticed) } ?: Long.MIN_VALUE
}

private fun parseLastPracticedMillis(value: String): Long {
    if (value.isBlank()) return Long.MIN_VALUE
    return runCatching { Instant.parse(value).toEpochMilli() }.getOrDefault(Long.MIN_VALUE)
}

internal fun syncChapterStatus(chapter: ChapterGroup): String = learningChapterStatus(chapter.kps).label

internal fun syncChapterTone(chapter: ChapterGroup): OpenPhysicsTone = learningChapterStatus(chapter.kps).tone

internal fun syncKpStatus(kp: KpNode): SyncKpStatus {
    val status = learningKpStatus(kp)
    return SyncKpStatus(status.label, status.tone)
}

private fun syncKpMasteryDisplay(
    kp: KpNode,
    judgment: KnowledgeMasteryJudgment?,
    recommended: Boolean = false,
) = mapKnowledgeMasteryJudgmentToMasteryDisplay(
    judgment = judgment,
    fallback = KnowledgeMasteryDisplayFallback(
        label = syncKpStatus(kp).label,
        reason = syncKpAdvice(kp, recommended),
        tone = syncKpStatus(kp).tone,
        masteryPct = kp.masteryPercent(),
    ),
)

private fun syncKpAdvice(kp: KpNode, recommended: Boolean = false): String {
    if (recommended) return "推荐先学这个知识点。"
    return when (learningStateFor(kp)) {
        "mastered" -> "已基本掌握，可进行巩固或进入后续知识点。"
        "practice" -> "当前需要巩固，建议先补齐基础。"
        "learning" -> "可通过知识卡片和小测确认掌握情况。"
        else -> "建议先学习知识卡片，再用小测确认理解。"
    }
}

enum class SyncKpActionKind {
    Learn,
    Check,
    Train,
    Improvement,
}

data class SyncKpAction(
    val kind: SyncKpActionKind,
    val label: String,
)

data class SyncKpActions(
    val primary: SyncKpAction,
    val secondary: SyncKpAction,
    val more: List<SyncKpAction>,
)

/** A locked point names account availability, as iOS does: 登录后学习 / 登录后掌握评估. */
internal fun syncKpActionLabel(action: SyncKpAction, locked: Boolean): String = when {
    !locked -> action.label
    action.kind == SyncKpActionKind.Learn -> "登录后学习"
    else -> "登录后${action.label}"
}

fun syncKpActions(kp: KpNode, assessmentProgress: KpAssessmentProgress? = null): SyncKpActions {
    val inConsolidation = shouldUseConsolidationPractice(kp, assessmentProgress)
    val learnAction = SyncKpAction(
        SyncKpActionKind.Learn,
        when {
            assessmentProgress == KpAssessmentProgress.InProgress || inConsolidation -> "回看知识卡"
            learningStateFor(kp) == "learning" -> "继续学习"
            else -> "开始学习"
        },
    )
    val checkAction = SyncKpAction(SyncKpActionKind.Check,
        if (assessmentProgress == KpAssessmentProgress.InProgress) "重新评估" else "掌握评估")
    val trainAction = SyncKpAction(SyncKpActionKind.Train, "巩固小练")
    val improvementAction = SyncKpAction(SyncKpActionKind.Improvement, "进入巩固提升")
    return if (assessmentProgress == KpAssessmentProgress.InProgress) {
        SyncKpActions(
            primary = checkAction,
            secondary = learnAction,
            more = listOf(improvementAction),
        )
    } else if (inConsolidation) {
        SyncKpActions(
            primary = trainAction,
            secondary = learnAction,
            more = listOf(improvementAction),
        )
    } else {
        SyncKpActions(
            primary = learnAction,
            secondary = checkAction,
            more = listOf(trainAction, improvementAction),
        )
    }
}

private fun shortSyncVolumeLabel(volume: String): String = volume
