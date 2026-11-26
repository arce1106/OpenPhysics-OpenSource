package cn.openphysics.androidapp.ui.screens

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import android.annotation.SuppressLint
import android.graphics.Color
import android.net.Uri
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.net.toUri
import cn.openphysics.androidapp.BuildConfig
import cn.openphysics.androidapp.data.api.processGradingToTutorJson
import cn.openphysics.androidapp.domain.AnswerHistoryRecord
import cn.openphysics.androidapp.domain.CardSection
import cn.openphysics.androidapp.domain.KnowledgeCard
import cn.openphysics.androidapp.domain.PracticeOption
import cn.openphysics.androidapp.domain.PracticeQuestion
import cn.openphysics.androidapp.domain.ProcessGrading
import cn.openphysics.androidapp.domain.QuestionImage
import cn.openphysics.androidapp.domain.RenderedRichContent
import cn.openphysics.androidapp.domain.RenderedRichContentError
import cn.openphysics.androidapp.domain.ReviewData
import cn.openphysics.androidapp.domain.ReviewGroup
import cn.openphysics.androidapp.domain.ReviewMistake
import cn.openphysics.androidapp.ui.design.OpenPhysicsColors
import cn.openphysics.androidapp.ui.design.OpenPhysicsRadius
import kotlinx.coroutines.delay
import java.net.URI
import org.json.JSONArray
import org.json.JSONObject

private const val LEARNING_CONTENT_PANE_REVEAL_DELAY_MS = 90L

internal fun learningContentPaneUrl(apiBaseUrl: String = BuildConfig.API_BASE_URL): String {
    val origin = apiBaseUrl.substringBefore("/api/").trimEnd('/').ifBlank {
        "https://openphysics.example"
    }
    return "${learningContentPaneOrigin(origin)}/panes/learning-content/"
}

private fun learningContentPaneOrigin(origin: String): String {
    val uri = runCatching { URI(origin) }.getOrNull() ?: return origin
    val scheme = uri.scheme ?: return origin
    val host = uri.host ?: return origin
    val port = if (uri.port > 0) ":${uri.port}" else ""
    return "$scheme://$host$port"
}

internal fun buildLearningContentPaneInjectionScript(payload: String): String {
    val escapedPayload = JSONObject.quote(payload)
    return """
        (function() {
          function reportLearningContentPaneError(message) {
            var payload = JSON.stringify({ message: message });
            if (window.OpenPhysicsBridge && window.OpenPhysicsBridge.onPaneError) {
              window.OpenPhysicsBridge.onPaneError(payload);
              return;
            }
            if (window.OpenPhysicsAndroidQuestionPane && window.OpenPhysicsAndroidQuestionPane.onPaneError) {
              window.OpenPhysicsAndroidQuestionPane.onPaneError(payload);
            }
          }
          function injectLearningContentPanePayload(attempt) {
            if (window.OpenPhysicsPane && window.OpenPhysicsPane.setPayload) {
              window.OpenPhysicsPane.setPayload($escapedPayload);
              return;
            }
            if (attempt > 30) {
              reportLearningContentPaneError('内容面板未就绪，请重新加载');
              return;
            }
            setTimeout(function() { injectLearningContentPanePayload(attempt + 1); }, 80);
          }
          injectLearningContentPanePayload(0);
        })();
    """.trimIndent()
}

internal fun buildLearningContentPaneRecoveryScript(reloadUrl: String): String {
    val escapedReloadUrl = JSONObject.quote(reloadUrl)
    return """
        (function() {
          function reportPaneRecoveryError(message) {
            var payload = JSON.stringify({ message: message });
            if (window.OpenPhysicsBridge && window.OpenPhysicsBridge.onPaneError) {
              window.OpenPhysicsBridge.onPaneError(payload);
              return;
            }
            if (window.OpenPhysicsAndroidQuestionPane && window.OpenPhysicsAndroidQuestionPane.onPaneError) {
              window.OpenPhysicsAndroidQuestionPane.onPaneError(payload);
            }
          }
          function hasPaneApi() {
            return Boolean(window.OpenPhysicsPane && window.OpenPhysicsPane.setPayload);
          }
          function reloadPane() {
            var target = $escapedReloadUrl;
            var sep = target.indexOf('?') === -1 ? '?' : '&';
            window.location.replace(target + sep + 'op_pane_recovered=1&op_pane_ts=' + Date.now());
          }
          function paneOrigin() {
            try {
              return new URL($escapedReloadUrl, window.location.href).origin;
            } catch (e) {
              return window.location.origin;
            }
          }
          function shouldUnregisterRegistration(registration) {
            try {
              return new URL(registration.scope).origin === paneOrigin();
            } catch (e) {
              return false;
            }
          }
          function shouldDeleteCacheKey(key) {
            return /(?:learning-content|question-pane|openphysics-pane|workbox|vite)/i.test(key);
          }
          function recover() {
            if (hasPaneApi()) return;
            if (/[?&]op_pane_recovered=1(?:&|${'$'})/.test(window.location.search)) {
              reportPaneRecoveryError('内容面板未就绪，请重新加载');
              return;
            }
            var tasks = [];
            if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
              tasks.push(navigator.serviceWorker.getRegistrations().then(function(registrations) {
                return Promise.all(registrations.filter(function(registration) {
                  return shouldUnregisterRegistration(registration);
                }).map(function(registration) {
                  return registration.unregister();
                }));
              }));
            }
            if (window.caches && window.caches.keys) {
              tasks.push(window.caches.keys().then(function(keys) {
                return Promise.all(keys.filter(function(key) {
                  return shouldDeleteCacheKey(key);
                }).map(function(key) {
                  return window.caches.delete(key);
                }));
              }));
            }
            if (!tasks.length) {
              reloadPane();
              return;
            }
            Promise.all(tasks).then(reloadPane, reloadPane);
          }
          function waitForPaneApi(attempt) {
            if (hasPaneApi()) return;
            if (attempt < 30) {
              setTimeout(function() { waitForPaneApi(attempt + 1); }, 100);
              return;
            }
            recover();
          }
          waitForPaneApi(0);
        })();
    """.trimIndent()
}

