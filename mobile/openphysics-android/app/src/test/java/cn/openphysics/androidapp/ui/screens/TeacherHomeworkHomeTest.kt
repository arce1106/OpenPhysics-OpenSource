package cn.openphysics.androidapp.ui.screens

import cn.openphysics.androidapp.data.api.LearningCatalogParsers
import cn.openphysics.androidapp.domain.HomeworkScore
import cn.openphysics.androidapp.domain.TeacherHomework
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TeacherHomeworkHomeTest {
    private fun homework(id: String, status: String) =
        TeacherHomework(id, "a_$id", "作业 $id", "高三7班", 4, 0, status)

    @Test
    fun `several finished homework show only the newest one on the home card`() {
        // The server lists newest first; older results are reopened from 作业记录.
        val items = listOf(homework("3", "completed"), homework("2", "completed"), homework("1", "completed"))
        assertEquals(listOf("3"), teacherHomeworkHomeRows(items, expanded = false).map { it.attemptId })
        assertEquals(listOf("3"), teacherHomeworkHomeRows(items, expanded = true).map { it.attemptId })
        assertNull(teacherHomeworkMoreLabel(homeTeacherHomework(items).otherPending.size, expanded = false))
    }

    @Test
    fun `unfinished homework leads and other unfinished ones fold under it`() {
        val items = listOf(homework("4", "completed"), homework("3", "in_progress"), homework("2", "grading"), homework("1", "completed"))
        assertEquals(listOf("3"), teacherHomeworkHomeRows(items, expanded = false).map { it.attemptId })
        assertEquals("还有 1 份作业待完成", teacherHomeworkMoreLabel(homeTeacherHomework(items).otherPending.size, expanded = false))
        assertEquals(listOf("3", "2"), teacherHomeworkHomeRows(items, expanded = true).map { it.attemptId })
        assertEquals("收起", teacherHomeworkMoreLabel(1, expanded = true))
        assertEquals(emptyList<String>(), teacherHomeworkHomeRows(emptyList(), expanded = false).map { it.attemptId })
    }

    @Test
    fun `finished homework shows its score out of 100 and whether the teacher has reviewed it`() {
        val reviewed = homework("1", "completed").copy(score = HomeworkScore(40.5, 48.0, 84, released = true))
        assertEquals("高三7班 · 4 题 · 84 分", reviewed.detail)
        assertEquals("84 分" to "老师已审核", homeworkRecordStatus(reviewed))
        val provisional = reviewed.copy(score = HomeworkScore(24.0, 48.0, 50, released = false))
        assertEquals("AI 批改，老师审核后可能调整", homeworkRecordStatus(provisional).second)
        // Older servers send no score: the row keeps its plain status.
        assertEquals("高三7班 · 4 题 · 已完成", homework("2", "completed").detail)
        assertEquals("高三7班 · 纸质作业 · 已出成绩", homework("3", "completed").copy(delivery = "paper").detail)
        assertEquals("未完成" to "4 题", homeworkRecordStatus(homework("4", "in_progress")))
        assertEquals(67, homeworkAverage(listOf(reviewed, provisional, homework("5", "in_progress"))))
        assertNull(homeworkAverage(listOf(homework("6", "in_progress"))))
    }

    @Test
    fun `the score is read only when the server sent all of it`() {
        val score = LearningCatalogParsers.parseHomeworkScore(JSONObject(
            """{"score": 10, "max_score": 12, "score_percent": 83, "results_released": true}"""))
        assertEquals(HomeworkScore(10.0, 12.0, 83, released = true), score)
        assertNull(LearningCatalogParsers.parseHomeworkScore(JSONObject("""{"score": null, "max_score": null, "score_percent": null}""")))
        assertNull(LearningCatalogParsers.parseHomeworkScore(JSONObject("""{"status": "in_progress"}""")))
    }

    @Test
    fun `record meta names the class, size and the day it was set`() {
        assertEquals("高三7班 · 4 题 · 布置于 2026-10-30",
            homeworkRecordMeta(homework("1", "completed").copy(publishedAt = "2026-10-30T08:00:00+00:00")))
    }
}
