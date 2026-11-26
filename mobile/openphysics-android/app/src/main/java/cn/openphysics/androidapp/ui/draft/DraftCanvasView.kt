package cn.openphysics.androidapp.ui.draft

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.util.AttributeSet
import android.view.MotionEvent
import android.widget.FrameLayout
import androidx.input.motionprediction.MotionEventPredictor
import androidx.ink.authoring.InProgressStrokeId
import androidx.ink.authoring.InProgressStrokesFinishedListener
import androidx.ink.authoring.InProgressStrokesView
import androidx.ink.rendering.android.canvas.CanvasStrokeRenderer
import androidx.ink.strokes.Stroke
import kotlin.math.hypot

/**
 * The draft canvas. Strokes are written through Jetpack Ink (low-latency rendering and input
 * prediction) and stored as [DraftStroke]; panning, zooming, the diagram, undo and the partial
 * eraser are ours. The Ink layer is a child drawn above this view; all touches come here.
 */
class DraftCanvasView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : FrameLayout(context, attrs) {
    private val strokes = mutableListOf<DraftStroke>()
    private val undoStack = mutableListOf<DraftOperation>()
    private val redoStack = mutableListOf<DraftOperation>()
    private var currentStrokeId = 0L
    private val inkView = InProgressStrokesView(context)
    private val inkRenderer = CanvasStrokeRenderer.create()
    private val motionPredictor = MotionEventPredictor.newInstance(this)
    private var activeInkStrokeId: InProgressStrokeId? = null
    private val pendingInkStrokes = HashMap<InProgressStrokeId, PendingInkStroke>()
    /** Ink geometry per stroke id; valid only while it was built for that exact stroke object. */
    private val inkStrokeCache = HashMap<Long, Pair<DraftStroke, Stroke>>()
    private var backgroundLayer: Bitmap? = null
    private var committedStrokesLayer: Bitmap? = null
    private var backgroundLayerDirty = true
    private var committedStrokesLayerDirty = true
    private var invalidatePending = false
    private var tool = DraftTool.Pen
    private var penWidthPx = DraftPenWidths.DefaultDp * resources.displayMetrics.density
    private var eraserRadiusPx = 32f
    private var penColor = Color.rgb(15, 23, 42)
    private var showGrid = true
    private var backgroundBitmap: Bitmap? = null
    private var backgroundImageMetadata: DraftBackgroundImage? = null
    private var transform = DraftCanvasTransform()
    private var imageTransformInitialized = false
    private var activeGesture = ActiveGesture.None
    private var activePointerId = MotionEvent.INVALID_POINTER_ID
    private var activeToolType = MotionEvent.TOOL_TYPE_UNKNOWN
    private var fingerWritingEnabled = false
    private var restoredCanvasWidth = 0
    private var restoredCanvasHeight = 0
    private var lastGestureFocusX = 0f
    private var lastGestureFocusY = 0f
    private var lastGestureSpan = 0f
    private var eraserPreviewPoint: DraftPointF? = null
    private var eraserGestureReplacement: DraftEraserGestureReplacement? = null
    private var onStateChanged: ((DraftCanvasInfo) -> Unit)? = null
    private var onSnapshotCommitted: ((DraftCanvasSnapshot) -> Unit)? = null

