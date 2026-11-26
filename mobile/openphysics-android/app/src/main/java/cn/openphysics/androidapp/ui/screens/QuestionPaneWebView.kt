package cn.openphysics.androidapp.ui.screens

import android.annotation.SuppressLint
import android.graphics.Color
import android.net.Uri
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.unit.dp
import cn.openphysics.androidapp.BuildConfig
import cn.openphysics.androidapp.data.api.processGradingToTutorJson
import cn.openphysics.androidapp.domain.PracticeQuestion
import cn.openphysics.androidapp.domain.RenderedRichContent
import cn.openphysics.androidapp.domain.RenderedRichContentError
import cn.openphysics.androidapp.domain.SubmitResult
import cn.openphysics.androidapp.ui.PracticeSetSubmissionState
import cn.openphysics.androidapp.ui.design.OpenPhysicsColors
import cn.openphysics.androidapp.ui.design.OpenPhysicsRadius
import org.json.JSONArray
import org.json.JSONObject

internal const val QUESTION_PANE_BRIDGE_NAME = "OpenPhysicsBridge"
internal const val LEGACY_ANDROID_QUESTION_PANE_BRIDGE_NAME = "OpenPhysicsAndroidQuestionPane"

internal enum class PaneWebViewDisposalAction {
    RemovePrimaryBridge,
    RemoveLegacyBridge,
    StopLoading,
    LoadBlankPage,
    ClearHistory,
    DetachFromParent,
    Destroy,
}

internal fun paneWebViewDisposalActions(): List<PaneWebViewDisposalAction> = listOf(
    PaneWebViewDisposalAction.RemovePrimaryBridge,
    PaneWebViewDisposalAction.RemoveLegacyBridge,
    PaneWebViewDisposalAction.StopLoading,
    PaneWebViewDisposalAction.LoadBlankPage,
    PaneWebViewDisposalAction.ClearHistory,
    PaneWebViewDisposalAction.DetachFromParent,
    PaneWebViewDisposalAction.Destroy,
)

internal fun disposeOpenPhysicsPaneWebView(webView: WebView?) {
    if (webView == null) return
    paneWebViewDisposalActions().forEach { action ->
        runCatching {
            when (action) {
                PaneWebViewDisposalAction.RemovePrimaryBridge ->
                    webView.removeJavascriptInterface(QUESTION_PANE_BRIDGE_NAME)
                PaneWebViewDisposalAction.RemoveLegacyBridge ->
                    webView.removeJavascriptInterface(LEGACY_ANDROID_QUESTION_PANE_BRIDGE_NAME)
                PaneWebViewDisposalAction.StopLoading -> webView.stopLoading()
                PaneWebViewDisposalAction.LoadBlankPage -> webView.loadUrl("about:blank")
                PaneWebViewDisposalAction.ClearHistory -> webView.clearHistory()
                PaneWebViewDisposalAction.DetachFromParent -> (webView.parent as? ViewGroup)?.removeView(webView)
                PaneWebViewDisposalAction.Destroy -> webView.destroy()
            }
        }
    }
}

internal fun questionPaneUrl(apiBaseUrl: String = BuildConfig.API_BASE_URL): String {
    return learningContentPaneUrl(apiBaseUrl)
}

