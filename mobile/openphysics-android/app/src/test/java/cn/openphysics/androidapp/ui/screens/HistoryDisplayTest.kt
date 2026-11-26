package cn.openphysics.androidapp.ui.screens

import cn.openphysics.androidapp.domain.AnswerHistoryRecord
import cn.openphysics.androidapp.domain.PracticeOption
import cn.openphysics.androidapp.domain.PracticeQuestion
import cn.openphysics.androidapp.domain.ProcessGrading
import cn.openphysics.androidapp.domain.QuestionImage
import cn.openphysics.androidapp.domain.RenderedRichContent
import cn.openphysics.androidapp.domain.ReviewData
import cn.openphysics.androidapp.domain.ReviewGroup
import cn.openphysics.androidapp.domain.ReviewMistake
import org.junit.Assert.assertEquals
import org.junit.Test

class HistoryDisplayTest {
    @Test
    fun writtenHistoryPreservesAnswerImageAndFullGradingAcrossThePaneBridge() {
        val path = "https://openphysics.example/api/student/answer-images/test/answer.jpg?expires=2000000000&signature=test"
        val answer = "(1)0.26；0.34；(2)0.16；(3)偏大，不变"
        val record = historyRecord(id = 99, correct = true).copy(
            questionType = "experiment",
            givenAnswer = answer,
            answerImages = listOf(QuestionImage(0, path, path, "answer", "手写原图")),
            processGrading = ProcessGrading(
                feedback = "作答正确", firstError = "", nextAction = "继续巩固",
                answerImagePaths = listOf(path), confidenceLevel = "high", needsHumanReview = false,
                feedbackRendered = RenderedRichContent(html = "<p>作答正确</p>"),
            ),
        )
        val payload = buildHistoryRecordsPanePayload(listOf(record)).getJSONArray("records").getJSONObject(0)
        assertEquals(answer, payload.getString("given_answer"))
        assertEquals(path, payload.getJSONArray("answer_images").getJSONObject(0).getString("image_path"))
        val grading = payload.getJSONObject("process_grading")
        assertEquals(path, grading.getJSONArray("answer_image_paths").getString(0))
        assertEquals("作答正确", grading.getString("feedback"))
        assertEquals("<p>作答正确</p>", grading.getJSONObject("feedback_rendered").getString("html"))
    }

    @Test
    fun videoBridgeRequiresExactAnswerAndQuestionAndUnlockedMetadata() {
        val lesson = cn.openphysics.androidapp.domain.QuestionLessonVideo("video-1", "讲解", 90, true)
        val eligible = historyRecord(id = 1, correct = true, questionId = "q1").copy(lessonVideo = lesson)
        val locked = historyRecord(id = 2, correct = false, questionId = "q2").copy(lessonVideo = lesson.copy(available = false))
        val opened = mutableListOf<Int>()
        val bridge = LearningContentPaneBridge(records = { listOf(eligible, locked) }, onOpenLessonVideo = { opened += it.id })
        bridge.onOpenLessonVideo("""{"answerId":1,"questionId":"q2"}""")
        bridge.onOpenLessonVideo("""{"answerId":2,"questionId":"q2"}""")
        bridge.onOpenLessonVideo("""{"answerId":3,"questionId":"q1"}""")
        assertEquals(emptyList<Int>(), opened)
        bridge.onOpenLessonVideo("""{"answerId":1,"questionId":"q1"}""")
        assertEquals(listOf(1), opened)
        val json = buildHistoryRecordsPanePayload(listOf(eligible)).getJSONArray("records").getJSONObject(0).getJSONObject("lesson_video")
        assertEquals(true, json.getBoolean("available"))
        assertEquals(false, json.has("video_url"))
    }

