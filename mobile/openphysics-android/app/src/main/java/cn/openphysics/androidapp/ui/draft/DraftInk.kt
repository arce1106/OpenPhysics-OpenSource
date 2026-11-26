package cn.openphysics.androidapp.ui.draft

import android.view.MotionEvent
import androidx.ink.brush.Brush
import androidx.ink.brush.BrushFamily
import androidx.ink.brush.InputToolType
import androidx.ink.brush.StockBrushes
import androidx.ink.strokes.MutableStrokeInputBatch
import androidx.ink.strokes.Stroke
import androidx.ink.strokes.StrokeInput

/** One input as Ink accepts it: finite, time never going backwards, pressure for all points or none. */
internal data class DraftInkSample(
    val x: Float,
    val y: Float,
    val elapsedMs: Long,
    val pressure: Float?,
    val toolType: Int,
)

/**
 * Clean saved points into a sequence Ink will take. Saved drafts may hold points Ink rejects
 * (pressure above 1 from the old smoother, clock jitter, duplicates); dropping or clamping them
 * here keeps an old draft drawable instead of losing the whole stroke.
 */
internal fun draftInkSamples(points: List<DraftPoint>): List<DraftInkSample> {
    val finite = points.filter { it.x.isFinite() && it.y.isFinite() }
    if (finite.isEmpty()) return emptyList()
    val startMs = finite.first().timeMs
    val toolType = finite.first().toolType
    val withPressure = finite.all { it.pressure.isFinite() && it.pressure >= 0f }
    val samples = ArrayList<DraftInkSample>(finite.size)
    var elapsed = 0L
    finite.forEach { point ->
        elapsed = maxOf(elapsed, point.timeMs - startMs)
        val previous = samples.lastOrNull()
        if (previous != null && previous.x == point.x && previous.y == point.y && previous.elapsedMs == elapsed) {
            return@forEach
        }
        samples += DraftInkSample(
            x = point.x,
            y = point.y,
            elapsedMs = elapsed,
            pressure = if (withPressure) point.pressure.coerceIn(0f, 1f) else null,
            toolType = toolType,
        )
    }
    return samples
}

/**
 * The bridge to Jetpack Ink. Ink draws the stroke while it is being written and every finished
 * stroke; the draft itself is still stored as [DraftStroke] points, so saving, undo, the partial
 * eraser and answer export keep working on our own data.
 */
internal object DraftInk {
    // Pinned to V1 so saved drafts keep their look when the library adds newer pen versions.
    private val penFamily: BrushFamily by lazy { StockBrushes.pressurePen(StockBrushes.PressurePenVersion.V1) }
    private const val Epsilon = 0.05f

    fun brush(colorArgb: Int, canvasWidth: Float): Brush =
        Brush.createWithColorIntArgb(penFamily, colorArgb, canvasWidth.coerceAtLeast(0.1f), Epsilon)

    /** Rebuild a stored stroke for drawing. Same inputs and brush give the same shape Ink drew live. */
    fun stroke(stroke: DraftStroke, viewportScale: Float): Stroke? {
        val samples = draftInkSamples(stroke.points)
        if (samples.isEmpty()) return null
        val toolType = samples.first().toolType.toInkToolType()
        val batch = MutableStrokeInputBatch()
        var added = 0
        samples.forEach { sample ->
            val accepted = runCatching {
                if (sample.pressure != null) {
                    batch.add(
                        type = toolType,
                        x = sample.x,
                        y = sample.y,
                        elapsedTimeMillis = sample.elapsedMs,
                        strokeUnitLengthCm = StrokeInput.NO_STROKE_UNIT_LENGTH,
                        pressure = sample.pressure,
                    )
                } else {
                    batch.add(type = toolType, x = sample.x, y = sample.y, elapsedTimeMillis = sample.elapsedMs)
                }
            }.isSuccess
            if (accepted) added += 1
        }
        if (added == 0) return null
        return runCatching {
            Stroke(brush(stroke.colorArgb, stroke.canvasWidthAt(viewportScale)), batch)
        }.getOrNull()
    }

    /** The raw inputs of a stroke Ink just finished, as points to store. */
    fun points(stroke: Stroke, startTimeMs: Long): List<DraftPoint> {
        val inputs = stroke.inputs
        val hasPressure = inputs.hasPressure()
        val input = StrokeInput()
        return List(inputs.size) { index ->
            inputs.populate(index, input)
            DraftPoint(
                x = input.x,
                y = input.y,
                timeMs = startTimeMs + input.elapsedTimeMillis,
                pressure = if (hasPressure) input.pressure else DraftNoPressure,
                toolType = input.toolType.toMotionToolType(),
            )
        }
    }

    private fun Int.toInkToolType(): InputToolType = when (this) {
        MotionEvent.TOOL_TYPE_STYLUS, MotionEvent.TOOL_TYPE_ERASER -> InputToolType.STYLUS
        MotionEvent.TOOL_TYPE_FINGER -> InputToolType.TOUCH
        MotionEvent.TOOL_TYPE_MOUSE -> InputToolType.MOUSE
        else -> InputToolType.UNKNOWN
    }

    private fun InputToolType.toMotionToolType(): Int = when (this) {
        InputToolType.STYLUS -> MotionEvent.TOOL_TYPE_STYLUS
        InputToolType.TOUCH -> MotionEvent.TOOL_TYPE_FINGER
        InputToolType.MOUSE -> MotionEvent.TOOL_TYPE_MOUSE
        else -> MotionEvent.TOOL_TYPE_UNKNOWN
    }
}
