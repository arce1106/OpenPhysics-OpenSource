package cn.openphysics.androidapp.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import cn.openphysics.androidapp.domain.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PhoneHomeContent(
    task: HomeTask, dashboard: DashboardData?, dailyLoop: DailyLearningLoop?,
    dailyLoopHistory: DailyLearningLoopHistory?, growthReport: GrowthReportData?,
    dashboardLoading: Boolean, dashboardError: String,
    onRefreshDashboard: () -> Unit, onDirectory: () -> Unit, onReinforcement: () -> Unit,
    onGaokao: () -> Unit, onHistory: () -> Unit, onGrowthHistory: (GrowthReportData) -> Unit,
    onReview: () -> Unit, onSettings: () -> Unit, onTodayTask: (HomeTask) -> Unit,
    studentName: String = "",
    teacherHomework: List<TeacherHomework> = emptyList(),
    onTeacherHomework: (TeacherHomework) -> Unit = {},
    onHomeworkHistory: () -> Unit = {},
) {
    var showProgress by remember { mutableStateOf(false) }
    // iOS: centred inline title, then one line addressed to the student.
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        PhoneRootTitle("今天怎么学")
        Text(if (studentName.isNotBlank()) "$studentName，先完成最值得做的一件事。" else "先完成最值得做的一件事。",
            style=MaterialTheme.typography.bodyMedium,color=PhoneColors.Muted)
    }
    val homework = teacherHomework
    val homeworkPending = homework.any { it.status != "completed" }
    // iOS 今日推荐任务: a white card washed with the accent from the top.
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp))
        .background(Brush.verticalGradient(listOf(PhoneColors.Soft, Color.White)))
        .border(1.dp, PhoneColors.CardStroke, RoundedCornerShape(18.dp)).padding(18.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
        if (dashboard == null && homework.isNotEmpty()) {
            Text("今日推荐任务",style=MaterialTheme.typography.labelLarge,color=PhoneColors.Primary,fontWeight=FontWeight.SemiBold)
            PhoneTeacherHomeworkRows(homework, onTeacherHomework)
            HorizontalDivider(color=PhoneColors.Divider)
        }
        when {
            dashboardLoading && dashboard == null -> {
                Text("正在整理学习任务…",style=MaterialTheme.typography.titleMedium)
                LinearProgressIndicator(Modifier.fillMaxWidth())
            }
            dashboard == null -> {
                Text("从一个知识点开始",style=MaterialTheme.typography.titleLarge)
                Text(if(dashboardError.isNotBlank()) "暂时未能读取学习进度，可以先进入同步学习。" else "选择正在学的内容，开始今天的学习。", color=PhoneColors.Muted)
                PhoneAction("进入同步学习",onDirectory,Modifier.fillMaxWidth())
            }
            else -> {
                Text("今日推荐任务",style=MaterialTheme.typography.labelLarge,color=PhoneColors.Primary,fontWeight=FontWeight.SemiBold)
                // iOS: a teacher's homework comes before the system's own recommendation.
                if (homework.isNotEmpty()) {
                    PhoneTeacherHomeworkRows(homework, onTeacherHomework)
                    HorizontalDivider(color=PhoneColors.Divider)
                }
                val review = task.actionType==HomeTaskAction.Review
                Text(if(review) "先清除 ${dashboard.motivation.mistakeBacklogCount} 道待复盘错题" else task.title,
                    style=if (homework.isEmpty()) MaterialTheme.typography.titleLarge else MaterialTheme.typography.titleMedium,
                    fontWeight=if (homework.isEmpty()) null else FontWeight.SemiBold)
                Text(if(review) "先把已经暴露的问题解决，再进入新知识或新题，提分效率最高。" else task.reason,
                    style=MaterialTheme.typography.bodyMedium,color=PhoneColors.Muted)
                if (!review && task.estimatedMinutes > 0) Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(6.dp)) {
                    PhoneIcon(PhoneSymbol.Clock,Modifier.size(16.dp),PhoneColors.Muted)
                    Text("预计 ${task.estimatedMinutes} 分钟",style=MaterialTheme.typography.labelMedium,color=PhoneColors.Muted)
                }
                PhoneAction(if(review) "去复盘错题" else task.action,{onTodayTask(task)},primary=!homeworkPending)
            }
        }
    }
    if (dashboardError.isNotBlank()) {
        TextButton(onClick=onRefreshDashboard) { Text("进度读取失败，点击重试") }
    }
    PhoneGoalCard(dailyLoop, dashboard?.motivation, if (dailyLoop != null) ({ showProgress = true }) else null)
    Column(verticalArrangement=Arrangement.spacedBy(10.dp)) {
        Text("学习路径",style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.Bold)
        PhoneCard {
            Row(Modifier.fillMaxWidth()) {
                PhoneHomeEntry("同步学习","跟着教材学",PhoneSymbol.Book,onDirectory,Modifier.weight(1f))
                PhoneHomeEntry("巩固提升","补上薄弱点",PhoneSymbol.Train,onReinforcement,Modifier.weight(1f))
            }
            HorizontalDivider(color=PhoneColors.Divider)
            Row(Modifier.fillMaxWidth()) {
                PhoneHomeEntry("高考复习","按专题突破",PhoneSymbol.Graduation,onGaokao,Modifier.weight(1f))
                PhoneHomeEntry("错题复盘","找到第一处问题",PhoneSymbol.Review,onReview,Modifier.weight(1f))
            }
        }
    }
    PhoneCard {
        dashboard?.plan?.let { plan ->
            PhoneLinkRow("推荐知识点",plan.kpName) {
                onTodayTask(task.copy(actionType=HomeTaskAction.Sync,kpId=plan.kpId))
            }
            HorizontalDivider(color=PhoneColors.Divider)
        }
        PhoneLinkRow("学习记录","查看练习记录",onHistory)
        HorizontalDivider(color=PhoneColors.Divider)
        PhoneLinkRow("作业记录","查看历次作业得分",onHomeworkHistory)
        growthReport?.let { report ->
            HorizontalDivider(color=PhoneColors.Divider)
            PhoneLinkRow("成长回顾","${report.totalAnswers} 题学习反馈") {onGrowthHistory(report)}
        }
    }
    if(showProgress && dailyLoop!=null) {
        ModalBottomSheet(onDismissRequest={showProgress=false},containerColor=Color.White,sheetState=rememberModalBottomSheetState(skipPartiallyExpanded=true)) {
            Column(Modifier.fillMaxWidth().fillMaxHeight(0.85f).verticalScroll(rememberScrollState()).padding(horizontal=20.dp,vertical=8.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
                Text("学习进度",style=MaterialTheme.typography.titleLarge)
                Text(dailyLoop.summary,style=MaterialTheme.typography.bodyMedium)
                DailyLoopHistoryPanel(dailyLoopHistory,dailyLoop,compact=true)
                PhoneAction("查看练习记录",{showProgress=false;onHistory()},Modifier.fillMaxWidth(),primary=false)
                Spacer(Modifier.height(16.dp))
            }
        }
    }
}

