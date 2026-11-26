package cn.openphysics.androidapp.ui.draft

import org.junit.Assert.*
import org.junit.Test

class DraftSnapshotExportTest {
    @Test
    fun exportIncludesOffscreenInkAfterPanningAndZooming() {
        val snapshot = DraftCanvasSnapshot(strokes = listOf(DraftStroke(1, -16777216, 2.5f, listOf(
            DraftPoint(-80f, 100f, 1, 1f, 2), DraftPoint(500f, 2200f, 2, 1f, 2),
        ))), transform = DraftCanvasTransform(viewport = DraftViewport(700f, -2000f, 3f)),
            canvasWidth = 1000, canvasHeight = 800)
        val bounds = draftExportBounds(snapshot)
        assertTrue(bounds.left < -80f && bounds.right > 500f)
        assertTrue(bounds.top < 100f && bounds.bottom > 2200f)
    }

    @Test
    fun backgroundDiagramIsIncludedAndBlankCanvasRejected() {
        val snapshot = DraftCanvasSnapshot(strokes = listOf(DraftStroke(1, -16777216, 2f,
            listOf(DraftPoint(20f, 20f, 1, 1f, 2)))),
            backgroundImage = DraftBackgroundImage("diagram", null, 1000, 800, -200f, -100f, 2f))
        val bounds = draftExportBounds(snapshot)
        assertEquals(-200f, bounds.left, 0.01f)
        assertEquals(1500f, bounds.bottom, 0.01f)
        assertThrows(IllegalArgumentException::class.java) { draftExportBounds(DraftCanvasSnapshot()) }
    }

    @Test
    fun strokeWidthIsFixedInCanvasUnitsWhenWritten() {
        val written = DraftStroke(1, -16777216, 6f, listOf(DraftPoint(0f, 0f, 1, 1f, 2)), canvasWidth = 3f)
        // Written at 2x: zooming out later must not make it thicker relative to the writing.
        assertEquals(3f, written.canvasWidthAt(1f), 0.001f)
        assertEquals(3f, written.canvasWidthAt(0.35f), 0.001f)
        // Drafts from before the fix keep their old behaviour.
        val legacy = written.copy(canvasWidth = null)
        assertEquals(6f, legacy.canvasWidthAt(1f), 0.001f)
        assertEquals(2f, legacy.canvasWidthAt(3f), 0.001f)
    }

    @Test
    fun exportClarityDoesNotDropWhenZoomedOut() {
        fun snapshot(scale: Float, right: Float) = DraftCanvasSnapshot(
            strokes = listOf(DraftStroke(1, -16777216, 5f,
                listOf(DraftPoint(0f, 0f, 1, 1f, 2), DraftPoint(right, 300f, 2, 1f, 2)), canvasWidth = 2.5f)),
            transform = DraftCanvasTransform(viewport = DraftViewport(scale = scale)),
        )
        val zoomedOut = snapshot(0.35f, 600f)
        assertEquals(2f, draftExportScale(zoomedOut, draftExportBounds(zoomedOut)), 0.001f)
        val zoomedIn = snapshot(3f, 400f)
        assertEquals(3f, draftExportScale(zoomedIn, draftExportBounds(zoomedIn)), 0.001f)
        val wide = snapshot(1f, 4000f)
        val bounds = draftExportBounds(wide)
        assertEquals(2048f, bounds.width * draftExportScale(wide, bounds), 0.5f)
    }
}