internal fun buildQuestionPaneInjectionScript(payload: String): String {
    val escapedPayload = JSONObject.quote(payload)
    return """
        (function() {
          function reportQuestionPaneError(message) {
            var payload = JSON.stringify({ message: message });
            if (window.OpenPhysicsBridge && window.OpenPhysicsBridge.onPaneError) {
              window.OpenPhysicsBridge.onPaneError(payload);
              return;
            }
            if (window.OpenPhysicsBridge && window.OpenPhysicsBridge.onQuestionError) {
              window.OpenPhysicsBridge.onQuestionError(payload);
              return;
            }
            if (window.OpenPhysicsAndroidQuestionPane && window.OpenPhysicsAndroidQuestionPane.onPaneError) {
              window.OpenPhysicsAndroidQuestionPane.onPaneError(payload);
              return;
            }
            if (window.OpenPhysicsAndroidQuestionPane && window.OpenPhysicsAndroidQuestionPane.onQuestionError) {
              window.OpenPhysicsAndroidQuestionPane.onQuestionError(payload);
            }
          }
          function injectQuestionPanePayload(attempt) {
            if (window.OpenPhysicsPane && window.OpenPhysicsPane.setPayload) {
              window.OpenPhysicsPane.setPayload($escapedPayload);
              return;
            }
            if (attempt > 30) {
              reportQuestionPaneError('题目面板未就绪，请重新加载');
              return;
            }
            setTimeout(function() { injectQuestionPanePayload(attempt + 1); }, 80);
          }
          injectQuestionPanePayload(0);
        })();
    """.trimIndent()
}

internal data class QuestionPaneSelection(
    val questionId: String,
    val answer: String,
)

internal data class QuestionPaneLearningState(
    val answerKind: String,
    val draftKinds: List<String>,
    val selfReviewStatus: String,
    val submissionStatus: String,
    val completed: Int = 0,
    val total: Int = 0,
    val message: String = "",
)

internal fun buildQuestionPaneLearningState(
    isChoiceQuestion: Boolean,
    answer: String,
    hasSavedPhoto: Boolean,
    hasPendingPhoto: Boolean,
    hasSelfReviewSelection: Boolean,
    selfReviewComplete: Boolean,
    canSelfReview: Boolean,
    submissionState: PracticeSetSubmissionState,
): QuestionPaneLearningState {
    val normalizedAnswer = answer.trim()
    val draftKinds = mutableListOf<String>()
    val answerKind = when {
        isChoiceQuestion && normalizedAnswer.isNotBlank() -> {
            draftKinds += "choice"
            "choice"
        }
        normalizedAnswer == "[手写作答]" -> {
            draftKinds += "handwriting"
            "handwriting"
        }
        normalizedAnswer == "[图片作答]" || hasSavedPhoto -> {
            draftKinds += "photo"
            "photo"
        }
        normalizedAnswer == "[自评作答]" -> {
            draftKinds += "self_review"
            "self_review"
        }
        normalizedAnswer.isNotBlank() -> {
            draftKinds += "text"
            "text"
        }
        else -> "blank"
    }
    if (hasPendingPhoto && "pending_photo" !in draftKinds) {
        draftKinds += "pending_photo"
    }
    val selfReviewStatus = when {
        !canSelfReview -> "not_available"
        selfReviewComplete -> "complete"
        hasSelfReviewSelection -> "in_progress"
        else -> "not_started"
    }
    val submissionStatus = when {
        submissionState.submitting -> "submitting"
        submissionState.error.isNotBlank() -> "failed"
        else -> "idle"
    }
    return QuestionPaneLearningState(
        answerKind = answerKind,
        draftKinds = draftKinds.distinct(),
        selfReviewStatus = selfReviewStatus,
        submissionStatus = submissionStatus,
        completed = submissionState.completed,
        total = submissionState.total,
        message = submissionState.error,
    )
}

internal fun questionPaneVisibleLearningState(
    canSelfReview: Boolean,
    learningState: QuestionPaneLearningState,
): QuestionPaneLearningState? = learningState.takeUnless { canSelfReview }

private fun QuestionPaneLearningState.toJson(): JSONObject {
    return JSONObject()
        .put("answerKind", answerKind)
        .put(
            "draftKinds",
            JSONArray().also { array -> draftKinds.forEach(array::put) },
        )
        .put("selfReviewStatus", selfReviewStatus)
        .put("submissionStatus", submissionStatus)
        .put("completed", completed)
        .put("total", total)
        .put("message", message)
}

