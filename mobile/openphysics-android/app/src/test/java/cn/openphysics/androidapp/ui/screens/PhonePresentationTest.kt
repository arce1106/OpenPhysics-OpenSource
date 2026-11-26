package cn.openphysics.androidapp.ui.screens

import cn.openphysics.androidapp.domain.KnowledgeCard
import cn.openphysics.androidapp.domain.ChapterGroup
import cn.openphysics.androidapp.domain.KpNode
import cn.openphysics.androidapp.domain.StudentSession
import cn.openphysics.androidapp.ui.KpAssessmentProgress
import org.junit.Assert.*
import org.junit.Test

class PhonePresentationTest {
    @Test fun `phone assessment card follows completed and unfinished assessment evidence`() {
        val kp = KpNode("kp", "路程与位移", "必修一", "第一章", "第一节", 0.5, "locked", learningState = "locked")
        val completed = phoneKpAssessmentAction(kp, KpAssessmentProgress.Completed)
        assertEquals("巩固小练", completed.title)
        assertTrue(completed.isConsolidation)
        val unfinished = phoneKpAssessmentAction(kp.copy(learningState = "practice"), KpAssessmentProgress.InProgress)
        assertEquals("掌握评估", unfinished.title)
        assertEquals("重新评估", unfinished.action)
        assertFalse(unfinished.isConsolidation)
    }

    @Test fun `phone continue cue skips locked knowledge points`() {
        fun kp(id: String, state: String) = KpNode(id, id, "必修一", "第一章", "第一节", 0.0, "",
            learningState = state)
        val locked = ChapterGroup("必修一", "第一章", listOf(kp("locked", "locked")))
        val available = ChapterGroup("必修一", "第二章", listOf(kp("ready", "to_learn")))
        val subscribed = StudentSession("token", "student", "student", "", )
        assertEquals("ready", phoneContinueTarget(listOf(locked, available), subscribed)?.second?.id)
        assertNull(phoneContinueTarget(listOf(locked), subscribed))
    }

    @Test fun `phone continue cue respects account status across chapters`() {
        val kp = KpNode("chapter-two", "知识点", "必修 第二册", "第二章", "2.1 练习", 0.0, "", learningState = "learning")
        val chapters = listOf(ChapterGroup(kp.volume, kp.chapter, listOf(kp)))
        val active = StudentSession("token", "student", "student", "")
        assertEquals("chapter-two", phoneContinueTarget(chapters, active)?.second?.id)
        assertNull(phoneContinueTarget(chapters, active.copy(accountStatus = "disabled")))
    }

    @Test fun `phone list previews convert full formulas before truncation`() {
        val preview = phoneQuestionPreview("""初速度为 ${'$'}v_0=2\,\mathrm{m/s}${'$'}，求位移。""")
        assertTrue(preview.contains("v₀=2 m/s"))
        assertFalse(preview.contains("mathrm"))
        assertFalse(preview.contains('$'))
    }

    @Test fun `phone review retains record images without AI grading and deduplicates both formats`() {
        val image = cn.openphysics.androidapp.domain.QuestionImage(1, "/answer.png", "https://example.test/answer.png", "answer", "")
        val created = phoneRecordGrading(null, listOf(image))!!
        assertEquals(listOf("https://example.test/answer.png"), created.answerImagePaths)
        assertNull(created.processScore)
        val graded = created.copy(firstError = "单位错误", processScore = 60)
        assertEquals(graded, phoneRecordGrading(graded, listOf(image)))
        assertNull(phoneRecordGrading(null, emptyList()))
    }

    @Test fun `phone question layout does not reveal solution or change default tablet payload`() {
        val question = cn.openphysics.androidapp.domain.PracticeQuestion(
            "sample", "题干", "problem_solving", emptyList(), emptyList(),
            correctAnswer = "PRIVATE_ANSWER", explanation = "PRIVATE_EXPLANATION",
        )
        val tablet = buildQuestionPanePayload(question, 0, 2, "", includeSolution = false)
        assertFalse(tablet.has("presentation"))
        assertFalse(tablet.has("textScale"))
        val phone = buildQuestionPanePayload(question, 0, 2, "", includeSolution = false,
            phonePresentation = true, textScale = 1.3f)
        assertEquals("phone", phone.getString("presentation"))
        assertEquals(1.3, phone.getDouble("textScale"), 0.001)
        assertEquals(tablet.getJSONObject("question").toString(), phone.getJSONObject("question").toString())
        assertFalse(phone.toString().contains("PRIVATE_"))
    }

    @Test fun `enlarging tablet display does not enable phone redesign`() {
        val tabletWidth = stableDeviceSmallestWidthDp(2560, 1600, 320)
        assertEquals(800, tabletWidth)
        assertFalse(usePhonePresentation(tabletWidth, 533, 853, 533)) // density increased, landscape
        assertTrue(usePhonePresentation(stableDeviceSmallestWidthDp(1080, 2400, 420), 360, 360, 800))
    }

    @Test fun `phones are phones and tablets are tablets in any orientation`() {
        assertTrue(usePhonePresentation(411, 411, 411, 891))
        assertTrue(usePhonePresentation(360, 360, 780, 360)) // phone in landscape
        assertTrue(usePhonePresentation(599, 393, 393, 851))
        assertFalse(usePhonePresentation(800, 800, 1280, 800)) // landscape tablet
        assertFalse(usePhonePresentation(800, 800, 800, 1280)) // portrait tablet
        assertFalse(usePhonePresentation(800, 640, 640, 800)) // tablet split in half
        assertFalse(usePhonePresentation(0, 800, 800, 1280)) // cannot inspect the full device
    }

    @Test fun `a tablet window too small for the workbench uses the phone presentation`() {
        assertTrue(usePhonePresentation(800, 393, 393, 800)) // narrow split screen
        assertTrue(usePhonePresentation(800, 533, 533, 853)) // display scaling in portrait
    }

    @Test fun `knowledge pane phone styles require explicit opt in`() {
        val card = KnowledgeCard("test-card", "加速度", emptyList())
        val tablet = buildKnowledgeCardPanePayload(card)
        assertFalse(tablet.has("presentation"))
        assertFalse(tablet.has("textScale"))
        val phone = buildKnowledgeCardPanePayload(card, phonePresentation = true, textScale = 1.3f)
        assertEquals("phone", phone.getString("presentation"))
        assertEquals(1.3, phone.getDouble("textScale"), 0.001)
        assertEquals(tablet.getString("title"), phone.getString("title"))
        assertEquals(tablet.getJSONArray("sections").toString(), phone.getJSONArray("sections").toString())
    }
}