    @Test
    fun tabletHistoryDetailMirrorsWebHistoryRecordWithoutTutorActions() {
        val policy = historyDetailTabletWebLayoutPolicy()

        assertEquals("练习记录", policy.headerTitle)
        assertEquals(true, policy.usesSingleRecordCard)
        assertEquals(listOf("题目", "我的答案", "正确答案", "解析"), policy.sections)
        assertEquals(emptyList<String>(), policy.sideActions)
        assertEquals(false, policy.showsTutorPanel)
        assertEquals("去错题复盘", policy.wrongRecordPrimaryAction)
        assertEquals(false, policy.primaryActionFillsWidth)
    }



    @Test
    fun findsMatchingReviewMistakeByAnswerIdBeforeQuestionId() {
        val record = historyRecord(id = 7, correct = false, questionId = "shared-question")
        val sameQuestionWrongAnswer = reviewMistake(answerId = 3, questionId = "shared-question")
        val exactAnswer = reviewMistake(answerId = 7, questionId = "other-question")
        val review = reviewData(listOf(sameQuestionWrongAnswer, exactAnswer))

        assertEquals(exactAnswer, matchingReviewMistakeForHistory(record, review))
    }

    @Test
    fun fallsBackToQuestionIdWhenAnswerIdIsMissingFromReview() {
        val record = historyRecord(id = 7, correct = false, questionId = "q-target")
        val target = reviewMistake(answerId = 3, questionId = "q-target")
        val review = reviewData(listOf(reviewMistake(answerId = 1, questionId = "q-other"), target))

        assertEquals(target, matchingReviewMistakeForHistory(record, review))
    }

    @Test
    fun filtersHistoryRecordsLikeStudentWebHistoryTabs() {
        val correct = historyRecord(id = 1, correct = true)
        val wrong = historyRecord(id = 2, correct = false)
        val records = listOf(correct, wrong)

        assertEquals(listOf(correct, wrong), filterHistoryRecords(records, HistoryResultFilter.All))
        assertEquals(listOf(correct), filterHistoryRecords(records, HistoryResultFilter.Correct))
        assertEquals(listOf(wrong), filterHistoryRecords(records, HistoryResultFilter.Wrong))
    }

    @Test
    fun buildsHistoryFilterOptionsWithCounts() {
        val records = listOf(
            historyRecord(id = 1, correct = true),
            historyRecord(id = 2, correct = true),
            historyRecord(id = 3, correct = false),
        )

        val options = historyFilterOptions(records)

        assertEquals(listOf("全部", "做对", "做错"), options.map { it.label })
        assertEquals(listOf(3, 2, 1), options.map { it.count })
    }

    @Test
    fun learningContentPaneUrlUsesBackendPublishedRoute() {
        assertEquals(
            "https://openphysics.example/panes/learning-content/",
            learningContentPaneUrl("https://openphysics.example/api/student"),
        )
        assertEquals(
            "http://10.0.2.2:8000/panes/learning-content/",
            learningContentPaneUrl("http://10.0.2.2:8000/api/student"),
        )
    }

    @Test
    fun learningContentPaneInjectionUsesSetPayloadWithRetry() {
        val script = buildLearningContentPaneInjectionScript("""{"mode":"history_records"}""")

        assertEquals(true, script.contains("attempt > 30"))
        assertEquals(true, script.contains("window.OpenPhysicsPane.setPayload"))
        assertEquals(true, script.contains("OpenPhysicsBridge.onPaneError"))
        assertEquals(false, script.contains("onPayloadRendered"))
    }

    @Test
    fun learningContentPaneBridgeWaitsForInjectedPayloadToRender() {
        var payloadRendered = false
        val bridge = LearningContentPaneBridge(
            records = { emptyList() },
            onPayloadRendered = { payloadRendered = true },
        )

        bridge.onPayloadRendered("""{"pane":"learning-content","mode":"review_notebook"}""")

        assertEquals(true, payloadRendered)
    }