/** iOS 今日目标: practice (outer, teal) and review (inner, green) rings with the three outcome counts. */
@Composable
private fun PhoneGoalCard(loop: DailyLearningLoop?, motivation: MotivationPanel?, onOpen: (() -> Unit)?) {
    val practice = loop?.rings?.practice
    val review = loop?.rings?.review
    val closed = listOfNotNull(practice, review).count { it.completed }
    PhoneCard(Modifier.clickable(enabled = onOpen != null, role = Role.Button) { onOpen?.invoke() }, padding = PaddingValues(18.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(18.dp)) {
            Box(Modifier.size(116.dp), contentAlignment = Alignment.Center) {
                PhoneGoalRings(practice, review, Modifier.fillMaxSize())
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("$closed/2", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold)
                    Text("项达标", style = MaterialTheme.typography.labelSmall, color = PhoneColors.Muted)
                }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("今日目标", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    if (onOpen != null) PhoneIcon(PhoneSymbol.Next, Modifier.size(18.dp), PhoneColors.Muted)
                }
                PhoneGoalLegend("做题", practice, PhoneColors.Ring)
                PhoneGoalLegend("复盘", review, PhoneColors.RingGreen)
            }
        }
        HorizontalDivider(Modifier.padding(vertical = 14.dp), color = PhoneColors.Divider)
        Row(Modifier.fillMaxWidth()) {
            PhoneGoalMetric("连续学习天数", "${loop?.streakDays ?: motivation?.streakDays ?: 0}", PhoneColors.Ring, Modifier.weight(1f))
            PhoneGoalMetric("本周掌握知识点", "${motivation?.weeklyKpsMastered ?: 0}", PhoneColors.Ring, Modifier.weight(1f))
            PhoneGoalMetric("待复盘错题", "${motivation?.mistakeBacklogCount ?: 0}", PhoneColors.Warning, Modifier.weight(1f))
        }
    }
}

