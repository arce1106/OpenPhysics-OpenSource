package cn.openphysics.androidapp.ui.screens

import cn.openphysics.androidapp.domain.ChapterGroup
import cn.openphysics.androidapp.domain.KpNode
import cn.openphysics.androidapp.ui.KpAssessmentProgress
import cn.openphysics.androidapp.ui.design.OpenPhysicsTone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncTabletModelTest {
    @Test
    fun `empty chapter stays in directory with pending content instead of mastery judgment`() {
        val pending = kp(status = "pending_content", mastery = 0.0, learningState = "pending_content")
            .copy(contentAvailable = false, practiceAvailable = false)
        assertTrue(pending.contentPending)
        assertEquals("内容待补充", syncKpStatus(pending).label)
        assertEquals("内容待补充", syncChapterStatus(chapter(pending)))
        assertEquals(OpenPhysicsTone.Neutral, syncChapterTone(chapter(pending)))
        val ready = kp(id = "ready", status = "mastered", mastery = 0.9, learningState = "mastered")
        assertEquals(90, chapter(ready, pending).averageMasteryPercent())
    }

    @Test
    fun `sync tablet kp status uses backend learning state label`() {
        val status = syncKpStatus(
            kp(
                status = "needs_learning",
                mastery = 0.0,
                learningState = "to_learn",
                learningStateLabel = "待学习",
                learningStateTone = "learning",
            ),
        )

        assertEquals("待学习", status.label)
        assertEquals(OpenPhysicsTone.Primary, status.tone)
    }

    @Test
    fun `sync tablet chapter status does not infer consolidation from untouched needs-learning kps`() {
        val chapter = chapter(
            kp(
                status = "needs_learning",
                mastery = 0.0,
                learningState = "to_learn",
                learningStateLabel = "待学习",
                learningStateTone = "learning",
            ),
        )

        assertEquals("待学习", syncChapterStatus(chapter))
        assertEquals(OpenPhysicsTone.Primary, syncChapterTone(chapter))
    }

    @Test
    fun `sync tablet chapter status follows backend practice state even when mastery is zero`() {
        val chapter = chapter(
            kp(
                status = "needs_learning",
                mastery = 0.0,
                learningState = "practice",
                learningStateLabel = "待巩固",
                learningStateTone = "practice",
            ),
        )

        assertEquals("待巩固", syncChapterStatus(chapter))
        assertEquals(OpenPhysicsTone.Warning, syncChapterTone(chapter))
    }


    @Test
    fun `sync tablet actions expose web-aligned learning check train and improvement intents`() {
        val learningActions = syncKpActions(kp(status = "in_progress", mastery = 0.2, learningState = "learning"))

        assertEquals(SyncKpActionKind.Learn, learningActions.primary.kind)
        assertEquals("继续学习", learningActions.primary.label)
        assertEquals(SyncKpActionKind.Check, learningActions.secondary.kind)
        assertEquals("掌握评估", learningActions.secondary.label)
        assertEquals(
            listOf(SyncKpActionKind.Train, SyncKpActionKind.Improvement),
            learningActions.more.map { it.kind },
        )

        val practiceActions = syncKpActions(kp(status = "in_progress", mastery = 0.58, learningState = "practice"))

        assertEquals(SyncKpActionKind.Train, practiceActions.primary.kind)
        assertEquals("巩固小练", practiceActions.primary.label)
        assertEquals(SyncKpActionKind.Learn, practiceActions.secondary.kind)
        assertEquals("回看知识卡", practiceActions.secondary.label)
        assertEquals(
            listOf(SyncKpActionKind.Improvement),
            practiceActions.more.map { it.kind },
        )
    }

    @Test
    fun `locked points name what membership opens instead of the action`() {
        val actions = syncKpActions(kp(status = "in_progress", mastery = 0.2, learningState = "learning"))
        assertEquals("继续学习", syncKpActionLabel(actions.primary, locked = false))
        assertEquals("登录后学习", syncKpActionLabel(actions.primary, locked = true))
        assertEquals("登录后掌握评估", syncKpActionLabel(actions.secondary, locked = true))
    }

    @Test
    fun `tablet action follows local assessment progress before stale directory state`() {
        val locked = kp(status = "locked", mastery = 0.5, learningState = "locked")
        assertEquals(SyncKpActionKind.Train, syncKpActions(locked, KpAssessmentProgress.Completed).primary.kind)
        val prematurelyPracticing = locked.copy(learningState = "practice")
        val unfinished = syncKpActions(prematurelyPracticing, KpAssessmentProgress.InProgress)
        assertEquals(SyncKpActionKind.Check, unfinished.primary.kind)
        assertEquals("重新评估", unfinished.primary.label)
        assertEquals(listOf(SyncKpActionKind.Improvement), unfinished.more.map { it.kind })
    }

    @Test
    fun `sync tablet initial selection focuses returned knowledge point`() {
        val target = kp(
            id = "kp_target",
            status = "mastered",
            mastery = 0.98,
            learningState = "mastered",
            volume = "必修 第一册",
            chapterName = "第一章 运动的描述",
        )
        val grouped = mapOf(
            "必修 第一册" to listOf(
                ChapterGroup(
                    volume = "必修 第一册",
                    chapter = "第一章 运动的描述",
                    kps = listOf(
                        kp(id = "kp_other", status = "needs_learning", mastery = 0.0, learningState = "to_learn"),
                        target,
                    ),
                ),
            ),
            "必修 第二册" to listOf(chapter(kp(status = "needs_learning", mastery = 0.0, learningState = "learning"))),
        )

        val selection = syncTabletInitialSelection(
            grouped = grouped,
            volumes = listOf("必修 第一册", "必修 第二册"),
            focusedKpId = "kp_target",
        )

        assertEquals("必修 第一册", selection.volume)
        assertEquals("第一章 运动的描述", selection.chapterName)
        assertEquals("kp_target", selection.activeKpId)
        assertEquals(true, selection.showKpPanel)
    }

    @Test
    fun `sync tablet graph uses available vertical space to separate nodes`() {
        val kps = (1..13).map { index ->
            kp(
                id = "kp_$index",
                status = "needs_learning",
                mastery = 0.0,
                learningState = "to_learn",
            )
        }

        val layout = buildSyncTabletGraphLayout(kps, relations = emptyList())
        val firstColumnNodes = layout.nodes
            .filter { it.col == 0 }
            .sortedBy { it.row }

        assertEquals(2, layout.nodes.maxOf { it.row })
        assertEquals(true, layout.height >= 620)
        firstColumnNodes.zipWithNext().forEach { (above, below) ->
            assertEquals(true, below.y - above.y >= 150)
        }
    }

    @Test
    fun `sync tablet graph drops prerequisite arrows implied by a longer chain`() {
        val reduced = syncTabletTransitiveReduction(listOf("a" to "b", "b" to "c", "a" to "c", "c" to "d", "a" to "d"))

        assertEquals(listOf("a" to "b", "b" to "c", "c" to "d"), reduced)
        assertEquals(listOf("a" to "b", "b" to "a"), syncTabletTransitiveReduction(listOf("a" to "b", "b" to "a")))
    }

    @Test
    fun `sync tablet graph keeps paths leaving a cycle`() {
        val reduced = syncTabletTransitiveReduction(listOf("a" to "b", "b" to "a", "a" to "c", "b" to "c"))

        assertTrue(("a" to "b") in reduced)
        assertTrue(("b" to "a") in reduced)
        assertTrue(reduced.any { it.second == "c" })
    }

    private fun chapter(vararg kps: KpNode): ChapterGroup {
        return ChapterGroup(volume = "必修 第二册", chapter = "第五章 抛体运动", kps = kps.toList())
    }

    private fun kp(
        id: String = "kp",
        status: String,
        mastery: Double,
        learningState: String = "",
        learningStateLabel: String = "",
        learningStateTone: String = "",
        volume: String = "必修 第二册",
        chapterName: String = "第五章 抛体运动",
    ): KpNode {
        return KpNode(
            id = id,
            name = "平抛运动实验思想",
            volume = volume,
            chapter = chapterName,
            section = "5.3",
            mastery = mastery,
            status = status,
            learningState = learningState,
            learningStateLabel = learningStateLabel,
            learningStateTone = learningStateTone,
        )
    }
}