private fun buildReviewNotebookPaneInjectionScript(payload: String): String {
    // Keep this typography local to the native tablet list and reapply it after reloads.
    return """
        (function() {
          var style = document.getElementById('openphysics-android-review-typography');
          if (!style) {
            style = document.createElement('style');
            style.id = 'openphysics-android-review-typography';
            (document.head || document.documentElement).appendChild(style);
          }
          // Printing was the only use of selecting mistakes, so the shared Pane's check circles are hidden here.
          // Its grid must lose that column too, or the question falls into the 42px check column.
          style.textContent = '.op-pane-review-notebook .op-pane-review-title { font-size: 0.86rem; font-weight: 400; }' +
            ' .op-pane-review-notebook .op-pane-review-check { display: none; }' +
            ' .op-pane-review-notebook .op-pane-review-row { grid-template-columns: minmax(0, 1fr) auto; }' +
            ' .op-pane-review-notebook .op-pane-review-time { grid-column: auto; }';
        })();
        ${buildLearningContentPaneInjectionScript(payload)}
    """.trimIndent()
}

internal fun recoverLearningContentPaneIfNeeded(webView: WebView, url: String) {
    webView.evaluateJavascript(buildLearningContentPaneRecoveryScript(url), null)
}

internal fun learningContentPaneShouldReveal(
    payloadRendered: Boolean,
    revealGateOpen: Boolean,
    loadError: String?,
): Boolean = payloadRendered && revealGateOpen && loadError == null

internal enum class LearningContentPaneRendererRecovery {
    Recreate,
    ShowRetry,
}

internal fun learningContentPaneRendererRecovery(
    consecutiveFailures: Int,
): LearningContentPaneRendererRecovery =
    if (consecutiveFailures == 0) {
        LearningContentPaneRendererRecovery.Recreate
    } else {
        LearningContentPaneRendererRecovery.ShowRetry
    }

@Composable
private fun rememberLearningContentPaneRevealGate(payloadRendered: Boolean): Boolean {
    var revealGateOpen by remember { mutableStateOf(false) }
    LaunchedEffect(payloadRendered) {
        if (!payloadRendered) {
            revealGateOpen = false
            return@LaunchedEffect
        }
        withFrameNanos { }
        delay(LEARNING_CONTENT_PANE_REVEAL_DELAY_MS)
        revealGateOpen = true
    }
    return revealGateOpen
}

internal fun buildHistoryRecordsPanePayload(records: List<AnswerHistoryRecord>): JSONObject {
    return JSONObject()
        .put("mode", "history_records")
        .put(
            "records",
            JSONArray().also { array ->
                records.forEach { record -> array.put(record.toLearningContentPaneJson()) }
            },
        )
}

internal fun buildReviewNotebookPanePayload(
    review: ReviewData,
    maxMistakesPerGroup: Int,
    reviewGroupBatchSize: Int = 8,
): JSONObject {
    return JSONObject()
        .put("mode", "review_notebook")
        .put("maxMistakesPerGroup", maxMistakesPerGroup)
        .put("reviewGroupBatchSize", reviewGroupBatchSize)
        .put(
            "groups",
            JSONArray().also { array ->
                review.groups.forEach { group -> array.put(group.toLearningContentPaneJson()) }
            },
        )
}

/**
 * Same host script as iOS's ReviewPaneView: marks 我的选择 (red when wrong) and 正确答案 on a
 * reviewed choice question, reusing the Pane's own result classes. Idempotent across re-renders.
 */
internal fun reviewMistakeChoiceResultScript(correctAnswer: String, givenAnswer: String): String {
    fun letters(value: String) = org.json.JSONArray(Regex("[A-Z]").findAll(value.uppercase()).map { it.value }.toList())
    return """
        (function() {
          var correct = ${letters(correctAnswer)};
          var given = ${letters(givenAnswer)};
          if (!correct.length) return;
          function mark() {
            document.querySelectorAll('.op-pane-review-detail .op-pane-option').forEach(function(option) {
              var labelElement = option.querySelector('.op-pane-option-label');
              if (!labelElement) return;
              var label = labelElement.textContent.trim().toUpperCase();
              var isCorrect = correct.indexOf(label) >= 0;
              var isGiven = given.indexOf(label) >= 0;
              option.classList.remove('selected');
              option.classList.toggle('is-correct', isCorrect);
              option.classList.toggle('is-given-correct', isGiven && isCorrect);
              option.classList.toggle('is-wrong', isGiven && !isCorrect);
              option.classList.toggle('is-dimmed', !isGiven && !isCorrect);
              if (option.querySelector('.op-pane-option-result-badges')) return;
              var badges = [];
              if (isGiven) badges.push(['我的选择', isCorrect ? 'is-yours-correct' : 'is-yours-wrong']);
              if (isCorrect) badges.push(['正确答案', 'is-correct-answer']);
              if (!badges.length) return;
              var wrap = document.createElement('span');
              wrap.className = 'op-pane-option-result-badges';
              badges.forEach(function(badge) {
                var item = document.createElement('span');
                item.className = 'op-pane-option-result-badge ' + badge[1];
                item.textContent = badge[0];
                wrap.appendChild(item);
              });
              option.appendChild(wrap);
            });
          }
          new MutationObserver(mark).observe(document.documentElement, { childList: true, subtree: true });
          mark();
        })();
    """.trimIndent()
}