internal fun parseQuestionPaneSelection(payload: String): Result<QuestionPaneSelection> {
    return runCatching {
        val json = JSONObject(payload)
        val selected = json.optJSONArray("selectedOptions")
        val labels = if (selected != null) {
            (0 until selected.length()).mapNotNull { selected.optString(it).takeIf(String::isNotBlank) }
        } else {
            json.optString("answer")
                .replace(Regex("[,，、\\s]"), "")
                .map { it.toString() }
        }
        val normalizedAnswer = labels
            .map { it.trim() }
            .filter { it.isNotBlank() }
            .distinct()
            .sorted()
            .joinToString("")
        QuestionPaneSelection(
            questionId = json.optString("questionId"),
            answer = normalizedAnswer,
        )
    }
}

internal data class QuestionPaneGradingCorrection(
    val questionId: String,
    val correctedAnswer: String,
    val correct: Boolean,
)

internal fun parseQuestionPaneGradingCorrection(payload: String): Result<QuestionPaneGradingCorrection> {
    return runCatching {
        val json = JSONObject(payload)
        QuestionPaneGradingCorrection(
            questionId = json.optString("questionId"),
            correctedAnswer = json.optString("correctedAnswer").trim(),
            correct = json.getBoolean("correct"),
        )
    }
}

internal fun dispatchQuestionPaneSelection(
    selection: QuestionPaneSelection,
    activeQuestionId: () -> String,
    onAnswerChange: (String, String) -> Unit,
) {
    val targetQuestionId = selection.questionId.ifBlank(activeQuestionId)
    onAnswerChange(targetQuestionId, selection.answer)
}

internal data class QuestionPaneWebViewSettingsPolicy(
    val textZoomPercent: Int,
    val supportZoom: Boolean,
    val builtInZoomControls: Boolean,
    val displayZoomControls: Boolean,
    val useWideViewPort: Boolean,
    val loadWithOverviewMode: Boolean,
)

internal fun questionPaneWebViewSettingsPolicy(): QuestionPaneWebViewSettingsPolicy {
    return QuestionPaneWebViewSettingsPolicy(
        textZoomPercent = 100,
        supportZoom = false,
        builtInZoomControls = false,
        displayZoomControls = false,
        useWideViewPort = true,
        loadWithOverviewMode = false,
    )
}

internal fun WebSettings.applyQuestionPaneWebViewSettingsPolicy(
    policy: QuestionPaneWebViewSettingsPolicy = questionPaneWebViewSettingsPolicy(),
) {
    textZoom = policy.textZoomPercent
    setSupportZoom(policy.supportZoom)
    builtInZoomControls = policy.builtInZoomControls
    displayZoomControls = policy.displayZoomControls
    useWideViewPort = policy.useWideViewPort
    loadWithOverviewMode = policy.loadWithOverviewMode
}

