package cn.openphysics.androidapp.ui.draft

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DraftInkSamplesTest {
    private fun point(x: Float, y: Float, timeMs: Long, pressure: Float = 0.5f, toolType: Int = 2) =
        DraftPoint(x, y, timeMs, pressure, toolType)

    @Test
    fun timeIsRelativeToStrokeStartAndNeverGoesBackwards() {
        val samples = draftInkSamples(listOf(point(0f, 0f, 1_000), point(1f, 1f, 1_016), point(2f, 2f, 1_010)))
        assertEquals(listOf(0L, 16L, 16L), samples.map { it.elapsedMs })
    }

    @Test
    fun oldSmootherPressureAboveOneIsClampedForInk() {
        val samples = draftInkSamples(listOf(point(0f, 0f, 0, pressure = 1.35f), point(1f, 0f, 8, pressure = 0.2f)))
        assertEquals(listOf(1f, 0.2f), samples.map { it.pressure })
    }

    @Test
    fun missingPressureOnAnyPointDropsPressureForTheWholeStroke() {
        val samples = draftInkSamples(listOf(point(0f, 0f, 0), point(1f, 0f, 8, pressure = DraftNoPressure)))
        assertTrue(samples.all { it.pressure == null })
    }

    @Test
    fun nonFiniteAndDuplicatePointsAreDroppedAndToolTypeIsUniform() {
        val samples = draftInkSamples(listOf(
            point(0f, 0f, 0, toolType = 1),
            point(Float.NaN, 1f, 4),
            point(0f, 0f, 0, toolType = 2),
            point(3f, 4f, 8, toolType = 2),
        ))
        assertEquals(2, samples.size)
        assertTrue(samples.all { it.toolType == 1 })
    }

    @Test
    fun emptyOrUnusableStrokeHasNoSamples() {
        assertTrue(draftInkSamples(emptyList()).isEmpty())
        assertNull(draftInkSamples(listOf(point(Float.POSITIVE_INFINITY, 0f, 0))).firstOrNull())
    }
}
