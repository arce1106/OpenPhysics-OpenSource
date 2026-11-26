package cn.openphysics.androidapp.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import cn.openphysics.androidapp.domain.*
import cn.openphysics.androidapp.ui.PracticeReview

@Composable
internal fun PhoneScopeResult(
    result: ScopeDiagnosticResult, plan: ImprovementPlan?, onBack: () -> Unit,
    onLearnTask: (ImprovementTask) -> Unit, onStartTask: (ImprovementTask) -> Unit,
    onStartRetest: () -> Unit, onViewReport: () -> Unit,
    onAccountUnavailable: () -> Unit, onBackToEntry: () -> Unit,
) {
    if (plan == null) {
        BackHandler(onBack = onBackToEntry)
        PhoneDetailPage(if (result.scopeType == "section") "本节检测完成" else "单元检测完成", onBackToEntry,
            footer = { PhoneAction(AccountUnavailableActionLabel, onAccountUnavailable, Modifier.fillMaxWidth()) }) {
            Text(result.scopeName, style = MaterialTheme.typography.headlineSmall)
            PhoneSoftSection {
                Text("正确 ${result.correctCount}/${result.totalCount}", style = MaterialTheme.typography.titleLarge)
                if (result.feedback.isNotBlank()) Text(result.feedback)
                if (result.recommendation.isNotBlank()) Text(result.recommendation, color = PhoneColors.Muted)
            }
            Text("知识点表现", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            if (result.kpResults.isEmpty()) Text("暂无知识点明细。", color = PhoneColors.Muted)
            result.kpResults.forEach { kp ->
                Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("${kp.kpName} · ${if (kp.isWeak) "待加强" else "稳定"}", style = MaterialTheme.typography.titleMedium)
                    Text("正确 ${kp.correctCount}/${kp.totalCount} · 掌握 ${phonePercent(kp.masteryBefore)}% → ${phonePercent(kp.masteryAfter)}%",
                        color = PhoneColors.Muted)
                }
            }
            Text("登录后可使用完整的提升路径、专项练和阶段复测。", color = PhoneColors.Muted)
            PhoneListRow("返回巩固提升", onClick = onBackToEntry)
        }
        return
    }
    val next = plan.currentTask()
    BackHandler(onBack = onBack)
    PhoneDetailPage(if (result.scopeType == "section") "本节检测完成" else "单元检测完成", onBack,
        footer = {
            when {
                next != null -> PhoneAction(reinforcementCurrentTaskPrimaryActionLabel(next), { onStartTask(next) }, Modifier.fillMaxWidth())
                plan.isCompleted() -> PhoneAction("查看提升报告", onViewReport, Modifier.fillMaxWidth())
                plan.readyForRetest() -> PhoneAction("开始阶段复测", onStartRetest, Modifier.fillMaxWidth())
                else -> PhoneAction("回到提升路径", onBack, Modifier.fillMaxWidth(), primary = false)
            }
        }) {
        Text(result.scopeName, style = MaterialTheme.typography.headlineSmall)
        PhoneSoftSection {
            Text("正确 ${result.correctCount}/${result.totalCount} · ${if (plan.weakCount > 0) "发现 ${plan.weakCount} 个薄弱点" else "整体稳定"}",
                style = MaterialTheme.typography.titleMedium)
            if (result.feedback.isNotBlank()) Text(result.feedback)
            if (result.recommendation.isNotBlank()) Text(result.recommendation, color = PhoneColors.Muted)
        }
        Text(reinforcementScopeGuidanceText(plan.weakCount > 0 || result.weakKpIds.isNotEmpty()), color = PhoneColors.Muted)
        Text(reinforcementScopePlanTaskSummaryText(plan), color = PhoneColors.Muted)
        if (next != null) {
            Text("先处理这个薄弱点", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text(next.kpName, style = MaterialTheme.typography.titleLarge)
            if (next.reason.isNotBlank()) Text(next.reason, color = PhoneColors.Muted)
            TextButton(onClick = { onLearnTask(next) }) { Text(reinforcementTaskReviewActionLabel()) }
        } else if (plan.tasks.isEmpty()) {
            Text("本轮定位暂未生成专项任务。", color = PhoneColors.Muted)
        } else {
            Text(reinforcementCurrentEmptyReason(plan), color = PhoneColors.Muted)
        }
        if (plan.tasks.isNotEmpty()) {
            Text("提升任务", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            plan.tasks.sortedBy { it.priority }.forEach { task ->
                Column {
                    val action = reinforcementTaskPracticeAction(task, plan.status)
                    PhoneListRow(task.kpName,
                        "${reinforcementTaskMasteryPrimaryText(task)} · ${reinforcementTaskMasteryChangeText(task)}",
                        { onStartTask(task) }, improvementTaskStatusLabel(task.status), action.enabled)
                    TextButton(onClick = { onLearnTask(task) }) { Text(reinforcementTaskReviewActionLabel()) }
                }
            }
        }
    }
}

@Composable
internal fun PhoneRetestResult(
    result: ImprovementRetestResult, onBackToPlan: () -> Unit,
    onContinueWeak: (ImprovementTask) -> Unit, onViewReport: () -> Unit,
) {
    val next = result.plan.currentTask()
    BackHandler(onBack = onBackToPlan)
    PhoneDetailPage("阶段复测", onBackToPlan, footer = {
        PhoneAction(if (next == null) "回到提升路径" else "继续专项练",
            { if (next == null) onBackToPlan() else onContinueWeak(next) }, Modifier.fillMaxWidth())
    }) {
        PhoneSoftSection {
            Text(if (result.needsRetestCount == 0) "本轮复测已通过" else "继续补强薄弱点", style = MaterialTheme.typography.titleLarge)
            Text("正确 ${result.correctCount}/${result.totalCount} · 通过 ${result.passedCount} · 待补 ${result.needsRetestCount}")
        }
        PhoneListRow("查看提升报告", "回顾检测、练习和复测结果", onViewReport)
        Text("复测明细", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        if (result.taskResults.isEmpty()) Text("暂无复测明细。", color = PhoneColors.Muted)
        result.taskResults.forEach { task ->
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(task.kpName, style = MaterialTheme.typography.titleMedium)
                Text("正确 ${task.correctCount}/${task.totalCount} · ${if (task.passed) "通过" else "待补"}", color = PhoneColors.Primary)
                if (task.feedback.isNotBlank()) Text(task.feedback, color = PhoneColors.Muted)
            }
        }
    }
}

@Composable
internal fun PhoneTaskComplete(
    plan: ImprovementPlan, review: PracticeReview,
    onBackToPlan: () -> Unit, onContinueNextTask: () -> Unit, onBackToEntry: () -> Unit,
) {
    BackHandler(onBack = onBackToPlan)
    PhoneDetailPage("本步练习完成", onBackToPlan, footer = {
        PhoneAction(reinforcementTaskCompleteContinueLabel(plan),
            if (reinforcementTaskCompleteCanContinue(plan)) onContinueNextTask else onBackToPlan,
            Modifier.fillMaxWidth())
    }) {
        PhoneSoftSection {
            Text("正确 ${review.correctCount}/${review.totalCount}", style = MaterialTheme.typography.titleLarge)
            Text(reinforcementTaskCompleteNote(plan), color = PhoneColors.Muted)
        }
        if (review.items.isNotEmpty()) {
            Text("本步题目", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            review.items.forEachIndexed { index, item ->
                Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("第 ${index + 1} 题 · ${if (item.result.correct) "正确" else "待复盘"}", color = PhoneColors.Primary)
                    Text(phoneQuestionPreview(item.question.stem), color = PhoneColors.Muted)
                }
            }
        }
        if (reinforcementTaskCompleteCanContinue(plan))
            PhoneListRow("回到提升路径", "查看下一步和复测安排", onBackToPlan)
        PhoneListRow("回到巩固提升首页", onClick = onBackToEntry)
    }
}

@Composable
internal fun PhoneImprovementReport(
    report: ImprovementReport, onBack: () -> Unit, onBackToPlan: (String) -> Unit,
    onPractice: () -> Unit, onHome: () -> Unit,
) {
    val clipboard = LocalClipboardManager.current
    var copied by remember(report.summary.planId) { mutableStateOf(false) }
    BackHandler(onBack = onBack)
    PhoneDetailPage("提升报告", onBack, footer = {
        PhoneAction("回到巩固提升", onPractice, Modifier.fillMaxWidth())
    }) {
        Text(report.summary.scopeName, style = MaterialTheme.typography.headlineSmall)
        PhoneSoftSection {
            Text(if (report.summary.completed) "本轮提升已完成" else "本轮提升进行中", style = MaterialTheme.typography.titleLarge)
            Text("检测 ${report.summary.diagnosticCorrectCount}/${report.summary.diagnosticTotalCount} · 已通过 ${report.summary.passedTaskCount}/${report.summary.taskCount}")
            Text("阶段复测 ${report.summary.retestAttemptCount} 次", color = PhoneColors.Muted)
        }
        Text("报告概览", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        reinforcementReportOverviewMetrics(report.summary).forEach { metric ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(metric.label, Modifier.weight(1f), color = PhoneColors.Muted)
                Text(listOf(metric.value, metric.detail).filter { it.isNotBlank() }.joinToString(" · "),
                    style = MaterialTheme.typography.bodyMedium)
            }
        }
        report.diagnosticResult?.feedback?.takeIf { it.isNotBlank() }?.let {
            Text("检测总结", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text(it)
        }
        PhoneReportTextList("优势", reinforcementReportStrengths(report.strengths))
        PhoneReportTextList("仍需关注", report.remainingWeaknesses.ifEmpty { listOf("暂无需要继续补弱的知识点。") })
        PhoneReportTextList("下一步建议", report.nextActions.ifEmpty { listOf("回到巩固提升首页选择新的范围。") })
        Text("任务明细", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        if (report.tasks.isEmpty()) Text("暂无任务结果。", color = PhoneColors.Muted)
        report.tasks.sortedBy { it.priority }.forEach { task ->
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("${task.kpName} · ${task.finalLabel.ifBlank { task.status }}", style = MaterialTheme.typography.titleMedium)
                Text(reinforcementReportTaskDetailText(task), color = PhoneColors.Muted)
                if (task.reason.isNotBlank()) Text(task.reason, color = PhoneColors.Muted)
            }
        }
        Text("复测记录", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        if (report.retestAttempts.isEmpty()) Text("暂无复测记录。", color = PhoneColors.Muted)
        report.retestAttempts.forEach { attempt ->
            Text("${phoneShortDate(attempt.submittedAt.ifBlank { attempt.createdAt })} · 正确 ${attempt.correctCount}/${attempt.totalCount} · 通过 ${attempt.passedCount}")
        }
        Column {
            PhoneListRow("回到提升路径", onClick = { onBackToPlan(reinforcementReportBackToPlanId(report)) },
                enabled = reinforcementReportBackToPlanId(report).isNotBlank())
            PhoneListRow("复制摘要", onClick = { clipboard.setText(AnnotatedString(reinforcementReportShareText(report))); copied = true },
                badge = if (copied) "已复制" else "")
            PhoneListRow("回到首页", onClick = onHome)
        }
    }
}

@Composable
private fun PhoneReportTextList(title: String, items: List<String>) {
    if (items.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        items.forEach { Text("• $it") }
    }
}

@Composable
internal fun PhoneReportHistory(reports: ImprovementReportListResponse, onBack: () -> Unit,
    onOpenReport: (String) -> Unit, onLoadMore: () -> Unit) {
    BackHandler(onBack = onBack)
    PhoneDetailPage("提升报告历史", onBack, showFooter = false) {
        if (reports.items.isEmpty()) Text("完成一次阶段复测后，会在这里生成报告。", color = PhoneColors.Muted)
        reports.items.forEach { item ->
            PhoneListRow(item.scopeName,
                "${phoneShortDate(item.completedAt)} · 检测 ${item.diagnosticCorrectCount}/${item.diagnosticTotalCount} · 通过 ${item.passedTaskCount}/${item.taskCount}",
                { onOpenReport(item.planId) })
            if (item.summaryLabel.isNotBlank()) Text(item.summaryLabel, color = PhoneColors.Primary,
                style = MaterialTheme.typography.labelMedium)
            if (item.highlight.isNotBlank()) Text(item.highlight, color = PhoneColors.Muted)
        }
        PhoneLoadMore(reports.items.size, reports.total, onLoadMore)
    }
}

@Composable
internal fun PhoneDiagnosticHistory(attempts: ScopeDiagnosticAttemptListResponse, onBack: () -> Unit,
    onOpenAttempt: (String) -> Unit, onOpenLinkedPlan: (String) -> Unit, onLoadMore: () -> Unit) {
    BackHandler(onBack = onBack)
    PhoneDetailPage("检测历史", onBack, showFooter = false) {
        if (attempts.items.isEmpty()) {
            PhoneSoftSection {
                Text("还没有检测记录", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text("选一个章节完成检测，就能在这里回看结果和后续提升路径。", color = PhoneColors.Muted)
                PhoneAction("去选择章节检测", onBack, Modifier.fillMaxWidth())
            }
        }
        attempts.items.forEach { item ->
            Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Row(Modifier.fillMaxWidth().clickable(role = Role.Button) { onOpenAttempt(item.attemptId) }
                    .padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text(item.scopeName, style = MaterialTheme.typography.titleMedium,
                            maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(reinforcementDiagnosticHistoryMeta(item), color = PhoneColors.Muted,
                            style = MaterialTheme.typography.labelMedium,
                            maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    Text("看结果", color = PhoneColors.Primary, style = MaterialTheme.typography.labelMedium)
                }
                if (item.feedback.isNotBlank()) Text(item.feedback, color = PhoneColors.Muted,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (item.linkedPlanId.isNotBlank()) TextButton(onClick = { onOpenLinkedPlan(item.linkedPlanId) }) {
                    Text("查看提升路径")
                }
                HorizontalDivider(color = PhoneColors.Divider)
            }
        }
        PhoneLoadMore(attempts.items.size, attempts.total, onLoadMore)
    }
}

@Composable
internal fun PhoneDiagnosticAttemptDetail(detail: ScopeDiagnosticAttemptDetail,
    onBackToHistory: () -> Unit, onBackToEntry: () -> Unit,
    onViewPlan: (String) -> Unit, onViewReport: (String) -> Unit, onRediagnose: () -> Unit) {
    BackHandler(onBack = onBackToHistory)
    PhoneDetailPage(if (detail.scopeType == "section") "本节检测记录" else "单元检测记录", onBackToHistory,
        footer = {
            if (reinforcementDiagnosticRediagnoseEnabled(detail.scopeType))
                PhoneAction("重新检测", onRediagnose, Modifier.fillMaxWidth())
            else PhoneAction("回到巩固提升", onBackToEntry, Modifier.fillMaxWidth(), primary = false)
        }) {
        Text(detail.scopeName, style = MaterialTheme.typography.headlineSmall)
        PhoneSoftSection {
            Text("正确 ${detail.correctCount}/${detail.totalCount} · 薄弱点 ${detail.weakCount} 个", style = MaterialTheme.typography.titleMedium)
            if (detail.feedback.isNotBlank()) Text(detail.feedback, color = PhoneColors.Muted)
        }
        Text("知识点表现", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        if (detail.kpResults.isEmpty()) Text("暂无知识点明细。", color = PhoneColors.Muted)
        detail.kpResults.sortedByDescending { it.isWeak }.forEach { item ->
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("${item.kpName} · ${if (item.isWeak) "待加强" else "稳定"}", style = MaterialTheme.typography.titleMedium)
                Text("正确 ${item.correctCount}/${item.totalCount} · 掌握 ${phonePercent(item.masteryBefore)}% → ${phonePercent(item.masteryAfter)}%",
                    color = PhoneColors.Muted)
            }
        }
        if (detail.linkedPlanId.isNotBlank()) {
            Text("关联提升路径", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            PhoneListRow("查看提升路径", onClick = { onViewPlan(detail.linkedPlanId) })
            if (reinforcementDiagnosticDetailShowsReport(detail))
                PhoneListRow("查看提升报告", onClick = { onViewReport(detail.linkedPlanId) })
        } else Text("本次检测尚未关联提升路径。", color = PhoneColors.Muted)
        PhoneListRow("回到巩固提升", onClick = onBackToEntry)
    }
}

@Composable
internal fun PhoneLearningTrace(trace: LearningTraceResponse, onBack: () -> Unit,
    onOpenDiagnosticAttempt: (String) -> Unit, onOpenPlan: (String) -> Unit,
    onOpenReport: (String) -> Unit, onLoadMore: () -> Unit) {
    BackHandler(onBack = onBack)
    PhoneDetailPage("学习轨迹", onBack, showFooter = false) {
        Text("按时间回看检测、补弱和复测。", color = PhoneColors.Muted)
        if (trace.items.isEmpty()) Text("完成一次检测或训练后，这里会记录你的学习过程。", color = PhoneColors.Muted)
        trace.items.forEach { event ->
            val action = reinforcementTraceAction(event)
            PhoneListRow(event.title,
                "${phoneShortDate(event.eventTime)} · ${reinforcementTraceMeta(event)} · ${event.statusLabel.ifBlank { event.eventType }}",
                {
                    when (action?.target) {
                        ReinforcementTraceTarget.DiagnosticAttempt -> onOpenDiagnosticAttempt(action.targetId)
                        ReinforcementTraceTarget.Plan -> onOpenPlan(action.targetId)
                        ReinforcementTraceTarget.Report -> onOpenReport(action.targetId)
                        null -> Unit
                    }
                }, action?.label.orEmpty(), enabled = action != null)
            if (event.description.isNotBlank()) Text(event.description, color = PhoneColors.Muted)
        }
        PhoneLoadMore(trace.items.size, trace.total, onLoadMore)
    }
}

@Composable
private fun PhoneLoadMore(shown: Int, total: Int, onLoadMore: () -> Unit) {
    val footer = reinforcementListFooterState(shown, total)
    if (total <= 0) return
    Text(footer.summary, color = PhoneColors.Muted, style = MaterialTheme.typography.labelMedium)
    if (footer.canLoadMore) PhoneAction(footer.loadMoreLabel, onLoadMore, Modifier.fillMaxWidth(), primary = false)
}

private fun phoneShortDate(value: String): String =
    if (value.length >= 10) value.substring(0, 10) else value.ifBlank { "未记录" }

private fun phonePercent(value: Double): Int = (value * 100).toInt().coerceIn(0, 100)