internal fun buildReviewMistakeDetailPanePayload(mistake: ReviewMistake): JSONObject {
    return JSONObject()
        .put("mode", "review_mistake_detail")
        .put("mistake", mistake.toLearningContentPaneJson(includeDetail = true))
}

internal fun buildSelfReviewSolutionPanePayload(
    question: PracticeQuestion,
    phonePresentation: Boolean = false,
    textScale: Float = 1f,
): JSONObject {
    return JSONObject()
        .put("mode", "self_review_solution")
        .apply {
            if (phonePresentation) {
                put("presentation", "phone")
                put("textScale", textScale.toDouble())
            }
        }
        .put(
            "question",
            JSONObject()
                .put("id", question.id)
                .put("question_type", question.questionType)
                .put("correct_answer", question.correctAnswer)
                .put("correct_answer_rendered", question.correctAnswerRendered.toJsonOrNull())
                .put("explanation", question.explanation)
                .put("explanation_rendered", question.explanationRendered.toJsonOrNull()),
        )
}

internal fun buildKnowledgeCardPanePayload(card: KnowledgeCard, phonePresentation: Boolean = false, textScale: Float = 1f): JSONObject {
    return JSONObject()
        .put("mode", "knowledge_card")
        .apply {
            if (phonePresentation) {
                put("presentation", "phone")
                put("textScale", textScale.toDouble())
            }
        }
        .put("content_id", card.contentId)
        .put("title", card.title)
        .put(
            "sections",
            JSONArray().also { array ->
                card.sections.forEach { section -> array.put(section.toLearningContentPaneJson()) }
            },
        )
}

internal fun parseLearningContentPaneHeight(payload: String): Result<Int> {
    return runCatching {
        val height = JSONObject(payload).optDouble("height", 1.0)
        height.toInt().coerceAtLeast(1)
    }
}

internal fun historyRecordForLearningContentPaneReviewPayload(
    payload: String,
    records: List<AnswerHistoryRecord>,
): Result<AnswerHistoryRecord> {
    return runCatching {
        val json = JSONObject(payload)
        val answerId = json.optInt("answerId", -1)
        val questionId = json.optString("questionId")
        records.firstOrNull { it.id == answerId }
            ?: records.firstOrNull { it.questionId == questionId }
            ?: error("No matching history record")
    }
}

internal fun reviewMistakeForLearningContentPanePayload(
    payload: String,
    mistakes: List<ReviewMistake>,
): Result<ReviewMistake> {
    return runCatching {
        val json = JSONObject(payload)
        val answerId = json.optInt("answerId", -1)
        val questionId = json.optString("questionId")
        mistakes.firstOrNull { it.answerId == answerId }
            ?: mistakes.firstOrNull { it.questionId == questionId }
            ?: error("No matching review mistake")
    }
}

internal fun learningContentPaneWebViewHeightDp(contentHeightDp: Int, minimumHeightDp: Int = 220): Int {
    return contentHeightDp.coerceAtLeast(minimumHeightDp)
}

