package cn.openphysics.androidapp.ui.screens

import android.graphics.Bitmap
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ClipOp
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlin.math.abs

/** A crop box in image fractions (0–1), as on iOS: the student drags it to the worked area. */
data class AnswerCropRect(val left: Float, val top: Float, val right: Float, val bottom: Float) {
    val width: Float get() = right - left
    val height: Float get() = bottom - top

    companion object {
        /** iOS starts just inside the edges, so the first drag is small. */
        val Initial = AnswerCropRect(0.06f, 0.06f, 0.94f, 0.94f)
        const val MIN_SIZE = 0.1f
    }
}

/** What a drag holds: a corner or edge resizes, the inside moves the whole box. */
enum class AnswerCropHandle { TopLeft, Top, TopRight, Right, BottomRight, Bottom, BottomLeft, Left, Move, None }

/** The handle under a touch at ([x], [y]) in image fractions; [tolerance] is how close counts as on an edge. */
fun answerCropHandleAt(crop: AnswerCropRect, x: Float, y: Float, toleranceX: Float, toleranceY: Float): AnswerCropHandle {
    val nearLeft = abs(x - crop.left) <= toleranceX
    val nearRight = abs(x - crop.right) <= toleranceX
    val nearTop = abs(y - crop.top) <= toleranceY
    val nearBottom = abs(y - crop.bottom) <= toleranceY
    val withinX = x >= crop.left - toleranceX && x <= crop.right + toleranceX
    val withinY = y >= crop.top - toleranceY && y <= crop.bottom + toleranceY
    return when {
        nearTop && nearLeft -> AnswerCropHandle.TopLeft
        nearTop && nearRight -> AnswerCropHandle.TopRight
        nearBottom && nearRight -> AnswerCropHandle.BottomRight
        nearBottom && nearLeft -> AnswerCropHandle.BottomLeft
        nearTop && withinX -> AnswerCropHandle.Top
        nearBottom && withinX -> AnswerCropHandle.Bottom
        nearLeft && withinY -> AnswerCropHandle.Left
        nearRight && withinY -> AnswerCropHandle.Right
        x > crop.left && x < crop.right && y > crop.top && y < crop.bottom -> AnswerCropHandle.Move
        else -> AnswerCropHandle.None
    }
}

/** Moves [handle] by ([dx], [dy]) image fractions, keeping the box inside the photo and not smaller than MIN_SIZE. */
fun adjustAnswerCrop(crop: AnswerCropRect, handle: AnswerCropHandle, dx: Float, dy: Float): AnswerCropRect {
    val min = AnswerCropRect.MIN_SIZE
    if (handle == AnswerCropHandle.Move) {
        val moveX = dx.coerceIn(-crop.left, 1f - crop.right)
        val moveY = dy.coerceIn(-crop.top, 1f - crop.bottom)
        return AnswerCropRect(crop.left + moveX, crop.top + moveY, crop.right + moveX, crop.bottom + moveY)
    }
    var (left, top, right, bottom) = crop
    if (handle in setOf(AnswerCropHandle.TopLeft, AnswerCropHandle.Left, AnswerCropHandle.BottomLeft)) {
        left = (left + dx).coerceIn(0f, right - min)
    }
    if (handle in setOf(AnswerCropHandle.TopRight, AnswerCropHandle.Right, AnswerCropHandle.BottomRight)) {
        right = (right + dx).coerceIn(left + min, 1f)
    }
    if (handle in setOf(AnswerCropHandle.TopLeft, AnswerCropHandle.Top, AnswerCropHandle.TopRight)) {
        top = (top + dy).coerceIn(0f, bottom - min)
    }
    if (handle in setOf(AnswerCropHandle.BottomLeft, AnswerCropHandle.Bottom, AnswerCropHandle.BottomRight)) {
        bottom = (bottom + dy).coerceIn(top + min, 1f)
    }
    return AnswerCropRect(left, top, right, bottom)
}

