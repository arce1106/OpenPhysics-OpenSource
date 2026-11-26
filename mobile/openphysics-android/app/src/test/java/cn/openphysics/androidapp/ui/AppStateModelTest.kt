package cn.openphysics.androidapp.ui

import cn.openphysics.androidapp.ui.screens.PracticeQuestionSubmitMode
import cn.openphysics.androidapp.domain.ChapterGroup
import cn.openphysics.androidapp.domain.DirectoryData
import cn.openphysics.androidapp.domain.ImprovementPlan
import cn.openphysics.androidapp.domain.KpNode
import cn.openphysics.androidapp.domain.PracticeQuestion
import cn.openphysics.androidapp.domain.PracticeSession
import cn.openphysics.androidapp.domain.PracticeSessionTypes
import cn.openphysics.androidapp.domain.ReviewData
import cn.openphysics.androidapp.domain.ReviewGroup
import cn.openphysics.androidapp.domain.ReviewMistake
import cn.openphysics.androidapp.domain.ScopeDiagnosticResult
import cn.openphysics.androidapp.domain.ScopeDiagnosticAttemptListResponse
import cn.openphysics.androidapp.domain.StudentSession
import org.junit.Assert.assertEquals
import org.junit.Test

class AppStateModelTest {
    @Test
    fun `main navigation reuses cached tab data before background refresh`() {
        val policy = mainNavigationCachePolicy()

        assertEquals(true, policy.showsCachedMainPageBeforeRefresh)
        assertEquals(true, policy.sharesDirectoryCacheForSyncAndReinforcement)
        assertEquals(true, policy.cachesReviewNotebook)
    }

    @Test
    fun `main navigation cache is isolated by student`() {
        val session = StudentSession(
            token = "token",
            studentId = "student-1",
            username = "student",
            displayName = "student",
        )

        assertEquals(true, mainNavigationCacheBelongsToStudent("student-1", session))
        assertEquals(false, mainNavigationCacheBelongsToStudent("student-2", session))
    }

    @Test
    fun `review notebook cache is warmed only when it can reduce first tab latency`() {
        assertEquals(
            true,
            shouldWarmReviewCache(
                canReadHistory = true,
                hasCachedReview = false,
                refreshInFlight = false,
            ),
        )
        assertEquals(
            false,
            shouldWarmReviewCache(
                canReadHistory = false,
                hasCachedReview = false,
                refreshInFlight = false,
            ),
        )
        assertEquals(
            false,
            shouldWarmReviewCache(
                canReadHistory = true,
                hasCachedReview = true,
                refreshInFlight = false,
            ),
        )
        assertEquals(
            false,
            shouldWarmReviewCache(
                canReadHistory = true,
                hasCachedReview = false,
                refreshInFlight = true,
            ),
        )
    }

    @Test
    fun `loaded review detail replaces only its matching summary`() {
        val summary = reviewMistake(answerId = 7, isDetailLoaded = false)
        val other = reviewMistake(answerId = 8, isDetailLoaded = false)
        val detail = reviewMistake(answerId = 7, isDetailLoaded = true, explanation = "完整解析")
        val review = ReviewData(
            groups = listOf(ReviewGroup("kp", "运动", 2, listOf(summary, other))),
            reviewedCount = 0,
            totalCount = 2,
        )

        val updated = reviewWithLoadedMistake(review, detail)

        assertEquals("完整解析", updated.groups.single().mistakes.first().explanation)
        assertEquals(true, updated.groups.single().mistakes.first().isDetailLoaded)
        assertEquals(false, updated.groups.single().mistakes.last().isDetailLoaded)
    }

    @Test
    fun `reinforcement load more does not duplicate current list in back stack`() {
        assertEquals(false, reinforcementLoadMoreKeepsCurrentInBackStack())
    }

    @Test
    fun `reinforcement load more keeps current list reachable when request fails`() {
        assertEquals(true, reinforcementLoadMoreKeepsCurrentOnErrorInBackStack())
    }

    @Test
    fun `improvement task practice uses web aligned single-question grading`() {
        val mode = practiceQuestionSubmitMode(
            practice = PracticeSession(objective = "专项练", questions = emptyList(), sessionType = PracticeSessionTypes.Practice),
            context = ReinforcementPracticeContext.TaskPractice(planId = "plan-1", taskId = "task-1"),
        )

        assertEquals(PracticeQuestionSubmitMode.SingleQuestion, mode)
    }

