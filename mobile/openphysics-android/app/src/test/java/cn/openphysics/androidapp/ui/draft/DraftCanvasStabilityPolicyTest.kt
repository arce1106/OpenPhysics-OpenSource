package cn.openphysics.androidapp.ui.draft

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DraftCanvasStabilityPolicyTest {
    @Test
    fun `touch does not draw while stylus first mode is active`() {
        assertEquals(
            DraftCanvasGestureKind.None,
            resolveDraftSinglePointerGesture(
                selectedTool = DraftTool.Pen,
                pointerKind = DraftPointerKind.Touch,
                stylusButtonPressed = false,
                fingerWritingEnabled = false,
                hasBackgroundImage = false,
            ),
        )
    }

    @Test
    fun `finger writing remains available when explicitly enabled`() {
        assertEquals(
            DraftCanvasGestureKind.Stroke,
            resolveDraftSinglePointerGesture(
                selectedTool = DraftTool.Pen,
                pointerKind = DraftPointerKind.Touch,
                stylusButtonPressed = false,
                fingerWritingEnabled = true,
                hasBackgroundImage = false,
            ),
        )
    }

    @Test
    fun `touch can still move a prompt image while finger writing is disabled`() {
        assertEquals(
            DraftCanvasGestureKind.ImageDrag,
            resolveDraftSinglePointerGesture(
                selectedTool = DraftTool.ImageMove,
                pointerKind = DraftPointerKind.Touch,
                stylusButtonPressed = false,
                fingerWritingEnabled = false,
                hasBackgroundImage = true,
            ),
        )
    }

    @Test
    fun `stylus eraser and side button temporarily erase without changing selected tool`() {
        listOf(
            DraftPointerKind.StylusEraser to false,
            DraftPointerKind.Stylus to true,
        ).forEach { (pointerKind, buttonPressed) ->
            assertEquals(
                DraftCanvasGestureKind.Erase,
                resolveDraftSinglePointerGesture(
                    selectedTool = DraftTool.Pen,
                    pointerKind = pointerKind,
                    stylusButtonPressed = buttonPressed,
                    fingerWritingEnabled = false,
                    hasBackgroundImage = false,
                ),
            )
        }
    }

    @Test
    fun `multi pointer transform returns to idle when only one pointer remains`() {
        assertEquals(
            DraftCanvasGestureKind.None,
            draftCanvasGestureAfterPointerUp(
                activeGesture = DraftCanvasGestureKind.ViewportTransform,
                liftedPointerWasActive = false,
                remainingPointerCount = 1,
            ),
        )
        assertEquals(
            DraftCanvasGestureKind.None,
            draftCanvasGestureAfterPointerUp(
                activeGesture = DraftCanvasGestureKind.ImageTransform,
                liftedPointerWasActive = false,
                remainingPointerCount = 1,
            ),
        )
    }

    @Test
    fun `active drawing pointer still ends the drawing gesture`() {
        assertEquals(
            DraftCanvasGestureKind.None,
            draftCanvasGestureAfterPointerUp(
                activeGesture = DraftCanvasGestureKind.Stroke,
                liftedPointerWasActive = true,
                remainingPointerCount = 1,
            ),
        )
    }

    @Test
    fun `eraser gesture replacement keeps the first before state and latest after state`() {
        val before = listOf(stroke(1L, 0f, 10f, 20f, 30f))
        val middle = listOf(stroke(2L, 0f, 10f))
        val after = listOf(stroke(3L, 20f, 30f))

        val pending = DraftEraserGestureReplacement.start(before)
            .record(after = middle)
            .record(after = after)
            .finish()

        assertEquals(before, pending?.before)
        assertEquals(after, pending?.after)
    }

    @Test
    fun `eraser gesture without changes does not create undo replacement`() {
        assertEquals(null, DraftEraserGestureReplacement.start(emptyList()).finish())
    }

    @Test
    fun `layer reuse policy recycles stale bitmap dimensions`() {
        assertFalse(
            shouldReuseDraftBitmapLayer(
                existingWidth = 800,
                existingHeight = 600,
                existingRecycled = false,
                targetWidth = 1024,
                targetHeight = 768,
            ),
        )
        assertTrue(
            shouldReuseDraftBitmapLayer(
                existingWidth = 1024,
                existingHeight = 768,
                existingRecycled = false,
                targetWidth = 1024,
                targetHeight = 768,
            ),
        )
        assertFalse(
            shouldReuseDraftBitmapLayer(
                existingWidth = 1024,
                existingHeight = 768,
                existingRecycled = true,
                targetWidth = 1024,
                targetHeight = 768,
            ),
        )
    }

    private fun stroke(id: Long, vararg xValues: Float): DraftStroke =
        DraftStroke(
            id = id,
            colorArgb = 0xff000000.toInt(),
            widthPx = 4f,
            points = xValues.mapIndexed { index, x ->
                DraftPoint(
                    x = x,
                    y = 0f,
                    timeMs = index.toLong(),
                    pressure = 1f,
                    toolType = 0,
                )
            },
        )
}
