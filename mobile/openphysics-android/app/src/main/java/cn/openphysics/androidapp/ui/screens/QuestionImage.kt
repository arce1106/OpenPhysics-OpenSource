package cn.openphysics.androidapp.ui.screens

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import cn.openphysics.androidapp.domain.QuestionImage
import cn.openphysics.androidapp.ui.design.OpenPhysicsColors
import cn.openphysics.androidapp.ui.design.OpenPhysicsRadius
import cn.openphysics.androidapp.ui.draft.DraftCanvasSnapshot
import cn.openphysics.androidapp.ui.draft.DraftCanvasView
import cn.openphysics.androidapp.ui.draft.DraftPenWidths
import cn.openphysics.androidapp.ui.draft.DraftTool
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.URL

@Composable
fun QuestionImageBlock(
    image: QuestionImage,
    annotationKey: String = "",
    annotationSnapshots: MutableMap<String, DraftCanvasSnapshot>? = null,
    maxImageHeight: Dp = 240.dp,
) {
    var state by remember(image.imageUrl) { mutableStateOf<ImageLoadState>(ImageLoadState.Loading) }
    var previewOpen by remember(image.imageUrl) { mutableStateOf(false) }
    var annotationOpen by remember(image.imageUrl) { mutableStateOf(false) }
    val hasAnnotation = annotationKey.isNotBlank() && annotationSnapshots?.get(annotationKey)?.strokes?.isNotEmpty() == true

    LaunchedEffect(image.imageUrl) {
        state = ImageLoadState.Loading
        state = withContext(Dispatchers.IO) {
            try {
                URL(image.imageUrl).openStream().use { stream ->
                    val bitmap = BitmapFactory.decodeStream(stream)
                    if (bitmap == null) ImageLoadState.Error else ImageLoadState.Ready(bitmap.asImageBitmap())
                }
            } catch (_: Exception) {
                ImageLoadState.Error
            }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 4.dp)
            .background(Color(0xFFF2F5F7), RoundedCornerShape(8.dp))
            .clickable(enabled = state is ImageLoadState.Ready) { previewOpen = true }
            .padding(6.dp),
        contentAlignment = Alignment.Center,
    ) {
        when (val current = state) {
            ImageLoadState.Loading -> CircularProgressIndicator()
            ImageLoadState.Error -> Text("图片加载失败")
            is ImageLoadState.Ready -> {
                Image(
                    bitmap = current.bitmap,
                    contentDescription = image.description.ifBlank { "题目图片" },
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = maxImageHeight),
                    contentScale = ContentScale.Fit,
                )
                if (annotationKey.isNotBlank() && annotationSnapshots != null) {
                    OutlinedButton(
                        onClick = { annotationOpen = true },
                        modifier = Modifier.align(Alignment.TopEnd),
                        shape = RoundedCornerShape(OpenPhysicsRadius.Pill),
                        colors = ButtonDefaults.outlinedButtonColors(
                            containerColor = OpenPhysicsColors.Surface,
                            contentColor = OpenPhysicsColors.PrimaryDeep,
                        ),
                    ) {
                        Text(if (hasAnnotation) "已批注" else "批注")
                    }
                }
            }
        }
    }

    val ready = state as? ImageLoadState.Ready
    if (previewOpen && ready != null) {
        ImagePreviewDialog(
            bitmap = ready.bitmap,
            description = image.description.ifBlank { "题目图片" },
            onDismiss = { previewOpen = false },
        )
    }
    if (annotationOpen && ready != null && annotationKey.isNotBlank() && annotationSnapshots != null) {
        ImageAnnotationDialog(
            bitmap = ready.bitmap,
            description = image.description.ifBlank { "题目图片" },
            annotationKey = annotationKey,
            annotationSnapshots = annotationSnapshots,
            onDismiss = { annotationOpen = false },
        )
    }
}

