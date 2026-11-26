package cn.openphysics.androidapp.ui.screens

import android.annotation.SuppressLint
import android.view.MotionEvent
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import cn.openphysics.androidapp.BuildConfig
import cn.openphysics.androidapp.domain.QuestionImage
import cn.openphysics.androidapp.domain.RenderedRichContent
import kotlin.math.abs
import kotlin.math.roundToInt

@Composable
fun RenderedRichText(
    rendered: RenderedRichContent,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
    appendedImages: List<QuestionImage> = emptyList(),
    onContentClick: (() -> Unit)? = null,
) {
    if (!usableRenderedRichContent(rendered)) return
    val phonePresentation = LocalPhonePresentation.current
    val textZoomPercent = if (phonePresentation) {
        (LocalDensity.current.fontScale * 100).roundToInt().coerceIn(86, 300)
    } else 100
    val htmlKey = remember(rendered, compact, appendedImages, phonePresentation, textZoomPercent) {
        listOf(
            "rendered-rich-text",
            if (compact) "compact" else "normal",
            if (phonePresentation) "phone:$textZoomPercent" else "tablet",
            rendered.contentHash.ifBlank { rendered.html.hashCode().toString() },
            appendedImages.joinToString("|") { "${it.id}:${it.imageUrl}" }.hashCode(),
        ).joinToString("#")
    }
    val html = remember(htmlKey) {
        buildRenderedRichHtml(
            rendered = rendered,
            compact = compact,
            appendedImages = appendedImages,
            phonePresentation = phonePresentation,
        )
    }
    val latestOnContentClick by rememberUpdatedState(onContentClick)
    val minHeight = if (compact) 28.dp else 44.dp
    var heightDp by remember(htmlKey) { mutableStateOf(minHeight) }
    var previewUrl by remember(htmlKey) { mutableStateOf<String?>(null) }

    AndroidView(
        modifier = modifier
            .fillMaxWidth()
            .height(heightDp),
        factory = { context ->
            val assetLoader = OpenPhysicsWebAssets.createLoader(context)
            WebView(context).apply {
                setBackgroundColor(android.graphics.Color.TRANSPARENT)
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = false
                settings.loadWithOverviewMode = false
                settings.useWideViewPort = false
                settings.textZoom = textZoomPercent
                settings.defaultFontSize = if (phonePresentation) (if (compact) 16 else 17) else (if (compact) 14 else 15)
                isVerticalScrollBarEnabled = false
                isHorizontalScrollBarEnabled = false
                overScrollMode = WebView.OVER_SCROLL_NEVER
                addJavascriptInterface(
                    RenderedRichTextBridge(
                        onHeight = { px ->
                            post {
                                val next = (px.dp + if (compact) 1.dp else 3.dp).coerceAtLeast(minHeight)
                                if (heightDp != next) heightDp = next
                            }
                        },
                        onImage = { url ->
                            post { previewUrl = url }
                        },
                    ),
                    "OpenPhysicsRichText",
                )
                webViewClient = object : WebViewClient() {
                    override fun shouldInterceptRequest(
                        view: WebView,
                        request: WebResourceRequest,
                    ): WebResourceResponse? {
                        return OpenPhysicsWebAssets.intercept(assetLoader, request.url)
                            ?: super.shouldInterceptRequest(view, request)
                    }

                    override fun onPageFinished(view: WebView, url: String?) {
                        fun notifyHeight() {
                            view.evaluateJavascript(
                                "window.OpenPhysicsNotifyHeight && window.OpenPhysicsNotifyHeight();",
                                null,
                            )
                        }
                        notifyHeight()
                        view.postDelayed({ notifyHeight() }, 120)
                        view.postDelayed({ notifyHeight() }, 500)
                    }
                }
            }
        },
        update = { webView ->
            webView.forwardRenderedRichTextClick(latestOnContentClick)
            if (webView.settings.textZoom != textZoomPercent) webView.settings.textZoom = textZoomPercent
            if (webView.tag != htmlKey) {
                webView.stopLoading()
                webView.tag = htmlKey
                webView.loadDataWithBaseURL(
                    renderedRichTextBaseUrl(),
                    html,
                    "text/html",
                    "UTF-8",
                    null,
                )
            }
        },
    )

    previewUrl?.let { url ->
        RenderedRichImagePreview(url = url, onDismiss = { previewUrl = null })
    }
}

