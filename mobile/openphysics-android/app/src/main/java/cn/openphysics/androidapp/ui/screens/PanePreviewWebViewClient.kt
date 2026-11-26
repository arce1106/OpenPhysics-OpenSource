package cn.openphysics.androidapp.ui.screens

import android.content.Context
import android.util.Log
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import cn.openphysics.androidapp.BuildConfig
import java.io.ByteArrayInputStream
import java.io.IOException
import java.net.URI

/** Local acceptance builds can carry a pane without changing the cloud deployment. */
internal fun bundledPaneAssetPath(url: String, paneUrl: String, enabled: Boolean): String? {
    if (!enabled) return null
    val request = runCatching { URI(url) }.getOrNull() ?: return null
    val origin = runCatching { URI(paneUrl) }.getOrNull() ?: return null
    if (request.scheme != origin.scheme || request.host != origin.host ||
        request.port != origin.port || request.rawUserInfo != null
    ) return null
    val prefix = "/panes/learning-content/"
    val path = request.rawPath ?: return null
    if (!path.startsWith(prefix)) return null
    val relative = path.removePrefix(prefix).ifEmpty { "index.html" }
    // Built filenames are ASCII; never decode arbitrary paths into the app's assets.
    if (!relative.matches(Regex("[A-Za-z0-9_./-]+")) ||
        relative.split('/').any { it == "." || it == ".." || it.isEmpty() }
    ) return null
    if (relative != "index.html" && !relative.startsWith("assets/")) return null
    return "panes/learning-content/$relative"
}

internal open class PanePreviewWebViewClient(context: Context) : WebViewClient() {
    private val assets = context.applicationContext.assets

    override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest): WebResourceResponse? {
        val path = bundledPaneAssetPath(
            request.url.toString(), learningContentPaneUrl(), BuildConfig.BUNDLED_PANE_PREVIEW,
        ) ?: return super.shouldInterceptRequest(view, request)
        if (request.method != "GET") return super.shouldInterceptRequest(view, request)
        val mime = when (path.substringAfterLast('.')) {
            "html" -> "text/html"
            "js" -> "application/javascript"
            "css" -> "text/css"
            "woff2" -> "font/woff2"
            "woff" -> "font/woff"
            "ttf" -> "font/ttf"
            "svg" -> "image/svg+xml"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "json" -> "application/json"
            else -> "application/octet-stream"
        }
        return try {
            val stream = assets.open(path)
            if (path.endsWith("/index.html")) Log.i("OpenPhysicsPanePreview", "Using bundled learning-content pane")
            WebResourceResponse(mime, "UTF-8", 200, "OK", mapOf(
                "Cache-Control" to "no-store",
                "X-OpenPhysics-Pane-Preview" to "bundled",
            ), stream)
        } catch (_: IOException) {
            // Missing preview assets must fail visibly instead of mixing two pane versions.
            WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", emptyMap(),
                ByteArrayInputStream("Bundled pane asset missing".toByteArray()))
        }
    }
}
