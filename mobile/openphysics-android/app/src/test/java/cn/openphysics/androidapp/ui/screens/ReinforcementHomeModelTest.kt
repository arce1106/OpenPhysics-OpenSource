package cn.openphysics.androidapp.ui.screens

import cn.openphysics.androidapp.domain.DirectoryData
import cn.openphysics.androidapp.domain.ImprovementPlan
import cn.openphysics.androidapp.domain.ImprovementReport
import cn.openphysics.androidapp.domain.ImprovementReportListItem
import cn.openphysics.androidapp.domain.ImprovementReportRetestAttempt
import cn.openphysics.androidapp.domain.ImprovementReportSummary
import cn.openphysics.androidapp.domain.ImprovementReportTask
import cn.openphysics.androidapp.domain.ImprovementTask
import cn.openphysics.androidapp.domain.KpNode
import cn.openphysics.androidapp.domain.KnowledgeMasteryJudgment
import cn.openphysics.androidapp.domain.LearningTraceEvent
import cn.openphysics.androidapp.domain.RecommendedKp
import cn.openphysics.androidapp.domain.ScopeDiagnosticAttemptDetail
import cn.openphysics.androidapp.domain.ScopeDiagnosticAttemptListItem
import cn.openphysics.androidapp.domain.TrainStartData
import cn.openphysics.androidapp.ui.design.OpenPhysicsTone
import org.junit.Assert.assertEquals
import org.junit.Test

class ReinforcementHomeModelTest {
    @Test
    fun `reinforcement chapter plans include weak knowledge points from mastery judgments`() {
        val data = DirectoryData(
            kps = listOf(
                kp("kp_judged", "速度与时间的关系", "必修一", "第二章", 0.8, learningState = "mastered"),
                kp("kp_stable", "位移与时间的关系", "必修一", "第二章", 0.9, learningState = "mastered"),
            ),
            mastered = 2,
            inProgress = 0,
            total = 2,
        )

        val plans = buildReinforcementChapterPlans(
            data = data,
            trainStart = TrainStartData(isFirstTime = false, hasDiagnosed = true, recommendedKps = emptyList()),
            judgmentsByKpId = mapOf(
                "kp_judged" to KnowledgeMasteryJudgment(
                    kpId = "kp_judged",
                    kpName = "速度与时间的关系",
                    masteryScore = 0.2,
                    masteryLevel = "weak",
                    interventionStatus = "needs_practice",
                    confidence = "medium",
                    nextAction = "practice",
                    reason = "判读层建议巩固",
                ),
            ),
        )

        assertEquals(listOf("kp_judged"), plans.single().recommendedKps.map { it.id })
        assertEquals("有薄弱", plans.single().status)
    }

    @Test
    fun `preferred chapter follows train recommendation order`() {
        val data = DirectoryData(
            kps = listOf(
                kp("kp_a", "质点", "必修一", "第一章", 0.9),
                kp("kp_b", "楞次定律", "选择性必修二", "第二章", 0.3),
            ),
            mastered = 1,
            inProgress = 1,
            total = 2,
        )
        val trainStart = TrainStartData(
            isFirstTime = false,
            hasDiagnosed = true,
            recommendedKps = listOf(recommended("kp_b", "楞次定律", 0.3)),
        )

        val preferred = selectPreferredChapterPlan(buildReinforcementChapterPlans(data, trainStart), trainStart)

        assertEquals("第二章", preferred?.chapter)
        assertEquals("楞次定律", preferred?.firstWeakKp?.name)
    }


    @Test
    fun `tablet reinforcement home requests bounded workbench height`() {
        assertEquals(TabletMainContentMode.FillAvailableHeight, reinforcementTabletContentMode())
    }

    @Test
    fun `tablet reinforcement workspace fills tablet canvas with bounded chapter scrolling`() {
        val policy = reinforcementTabletPathWorkspacePolicy()

        assertEquals(true, policy.controlPanelFillsAvailableHeight)
        assertEquals(620, policy.chapterListMaximumHeightDp)
        assertEquals(true, policy.pathCardFillsAvailableHeight)
        assertEquals(0, policy.pathCardMinimumHeightDp)
    }