fun buildRenderedRichHtml(
    rendered: RenderedRichContent,
    compact: Boolean = false,
    extraBodyHtml: String = "",
    appendedImages: List<QuestionImage> = emptyList(),
    phonePresentation: Boolean = false,
): String {
    val imageHtml = appendedImages.joinToString("\n") { renderRichTextImage(it) }
    val body = buildString {
        append("""<main id="openphysics-rendered-rich-content">""")
        append(rendered.html)
        if (extraBodyHtml.isNotBlank()) append(extraBodyHtml)
        if (imageHtml.isNotBlank()) append(imageHtml)
        append("</main>")
    }
    val fontSize = if (phonePresentation) (if (compact) 16 else 17) else (if (compact) 14 else 15)
    val tableFontSize = if (phonePresentation) 16 else 14
    val lineHeight = if (compact) 1.55 else 1.62
    return """
        <!doctype html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
          <link rel="stylesheet" href="${OpenPhysicsWebAssets.LocalKatexCssUrl}">
          <style>
            * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
            html, body {
              margin: 0;
              padding: 0;
              width: 100%;
              background: transparent;
              color: #0F172A;
              font-family: sans-serif;
              font-size: ${fontSize}px;
              line-height: $lineHeight;
              overflow-wrap: break-word;
            }
            #openphysics-rendered-rich-content {
              display: block;
              padding: 0 1px 4px 0;
            }
            .katex-display {
              overflow-x: auto;
              overflow-y: hidden;
              max-width: 100%;
            }
            .katex {
              color: #111827;
            }
            .openphysics-table-wrap,
            .markdown-table-wrap {
              display: block;
              width: 100%;
              overflow-x: auto;
              margin: 8px 0;
            }
            .openphysics-rich-table,
            .markdown-table {
              border-collapse: collapse;
              width: auto;
              min-width: max-content;
              font-size: ${tableFontSize}px;
              border: 1px solid #D9D9D9;
              border-radius: 6px;
              overflow: hidden;
              background: white;
            }
            .openphysics-rich-table th,
            .openphysics-rich-table td,
            .markdown-table th,
            .markdown-table td {
              padding: 5px 12px;
              border: 1px solid #D9D9D9;
              white-space: nowrap;
              text-align: center;
              color: #334155;
            }
            .openphysics-rich-image {
              display: block;
              max-width: 100%;
              max-height: 220px;
              width: auto;
              height: auto;
              margin: 10px auto;
              object-fit: contain;
              cursor: pointer;
            }
            .question-image {
              display: block;
              width: 100%;
              margin: 14px 0 4px;
              padding: 8px;
              border: 0;
              border-radius: 10px;
              background: #F2F5F7;
              cursor: pointer;
            }
            .question-image img {
              display: block;
              max-width: 100%;
              max-height: 220px;
              width: auto;
              height: auto;
              margin: 0 auto;
              object-fit: contain;
            }
          </style>
        </head>
        <body class="openphysics-katex-ready">
          $body
          <script>
            (function() {
              function contentHeight() {
                var content = document.getElementById('openphysics-rendered-rich-content');
                if (!content) return 1;
                var maxChildBottom = 0;
                Array.prototype.forEach.call(content.querySelectorAll('section, .question-image, img, .katex, .katex-display, table'), function(el) {
                  var rect = el.getBoundingClientRect();
                  if (rect && rect.bottom > maxChildBottom) maxChildBottom = rect.bottom;
                });
                var rect = content.getBoundingClientRect();
                return Math.ceil(Math.max(maxChildBottom || 0, rect.height || 0, content.scrollHeight || 0, 1));
              }
              function notifyHeight() {
                var height = contentHeight();
                if (height > 0 && window.OpenPhysicsRichText && window.OpenPhysicsRichText.setHeight) {
                  window.OpenPhysicsRichText.setHeight(String(height));
                }
              }
              function bindImages() {
                Array.prototype.forEach.call(document.querySelectorAll('img.openphysics-rich-image'), function(img) {
                  img.addEventListener('click', function(event) {
                    event.stopPropagation();
                    if (window.OpenPhysicsRichText && window.OpenPhysicsRichText.openImage) {
                      window.OpenPhysicsRichText.openImage(img.currentSrc || img.src || '');
                    }
                  });
                });
              }
              window.OpenPhysicsNotifyHeight = notifyHeight;
              window.addEventListener('load', function() {
                bindImages();
                notifyHeight();
                setTimeout(notifyHeight, 100);
                setTimeout(notifyHeight, 500);
              });
              if ('ResizeObserver' in window) {
                new ResizeObserver(function() { notifyHeight(); }).observe(document.body);
              }
              setTimeout(function() {
                bindImages();
                notifyHeight();
              }, 0);
              setTimeout(notifyHeight, 1200);
            })();
          </script>
        </body>
        </html>
    """.trimIndent()
}