internal class LearningContentPaneBridge(
    private val records: () -> List<AnswerHistoryRecord>,
    private val reviewMistakes: () -> List<ReviewMistake> = { emptyList() },
    private val onReady: () -> Unit = {},
    private val onPayloadRendered: () -> Unit = {},
    private val onError: (String) -> Unit = {},
    private val onHeightChanged: (Int) -> Unit = {},
    private val onOpenReview: (AnswerHistoryRecord) -> Unit = {},
    private val onOpenLessonVideo: (AnswerHistoryRecord) -> Unit = {},
    private val onOpenTutor: (AnswerHistoryRecord) -> Unit = {},
    private val onCorrectGrading: (QuestionPaneGradingCorrection) -> Unit = {},
    private val onOpenMistake: (ReviewMistake) -> Unit = {},
    private val onToggleMistakeSelection: (ReviewMistake) -> Unit = {},
) {
    @JavascriptInterface
    fun onPaneReady(payload: String) {
        val ready = runCatching { JSONObject(payload).optBoolean("ready", true) }
            .getOrDefault(true)
        if (ready) onReady()
    }

    @JavascriptInterface
    fun onPayloadRendered(payload: String) {
        val pane = runCatching { JSONObject(payload).optString("pane") }.getOrDefault("")
        if (pane.isBlank() || pane == "learning-content") onPayloadRendered()
    }

    @JavascriptInterface
    fun onPaneError(payload: String) {
        onError(
            runCatching { JSONObject(payload).optString("message") }
                .getOrDefault("内容面板载入失败")
                .ifBlank { "内容面板载入失败" },
        )
    }

    @JavascriptInterface
    fun onHeightChanged(payload: String) {
        parseLearningContentPaneHeight(payload).onSuccess(onHeightChanged)
    }

    @JavascriptInterface
    fun onOpenReview(payload: String) {
        historyRecordForLearningContentPaneReviewPayload(payload, records())
            .onSuccess(onOpenReview)
            .onFailure { onError("未找到对应错题记录") }
    }

    @JavascriptInterface
    fun onOpenLessonVideo(payload: String) {
        runCatching {
            val json = JSONObject(payload)
            records().firstOrNull { it.id == json.optInt("answerId", -1) && it.questionId == json.optString("questionId") }
                ?: error("未找到对应练习记录")
        }.onSuccess { record ->
            if (record.lessonVideo?.available == true) onOpenLessonVideo(record)
            else onError(record.lessonVideo?.lockedReason?.ifBlank { "视频暂未开放" } ?: "本题没有视频讲解")
        }.onFailure { onError("未找到对应练习记录") }
    }

    @JavascriptInterface
    fun onCorrectGrading(payload: String) {
        parseQuestionPaneGradingCorrection(payload).onSuccess { correction ->
            if (records().any { it.questionId == correction.questionId }) onCorrectGrading(correction)
            else onError("未找到对应作答")
        }.onFailure { onError("无法读取批改修正") }
    }

    @JavascriptInterface
    fun onOpenTutor(payload: String) {
        runCatching {
            val json = JSONObject(payload)
            records().firstOrNull { it.id == json.optInt("answerId", -1) && it.questionId == json.optString("questionId") }
                ?: error("未找到对应作答")
        }.onSuccess(onOpenTutor).onFailure { onError("未找到对应作答") }
    }

    @JavascriptInterface
    fun onOpenMistake(payload: String) {
        reviewMistakeForLearningContentPanePayload(payload, reviewMistakes())
            .onSuccess(onOpenMistake)
            .onFailure { onError("未找到对应错题记录") }
    }

    @JavascriptInterface
    fun onToggleMistakeSelection(payload: String) {
        reviewMistakeForLearningContentPanePayload(payload, reviewMistakes())
            .onSuccess(onToggleMistakeSelection)
            .onFailure { onError("未找到对应错题记录") }
    }
}