    @Test
    fun `untouched recommended chapter remains not started instead of reinforcement`() {
        val data = DirectoryData(
            kps = listOf(kp("kp_a", "抛体运动", "必修二", "第五章", 0.0)),
            mastered = 0,
            inProgress = 0,
            total = 1,
        )
        val trainStart = TrainStartData(
            isFirstTime = true,
            hasDiagnosed = false,
            recommendedKps = listOf(recommended("kp_a", "抛体运动", 0.0)),
        )

        val plan = buildReinforcementChapterPlans(data, trainStart).first()

        assertEquals("未开始", plan.status)
        assertEquals("未开始", reinforcementChapterListStatus(plan))
        assertEquals(OpenPhysicsTone.Neutral, reinforcementChapterListTone(plan))
    }

    @Test
    fun `chapter with actual weak progress uses weak label not old reinforcement label`() {
        val data = DirectoryData(
            kps = listOf(kp(
                id = "kp_a",
                name = "抛体运动",
                volume = "必修二",
                chapter = "第五章",
                mastery = 0.25,
                learningState = "practice",
                learningStateLabel = "待巩固",
                learningStateTone = "practice",
            )),
            mastered = 0,
            inProgress = 1,
            total = 1,
        )
        val trainStart = TrainStartData(
            isFirstTime = false,
            hasDiagnosed = true,
            recommendedKps = listOf(recommended("kp_a", "抛体运动", 0.25)),
        )

        val plan = buildReinforcementChapterPlans(data, trainStart).first()

        assertEquals("有薄弱", plan.status)
        assertEquals("有薄弱", reinforcementChapterListStatus(plan))
        assertEquals(OpenPhysicsTone.Warning, reinforcementChapterListTone(plan))
    }

    @Test
    fun `chapter with backend practice state is weak even when mastery is zero`() {
        val data = DirectoryData(
            kps = listOf(kp(
                id = "kp_a",
                name = "抛体运动",
                volume = "必修二",
                chapter = "第五章",
                mastery = 0.0,
                learningState = "practice",
                learningStateLabel = "待巩固",
                learningStateTone = "practice",
            )),
            mastered = 0,
            inProgress = 0,
            total = 1,
        )
        val trainStart = TrainStartData(
            isFirstTime = false,
            hasDiagnosed = true,
            recommendedKps = listOf(recommended("kp_a", "抛体运动", 0.0)),
        )

        val plan = buildReinforcementChapterPlans(data, trainStart).first()

        assertEquals("有薄弱", plan.status)
        assertEquals("有薄弱", reinforcementChapterListStatus(plan))
    }


    @Test
    fun `recent plan card mirrors web continuation copy`() {
        val plan = improvementPlan(
            status = "active",
            currentTaskId = "task-1",
            tasks = listOf(improvementTask("task-1", "楞次定律", "pending", weak = true)),
        )

        assertEquals("「第二章 电磁感应」检测完成", reinforcementRecentPlanTitle(plan))
        assertEquals("继续薄弱点提升", reinforcementRecentPlanActionLabel(plan))
        assertEquals("推荐先修复「楞次定律」", reinforcementRecentPlanNextText(plan))
    }

    @Test
    fun `recent report card mirrors web completed report copy`() {
        val report = improvementReport()

        assertEquals("「第二章 电磁感应」提升闭环已完成", reinforcementRecentReportTitle(report))
        assertEquals("已通过 2/2 · 复测正确率 80%", reinforcementRecentReportMeta(report))
    }

    @Test
    fun `report history metrics mirror web report history stats`() {
        assertEquals(
            listOf(
                ReinforcementReportOverviewMetric("提升任务", "2/2", ""),
                ReinforcementReportOverviewMetric("复测正确率", "80%", ""),
            ),
            reinforcementReportHistoryMetrics(improvementReportListItem(latestRetestAccuracy = 0.8)),
        )
        assertEquals(
            ReinforcementReportOverviewMetric("复测正确率", "未完成", ""),
            reinforcementReportHistoryMetrics(improvementReportListItem(latestRetestAccuracy = null))[1],
        )
    }

