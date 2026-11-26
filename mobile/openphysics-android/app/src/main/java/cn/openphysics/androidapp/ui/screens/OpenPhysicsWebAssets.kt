package cn.openphysics.androidapp.ui.screens

import android.content.Context
import android.net.Uri
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader

object OpenPhysicsWebAssets {
    const val Domain = "appassets.openphysics.local"
    const val BaseUrl = "https://$Domain/"
    const val LocalKatexCssUrl = "${BaseUrl}assets/katex/katex.min.css"

    fun createLoader(context: Context): WebViewAssetLoader =
        WebViewAssetLoader.Builder()
            .setDomain(Domain)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
            .build()

    /**
     * Rendered rich text documents use the API origin as their base URL, so the bundled KaTeX
     * fonts (resolved relative to the stylesheet on [Domain]) are cross-origin @font-face loads.
     * Without CORS headers WebView silently drops them and formulas fall back to system fonts:
     * sans-serif italics, misplaced fraction bars and clipped glyphs in 解析.
     */
    fun intercept(loader: WebViewAssetLoader, url: Uri): WebResourceResponse? =
        loader.shouldInterceptRequest(url)?.apply {
            responseHeaders = (responseHeaders.orEmpty()) + mapOf(
                "Access-Control-Allow-Origin" to "*",
                "Cache-Control" to "max-age=31536000, immutable",
            )
        }
}