@Suppress("DEPRECATION")
@SuppressLint("SetJavaScriptEnabled")
@Composable
internal fun HistoryRecordsPaneWebView(
    records: List<AnswerHistoryRecord>,
    onOpenReview: (AnswerHistoryRecord) -> Unit,
    modifier: Modifier = Modifier,
    studentToken: String = "",
    paperPayload: String? = null,
    onOpenTutor: (AnswerHistoryRecord) -> Unit = {},
    onCorrectGrading: (QuestionPaneGradingCorrection) -> Unit = {},
) {
    var videoRecord by remember { mutableStateOf<AnswerHistoryRecord?>(null) }
    videoRecord?.let { record ->
        QuestionLessonVideoPlayback(studentToken, record.questionId, record.id) { videoRecord = null }
    }
    val url = remember { learningContentPaneUrl() }
    val payload = remember(records, paperPayload) { paperPayload ?: buildHistoryRecordsPanePayload(records).toString() }
    val injectionScript = remember(payload) { buildLearningContentPaneInjectionScript(payload) }
    val currentInjectionScript by rememberUpdatedState(injectionScript)
    val currentRecords by rememberUpdatedState(records)
    val currentOnOpenReview by rememberUpdatedState(onOpenReview)
    val currentOnOpenTutor by rememberUpdatedState(onOpenTutor)
    val currentOnCorrectGrading by rememberUpdatedState(onCorrectGrading)
    val scrollInternally = paperPayload != null
    var ready by remember { mutableStateOf(false) }
    var payloadRendered by remember { mutableStateOf(false) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var webViewRef by remember { mutableStateOf<WebView?>(null) }
    val revealGateOpen = rememberLearningContentPaneRevealGate(payloadRendered)
    val revealPane = learningContentPaneShouldReveal(payloadRendered, revealGateOpen, loadError)
    // The reused WebView's height bridge must keep writing to this same state after filtering.
    var contentHeightDp by remember { mutableIntStateOf(320) }
    val paneHeightDp = learningContentPaneWebViewHeightDp(contentHeightDp)

    fun injectPayload(webView: WebView?) {
        if (webView == null) return
        webView.evaluateJavascript(currentInjectionScript, null)
    }

    LaunchedEffect(injectionScript, ready) {
        if (ready) injectPayload(webViewRef)
    }
    DisposableEffect(Unit) {
        onDispose {
            disposeOpenPhysicsPaneWebView(webViewRef)
            webViewRef = null
        }
    }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .then(if (scrollInternally) Modifier.fillMaxSize() else Modifier.height(paneHeightDp.dp)),
    ) {
        AndroidView(
            modifier = Modifier
                .fillMaxWidth()
                .then(if (scrollInternally) Modifier.fillMaxSize() else Modifier.height(paneHeightDp.dp))
                .alpha(if (revealPane) 1f else 0f),
            factory = { context ->
                WebView(context).apply {
                    webViewRef = this
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    )
                    setBackgroundColor(Color.WHITE)
                    isVerticalScrollBarEnabled = scrollInternally
                    isHorizontalScrollBarEnabled = false
                    overScrollMode = WebView.OVER_SCROLL_NEVER
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
                    val bridge = LearningContentPaneBridge(
                        onOpenLessonVideo = { record -> post { videoRecord = record } },
                        onOpenTutor = { record -> post { currentOnOpenTutor(record) } },
                        onCorrectGrading = { correction -> post { currentOnCorrectGrading(correction) } },
                        records = { currentRecords },
                        onReady = {
                            post {
                                ready = true
                                loadError = null
                                injectPayload(this)
                            }
                        },
                        onPayloadRendered = { post { payloadRendered = true } },
                        onError = { message -> post { loadError = message } },
                        onHeightChanged = { height -> if (!scrollInternally) post { contentHeightDp = height + 24 } },
                        onOpenReview = { record -> post { currentOnOpenReview(record) } },
                    )
                    addJavascriptInterface(bridge, QUESTION_PANE_BRIDGE_NAME)
                    addJavascriptInterface(bridge, LEGACY_ANDROID_QUESTION_PANE_BRIDGE_NAME)
                    webViewClient = object : PanePreviewWebViewClient(context) {
                        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                            return !isAllowedLearningContentPaneUrl(request.url, url.toUri())
                        }

                        override fun onPageFinished(view: WebView, finishedUrl: String?) {
                            loadError = null
                            payloadRendered = false
                            recoverLearningContentPaneIfNeeded(view, url)
                            view.evaluateJavascript(PhonePaneChrome.script, null)
                            injectPayload(view)
                        }

                        override fun onReceivedError(
                            view: WebView,
                            request: WebResourceRequest,
                            webError: WebResourceError,
                        ) {
                            if (request.isForMainFrame) {
                                this@apply.stopLoading()
                                ready = false
                                payloadRendered = false
                                loadError = webError.description?.toString()
                                    ?.ifBlank { "内容面板加载失败" }
                                    ?: "内容面板加载失败"
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

                }
            },
        )

        if (!revealPane && loadError == null) {
            LearningContentPaneLoadingOverlay()
        }
        loadError?.let { message ->
            LearningContentPaneErrorOverlay(
                message = message,
                onRetry = {
                    loadError = null
                    ready = false
                    payloadRendered = false
                    webViewRef?.loadUrl(url)
                },
            )
        }
    }
}

@Suppress("DEPRECATION")
@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun DynamicHeightLearningContentPaneWebView(
    payload: String,
    minimumHeightDp: Int,
    modifier: Modifier = Modifier,
    clipWebViewToBounds: Boolean = false,
    hostScript: String? = null,
) {
    val url = remember { learningContentPaneUrl() }
    val currentHostScript by rememberUpdatedState(hostScript)
    val injectionScript = remember(payload) { buildLearningContentPaneInjectionScript(payload) }
    val currentInjectionScript by rememberUpdatedState(injectionScript)
    var ready by remember { mutableStateOf(false) }
    var payloadRendered by remember { mutableStateOf(false) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var webViewRef by remember { mutableStateOf<WebView?>(null) }
    val revealGateOpen = rememberLearningContentPaneRevealGate(payloadRendered)
    val revealPane = learningContentPaneShouldReveal(payloadRendered, revealGateOpen, loadError)
    var contentHeightDp by remember { mutableIntStateOf(minimumHeightDp) }
    val paneHeightDp = learningContentPaneWebViewHeightDp(contentHeightDp, minimumHeightDp)

    fun injectPayload(webView: WebView?) {
        if (webView == null) return
        webView.evaluateJavascript(currentInjectionScript, null)
    }

    LaunchedEffect(injectionScript, ready) {
        if (ready) injectPayload(webViewRef)
    }
    DisposableEffect(Unit) {
        onDispose {
            disposeOpenPhysicsPaneWebView(webViewRef)
            webViewRef = null
        }
    }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(paneHeightDp.dp),
    ) {
        AndroidView(
            modifier = Modifier
                .fillMaxWidth()
                .height(paneHeightDp.dp)
                .alpha(if (revealPane) 1f else 0f),
            factory = { context ->
                WebView(context).apply {
                    webViewRef = this
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    )
                    setBackgroundColor(Color.WHITE)
                    if (clipWebViewToBounds) {
                        outlineProvider = ViewOutlineProvider.BOUNDS
                        clipToOutline = true
                    }
                    isVerticalScrollBarEnabled = false
                    isHorizontalScrollBarEnabled = false
                    overScrollMode = WebView.OVER_SCROLL_NEVER
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
                    val bridge = LearningContentPaneBridge(
                        records = { emptyList() },
                        onReady = {
                            post {
                                ready = true
                                loadError = null
                                injectPayload(this)
                            }
                        },
                        onPayloadRendered = { post { payloadRendered = true } },
                        onError = { message -> post { loadError = message } },
                        onHeightChanged = { height -> post { contentHeightDp = height + 16 } },
                    )
                    addJavascriptInterface(bridge, QUESTION_PANE_BRIDGE_NAME)
                    addJavascriptInterface(bridge, LEGACY_ANDROID_QUESTION_PANE_BRIDGE_NAME)
                    webViewClient = object : PanePreviewWebViewClient(context) {
                        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                            return !isAllowedLearningContentPaneUrl(request.url, url.toUri())
                        }

                        override fun onPageFinished(view: WebView, finishedUrl: String?) {
                            loadError = null
                            payloadRendered = false
                            recoverLearningContentPaneIfNeeded(view, url)
                            view.evaluateJavascript(PhonePaneChrome.script, null)
                            currentHostScript?.let { view.evaluateJavascript(it, null) }
                            injectPayload(view)
                        }

                        override fun onReceivedError(
                            view: WebView,
                            request: WebResourceRequest,
                            webError: WebResourceError,
                        ) {
                            if (request.isForMainFrame) {
                                this@apply.stopLoading()
                                ready = false
                                payloadRendered = false
                                loadError = webError.description?.toString()
                                    ?.ifBlank { "内容面板加载失败" }
                                    ?: "内容面板加载失败"
                            }
                        }
                    }
                    loadUrl(url)
                }
            },
            update = { webView ->
                webViewRef = webView
                if (clipWebViewToBounds) {
                    webView.outlineProvider = ViewOutlineProvider.BOUNDS
                }
                webView.clipToOutline = clipWebViewToBounds
                if (webView.url.isNullOrBlank()) {
                    webView.loadUrl(url)
                } else if (ready) {
                    injectPayload(webView)
                }
            },
        )

        if (!revealPane && loadError == null) {
            LearningContentPaneLoadingOverlay()
        }
        loadError?.let { message ->
            LearningContentPaneErrorOverlay(
                message = message,
                onRetry = {
                    loadError = null
                    ready = false
                    payloadRendered = false
                    webViewRef?.loadUrl(url)
                },
            )
        }
    }
}