    @Test
    fun `report overview metrics mirror web report overview`() {
        val report = improvementReport()

        assertEquals(
            listOf(
                ReinforcementReportOverviewMetric("检测正确率", "1/2", "50%"),
                ReinforcementReportOverviewMetric("提升任务", "2", "薄弱 1"),
                ReinforcementReportOverviewMetric("已通过", "2", "仍需 0"),
                ReinforcementReportOverviewMetric("阶段复测", "80%", "1 次记录"),
            ),
            reinforcementReportOverviewMetrics(report.summary),
        )
    }

    @Test
    fun `report strengths keep web fallback copy when empty`() {
        assertEquals(listOf("本轮提升数据已记录。"), reinforcementReportStrengths(emptyList()))
        assertEquals(listOf("楞次定律已稳定"), reinforcementReportStrengths(listOf("楞次定律已稳定")))
    }

    @Test
    fun `report page exposes web aligned back to plan target`() {
        assertEquals("plan-1", reinforcementReportBackToPlanId(improvementReport()))
    }

    @Test
    fun `report share text mirrors web summary copy`() {
        val report = improvementReport()

        assertEquals(
            listOf(
                "OpenPhysics提升报告",
                "范围：第二章 电磁感应",
                "检测：1/2",
                "提升任务：已通过 2/2",
                "阶段复测：4/5",
                "结论：本轮提升已完成",
                "下一步：可以回到巩固提升首页选择新的章节或单元继续检测。",
            ).joinToString("\n"),
            reinforcementReportShareText(report),
        )
    }

    @Test
    fun `report task detail mirrors web evidence copy`() {
        val retestedTask = improvementReportTask(
            correct = 1,
            total = 2,
            masteryBefore = 0.25,
            masteryAfterDiagnostic = 0.55,
            latestRetestCorrect = 3,
            latestRetestTotal = 4,
        )
        val pendingRetestTask = improvementReportTask(
            correct = 0,
            total = 2,
            masteryBefore = 0.2,
            masteryAfterDiagnostic = 0.4,
            latestRetestCorrect = null,
            latestRetestTotal = null,
        )

        assertEquals("检测：1/2 · 掌握度：25% → 55% · 复测：3/4", reinforcementReportTaskDetailText(retestedTask))
        assertEquals("检测：0/2 · 掌握度：20% → 40% · 复测：未复测", reinforcementReportTaskDetailText(pendingRetestTask))
    }

    @Test
    fun `task completion panel mirrors web improvement completion actions`() {
        val plan = improvementPlan(
            status = "active",
            currentTaskId = "task-2",
            tasks = listOf(
                improvementTask("task-1", "楞次定律", "practiced", weak = true),
                improvementTask("task-2", "磁通量", "pending", weak = true),
            ),
        )

        assertEquals("本步提升已记录，建议回到提升路径继续下一步。 下一步：磁通量。", reinforcementTaskCompleteNote(plan))
        assertEquals("继续下一步", reinforcementTaskCompleteContinueLabel(plan))
        assertEquals(true, reinforcementTaskCompleteCanContinue(plan))
    }

    @Test
    fun `task completion panel points to retest when no next task remains`() {
        val plan = improvementPlan(
            status = "ready_for_retest",
            tasks = listOf(improvementTask("task-1", "楞次定律", "practiced", weak = true)),
        )

        assertEquals("本步提升已记录，建议回到提升路径继续下一步。 本轮任务已完成，下一阶段将进行复测。", reinforcementTaskCompleteNote(plan))
        assertEquals("回到提升路径", reinforcementTaskCompleteContinueLabel(plan))
        assertEquals(false, reinforcementTaskCompleteCanContinue(plan))
    }

    @Test
    fun `improvement tasks are grouped by group name like web panel`() {
        val tasks = listOf(
            improvementTask("task-1", "楞次定律", "pending", weak = true, groupName = "感应电流方向", priority = 2),
            improvementTask("task-2", "磁通量", "pending", weak = true, groupName = "磁通量", priority = 1),
            improvementTask("task-3", "综合应用", "pending", weak = true, groupName = "", priority = 3),
        )

        val groups = groupImprovementTasks(tasks)

        assertEquals(listOf("磁通量", "感应电流方向", "未分组知识点"), groups.map { it.groupName })
        assertEquals(
            listOf(listOf("task-2"), listOf("task-1"), listOf("task-3")),
            groups.map { group -> group.tasks.map { it.id } },
        )
    }

