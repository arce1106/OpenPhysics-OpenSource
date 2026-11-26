package cn.openphysics.androidapp.ui

import cn.openphysics.androidapp.domain.PracticeQuestion
import cn.openphysics.androidapp.domain.PracticeSession
import cn.openphysics.androidapp.domain.SubmitResult
import cn.openphysics.androidapp.domain.TeacherPaper
import org.junit.Assert.*
import org.junit.Test

class TeacherPaperReviewTest {
    @Test
    fun `reopened paper follows fixed order and omits missing results without inventing blank submissions`() {
        val questions = listOf("q1", "q2", "q3").map { PracticeQuestion(it, "题目", "single_choice", emptyList(), emptyList()) }
        val practice = PracticeSession("套卷", questions, teacherPaper = TeacherPaper("paper", "运动", 3, status = "grading"),
            answers = linkedMapOf("q3" to SubmitResult(3, false, "B", "解析", "", givenAnswer = "A"),
                "foreign" to SubmitResult(4, true, "A", "", ""), "q1" to SubmitResult(1, true, "B", "", "", givenAnswer = "B")))
        val review = teacherPaperReview(practice)
        assertEquals(listOf("q1", "q3"), review.items.map { it.question.id })
        assertEquals(listOf("B", "A"), review.items.map { it.answer })
        val state = PracticeReviewState().apply { restore(review.items) }
        assertEquals(listOf("q2"), state.pendingQuestions(questions).map { it.id })
    }
}
