package cn.openphysics.androidapp.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import cn.openphysics.androidapp.domain.KpNode
import cn.openphysics.androidapp.ui.KpAssessmentProgress
import cn.openphysics.androidapp.ui.components.LearningCard
import cn.openphysics.androidapp.ui.components.PrimaryActionButton
import cn.openphysics.androidapp.ui.components.SecondaryActionButton
import cn.openphysics.androidapp.ui.components.StatusChip
import cn.openphysics.androidapp.ui.design.OpenPhysicsColors
import cn.openphysics.androidapp.ui.design.OpenPhysicsRadius
import cn.openphysics.androidapp.ui.design.OpenPhysicsTone

object LearningLayoutSpec {
    val PaneGap = 12.dp
    val SectionGap = 12.dp
}

data class LearningKpStatus(val label: String, val tone: OpenPhysicsTone)

data class LearningChapterStatus(val label: String, val tone: OpenPhysicsTone)

private fun backendLearningTone(value: String): OpenPhysicsTone {
    return when (value) {
        "mastered" -> OpenPhysicsTone.Success
        "learning" -> OpenPhysicsTone.Primary
        "practice" -> OpenPhysicsTone.Warning
        "locked" -> OpenPhysicsTone.Neutral
        else -> OpenPhysicsTone.Neutral
    }
}

fun learningStateFor(kp: KpNode): String = kp.learningState.ifBlank { "locked" }

fun shouldUseConsolidationPractice(kp: KpNode, assessmentProgress: KpAssessmentProgress? = null): Boolean =
    when (assessmentProgress) {
        KpAssessmentProgress.Completed -> true
        KpAssessmentProgress.InProgress -> false
        null -> learningStateFor(kp) == "mastered" || learningStateFor(kp) == "practice"
    }

fun hasLearningState(kps: List<KpNode>, vararg states: String): Boolean {
    return kps.any { kp -> learningStateFor(kp) in states }
}

fun firstKpByLearningState(kps: List<KpNode>, vararg states: String): KpNode? {
    states.forEach { state ->
        kps.firstOrNull { kp -> learningStateFor(kp) == state }?.let { return it }
    }
    return null
}

fun learningKpStatus(kp: KpNode): LearningKpStatus {
    if (kp.contentPending) return LearningKpStatus("内容待补充", OpenPhysicsTone.Neutral)
    if (kp.learningStateLabel.isNotBlank()) {
        return LearningKpStatus(kp.learningStateLabel, backendLearningTone(kp.learningStateTone))
    }
    if (kp.learningState.isNotBlank()) {
        return when (learningStateFor(kp)) {
            "mastered" -> LearningKpStatus("已掌握", OpenPhysicsTone.Success)
            "learning" -> LearningKpStatus("学习中", OpenPhysicsTone.Primary)
            "to_learn" -> LearningKpStatus("待学习", OpenPhysicsTone.Primary)
            "practice" -> LearningKpStatus("待巩固", OpenPhysicsTone.Warning)
            else -> LearningKpStatus("未开始", OpenPhysicsTone.Neutral)
        }
    }
    return LearningKpStatus("未开始", OpenPhysicsTone.Neutral)
}

fun learningChapterStatus(kps: List<KpNode>): LearningChapterStatus {
    if (kps.isEmpty()) return LearningChapterStatus("未开始", OpenPhysicsTone.Neutral)
    val availableKps = kps.filterNot { it.contentPending }
    if (availableKps.isEmpty()) return LearningChapterStatus("内容待补充", OpenPhysicsTone.Neutral)
    val statuses = availableKps.map(::learningKpStatus)
    return when {
        statuses.all { it.label == "已掌握" } -> LearningChapterStatus("已掌握", OpenPhysicsTone.Success)
        statuses.any { it.label == "待巩固" } -> LearningChapterStatus("待巩固", OpenPhysicsTone.Warning)
        statuses.any { it.label == "学习中" } -> LearningChapterStatus("学习中", OpenPhysicsTone.Primary)
        statuses.any { it.label == "待学习" } -> LearningChapterStatus("待学习", OpenPhysicsTone.Primary)
        else -> LearningChapterStatus("未开始", OpenPhysicsTone.Neutral)
    }
}

@Composable
fun TabletLearningWorkspace(
    modifier: Modifier = Modifier,
    left: @Composable ColumnScope.() -> Unit,
    right: @Composable ColumnScope.() -> Unit,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(LearningLayoutSpec.PaneGap),
    ) {
        Column(
            modifier = Modifier.width(tabletLearningSidebarWidth()),
            verticalArrangement = Arrangement.spacedBy(LearningLayoutSpec.SectionGap),
            content = left,
        )
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(LearningLayoutSpec.SectionGap),
            content = right,
        )
    }
}

@Composable
fun LearningPathHeroCard(
    meta: String,
    title: String,
    subtitle: String,
    statusText: String,
    statusTone: OpenPhysicsTone = OpenPhysicsTone.Primary,
    primaryActionText: String,
    onPrimaryAction: () -> Unit,
    secondaryActionText: String? = null,
    onSecondaryAction: (() -> Unit)? = null,
    stats: @Composable RowScope.() -> Unit,
    progress: @Composable ColumnScope.() -> Unit = {},
    body: @Composable ColumnScope.() -> Unit = {},
) {
    LearningCard(
        meta = meta,
        title = title,
        subtitle = subtitle,
        trailing = { StatusChip(statusText, tone = statusTone) },
    ) {
        if (title.isBlank()) return@LearningCard
        StatStrip(content = stats)
        progress()
        body()
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PrimaryActionButton(primaryActionText, onPrimaryAction, modifier = Modifier.weight(1f))
            if (secondaryActionText != null && onSecondaryAction != null) {
                SecondaryActionButton(secondaryActionText, onSecondaryAction, modifier = Modifier.weight(1f))
            }
        }
    }
}

@Composable
fun KnowledgePointCompactList(
    title: String,
    subtitle: String,
    kps: List<KpNode>,
    modifier: Modifier = Modifier,
    selectedKpId: String? = null,
    actionText: String = "学习",
    onSelectKp: (KpNode) -> Unit,
    onAction: (KpNode) -> Unit = onSelectKp,
) {
    LearningCard(modifier = modifier, title = title, subtitle = subtitle) {
        kps.forEach { kp ->
            val status = learningKpStatus(kp)
            val selected = selectedKpId == kp.id
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(
                        if (selected) OpenPhysicsColors.PrimarySoft else OpenPhysicsColors.SurfaceSoft,
                        RoundedCornerShape(OpenPhysicsRadius.Medium),
                    )
                    .border(
                        1.dp,
                        if (selected) Color(0xFFBFDBFE) else OpenPhysicsColors.Border,
                        RoundedCornerShape(OpenPhysicsRadius.Medium),
                    )
                    .clickable { onSelectKp(kp) }
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Text(
                        text = kp.name,
                        modifier = Modifier.fillMaxWidth(),
                        style = MaterialTheme.typography.titleMedium,
                        color = OpenPhysicsColors.Ink,
                        fontWeight = FontWeight.Normal,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        MetaText("掌握度 ${kp.masteryPercent()}%")
                        StatusChip(status.label, tone = status.tone)
                    }
                }
                SecondaryActionButton(actionText, { onAction(kp) }, modifier = Modifier.width(86.dp))
            }
        }
    }
}