    @Test
    fun learningContentPaneRecoveryClearsStudentShellServiceWorkerAndReloadsPaneOnce() {
        val script = buildLearningContentPaneRecoveryScript("https://openphysics.example/panes/learning-content/")

        assertEquals(true, script.contains("window.OpenPhysicsPane && window.OpenPhysicsPane.setPayload"))
        assertEquals(true, script.contains("waitForPaneApi(0)"))
        assertEquals(true, script.contains("setTimeout(function() { waitForPaneApi(attempt + 1); }, 100);"))
        assertEquals(true, script.contains("navigator.serviceWorker.getRegistrations"))
        assertEquals(true, script.contains("shouldUnregisterRegistration(registration)"))
        assertEquals(true, script.contains("registration.unregister()"))
        assertEquals(true, script.contains("window.caches.keys"))
        assertEquals(true, script.contains("shouldDeleteCacheKey(key)"))
        assertEquals(false, script.contains("keys.map(function(key)"))
        assertEquals(true, script.contains("op_pane_recovered=1"))
        assertEquals(true, script.contains("https://openphysics.example/panes/learning-content/"))
        assertEquals(true, script.contains("OpenPhysicsBridge.onPaneError"))
    }

    @Test
    fun buildsHistoryRecordsPayloadForLearningContentPane() {
        val record = AnswerHistoryRecord(
            id = 7,
            questionId = "q-history",
            stemText = "关于速度和速率，下列说法正确的是（ ）",
            stemRendered = RenderedRichContent(html = "<p>渲染题干</p>"),
            questionType = "single_choice",
            options = listOf(
                PracticeOption(
                    label = "A",
                    text = "速率是标量，速度是矢量",
                    rendered = RenderedRichContent(html = "<span>选项A</span>"),
                ),
            ),
            images = listOf(
                QuestionImage(
                    id = 3,
                    imagePath = "/static/questions/q.png",
                    imageUrl = "https://openphysics.example/static/questions/q.png",
                    imageType = "stem",
                    description = "题图",
                ),
            ),
            kpNames = listOf("速度与速率"),
            givenAnswer = "B",
            isCorrect = false,
            correctAnswer = "A",
            explanation = "速率只有大小，速度有方向。",
            explanationRendered = RenderedRichContent(html = "<p>渲染解析</p>"),
            createdAt = "2026-07-03T12:07:00",
            processGrading = ProcessGrading(
                feedback = "建议老师确认",
                firstError = "",
                nextAction = "",
                answerImagePaths = emptyList(),
                confidenceLevel = "low",
                needsHumanReview = true,
            ),
        )

        val payload = buildHistoryRecordsPanePayload(listOf(record))
        val first = payload.getJSONArray("records").getJSONObject(0)

        assertEquals("history_records", payload.getString("mode"))
        assertEquals(7, first.getInt("id"))
        assertEquals("q-history", first.getString("question_id"))
        assertEquals("B", first.getString("given_answer"))
        assertEquals(false, first.getBoolean("is_correct"))
        assertEquals("<p>渲染题干</p>", first.getJSONObject("stem_rendered").getString("html"))
        assertEquals("<span>选项A</span>", first.getJSONArray("options").getJSONObject(0).getJSONObject("rendered").getString("html"))
        assertEquals(
            "速度与速率",
            first.getJSONArray("knowledge_points").getJSONObject(0).getString("name"),
        )
        assertEquals(true, first.getJSONObject("process_grading").getBoolean("needs_human_review"))
        assertEquals(
            "https://openphysics.example/static/questions/q.png",
            first.getJSONArray("images").getJSONObject(0).getString("image_path"),
        )
    }

    @Test
    fun learningContentPanePayloadFiltersNonPromptImagesAcrossRecordsAndReviewDetails() {
        val record = historyRecord(id = 9, correct = false).copy(
            stemText = "如图所示，下列说法正确的是（ ）",
            images = mixedQuestionImages(),
        )
        val mistake = reviewMistake(answerId = 41, questionId = "q-review-detail").copy(
            stemText = "如图所示，下列说法正确的是（ ）",
            images = mixedQuestionImages(),
        )

        val recordImages = buildHistoryRecordsPanePayload(listOf(record))
            .getJSONArray("records")
            .getJSONObject(0)
            .getJSONArray("images")
        val mistakeImages = buildReviewMistakeDetailPanePayload(mistake)
            .getJSONObject("mistake")
            .getJSONArray("images")

        assertEquals(1, recordImages.length())
        assertEquals("https://openphysics.example/static/questions/stem.png", recordImages.getJSONObject(0).getString("image_path"))
        assertEquals(1, mistakeImages.length())
        assertEquals("https://openphysics.example/static/questions/stem.png", mistakeImages.getJSONObject(0).getString("image_path"))
    }

