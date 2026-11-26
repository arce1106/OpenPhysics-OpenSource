package cn.openphysics.androidapp.ui.screens

import cn.openphysics.androidapp.domain.LearnBundle
import cn.openphysics.androidapp.domain.LearnProgressItem
import cn.openphysics.androidapp.domain.SimulationContent
import cn.openphysics.androidapp.domain.SlideDeck
import cn.openphysics.androidapp.domain.SlideItem
import cn.openphysics.androidapp.domain.VideoItem
import org.junit.Assert.assertEquals
import org.junit.Test

class LearnResourcePanelTest {
    @Test
    fun `mobile resource cards prioritize lecture then demonstration`() {
        val lecture = VideoItem(
            title = "楞次定律表述",
            url = "https://example.com/lecture",
            uploader = "物理老师",
            category = "lecture",
        )
        val demonstration = VideoItem(
            title = "楞次定律实验探究",
            url = "https://example.com/demo",
            uploader = "",
            category = "demo",
        )

        val cards = learnResourceCards(lecture, demonstration)

        assertEquals(2, cards.size)
        assertEquals("讲解视频", cards[0].source)
        assertEquals("最相关讲解", cards[0].badge)
        assertEquals("B站搜索：楞次定律表述", cards[0].title)
        assertEquals("物理老师", cards[0].subtitle)
        assertEquals("实验演示", cards[1].source)
        assertEquals("看现象", cards[1].badge)
        assertEquals("楞次定律实验探究", cards[1].title)
        assertEquals("", cards[1].subtitle)
    }

    @Test
    fun `mobile resource cards avoid duplicated bilibili search prefix`() {
        val lecture = VideoItem(
            title = "B站搜索：楞次定律表述",
            url = "https://example.com/lecture",
            uploader = "",
            category = "lecture",
        )

        val cards = learnResourceCards(lecture, null)

        assertEquals("B站搜索：楞次定律表述", cards.single().title)
    }

    @Test
    fun `phone distinguishes bilibili search fallback from a curated video`() {
        val search = VideoItem("曲线运动的条件", "https://search.bilibili.com/all?keyword=curve", "", "lecture")
        val curated = VideoItem("曲线运动的条件", "https://www.bilibili.com/video/BV1xQ4y1Q7Hs/", "物理老师", "lecture")

        assertEquals(true, isBilibiliSearchResource(search))
        assertEquals(false, isBilibiliSearchResource(curated))
    }

    @Test
    fun `learn tabs expose slides and interactive resources already returned by the api`() {
        val bundle = LearnBundle(
            kpId = "kp_force",
            kpName = "力的合成",
            card = null,
            videos = emptyList(),
            slides = SlideDeck(
                title = "微课",
                items = listOf(SlideItem(title = "平行四边形定则", body = "作图理解合力")),
            ),
            simulations = listOf(SimulationContent(id = "sim_force", title = "合力拖拽实验", type = "interactive")),
        )

        assertEquals(
            listOf(LearnTab.Resource, LearnTab.Slides, LearnTab.Interactive),
            availableLearnTabs(bundle),
        )
    }

    @Test
    fun `learn progress summarizes all api resource types`() {
        val bundle = LearnBundle(
            kpId = "kp_force",
            kpName = "力的合成",
            card = null,
            videos = emptyList(),
            progress = mapOf(
                "card" to LearnProgressItem(consumed = 1, total = 1),
                "slides" to LearnProgressItem(consumed = 1, total = 2),
                "simulation" to LearnProgressItem(consumed = 0, total = 1),
            ),
        )

        assertEquals("学习进度 2/4", learnProgressText(bundle))
    }
}