@Composable
internal fun PhoneGoalRings(practice: DailyLoopRing?, review: DailyLoopRing?, modifier: Modifier) {
    fun fraction(value: Int, ring: DailyLoopRing?) = if (ring != null && ring.target > 0) (value.toFloat() / ring.target).coerceIn(0f, 1f) else 0f
    Canvas(modifier) {
        fun ring(inset: Float, width: Float, ring: DailyLoopRing?, dark: Color, light: Color) {
            val diameter = size.minDimension - inset * 2 - width
            val topLeft = Offset((size.width - diameter) / 2, (size.height - diameter) / 2)
            val arcSize = Size(diameter, diameter)
            drawArc(dark.copy(alpha = 0.13f), 0f, 360f, false, topLeft, arcSize, style = Stroke(width))
            val progress = fraction(ring?.current ?: 0, ring)
            if (progress > 0f) rotate(-90f) {
                drawArc(Brush.sweepGradient(listOf(dark, light, dark)), 0f, 360f * progress, false, topLeft, arcSize,
                    style = Stroke(width, cap = StrokeCap.Round))
            }
            // Work beyond the target is a dashed second lap, as on iOS.
            val overflow = fraction(ring?.overflow ?: 0, ring)
            if (overflow > 0f) drawArc(light.copy(alpha = 0.72f), -90f, 360f * overflow, false, topLeft, arcSize,
                style = Stroke(3.dp.toPx(), cap = StrokeCap.Round, pathEffect = PathEffect.dashPathEffect(floatArrayOf(2.dp.toPx(), 5.dp.toPx()))))
        }
        ring(3.dp.toPx(), 15.dp.toPx(), practice, PhoneColors.Ring, PhoneColors.RingLight)
        ring(18.dp.toPx(), 11.dp.toPx(), review, PhoneColors.RingGreen, PhoneColors.RingGreenLight)
    }
}

@Composable
internal fun PhoneGoalLegend(label: String, ring: DailyLoopRing?, color: Color) {
    Row(Modifier.semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp)) {
        if (ring?.completed == true) Box(Modifier.size(14.dp).background(color, CircleShape), contentAlignment = Alignment.Center) {
            PhoneIcon(PhoneSymbol.Check, Modifier.size(10.dp), Color.White)
        } else Box(Modifier.size(10.dp).background(color.copy(alpha = 0.42f), CircleShape))
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.labelLarge, color = PhoneColors.Muted, fontWeight = FontWeight.SemiBold)
        Text(ring?.let { "${it.actualCurrent}/${it.target}" + if (it.autoCompleted) " · 已清空" else "" } ?: "—",
            style = MaterialTheme.typography.titleMedium, color = color, fontWeight = FontWeight.ExtraBold, maxLines = 1)
    }
}