    @Test
    fun buildsReviewNotebookPayloadForLearningContentPane() {
        val selected = reviewMistake(answerId = 31, questionId = "q-selected").copy(
            stemText = "物体受力满足 \$f=\\mu N\$，下列说法正确的是（ ）",
            questionType = "single_choice",
            misconceptionName = "受力分析",
            processGrading = ProcessGrading(
                feedback = "建议确认",
                firstError = "",
                nextAction = "",
                answerImagePaths = emptyList(),
                confidenceLevel = "low",
                needsHumanReview = true,
            ),
        )
        val review = ReviewData(
            groups = listOf(
                ReviewGroup(
                    kpId = "kp-friction",
                    kpName = "静摩擦力",
                    wrongCount = 1,
                    mistakes = listOf(selected),
                ),
            ),
            reviewedCount = 0,
            totalCount = 1,
        )

        val payload = buildReviewNotebookPanePayload(
            review = review,
            maxMistakesPerGroup = 5,
        )
        val group = payload.getJSONArray("groups").getJSONObject(0)
        val mistake = group.getJSONArray("mistakes").getJSONObject(0)

        assertEquals("review_notebook", payload.getString("mode"))
        assertEquals(5, payload.getInt("maxMistakesPerGroup"))
        assertEquals(8, payload.getInt("reviewGroupBatchSize"))
        assertEquals(false, payload.has("selectedAnswerIds"))
        assertEquals("静摩擦力", group.getString("kp_name"))
        assertEquals(31, mistake.getInt("answer_id"))
        assertEquals("q-selected", mistake.getString("question_id"))
        assertEquals("受力分析", mistake.getString("misconception_name"))
        assertEquals(false, mistake.has("stem_rendered"))
        assertEquals(true, mistake.getJSONObject("process_grading").getBoolean("needs_human_review"))
    }

    @Test
    fun parsesLearningContentPaneHeightFromBridgePayload() {
        assertEquals(640, parseLearningContentPaneHeight("""{"height":640}""").getOrNull())
        assertEquals(1, parseLearningContentPaneHeight("""{"height":0}""").getOrNull())
        assertEquals(true, parseLearningContentPaneHeight("{bad-json").isFailure)
    }

    @Test
    fun learningContentPaneWebViewHeightDoesNotCapLongExpandedContent() {
        assertEquals(220, learningContentPaneWebViewHeightDp(120))
        assertEquals(3600, learningContentPaneWebViewHeightDp(3600))
    }

    @Test
    fun learningContentPaneStaysHiddenUntilReadyAndRevealGateOpens() {
        assertEquals(false, learningContentPaneShouldReveal(payloadRendered = false, revealGateOpen = false, loadError = null))
        assertEquals(false, learningContentPaneShouldReveal(payloadRendered = true, revealGateOpen = false, loadError = null))
        assertEquals(false, learningContentPaneShouldReveal(payloadRendered = true, revealGateOpen = true, loadError = "内容面板加载失败"))
        assertEquals(true, learningContentPaneShouldReveal(payloadRendered = true, revealGateOpen = true, loadError = null))
    }

    @Test
    fun reviewNotebookRecreatesRendererOnceBeforeShowingRetry() {
        assertEquals(
            LearningContentPaneRendererRecovery.Recreate,
            learningContentPaneRendererRecovery(consecutiveFailures = 0),
        )
        assertEquals(
            LearningContentPaneRendererRecovery.ShowRetry,
            learningContentPaneRendererRecovery(consecutiveFailures = 1),
        )
    }