internal fun buildQuestionPanePayload(
    question: PracticeQuestion,
    index: Int,
    total: Int,
    answer: String,
    result: SubmitResult? = null,
    readOnly: Boolean = false,
    includeSolution: Boolean = true,
    learningState: QuestionPaneLearningState? = null,
    resultPresentation: Boolean = false,
    canCorrectGrading: Boolean = false,
    interactionLocked: Boolean = false,
    phonePresentation: Boolean = false,
    textScale: Float = 1f,
): JSONObject {
    val questionJson = JSONObject()
        .put("id", question.id)
        .put("stem_text", question.stem)
        .put("stem_rendered", question.stemRendered.toJsonOrNull())
        .put("question_type", question.questionType)
        .put("correct_answer", if (includeSolution) question.correctAnswer else "")
        .put("correct_answer_rendered", if (includeSolution) question.correctAnswerRendered.toJsonOrNull() else JSONObject.NULL)
        .put("explanation", if (includeSolution) question.explanation else "")
        .put("explanation_rendered", if (includeSolution) question.explanationRendered.toJsonOrNull() else JSONObject.NULL)
        .put(
            "options",
            JSONArray().also { options ->
                question.options.forEach { option ->
                    options.put(
                        JSONObject()
                            .put("label", option.label)
                            .put("text", option.text)
                            .put("rendered", option.rendered.toJsonOrNull())
                            .put("text_rendered", option.textRendered.toJsonOrNull()),
                    )
                }
            },
        )
        .put(
            "images",
            JSONArray().also { images ->
                promptQuestionImages(question.stem, question.options, question.images).forEach { image ->
                    val path = image.imageUrl.ifBlank { image.imagePath }
                    images.put(
                        JSONObject()
                            .put("id", image.id.toString())
                            .put("image_path", path)
                            .put("image_type", image.imageType.ifBlank { JSONObject.NULL })
                            .put("description", image.description.ifBlank { JSONObject.NULL }),
                    )
                }
            },
        )

    return JSONObject()
        .put("question", questionJson)
        .put("index", index)
        .put("total", total)
        .put(
            "mode",
            when {
                resultPresentation -> "practice_result"
                readOnly -> "question_readonly"
                else -> "question_interactive"
            },
        )
        .put("givenAnswer", answer)
        .put("canCorrectGrading", canCorrectGrading)
        .put("selectedOptions", JSONArray(if (question.isChoice()) answerToQuestionPaneLabels(answer) else emptyList<String>()))
        .put("answerState", result?.toQuestionPaneAnswerState() ?: JSONObject.NULL)
        .put("learningState", learningState?.toJson() ?: JSONObject.NULL)
        .put("interactionLocked", interactionLocked || learningState?.submissionStatus == "submitting")
        .put("showAnswerSummary", includeSolution)
        .also { if (phonePresentation) it.put("presentation", "phone").put("textScale", textScale.toDouble()) }
}

private fun answerToQuestionPaneLabels(answer: String): List<String> {
    return answer
        .replace(Regex("[,，、\\s]"), "")
        .map { it.toString() }
        .filter { it.isNotBlank() }
        .distinct()
        .sorted()
}

private fun SubmitResult.toQuestionPaneAnswerState(): JSONObject {
    return JSONObject()
        .put("submitted", true)
        .put("correct", correct)
        .put("correctAnswer", correctAnswer)
        .put("correctAnswerRendered", correctAnswerRendered.toJsonOrNull())
        .put("explanation", explanation)
        .put("explanation_rendered", explanationRendered.toJsonOrNull())
        .put("extractedAnswer", extractedAnswer)
        .put("extractedAnswerRendered", extractedAnswerRendered.toJsonOrNull())
        .put("aiFeedback", aiFeedback)
        .put("aiFeedbackRendered", aiFeedbackRendered.toJsonOrNull())
        .put(
            "detectedMisconception",
            detectedMisconceptionName
                .takeIf(String::isNotBlank)
                ?.let { JSONObject().put("name", it) }
                ?: JSONObject.NULL,
        )
        .put(
            "masteryUpdate",
            JSONObject().also { masteryJson ->
                masteryUpdate.forEach { (kpId, update) ->
                    masteryJson.put(
                        kpId,
                        JSONObject()
                            .put("before", update.before)
                            .put("after", update.after)
                            .put("name", update.name),
                    )
                }
            },
        )
        .put("processGrading", processGrading?.let(::processGradingToTutorJson) ?: JSONObject.NULL)
}

private fun RenderedRichContent?.toJsonOrNull(): Any {
    if (this == null) return JSONObject.NULL
    return JSONObject()
        .put("html", html)
        .put("plain_text", plainText)
        .put("renderer", renderer)
        .put("renderer_version", rendererVersion)
        .put("content_hash", contentHash)
        .put("has_math", hasMath)
        .put("has_image", hasImage)
        .put("has_markdown_table", hasMarkdownTable)
        .put(
            "errors",
            JSONArray().also { array ->
                errors.forEach { error -> array.put(error.toJson()) }
            },
        )
}