    @Test
    fun `current improvement task card mirrors web focus copy`() {
        val pending = improvementTask("task-1", "楞次定律", "pending", weak = true)
        val inProgress = improvementTask("task-2", "磁通量", "in_progress", weak = true)

        assertEquals("修复「楞次定律」", reinforcementCurrentTaskTitle(pending))
        assertEquals("开始本步提升", reinforcementCurrentTaskPrimaryActionLabel(pending))
        assertEquals("继续本步提升", reinforcementCurrentTaskPrimaryActionLabel(inProgress))
        assertEquals("0/1 正确 · 掌握度 20% · 20% → 20%", reinforcementCurrentTaskMasteryText(pending))
    }

    @Test
    fun `current improvement empty state mirrors web retest and report copy`() {
        val readyForRetest = improvementPlan(
            status = "ready_for_retest",
            tasks = listOf(improvementTask("task-1", "楞次定律", "practiced", weak = true)),
        )
        val completed = improvementPlan(
            status = "completed",
            tasks = listOf(improvementTask("task-1", "楞次定律", "passed", weak = true)),
        )
        val empty = improvementPlan(status = "active", tasks = emptyList())

        assertEquals("本轮提升任务已完成，可以进入阶段复测。", reinforcementCurrentEmptyTitle(readyForRetest))
        assertEquals("用一组阶段复测确认刚才补弱是否真正稳定。", reinforcementCurrentEmptyReason(readyForRetest))
        assertEquals("开始阶段复测", reinforcementCurrentEmptyPrimaryActionLabel(readyForRetest))
        assertEquals(true, reinforcementCurrentEmptyPrimaryActionEnabled(readyForRetest))

        assertEquals("本轮提升已通过", reinforcementCurrentEmptyTitle(completed))
        assertEquals("本轮提升报告已生成，可以查看报告，或回到首页选择新的巩固范围。", reinforcementCurrentEmptyReason(completed))
        assertEquals("查看提升报告", reinforcementCurrentEmptyPrimaryActionLabel(completed))
        assertEquals(true, reinforcementCurrentEmptyPrimaryActionEnabled(completed))

        assertEquals("暂无可提升任务", reinforcementCurrentEmptyTitle(empty))
        assertEquals("本轮检测没有生成可执行任务，可以返回首页重新检测。", reinforcementCurrentEmptyReason(empty))
        assertEquals("暂无可提升任务", reinforcementCurrentEmptyPrimaryActionLabel(empty))
        assertEquals(false, reinforcementCurrentEmptyPrimaryActionEnabled(empty))
    }

    @Test
    fun `improvement task row uses web aligned mastery progress text`() {
        val task = improvementTask("task-1", "楞次定律", "pending", weak = true)

        assertEquals("0/1 正确", reinforcementTaskMasteryPrimaryText(task))
        assertEquals("掌握度 20%", reinforcementTaskMasteryAfterText(task))
        assertEquals("20% → 20%", reinforcementTaskMasteryChangeText(task))
    }

    @Test
    fun `improvement task row hides status badge like web panel`() {
        val pending = improvementTask("task-1", "楞次定律", "pending", weak = true)
        val inProgress = improvementTask("task-2", "磁通量", "in_progress", weak = true)

        assertEquals(false, reinforcementTaskStatusBadgeVisible(pending))
        assertEquals(false, reinforcementTaskStatusBadgeVisible(inProgress))
    }

    @Test
    fun `zero mastery task still keeps progress track`() {
        val task = improvementTask(
            "task-1",
            "楞次定律",
            "pending",
            weak = true,
            masteryBefore = 0.0,
            masteryAfter = 0.0,
        )

        assertEquals(0.0, reinforcementTaskMasteryProgressFraction(task), 0.0001)
        assertEquals(true, reinforcementTaskMasteryProgressTrackVisible(task))
    }