    @Test
    fun reviewDetailQuestionPaneUsesDynamicLearningContentPaneHeight() {
        val policy = reviewDetailQuestionPanePolicy()

        assertEquals(true, policy.usesLearningContentPane)
        assertEquals(true, policy.usesDynamicHeight)
        assertEquals(180, policy.minimumHeightDp)
    }


    @Test
    fun buildsReviewMistakeDetailPayloadForLearningContentPane() {
        val mistake = reviewMistake(answerId = 41, questionId = "q-review-detail").copy(
            stemText = "纸带实验下列说法正确的是（ ）",
            stemRendered = RenderedRichContent(html = "<p>纸带实验</p>"),
            questionType = "single_choice",
            options = listOf(
                PracticeOption(
                    label = "B",
                    text = "先接通电源，再释放小车",
                    rendered = RenderedRichContent(html = "<span>先接通电源</span>"),
                ),
            ),
            images = listOf(
                QuestionImage(
                    id = 9,
                    imagePath = "/static/questions/ticker.png",
                    imageUrl = "https://openphysics.example/static/questions/ticker.png",
                    imageType = "stem",
                    description = "题图",
                ),
            ),
            givenAnswer = "A",
            correctAnswer = "B",
            correctAnswerRendered = RenderedRichContent(html = "<p>B</p>"),
            explanation = "应先接通电源，再释放小车。",
            explanationRendered = RenderedRichContent(html = "<p>解析</p>"),
            misconceptionName = "实验顺序",
            processGrading = ProcessGrading(
                feedback = "注意实验操作先后。",
                firstError = "忽略了打点计时器需要先稳定工作。",
                nextAction = "先判断实验操作顺序。",
                answerImagePaths = emptyList(),
                confidenceLevel = "medium",
                needsHumanReview = true,
                processScore = 62,
                modelCorrect = false,
                equationCorrect = true,
                calculationCorrect = null,
                unitCorrect = null,
                errorTypeName = "实验顺序",
                gradingBasis = "操作步骤判断错误。",
            ),
        )

        val payload = buildReviewMistakeDetailPanePayload(mistake)
        val mistakeJson = payload.getJSONObject("mistake")

        assertEquals("review_mistake_detail", payload.getString("mode"))
        assertEquals(41, mistakeJson.getInt("answer_id"))
        assertEquals("q-review-detail", mistakeJson.getString("question_id"))
        assertEquals("A", mistakeJson.getString("given_answer"))
        assertEquals("B", mistakeJson.getString("correct_answer"))
        assertEquals("<p>B</p>", mistakeJson.getJSONObject("correct_answer_rendered").getString("html"))
        assertEquals("<p>解析</p>", mistakeJson.getJSONObject("explanation_rendered").getString("html"))
        assertEquals("<p>纸带实验</p>", mistakeJson.getJSONObject("stem_rendered").getString("html"))
        assertEquals("<span>先接通电源</span>", mistakeJson.getJSONArray("options").getJSONObject(0).getJSONObject("rendered").getString("html"))
        assertEquals("https://openphysics.example/static/questions/ticker.png", mistakeJson.getJSONArray("images").getJSONObject(0).getString("image_path"))
        assertEquals("实验顺序", mistakeJson.getString("misconception_name"))
        assertEquals(true, mistakeJson.getJSONObject("process_grading").getBoolean("needs_human_review"))
        assertEquals(62, mistakeJson.getJSONObject("process_grading").getInt("process_score"))
        assertEquals("忽略了打点计时器需要先稳定工作。", mistakeJson.getJSONObject("process_grading").getString("first_error"))
    }