private fun RenderedRichContentError.toJson(): JSONObject {
    return JSONObject()
        .put("type", type)
        .put("message", message)
        .put("latex", latex)
        .put("position", position ?: JSONObject.NULL)
}

internal class QuestionPaneBridge(
    private val onOptionSelectedCallback: (QuestionPaneSelection) -> Unit,
    private val onCorrectGradingCallback: (QuestionPaneGradingCorrection) -> Unit = {},
    private val onReady: () -> Unit = {},
    private val onError: (String) -> Unit = {},
    private val onOpenImage: (String) -> Unit = {},
    private val onHeightChanged: (Int) -> Unit = {},
) {
    @JavascriptInterface
    fun onHeightChanged(payload: String) {
        parseLearningContentPaneHeight(payload).onSuccess(onHeightChanged)
    }

    @JavascriptInterface
    fun onQuestionReady(payload: String) {
        val ready = runCatching { JSONObject(payload).optBoolean("ready", false) }
            .getOrDefault(false)
        if (ready) onReady()
    }

    @JavascriptInterface
    fun onQuestionPaneReady(payload: String) {
        val ready = runCatching { JSONObject(payload).optBoolean("ready", true) }
            .getOrDefault(true)
        if (ready) onReady()
    }

    @JavascriptInterface
    fun onPaneReady(payload: String) {
        val ready = runCatching { JSONObject(payload).optBoolean("ready", true) }
            .getOrDefault(true)
        if (ready) onReady()
    }

    @JavascriptInterface
    fun onOptionSelected(payload: String) {
        parseQuestionPaneSelection(payload).onSuccess { selection ->
            onOptionSelectedCallback(selection)
        }
    }

    @JavascriptInterface
    fun onAnswerChanged(payload: String) = Unit

    @JavascriptInterface
    fun onCorrectGrading(payload: String) {
        parseQuestionPaneGradingCorrection(payload)
            .onSuccess(onCorrectGradingCallback)
    }

    @JavascriptInterface
    fun onOpenImage(payload: String) {
        runCatching {
            val json = JSONObject(payload)
            json.optString("src").ifBlank { json.optString("url") }
        }.getOrNull()?.takeIf { it.isNotBlank() }?.let(onOpenImage)
    }

    @JavascriptInterface
    fun onNeedLogin() = Unit

    @JavascriptInterface
    fun onQuestionError(payload: String) {
        onError(
            runCatching { JSONObject(payload).optString("message") }
                .getOrDefault("题目载入失败")
                .ifBlank { "题目载入失败" },
        )
    }

    @JavascriptInterface
    fun onPaneError(payload: String) {
        onQuestionError(payload)
    }
}