    @Test
    fun `test type practice uses final photo batch while retest keeps regular batch grading`() {
        assertEquals(
            PracticeQuestionSubmitMode.FinalPhotoBatch,
            practiceQuestionSubmitMode(
                practice = PracticeSession(objective = "掌握评估", questions = emptyList(), sessionType = PracticeSessionTypes.KpDiagnostic),
                context = null,
            ),
        )
        assertEquals(
            PracticeQuestionSubmitMode.FinalPhotoBatch,
            practiceQuestionSubmitMode(
                practice = PracticeSession(objective = "单元检测", questions = emptyList(), sessionType = PracticeSessionTypes.Practice),
                context = ReinforcementPracticeContext.ScopeDiagnostic(
                    scopeType = "chapter",
                    scopeId = "第二章",
                    scopeName = "第二章",
                ),
            ),
        )
        assertEquals(
            PracticeQuestionSubmitMode.Batch,
            practiceQuestionSubmitMode(
                practice = PracticeSession(objective = "阶段复测", questions = emptyList(), sessionType = PracticeSessionTypes.Practice),
                context = ReinforcementPracticeContext.Retest(planId = "plan-1", attemptId = "attempt-1"),
            ),
        )
    }

    @Test
    fun `practice page titles follow web scene names`() {
        val consolidation = practiceScreen()
        assertEquals("巩固小练", practicePageTitle(consolidation.copy(
            practice = consolidation.practice.copy(objective = "强化理解与应用"),
        )))
        assertEquals("本章 · 混合提升", practicePageTitle(consolidation.copy(
            practice = consolidation.practice.copy(objective = "本章 · 混合提升", strategy = "chapter_mixed"),
        )))
        assertEquals("巩固提升", practicePageTitle(consolidation.copy(kp = consolidation.kp.copy(id = "reinforcement"))))
        assertEquals(
            "掌握评估",
            practicePageTitle(practiceScreen(sessionType = PracticeSessionTypes.KpDiagnostic)),
        )
        assertEquals(
            "单元检测",
            practicePageTitle(
                practiceScreen(
                    reinforcementContext = ReinforcementPracticeContext.ScopeDiagnostic(
                        scopeType = "chapter",
                        scopeId = "第二章",
                        scopeName = "第二章",
                    ),
                ),
            ),
        )
        assertEquals(
            "本节检测",
            practicePageTitle(
                practiceScreen(
                    reinforcementContext = ReinforcementPracticeContext.ScopeDiagnostic(
                        scopeType = "section",
                        scopeId = "第一章 运动的描述||1.1 质点 参考系",
                        scopeName = "1.1 质点 参考系",
                    ),
                ),
            ),
        )
        assertEquals(
            "专项练",
            practicePageTitle(
                practiceScreen(
                    reinforcementContext = ReinforcementPracticeContext.TaskPractice(
                        planId = "plan-1",
                        taskId = "task-1",
                    ),
                ),
            ),
        )
        assertEquals(
            "阶段复测",
            practicePageTitle(
                practiceScreen(
                    reinforcementContext = ReinforcementPracticeContext.Retest(
                        planId = "plan-1",
                        attemptId = "attempt-1",
                    ),
                ),
            ),
        )
    }

    @Test
    fun `diagnostic and retest save summaries then show question review`() {
        val scope = ReinforcementPracticeContext.ScopeDiagnostic(
            scopeType = "chapter", scopeId = "第二章", scopeName = "第二章",
        )
        val retest = ReinforcementPracticeContext.Retest(planId = "plan-1", attemptId = "attempt-1")
        assertEquals(true, reviewBeforeReinforcementSummary(scope))
        assertEquals(true, reviewBeforeReinforcementSummary(retest))
        assertEquals(false, reviewBeforeReinforcementSummary(ReinforcementPracticeContext.TaskPractice("plan-1", "task-1")))
        assertEquals(
            PracticePostGradingDestination.ReinforcementSummary,
            practicePostGradingDestination(
                hasQuestionResult = true,
                reinforcementContext = scope,
            ),
        )
        assertEquals(
            PracticePostGradingDestination.ReinforcementSummary,
            practicePostGradingDestination(
                hasQuestionResult = true,
                reinforcementContext = retest,
            ),
        )
        assertEquals(
            PracticePostGradingDestination.ReinforcementSummary,
            practicePostGradingDestination(
                hasQuestionResult = false,
                reinforcementContext = ReinforcementPracticeContext.ScopeDiagnostic(
                    scopeType = "chapter",
                    scopeId = "第二章",
                    scopeName = "第二章",
                ),
            ),
        )
        assertEquals(PracticePostGradingDestination.QuestionResult, practicePostGradingDestination(true, null))
    }

