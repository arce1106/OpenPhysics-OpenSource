package cn.openphysics.androidapp.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import cn.openphysics.androidapp.domain.TeacherHomework
import cn.openphysics.androidapp.ui.components.LearningCard
import cn.openphysics.androidapp.ui.design.OpenPhysicsColors
import cn.openphysics.androidapp.ui.design.OpenPhysicsSpacing
import cn.openphysics.androidapp.ui.design.OpenPhysicsTone

/** What a row says on the right: the score once finished, otherwise where the homework stands. */
internal fun homeworkRecordStatus(item: TeacherHomework): Pair<String, String> = when (item.status) {
    "completed" -> item.score?.let { it.label to it.note } ?: ("已完成" to "")
    "grading" -> "批改中" to "已批改 ${item.gradedCount}/${item.questionCount}"
    else -> "未完成" to "${item.questionCount} 题"
}

internal fun homeworkRecordMeta(item: TeacherHomework): String = listOfNotNull(
    item.className.takeIf { it.isNotBlank() },
    if (item.isPaper) "纸质作业" else "${item.questionCount} 题",
    item.publishedAt.takeIf { it.length >= 10 }?.let { "布置于 ${it.substring(0, 10)}" },
).joinToString(" · ")

/** The mean out of 100 of the finished homework that has a score; null when none has. */
internal fun homeworkAverage(items: List<TeacherHomework>): Int? =
    items.mapNotNull { it.score?.percent }.takeIf { it.isNotEmpty() }?.let { Math.round(it.average()).toInt() }

/** Every teacher homework the student has had, newest first: the home card shows only the latest. */
@Composable
fun HomeworkHistoryScreen(
    items: List<TeacherHomework>,
    onBack: () -> Unit,
    onOpen: (TeacherHomework) -> Unit,
) {
    if (LocalPhonePresentation.current) {
        PhoneDetailPage("作业记录", onBack, showFooter = false) {
            Text("共 ${items.size} 份老师作业", color = PhoneColors.Muted, style = MaterialTheme.typography.labelMedium)
            if (items.isEmpty()) Text("还没有老师作业。老师布置后，可在这里查看每次作业的得分和答卷。", color = PhoneColors.Muted)
            else PhoneCard {
                items.forEachIndexed { index, item ->
                    if (index > 0) HorizontalDivider(color = PhoneColors.Divider)
                    HomeworkRecordRow(item, compact = true) { onOpen(item) }
                }
            }
        }
        return
    }
    val average = homeworkAverage(items)
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(OpenPhysicsColors.Background)
            .verticalScroll(rememberScrollState())
            .padding(OpenPhysicsSpacing.PageHorizontal),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        TabletWorkspaceTopBar(
            title = "作业记录",
            subtitle = "按时间查看老师布置的每次作业，打开可看答卷和批改。",
            onHome = onBack,
            primaryBadge = "${items.size} 份作业",
            primaryTone = OpenPhysicsTone.Primary,
            secondaryBadge = average?.let { "平均 $it 分" },
            secondaryTone = OpenPhysicsTone.Neutral,
        )
        LearningCard(title = "作业列表", subtitle = if (items.isEmpty()) "暂无老师作业" else "得分按百分制显示") {
            if (items.isEmpty()) MutedText("老师布置后，可在这里查看每次作业的得分和答卷。")
            items.forEachIndexed { index, item ->
                if (index > 0) HorizontalDivider(color = OpenPhysicsColors.Border)
                HomeworkRecordRow(item, compact = false) { onOpen(item) }
            }
        }
    }
}

@Composable
private fun HomeworkRecordRow(item: TeacherHomework, compact: Boolean, onClick: () -> Unit) {
    val (status, note) = homeworkRecordStatus(item)
    val scored = item.status == "completed" && item.score != null
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick).padding(vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(item.title, color = OpenPhysicsColors.Ink, fontWeight = FontWeight.SemiBold,
                style = if (compact) MaterialTheme.typography.titleSmall else MaterialTheme.typography.titleMedium)
            Text(homeworkRecordMeta(item), color = OpenPhysicsColors.Muted, style = MaterialTheme.typography.labelMedium)
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                status,
                modifier = Modifier
                    .background(if (scored) OpenPhysicsColors.Primary.copy(alpha = 0.08f) else Color.Transparent, RoundedCornerShape(8.dp))
                    .border(1.dp, if (scored) OpenPhysicsColors.Primary.copy(alpha = 0.18f) else Color.Transparent, RoundedCornerShape(8.dp))
                    .padding(horizontal = 8.dp, vertical = 2.dp),
                color = if (scored) OpenPhysicsColors.PrimaryDeep else OpenPhysicsColors.Muted,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
            )
            if (note.isNotBlank()) Text(note, color = OpenPhysicsColors.Muted, style = MaterialTheme.typography.labelSmall)
        }
    }
}
