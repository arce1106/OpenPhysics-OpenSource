package cn.openphysics.androidapp.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder

internal data class LessonVideoTarget(val url: String, val packageName: String? = null)

internal fun lessonVideoTargets(rawUrl: String): List<LessonVideoTarget> {
    val url = rawUrl.trim()
    val uri = runCatching { URI(url) }.getOrNull() ?: return emptyList()
    if (uri.scheme?.lowercase() !in setOf("http", "https") || uri.host.isNullOrBlank() || uri.userInfo != null) {
        return emptyList()
    }
    val host = uri.host.lowercase()
    val isBilibili = host == "bilibili.com" || host.endsWith(".bilibili.com") || host == "b23.tv"
    // Knowledge-point recommendations can be search pages, which HD does not register as web links.
    val appSearchUrl = if (host == "search.bilibili.com" && uri.path in setOf("", "/", "/all", "/all/", "/video", "/video/")) {
        val keyword = uri.rawQuery.orEmpty().split('&').firstNotNullOfOrNull { part ->
            val key = part.substringBefore('=')
            if (key != "keyword" || !part.contains('=')) null
            else runCatching { URLDecoder.decode(part.substringAfter('='), "UTF-8") }.getOrNull()
        }?.takeIf { it.isNotBlank() }
        keyword?.let { "bilibili://search?keyword=${URLEncoder.encode(it, "UTF-8").replace("+", "%20")}" }
    } else null
    return buildList {
        if (isBilibili) {
            if (appSearchUrl != null) {
                add(LessonVideoTarget(appSearchUrl, "tv.danmaku.bili"))
                add(LessonVideoTarget(appSearchUrl, "tv.danmaku.bilibilihd"))
            }
            // Use the original HTTPS link so video ID, part (p), time and short-link routing survive.
            add(LessonVideoTarget(url, "tv.danmaku.bili"))
            add(LessonVideoTarget(url, "tv.danmaku.bilibilihd"))
        }
        add(LessonVideoTarget(url))
    }
}

internal fun launchLessonVideo(url: String, launch: (LessonVideoTarget) -> Boolean): Boolean =
    lessonVideoTargets(url).any(launch)

internal fun openLessonVideo(context: Context, url: String) {
    val opened = launchLessonVideo(url) { target ->
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(target.url)).apply {
                target.packageName?.let(::setPackage)
                addCategory(Intent.CATEGORY_BROWSABLE)
            })
            true
        } catch (_: ActivityNotFoundException) {
            false
        } catch (_: SecurityException) {
            false
        }
    }
    if (!opened) Toast.makeText(context, "暂时无法打开视频，请检查是否安装了浏览器", Toast.LENGTH_LONG).show()
}
