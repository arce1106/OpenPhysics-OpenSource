package cn.openphysics.androidapp.ui.draft

import org.junit.Assert.assertEquals
import org.junit.Test

class DraftCanvasTransformTest {
    @Test
    fun `restored viewport fits and centers when canvas size changes`() {
        val adapted = adaptDraftTransformToCanvas(
            transform = DraftCanvasTransform(
                viewport = DraftViewport(offsetX = 20f, offsetY = 10f, scale = 1f),
            ),
            fromWidth = 1000,
            fromHeight = 500,
            toWidth = 500,
            toHeight = 500,
        )

        assertEquals(0.5f, adapted.viewport.scale, 0.001f)
        assertEquals(10f, adapted.viewport.offsetX, 0.001f)
        assertEquals(130f, adapted.viewport.offsetY, 0.001f)
    }

    @Test
    fun `initial image is placed left and slightly below top`() {
        val transform = DraftCanvasTransform.initialForImage(
            viewWidth = 1000f,
            viewHeight = 800f,
            imageWidth = 400f,
            imageHeight = 300f,
        )

        assertEquals(80f, transform.image.x, 0.01f)
        assertEquals(80f, transform.image.y, 0.01f)
        assertEquals(1.4f, transform.image.scale, 0.01f)
    }

    @Test
    fun `dragging image moves only the image in world coordinates`() {
        val transform = DraftCanvasTransform.initialForImage(
            viewWidth = 1000f,
            viewHeight = 800f,
            imageWidth = 400f,
            imageHeight = 300f,
        )

        val moved = transform.dragImage(screenDx = 120f, screenDy = 60f)

        assertEquals(200f, moved.image.x, 0.01f)
        assertEquals(140f, moved.image.y, 0.01f)
        assertEquals(transform.viewport, moved.viewport)
    }

    @Test
    fun `pinching image scales around image center without changing viewport`() {
        val transform = DraftCanvasTransform.initialForImage(
            viewWidth = 1000f,
            viewHeight = 800f,
            imageWidth = 400f,
            imageHeight = 300f,
        )

        val scaled = transform.scaleImage(factor = 1.5f, imageWidth = 400f, imageHeight = 300f)

        assertEquals(2.1f, scaled.image.scale, 0.01f)
        assertEquals(transform.image.centerX(400f), scaled.image.centerX(400f), 0.01f)
        assertEquals(transform.image.centerY(300f), scaled.image.centerY(300f), 0.01f)
        assertEquals(transform.viewport, scaled.viewport)
    }

    @Test
    fun `viewport converts screen coordinates after pan and zoom`() {
        val transform = DraftCanvasTransform()
            .panViewport(screenDx = 100f, screenDy = 50f)
            .zoomViewport(factor = 2f, pivotScreenX = 400f, pivotScreenY = 300f)

        val world = transform.screenToWorld(screenX = 500f, screenY = 350f)

        assertEquals(350f, world.x, 0.01f)
        assertEquals(275f, world.y, 0.01f)
    }
}
