package cn.openphysics.androidapp.ui.draft

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import androidx.ink.rendering.android.canvas.CanvasStrokeRenderer
import java.io.ByteArrayOutputStream
import java.net.URL
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

internal fun DraftCanvasSnapshot.hasAnswerInk(): Boolean = strokes.any { it.points.isNotEmpty() }

internal data class DraftExportBounds(val left: Float, val top: Float, val right: Float, val bottom: Float) {
    val width: Float get() = right - left
    val height: Float get() = bottom - top
}

/** Include all strokes and the selected diagram, even after panning away from them. */
internal fun draftExportBounds(snapshot: DraftCanvasSnapshot): DraftExportBounds {
    require(snapshot.hasAnswerInk()) { "画布为空，请先作答" }
    val viewportScale = snapshot.transform.viewport.scale
    require(viewportScale.isFinite() && viewportScale > 0f)
    var left = Float.POSITIVE_INFINITY
    var top = Float.POSITIVE_INFINITY
    var right = Float.NEGATIVE_INFINITY
    var bottom = Float.NEGATIVE_INFINITY
    fun include(x: Float, y: Float) {
        require(x.isFinite() && y.isFinite()) { "手写坐标异常，请重新打开本题后重试" }
        left = min(left, x); top = min(top, y)
        right = max(right, x); bottom = max(bottom, y)
    }
    snapshot.strokes.forEach { stroke ->
        val margin = max(24f / viewportScale, stroke.canvasWidthAt(viewportScale) * 2f)
        stroke.points.forEach { point ->
            include(point.x - margin, point.y - margin)
            include(point.x + margin, point.y + margin)
        }
    }
    snapshot.backgroundImage?.let {
        require(it.naturalWidth > 0 && it.naturalHeight > 0 && it.scale > 0f)
        include(it.x, it.y)
        include(it.x + it.naturalWidth * it.scale, it.y + it.naturalHeight * it.scale)
    }
    return DraftExportBounds(left, top, right, bottom).also {
        require(it.width.isFinite() && it.height.isFinite() && it.width > 0f && it.height > 0f)
    }
}

/** At least two pixels per canvas unit (sharper when written zoomed in), longest side at most 2048. */
internal fun draftExportScale(snapshot: DraftCanvasSnapshot, bounds: DraftExportBounds): Float =
    min(max(DraftExportMinPixelsPerUnit, snapshot.transform.viewport.scale), DraftExportMaxSidePx / max(bounds.width, bounds.height))

private const val DraftExportMinPixelsPerUnit = 2f
private const val DraftExportMaxSidePx = 2048f

internal object DraftSnapshotExport {
    fun jpeg(snapshot: DraftCanvasSnapshot, background: Bitmap? = null): ByteArray {
        check(snapshot.backgroundImage == null || background != null) { "题图加载失败，手写答案尚未提交，请重试" }
        val bounds = draftExportBounds(snapshot)
        // Clarity no longer depends on how far the student zoomed out before submitting.
        val scale = draftExportScale(snapshot, bounds)
        val bitmap = Bitmap.createBitmap(
            ceil(bounds.width * scale).toInt().coerceAtLeast(1),
            ceil(bounds.height * scale).toInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888,
        )
        return try {
            val canvas = Canvas(bitmap)
            canvas.drawColor(Color.WHITE)
            canvas.scale(scale, scale)
            canvas.translate(-bounds.left, -bounds.top)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
            snapshot.backgroundImage?.let { metadata ->
                canvas.drawBitmap(checkNotNull(background), null, RectF(
                    metadata.x, metadata.y,
                    metadata.x + metadata.naturalWidth * metadata.scale,
                    metadata.y + metadata.naturalHeight * metadata.scale,
                ), paint)
            }
            // Same Ink pen as on screen, so the answer image looks like what the student wrote.
            val renderer = CanvasStrokeRenderer.create()
            val strokeToBitmap = Matrix().apply {
                setScale(scale, scale)
                preTranslate(-bounds.left, -bounds.top)
            }
            snapshot.strokes.forEach { stroke ->
                DraftInk.stroke(stroke, snapshot.transform.viewport.scale)?.let { inkStroke ->
                    renderer.draw(canvas, inkStroke, strokeToBitmap)
                }
            }
            ByteArrayOutputStream().use { output ->
                check(bitmap.compress(Bitmap.CompressFormat.JPEG, 92, output)) { "无法生成手写作答图片" }
                output.toByteArray()
            }
        } finally {
            bitmap.recycle()
        }
    }

    fun loadBackground(url: String): Bitmap {
        val connection = URL(url).openConnection().apply { connectTimeout = 15_000; readTimeout = 15_000 }
        val bytes = connection.getInputStream().use { input ->
            ByteArrayOutputStream().use { output ->
                val buffer = ByteArray(8192)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    check(output.size() + read <= 12 * 1024 * 1024) { "题图过大，无法准备手写图片" }
                    output.write(buffer, 0, read)
                }
                output.toByteArray()
            }
        }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        val options = BitmapFactory.Options().apply {
            inSampleSize = 1
            while (max(bounds.outWidth, bounds.outHeight) / inSampleSize > 2048) inSampleSize *= 2
        }
        return checkNotNull(BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)) { "题图加载失败，请重试" }
    }
}
