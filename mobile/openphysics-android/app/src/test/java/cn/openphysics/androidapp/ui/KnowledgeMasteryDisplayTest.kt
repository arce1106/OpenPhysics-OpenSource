package cn.openphysics.androidapp.ui

import cn.openphysics.androidapp.domain.KnowledgeMasteryJudgment
import cn.openphysics.androidapp.ui.design.OpenPhysicsTone
import org.junit.Assert.assertEquals
import org.junit.Test

class KnowledgeMasteryDisplayTest {
    @Test
    fun `low confidence judgment maps to evidence scarce display`() {
        val display = mapKnowledgeMasteryJudgmentToMasteryDisplay(
            judgment = judgment(confidence = "low", masteryScore = 0.0),
            fallback = KnowledgeMasteryDisplayFallback(
                label = "未开始",
                reason = "建议先学习知识卡片，再用小测确认理解。",
                tone = OpenPhysicsTone.Neutral,
                masteryPct = 0,
            ),
        )

        assertEquals("证据较少", display.label)
        assertEquals("当前证据较少，建议先学习或完成掌握评估。", display.reason)
        assertEquals(OpenPhysicsTone.Primary, display.tone)
        assertEquals(0, display.masteryPct)
        assertEquals(true, display.isJudgmentBased)
    }

    @Test
    fun `missing judgment keeps fallback display`() {
        val display = mapKnowledgeMasteryJudgmentToMasteryDisplay(
            judgment = null,
            fallback = KnowledgeMasteryDisplayFallback(
                label = "未开始",
                reason = "建议先学习知识卡片，再用小测确认理解。",
                tone = OpenPhysicsTone.Neutral,
                masteryPct = 0,
            ),
        )

        assertEquals("未开始", display.label)
        assertEquals(OpenPhysicsTone.Neutral, display.tone)
        assertEquals(false, display.isJudgmentBased)
    }

    private fun judgment(
        confidence: String = "medium",
        masteryScore: Double = 0.0,
        masteryLevel: String = "weak",
        interventionStatus: String = "needs_learning",
    ): KnowledgeMasteryJudgment {
        return KnowledgeMasteryJudgment(
            kpId = "kp-1",
            kpName = "速度与时间的关系",
            masteryScore = masteryScore,
            masteryLevel = masteryLevel,
            interventionStatus = interventionStatus,
            confidence = confidence,
            nextAction = "learn",
            reason = "",
        )
    }
}