    @Test
    fun `diagnostic detail finds the latest matching history without revisiting itself`() {
        val session = StudentSession("token", "student-1", "student", "student")
        val other = session.copy(studentId = "student-2")
        val data = DirectoryData(emptyList(), 0, 0, 0)
        val attempts = ScopeDiagnosticAttemptListResponse(emptyList(), 0, 10, 0)
        val stack = listOf(
            Screen.ReinforcementDiagnosticHistory(other, data, attempts),
            Screen.ReinforcementDiagnosticHistory(session, data, attempts),
            Screen.Settings(session),
            Screen.ReinforcementDiagnosticHistory(session, data, attempts),
        )
        assertEquals(3, diagnosticHistoryBackStackIndex(stack, session.studentId))
        assertEquals(0, diagnosticHistoryBackStackIndex(stack, other.studentId))
        assertEquals(-1, diagnosticHistoryBackStackIndex(listOf(Screen.Settings(session)), session.studentId))
    }

    @Test
    fun `improvement plan is reused only for the same durable diagnostic attempt`() {
        val result = scopeResult("attempt-1")
        val matching = improvementPlan("attempt-1")
        val stale = improvementPlan("attempt-old")

        assertEquals(true, improvementPlanMatchesDiagnostic(matching, result))
        assertEquals(false, improvementPlanMatchesDiagnostic(stale, result))
        assertEquals(false, improvementPlanMatchesDiagnostic(null, result))
        assertEquals(false, improvementPlanMatchesDiagnostic(matching, scopeResult("")))
    }

    private fun practiceScreen(
        sessionType: String = PracticeSessionTypes.Practice,
        reinforcementContext: ReinforcementPracticeContext? = null,
    ): Screen.PracticeQuestionScreen {
        val kp = KpNode(
            id = "kp-1",
            name = "质点",
            volume = "必修 第一册",
            chapter = "第一章",
            section = "1.1",
            mastery = 0.0,
            status = "not_started",
        )
        return Screen.PracticeQuestionScreen(
            session = StudentSession(
                token = "token",
                studentId = "student-1",
                username = "student",
                displayName = "student",
            ),
            data = DirectoryData(
                kps = listOf(kp),
                mastered = 0,
                inProgress = 0,
                total = 1,
            ),
            chapter = ChapterGroup("必修 第一册", "第一章", listOf(kp)),
            kp = kp,
            practice = PracticeSession(
                objective = "混合提升",
                questions = listOf(
                    PracticeQuestion(
                        id = "q-1",
                        stem = "题干",
                        questionType = "single_choice",
                        options = emptyList(),
                        images = emptyList(),
                    ),
                ),
                sessionType = sessionType,
            ),
            index = 0,
            reinforcementContext = reinforcementContext,
        )
    }

    private fun reviewMistake(
        answerId: Int,
        isDetailLoaded: Boolean,
        explanation: String = "",
    ): ReviewMistake {
        return ReviewMistake(
            answerId = answerId,
            questionId = "q-$answerId",
            stemText = "题干",
            questionType = "calculation",
            options = emptyList(),
            images = emptyList(),
            givenAnswer = "作答",
            correctAnswer = "",
            explanation = explanation,
            misconceptionName = "待复盘",
            createdAt = "",
            isDetailLoaded = isDetailLoaded,
        )
    }

    private fun scopeResult(attemptId: String): ScopeDiagnosticResult {
        return ScopeDiagnosticResult(
            diagnosticAttemptId = attemptId,
            scopeType = "chapter",
            scopeId = "第一章",
            scopeName = "第一章",
            kpResults = emptyList(),
            correctCount = 0,
            totalCount = 0,
            weakKpIds = emptyList(),
            recommendation = "",
            feedback = "",
        )
    }

    private fun improvementPlan(attemptId: String): ImprovementPlan {
        return ImprovementPlan(
            id = "plan-$attemptId",
            studentId = "student-1",
            diagnosticAttemptId = attemptId,
            scopeType = "chapter",
            scopeId = "第一章",
            scopeName = "第一章",
            createdAt = "",
            correctCount = 0,
            totalCount = 0,
            weakCount = 0,
            status = "diagnosed",
            tasks = emptyList(),
        )
    }
}
