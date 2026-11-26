package cn.openphysics.androidapp.ui.screens

import cn.openphysics.androidapp.domain.DashboardData
import cn.openphysics.androidapp.domain.DailyLearningLoopDay
import cn.openphysics.androidapp.domain.DailyLearningLoop
import cn.openphysics.androidapp.domain.DailyLearningLoopHistory
import cn.openphysics.androidapp.domain.DailyLearningLoopHistorySummary
import cn.openphysics.androidapp.domain.DailyLoopRing
import cn.openphysics.androidapp.domain.DailyLoopRings
import cn.openphysics.androidapp.domain.DiagnosisSummary
import cn.openphysics.androidapp.domain.GrowthReportData
import cn.openphysics.androidapp.domain.MotivationPanel
import cn.openphysics.androidapp.domain.PlanRecommendation
import org.junit.Assert.assertEquals
import org.junit.Test

class HomeTaskTest {
    @Test
    fun `tablet top nav removes home item and keeps public app brand`() {
        assertEquals(listOf("Open", "Physics"), tabletHomeBrandSegments())
        assertEquals(listOf("同步学习", "巩固提升", "高考复习", "错题复盘"), tabletHomePrimaryNavItems())
    }

    @Test
    fun `tablet daily loop side card keeps metric order and overlay placement`() {
        assertEquals(listOf("连续学习天数", "本周掌握知识点", "待复盘错题"), tabletHomeLoopMetricLabels())
        assertEquals(520, tabletDailyLoopCalendarOverlayWidthDp())
        assertEquals(232, tabletDailyLoopCalendarOverlayTopOffsetDp())
        assertEquals(true, tabletDailyLoopCalendarOverlaysContent())
    }

    @Test
    fun `tablet top cards use web aligned two to one layout ratio`() {
        assertEquals(2f, tabletHomeMissionCardWeight())
        assertEquals(1f, tabletHomeLoopCardWeight())
    }

    @Test
    fun `home growth record copy matches web growth status badge`() {
        assertEquals("学习成长记录", homeGrowthRecordTitle())
        assertEquals(
            "完成学习、练习或订正后，系统会记录知识点掌握变化，并给出下一步建议。",
            homeGrowthRecordDescription(streakDays = 0),
        )
        assertEquals(
            "最近连续 4 天有学习记录，系统会根据作答、订正和知识点掌握变化持续更新反馈。",
            homeGrowthRecordDescription(streakDays = 4),
        )
    }

    @Test
    fun `home growth panels keep concise advice and report history label`() {
        assertEquals(
            "先按今日推荐完成最关键任务，再根据错题、掌握度和知识点状态选择入口。系统会用练习、订正和复盘数据更新下一步建议。",
            homeGrowthAdviceDescription(),
        )
        assertEquals(
            "完成一段连续学习后，这里会整理近期掌握提升、错因变化和下一步复习重点。",
            homeGrowthReportSummary(null),
        )
        val report = GrowthReportData(
            id = "report-1",
            summary = "本周 v1c1s1k02 掌握更稳定。",
            totalAnswers = 12,
        )
        assertEquals("本周 参考系 掌握更稳定。", homeGrowthReportSummary(report))
        assertEquals("查看这 12 题记录", homeGrowthReportHistoryLabel(report))
        assertEquals("查看练习记录", homeGrowthReportHistoryLabel(null))
    }

    @Test
    fun `mobile daily loop calendar uses web square cell chrome`() {
        val spec = mobileDailyLoopCalendarCellSpec()

        assertEquals(0.72f, spec.aspectRatio)
        assertEquals(false, spec.showsCellBorder)
        assertEquals(true, spec.highlightsToday)
        assertEquals(40, spec.compactRingSizeDp)
        assertEquals(0f, spec.ringGapDp)
    }

    @Test
    fun `prioritizes mistake review before new practice`() {
        val task = buildTodayTask(dashboard(mistakeBacklog = 4, planMastery = 0.2))

        assertEquals(HomeTaskAction.Review, task.actionType)
        assertEquals("去复盘错题", task.action)
    }

    @Test
    fun `sends low mastery plan to sync learning`() {
        val task = buildTodayTask(dashboard(mistakeBacklog = 0, planMastery = 0.3))

        assertEquals(HomeTaskAction.Sync, task.actionType)
        assertEquals("进入同步学习", task.action)
        assertEquals("kp_1", task.kpId)
    }

    @Test
    fun `sends practiced plan to reinforcement`() {
        val task = buildTodayTask(dashboard(mistakeBacklog = 0, planMastery = 0.55))

        assertEquals(HomeTaskAction.Reinforcement, task.actionType)
        assertEquals("进入巩固提升", task.action)
        assertEquals("kp_1", task.kpId)
    }

