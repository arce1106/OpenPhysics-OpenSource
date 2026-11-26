package cn.openphysics.androidapp.ui

import cn.openphysics.androidapp.domain.LearnBundle
import cn.openphysics.androidapp.domain.VideoItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LearnResourceGroupsTest {
    @Test
    fun `groups one lecture and one demonstration from mixed videos`() {
        val bundle = LearnBundle(
            kpId = "x2c1s2k01",
            kpName = "安培力",
            card = null,
            videos = listOf(
                VideoItem(
                    title = "安培力演示实验",
                    url = "https://www.bilibili.com/video/demo",
                    uploader = "高考物理林老师",
                    category = "experiment",
                ),
                VideoItem(
                    title = "安培力知识点讲解",
                    url = "https://www.bilibili.com/video/lecture",
                    uploader = "北大学长跳跳",
                    category = "lecture",
                ),
            ),
        )

        val groups = bundle.toLearnResourceGroups()

        assertEquals("安培力知识点讲解", groups.lecture?.title)
        assertEquals("安培力演示实验", groups.demonstration?.title)
    }

    @Test
    fun `uses title keywords when category is absent`() {
        val bundle = LearnBundle(
            kpId = "x2c1s3k01",
            kpName = "洛伦兹力",
            card = null,
            videos = listOf(
                VideoItem(
                    title = "洛伦兹力演示仪",
                    url = "https://www.bilibili.com/video/demo",
                    uploader = "",
                    category = "",
                ),
            ),
        )

        val groups = bundle.toLearnResourceGroups()

        assertNull(groups.lecture)
        assertEquals("洛伦兹力演示仪", groups.demonstration?.title)
    }
}