    @Test
    fun `improvement task practice action mirrors web status matrix`() {
        val pending = improvementTask("task-1", "楞次定律", "pending", weak = true)
        val practiced = improvementTask("task-2", "磁通量", "practiced", weak = true)
        val passed = improvementTask("task-3", "电磁感应综合", "passed", weak = false)

        assertEquals(ReinforcementTaskPracticeAction("专项练", enabled = true), reinforcementTaskPracticeAction(pending, "active"))
        assertEquals(ReinforcementTaskPracticeAction("待复测", enabled = false), reinforcementTaskPracticeAction(practiced, "ready_for_retest"))
        assertEquals(ReinforcementTaskPracticeAction("已通过", enabled = false), reinforcementTaskPracticeAction(passed, "active"))
        assertEquals(ReinforcementTaskPracticeAction("本轮已完成", enabled = false), reinforcementTaskPracticeAction(pending, "completed"))
    }

    @Test
    fun `scope result recommendation copy mirrors web guidance`() {
        val activePlan = improvementPlan(
            status = "active",
            currentTaskId = "task-1",
            tasks = listOf(improvementTask("task-1", "楞次定律", "pending", weak = true)),
        )
        val readyForRetest = improvementPlan(
            status = "ready_for_retest",
            tasks = listOf(improvementTask("task-1", "楞次定律", "practiced", weak = true)),
        )

        assertEquals("已经找到薄弱点，建议先完成一组针对性训练，再回看知识和复测。", reinforcementScopeGuidanceText(hasWeakKps = true))
        assertEquals("本轮检测整体较稳定，可以继续做一组提升训练，检查综合应用能力。", reinforcementScopeGuidanceText(hasWeakKps = false))
        assertEquals("推荐下一步：先处理「楞次定律」。", reinforcementScopeNextTaskText(activePlan))
        assertEquals("已生成 1 个提升任务，当前建议先处理「楞次定律」。", reinforcementScopePlanTaskSummaryText(activePlan))
        assertEquals("已生成 1 个提升任务，当前建议先处理「阶段复测」。", reinforcementScopePlanTaskSummaryText(readyForRetest))
    }

    @Test
    fun `improvement task review action label mirrors web copy`() {
        assertEquals("回看知识", reinforcementTaskReviewActionLabel())
    }

    @Test
    fun `native back behavior returns to stable reinforcement parent`() {
        val activePlan = improvementPlan(
            status = "active",
            currentTaskId = "task-1",
            tasks = listOf(improvementTask("task-1", "楞次定律", "pending", weak = true)),
        )
        val retestReadyPlan = improvementPlan(
            status = "ready_for_retest",
            tasks = listOf(improvementTask("task-1", "楞次定律", "practiced", weak = true)),
        )

        assertEquals(ReinforcementNativeBackTarget.Plan, reinforcementScopeResultBackTarget(activePlan))
        assertEquals(ReinforcementNativeBackTarget.Plan, reinforcementRetestResultBackTarget(retestReadyPlan))
        assertEquals(ReinforcementNativeBackTarget.Plan, reinforcementTaskCompleteBackTarget(activePlan))
    }

    @Test
    fun `improvement mastery progress exposes native accessibility description`() {
        val task = improvementTask("task-1", "楞次定律", "pending", weak = true)

        assertEquals(
            "楞次定律掌握度 20%，本轮变化 20% 到 20%，0/1 正确",
            reinforcementTaskMasteryAccessibilityLabel(task),
        )
    }

    @Test
    fun `diagnostic detail rediagnose availability mirrors web scope support`() {
        assertEquals(true, reinforcementDiagnosticRediagnoseEnabled("chapter"))
        assertEquals(true, reinforcementDiagnosticRediagnoseEnabled("section"))
        assertEquals(false, reinforcementDiagnosticRediagnoseEnabled("volume"))
    }

