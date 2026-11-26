package cn.openphysics.androidapp.data.api

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class LearnContentTextTest {
    @Test
    fun `formats example section without leaking raw json`() {
        val content = JSONObject()
            .put("stem", "判断以下情况是否可以视为质点：n1. 研究公转n2. 研究自转")
            .put("solution", "1. 可以n2. 不可以")
            .put("key_takeaway", "看大小和形状是否影响研究问题")

        val text = LearnContentText.extract(content)

        assertEquals(
            "题目：判断以下情况是否可以视为质点：\n1. 研究公转\n2. 研究自转\n\n解答：1. 可以\n2. 不可以\n\n提醒：看大小和形状是否影响研究问题",
            text,
        )
    }

    @Test
    fun `keeps formula section compact for styled display`() {
        val content = JSONObject()
            .put("latex", "x=v_0t+\\frac{1}{2}at^2")

        val text = LearnContentText.extract(content)

        assertEquals("x=v_0t+\\frac{1}{2}at^2", text)
    }
}
