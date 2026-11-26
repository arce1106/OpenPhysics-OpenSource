package cn.openphysics.androidapp.data.api

import org.junit.Assert.assertEquals
import org.junit.Test

class RenderedRequestPathTest {
    @Test
    fun `include rendered appends query parameter to empty query`() {
        assertEquals(
            "/review/variations/7?include_rendered=1",
            withRenderedContent("/review/variations/7"),
        )
    }

    @Test
    fun `include rendered appends query parameter to existing query`() {
        assertEquals(
            "/practice/session?student_id=s1&count=3&include_rendered=1",
            withRenderedContent("/practice/session?student_id=s1&count=3"),
        )
    }

    @Test
    fun `include rendered does not duplicate parameter`() {
        assertEquals(
            "/practice/session?student_id=s1&include_rendered=1",
            withRenderedContent("/practice/session?student_id=s1&include_rendered=1"),
        )
    }
}
