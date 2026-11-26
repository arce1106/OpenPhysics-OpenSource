package cn.openphysics.androidapp.ui

import org.junit.Assert.*
import org.junit.Test

class LessonVideoLinkTest {
    @Test fun `HD search opens through app protocol when it cannot handle HTTPS search links`() {
        val url = "https://search.bilibili.com/all?keyword=%E9%AB%98%E4%B8%AD%E7%89%A9%E7%90%86+%E7%89%9B%E9%A1%BF%E7%AC%AC%E4%BA%8C%E5%AE%9A%E5%BE%8B"
        val attempted = mutableListOf<LessonVideoTarget>()
        assertTrue(launchLessonVideo(url) { target ->
            attempted += target
            target.packageName == "tv.danmaku.bilibilihd" && target.url.startsWith("bilibili://search?")
        })
        assertEquals(2, attempted.size)
        assertEquals(LessonVideoTarget("bilibili://search?keyword=%E9%AB%98%E4%B8%AD%E7%89%A9%E7%90%86%20%E7%89%9B%E9%A1%BF%E7%AC%AC%E4%BA%8C%E5%AE%9A%E5%BE%8B", "tv.danmaku.bilibilihd"), attempted.last())
    }

    @Test fun `search preserves literal plus and ampersand without allowing parameter injection`() {
        val targets = lessonVideoTargets("https://search.bilibili.com/video?keyword=F%3Dma%20%2B%20a%26b&other=value")
        assertEquals("bilibili://search?keyword=F%3Dma%20%2B%20a%26b", targets.first().url)
        assertEquals("tv.danmaku.bili", targets.first().packageName)
    }

    @Test fun `missing clients fall back to the original search page`() {
        val url = "https://search.bilibili.com/all?keyword=物理%20实验"
        val attempted = mutableListOf<LessonVideoTarget>()
        assertTrue(launchLessonVideo(url) { attempted += it; it.packageName == null })
        assertEquals(5, attempted.size)
        assertEquals(LessonVideoTarget(url), attempted.last())
    }

    @Test fun `blank search and unrelated search hosts do not get a custom protocol`() {
        for (url in listOf("https://search.bilibili.com/all", "https://search.bilibili.com/all?keyword=+",
            "https://search.bilibili.com/unknown?keyword=物理", "https://search.bilibili.com.example.org/all?keyword=物理")) {
            assertFalse(lessonVideoTargets(url).any { it.url.startsWith("bilibili:") })
        }
    }

    @Test fun `installed bilibili opens original video and part without opening browser`() {
        val url = "https://www.bilibili.com/video/BV1xx411c7mD/?p=3&t=42"
        val attempted = mutableListOf<LessonVideoTarget>()
        assertTrue(launchLessonVideo(url) { attempted += it; true })
        assertEquals(listOf(LessonVideoTarget(url, "tv.danmaku.bili")), attempted)
    }

    @Test fun `missing apps fall back to original web link including short URLs`() {
        for (url in listOf("https://b23.tv/example", "https://m.bilibili.com/video/av170001?p=2")) {
            val attempted = mutableListOf<LessonVideoTarget>()
            assertTrue(launchLessonVideo(url) { attempted += it; it.packageName == null })
            assertEquals(3, attempted.size)
            assertTrue(attempted.all { it.url == url })
            assertNull(attempted.last().packageName)
        }
    }

    @Test fun `HD client is tried when standard client cannot handle link`() {
        val attempted = mutableListOf<LessonVideoTarget>()
        assertTrue(launchLessonVideo("https://www.bilibili.com/video/BV1xx411c7mD") {
            attempted += it
            it.packageName == "tv.danmaku.bilibilihd"
        })
        assertEquals(2, attempted.size)
    }

    @Test fun `unrelated hosts are never sent to bilibili and invalid links are rejected`() {
        for (url in listOf("https://example.com/lesson", "https://bilibili.com.example.org/video")) {
            assertEquals(listOf(LessonVideoTarget(url)), lessonVideoTargets(url))
        }
        for (url in listOf("", "javascript:alert(1)", "intent://video", "https://user@bilibili.com/video")) {
            assertTrue(lessonVideoTargets(url).isEmpty())
        }
        assertFalse(launchLessonVideo("https://bilibili.com/video/av1") { false })
    }
}
