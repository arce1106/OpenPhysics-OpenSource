package cn.openphysics.androidapp.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Test

class AnswerPhotoCropTest {
    private val box = AnswerCropRect(0.2f, 0.2f, 0.8f, 0.8f)
    private fun handle(x: Float, y: Float) = answerCropHandleAt(box, x, y, 0.03f, 0.03f)

    @Test
    fun `a touch picks the corner, edge or inside it lands on`() {
        assertEquals(AnswerCropHandle.TopLeft, handle(0.21f, 0.19f))
        assertEquals(AnswerCropHandle.BottomRight, handle(0.8f, 0.8f))
        assertEquals(AnswerCropHandle.Top, handle(0.5f, 0.2f))
        assertEquals(AnswerCropHandle.Right, handle(0.81f, 0.5f))
        assertEquals(AnswerCropHandle.Move, handle(0.5f, 0.5f))
        assertEquals(AnswerCropHandle.None, handle(0.05f, 0.5f))
    }

    @Test
    fun `dragging an edge resizes only that side and stays inside the photo`() {
        assertEquals(AnswerCropRect(0f, 0.2f, 0.8f, 0.8f), adjustAnswerCrop(box, AnswerCropHandle.Left, -0.5f, 0.3f))
        val bottomRight = adjustAnswerCrop(box, AnswerCropHandle.BottomRight, 0.1f, 0.1f)
        assertEquals(0.9f, bottomRight.right, 1e-5f)
        assertEquals(0.9f, bottomRight.bottom, 1e-5f)
        // A box never shrinks below the minimum size, however far the corner goes.
        val shrunk = adjustAnswerCrop(box, AnswerCropHandle.TopLeft, 0.9f, 0.9f)
        assertEquals(AnswerCropRect.MIN_SIZE, shrunk.width, 1e-5f)
        assertEquals(AnswerCropRect.MIN_SIZE, shrunk.height, 1e-5f)
    }

    @Test
    fun `moving keeps the size and stops at the photo edge`() {
        val moved = adjustAnswerCrop(box, AnswerCropHandle.Move, 0.5f, -0.1f)
        assertEquals(1f, moved.right, 1e-5f)
        assertEquals(0.6f, moved.width, 1e-5f)
        assertEquals(0.1f, moved.top, 1e-5f)
        assertEquals(box, adjustAnswerCrop(box, AnswerCropHandle.None, 0.3f, 0.3f))
    }
}
