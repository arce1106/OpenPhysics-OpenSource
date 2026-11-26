package cn.openphysics.androidapp.ui

import cn.openphysics.androidapp.domain.LearningCatalogTopicLayer
import cn.openphysics.androidapp.domain.PracticeQuestion
import cn.openphysics.androidapp.domain.PracticeSession
import cn.openphysics.androidapp.domain.SubmitResult
import cn.openphysics.androidapp.domain.TeacherPaper
import cn.openphysics.androidapp.ui.screens.PracticeQuestionSubmitMode
import cn.openphysics.androidapp.ui.screens.PracticeSummaryAction
import cn.openphysics.androidapp.ui.screens.buildPracticeSummaryDialogModel
import cn.openphysics.androidapp.ui.screens.gaokaoRecentPracticeLabel
import cn.openphysics.androidapp.ui.screens.gaokaoTopicWorkbenchState
import cn.openphysics.androidapp.ui.screens.GaokaoTopicWorkbenchState
import org.junit.Assert.assertEquals
import org.junit.Test

class GaokaoReviewFlowTest {
    @Test
    fun `teacher paper defers grading until whole paper submission`() {
        val practice = PracticeSession("教师作业", emptyList(), teacherPaper = TeacherPaper("paper-1", "运动", 10, true, "attempt"))
        assertEquals(PracticeQuestionSubmitMode.FinalPhotoBatch,
            practiceQuestionSubmitMode(practice, context = null, learningCatalogContext = context.copy(layer = LearningCatalogTopicLayer.Paper)))
    }

    private val context = LearningCatalogPracticeContext(
        catalogCode = "gaokao_review",
        nodeId = "topic-1",
        topicTitle = "运动描述",
        layer = LearningCatalogTopicLayer.Foundation,
    )

    @Test
    fun `topic status formats its own recent review date`() {
        assertEquals("暂无复习记录", gaokaoRecentPracticeLabel(""))
        assertEquals("最近复习 7月18日", gaokaoRecentPracticeLabel("2026-07-18T10:20:30Z"))
        assertEquals("已有复习记录", gaokaoRecentPracticeLabel("not-a-date"))
    }

    @Test
    fun `diagnostic and topic papers defer grading while review layers grade each question`() {
        val practice = PracticeSession("专题训练", emptyList())

        assertEquals(
            PracticeQuestionSubmitMode.FinalPhotoBatch,
            practiceQuestionSubmitMode(
                practice,
                context = null,
                learningCatalogContext = context.copy(layer = LearningCatalogTopicLayer.Diagnostic),
            ),
        )
        assertEquals(
            PracticeQuestionSubmitMode.SingleQuestion,
            practiceQuestionSubmitMode(practice, context = null, learningCatalogContext = context),
        )
        assertEquals(
            PracticeQuestionSubmitMode.FinalPhotoBatch,
            practiceQuestionSubmitMode(
                practice,
                context = null,
                learningCatalogContext = context.copy(layer = LearningCatalogTopicLayer.Paper),
            ),
        )
    }

    @Test
    fun `topic workbench keeps catalog visible while overview loads`() {
        assertEquals(
            GaokaoTopicWorkbenchState.Loading,
            gaokaoTopicWorkbenchState(false, overviewLoading = true, hasOverview = false),
        )
        assertEquals(
            GaokaoTopicWorkbenchState.Empty,
            gaokaoTopicWorkbenchState(false, overviewLoading = false, hasOverview = false),
        )
        assertEquals(
            GaokaoTopicWorkbenchState.Loading,
            gaokaoTopicWorkbenchState(true, overviewLoading = true, hasOverview = false),
        )
        assertEquals(
            GaokaoTopicWorkbenchState.Ready,
            gaokaoTopicWorkbenchState(true, overviewLoading = false, hasOverview = true),
        )
        assertEquals(
            GaokaoTopicWorkbenchState.Unavailable,
            gaokaoTopicWorkbenchState(true, overviewLoading = false, hasOverview = false),
        )
    }

    @Test
    fun `gaokao result returns to topic path or repeats current layer`() {
        val question = PracticeQuestion(
            id = "q-1",
            stem = "题干",
            questionType = "single_choice",
            options = emptyList(),
            images = emptyList(),
        )
        val practice = PracticeSession("基础巩固", listOf(question))
        val review = PracticeReview(
            items = listOf(
                PracticeReviewItem(
                    question = question,
                    answer = "A",
                    result = SubmitResult(
                        answerId = 1,
                        correct = true,
                        correctAnswer = "A",
                        explanation = "",
                        aiFeedback = "",
                    ),
                ),
            ),
        )

        val model = buildPracticeSummaryDialogModel(
            kpName = "运动描述",
            practice = practice,
            review = review,
            learningCatalogContext = context,
        )

        assertEquals("专题复习结果", model.title)
        assertEquals("返回专题路径", model.primaryLabel)
        assertEquals(PracticeSummaryAction.GaokaoReturn, model.primaryAction)
        assertEquals("再练本层", model.secondaryLabel)
        assertEquals(PracticeSummaryAction.GaokaoRepeat, model.secondaryAction)
    }
}
