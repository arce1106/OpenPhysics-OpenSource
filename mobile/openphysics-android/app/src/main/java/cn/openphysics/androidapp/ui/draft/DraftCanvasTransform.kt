package cn.openphysics.androidapp.ui.draft

import kotlin.math.max
import kotlin.math.min

internal const val DraftMinViewportScale = 0.35f
internal const val DraftMaxViewportScale = 3.0f

data class DraftPointF(val x: Float, val y: Float)

data class DraftViewport(
    val offsetX: Float = 0f,
    val offsetY: Float = 0f,
    val scale: Float = 1f,
)

data class DraftImageTransform(
    val x: Float = 0f,
    val y: Float = 0f,
    val scale: Float = 1f,
) {
    fun centerX(imageWidth: Float): Float = x + imageWidth * scale / 2f
    fun centerY(imageHeight: Float): Float = y + imageHeight * scale / 2f
}

data class DraftCanvasTransform(
    val viewport: DraftViewport = DraftViewport(),
    val image: DraftImageTransform = DraftImageTransform(),
) {
    fun screenToWorld(screenX: Float, screenY: Float): DraftPointF {
        return DraftPointF(
            x = (screenX - viewport.offsetX) / viewport.scale,
            y = (screenY - viewport.offsetY) / viewport.scale,
        )
    }

    fun panViewport(screenDx: Float, screenDy: Float): DraftCanvasTransform {
        return copy(
            viewport = viewport.copy(
                offsetX = viewport.offsetX + screenDx,
                offsetY = viewport.offsetY + screenDy,
            ),
        )
    }

    fun zoomViewport(factor: Float, pivotScreenX: Float, pivotScreenY: Float): DraftCanvasTransform {
        val nextScale = (viewport.scale * factor).coerceIn(DraftMinViewportScale, DraftMaxViewportScale)
        val worldPivot = screenToWorld(pivotScreenX, pivotScreenY)
        return copy(
            viewport = viewport.copy(
                scale = nextScale,
                offsetX = pivotScreenX - worldPivot.x * nextScale,
                offsetY = pivotScreenY - worldPivot.y * nextScale,
            ),
        )
    }

    fun dragImage(screenDx: Float, screenDy: Float): DraftCanvasTransform {
        return copy(
            image = image.copy(
                x = image.x + screenDx / viewport.scale,
                y = image.y + screenDy / viewport.scale,
            ),
        )
    }

    fun scaleImage(factor: Float, imageWidth: Float = 0f, imageHeight: Float = 0f): DraftCanvasTransform {
        val nextScale = (image.scale * factor).coerceIn(MinImageScale, MaxImageScale)
        val centerX = image.centerX(imageWidth)
        val centerY = image.centerY(imageHeight)
        return copy(
            image = image.copy(
                scale = nextScale,
                x = centerX - imageWidth * nextScale / 2f,
                y = centerY - imageHeight * nextScale / 2f,
            ),
        )
    }

    fun containsImagePoint(worldX: Float, worldY: Float, imageWidth: Float, imageHeight: Float): Boolean {
        val right = image.x + imageWidth * image.scale
        val bottom = image.y + imageHeight * image.scale
        return worldX in image.x..right && worldY in image.y..bottom
    }

    companion object {
        private const val MinImageScale = 0.35f
        private const val MaxImageScale = 3.0f

        fun initialForImage(
            viewWidth: Float,
            viewHeight: Float,
            imageWidth: Float,
            imageHeight: Float,
        ): DraftCanvasTransform {
            if (viewWidth <= 0f || viewHeight <= 0f || imageWidth <= 0f || imageHeight <= 0f) {
                return DraftCanvasTransform()
            }
            val maxWidth = viewWidth * 0.56f
            val maxHeight = viewHeight * 0.56f
            val scale = min(maxWidth / imageWidth, maxHeight / imageHeight)
                .coerceIn(MinImageScale, MaxImageScale)
            return DraftCanvasTransform(
                image = DraftImageTransform(
                    x = max(0f, viewWidth * 0.08f),
                    y = max(0f, viewHeight * 0.1f),
                    scale = scale,
                ),
            )
        }
    }
}

internal fun adaptDraftTransformToCanvas(
    transform: DraftCanvasTransform,
    fromWidth: Int,
    fromHeight: Int,
    toWidth: Int,
    toHeight: Int,
): DraftCanvasTransform {
    if (fromWidth <= 0 || fromHeight <= 0 || toWidth <= 0 || toHeight <= 0) return transform
    if (fromWidth == toWidth && fromHeight == toHeight) return transform
    val fitScale = min(toWidth.toFloat() / fromWidth, toHeight.toFloat() / fromHeight)
    val nextViewportScale = (transform.viewport.scale * fitScale)
        .coerceIn(DraftMinViewportScale, DraftMaxViewportScale)
    val appliedScale = nextViewportScale / transform.viewport.scale.coerceAtLeast(0.001f)
    val contentWidth = fromWidth * appliedScale
    val contentHeight = fromHeight * appliedScale
    return transform.copy(
        viewport = transform.viewport.copy(
            scale = nextViewportScale,
            offsetX = transform.viewport.offsetX * appliedScale + (toWidth - contentWidth) / 2f,
            offsetY = transform.viewport.offsetY * appliedScale + (toHeight - contentHeight) / 2f,
        ),
    )
}