    private val bitmapLayerPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.DITHER_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
        isDither = true
        isFilterBitmap = true
    }

    private val gridPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.DITHER_FLAG).apply {
        color = Color.rgb(230, 236, 244)
        strokeWidth = 1f
    }

    private val eraserPreviewFillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(28, 20, 145, 155)
        style = Paint.Style.FILL
    }

    private val eraserPreviewStrokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(20, 145, 155)
        style = Paint.Style.STROKE
    }

    private val inkFinishedListener = object : InProgressStrokesFinishedListener {
        override fun onStrokesFinished(strokes: Map<InProgressStrokeId, Stroke>) {
            handleFinishedInkStrokes(strokes)
        }
    }

    init {
        setWillNotDraw(false)
        isFocusable = true
        addView(inkView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        inkView.addFinishedStrokesListener(inkFinishedListener)
    }

    // Ink only paints; every touch and hover is handled by this view.
    override fun onInterceptTouchEvent(event: MotionEvent): Boolean = true

    override fun onInterceptHoverEvent(event: MotionEvent): Boolean = true

    fun setTool(next: DraftTool) {
        tool = next
        if (next != DraftTool.Eraser) {
            eraserPreviewPoint = null
        }
        scheduleInvalidate()
    }

    fun setPenWidth(widthPx: Float) {
        penWidthPx = widthPx.coerceAtLeast(1f)
    }

    fun setPenColorArgb(colorArgb: Int) {
        penColor = colorArgb
    }

    fun setEraserRadius(radiusPx: Float) {
        eraserRadiusPx = radiusPx.coerceAtLeast(8f)
        scheduleInvalidate()
    }

    fun setFingerWritingEnabled(enabled: Boolean) {
        fingerWritingEnabled = enabled
    }

    fun setShowGrid(enabled: Boolean) {
        if (showGrid == enabled) return
        showGrid = enabled
        backgroundLayerDirty = true
        scheduleInvalidate()
    }

    fun setBackgroundBitmap(bitmap: Bitmap?) {
        if (backgroundBitmap != null && backgroundBitmap !== bitmap) {
            imageTransformInitialized = false
        }
        if (backgroundBitmap === bitmap) return
        backgroundBitmap = bitmap
        backgroundLayerDirty = true
        initializeImageTransformIfNeeded()
        scheduleInvalidate()
        notifySnapshotCommitted()
    }

    fun setBackgroundImageMetadata(metadata: DraftBackgroundImage?) {
        if (backgroundImageMetadata == metadata) return
        backgroundImageMetadata = metadata
        notifySnapshotCommitted()
    }

    fun setOnStateChanged(callback: (DraftCanvasInfo) -> Unit) {
        onStateChanged = callback
        notifyStateChanged()
    }

    fun setOnSnapshotCommitted(callback: (DraftCanvasSnapshot) -> Unit) {
        onSnapshotCommitted = callback
    }

    fun snapshot(): DraftCanvasSnapshot = DraftCanvasSnapshot(
        strokes = strokes.toList(),
        transform = transform,
        hasTransform = true,
        canvasWidth = width,
        canvasHeight = height,
        backgroundImage = backgroundImageForSnapshot(),
    )

    private fun backgroundImageForSnapshot(): DraftBackgroundImage? {
        val bitmap = backgroundBitmap ?: return null
        val metadata = backgroundImageMetadata
        return DraftBackgroundImage(
            imagePath = metadata?.imagePath.orEmpty(),
            description = metadata?.description,
            naturalWidth = metadata?.naturalWidth ?: bitmap.width,
            naturalHeight = metadata?.naturalHeight ?: bitmap.height,
            x = transform.image.x,
            y = transform.image.y,
            scale = transform.image.scale,
        ).takeIf { it.imagePath.isNotBlank() }
    }

    fun restore(snapshot: DraftCanvasSnapshot) {
        discardInkInProgress()
        inkStrokeCache.clear()
        strokes.clear()
        // Older drafts stored only the screen width; fix it at the zoom they were saved with.
        strokes.addAll(
            snapshot.strokes.map { stroke ->
                if (stroke.canvasWidth != null) stroke
                else stroke.copy(canvasWidth = stroke.canvasWidthAt(snapshot.transform.viewport.scale))
            },
        )
        currentStrokeId = strokes.maxOfOrNull { it.id } ?: 0L
        transform = snapshot.transform
        imageTransformInitialized = snapshot.hasTransform
        restoredCanvasWidth = snapshot.canvasWidth
        restoredCanvasHeight = snapshot.canvasHeight
        backgroundLayerDirty = true
        committedStrokesLayerDirty = true
        undoStack.clear()
        redoStack.clear()
        scheduleInvalidate()
        notifyStateChanged()
    }

    fun undo() {
        val operation = undoStack.removeLastOrNull() ?: return
        when (operation) {
            is DraftOperation.AddStroke -> strokes.remove(operation.stroke)
            is DraftOperation.RemoveStrokes -> {
                operation.items.sortedBy { it.index }.forEach { item ->
                    strokes.add(item.index.coerceIn(0, strokes.size), item.stroke)
                }
            }
            is DraftOperation.ReplaceStrokes -> {
                strokes.clear()
                strokes.addAll(operation.before)
            }
        }
        redoStack.add(operation)
        committedStrokesLayerDirty = true
        scheduleInvalidate()
        notifyStateChanged()
        notifySnapshotCommitted()
    }

    fun redo() {
        val operation = redoStack.removeLastOrNull() ?: return
        when (operation) {
            is DraftOperation.AddStroke -> strokes.add(operation.stroke)
            is DraftOperation.RemoveStrokes -> operation.items.forEach { strokes.remove(it.stroke) }
            is DraftOperation.ReplaceStrokes -> {
                strokes.clear()
                strokes.addAll(operation.after)
            }
        }
        undoStack.add(operation)
        committedStrokesLayerDirty = true
        scheduleInvalidate()
        notifyStateChanged()
        notifySnapshotCommitted()
    }

    fun clearCanvas() {
        if (strokes.isEmpty()) return
        val removed = strokes.mapIndexed { index, stroke -> RemovedStroke(index, stroke) }
        strokes.clear()
        undoStack.add(DraftOperation.RemoveStrokes(removed))
        redoStack.clear()
        pruneInkStrokeCache()
        committedStrokesLayerDirty = true
        scheduleInvalidate()
        notifyStateChanged()
        notifySnapshotCommitted()
    }

    /**
     * The answer image: every stroke and the placed diagram, whatever is on screen right now,
     * at a fixed clarity and without the grid. Null for a blank canvas.
     */
    fun exportAnswerJpeg(): ByteArray? {
        val snapshot = snapshot()
        if (!snapshot.hasAnswerInk()) return null
        // A corrupt canvas (non-finite points) must not crash the practice page; nothing is saved.
        return runCatching {
            DraftSnapshotExport.jpeg(snapshot, backgroundBitmap.takeIf { snapshot.backgroundImage != null })
        }.getOrNull()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        invalidatePending = false
        initializeImageTransformIfNeeded()
        drawBackgroundLayer(canvas)
        drawCommittedStrokesLayer(canvas)
        canvas.save()
        canvas.translate(transform.viewport.offsetX, transform.viewport.offsetY)
        canvas.scale(transform.viewport.scale, transform.viewport.scale)
        drawEraserPreview(canvas)
        canvas.restore()
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        parent?.requestDisallowInterceptTouchEvent(true)
        motionPredictor.record(event)
        val pointerIndex = event.actionIndex.coerceIn(0, event.pointerCount - 1)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                activePointerId = event.getPointerId(pointerIndex)
                activeToolType = event.getToolType(pointerIndex)
                activeGesture = resolveSinglePointerGesture(event, pointerIndex)
                when (activeGesture) {
                    ActiveGesture.ImageDrag -> {
                        lastGestureFocusX = event.getX(pointerIndex)
                        lastGestureFocusY = event.getY(pointerIndex)
                    }
                    ActiveGesture.Erase -> {
                        val point = updateEraserPreview(event.getX(pointerIndex), event.getY(pointerIndex))
                        eraseAt(point.x, point.y)
                        scheduleInvalidate()
                    }
                    ActiveGesture.Stroke -> beginStroke(event, pointerIndex)
                    else -> Unit
                }
                return true
            }
            MotionEvent.ACTION_POINTER_DOWN -> {
                val newPointerToolType = event.getToolType(pointerIndex)
                if (isDrawingGesture(activeGesture) && isStylusTool(activeToolType) && !isStylusTool(newPointerToolType)) {
                    return true
                }
                if (isDrawingGesture(activeGesture)) {
                    return true
                }
                if (isStylusTool(newPointerToolType)) {
                    activePointerId = event.getPointerId(pointerIndex)
                    activeToolType = newPointerToolType
                    activeGesture = resolveSinglePointerGesture(event, pointerIndex)
                    when (activeGesture) {
                        ActiveGesture.Erase -> {
                            val point = updateEraserPreview(event.getX(pointerIndex), event.getY(pointerIndex))
                            eraseAt(point.x, point.y)
                        }
                        ActiveGesture.Stroke -> beginStroke(event, pointerIndex)
                        else -> Unit
                    }
                    scheduleInvalidate()
                    return true
                }
                activeGesture = resolveMultiPointerGesture(event)
                updateGestureAnchors(event)
                eraserPreviewPoint = null
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                val activeIndex = activePointerIndex(event)
                when (activeGesture) {
                    ActiveGesture.ImageTransform -> if (event.pointerCount >= 2) updateImageTransformGesture(event)
                    ActiveGesture.ViewportTransform -> if (event.pointerCount >= 2) updateViewportGesture(event)
                    ActiveGesture.ImageDrag -> dragImage(event, activeIndex)
                    ActiveGesture.Erase -> {
                        addHistoricalErasePoints(event, activeIndex)
                        val point = updateEraserPreview(event.getX(activeIndex), event.getY(activeIndex))
                        eraseAt(point.x, point.y)
                        scheduleInvalidate()
                    }
                    ActiveGesture.Stroke -> extendStroke(event)
                    ActiveGesture.None -> Unit
                }
                return true
            }
            MotionEvent.ACTION_POINTER_UP -> {
                val completedGesture = activeGesture
                if (event.getPointerId(pointerIndex) == activePointerId) {
                    val activeIndex = activePointerIndex(event)
                    when (activeGesture) {
                        ActiveGesture.Erase -> {
                            val point = updateEraserPreview(event.getX(activeIndex), event.getY(activeIndex))
                            eraseAt(point.x, point.y)
                            commitEraserGesture()
                        }
                        ActiveGesture.Stroke -> finishStroke(event)
                        else -> Unit
                    }
                    activeGesture = ActiveGesture.None
                    activePointerId = MotionEvent.INVALID_POINTER_ID
                    activeToolType = MotionEvent.TOOL_TYPE_UNKNOWN
                    eraserPreviewPoint = null
                    scheduleInvalidate()
                    if (completedGesture.commitsTransformOnEnd()) notifySnapshotCommitted()
                    return true
                }
                val nextGesture = draftCanvasGestureAfterPointerUp(
                    activeGesture = activeGesture.toGestureKind(),
                    liftedPointerWasActive = false,
                    remainingPointerCount = event.pointerCount - 1,
                ).toActiveGesture()
                if (nextGesture == ActiveGesture.None) {
                    activeGesture = ActiveGesture.None
                    lastGestureSpan = 0f
                    eraserPreviewPoint = null
                    scheduleInvalidate()
                    if (completedGesture.commitsTransformOnEnd()) notifySnapshotCommitted()
                    return true
                }
                updateGestureAnchors(event)
                return true
            }
            MotionEvent.ACTION_UP -> {
                val completedGesture = activeGesture
                val activeIndex = activePointerIndex(event)
                when (activeGesture) {
                    ActiveGesture.Erase -> {
                        val point = updateEraserPreview(event.getX(activeIndex), event.getY(activeIndex))
                        eraseAt(point.x, point.y)
                        commitEraserGesture()
                    }
                    ActiveGesture.Stroke -> finishStroke(event)
                    else -> Unit
                }
                activeGesture = ActiveGesture.None
                activePointerId = MotionEvent.INVALID_POINTER_ID
                activeToolType = MotionEvent.TOOL_TYPE_UNKNOWN
                eraserPreviewPoint = null
                parent?.requestDisallowInterceptTouchEvent(false)
                scheduleInvalidate()
                if (completedGesture.commitsTransformOnEnd()) notifySnapshotCommitted()
                return true
            }
            MotionEvent.ACTION_CANCEL -> {
                val completedGesture = activeGesture
                if (activeGesture == ActiveGesture.Erase) {
                    commitEraserGesture()
                }
                if (activeGesture == ActiveGesture.Stroke) {
                    cancelStroke(event)
                }
                activeGesture = ActiveGesture.None
                activePointerId = MotionEvent.INVALID_POINTER_ID
                activeToolType = MotionEvent.TOOL_TYPE_UNKNOWN
                eraserPreviewPoint = null
                parent?.requestDisallowInterceptTouchEvent(false)
                scheduleInvalidate()
                if (completedGesture.commitsTransformOnEnd()) notifySnapshotCommitted()
                return true
            }
        }
        return true
    }

    override fun onHoverEvent(event: MotionEvent): Boolean {
        val pointerIndex = event.actionIndex.coerceIn(0, event.pointerCount - 1)
        if (!isStylusTool(event.getToolType(pointerIndex))) return super.onHoverEvent(event)
        when (event.actionMasked) {
            MotionEvent.ACTION_HOVER_ENTER,
            MotionEvent.ACTION_HOVER_MOVE -> {
                val eraserHover = event.getToolType(pointerIndex) == MotionEvent.TOOL_TYPE_ERASER ||
                    event.buttonState and StylusEraserButtons != 0 ||
                    tool == DraftTool.Eraser
                eraserPreviewPoint = if (eraserHover) {
                    transform.screenToWorld(event.getX(pointerIndex), event.getY(pointerIndex))
                } else {
                    null
                }
                scheduleInvalidate()
            }
            MotionEvent.ACTION_HOVER_EXIT -> {
                eraserPreviewPoint = null
                scheduleInvalidate()
            }
        }
        return true
    }

    private fun activePointerIndex(event: MotionEvent): Int {
        val pointerId = activePointerId
        if (pointerId != MotionEvent.INVALID_POINTER_ID) {
            val index = event.findPointerIndex(pointerId)
            if (index >= 0) return index
        }
        return event.actionIndex.coerceIn(0, event.pointerCount - 1)
    }

    private fun isDrawingGesture(gesture: ActiveGesture): Boolean {
        return gesture == ActiveGesture.Stroke || gesture == ActiveGesture.Erase
    }

    private fun isStylusTool(toolType: Int): Boolean {
        return toolType == MotionEvent.TOOL_TYPE_STYLUS || toolType == MotionEvent.TOOL_TYPE_ERASER
    }

    private fun updateEraserPreview(screenX: Float, screenY: Float): DraftPointF {
        return transform.screenToWorld(screenX, screenY).also {
            eraserPreviewPoint = it
        }
    }

    private fun resolveSinglePointerGesture(event: MotionEvent, pointerIndex: Int): ActiveGesture {
        return resolveDraftSinglePointerGesture(
            selectedTool = tool,
            pointerKind = event.getToolType(pointerIndex).toDraftPointerKind(),
            stylusButtonPressed = event.buttonState and StylusEraserButtons != 0,
            fingerWritingEnabled = fingerWritingEnabled,
            hasBackgroundImage = backgroundBitmap != null,
        ).toActiveGesture()
    }

    private fun resolveMultiPointerGesture(event: MotionEvent): ActiveGesture {
        val bitmap = backgroundBitmap ?: return ActiveGesture.ViewportTransform
        val focus = gestureFocus(event)
        val point = transform.screenToWorld(focus.x, focus.y)
        return if (transform.containsImagePoint(point.x, point.y, bitmap.width.toFloat(), bitmap.height.toFloat())) {
            ActiveGesture.ImageTransform
        } else {
            ActiveGesture.ViewportTransform
        }
    }

    private fun dragImage(event: MotionEvent, pointerIndex: Int) {
        transform = transform.dragImage(
            screenDx = event.getX(pointerIndex) - lastGestureFocusX,
            screenDy = event.getY(pointerIndex) - lastGestureFocusY,
        )
        backgroundLayerDirty = true
        lastGestureFocusX = event.getX(pointerIndex)
        lastGestureFocusY = event.getY(pointerIndex)
        scheduleInvalidate()
    }

    private fun updateViewportGesture(event: MotionEvent) {
        val focus = gestureFocus(event)
        val span = gestureSpan(event, focus)
        if (lastGestureSpan > 0f && span > 0f) {
            transform = transform
                .panViewport(focus.x - lastGestureFocusX, focus.y - lastGestureFocusY)
                .zoomViewport(span / lastGestureSpan, focus.x, focus.y)
            backgroundLayerDirty = true
            committedStrokesLayerDirty = true
        }
        lastGestureFocusX = focus.x
        lastGestureFocusY = focus.y
        lastGestureSpan = span
        scheduleInvalidate()
    }

    private fun updateImageTransformGesture(event: MotionEvent) {
        val bitmap = backgroundBitmap ?: return
        val focus = gestureFocus(event)
        val span = gestureSpan(event, focus)
        if (lastGestureSpan > 0f && span > 0f) {
            transform = transform
                .dragImage(focus.x - lastGestureFocusX, focus.y - lastGestureFocusY)
                .scaleImage(span / lastGestureSpan, bitmap.width.toFloat(), bitmap.height.toFloat())
            backgroundLayerDirty = true
        }
        lastGestureFocusX = focus.x
        lastGestureFocusY = focus.y
        lastGestureSpan = span
        scheduleInvalidate()
    }

    private fun updateGestureAnchors(event: MotionEvent) {
        val focus = gestureFocus(event)
        lastGestureFocusX = focus.x
        lastGestureFocusY = focus.y
        lastGestureSpan = gestureSpan(event, focus)
    }

    private fun gestureFocus(event: MotionEvent): DraftPointF {
        var x = 0f
        var y = 0f
        for (i in 0 until event.pointerCount) {
            x += event.getX(i)
            y += event.getY(i)
        }
        return DraftPointF(x / event.pointerCount, y / event.pointerCount)
    }

    private fun gestureSpan(event: MotionEvent, focus: DraftPointF): Float {
        var total = 0f
        for (i in 0 until event.pointerCount) {
            total += hypot(event.getX(i) - focus.x, event.getY(i) - focus.y)
        }
        return total / event.pointerCount
    }

    private fun initializeImageTransformIfNeeded() {
        val bitmap = backgroundBitmap ?: return
        if (imageTransformInitialized || width <= 0 || height <= 0) return
        transform = DraftCanvasTransform.initialForImage(
            viewWidth = width.toFloat(),
            viewHeight = height.toFloat(),
            imageWidth = bitmap.width.toFloat(),
            imageHeight = bitmap.height.toFloat(),
        )
        backgroundLayerDirty = true
        committedStrokesLayerDirty = true
        imageTransformInitialized = true
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        val sourceWidth = restoredCanvasWidth.takeIf { it > 0 } ?: oldw
        val sourceHeight = restoredCanvasHeight.takeIf { it > 0 } ?: oldh
        if (sourceWidth > 0 && sourceHeight > 0) {
            transform = adaptDraftTransformToCanvas(transform, sourceWidth, sourceHeight, w, h)
            restoredCanvasWidth = 0
            restoredCanvasHeight = 0
        }
        initializeImageTransformIfNeeded()
        backgroundLayerDirty = true
        committedStrokesLayerDirty = true
    }

    private fun beginStroke(event: MotionEvent, pointerIndex: Int) {
        // Ink hands a finished stroke over a few frames after the pen lifts, so with quick
        // writing the earlier strokes are often still waiting here. Only an unfinished stroke
        // is dropped; the waiting ones must survive, or they vanish when the next one starts.
        activeInkStrokeId?.let { cancelInkStroke(it, event) }
        activeInkStrokeId = null
        requestUnbufferedDispatch(event)
        val canvasWidth = penWidthPx / transform.viewport.scale
        val inkId = runCatching {
            inkView.startStroke(
                event = event,
                pointerId = event.getPointerId(pointerIndex),
                brush = DraftInk.brush(penColor, canvasWidth),
                motionEventToWorldTransform = screenToWorldMatrix(),
            )
        }.getOrNull() ?: return
        currentStrokeId += 1
        pendingInkStrokes[inkId] = PendingInkStroke(
            id = currentStrokeId,
            colorArgb = penColor,
            widthPx = penWidthPx,
            // Fixed in canvas units now: written zoomed in, it must not grow when zoomed out.
            canvasWidth = canvasWidth,
            startTimeMs = event.eventTime,
        )
        activeInkStrokeId = inkId
    }

    private fun extendStroke(event: MotionEvent) {
        val inkId = activeInkStrokeId ?: return
        if (event.findPointerIndex(activePointerId) < 0) return
        val prediction = motionPredictor.predict()
        try {
            inkView.addToStroke(event, activePointerId, inkId, prediction)
        } catch (_: RuntimeException) {
            // A malformed event must not end the session; the stroke keeps what it has.
        } finally {
            prediction?.recycle()
        }
    }

    private fun finishStroke(event: MotionEvent) {
        val inkId = activeInkStrokeId ?: return
        activeInkStrokeId = null
        if (event.findPointerIndex(activePointerId) < 0) {
            cancelInkStroke(inkId, event)
            return
        }
        runCatching { inkView.finishStroke(event, activePointerId, inkId) }
            .onFailure { cancelInkStroke(inkId, event) }
    }

    private fun cancelStroke(event: MotionEvent) {
        val inkId = activeInkStrokeId ?: return
        activeInkStrokeId = null
        cancelInkStroke(inkId, event)
    }

    private fun cancelInkStroke(inkId: InProgressStrokeId, event: MotionEvent?) {
        pendingInkStrokes.remove(inkId)
        runCatching { inkView.cancelStroke(inkId, event) }
    }

    /** Drop a stroke still being written, e.g. when the canvas switches to another question. */
    private fun discardInkInProgress() {
        activeInkStrokeId = null
        pendingInkStrokes.clear()
        inkView.cancelUnfinishedStrokes()
        val finished = inkView.getFinishedStrokes().keys
        if (finished.isNotEmpty()) inkView.removeFinishedStrokes(finished)
    }

    /**
     * Ink hands over each stroke after the pen lifts. Store it, draw it into our stroke layer and
     * remove it from Ink's layer in the same frame, so it never flickers or doubles.
     */
    private fun handleFinishedInkStrokes(finished: Map<InProgressStrokeId, Stroke>) {
        var added = false
        finished.forEach { (inkId, inkStroke) ->
            val pending = pendingInkStrokes.remove(inkId) ?: return@forEach
            val points = DraftInk.points(inkStroke, pending.startTimeMs)
            if (points.isEmpty()) return@forEach
            val stroke = DraftStroke(
                id = pending.id,
                colorArgb = pending.colorArgb,
                widthPx = pending.widthPx,
                points = points,
                canvasWidth = pending.canvasWidth,
            )
            strokes.add(stroke)
            undoStack.add(DraftOperation.AddStroke(stroke))
            redoStack.clear()
            inkStrokeCache[stroke.id] = stroke to inkStroke
            appendToCommittedStrokesLayer(stroke)
            added = true
        }
        inkView.removeFinishedStrokes(finished.keys)
        if (!added) return
        invalidate()
        notifyStateChanged()
        notifySnapshotCommitted()
    }

    private fun worldToScreenMatrix(): Matrix = Matrix().apply {
        setScale(transform.viewport.scale, transform.viewport.scale)
        postTranslate(transform.viewport.offsetX, transform.viewport.offsetY)
    }

    private fun screenToWorldMatrix(): Matrix = Matrix().also { worldToScreenMatrix().invert(it) }

    private fun addHistoricalErasePoints(event: MotionEvent, pointerIndex: Int) {
        for (i in 0 until event.historySize) {
            val point = transform.screenToWorld(
                event.getHistoricalX(pointerIndex, i),
                event.getHistoricalY(pointerIndex, i),
            )
            eraseAt(point.x, point.y)
        }
    }

    private fun eraseAt(x: Float, y: Float) {
        val radius = eraserRadiusPx / transform.viewport.scale
        val before = strokes.toList()
        val gestureReplacement = eraserGestureReplacement
            ?: DraftEraserGestureReplacement.start(before).also { eraserGestureReplacement = it }
        val after = mutableListOf<DraftStroke>()
        var changed = false

        before.forEach { stroke ->
            val splitStrokes = stroke.splitAroundEraser(x, y, radius)
            if (splitStrokes == null) {
                after.add(stroke)
            } else {
                changed = true
                after.addAll(splitStrokes)
            }
        }

        if (!changed) return
        strokes.clear()
        strokes.addAll(after)
        // Split pieces are new strokes; Ink geometry for them is rebuilt on the next draw.
        committedStrokesLayerDirty = true
        eraserGestureReplacement = gestureReplacement.record(after.toList())
        scheduleInvalidate()
        notifyStateChanged()
    }

    private fun commitEraserGesture() {
        val replacement = eraserGestureReplacement?.finish()
        eraserGestureReplacement = null
        if (replacement == null) return
        undoStack.add(DraftOperation.ReplaceStrokes(before = replacement.before, after = replacement.after))
        redoStack.clear()
        pruneInkStrokeCache()
        notifyStateChanged()
        notifySnapshotCommitted()
    }

    private fun DraftStroke.splitAroundEraser(x: Float, y: Float, radius: Float): List<DraftStroke>? {
        if (points.isEmpty()) return null
        var hit = false
        val segments = mutableListOf<List<DraftPoint>>()
        val current = mutableListOf<DraftPoint>()

        points.forEachIndexed { index, point ->
            val previous = points.getOrNull(index - 1)
            val pointHit = hypot(point.x - x, point.y - y) <= radius
            val segmentHit = previous != null && distanceToSegment(
                x = x,
                y = y,
                ax = previous.x,
                ay = previous.y,
                bx = point.x,
                by = point.y,
            ) <= radius

            if (pointHit || segmentHit) {
                hit = true
                if (current.size >= 2) {
                    segments.add(current.toList())
                }
                current.clear()
            } else {
                current.add(point)
            }
        }

        if (!hit) return null
        if (current.size >= 2) {
            segments.add(current.toList())
        }

        return segments.map { segment ->
            currentStrokeId += 1
            copy(id = currentStrokeId, points = segment)
        }
    }

    private fun distanceToSegment(
        x: Float,
        y: Float,
        ax: Float,
        ay: Float,
        bx: Float,
        by: Float,
    ): Float {
        val dx = bx - ax
        val dy = by - ay
        if (dx == 0f && dy == 0f) {
            return hypot(x - ax, y - ay)
        }
        val t = (((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)).coerceIn(0f, 1f)
        val closestX = ax + t * dx
        val closestY = ay + t * dy
        return hypot(x - closestX, y - closestY)
    }

    private fun drawBackgroundLayer(canvas: Canvas) {
        val layer = ensureLayer(backgroundLayer).also { backgroundLayer = it }
        if (backgroundLayerDirty) {
            layer.eraseColor(Color.TRANSPARENT)
            Canvas(layer).also { layerCanvas ->
                layerCanvas.save()
                layerCanvas.translate(transform.viewport.offsetX, transform.viewport.offsetY)
                layerCanvas.scale(transform.viewport.scale, transform.viewport.scale)
                drawBackground(layerCanvas)
                layerCanvas.restore()
            }
            backgroundLayerDirty = false
        }
        canvas.drawBitmap(layer, 0f, 0f, bitmapLayerPaint)
    }

    private fun drawCommittedStrokesLayer(canvas: Canvas) {
        val layer = ensureLayer(committedStrokesLayer).also { committedStrokesLayer = it }
        if (committedStrokesLayerDirty) {
            layer.eraseColor(Color.TRANSPARENT)
            val worldToScreen = worldToScreenMatrix()
            Canvas(layer).also { layerCanvas ->
                layerCanvas.concat(worldToScreen)
                strokes.forEach { drawStroke(layerCanvas, it, worldToScreen) }
            }
            committedStrokesLayerDirty = false
        }
        canvas.drawBitmap(layer, 0f, 0f, bitmapLayerPaint)
    }

    /** A new stroke only needs adding to the cached layer, not redrawing every stroke. */
    private fun appendToCommittedStrokesLayer(stroke: DraftStroke) {
        val layer = committedStrokesLayer
        if (committedStrokesLayerDirty || layer == null || layer.isRecycled || layer.width != width || layer.height != height) {
            committedStrokesLayerDirty = true
            return
        }
        val worldToScreen = worldToScreenMatrix()
        Canvas(layer).also { layerCanvas ->
            layerCanvas.concat(worldToScreen)
            drawStroke(layerCanvas, stroke, worldToScreen)
        }
    }

    private fun ensureLayer(existing: Bitmap?): Bitmap {
        val layerWidth = width.coerceAtLeast(1)
        val layerHeight = height.coerceAtLeast(1)
        if (
            existing != null &&
            shouldReuseDraftBitmapLayer(
                existingWidth = existing.width,
                existingHeight = existing.height,
                existingRecycled = existing.isRecycled,
                targetWidth = layerWidth,
                targetHeight = layerHeight,
            )
        ) {
            return existing
        }
        if (existing != null && !existing.isRecycled) {
            existing.recycle()
        }
        return Bitmap.createBitmap(layerWidth, layerHeight, Bitmap.Config.ARGB_8888)
    }

    override fun onDetachedFromWindow() {
        recycleBitmapLayers()
        super.onDetachedFromWindow()
    }

    private fun recycleBitmapLayers() {
        if (backgroundLayer?.isRecycled == false) {
            backgroundLayer?.recycle()
        }
        if (committedStrokesLayer?.isRecycled == false) {
            committedStrokesLayer?.recycle()
        }
        backgroundLayer = null
        committedStrokesLayer = null
        backgroundLayerDirty = true
        committedStrokesLayerDirty = true
    }

    private fun drawGrid(canvas: Canvas) {
        val step = 48f
        val left = ((-transform.viewport.offsetX / transform.viewport.scale) / step).toInt() * step - step
        val top = ((-transform.viewport.offsetY / transform.viewport.scale) / step).toInt() * step - step
        val right = left + width / transform.viewport.scale + step * 4
        val bottom = top + height / transform.viewport.scale + step * 4
        var x = left
        while (x < right) {
            canvas.drawLine(x, top, x, bottom, gridPaint)
            x += step
        }
        var y = top
        while (y < bottom) {
            canvas.drawLine(left, y, right, y, gridPaint)
            y += step
        }
    }

    private fun drawBackground(canvas: Canvas) {
        val bitmap = backgroundBitmap
        if (bitmap == null) {
            if (showGrid) drawGrid(canvas)
            return
        }
        drawGrid(canvas)
        canvas.drawBitmap(
            bitmap,
            null,
            RectF(
                transform.image.x,
                transform.image.y,
                transform.image.x + bitmap.width * transform.image.scale,
                transform.image.y + bitmap.height * transform.image.scale,
            ),
            bitmapLayerPaint,
        )
    }

    /** The canvas must already carry [worldToScreen]; Ink uses it to pick the level of detail. */
    private fun drawStroke(canvas: Canvas, stroke: DraftStroke, worldToScreen: Matrix) {
        val inkStroke = inkStrokeFor(stroke) ?: return
        inkRenderer.draw(canvas, inkStroke, worldToScreen)
    }

    private fun inkStrokeFor(stroke: DraftStroke): Stroke? {
        inkStrokeCache[stroke.id]?.takeIf { it.first === stroke }?.let { return it.second }
        val inkStroke = DraftInk.stroke(stroke, transform.viewport.scale) ?: return null
        inkStrokeCache[stroke.id] = stroke to inkStroke
        return inkStroke
    }

    /** Keep geometry only for strokes on the canvas; undo rebuilds anything else on demand. */
    private fun pruneInkStrokeCache() {
        val live = strokes.mapTo(HashSet()) { it.id }
        inkStrokeCache.keys.retainAll(live)
    }

    private fun drawEraserPreview(canvas: Canvas) {
        val point = eraserPreviewPoint ?: return
        val radius = eraserRadiusPx / transform.viewport.scale
        eraserPreviewStrokePaint.strokeWidth = 2f / transform.viewport.scale
        canvas.drawCircle(point.x, point.y, radius, eraserPreviewFillPaint)
        canvas.drawCircle(point.x, point.y, radius, eraserPreviewStrokePaint)
    }

    private fun scheduleInvalidate() {
        if (invalidatePending) return
        invalidatePending = true
        postInvalidateOnAnimation()
    }

    private fun Int.toDraftPointerKind(): DraftPointerKind = when (this) {
        MotionEvent.TOOL_TYPE_FINGER -> DraftPointerKind.Touch
        MotionEvent.TOOL_TYPE_STYLUS -> DraftPointerKind.Stylus
        MotionEvent.TOOL_TYPE_ERASER -> DraftPointerKind.StylusEraser
        MotionEvent.TOOL_TYPE_MOUSE -> DraftPointerKind.Mouse
        else -> DraftPointerKind.Other
    }

    private fun notifyStateChanged() {
        onStateChanged?.invoke(
            DraftCanvasInfo(
                strokeCount = strokes.size,
                canUndo = undoStack.isNotEmpty(),
                canRedo = redoStack.isNotEmpty(),
            ),
        )
    }

    private fun notifySnapshotCommitted() {
        onSnapshotCommitted?.invoke(snapshot())
    }

    private enum class ActiveGesture {
        None,
        Stroke,
        Erase,
        ImageDrag,
        ImageTransform,
        ViewportTransform,
    }

    private fun ActiveGesture.commitsTransformOnEnd(): Boolean =
        this == ActiveGesture.ImageDrag ||
            this == ActiveGesture.ImageTransform ||
            this == ActiveGesture.ViewportTransform

    private fun ActiveGesture.toGestureKind(): DraftCanvasGestureKind = when (this) {
        ActiveGesture.None -> DraftCanvasGestureKind.None
        ActiveGesture.Stroke -> DraftCanvasGestureKind.Stroke
        ActiveGesture.Erase -> DraftCanvasGestureKind.Erase
        ActiveGesture.ImageDrag -> DraftCanvasGestureKind.ImageDrag
        ActiveGesture.ImageTransform -> DraftCanvasGestureKind.ImageTransform
        ActiveGesture.ViewportTransform -> DraftCanvasGestureKind.ViewportTransform
    }

    private fun DraftCanvasGestureKind.toActiveGesture(): ActiveGesture = when (this) {
        DraftCanvasGestureKind.None -> ActiveGesture.None
        DraftCanvasGestureKind.Stroke -> ActiveGesture.Stroke
        DraftCanvasGestureKind.Erase -> ActiveGesture.Erase
        DraftCanvasGestureKind.ImageDrag -> ActiveGesture.ImageDrag
        DraftCanvasGestureKind.ImageTransform -> ActiveGesture.ImageTransform
        DraftCanvasGestureKind.ViewportTransform -> ActiveGesture.ViewportTransform
    }

    private sealed interface DraftOperation {
        data class AddStroke(val stroke: DraftStroke) : DraftOperation
        data class RemoveStrokes(val items: List<RemovedStroke>) : DraftOperation
        data class ReplaceStrokes(val before: List<DraftStroke>, val after: List<DraftStroke>) : DraftOperation
    }

    private companion object {
        val StylusEraserButtons = MotionEvent.BUTTON_STYLUS_PRIMARY or MotionEvent.BUTTON_STYLUS_SECONDARY
    }

    private data class RemovedStroke(val index: Int, val stroke: DraftStroke)

    private data class PendingInkStroke(
        val id: Long,
        val colorArgb: Int,
        val widthPx: Float,
        val canvasWidth: Float,
        val startTimeMs: Long,
    )
}