@Suppress("DEPRECATION")
@SuppressLint("SetJavaScriptEnabled")
@Composable
internal fun LeftQuestionWebView(
    question: PracticeQuestion,
    index: Int,
    total: Int,
    answer: String,
    onAnswerChange: (String, String) -> Unit,
    modifier: Modifier = Modifier,
    result: SubmitResult? = null,
    readOnly: Boolean = false,
    includeSolution: Boolean = true,
    learningState: QuestionPaneLearningState? = null,
    resultPresentation: Boolean = false,
    canCorrectGrading: Boolean = false,
    onCorrectGrading: (QuestionPaneGradingCorrection) -> Unit = {},
    interactionLocked: Boolean = false,
    expandToContent: Boolean = false,
    phonePresentation: Boolean = false,
) {
    val textScale = androidx.compose.ui.platform.LocalDensity.current.fontScale
    val url = remember { questionPaneUrl() }
    val currentQuestionId = rememberUpdatedState(question.id)
    val currentPhonePresentation = rememberUpdatedState(phonePresentation)
    // The WebView bridge survives question changes, so it must keep the same state holder.
    var previewImageUrl by remember { mutableStateOf<String?>(null) }
    val currentOnAnswerChange = rememberUpdatedState(onAnswerChange)
    val currentOnCorrectGrading = rememberUpdatedState(onCorrectGrading)
    val payload = remember(
        question.id,
        index,
        total,
        answer,
        result,
        readOnly,
        includeSolution,
        learningState,
        resultPresentation,
        canCorrectGrading,
        interactionLocked,
        phonePresentation,
        textScale,
    ) {
        buildQuestionPanePayload(
            question = question,
            index = index,
            total = total,
            answer = answer,
            result = result,
            readOnly = readOnly,
            includeSolution = includeSolution,
            learningState = learningState,
            resultPresentation = resultPresentation,
            canCorrectGrading = canCorrectGrading,
            interactionLocked = interactionLocked,
            phonePresentation = phonePresentation,
            textScale = textScale,
        ).toString()
    }
    val injectionScript = remember(payload) { buildQuestionPaneInjectionScript(payload) }
    val currentInjectionScript by rememberUpdatedState(injectionScript)
    var ready by remember { mutableStateOf(false) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var webViewRef by remember { mutableStateOf<WebView?>(null) }
    var canGoBack by remember { mutableStateOf(false) }
    // Keep the height bridge attached to one state across question/answer changes.
    var contentHeightDp by remember { mutableIntStateOf(360) }

    fun injectPayload(webView: WebView?) {
        if (webView == null) return
        webView.evaluateJavascript(currentInjectionScript, null)
    }

    LaunchedEffect(injectionScript, ready) {
        if (ready) injectPayload(webViewRef)
    }
    LaunchedEffect(question.id) {
        previewImageUrl = null
    }
    BackHandler(enabled = canGoBack) {
        webViewRef?.goBack()
        canGoBack = webViewRef?.canGoBack() == true
    }
    DisposableEffect(Unit) {
        onDispose {
            disposeOpenPhysicsPaneWebView(webViewRef)
            webViewRef = null
        }
    }

    previewImageUrl?.let { url -> PhoneQuestionImagePreview(url) { previewImageUrl = null } }
    Box(modifier = if (expandToContent) {
        modifier.fillMaxWidth().height(learningContentPaneWebViewHeightDp(contentHeightDp, if (phonePresentation) 80 else 360).dp)
    } else {
        modifier.fillMaxSize()
    }) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { context ->
                WebView(context).apply {
                    webViewRef = this
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    )
                    setBackgroundColor(Color.WHITE)
                    isVerticalScrollBarEnabled = true
                    isHorizontalScrollBarEnabled = false
                    overScrollMode = WebView.OVER_SCROLL_IF_CONTENT_SCROLLS
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = false
                    settings.cacheMode = if (BuildConfig.BUNDLED_PANE_PREVIEW) WebSettings.LOAD_NO_CACHE else WebSettings.LOAD_DEFAULT
                    settings.allowFileAccess = false
                    settings.allowContentAccess = false
                    settings.allowFileAccessFromFileURLs = false
                    settings.allowUniversalAccessFromFileURLs = false
                    settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                    settings.applyQuestionPaneWebViewSettingsPolicy()
                    setInitialScale(100)
                    val bridge = QuestionPaneBridge(
                        onOpenImage = { imageUrl ->
                            post {
                                if (currentPhonePresentation.value && Uri.parse(imageUrl).scheme in listOf("https", "http")) {
                                    previewImageUrl = imageUrl
                                }
                            }
                        },
                        onOptionSelectedCallback = { selection ->
                            post {
                                dispatchQuestionPaneSelection(
                                    selection = selection,
                                    activeQuestionId = { currentQuestionId.value },
                                    onAnswerChange = currentOnAnswerChange.value,
                                )
                            }
                        },
                        onReady = {
                            post {
                                ready = true
                                loadError = null
                                injectPayload(this)
                            }
                        },
                        onCorrectGradingCallback = { correction ->
                            post { currentOnCorrectGrading.value(correction) }
                        },
                        onError = { message -> post { loadError = message } },
                        onHeightChanged = { height -> post { contentHeightDp = height + 16 } },
                    )
                    addJavascriptInterface(bridge, QUESTION_PANE_BRIDGE_NAME)
                    addJavascriptInterface(bridge, LEGACY_ANDROID_QUESTION_PANE_BRIDGE_NAME)
                    webViewClient = object : PanePreviewWebViewClient(context) {
                        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                            val target = request.url
                            return !isAllowedQuestionPaneUrl(target, Uri.parse(url))
                        }

                        override fun onPageFinished(view: WebView, finishedUrl: String?) {
                            loadError = null
                            canGoBack = view.canGoBack()
                            recoverLearningContentPaneIfNeeded(view, url)
                            view.evaluateJavascript(PhonePaneChrome.script, null)
                        }

                        override fun onReceivedError(
                            view: WebView,
                            request: WebResourceRequest,
                            webError: WebResourceError,
                        ) {
                            if (request.isForMainFrame) {
                                this@apply.stopLoading()
                                ready = false
                                loadError = webError.description?.toString()
                                    ?.ifBlank { "题目面板加载失败" }
                                    ?: "题目面板加载失败"
                            }
                        }
                    }
                    loadUrl(url)
                }
            },
            update = { webView ->
                webViewRef = webView
                if (webView.url.isNullOrBlank()) {
                    webView.loadUrl(url)
                } else if (ready) {
                    injectPayload(webView)
                }
            },
        )

        if (!ready && loadError == null) {
            QuestionPaneLoadingOverlay()
        }
        loadError?.let { message ->
            QuestionPaneErrorOverlay(
                message = message,
                onRetry = {
                    loadError = null
                    ready = false
                    webViewRef?.loadUrl(url)
                },
            )
        }
    }
}

