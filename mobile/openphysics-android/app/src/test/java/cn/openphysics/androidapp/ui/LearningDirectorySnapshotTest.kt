package cn.openphysics.androidapp.ui

import cn.openphysics.androidapp.domain.*
import org.junit.Assert.*
import org.junit.Test

class LearningDirectorySnapshotTest {
    private val session = StudentSession("token", "student", "qa", "QA")
    private val oldKp = KpNode("kp", "运动描述", "必修一", "第一章", "1.1", .3, "in_progress")
    private val oldData = DirectoryData(listOf(oldKp), 0, 1, 1)
    private val oldChapter = ChapterGroup(oldKp.volume, oldKp.chapter, listOf(oldKp))
    private val newKp = oldKp.copy(mastery = .86, status = "mastered", learningState = "practice")
    private val newData = DirectoryData(listOf(newKp), 1, 0, 1)
    private val fresh = LearningDirectorySnapshot(session, newData, emptyMap())

    @Test fun `returning to a retained knowledge page uses fresh mastery and chapter totals`() {
        val old = Screen.Learn(session, oldData, oldChapter, oldKp, LearnBundle("kp", "运动描述", null, emptyList()))
        val updated = fresh.apply(old) as Screen.Learn
        assertEquals(.86, updated.kp.mastery, .00001)
        assertEquals("practice", updated.kp.learningState)
        assertEquals(newKp, updated.chapter.kps.single())
        assertEquals(1, updated.data.mastered)
        assertSame(old.bundle, updated.bundle)
        assertEquals(newData, (fresh.apply(Screen.Directory(session, oldData)) as Screen.Directory).data)
    }

    @Test fun `late grading screen construction cannot reintroduce the previous mastery`() {
        val question = PracticeQuestion("q1", "题目", "single_choice", emptyList(), emptyList())
        val practice = PracticeSession("巩固小练", listOf(question))
        val original = Screen.PracticeQuestionScreen(session, oldData, oldChapter, oldKp, practice, 0,
            submissionState = PracticeSetSubmissionState(submitting = true))
        val updated = fresh.apply(original) as Screen.PracticeQuestionScreen
        assertSame(practice, updated.practice)
        assertEquals(0, updated.index)
        assertTrue(updated.submissionState.submitting)
        assertEquals(newKp, updated.kp)
    }

    @Test fun `a topic practice keeps its synthetic knowledge point`() {
        val topicKp = oldKp.copy(id = "gaokao:topic", volume = "高考复习", chapter = "专题")
        val topicData = DirectoryData(listOf(topicKp), 0, 1, 1)
        val practice = PracticeSession("基础巩固", listOf(PracticeQuestion("q1", "题目", "single_choice", emptyList(), emptyList())))
        val screen = Screen.PracticeQuestionScreen(session, topicData, ChapterGroup("高考复习", "专题", listOf(topicKp)), topicKp, practice, 0)
        assertSame(screen, fresh.apply(screen))
    }

    @Test fun `an old account response cannot change another student`() {
        val screen = Screen.Directory(session.copy(studentId = "other"), oldData)
        assertSame(screen, fresh.apply(screen))
        val home = Screen.Home(session)
        assertSame(home, fresh.apply(home))
    }

    @Test fun `a token renewal keeps the same student's fresh mastery`() {
        val renewed = Screen.Directory(session.copy(token = "renewed"), oldData)
        assertEquals(newData, (fresh.apply(renewed) as Screen.Directory).data)
    }
}