@Composable
fun QuestionImageList(
    images: List<QuestionImage>,
    annotationPrefix: String = "",
    annotationSnapshots: MutableMap<String, DraftCanvasSnapshot>? = null,
    maxImageHeight: Dp = 240.dp,
) {
    if (images.isNotEmpty()) {
        Column(
            modifier = Modifier.padding(top = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            images.forEach { image ->
                QuestionImageBlock(
                    image = image,
                    annotationKey = annotationPrefix.takeIf { it.isNotBlank() }?.let { "$it:${image.id}:${image.imagePath}" }.orEmpty(),
                    annotationSnapshots = annotationSnapshots,
                    maxImageHeight = maxImageHeight,
                )
            }
        }
    }
}

private sealed interface ImageLoadState {
    data object Loading : ImageLoadState
    data object Error : ImageLoadState
    data class Ready(val bitmap: ImageBitmap) : ImageLoadState
}

enum class ImagePreviewTapTarget {
    Backdrop,
    ImageContent,
}

fun shouldDismissImagePreview(target: ImagePreviewTapTarget): Boolean {
    return target == ImagePreviewTapTarget.Backdrop
}

@Composable
private fun ImageAnnotationDialog(
    bitmap: ImageBitmap,
    description: String,
    annotationKey: String,
    annotationSnapshots: MutableMap<String, DraftCanvasSnapshot>,
    onDismiss: () -> Unit,
) {
    val density = LocalDensity.current
    var canvasView by remember(annotationKey) { mutableStateOf<DraftCanvasView?>(null) }
    var tool by remember(annotationKey) { mutableStateOf(DraftTool.Pen) }
    var penWidth by remember(annotationKey) { mutableStateOf(DraftPenWidths.DefaultDp.dp) }
    var eraserSize by remember(annotationKey) { mutableStateOf(26.dp) }

    fun persist() {
        canvasView?.let { annotationSnapshots[annotationKey] = it.snapshot() }
    }

    DisposableEffect(annotationKey, canvasView) {
        onDispose { persist() }
    }

    Dialog(
        onDismissRequest = {
            persist()
            onDismiss()
        },
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(Color(0xF8FFFFFF))
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                AnnotationButton("笔", selected = tool == DraftTool.Pen, modifier = Modifier.weight(1f)) {
                    tool = DraftTool.Pen
                    canvasView?.setTool(tool)
                }
                AnnotationButton("擦", selected = tool == DraftTool.Eraser, modifier = Modifier.weight(1f)) {
                    tool = DraftTool.Eraser
                    canvasView?.setTool(tool)
                }
                AnnotationButton("撤销", modifier = Modifier.weight(1f)) { canvasView?.undo() }
                AnnotationButton("清空", modifier = Modifier.weight(1f)) { canvasView?.clearCanvas() }
                AnnotationButton("完成", selected = true, modifier = Modifier.weight(1f)) {
                    persist()
                    onDismiss()
                }
            }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                val sizes = if (tool == DraftTool.Pen) DraftPenWidths.SizesDp.map { it.dp } else listOf(18.dp, 30.dp, 46.dp)
                sizes.forEach { size ->
                    val selected = if (tool == DraftTool.Pen) penWidth == size else eraserSize == size
                    AnnotationButton(size.value.toString().removeSuffix(".0"), selected = selected, modifier = Modifier.weight(1f)) {
                        if (tool == DraftTool.Pen) {
                            penWidth = size
                            canvasView?.setPenWidth(with(density) { size.toPx() })
                        } else {
                            eraserSize = size
                            canvasView?.setEraserRadius(with(density) { size.toPx() })
                        }
                    }
                }
            }
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .background(OpenPhysicsColors.SurfaceSoft, RoundedCornerShape(OpenPhysicsRadius.Medium)),
                contentAlignment = Alignment.Center,
            ) {
                Image(
                    bitmap = bitmap,
                    contentDescription = description,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Fit,
                )
                key(annotationKey) {
                    AndroidView(
                        modifier = Modifier.fillMaxSize(),
                        factory = { context ->
                            DraftCanvasView(context).apply {
                                restore(annotationSnapshots[annotationKey] ?: DraftCanvasSnapshot())
                                setShowGrid(false)
                                setTool(tool)
                                setPenWidth(with(density) { penWidth.toPx() })
                                setEraserRadius(with(density) { eraserSize.toPx() })
                                canvasView = this
                            }
                        },
                        update = { view ->
                            canvasView = view
                            view.setShowGrid(false)
                            view.setTool(tool)
                            view.setPenWidth(with(density) { penWidth.toPx() })
                            view.setEraserRadius(with(density) { eraserSize.toPx() })
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun AnnotationButton(
    text: String,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
    onClick: () -> Unit,
) {
    OutlinedButton(
        onClick = onClick,
        modifier = modifier,
        shape = RoundedCornerShape(OpenPhysicsRadius.Small),
        colors = ButtonDefaults.outlinedButtonColors(
            containerColor = if (selected) OpenPhysicsColors.PrimarySoft else OpenPhysicsColors.Surface,
            contentColor = if (selected) OpenPhysicsColors.PrimaryDeep else OpenPhysicsColors.Muted,
        ),
    ) {
        Text(text)
    }
}

@Composable
fun ImagePreviewDialog(
    bitmap: ImageBitmap,
    description: String,
    onDismiss: () -> Unit,
) {
    var scale by remember(bitmap) { mutableFloatStateOf(1f) }
    var offsetX by remember(bitmap) { mutableFloatStateOf(0f) }
    var offsetY by remember(bitmap) { mutableFloatStateOf(0f) }
    val imageInteraction = remember { MutableInteractionSource() }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color(0xEE000000))
                .clickable {
                    if (shouldDismissImagePreview(ImagePreviewTapTarget.Backdrop)) {
                        onDismiss()
                    }
                }
                .padding(12.dp),
        ) {
            Image(
                bitmap = bitmap,
                contentDescription = description,
                modifier = Modifier
                    .align(Alignment.Center)
                    .fillMaxWidth()
                    .graphicsLayer {
                        scaleX = scale
                        scaleY = scale
                        translationX = offsetX
                        translationY = offsetY
                    }
                    .clickable(
                        interactionSource = imageInteraction,
                        indication = null,
                    ) {
                        if (shouldDismissImagePreview(ImagePreviewTapTarget.ImageContent)) {
                            onDismiss()
                        }
                    }
                    .pointerInput(bitmap) {
                        detectTransformGestures { _, pan, zoom, _ ->
                            val nextScale = (scale * zoom).coerceIn(1f, 5f)
                            scale = nextScale
                            if (nextScale > 1f) {
                                offsetX += pan.x
                                offsetY += pan.y
                            } else {
                                offsetX = 0f
                                offsetY = 0f
                            }
                        }
                    },
                contentScale = ContentScale.Fit,
            )
            Button(
                onClick = onDismiss,
                modifier = Modifier.align(Alignment.TopEnd),
            ) {
                Text("关闭")
            }
        }
    }
}
