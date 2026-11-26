package cn.openphysics.androidapp.ui.screens

import cn.openphysics.androidapp.domain.PracticeOption
import cn.openphysics.androidapp.domain.PracticeQuestion
import cn.openphysics.androidapp.domain.ProcessGrading
import cn.openphysics.androidapp.domain.QuestionImage
import cn.openphysics.androidapp.domain.RenderedRichContent
import cn.openphysics.androidapp.domain.MasteryUpdateValue
import cn.openphysics.androidapp.domain.SubmitResult
import cn.openphysics.androidapp.ui.PracticeSetSubmissionState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QuestionPaneWebViewTest {
    @Test
    fun writtenAnswerIsPassedIntactWithoutPretendingItsCharactersAreOptions() {
        val answer = "(1)0.26；0.34；(2)0.16；(3)偏大，不变"
        val question = PracticeQuestion("q-experiment", "实验题", "experiment", emptyList(), emptyList())
        val payload = buildQuestionPanePayload(question, 0, 1, answer, readOnly = true)

        assertEquals(answer, payload.getString("givenAnswer"))
        assertEquals(0, payload.getJSONArray("selectedOptions").length())
    }

    @Test
    fun questionHeightBridgeTracksLongShortAndLateGrowingContent() {
        val heights = mutableListOf<Int>()
        val bridge = QuestionPaneBridge(onOptionSelectedCallback = {}, onHeightChanged = heights::add)
        bridge.onHeightChanged("""{"height":1536}""")
        bridge.onHeightChanged("""{"height":280}""")
        bridge.onHeightChanged("""{"height":1900}""")
        assertEquals(listOf(1536, 280, 1900), heights)
    }

    @Test
    fun malformedQuestionHeightIsIgnored() {
        val heights = mutableListOf<Int>()
        val bridge = QuestionPaneBridge(onOptionSelectedCallback = {}, onHeightChanged = heights::add)
        bridge.onHeightChanged("invalid json")
        assertTrue(heights.isEmpty())
    }

    @Test
    fun questionPaneUrlUsesBackendPublishedLearningContentPane() {
        assertEquals(
            "https://openphysics.example/panes/learning-content/",
            questionPaneUrl("https://openphysics.example/api/student"),
        )
        assertEquals(
            "http://10.0.2.2:8000/panes/learning-content/",
            questionPaneUrl("http://10.0.2.2:8000/api/student"),
        )
        assertEquals(
            "http://10.0.2.2:5173/panes/learning-content/",
            questionPaneUrl("http://10.0.2.2:5173/api/student"),
        )
    }

    @Test
    fun questionPaneInjectionScriptRetriesUntilPaneApiIsReady() {
        val script = buildQuestionPaneInjectionScript("""{"question":{"id":"q1"}}""")

        assertTrue(script.contains("attempt > 30"))
        assertTrue(script.contains("setTimeout(function() { injectQuestionPanePayload(attempt + 1); }, 80);"))
        assertTrue(script.contains("window.OpenPhysicsPane.setPayload"))
        assertTrue(script.contains("OpenPhysicsBridge.onPaneError"))
    }

    @Test
    fun paneWebViewDisposalRemovesBridgesAndDestroysTheView() {
        assertEquals(
            listOf(
                PaneWebViewDisposalAction.RemovePrimaryBridge,
                PaneWebViewDisposalAction.RemoveLegacyBridge,
                PaneWebViewDisposalAction.StopLoading,
                PaneWebViewDisposalAction.LoadBlankPage,
                PaneWebViewDisposalAction.ClearHistory,
                PaneWebViewDisposalAction.DetachFromParent,
                PaneWebViewDisposalAction.Destroy,
            ),
            paneWebViewDisposalActions(),
        )
    }

    @Test
    fun buildQuestionPanePayloadIncludesQuestionOptionsImagesAndSelectedAnswer() {
        val question = PracticeQuestion(
            id = "q-pane-1",
            stem = "纸带速度实验",
            questionType = "single_choice",
            options = listOf(
                PracticeOption(label = "A", text = "先接通电源"),
                PracticeOption(label = "B", text = "先释放纸带"),
            ),
            images = listOf(
                QuestionImage(
                    id = 7,
                    imagePath = "/static/questions/q.png",
                    imageUrl = "https://openphysics.example/static/questions/q.png",
                    imageType = "stem",
                    description = "题图",
                ),
            ),
        )

        val json = buildQuestionPanePayload(
            question = question,
            index = 1,
            total = 3,
            answer = "A",
        )

        assertEquals("q-pane-1", json.getJSONObject("question").getString("id"))
        assertEquals("纸带速度实验", json.getJSONObject("question").getString("stem_text"))
        assertEquals("A", json.getJSONArray("selectedOptions").getString(0))
        assertEquals("question_interactive", json.getString("mode"))
        assertEquals(2, json.getJSONObject("question").getJSONArray("options").length())
        assertEquals(
            "https://openphysics.example/static/questions/q.png",
            json.getJSONObject("question").getJSONArray("images").getJSONObject(0).getString("image_path"),
        )
        assertEquals(1, json.getInt("index"))
        assertEquals(3, json.getInt("total"))
    }

    @Test
    fun buildQuestionPanePayloadKeepsOnlyPromptImagesLikeStudentWeb() {
        val question = PracticeQuestion(
            id = "q-pane-images",
            stem = "如图所示，下列说法正确的是（ ）",
            questionType = "single_choice",
            options = listOf(
                PracticeOption(label = "A", text = "选项 A {{IMG:2}}"),
                PracticeOption(label = "B", text = "选项 B"),
            ),
            images = listOf(
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
            ),
        )

        val images = buildQuestionPanePayload(
            question = question,
            index = 0,
            total = 1,
            answer = "",
        ).getJSONObject("question").getJSONArray("images")

        assertEquals(1, images.length())
        assertEquals("https://openphysics.example/static/questions/stem.png", images.getJSONObject(0).getString("image_path"))
    }

    @Test
    fun buildQuestionPanePayloadCanMarkQuestionAsReadOnly() {
        val question = PracticeQuestion(
            id = "q-pane-readonly",
            stem = "错题复盘题干",
            questionType = "single_choice",
            options = listOf(
                PracticeOption(label = "A", text = "正确"),
                PracticeOption(label = "B", text = "错误"),
            ),
            images = emptyList(),
        )

        val json = buildQuestionPanePayload(
            question = question,
            index = 0,
            total = 1,
            answer = "B",
            readOnly = true,
        )

        assertEquals("question_readonly", json.getString("mode"))
        assertEquals("B", json.getJSONArray("selectedOptions").getString(0))
    }

    @Test
    fun buildQuestionPanePayloadCanHideSolutionForNativeResultShells() {
        val question = PracticeQuestion(
            id = "q-pane-result",
            stem = "结果页只展示题目本体",
            questionType = "single_choice",
            options = listOf(PracticeOption(label = "A", text = "正确")),
            images = emptyList(),
            correctAnswer = "A",
            explanation = "解析",
        )

        val json = buildQuestionPanePayload(
            question = question,
            index = 0,
            total = 1,
            answer = "A",
            readOnly = true,
            includeSolution = false,
        )

        val questionJson = json.getJSONObject("question")
        assertEquals(false, json.getBoolean("showAnswerSummary"))
        assertEquals("", questionJson.getString("correct_answer"))
        assertEquals("", questionJson.getString("explanation"))
    }

    @Test
    fun buildQuestionPanePayloadUsesFullH5PracticeResultContract() {
        val question = PracticeQuestion(
            id = "q-full-result",
            stem = "含公式的结果题",
            questionType = "problem_solving",
            options = emptyList(),
            images = emptyList(),
            correctAnswer = "v=at",
            explanation = "由 \$v=at\$ 得结果",
        )
        val result = SubmitResult(
            answerId = 42,
            correct = false,
            correctAnswer = "v=at",
            explanation = "由 \$v=at\$ 得结果",
            aiFeedback = "先确定加速度方向",
            extractedAnswer = "v=-at",
            detectedMisconceptionName = "速度与加速度方向混淆",
            masteryUpdate = mapOf(
                "kp-motion" to MasteryUpdateValue(
                    before = 0.42,
                    after = 0.51,
                    name = "匀变速直线运动",
                ),
            ),
            aiFeedbackRendered = RenderedRichContent(html = "<span>先确定 <b>方向</b></span>"),
            processGrading = ProcessGrading(
                feedback = "过程需要修正",
                firstError = "符号错误",
                nextAction = "重新规定正方向",
                answerImagePaths = listOf("https://example.com/answer.jpg"),
                confidenceLevel = "high",
                needsHumanReview = false,
                processScore = 50,
            ),
        )

        val json = buildQuestionPanePayload(
            question = question,
            index = 1,
            total = 3,
            answer = "[手写作答]",
            result = result,
            readOnly = true,
            resultPresentation = true,
            canCorrectGrading = true,
        )

        assertEquals("practice_result", json.getString("mode"))
        assertEquals("[手写作答]", json.getString("givenAnswer"))
        assertEquals(true, json.getBoolean("canCorrectGrading"))
        assertEquals("先确定加速度方向", json.getJSONObject("answerState").getString("aiFeedback"))
        assertEquals(
            "<span>先确定 <b>方向</b></span>",
            json.getJSONObject("answerState").getJSONObject("aiFeedbackRendered").getString("html"),
        )
        assertEquals(
            "速度与加速度方向混淆",
            json.getJSONObject("answerState")
                .getJSONObject("detectedMisconception")
                .getString("name"),
        )
        assertEquals(
            0.51,
            json.getJSONObject("answerState")
                .getJSONObject("masteryUpdate")
                .getJSONObject("kp-motion")
                .getDouble("after"),
            0.0,
        )
        val process = json.getJSONObject("answerState").getJSONObject("processGrading")
        assertEquals("符号错误", process.getString("first_error"))
        assertEquals(50, process.getInt("process_score"))
        assertEquals(
            "https://example.com/answer.jpg",
            process.getJSONArray("answer_image_paths").getString(0),
        )
    }

    @Test
    fun questionPaneBridgeForwardsManualGradingCorrection() {
        val corrections = mutableListOf<QuestionPaneGradingCorrection>()
        val bridge = QuestionPaneBridge(
            onOptionSelectedCallback = {},
            onCorrectGradingCallback = corrections::add,
        )

        bridge.onCorrectGrading(
            """{"questionId":"q1","correct":true,"correctedAnswer":"v=at"}""",
        )
        bridge.onCorrectGrading(
            """{"questionId":"q1","correct":false,"correctedAnswer":"v=-at"}""",
        )
        bridge.onCorrectGrading("{bad-json")

        assertEquals(
            listOf(
                QuestionPaneGradingCorrection("q1", "v=at", true),
                QuestionPaneGradingCorrection("q1", "v=-at", false),
            ),
            corrections,
        )
    }

    @Test
    fun buildQuestionPanePayloadIncludesNativeLearningState() {
        val question = PracticeQuestion(
            id = "q-learning-state",
            stem = "解答题",
            questionType = "problem_solving",
            options = emptyList(),
            images = emptyList(),
        )
        val state = buildQuestionPaneLearningState(
            isChoiceQuestion = false,
            answer = "[手写作答]",
            hasSavedPhoto = false,
            hasPendingPhoto = false,
            hasSelfReviewSelection = true,
            selfReviewComplete = false,
            canSelfReview = true,
            submissionState = PracticeSetSubmissionState(submitting = true, completed = 1, total = 3),
        )

        val json = buildQuestionPanePayload(
            question = question,
            index = 0,
            total = 3,
            answer = "[手写作答]",
            learningState = state,
        )
        val learningState = json.getJSONObject("learningState")

        assertEquals("submitting", learningState.getString("submissionStatus"))
        assertEquals(1, learningState.getInt("completed"))
        assertEquals(3, learningState.getInt("total"))
        assertEquals("in_progress", learningState.getString("selfReviewStatus"))
        assertEquals("handwriting", learningState.getJSONArray("draftKinds").getString(0))
    }

    @Test
    fun questionPaneLearningStatePrefersSubmissionErrorOverIdleDraftState() {
        val state = buildQuestionPaneLearningState(
            isChoiceQuestion = false,
            answer = "[图片作答]",
            hasSavedPhoto = true,
            hasPendingPhoto = false,
            hasSelfReviewSelection = false,
            selfReviewComplete = false,
            canSelfReview = true,
            submissionState = PracticeSetSubmissionState(error = "批改失败，请稍后重试"),
        )

        assertEquals("failed", state.submissionStatus)
        assertEquals("批改失败，请稍后重试", state.message)
        assertEquals(listOf("photo"), state.draftKinds)
        assertEquals("not_started", state.selfReviewStatus)
    }

    @Test
    fun selfReviewQuestionsDoNotExposeLearningStateCardToQuestionPane() {
        val state = QuestionPaneLearningState(
            answerKind = "blank",
            draftKinds = emptyList(),
            selfReviewStatus = "not_started",
            submissionStatus = "idle",
        )

        assertEquals(null, questionPaneVisibleLearningState(canSelfReview = true, learningState = state))
        assertEquals(state, questionPaneVisibleLearningState(canSelfReview = false, learningState = state))
    }

    @Test
    fun bridgePayloadParserAcceptsSelectedAnswerAndRejectsInvalidJson() {
        val selected = parseQuestionPaneSelection(
            """{"questionId":"q1","selectedOptions":["B"],"answer":"B"}""",
        )
        assertEquals("B", selected.getOrNull()?.answer)

        val multiSelected = parseQuestionPaneSelection(
            """{"questionId":"q1","selectedOptions":["D","A"],"answer":"DA"}""",
        )
        assertEquals("AD", multiSelected.getOrNull()?.answer)

        assertTrue(parseQuestionPaneSelection("{bad-json").isFailure)
    }

    @Test
    fun bridgePayloadParserKeepsQuestionIdWithSelection() {
        val selected = parseQuestionPaneSelection(
            """{"questionId":"q42","selectedOptions":["C"],"answer":"C"}""",
        ).getOrThrow()

        assertEquals("q42", selected.questionId)
        assertEquals("C", selected.answer)
    }

    @Test
    fun bridgeSyncsEmptySelectionAndIgnoresMalformedPayload() {
        val selections = mutableListOf<QuestionPaneSelection>()
        val bridge = QuestionPaneBridge(onOptionSelectedCallback = selections::add)

        bridge.onOptionSelected("""{"questionId":"q1","selectedOptions":[]}""")
        bridge.onOptionSelected("{bad-json")

        assertEquals(1, selections.size)
        assertEquals("q1", selections[0].questionId)
        assertEquals("", selections[0].answer)
    }

    @Test
    fun bridgeDoesNotTreatAnswerChangedAsAChoiceSelection() {
        val selections = mutableListOf<QuestionPaneSelection>()
        val bridge = QuestionPaneBridge(onOptionSelectedCallback = selections::add)

        bridge.onAnswerChanged("""{"questionId":"q1","selectedOptions":["A"],"answer":"A"}""")

        assertTrue(selections.isEmpty())
    }

    @Test
    fun bridgeUsesPaneReadyForInjectionAndDoesNotTreatQuestionReadyAsReady() {
        var readyCount = 0
        val bridge = QuestionPaneBridge(onOptionSelectedCallback = {}, onReady = { readyCount++ })

        bridge.onQuestionReady("""{"questionId":"q1"}""")
        bridge.onQuestionPaneReady("""{"ready":true}""")

        assertEquals(1, readyCount)
    }

    @Test
    fun bridgeNamesExposeCrossPlatformAliasAndLegacyAndroidAlias() {
        assertEquals("OpenPhysicsBridge", QUESTION_PANE_BRIDGE_NAME)
        assertEquals("OpenPhysicsAndroidQuestionPane", LEGACY_ANDROID_QUESTION_PANE_BRIDGE_NAME)
    }


    @Test
    fun questionPaneLocksWebViewZoomToAvoidOversizedQuestionContent() {
        val policy = questionPaneWebViewSettingsPolicy()

        assertEquals(100, policy.textZoomPercent)
        assertFalse(policy.supportZoom)
        assertFalse(policy.builtInZoomControls)
        assertFalse(policy.displayZoomControls)
        assertTrue(policy.useWideViewPort)
        assertFalse(policy.loadWithOverviewMode)
    }
}