@Composable
internal fun ReadOnlyQuestionWebView(
    question: PracticeQuestion,
    answer: String,
    modifier: Modifier = Modifier,
    result: SubmitResult? = null,
    includeSolution: Boolean = true,
    resultPresentation: Boolean = false,
    canCorrectGrading: Boolean = false,
    onCorrectGrading: (QuestionPaneGradingCorrection) -> Unit = {},
) {
    LeftQuestionWebView(
        question = question,
        index = 0,
        total = 1,
        answer = answer,
        result = result,
        readOnly = true,
        includeSolution = includeSolution,
        resultPresentation = resultPresentation,
        canCorrectGrading = canCorrectGrading,
        onCorrectGrading = onCorrectGrading,
        onAnswerChange = { _, _ -> },
        modifier = modifier,
    )
}

private fun isAllowedQuestionPaneUrl(target: Uri, base: Uri): Boolean {
    return target.scheme == base.scheme && target.host == base.host
}

@Composable
private fun QuestionPaneLoadingOverlay() {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(OpenPhysicsColors.Surface),
        contentAlignment = Alignment.TopStart,
    ) {
        Text(
            text = "题目加载中...",
            modifier = Modifier.padding(18.dp),
            color = OpenPhysicsColors.Muted,
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}

@Composable
private fun QuestionPaneErrorOverlay(
    message: String,
    onRetry: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(OpenPhysicsColors.Surface)
            .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Large))
            .padding(18.dp),
    ) {
        Text(
            text = "题目面板加载失败",
            color = OpenPhysicsColors.Ink,
            style = MaterialTheme.typography.titleMedium,
        )
        Text(
            text = message,
            modifier = Modifier.padding(top = 8.dp),
            color = OpenPhysicsColors.Muted,
            style = MaterialTheme.typography.bodyMedium,
        )
        TextButton(onClick = onRetry, modifier = Modifier.padding(top = 8.dp)) {
            Text("重新加载", color = OpenPhysicsColors.PrimaryDeep)
        }
    }
}
