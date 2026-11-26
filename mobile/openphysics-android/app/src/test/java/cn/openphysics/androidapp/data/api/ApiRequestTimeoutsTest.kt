package cn.openphysics.androidapp.data.api

import org.junit.Assert.assertEquals
import org.junit.Test

class ApiRequestTimeoutsTest {
    @Test
    fun `plain student api keeps short read timeout`() {
        assertEquals(20_000, apiTimeoutsFor("/practice/submit?student_id=s1").readMs)
    }

    @Test
    fun `ai grading endpoints use long read timeout`() {
        assertEquals(120_000, apiTimeoutsFor("/practice/process-evidence?student_id=s1").readMs)
        assertEquals(120_000, apiTimeoutsFor("/practice/submit-photo?student_id=s1").readMs)
    }

    @Test
    fun `paper batch grading can wait longer than single question grading`() {
        assertEquals(330_000, apiTimeoutsFor("/practice/submit-paper-batch").readMs)
    }

    @Test
    fun `rich content list endpoints use extended read timeout`() {
        assertEquals(60_000, apiTimeoutsFor("/review?student_id=s1&group_by=kp&include_rendered=1").readMs)
        assertEquals(60_000, apiTimeoutsFor("/history/answers?student_id=s1&include_rendered=1").readMs)
    }
}
