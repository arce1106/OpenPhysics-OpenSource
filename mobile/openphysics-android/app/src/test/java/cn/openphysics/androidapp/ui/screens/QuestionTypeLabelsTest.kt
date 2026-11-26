package cn.openphysics.androidapp.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Test

class QuestionTypeLabelsTest {
    @Test
    fun `maps backend question type identifiers to student labels`() {
        assertEquals("选择题", questionTypeLabel("single_choice"))
        assertEquals("选择题", questionTypeLabel("multiple-choice"))
        assertEquals("填空题", questionTypeLabel("fill_in_blank"))
        assertEquals("解答题", questionTypeLabel("problem_solving"))
        assertEquals("实验题", questionTypeLabel("experimental"))
        assertEquals("判断题", questionTypeLabel("true_false"))
    }

    @Test
    fun `hides raw unknown question type identifiers`() {
        assertEquals("练习题", questionTypeLabel(""))
        assertEquals("练习题", questionTypeLabel("backend_new_type"))
    }
}