    @Test
    fun `daily loop ring state exposes completion overflow and auto review label`() {
        val state = mobileDailyLoopRingState(
            rings = DailyLoopRings(
                practice = ring("practice", "做题环", current = 7, actualCurrent = 7, target = 5, overflow = 2),
                review = ring("review", "复盘环", current = 3, actualCurrent = 0, target = 3, autoCompleted = true),
            ),
        )

        assertEquals(2, state.closedCount)
        assertEquals(1.0, state.practiceProgress, 0.001)
        assertEquals(0.4, state.practiceOverflowProgress, 0.001)
        assertEquals("7/5", state.practiceCountLabel)
        assertEquals("0/3 · 无待复盘", state.reviewCountLabel)
    }

    @Test
    fun `daily loop history groups days by month newest first with weekday placeholders`() {
        val sections = mobileDailyLoopMonthSections(
            DailyLearningLoopHistory(
                startDate = "2026-05-31",
                endDate = "2026-06-06",
                practiceTarget = 5,
                reviewTarget = 3,
                summary = DailyLearningLoopHistorySummary(
                    practiceTotal = 12,
                    reviewTotal = 5,
                    practiceClosedDays = 1,
                    reviewClosedDays = 2,
                    dualClosedDays = 1,
                    effectiveDays = 3,
                ),
                days = listOf(
                    day("2026-05-31"),
                    day("2026-06-01"),
                    day("2026-06-06", highQuality = true),
                ),
            ),
        )

        assertEquals(listOf("2026年6月", "2026年5月"), sections.map { it.label })
        assertEquals("2026-06-01", sections.first().cells.first { it.dayOfMonth == 1 }.iso)
        assertEquals(true, sections.first().cells.first { it.iso == "2026-06-06" }.isToday)
        assertEquals(true, sections.first().cells.first { it.iso == "2026-06-06" }.day?.isHighQualityDay)
        assertEquals(4, sections.last().cells.takeWhile { it.iso == null }.size)
    }

    @Test
    fun `daily loop history merges today loop and recomputes summary like web`() {
        val history = DailyLearningLoopHistory(
            startDate = "2026-07-01",
            endDate = "2026-07-04",
            practiceTarget = 5,
            reviewTarget = 3,
            summary = DailyLearningLoopHistorySummary(
                practiceTotal = 3,
                reviewTotal = 1,
                practiceClosedDays = 0,
                reviewClosedDays = 0,
                dualClosedDays = 0,
                effectiveDays = 1,
            ),
            days = listOf(day("2026-07-01")),
        )
        val today = DailyLearningLoop(
            date = "2026-07-04",
            isEffectiveDay = true,
            isHighQualityDay = true,
            rings = DailyLoopRings(
                practice = ring("practice", "做题环", current = 6, actualCurrent = 6, target = 5, overflow = 1),
                review = ring("review", "复盘环", current = 3, actualCurrent = 0, target = 3, autoCompleted = true),
            ),
            summary = "",
            nextAction = "",
            streakDays = 1,
        )

        val merged = mobileDailyLoopHistoryWithToday(history, today)

        assertEquals(listOf("2026-07-01", "2026-07-04"), merged.days.map { it.date })
        assertEquals(9, merged.summary.practiceTotal)
        assertEquals(1, merged.summary.reviewTotal)
        assertEquals(1, merged.summary.practiceClosedDays)
        assertEquals(1, merged.summary.reviewClosedDays)
        assertEquals(1, merged.summary.dualClosedDays)
        assertEquals(2, merged.summary.effectiveDays)
    }

    private fun dashboard(mistakeBacklog: Int, planMastery: Double): DashboardData {
        return DashboardData(
            diagnosis = DiagnosisSummary(
                overallMastery = 0.5,
                masteredCount = 1,
                inProgressCount = 2,
                lockedCount = 3,
                weakPoints = emptyList(),
            ),
            plan = PlanRecommendation(
                kpId = "kp_1",
                kpName = "质点",
                mastery = planMastery,
                reason = "当前最值得推进",
                estimatedQuestions = 5,
                estimatedMinutes = 15,
            ),
            motivation = MotivationPanel(
                streakDays = 2,
                weeklyKpsMastered = 1,
                mistakeBacklogCount = mistakeBacklog,
                nextMilestone = "",
            ),
        )
    }

    private fun day(date: String, highQuality: Boolean = false): DailyLearningLoopDay {
        return DailyLearningLoopDay(
            date = date,
            isEffectiveDay = true,
            isHighQualityDay = highQuality,
            rings = DailyLoopRings(
                practice = ring("practice", "做题环", current = 3, actualCurrent = 3, target = 5),
                review = ring("review", "复盘环", current = 1, actualCurrent = 1, target = 3),
            ),
            summary = "",
            nextAction = "",
        )
    }

    private fun ring(
        key: String,
        label: String,
        current: Int,
        actualCurrent: Int,
        target: Int,
        overflow: Int = 0,
        autoCompleted: Boolean = false,
    ): DailyLoopRing {
        return DailyLoopRing(
            key = key,
            label = label,
            completed = current >= target || autoCompleted,
            current = current,
            actualCurrent = actualCurrent,
            target = target,
            overflow = overflow,
            autoCompleted = autoCompleted,
            pendingMistakes = if (key == "review") 0 else null,
            evidence = "",
        )
    }
}