    @Test
    fun buildsSelfReviewSolutionPayloadForLearningContentPane() {
        val question = PracticeQuestion(
            id = "q-self-review-pane",
            stem = "这段题干不应由自评解析 pane 重复展示",
            questionType = "problem_solving",
            options = emptyList(),
            images = emptyList(),
            correctAnswer = "平均速度为 $5\\,\\mathrm{m/s}$",
            correctAnswerRendered = RenderedRichContent(html = "<p>渲染答案</p>"),
            explanation = "先求总路程，再除以总时间。",
            explanationRendered = RenderedRichContent(html = "<p>渲染解析</p>"),
        )

        val payload = buildSelfReviewSolutionPanePayload(question)
        val questionJson = payload.getJSONObject("question")

        assertEquals("self_review_solution", payload.getString("mode"))
        assertEquals("q-self-review-pane", questionJson.getString("id"))
        assertEquals("平均速度为 $5\\,\\mathrm{m/s}$", questionJson.getString("correct_answer"))
        assertEquals("<p>渲染答案</p>", questionJson.getJSONObject("correct_answer_rendered").getString("html"))
        assertEquals("先求总路程，再除以总时间。", questionJson.getString("explanation"))
        assertEquals("<p>渲染解析</p>", questionJson.getJSONObject("explanation_rendered").getString("html"))
        assertEquals(false, questionJson.has("stem_text"))
        assertEquals(false, payload.has("presentation"))

        val phonePayload = buildSelfReviewSolutionPanePayload(question, phonePresentation = true, textScale = 1.3f)
        assertEquals("phone", phonePayload.getString("presentation"))
        assertEquals(1.3, phonePayload.getDouble("textScale"), 0.001)
    }

    @Test
    fun findsHistoryRecordFromLearningContentPaneReviewPayloadByAnswerId() {
        val first = historyRecord(id = 7, correct = false, questionId = "shared-question")
        val second = historyRecord(id = 8, correct = false, questionId = "shared-question")

        assertEquals(
            second,
            historyRecordForLearningContentPaneReviewPayload(
                payload = """{"answerId":8,"questionId":"shared-question"}""",
                records = listOf(first, second),
            ).getOrNull(),
        )
    }

    private fun historyRecord(id: Int, correct: Boolean, questionId: String = "q-$id"): AnswerHistoryRecord {
        return AnswerHistoryRecord(
            id = id,
            questionId = questionId,
            stemText = "题干 $id",
            questionType = "single_choice",
            options = emptyList(),
            images = emptyList(),
            kpNames = listOf("时刻与时间间隔"),
            givenAnswer = if (correct) "A" else "B",
            isCorrect = correct,
            correctAnswer = "A",
            explanation = "解析",
            createdAt = "2026-07-03T12:07:00",
        )
    }

    private fun reviewMistake(answerId: Int, questionId: String): ReviewMistake {
        return ReviewMistake(
            answerId = answerId,
            questionId = questionId,
            stemText = "错题 $answerId",
            questionType = "single_choice",
            options = emptyList(),
            images = emptyList(),
            givenAnswer = "B",
            correctAnswer = "A",
            explanation = "解析",
            misconceptionName = "概念混淆",
            createdAt = "2026-07-03T12:07:00",
        )
    }

    private fun reviewData(mistakes: List<ReviewMistake>): ReviewData {
        return ReviewData(
            groups = listOf(
                ReviewGroup(
                    kpId = "kp",
                    kpName = "速度",
                    wrongCount = mistakes.size,
                    mistakes = mistakes,
                ),
            ),
            reviewedCount = 0,
            totalCount = mistakes.size,
        )
    }

    private fun mixedQuestionImages(): List<QuestionImage> {
        return listOf(
            QuestionImage(
                id = 1,
                imagePath = "/static/questions/stem.png",
                imageUrl = "https://openphysics.example/static/questions/stem.png",
                imageType = "stem",
                description = "题图",
            ),
            QuestionImage(
                id = 2,
                imagePath = "/static/questions/explanation.png",
                imageUrl = "https://openphysics.example/static/questions/explanation.png",
                imageType = "explanation",
                description = "解析图",
            ),
            QuestionImage(
                id = 3,
                imagePath = "/static/questions/option.png",
                imageUrl = "https://openphysics.example/static/questions/option.png",
                imageType = "option",
                description = "选项图",
            ),
        )
    }
}