    @Test
    fun `learning trace action opens concrete web aligned target`() {
        val diagnostic = learningTraceEvent(primaryAction = "view_diagnostic", attemptId = "attempt-1")
        val report = learningTraceEvent(primaryAction = "view_report", planId = "plan-1")
        val missingDiagnosticId = learningTraceEvent(primaryAction = "view_diagnostic")

        assertEquals(
            ReinforcementTraceAction("查看检测结果", ReinforcementTraceTarget.DiagnosticAttempt, "attempt-1", primary = false),
            reinforcementTraceAction(diagnostic),
        )
        assertEquals(
            ReinforcementTraceAction("查看提升报告", ReinforcementTraceTarget.Report, "plan-1", primary = true),
            reinforcementTraceAction(report),
        )
        assertEquals(null, reinforcementTraceAction(missingDiagnosticId))
    }

    @Test
    fun `learning trace meta mirrors web scope and knowledge point display`() {
        assertEquals(
            "章节 · 第二章 电磁感应 · 楞次定律",
            reinforcementTraceMeta(learningTraceEvent(primaryAction = "view_plan", kpName = "楞次定律")),
        )
        assertEquals(
            "章节 · 第二章 电磁感应",
            reinforcementTraceMeta(learningTraceEvent(primaryAction = "view_plan")),
        )
    }

    @Test
    fun `diagnostic history primary action prefers linked plan like web`() {
        val linked = diagnosticAttemptListItem(linkedPlanId = "plan-1")
        val plain = diagnosticAttemptListItem(linkedPlanId = "")

        assertEquals(
            ReinforcementDiagnosticHistoryAction("查看提升路径", ReinforcementTraceTarget.Plan, "plan-1"),
            reinforcementDiagnosticHistoryPrimaryAction(linked),
        )
        assertEquals(
            ReinforcementDiagnosticHistoryAction("查看检测记录", ReinforcementTraceTarget.DiagnosticAttempt, "attempt-1"),
            reinforcementDiagnosticHistoryPrimaryAction(plain),
        )
    }

    @Test
    fun `diagnostic history meta mirrors web weak point wording`() {
        assertEquals(
            "07-02 10:10 · 正确 1/2 · 薄弱点 1 个",
            reinforcementDiagnosticHistoryMeta(diagnosticAttemptListItem(linkedPlanId = "")),
        )
    }


    @Test
    fun `diagnostic history card opens its most specific destination`() {
        assertEquals(ReinforcementTraceTarget.Plan, reinforcementDiagnosticHistoryCardTarget(diagnosticAttemptListItem(linkedPlanId = "plan-1")).target)
        assertEquals(ReinforcementTraceTarget.DiagnosticAttempt, reinforcementDiagnosticHistoryCardTarget(diagnosticAttemptListItem(linkedPlanId = "")).target)
    }

    @Test
    fun `saved improvement plan page mirrors web header and hides diagnostic detail list`() {
        val policy = reinforcementScopeResultLayoutPolicy()

        assertEquals("hero", policy.headerStyle)
        assertEquals(false, policy.showDiagnosticDetailList)
        assertEquals("本章检测完成", policy.chapterTitle)
        assertEquals("compact", policy.masteryProgressStyle)
        assertEquals("right", policy.taskActionsAlignment)
        assertEquals(listOf("继续本步提升", "回看知识"), policy.currentTaskActions)
        assertEquals(listOf("回看知识", "专项练"), policy.pathTaskActions)
    }

    @Test
    fun `diagnostic attempt detail header uses result wording instead of reinforcement wording`() {
        val policy = reinforcementDiagnosticAttemptDetailLayoutPolicy()

        assertEquals("本章检测结果", policy.chapterTitle)
        assertEquals("本节检测结果", policy.sectionTitle)
        assertEquals(false, policy.usesReinforcementTitle)
        assertEquals("right", policy.linkedPlanActionsAlignment)
        assertEquals(listOf("查看提升路径", "查看提升报告"), policy.linkedPlanActions)
        assertEquals(false, policy.showLongProgressBar)
    }

    @Test
    fun `diagnostic detail report action is only visible when linked report is available`() {
        assertEquals(true, reinforcementDiagnosticDetailShowsReport(diagnosticAttemptDetail(linkedPlanId = "plan-1", reportAvailable = true)))
        assertEquals(false, reinforcementDiagnosticDetailShowsReport(diagnosticAttemptDetail(linkedPlanId = "plan-1", reportAvailable = false)))
        assertEquals(false, reinforcementDiagnosticDetailShowsReport(diagnosticAttemptDetail(linkedPlanId = "", reportAvailable = true)))
    }

