package cn.openphysics.androidapp.ui.screens

import cn.openphysics.androidapp.domain.PracticeOption
import cn.openphysics.androidapp.domain.PracticeQuestion
import cn.openphysics.androidapp.domain.PracticeSession
import cn.openphysics.androidapp.domain.PracticeSessionTypes
import cn.openphysics.androidapp.domain.PracticeSelfReviewItem
import cn.openphysics.androidapp.domain.DiagnosticFeedback
import cn.openphysics.androidapp.domain.ProcessGrading
import cn.openphysics.androidapp.domain.SubmitResult
import cn.openphysics.androidapp.ui.PracticeReview
import cn.openphysics.androidapp.ui.PracticeReviewItem
import cn.openphysics.androidapp.ui.ReinforcementPracticeContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class PracticeNavigationSummaryTest {
    @Test
    fun `tablet navigation summary removes redundant status labels`() {
        val summary = tabletPracticeNavigationSummary(
            index = 9,
            total = 10,
            answeredCount = 0,
        )

        assertEquals("0/10", summary.progressText)
        assertEquals("第 10 题", summary.currentText)
        assertFalse(summary.progressText.contains("已完成"))
        assertFalse(summary.currentText.contains("当前"))
        assertFalse(summary.currentText.contains("剩余"))
    }

    @Test
    fun `single question mode submits only current question`() {
        val policy = practiceSubmissionUiPolicy(PracticeQuestionSubmitMode.SingleQuestion)

        assertEquals(false, policy.showsBatchNavigation)
        assertEquals(false, policy.showsPaperBatchControls)
        assertEquals(false, policy.showsStandaloneSelfReviewPanel)
        assertEquals(true, policy.showsFooterSelfReviewTrigger)
        assertEquals(false, policy.showsInlineSingleSubmit)
        assertEquals(false, policy.showsQuestionJumpStrip)
        assertEquals("提交本题", policy.submitLabel)
    }

    @Test
    fun `single question submit placement follows web by question type`() {
        assertEquals(
            PracticeSingleQuestionSubmitPlacement.ChoicePrompt,
            practiceSingleQuestionSubmitPlacement(isChoiceQuestion = true),
        )
        assertEquals(
            PracticeSingleQuestionSubmitPlacement.AnswerWorkspace,
            practiceSingleQuestionSubmitPlacement(isChoiceQuestion = false),
        )
    }

    @Test
    fun `single question mode keeps a tablet header submit for choice retry questions`() {
        val policy = practiceQuestionPresentationPolicy(PracticeQuestionPresentationMode.Standard)

        assertEquals(
            false,
            practiceHeaderSubmitVisible(
                policy = policy,
                submitMode = PracticeQuestionSubmitMode.SingleQuestion,
                isChoiceQuestion = false,
            ),
        )
        assertEquals(
            true,
            practiceHeaderSubmitVisible(
                policy = policy,
                submitMode = PracticeQuestionSubmitMode.SingleQuestion,
                isChoiceQuestion = true,
            ),
        )
        assertEquals(
            true,
            practiceHeaderSubmitVisible(
                policy = policy,
                submitMode = PracticeQuestionSubmitMode.Batch,
                isChoiceQuestion = false,
            ),
        )
    }

    @Test
    fun `self review inline panel is compact and collapsible`() {
        val policy = practiceSelfReviewInlineLayoutPolicy()

        assertEquals(true, policy.showCollapseAction)
        assertEquals(true, policy.maxHeightDp <= 360)
    }

    @Test
    fun `regular practice keeps batch submit mode`() {
        val policy = practiceSubmissionUiPolicy(PracticeQuestionSubmitMode.Batch)

        assertEquals(true, policy.showsBatchNavigation)
        assertEquals(true, policy.showsPaperBatchControls)
        assertEquals(false, policy.showsDraftSaveAction)
        assertEquals(false, policy.submitButtonUsesFinalPhotoBatch)
        assertEquals(false, policy.showsStandaloneSelfReviewPanel)
        assertEquals(true, policy.showsFooterSelfReviewTrigger)
        assertEquals(false, policy.showsInlineSingleSubmit)
        assertEquals(true, policy.showsQuestionJumpStrip)
        assertEquals("", policy.submitLabel)
    }

    @Test
    fun `unit diagnostic saves drafts automatically and allows deferred self review`() {
        val policy = practiceSubmissionUiPolicy(PracticeQuestionSubmitMode.FinalPhotoBatch)

        assertEquals(true, policy.showsBatchNavigation)
        assertEquals(true, policy.showsPaperBatchControls)
        assertEquals(false, policy.showsDraftSaveAction)
        assertEquals(true, policy.showsFooterSelfReviewTrigger)
        assertEquals(false, policy.showsStandaloneSelfReviewPanel)
        assertEquals(true, policy.submitButtonUsesFinalPhotoBatch)
        assertEquals("提交批改", policy.submitLabel)
        assertEquals(
            true,
            practiceHeaderSubmitVisible(
                policy = practiceQuestionPresentationPolicy(PracticeQuestionPresentationMode.UnitDiagnostic),
                submitMode = PracticeQuestionSubmitMode.FinalPhotoBatch,
                isChoiceQuestion = true,
            ),
        )
    }


    @Test
    fun `draft canvas action label distinguishes saved batch draft from single-question grading`() {
        assertEquals(
            "保存本题作答",
            practiceDraftCanvasActionLabel(PracticeQuestionSubmitMode.Batch),
        )
        assertEquals(
            "提交本题作答",
            practiceDraftCanvasActionLabel(PracticeQuestionSubmitMode.SingleQuestion),
        )
        assertEquals(
            "提交批改",
            practiceDraftCanvasActionLabel(PracticeQuestionSubmitMode.FinalPhotoBatch),
        )
    }

    @Test
    fun `batch assessment draft canvas saves current answer instead of submitting handwriting`() {
        assertEquals(
            PracticeDraftSubmitBehavior.SaveForSetGrading,
            practiceDraftSubmitBehavior(PracticeQuestionSubmitMode.Batch),
        )
        assertEquals(
            PracticeDraftSubmitBehavior.SubmitCurrentQuestion,
            practiceDraftSubmitBehavior(PracticeQuestionSubmitMode.SingleQuestion),
        )
        assertFalse(practiceDraftCanvasActionLabel(PracticeQuestionSubmitMode.Batch).contains("提交"))
    }

    @Test
    fun `self review action distinguishes deferred saving from immediate submission`() {
        assertEquals(
            PracticeSelfReviewSubmitBehavior.SaveForSetGrading,
            practiceSelfReviewSubmitBehavior(PracticeQuestionSubmitMode.Batch),
        )
        assertEquals(
            PracticeSelfReviewSubmitBehavior.SaveForSetGrading,
            practiceSelfReviewSubmitBehavior(PracticeQuestionSubmitMode.FinalPhotoBatch),
        )
        assertEquals(
            PracticeSelfReviewSubmitBehavior.SubmitCurrentQuestion,
            practiceSelfReviewSubmitBehavior(PracticeQuestionSubmitMode.SingleQuestion),
        )
        assertEquals("保存自评", practiceSelfReviewActionLabel(PracticeQuestionSubmitMode.Batch))
        assertEquals("保存自评", practiceSelfReviewActionLabel(PracticeQuestionSubmitMode.FinalPhotoBatch))
        assertEquals("提交自评", practiceSelfReviewActionLabel(PracticeQuestionSubmitMode.SingleQuestion))
    }

    @Test
    fun `self review action dispatches batch save and single question submit separately`() {
        val items = listOf(
            PracticeSelfReviewItem(label = "整题", status = "partial"),
        )
        var savedItems = emptyList<PracticeSelfReviewItem>()
        var submittedItems = emptyList<PracticeSelfReviewItem>()

        listOf(PracticeQuestionSubmitMode.Batch, PracticeQuestionSubmitMode.FinalPhotoBatch).forEach { mode ->
            savedItems = emptyList()
            dispatchPracticeSelfReviewAction(
                mode = mode,
                items = items,
                onSave = { savedItems = it },
                onSubmit = { submittedItems = it },
            )
            assertEquals(items, savedItems)
            assertEquals(emptyList<PracticeSelfReviewItem>(), submittedItems)
        }

        savedItems = emptyList()
        dispatchPracticeSelfReviewAction(
            mode = PracticeQuestionSubmitMode.SingleQuestion,
            items = items,
            onSave = { savedItems = it },
            onSubmit = { submittedItems = it },
        )

        assertEquals(emptyList<PracticeSelfReviewItem>(), savedItems)
        assertEquals(items, submittedItems)
    }

    @Test
    fun `tablet standard practice uses web aligned header and no bottom navigation`() {
        val policy = practiceQuestionPresentationPolicy(PracticeQuestionPresentationMode.Standard)

        assertEquals("header", policy.progressPlacement)
        assertEquals("question_pane", policy.questionNavPlacement)
        assertEquals(true, policy.showHeaderSubmit)
        assertEquals(false, policy.showBottomBatchNavigation)
    }

    @Test
    fun `header progress nav is hidden for one-question variant and visible for multi-question practice`() {
        val policy = practiceQuestionPresentationPolicy(PracticeQuestionPresentationMode.Standard)

        assertEquals(false, practiceQuestionJumpVisible(policy, total = 1))
        assertEquals(true, practiceQuestionJumpVisible(policy, total = 3))
    }

    @Test
    fun `batch practice offers self review without a single question submit action`() {
        val policy = practiceSubmissionUiPolicy(PracticeQuestionSubmitMode.Batch)

        assertEquals(false, policy.showsStandaloneSelfReviewPanel)
        assertEquals(true, policy.showsFooterSelfReviewTrigger)
        assertEquals(false, policy.showsInlineSingleSubmit)
        assertEquals(PracticeSelfReviewSubmitBehavior.SaveForSetGrading,
            practiceSelfReviewSubmitBehavior(PracticeQuestionSubmitMode.Batch))
    }

    @Test
    fun `unit diagnostic practice uses web aligned header and batch submission`() {
        val policy = practiceQuestionPresentationPolicy(PracticeQuestionPresentationMode.UnitDiagnostic)

        assertEquals("单元检测", policy.title)
        assertEquals("header", policy.progressPlacement)
        assertEquals("question_pane", policy.questionNavPlacement)
        assertEquals(true, policy.showHeaderSubmit)
        assertEquals(false, policy.showBottomBatchNavigation)
        assertEquals("提交批改", policy.submitLabel)
    }

    @Test
    fun `unit diagnostic tools mirror web print and paper batch actions`() {
        assertEquals(listOf("打印试题", "纸笔批改"), practiceDiagnosticToolLabels(showPaperBatch = false))
        assertEquals(listOf("打印试题", "收起纸笔批改"), practiceDiagnosticToolLabels(showPaperBatch = true))
        assertEquals(listOf("选择照片", "清空", "开始纸笔批改"), practicePaperBatchActionLabels(hasSelection = true))
        assertFalse(practicePaperBatchActionLabels(hasSelection = true).contains("打印试题"))
    }

    @Test
    fun `tablet practice header uses native compact back and floating tools`() {
        val policy = tabletPracticeHeaderPolicy()

        assertEquals("home-circle", policy.backControl)
        assertEquals("floating-menu", policy.toolsPresentation)
        assertEquals(true, policy.toolsOverlayDoesNotConsumeLayoutHeight)
        assertEquals(32, policy.actionHeightDp)
        assertEquals(104, policy.toolButtonWidthDp)
        assertEquals(132, policy.submitButtonWidthDp)
        assertEquals(false, policy.showsTools)
    }

    @Test
    fun `result page final action mirrors web submit after reviewing feedback`() {
        assertEquals(
            "下一题",
            practiceResultPrimaryActionLabel(isLastQuestion = false, reinforcementContext = null),
        )
        assertEquals(
            "查看检测结果",
            practiceResultPrimaryActionLabel(
                isLastQuestion = true,
                reinforcementContext = ReinforcementPracticeContext.ScopeDiagnostic(
                    scopeType = "chapter",
                    scopeId = "第二章",
                    scopeName = "第二章",
                ),
            ),
        )
        assertEquals(
            "查看复测结果",
            practiceResultPrimaryActionLabel(
                isLastQuestion = true,
                reinforcementContext = ReinforcementPracticeContext.Retest(
                    planId = "plan-1",
                    attemptId = "attempt-1",
                ),
            ),
        )
        assertEquals(
            "练习结果",
            practiceResultPrimaryActionLabel(
                isLastQuestion = true,
                reinforcementContext = null,
                sessionType = PracticeSessionTypes.Practice,
            ),
        )
        assertEquals(
            "评估结果",
            practiceResultPrimaryActionLabel(
                isLastQuestion = true,
                reinforcementContext = null,
                sessionType = PracticeSessionTypes.KpDiagnostic,
            ),
        )
        assertEquals(
            "返回练习总结",
            practiceResultPrimaryActionLabel(
                isLastQuestion = true,
                reinforcementContext = null,
                openedFromSummary = true,
            ),
        )
        assertEquals(
            "返回错题复盘页",
            practiceResultPrimaryActionLabel(
                isLastQuestion = true,
                reinforcementContext = null,
                sessionType = cn.openphysics.androidapp.domain.PracticeSessionTypes.ReviewRetry,
            ),
        )
    }

    @Test
    fun `diagnostic summary matches web result dialog contract`() {
        val review = PracticeReview(
            items = listOf(
                PracticeReviewItem(resultQuestion("q1"), "A", result(correct = false)),
                PracticeReviewItem(resultQuestion("q2"), "B", result(correct = true)),
                PracticeReviewItem(resultQuestion("q3"), "C", result(correct = false)),
            ),
            diagnosticFeedback = DiagnosticFeedback(
                title = "重力",
                feedback = "建议先系统学习「重力」的核心概念和公式，再进行练习。",
                recommendation = "study",
                correctCount = 1,
                totalCount = 3,
                masteryBefore = 0.53,
                masteryAfter = 0.21,
            ),
        )

        val model = buildPracticeSummaryDialogModel(
            kpName = "重力",
            practice = PracticeSession(
                objective = "掌握评估",
                questions = review.items.map { it.question },
                sessionType = PracticeSessionTypes.KpDiagnostic,
            ),
            review = review,
        )

        assertEquals("评估结果", model.title)
        assertEquals("重力：正确 1/3", model.scoreText)
        assertEquals("建议先学习", model.label)
        assertEquals("掌握度：53% → 21%", model.meta)
        assertEquals("去同步学习", model.primaryLabel)
        assertEquals(PracticeSummaryAction.Learn, model.primaryAction)
        assertEquals(PracticeSummaryTone.Study, model.tone)
    }

    @Test
    fun `practice summary uses partial credit and one next action like web`() {
        val questions = listOf(resultQuestion("q1"), resultQuestion("q2"))
        val review = PracticeReview(
            items = listOf(
                PracticeReviewItem(
                    questions[0],
                    "过程作答",
                    result(correct = false).copy(
                        processGrading = ProcessGrading(
                            feedback = "",
                            firstError = "",
                            nextAction = "",
                            answerImagePaths = emptyList(),
                            confidenceLevel = "high",
                            needsHumanReview = false,
                            processScore = 60,
                        ),
                    ),
                ),
                PracticeReviewItem(questions[1], "A", result(correct = true)),
            ),
        )

        val model = buildPracticeSummaryDialogModel(
            kpName = "重力",
            practice = PracticeSession(
                objective = "巩固小练",
                questions = questions,
                sessionType = PracticeSessionTypes.Practice,
            ),
            review = review,
        )

        assertEquals("练习结果", model.title)
        assertEquals("重力：得分 1.6/2", model.scoreText)
        assertEquals("本轮已经暴露出需要修复的位置，先把错因闭环。", model.label)
        assertEquals("得分率 80%。先复盘错题和第一处错误，再进入下一轮训练。", model.feedback)
        assertEquals("继续巩固", model.primaryLabel)
        assertEquals(PracticeSummaryAction.Practice, model.primaryAction)
        assertEquals(PracticeSummaryTone.Neutral, model.tone)
    }

    @Test
    fun `teacher homework summary returns home and offers no restart`() {
        val question = resultQuestion("q1")
        val model = buildPracticeSummaryDialogModel(
            kpName = "作业",
            practice = PracticeSession(objective = "老师作业", questions = listOf(question)),
            review = PracticeReview(items = listOf(PracticeReviewItem(question, "A", result(correct = true)))),
            learningCatalogContext = cn.openphysics.androidapp.ui.LearningCatalogPracticeContext(
                catalogCode = "teacher_homework", nodeId = "attempt-1", topicTitle = "第一章个性化作业",
                layer = cn.openphysics.androidapp.domain.LearningCatalogTopicLayer.Paper, homeworkAttemptId = "attempt-1",
            ),
        )

        assertEquals("作业批改结果", model.title)
        assertEquals("第一章个性化作业：得分 100/100", model.scoreText)
        assertEquals("返回首页", model.primaryLabel)
        assertNull(model.secondaryLabel)
    }

    @Test
    fun `teacher homework summary shows the server score out of 100`() {
        val question = resultQuestion("q1")
        val model = buildPracticeSummaryDialogModel(
            kpName = "作业",
            practice = PracticeSession(
                objective = "老师作业", questions = listOf(question),
                teacherPaper = cn.openphysics.androidapp.domain.TeacherPaper(
                    id = "homework:a1", title = "第一章个性化作业", questionCount = 1, status = "completed",
                    score = cn.openphysics.androidapp.domain.HomeworkScore(10.0, 12.0, 83, released = true),
                ),
            ),
            review = PracticeReview(items = listOf(PracticeReviewItem(question, "A", result(correct = true)))),
            learningCatalogContext = cn.openphysics.androidapp.ui.LearningCatalogPracticeContext(
                catalogCode = "teacher_homework", nodeId = "attempt-1", topicTitle = "第一章个性化作业",
                layer = cn.openphysics.androidapp.domain.LearningCatalogTopicLayer.Paper, homeworkAttemptId = "attempt-1",
            ),
        )

        assertEquals("第一章个性化作业：得分 83/100", model.scoreText)
        assertEquals("老师已审核。老师会看到你的作答和批改结果。", model.feedback)
        assertEquals("先看错题解析，把错因弄清楚。", model.label)
    }

    @Test
    fun `all correct practice summary returns to synchronous learning`() {
        val question = resultQuestion("q1")
        val model = buildPracticeSummaryDialogModel(
            kpName = "重力",
            practice = PracticeSession(
                objective = "巩固小练",
                questions = listOf(question),
                sessionType = PracticeSessionTypes.Practice,
            ),
            review = PracticeReview(
                items = listOf(PracticeReviewItem(question, "A", result(correct = true))),
            ),
        )

        assertEquals("回到同步学习", model.primaryLabel)
        assertEquals(PracticeSummaryAction.Learn, model.primaryAction)
    }

    @Test
    fun `completed batch result navigation exposes every graded question and correctness`() {
        val questions = listOf(
            resultQuestion("q1"),
            resultQuestion("q2"),
            resultQuestion("q3"),
        )
        val review = PracticeReview(
            items = listOf(
                PracticeReviewItem(questions[0], "A", result(correct = true)),
                PracticeReviewItem(questions[1], "B", result(correct = false)),
                PracticeReviewItem(questions[2], "C", result(correct = true)),
            ),
        )

        assertEquals(
            listOf(
                PracticeResultNavigationState(available = true, correct = true),
                PracticeResultNavigationState(available = true, correct = false),
                PracticeResultNavigationState(available = true, correct = true),
            ),
            practiceResultNavigationStates(questions, review),
        )
    }


    @Test
    fun `result navigation keeps correctness color when current question is wrong`() {
        assertEquals(
            PracticeResultNavigationTone.Wrong,
            practiceResultNavigationTone(
                state = PracticeResultNavigationState(available = true, correct = false),
            ),
        )
        assertEquals(
            true,
            practiceResultNavigationVisualState(
                state = PracticeResultNavigationState(available = true, correct = false),
                active = true,
            ).showsCurrentOutline,
        )
    }

    @Test
    fun `practice result uses floating tutor over the H5 surface`() {
        val policy = practiceResultTutorAssistantPolicy()

        assertEquals(true, policy.floatsOverContent)
        assertEquals(true, policy.triggerOpensDialog)
        assertEquals(true, policy.triggerPlacement.initialYOffsetPx < 0)
    }

    @Test
    fun `manual grading correction follows web availability contract`() {
        val processGrading = ProcessGrading(
            feedback = "",
            firstError = "",
            nextAction = "",
            answerImagePaths = emptyList(),
            confidenceLevel = "high",
            needsHumanReview = false,
        )

        assertEquals(
            true,
            practiceResultCanCorrectGrading(result(correct = false).copy(processGrading = processGrading)),
        )
        assertEquals(false, practiceResultCanCorrectGrading(result(correct = false)))
        assertEquals(
            false,
            practiceResultCanCorrectGrading(
                result(correct = false).copy(answerId = null, processGrading = processGrading),
            ),
        )
    }



    @Test
    fun `self review items follow web question part labels`() {
        val items = buildPracticeSelfReviewItems(
            cn.openphysics.androidapp.domain.PracticeQuestion(
                id = "q_parts",
                stem = "(1) 求速度。(2) 求加速度。",
                questionType = "experiment",
                options = emptyList(),
                images = emptyList(),
                correctAnswer = "(1)0.40 (2)0.80 (3)偏小",
                explanation = "解析",
            ),
        )

        assertEquals(listOf("(1)", "(2)", "(3)"), items.map { it.label })
    }

    @Test
    fun `self review falls back to whole question when no parts exist`() {
        val items = buildPracticeSelfReviewItems(
            cn.openphysics.androidapp.domain.PracticeQuestion(
                id = "q_whole",
                stem = "说明物理意义。",
                questionType = "problem_solving",
                options = emptyList(),
                images = emptyList(),
            ),
        )

        assertEquals(listOf("整题"), items.map { it.label })
    }

    @Test
    fun `self review submit follows web completion rule`() {
        val incomplete = listOf(
            cn.openphysics.androidapp.domain.PracticeSelfReviewItem(label = "(1)", status = "correct"),
            cn.openphysics.androidapp.domain.PracticeSelfReviewItem(label = "(2)", status = ""),
        )
        val complete = incomplete.map { item ->
            if (item.label == "(2)") item.copy(status = "wrong") else item
        }

        assertEquals(false, practiceSelfReviewComplete(incomplete))
        assertEquals(true, practiceSelfReviewComplete(complete))
    }

    @Test
    fun `self review only opens for web aligned written question types`() {
        val choice = cn.openphysics.androidapp.domain.PracticeQuestion(
            id = "q_choice",
            stem = "选出正确答案。",
            questionType = "single_choice",
            options = listOf(cn.openphysics.androidapp.domain.PracticeOption("A", "正确")),
            images = emptyList(),
        )
        val problem = choice.copy(
            id = "q_problem",
            questionType = "problem_solving",
            options = emptyList(),
        )
        val experimentFill = choice.copy(
            id = "q_fill",
            stem = "实验：填出读数。",
            questionType = "fill_in_blank",
            options = emptyList(),
        )

        assertEquals(false, canPracticeSelfReviewQuestion(choice))
        assertEquals(true, canPracticeSelfReviewQuestion(problem))
        assertEquals(true, canPracticeSelfReviewQuestion(experimentFill))
    }

    @Test
    fun `all fill blank questions can use self review like web`() {
        val fillBlank = cn.openphysics.androidapp.domain.PracticeQuestion(
            id = "q_fill_regular",
            stem = "速度为____ m/s。",
            questionType = "fill_in_blank",
            options = emptyList(),
            images = emptyList(),
        )
        val knowledgeFillBlank = fillBlank.copy(
            id = "q_knowledge_fill",
            questionType = "knowledge_fill_in_blank",
        )

        assertEquals(true, canPracticeSelfReviewQuestion(fillBlank))
        assertEquals(true, canPracticeSelfReviewQuestion(knowledgeFillBlank))
    }

    @Test
    fun `self review covers every non-choice written question type like web`() {
        val writtenBase = cn.openphysics.androidapp.domain.PracticeQuestion(
            id = "q_written",
            stem = "写出解答过程。",
            questionType = "problem_solving",
            options = emptyList(),
            images = emptyList(),
        )
        val choice = writtenBase.copy(
            id = "q_choice_by_type",
            questionType = "single_choice",
        )
        val typedChoice = writtenBase.copy(
            id = "q_choice_with_options",
            questionType = "single_choice",
            options = listOf(cn.openphysics.androidapp.domain.PracticeOption("A", "选项")),
        )

        listOf(
            "experimental",
            "calculation",
            "short_answer",
            "fill_blank",
            "backend_new_type",
        ).forEach { questionType ->
            assertEquals(
                true,
                canPracticeSelfReviewQuestion(writtenBase.copy(questionType = questionType)),
            )
        }
        assertEquals(false, canPracticeSelfReviewQuestion(choice))
        assertEquals(false, canPracticeSelfReviewQuestion(typedChoice))
    }

    @Test
    fun `paper batch selection message warns when extra images are ignored`() {
        assertEquals(
            "已选择 6 张，最多上传 6 张",
            practicePaperBatchSelectionMessage(selectedCount = 6, originalCount = 6),
        )
        assertEquals(
            "已选择前 6 张，已忽略多选的 2 张，最多上传 6 张",
            practicePaperBatchSelectionMessage(selectedCount = 6, originalCount = 8),
        )
    }

    private fun resultQuestion(id: String) = PracticeQuestion(
        id = id,
        stem = "题干 $id",
        questionType = "single_choice",
        options = listOf(PracticeOption("A", "选项 A")),
        images = emptyList(),
    )

    private fun result(correct: Boolean) = SubmitResult(
        answerId = 1,
        correct = correct,
        correctAnswer = "A",
        explanation = "解析",
        aiFeedback = "",
    )
}
