package cn.openphysics.androidapp.ui.draft

internal object DraftPenWidths {
    const val DefaultDp = 2.5f
    val SizesDp = listOf(1.5f, DefaultDp, 4f)
}

data class DraftPoint(
    val x: Float,
    val y: Float,
    val timeMs: Long,
    /** 0–1 from the pen; [DraftNoPressure] when the input device reported none. */
    val pressure: Float,
    val toolType: Int,
)

data class DraftStroke(
    val id: Long,
    val colorArgb: Int,
    /** The pen width on screen, in pixels, when the stroke was written. */
    val widthPx: Float,
    val points: List<DraftPoint>,
    /**
     * The width in canvas units, fixed when the stroke was written (screen width ÷ zoom at that
     * moment), so ink keeps its proportions when the student zooms later and in the exported
     * answer. Null only for drafts saved before this existed; they keep the old behaviour.
     */
    val canvasWidth: Float? = null,
)

internal const val DraftNoPressure = -1f

/** Width to draw this stroke with on the canvas, at the given zoom. */
internal fun DraftStroke.canvasWidthAt(viewportScale: Float): Float =
    canvasWidth ?: (widthPx / viewportScale.coerceAtLeast(0.001f))

data class DraftCanvasSnapshot(
    val strokes: List<DraftStroke> = emptyList(),
    val transform: DraftCanvasTransform = DraftCanvasTransform(),
    val hasTransform: Boolean = false,
    val canvasWidth: Int = 0,
    val canvasHeight: Int = 0,
    val backgroundImage: DraftBackgroundImage? = null,
)

data class DraftBackgroundImage(
    val imagePath: String,
    val description: String? = null,
    val naturalWidth: Int,
    val naturalHeight: Int,
    val x: Float,
    val y: Float,
    val scale: Float,
)

enum class DraftTool {
    Pen,
    Eraser,
    ImageMove,
}

data class DraftCanvasInfo(
    val strokeCount: Int = 0,
    val canUndo: Boolean = false,
    val canRedo: Boolean = false,
)