@Composable
internal fun ReviewMistakeDetailPaneWebView(
    mistake: ReviewMistake,
    minimumHeightDp: Int,
    modifier: Modifier = Modifier,
) {
    val payload = remember(mistake) {
        buildReviewMistakeDetailPanePayload(mistake).toString()
    }
    val choiceMarks = remember(mistake.correctAnswer, mistake.givenAnswer) {
        reviewMistakeChoiceResultScript(mistake.correctAnswer, mistake.givenAnswer)
    }
    DynamicHeightLearningContentPaneWebView(
        payload = payload,
        minimumHeightDp = minimumHeightDp,
        modifier = modifier,
        hostScript = choiceMarks,
    )
}

@Composable
internal fun SelfReviewSolutionPaneWebView(
    question: PracticeQuestion,
    modifier: Modifier = Modifier,
    minimumHeightDp: Int = 150,
) {
    val phonePresentation = LocalPhonePresentation.current
    val textScale = androidx.compose.ui.platform.LocalDensity.current.fontScale
    val payload = remember(question.id, question.correctAnswer, question.explanation, phonePresentation, textScale) {
        buildSelfReviewSolutionPanePayload(question, phonePresentation, textScale).toString()
    }
    DynamicHeightLearningContentPaneWebView(
        payload = payload,
        minimumHeightDp = minimumHeightDp,
        modifier = modifier,
    )
}

@Composable
internal fun KnowledgeCardPaneWebView(
    card: KnowledgeCard,
    modifier: Modifier = Modifier,
    minimumHeightDp: Int = 260,
    phonePresentation: Boolean = false,
) {
    val textScale = androidx.compose.ui.platform.LocalDensity.current.fontScale
    val payload = remember(card, phonePresentation, textScale) {
        buildKnowledgeCardPanePayload(card, phonePresentation, textScale).toString()
    }
    DynamicHeightLearningContentPaneWebView(
        payload = payload,
        minimumHeightDp = minimumHeightDp,
        modifier = modifier,
        clipWebViewToBounds = phonePresentation,
    )
}