private fun usableRenderedRichContent(rendered: RenderedRichContent?): Boolean {
    return rendered?.html?.isNotBlank() == true && rendered.errors.isEmpty()
}

@SuppressLint("ClickableViewAccessibility")
private fun WebView.forwardRenderedRichTextClick(onClick: (() -> Unit)?) {
    isClickable = onClick != null
    if (onClick == null) {
        setOnTouchListener(null)
        return
    }
    var downX = 0f
    var downY = 0f
    setOnTouchListener { view, event ->
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = event.x
                downY = event.y
            }
            MotionEvent.ACTION_UP -> {
                if (abs(event.x - downX) < 18f && abs(event.y - downY) < 18f) {
                    view.performClick()
                    onClick()
                }
            }
        }
        true
    }
}

private fun renderedRichTextBaseUrl(): String {
    return BuildConfig.API_BASE_URL.substringBefore("/api/").trimEnd('/') + "/"
}

private fun renderRichTextImage(image: QuestionImage): String {
    val url = image.imageUrl
    val description = image.description.ifBlank { "题目图片" }
    return """
        <div class="question-image" role="button" onclick="event.stopPropagation(); OpenPhysicsRichText.openImage('${escapeRichTextJs(url)}')">
          <img src="${escapeRichTextHtml(url)}" alt="${escapeRichTextHtml(description)}" />
        </div>
    """.trimIndent()
}

private fun escapeRichTextHtml(text: String): String {
    return text
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")
        .replace("'", "&#39;")
}

private fun escapeRichTextJs(text: String): String {
    return text
        .replace("\\", "\\\\")
        .replace("'", "\\'")
        .replace("\n", "\\n")
        .replace("\r", "")
}

private class RenderedRichTextBridge(
    private val onHeight: (Float) -> Unit,
    private val onImage: (String) -> Unit,
) {
    @JavascriptInterface
    fun setHeight(value: String) {
        value.toFloatOrNull()?.takeIf { it > 0f }?.let(onHeight)
    }

    @JavascriptInterface
    fun openImage(url: String) {
        onImage(url)
    }
}

@Composable
private fun RenderedRichImagePreview(url: String, onDismiss: () -> Unit) {
    val previewImage = remember(url) {
        QuestionImage(
            id = 0,
            imagePath = url,
            imageUrl = url,
            imageType = "preview",
            description = "题目图片",
        )
    }
    val bitmap = rememberQuestionBitmap(previewImage)
    if (bitmap != null) {
        ImagePreviewDialog(
            bitmap = bitmap.asImageBitmap(),
            description = previewImage.description,
            onDismiss = onDismiss,
        )
    } else {
        Dialog(
            onDismissRequest = onDismiss,
            properties = DialogProperties(usePlatformDefaultWidth = false),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color(0xEE000000))
                    .clickable {
                        if (shouldDismissImagePreview(ImagePreviewTapTarget.Backdrop)) {
                            onDismiss()
                        }
                    }
                    .padding(12.dp),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator()
            }
        }
    }
}
