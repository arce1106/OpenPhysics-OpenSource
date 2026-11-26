package cn.openphysics.androidapp.ui.draft

internal enum class DraftCanvasGestureKind {
    None,
    Stroke,
    Erase,
    ImageDrag,
    ImageTransform,
    ViewportTransform,
}

internal enum class DraftPointerKind {
    Touch,
    Stylus,
    StylusEraser,
    Mouse,
    Other,
}

internal fun resolveDraftSinglePointerGesture(
    selectedTool: DraftTool,
    pointerKind: DraftPointerKind,
    stylusButtonPressed: Boolean,
    fingerWritingEnabled: Boolean,
    hasBackgroundImage: Boolean,
): DraftCanvasGestureKind {
    if (
        pointerKind == DraftPointerKind.Touch &&
        !fingerWritingEnabled &&
        (selectedTool == DraftTool.Pen || selectedTool == DraftTool.Eraser)
    ) {
        return DraftCanvasGestureKind.None
    }
    if (
        pointerKind == DraftPointerKind.StylusEraser ||
        (pointerKind == DraftPointerKind.Stylus && stylusButtonPressed)
    ) {
        return DraftCanvasGestureKind.Erase
    }
    return when (selectedTool) {
        DraftTool.Pen -> DraftCanvasGestureKind.Stroke
        DraftTool.Eraser -> DraftCanvasGestureKind.Erase
        DraftTool.ImageMove -> if (hasBackgroundImage) {
            DraftCanvasGestureKind.ImageDrag
        } else {
            DraftCanvasGestureKind.Stroke
        }
    }
}

internal fun draftCanvasGestureAfterPointerUp(
    activeGesture: DraftCanvasGestureKind,
    liftedPointerWasActive: Boolean,
    remainingPointerCount: Int,
): DraftCanvasGestureKind {
    if (liftedPointerWasActive) return DraftCanvasGestureKind.None
    return when (activeGesture) {
        DraftCanvasGestureKind.ImageTransform,
        DraftCanvasGestureKind.ViewportTransform -> {
            if (remainingPointerCount < 2) DraftCanvasGestureKind.None else activeGesture
        }
        DraftCanvasGestureKind.Stroke,
        DraftCanvasGestureKind.Erase,
        DraftCanvasGestureKind.ImageDrag,
        DraftCanvasGestureKind.None -> activeGesture
    }
}

internal data class DraftStrokeReplacement(
    val before: List<DraftStroke>,
    val after: List<DraftStroke>,
)

internal class DraftEraserGestureReplacement private constructor(
    private val before: List<DraftStroke>,
    private val latestAfter: List<DraftStroke>? = null,
) {
    fun record(after: List<DraftStroke>): DraftEraserGestureReplacement =
        DraftEraserGestureReplacement(before = before, latestAfter = after)

    fun finish(): DraftStrokeReplacement? {
        val after = latestAfter ?: return null
        if (after == before) return null
        return DraftStrokeReplacement(before = before, after = after)
    }

    companion object {
        fun start(before: List<DraftStroke>): DraftEraserGestureReplacement =
            DraftEraserGestureReplacement(before = before)
    }
}

internal fun shouldReuseDraftBitmapLayer(
    existingWidth: Int,
    existingHeight: Int,
    existingRecycled: Boolean,
    targetWidth: Int,
    targetHeight: Int,
): Boolean = !existingRecycled && existingWidth == targetWidth && existingHeight == targetHeight