@Suppress("DEPRECATION")
@SuppressLint("SetJavaScriptEnabled")
@Composable
internal fun ReviewNotebookPaneWebView(
    review: ReviewData,
    maxMistakesPerGroup: Int,
    onMistake: (ReviewMistake) -> Unit,
    modifier: Modifier = Modifier,
) {
    val url = remember { learningContentPaneUrl() }
    val payload = remember(review, maxMistakesPerGroup) {
        buildReviewNotebookPanePayload(review, maxMistakesPerGroup).toString()
    }
    val allMistakes = remember(review) { reviewAllMistakes(review) }
    val injectionScript = remember(payload) { buildReviewNotebookPaneInjectionScript(payload) }
    var ready by remember { mutableStateOf(false) }
    var payloadRendered by remember { mutableStateOf(false) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var webViewRef by remember { mutableStateOf<WebView?>(null) }
    var webViewGeneration by remember { mutableIntStateOf(0) }
    var consecutiveRendererFailures by remember { mutableIntStateOf(0) }
    val revealGateOpen = rememberLearningContentPaneRevealGate(payloadRendered)
    val revealPane = learningContentPaneShouldReveal(payloadRendered, revealGateOpen, loadError)

    fun injectPayload(webView: WebView?) {
        if (webView == null) return
        webView.evaluateJavascript(injectionScript, null)
    }

    LaunchedEffect(injectionScript, ready) {
        if (ready) injectPayload(webViewRef)
    }
    DisposableEffect(Unit) {
        onDispose {
            disposeOpenPhysicsPaneWebView(webViewRef)
            webViewRef = null
        }
    }

    Box(modifier = modifier.fillMaxSize()) {
        key(webViewGeneration) {
            AndroidView(
                modifier = Modifier
                    .fillMaxSize()
                    .alpha(if (revealPane) 1f else 0f),
                factory = { context ->
                    WebView(context).apply {
                        webViewRef = this
                        layoutParams = ViewGroup.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT,
                        )
                        setBackgroundColor(Color.WHITE)
                        isVerticalScrollBarEnabled = false
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
                        val bridge = LearningContentPaneBridge(
                            records = { emptyList() },
                            reviewMistakes = { allMistakes },
                            onReady = {
                                post {
                                    ready = true
                                    loadError = null
                                    injectPayload(this)
                                }
                            },
                            onPayloadRendered = {
                                post {
                                    consecutiveRendererFailures = 0
                                    payloadRendered = true
                                }
                            },
                            onError = { message -> post { loadError = message } },
                            onOpenMistake = { mistake -> post { onMistake(mistake) } },
                        )
                        addJavascriptInterface(bridge, QUESTION_PANE_BRIDGE_NAME)
                        addJavascriptInterface(bridge, LEGACY_ANDROID_QUESTION_PANE_BRIDGE_NAME)
                        webViewClient = object : PanePreviewWebViewClient(context) {
                            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                                return !isAllowedLearningContentPaneUrl(request.url, url.toUri())
                            }

                            override fun onPageFinished(view: WebView, finishedUrl: String?) {
                                loadError = null
                                payloadRendered = false
                                recoverLearningContentPaneIfNeeded(view, url)
                                view.evaluateJavascript(PhonePaneChrome.script, null)
                                injectPayload(view)
                            }

                            override fun onReceivedError(
                                view: WebView,
                                request: WebResourceRequest,
                                webError: WebResourceError,
                            ) {
                                if (request.isForMainFrame) {
                                    this@apply.stopLoading()
                                    ready = false
                                    payloadRendered = false
                                    loadError = webError.description?.toString()
                                        ?.ifBlank { "内容面板加载失败" }
                                        ?: "内容面板加载失败"
                                }
                            }

                            override fun onRenderProcessGone(
                                view: WebView,
                                detail: RenderProcessGoneDetail,
                            ): Boolean {
                                val recovery = learningContentPaneRendererRecovery(consecutiveRendererFailures)
                                consecutiveRendererFailures += 1
                                ready = false
                                payloadRendered = false
                                webViewRef = null
                                disposeOpenPhysicsPaneWebView(view)
                                if (recovery == LearningContentPaneRendererRecovery.Recreate) {
                                    loadError = null
                                    webViewGeneration += 1
                                } else {
                                    loadError = "内容渲染中断，请点击重试"
                                }
                                return true
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
        }

        if (!revealPane && loadError == null) {
            LearningContentPaneLoadingOverlay()
        }
        loadError?.let { message ->
            LearningContentPaneErrorOverlay(
                message = message,
                onRetry = {
                    loadError = null
                    ready = false
                    payloadRendered = false
                    consecutiveRendererFailures = 0
                    disposeOpenPhysicsPaneWebView(webViewRef)
                    webViewRef = null
                    webViewGeneration += 1
                },
            )
        }
    }
}

private fun isAllowedLearningContentPaneUrl(target: Uri, base: Uri): Boolean {
    return target.scheme == base.scheme && target.host == base.host
}

private fun AnswerHistoryRecord.toLearningContentPaneJson(): JSONObject {
    return JSONObject()
        .put("id", id)
        .put("question_id", questionId)
        .put("stem_text", stemText)
        .put("stem_rendered", stemRendered.toJsonOrNull())
        .put("question_type", questionType)
        .put(
            "options",
            JSONArray().also { array ->
                options.forEach { option -> array.put(option.toLearningContentPaneJson()) }
            },
        )
        .put(
            "images",
            JSONArray().also { array ->
                promptQuestionImages(stemText, options, images).forEach { image ->
                    array.put(image.toLearningContentPaneJson())
                }
            },
        )
        .put("knowledge_points", JSONArray(kpNames.map { JSONObject().put("name", it) }))
        .put(
            "process_grading",
            processGrading.toLearningContentPaneJsonOrNull(includeDetails = true),
        )
        .put(
            "answer_images",
            JSONArray().also { array ->
                answerImages.forEach { image -> array.put(image.toLearningContentPaneJson()) }
            },
        )
        .put("lesson_video", cn.openphysics.androidapp.data.api.questionLessonVideoJson(lessonVideo) ?: JSONObject.NULL)
        .put("given_answer", givenAnswer)
        .put("is_correct", isCorrect)
        .put("correct_answer", correctAnswer)
        .put("correct_answer_rendered", correctAnswerRendered.toJsonOrNull())
        .put("explanation", explanation)
        .put("explanation_rendered", explanationRendered.toJsonOrNull())
        .put("created_at", createdAt)
}

private fun ReviewGroup.toLearningContentPaneJson(): JSONObject {
    return JSONObject()
        .put("kp_id", kpId)
        .put("kp_name", kpName)
        .put(
            "mistakes",
            JSONArray().also { array ->
                mistakes.forEach { mistake -> array.put(mistake.toLearningContentPaneJson()) }
            },
        )
}

private fun ReviewMistake.toLearningContentPaneJson(includeDetail: Boolean = false): JSONObject {
    val json = JSONObject()
        .put("answer_id", answerId)
        .put("question_id", questionId)
        .put("lesson_video", cn.openphysics.androidapp.data.api.questionLessonVideoJson(lessonVideo) ?: JSONObject.NULL)
        .put("stem_text", stemText)
        .put("question_type", questionType)
        .put("misconception_name", misconceptionName)
        .put("created_at", createdAt)
        .put(
            "answer_images",
            JSONArray().also { array ->
                answerImages.forEach { image -> array.put(image.toLearningContentPaneJson()) }
            },
        )
        .put(
            "process_grading",
            if (includeDetail) {
                processGrading.toLearningContentPaneJsonOrNull(includeDetails = true)
            } else {
                JSONObject().put("needs_human_review", processGrading?.needsHumanReview ?: false)
            },
        )
    if (includeDetail) {
        json
            .put("stem_rendered", stemRendered.toJsonOrNull())
            .put(
                "options",
                JSONArray().also { array ->
                    options.forEach { option -> array.put(option.toLearningContentPaneJson()) }
                },
            )
            .put(
                "images",
                JSONArray().also { array ->
                    promptQuestionImages(stemText, options, images).forEach { image ->
                        array.put(image.toLearningContentPaneJson())
                    }
                },
            )
            .put(
                "given_answer",
                givenAnswer,
            )
            .put("correct_answer", correctAnswer)
            .put("correct_answer_rendered", correctAnswerRendered.toJsonOrNull())
            .put("explanation", explanation)
            .put("explanation_rendered", explanationRendered.toJsonOrNull())
    }
    return json
}

private fun PracticeQuestion.toLearningContentPaneJson(includeSolution: Boolean = true): JSONObject {
    val json = JSONObject()
        .put("id", id)
        .put("stem_text", stem)
        .put("stem_rendered", stemRendered.toJsonOrNull())
        .put("question_type", questionType)
        .put(
            "options",
            JSONArray().also { array ->
                options.forEach { option -> array.put(option.toLearningContentPaneJson()) }
            },
        )
        .put(
            "images",
            JSONArray().also { array ->
                promptQuestionImages(stem, options, images).forEach { image ->
                    array.put(image.toLearningContentPaneJson())
                }
            },
        )
    if (includeSolution) {
        json
            .put("correct_answer", correctAnswer)
            .put("correct_answer_rendered", correctAnswerRendered.toJsonOrNull())
            .put("explanation", explanation)
            .put("explanation_rendered", explanationRendered.toJsonOrNull())
    }
    return json
}

private fun PracticeOption.toLearningContentPaneJson(): JSONObject {
    return JSONObject()
        .put("label", label)
        .put("text", text)
        .put("rendered", rendered.toJsonOrNull())
        .put("text_rendered", textRendered.toJsonOrNull())
}

private fun CardSection.toLearningContentPaneJson(): JSONObject {
    return JSONObject()
        .put("title", title)
        .put("text", text)
        .put("type", type)
        .put("rendered", rendered.toJsonOrNull())
        .put(
            "content",
            JSONObject()
                .put("html", content.html)
                .put("latex", content.latex)
                .put(
                    "variable_table",
                    JSONArray().also { array ->
                        content.variableTable.forEach { variable ->
                            array.put(
                                JSONObject()
                                    .put("symbol", variable.symbol)
                                    .put("name", variable.name)
                                    .put("unit", variable.unit),
                            )
                        }
                    },
                )
                .put("svg", content.svg)
                .put("stem", content.stem)
                .put("solution", content.solution)
                .put("key_takeaway", content.keyTakeaway)
                .put("items", JSONArray(content.items)),
        )
}

private fun QuestionImage.toLearningContentPaneJson(): JSONObject {
    val path = imageUrl.ifBlank { imagePath }
    return JSONObject()
        .put("id", id.toString())
        .put("image_path", path)
        .put("image_type", imageType.ifBlank { JSONObject.NULL })
        .put("description", description.ifBlank { JSONObject.NULL })
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

private fun ProcessGrading?.toLearningContentPaneJsonOrNull(includeDetails: Boolean): Any {
    if (this == null) return JSONObject.NULL
    return if (includeDetails) processGradingToTutorJson(this)
    else JSONObject().put("needs_human_review", needsHumanReview)
}

private fun RenderedRichContentError.toJson(): JSONObject {
    return JSONObject()
        .put("type", type)
        .put("message", message)
        .put("latex", latex)
        .put("position", position ?: JSONObject.NULL)
}

@Composable
private fun LearningContentPaneLoadingOverlay() {
    // A content-shaped placeholder (as iOS's redacted loading state) instead of a lone line of text.
    val pulse = rememberInfiniteTransition(label = "pane-loading")
    val alpha by pulse.animateFloat(
        initialValue = 0.45f, targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(durationMillis = 800), RepeatMode.Reverse), label = "pane-loading-alpha",
    )
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .height(220.dp)
            .background(OpenPhysicsColors.Surface)
            .padding(vertical = 18.dp)
            .semantics { contentDescription = "内容加载中" },
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        listOf(0.42f, 1f, 0.92f, 0.66f, 0f, 0.36f, 1f, 0.8f).forEach { width ->
            if (width == 0f) Spacer(Modifier.height(6.dp))
            else Box(
                Modifier.fillMaxWidth(width).height(if (width < 0.5f) 18.dp else 14.dp)
                    .background(OpenPhysicsColors.NeutralSoft.copy(alpha = alpha), RoundedCornerShape(6.dp)),
            )
        }
    }
}

@Composable
private fun LearningContentPaneErrorOverlay(
    message: String,
    onRetry: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .height(220.dp)
            .background(OpenPhysicsColors.Surface)
            .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Large))
            .padding(18.dp),
    ) {
        Text(
            text = "内容面板加载失败",
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