@Composable
internal fun PhoneGoalMetric(title: String, value: String, color: Color, modifier: Modifier) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(value, style = MaterialTheme.typography.titleLarge, color = color, fontWeight = FontWeight.ExtraBold)
        Text(title, style = MaterialTheme.typography.labelSmall, color = PhoneColors.Muted, maxLines = 1)
    }
}

@Composable
private fun PhoneHomeEntry(title: String, subtitle: String, icon: PhoneSymbol, onClick: ()->Unit, modifier: Modifier) {
    Row(modifier.clickable(role=Role.Button,onClick=onClick).padding(vertical=12.dp),horizontalArrangement=Arrangement.spacedBy(12.dp),verticalAlignment=Alignment.CenterVertically) {
        PhoneIcon(icon,Modifier.size(26.dp))
        Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(2.dp)) {
            Text(title,style=MaterialTheme.typography.labelLarge,fontWeight=FontWeight.Bold)
            Text(subtitle,style=MaterialTheme.typography.labelMedium,color=PhoneColors.Muted)
        }
    }
}

@Composable
internal fun PhoneLinkRow(title: String, subtitle: String, onClick: ()->Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min=48.dp).clickable(role=Role.Button,onClick=onClick),horizontalArrangement=Arrangement.spacedBy(12.dp),verticalAlignment=Alignment.CenterVertically) {
        Text(title,style=MaterialTheme.typography.bodyMedium)
        Text(subtitle,Modifier.weight(1f),style=MaterialTheme.typography.labelMedium,color=PhoneColors.Muted)
        PhoneIcon(PhoneSymbol.Next,Modifier.size(18.dp),PhoneColors.Muted)
    }
}

/**
 * The home card shows one homework: the newest unfinished one, otherwise the newest finished one.
 * Older finished homework is reopened from 作业记录; other unfinished ones fold under the first.
 * [items] arrive newest first from the server.
 */
internal data class HomeTeacherHomework(val primary: TeacherHomework?, val otherPending: List<TeacherHomework>)

internal fun homeTeacherHomework(items: List<TeacherHomework>): HomeTeacherHomework {
    val pending = items.filter { it.status != "completed" }
    val primary = pending.firstOrNull() ?: items.firstOrNull()
    return HomeTeacherHomework(primary, pending.filter { it.attemptId != primary?.attemptId })
}

/** Rows for [homeTeacherHomework]: the chosen homework, plus a toggle for other unfinished ones. */
internal fun teacherHomeworkHomeRows(items: List<TeacherHomework>, expanded: Boolean): List<TeacherHomework> {
    val home = homeTeacherHomework(items)
    return listOfNotNull(home.primary) + if (expanded) home.otherPending else emptyList()
}

internal fun teacherHomeworkMoreLabel(otherPending: Int, expanded: Boolean): String? = when {
    otherPending <= 0 -> null
    expanded -> "收起"
    else -> "还有 $otherPending 份作业待完成"
}

@Composable
private fun PhoneTeacherHomeworkRows(items: List<TeacherHomework>, onOpen: (TeacherHomework) -> Unit) {
    var expanded by remember(items) { mutableStateOf(false) }
    teacherHomeworkHomeRows(items, expanded).forEach { item ->
        Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(2.dp)) {
                Text("老师作业",style=MaterialTheme.typography.labelSmall,color=PhoneColors.Primary,fontWeight=FontWeight.SemiBold)
                Text(item.title,style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.SemiBold)
                Text(item.detail,style=MaterialTheme.typography.bodyMedium,color=PhoneColors.Muted)
            }
            PhoneAction(item.actionTitle,{onOpen(item)},primary=item.status!="completed")
        }
    }
    teacherHomeworkMoreLabel(homeTeacherHomework(items).otherPending.size, expanded)?.let { label ->
        Text(label, Modifier.clickable(role = Role.Button) { expanded = !expanded }.padding(vertical = 4.dp),
            style=MaterialTheme.typography.labelLarge, color=PhoneColors.Primary, fontWeight=FontWeight.SemiBold)
    }
}
