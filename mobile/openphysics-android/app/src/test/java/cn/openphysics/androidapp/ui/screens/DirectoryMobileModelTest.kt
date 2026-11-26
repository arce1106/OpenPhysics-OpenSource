package cn.openphysics.androidapp.ui.screens

import cn.openphysics.androidapp.domain.ChapterGroup
import cn.openphysics.androidapp.domain.KpNode
import org.junit.Assert.assertEquals
import org.junit.Test

class DirectoryMobileModelTest {
    @Test
    fun `mobile sync recommended chapter prefers active progress`() {
        val first = chapter("第一章", kp("k1", mastery = 0.0, status = "not_started"))
        val second = chapter("第二章", kp("k2", mastery = 0.35, status = "in_progress", learningState = "learning", learningStateLabel = "学习中", learningStateTone = "learning"))
        val third = chapter("第三章", kp("k3", mastery = 0.9, status = "mastered", learningState = "mastered", learningStateLabel = "已掌握", learningStateTone = "mastered"))

        val recommended = selectMobileSyncRecommendedChapter(listOf(first, second, third))

        assertEquals("第二章", recommended?.chapter)
    }

    @Test
    fun `mobile sync volume tabs use compact textbook labels`() {
        assertEquals("必修一", mobileSyncVolumeLabel("必修 第一册"))
        assertEquals("选必二", mobileSyncVolumeLabel("选择性必修 第二册"))
    }

    @Test
    fun `mobile sync defaults selected textbook to recommended chapter volume`() {
        val first = chapter("第一章", kp("k1", mastery = 0.0, status = "not_started"))
        val second = ChapterGroup(
            volume = "必修 第二册",
            chapter = "第二章",
            kps = listOf(kp("k2", mastery = 0.35, status = "in_progress", volume = "必修 第二册")),
        )
        val volumes = listOf(first.volume, second.volume)

        assertEquals("必修 第二册", mobileSyncInitialVolume(volumes, second))
        assertEquals("选择性必修 第二册", mobileSyncInitialVolume(volumes, null))
    }

    private fun chapter(name: String, vararg kps: KpNode): ChapterGroup {
        return ChapterGroup(volume = "选择性必修 第二册", chapter = name, kps = kps.toList())
    }

    private fun kp(
        id: String,
        mastery: Double,
        status: String,
        volume: String = "选择性必修 第二册",
        learningState: String = "",
        learningStateLabel: String = "",
        learningStateTone: String = "",
    ): KpNode {
        return KpNode(
            id = id,
            name = id,
            volume = volume,
            chapter = "章节",
            section = "本节",
            mastery = mastery,
            status = status,
            learningState = learningState,
            learningStateLabel = learningStateLabel,
            learningStateTone = learningStateTone,
        )
    }
}