/** Full-screen crop to the worked area, matching iOS: drag corners or edges, drag inside to move. */
@Composable
fun AnswerPhotoCropDialog(
    bitmap: Bitmap,
    onCancel: () -> Unit,
    onDone: (AnswerCropRect) -> Unit,
) {
    var crop by remember(bitmap) { mutableStateOf(AnswerCropRect.Initial) }
    Dialog(onDismissRequest = onCancel, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(Color.Black).systemBarsPadding()) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(onClick = onCancel) { Text("取消", color = Color.White) }
                Text(
                    "裁剪到做题区域",
                    Modifier.weight(1f),
                    color = Color.White,
                    fontWeight = FontWeight.SemiBold,
                    textAlign = TextAlign.Center,
                )
                TextButton(onClick = { crop = AnswerCropRect.Initial }, enabled = crop != AnswerCropRect.Initial) {
                    Text("重置选框", color = if (crop != AnswerCropRect.Initial) Color.White else Color.Gray)
                }
                TextButton(onClick = { onDone(crop) }) { Text("完成", color = Color.White, fontWeight = FontWeight.Bold) }
            }
            BoxWithConstraints(Modifier.fillMaxWidth().weight(1f).padding(20.dp), contentAlignment = Alignment.Center) {
                val density = LocalDensity.current
                val areaW = with(density) { maxWidth.toPx() }
                val areaH = with(density) { maxHeight.toPx() }
                val aspect = bitmap.width.toFloat() / bitmap.height.toFloat()
                val imageW = if (areaW / areaH > aspect) areaH * aspect else areaW
                val imageH = imageW / aspect
                val tolerance = with(density) { 28.dp.toPx() }
                var handle by remember { mutableStateOf(AnswerCropHandle.None) }
                Box(
                    Modifier
                        .size(with(density) { imageW.toDp() }, with(density) { imageH.toDp() })
                        .semantics { contentDescription = "裁剪框，拖动四角或四边调整大小，拖动框内移动位置" }
                        .pointerInput(bitmap, imageW, imageH) {
                            detectDragGestures(
                                onDragStart = { start ->
                                    handle = answerCropHandleAt(
                                        crop, start.x / imageW, start.y / imageH, tolerance / imageW, tolerance / imageH,
                                    )
                                },
                                onDragEnd = { handle = AnswerCropHandle.None },
                                onDragCancel = { handle = AnswerCropHandle.None },
                            ) { change, drag ->
                                if (handle != AnswerCropHandle.None) {
                                    change.consume()
                                    crop = adjustAnswerCrop(crop, handle, drag.x / imageW, drag.y / imageH)
                                }
                            }
                        },
                ) {
                    Image(bitmap.asImageBitmap(), "待裁剪的作答图片", Modifier.fillMaxSize(), contentScale = ContentScale.FillBounds)
                    Canvas(Modifier.fillMaxSize()) {
                        val box = Rect(
                            crop.left * size.width, crop.top * size.height,
                            crop.right * size.width, crop.bottom * size.height,
                        )
                        clipRect(box.left, box.top, box.right, box.bottom, clipOp = ClipOp.Difference) {
                            drawRect(Color.Black.copy(alpha = 0.55f))
                        }
                        // A dark rim under the white lines keeps the box visible on white paper.
                        val rim = Color.Black.copy(alpha = 0.6f)
                        drawRect(rim, box.topLeft, box.size, style = Stroke(width = 4.dp.toPx()))
                        drawRect(Color.White, box.topLeft, box.size, style = Stroke(width = 2.dp.toPx()))
                        val arm = 22.dp.toPx()
                        listOf(box.topLeft, box.topRight, box.bottomLeft, box.bottomRight).forEach { corner ->
                            val sx = if (corner.x == box.left) 1f else -1f
                            val sy = if (corner.y == box.top) 1f else -1f
                            listOf(rim to 7.dp.toPx(), Color.White to 4.dp.toPx()).forEach { (color, width) ->
                                drawLine(color, corner, Offset(corner.x + sx * arm, corner.y), width)
                                drawLine(color, corner, Offset(corner.x, corner.y + sy * arm), width)
                            }
                        }
                    }
                }
            }
            Text(
                "拖动四角或四边调整选框，拖动框内移动位置。",
                // Clear of the gesture bar, which a dialog window does not pad for.
                Modifier.fillMaxWidth().padding(bottom = 40.dp),
                color = Color.White.copy(alpha = 0.75f),
                textAlign = TextAlign.Center,
            )
        }
    }
}
