package cn.openphysics.androidapp.ui.screens

import cn.openphysics.androidapp.domain.KpNode
import cn.openphysics.androidapp.ui.KpAssessmentProgress
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidLearningFlowTest {
    @Test
    fun `mastered and practice states use consolidation practice instead of mastery assessment`() {
        assertTrue(shouldUseConsolidationPractice(kp("mastered")))
        assertTrue(shouldUseConsolidationPractice(kp("practice")))
    }

    @Test
    fun `learning and to learn states use mastery assessment`() {
        assertFalse(shouldUseConsolidationPractice(kp("learning")))
        assertFalse(shouldUseConsolidationPractice(kp("to_learn")))
    }

    @Test
    fun `completed assessment advances even when directory path is still locked`() {
        assertTrue(shouldUseConsolidationPractice(kp("locked"), KpAssessmentProgress.Completed))
    }

    @Test
    fun `unfinished assessment does not advance after first graded answer changes directory state`() {
        assertFalse(shouldUseConsolidationPractice(kp("practice"), KpAssessmentProgress.InProgress))
    }

    private fun kp(learningState: String): KpNode {
        return KpNode(
            id = "kp_1",
            name = "参考系",
            volume = "必修 第一册",
            chapter = "第一章 运动的描述",
            section = "1.1",
            mastery = 0.0,
            status = "current",
            learningState = learningState,
            learningStateLabel = "",
            learningStateTone = "",
        )
    }
}