    @Test
    fun `reinforcement list footer mirrors web has more pagination state`() {
        assertEquals(
            ReinforcementListFooterState(summary = "已显示 10/25", canLoadMore = true, loadMoreLabel = "加载更多"),
            reinforcementListFooterState(shown = 10, total = 25),
        )
        assertEquals(
            ReinforcementListFooterState(summary = "已显示 25/25", canLoadMore = false, loadMoreLabel = "加载更多"),
            reinforcementListFooterState(shown = 25, total = 25),
        )
    }

    private fun kp(
        id: String,
        name: String,
        volume: String,
        chapter: String,
        mastery: Double,
        learningState: String = "",
        learningStateLabel: String = "",
        learningStateTone: String = "",
    ): KpNode {
        return KpNode(
            id = id,
            name = name,
            volume = volume,
            chapter = chapter,
            section = "第一节",
            mastery = mastery,
            status = if (mastery >= 0.8) "mastered" else "in_progress",
            learningState = learningState,
            learningStateLabel = learningStateLabel,
            learningStateTone = learningStateTone,
        )
    }

    private fun recommended(id: String, name: String, mastery: Double): RecommendedKp {
        return RecommendedKp(kpId = id, kpName = name, mastery = mastery, reason = "掌握度最低且前置知识已达标")
    }

    private fun improvementPlan(
        status: String,
        currentTaskId: String = "",
        tasks: List<ImprovementTask>,
    ): ImprovementPlan {
        return ImprovementPlan(
            id = "plan-1",
            studentId = "student-a",
            diagnosticAttemptId = "attempt-1",
            scopeType = "chapter",
            scopeId = "第二章 电磁感应",
            scopeName = "第二章 电磁感应",
            createdAt = "2026-07-02T10:00:00Z",
            correctCount = 1,
            totalCount = 2,
            weakCount = tasks.count { it.isWeak },
            status = status,
            currentTaskId = currentTaskId,
            tasks = tasks,
        )
    }

    private fun improvementTask(
        id: String,
        name: String,
        status: String,
        weak: Boolean,
        groupName: String = "默认分组",
        priority: Int = 1,
        masteryBefore: Double = 0.2,
        masteryAfter: Double = if (weak) 0.45 else 0.85,
    ): ImprovementTask {
        return ImprovementTask(
            id = id,
            planId = "plan-1",
            kpId = "kp-$id",
            kpName = name,
            correctCount = if (weak) 0 else 1,
            totalCount = 1,
            masteryBefore = masteryBefore,
            masteryAfter = masteryAfter,
            isWeak = weak,
            priority = priority,
            status = status,
            recommendedAction = "practice",
            reason = "检测暴露不稳定",
            groupName = groupName,
        )
    }

    private fun improvementReport(): ImprovementReport {
        return ImprovementReport(
            summary = ImprovementReportSummary(
                planId = "plan-1",
                scopeType = "chapter",
                scopeId = "第二章 电磁感应",
                scopeName = "第二章 电磁感应",
                planStatus = "completed",
                diagnosticCorrectCount = 1,
                diagnosticTotalCount = 2,
                diagnosticAccuracy = 0.5,
                taskCount = 2,
                weakTaskCount = 1,
                passedTaskCount = 2,
                needsRetestTaskCount = 0,
                practicedTaskCount = 2,
                pendingTaskCount = 0,
                retestAttemptCount = 1,
                latestRetestAccuracy = 0.8,
                completed = true,
            ),
            diagnosticResult = null,
            tasks = emptyList(),
            retestAttempts = listOf(
                ImprovementReportRetestAttempt(
                    attemptId = "retest-1",
                    status = "completed",
                    correctCount = 4,
                    totalCount = 5,
                    passedCount = 2,
                    needsRetestCount = 0,
                ),
            ),
            strengths = emptyList(),
            remainingWeaknesses = emptyList(),
            nextActions = emptyList(),
        )
    }

