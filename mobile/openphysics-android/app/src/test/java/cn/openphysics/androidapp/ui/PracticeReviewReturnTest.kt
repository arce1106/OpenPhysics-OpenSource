package cn.openphysics.androidapp.ui

import cn.openphysics.androidapp.domain.*
import org.junit.Assert.*
import org.junit.Test

class PracticeReviewReturnTest {
    @Test fun `return from corrected paper question refreshes the summary without crossing attempts or students`() {
        val session = StudentSession("fixture", "student", "sample", "sample")
        val kp = KpNode("kp", "加速度", "必修一", "第一章", "加速度", 0.5, "practice")
        val data = DirectoryData(listOf(kp), 0, 1, 1)
        val chapter = ChapterGroup(kp.volume, kp.chapter, listOf(kp))
        val question = PracticeQuestion("q", "求加速度", "problem_solving", emptyList(), emptyList())
        val wrong = SubmitResult(1, false, "2", "解析", "", givenAnswer = "1")
        val corrected = wrong.copy(correct = true, givenAnswer = "2")
        val paper = TeacherPaper("paper", "套卷", 1, attemptId = "attempt", status = "completed")
        val practice = PracticeSession("套卷", listOf(question), teacherPaper = paper, answers = mapOf("q" to wrong))
        val old = Screen.PracticeReviewScreen(session, data, chapter, kp, practice,
            PracticeReview(listOf(PracticeReviewItem(question, "1", wrong))))
        val result = Screen.PracticeResultScreen(session, data, chapter, kp,
            practice.copy(answers = mapOf("q" to corrected)), 0, question, "2", corrected, openedFromSummary = true)
        val review = PracticeReview(listOf(PracticeReviewItem(question, "2", corrected)))
        val fresh = refreshReviewAfterResult(old, result, review) as Screen.PracticeReviewScreen
        assertEquals(1, fresh.review.correctCount)
        assertEquals("2", fresh.practice.answers["q"]?.givenAnswer)
        assertSame(old, refreshReviewAfterResult(old, result.copy(session = session.copy(studentId = "another")), review))
        assertSame(old, refreshReviewAfterResult(old, result.copy(practice = result.practice.copy(teacherPaper = paper.copy(attemptId = "new-attempt"))), review))
        assertSame(old, refreshReviewAfterResult(old, result.copy(practice = result.practice.copy(questions = listOf(question.copy(id = "other")))), review))
    }
}