    private fun improvementReportListItem(latestRetestAccuracy: Double?): ImprovementReportListItem {
        return ImprovementReportListItem(
            planId = "plan-1",
            scopeType = "chapter",
            scopeId = "第二章 电磁感应",
            scopeName = "第二章 电磁感应",
            completedAt = "2026-07-02T10:00:00Z",
            diagnosticCorrectCount = 1,
            diagnosticTotalCount = 2,
            diagnosticAccuracy = 0.5,
            taskCount = 2,
            passedTaskCount = 2,
            needsRetestTaskCount = 0,
            latestRetestAccuracy = latestRetestAccuracy,
            summaryLabel = "本轮提升已完成",
            highlight = "复测表现稳定",
        )
    }

    private fun improvementReportTask(
        correct: Int,
        total: Int,
        masteryBefore: Double,
        masteryAfterDiagnostic: Double,
        latestRetestCorrect: Int?,
        latestRetestTotal: Int?,
    ): ImprovementReportTask {
        return ImprovementReportTask(
            taskId = "report-task-1",
            kpId = "kp-a",
            kpName = "楞次定律",
            priority = 1,
            status = "needs_retest",
            recommendedAction = "practice",
            reason = "检测暴露方向判断不稳定",
            diagnosticCorrectCount = correct,
            diagnosticTotalCount = total,
            masteryBefore = masteryBefore,
            masteryAfterDiagnostic = masteryAfterDiagnostic,
            latestRetestCorrectCount = latestRetestCorrect,
            latestRetestTotalCount = latestRetestTotal,
            latestRetestPassed = false,
            finalLabel = "仍需关注",
        )
    }

    private fun learningTraceEvent(
        primaryAction: String,
        attemptId: String = "",
        planId: String = "",
        kpName: String = "",
    ): LearningTraceEvent {
        return LearningTraceEvent(
            id = "trace-1",
            eventType = "scope_diagnostic",
            eventTime = "2026-07-02T10:00:00Z",
            studentId = "student-a",
            scopeType = "chapter",
            scopeId = "第二章 电磁感应",
            scopeName = "第二章 电磁感应",
            title = "完成定位检测",
            description = "发现 1 个薄弱点",
            attemptId = attemptId,
            planId = planId,
            kpName = kpName,
            primaryAction = primaryAction,
            reportAvailable = primaryAction == "view_report",
        )
    }

    private fun diagnosticAttemptListItem(linkedPlanId: String): ScopeDiagnosticAttemptListItem {
        return ScopeDiagnosticAttemptListItem(
            attemptId = "attempt-1",
            scopeType = "chapter",
            scopeId = "第二章 电磁感应",
            scopeName = "第二章 电磁感应",
            diagnosticType = "scope",
            createdAt = "2026-07-02T10:00:00Z",
            submittedAt = "2026-07-02T10:10:00Z",
            correctCount = 1,
            totalCount = 2,
            weakCount = 1,
            linkedPlanId = linkedPlanId,
            linkedPlanStatus = if (linkedPlanId.isBlank()) "" else "active",
            linkedReportAvailable = false,
        )
    }

    private fun diagnosticAttemptDetail(linkedPlanId: String, reportAvailable: Boolean): ScopeDiagnosticAttemptDetail {
        return ScopeDiagnosticAttemptDetail(
            attemptId = "attempt-1",
            studentId = "student-a",
            scopeType = "chapter",
            scopeId = "第二章 电磁感应",
            scopeName = "第二章 电磁感应",
            diagnosticType = "scope",
            status = "completed",
            createdAt = "2026-07-02T10:00:00Z",
            submittedAt = "2026-07-02T10:10:00Z",
            questionIds = listOf("q1", "q2"),
            answerIds = listOf("a1", "a2"),
            correctCount = 1,
            totalCount = 2,
            weakCount = 1,
            weakKpIds = listOf("kp-a"),
            kpResults = emptyList(),
            linkedPlanId = linkedPlanId,
            linkedPlanStatus = if (linkedPlanId.isBlank()) "" else "completed",
            linkedReportAvailable = reportAvailable,
        )
    }
}
