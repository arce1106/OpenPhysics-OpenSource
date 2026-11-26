package cn.openphysics.androidapp.ui.draft

import android.graphics.Bitmap
import android.view.InputDevice
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import cn.openphysics.androidapp.ui.components.LearningCard
import cn.openphysics.androidapp.ui.components.StatusChip
import cn.openphysics.androidapp.ui.design.OpenPhysicsColors
import cn.openphysics.androidapp.ui.design.OpenPhysicsRadius
import cn.openphysics.androidapp.ui.design.OpenPhysicsTone
import kotlin.math.roundToInt

private val DraftPenSizes = DraftPenWidths.SizesDp.map { it.dp }
private val DraftEraserSizes = listOf(18.dp, 38.dp)
private val DraftPenColors = listOf(
    0xFF0F172A.toInt(),
    0xFFE11D48.toInt(),
    0xFF2563EB.toInt(),
)

internal data class DraftCanvasBelowActionsPolicy(
    val showActionRow: Boolean,
    val showSaveAction: Boolean,
)

internal fun draftCanvasBelowActionsPolicy(
    showSaveBelowCanvas: Boolean,
    hasSaveAction: Boolean,
    hasCustomActions: Boolean,
): DraftCanvasBelowActionsPolicy {
    val showSaveAction = showSaveBelowCanvas && hasSaveAction
    return DraftCanvasBelowActionsPolicy(
        showActionRow = showSaveAction || hasCustomActions,
        showSaveAction = showSaveAction,
    )
}

@Composable
fun DraftCanvasPanel(
    questionId: String,
    snapshots: MutableMap<String, DraftCanvasSnapshot>,
    modifier: Modifier = Modifier,
    title: String = "草稿纸",
    subtitle: String = "本地临时草稿，不进入数据库",
    backgroundBitmap: Bitmap? = null,
    backgroundImageMetadata: DraftBackgroundImage? = null,
    toolbarOverlay: Boolean = false,
    compactWorkbench: Boolean = false,
    showStatus: Boolean = true,
    imageToggleAvailable: Boolean = false,
    imageEnabled: Boolean = false,
    onToggleImage: (() -> Unit)? = null,
    showSaveInToolbar: Boolean = true,
    showSaveBelowCanvas: Boolean = false,
    saveActionLabel: String = "保存本题作答",
    belowCanvasActionContent: (@Composable RowScope.() -> Unit)? = null,
    onSaveAsAnswer: ((imageBytes: ByteArray, mimeType: String) -> Unit)? = null,
    onScratchImageChange: ((imageBytes: ByteArray?, mimeType: String) -> Unit)? = null,
    onScratchImageExporterChange: (((() -> Unit)?) -> Unit)? = null,
    onSnapshotChange: ((DraftCanvasSnapshot) -> Unit)? = null,
) {
    val density = LocalDensity.current
    var canvasView by remember(questionId) { mutableStateOf<DraftCanvasView?>(null) }
    var tool by remember(questionId) { mutableStateOf(DraftTool.Pen) }
    var penWidth by remember(questionId) { mutableStateOf(DraftPenWidths.DefaultDp.dp) }
    var penColorArgb by remember(questionId) { mutableIntStateOf(DraftPenColors.first()) }
    var eraserSize by remember(questionId) { mutableStateOf(DraftEraserSizes.first()) }
    var fingerWritingEnabled by remember { mutableStateOf(!hasConnectedStylus()) }
    var toolbarOffsetY by remember(questionId) { mutableFloatStateOf(0f) }
    var info by remember(questionId) { mutableStateOf(DraftCanvasInfo()) }

    fun exportScratchImage(view: DraftCanvasView) {
        if (onScratchImageChange == null) return
        val snapshot = view.snapshot()
        snapshots[questionId] = snapshot
        onSnapshotChange?.invoke(snapshot)
        val image = view.exportAnswerJpeg()
        if (image != null) onScratchImageChange(image, "image/jpeg") else onScratchImageChange(null, "")
    }

    DisposableEffect(questionId, canvasView) {
        val view = canvasView
        onScratchImageExporterChange?.invoke(view?.let { { exportScratchImage(it) } })
        onDispose {
            onScratchImageExporterChange?.invoke(null)
        }
    }

    DraftCanvasContainer(
        modifier = modifier,
        title = title,
        subtitle = subtitle,
        compact = compactWorkbench,
        trailing = if (showStatus) {
            {
            StatusChip(
                text = if (info.strokeCount == 0) "空白" else "${info.strokeCount} 笔",
                tone = if (info.strokeCount == 0) OpenPhysicsTone.Neutral else OpenPhysicsTone.Primary,
            )
            }
        } else {
            null
        },
    ) {
        val saveAction: (() -> Unit)? = if (onSaveAsAnswer == null) null else {
            {
                canvasView?.let { view ->
                    val snapshot = view.snapshot()
                    snapshots[questionId] = snapshot
                    onSnapshotChange?.invoke(snapshot)
                    // Whole answer, not just the part on screen (it was cropped after panning).
                    view.exportAnswerJpeg()?.let { onSaveAsAnswer(it, "image/jpeg") }
                }
            }
        }
        val toolChange: (DraftTool) -> Unit = {
            tool = it
            canvasView?.setTool(it)
        }
        val penWidthChange: (Dp) -> Unit = {
            penWidth = it
            canvasView?.setPenWidth(with(density) { it.toPx() })
        }
        val penColorChange: (Int) -> Unit = {
            penColorArgb = it
            canvasView?.setPenColorArgb(it)
        }
        val eraserSizeChange: (Dp) -> Unit = {
            eraserSize = it
            canvasView?.setEraserRadius(with(density) { it.toPx() })
        }
        if (!toolbarOverlay) {
            CompactDraftToolbar(
                tool = tool,
                penWidth = penWidth,
                penColorArgb = penColorArgb,
                eraserSize = eraserSize,
                fingerWritingEnabled = fingerWritingEnabled,
                canUndo = info.canUndo,
                canRedo = info.canRedo,
                onToolChange = toolChange,
                onPenWidthChange = penWidthChange,
                onPenColorChange = penColorChange,
                onEraserSizeChange = eraserSizeChange,
                onFingerWritingChange = { enabled ->
                    fingerWritingEnabled = enabled
                    canvasView?.setFingerWritingEnabled(enabled)
                },
                onUndo = { canvasView?.undo() },
                onRedo = { canvasView?.redo() },
                onClear = { canvasView?.clearCanvas() },
                onSave = if (showSaveInToolbar) saveAction else null,
            )
        }
        if (compactWorkbench && (imageToggleAvailable || belowCanvasActionContent != null || (showSaveBelowCanvas && saveAction != null))) {
            Row(
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (imageToggleAvailable && onToggleImage != null) {
                    DraftWorkspaceAction(if (imageEnabled) "移出题图" else "放入题图", onClick = onToggleImage)
                }
                if (showSaveBelowCanvas && saveAction != null) {
                    DraftWorkspaceAction(saveActionLabel.replace("本题", ""), onClick = saveAction, enabled = info.strokeCount > 0)
                }
                belowCanvasActionContent?.invoke(this)
            }
        } else if (!compactWorkbench && imageToggleAvailable && onToggleImage != null) {
            DraftImageBackgroundControl(
                imageEnabled = imageEnabled,
                onToggleImage = onToggleImage,
            )
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .then(if (toolbarOverlay) Modifier.weight(1f, fill = true) else Modifier.height(520.dp))
                .background(OpenPhysicsColors.SurfaceSoft, RoundedCornerShape(OpenPhysicsRadius.Medium))
                .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(OpenPhysicsRadius.Medium))
                .padding(1.dp),
        ) {
            key(questionId) {
                AndroidView(
                    modifier = Modifier.fillMaxSize(),
                    factory = { context ->
                        DraftCanvasView(context).apply {
                            restore(snapshots[questionId] ?: DraftCanvasSnapshot())
                            setBackgroundBitmap(backgroundBitmap)
                            setBackgroundImageMetadata(backgroundImageMetadata)
                            setShowGrid(backgroundBitmap == null)
                            setTool(tool)
                            setPenWidth(with(density) { penWidth.toPx() })
                            setPenColorArgb(penColorArgb)
                            setEraserRadius(with(density) { eraserSize.toPx() })
                            setFingerWritingEnabled(fingerWritingEnabled)
                            setOnStateChanged {
                                info = it
                            }
                            setOnSnapshotCommitted { snapshot ->
                                snapshots[questionId] = snapshot
                                onSnapshotChange?.invoke(snapshot)
                            }
                            canvasView = this
                        }
                    },
                    update = { view ->
                        canvasView = view
                        view.setBackgroundBitmap(backgroundBitmap)
                        view.setBackgroundImageMetadata(backgroundImageMetadata)
                        view.setShowGrid(backgroundBitmap == null)
                        view.setTool(tool)
                        view.setPenWidth(with(density) { penWidth.toPx() })
                        view.setPenColorArgb(penColorArgb)
                        view.setEraserRadius(with(density) { eraserSize.toPx() })
                        view.setFingerWritingEnabled(fingerWritingEnabled)
                        view.setOnStateChanged {
                            info = it
                        }
                        view.setOnSnapshotCommitted { snapshot ->
                            snapshots[questionId] = snapshot
                            onSnapshotChange?.invoke(snapshot)
                        }
                    },
                )
            }
            if (toolbarOverlay) {
                VerticalDraftToolbar(
                    tool = tool,
                    penWidth = penWidth,
                    penColorArgb = penColorArgb,
                    eraserSize = eraserSize,
                    fingerWritingEnabled = fingerWritingEnabled,
                    canUndo = info.canUndo,
                    canRedo = info.canRedo,
                    onToolChange = toolChange,
                    onPenWidthChange = penWidthChange,
                    onPenColorChange = penColorChange,
                    onEraserSizeChange = eraserSizeChange,
                    onFingerWritingChange = { enabled ->
                        fingerWritingEnabled = enabled
                        canvasView?.setFingerWritingEnabled(enabled)
                    },
                    onUndo = { canvasView?.undo() },
                    onRedo = { canvasView?.redo() },
                    onClear = { canvasView?.clearCanvas() },
                    onSave = if (showSaveInToolbar) saveAction else null,
                    imageEnabled = imageEnabled,
                    modifier = Modifier
                        .align(Alignment.CenterEnd)
                        .offset { IntOffset(0, toolbarOffsetY.roundToInt()) }
                        .pointerInput(questionId) {
                            detectDragGesturesAfterLongPress { _, dragAmount ->
                                toolbarOffsetY = (toolbarOffsetY + dragAmount.y).coerceIn(-280f, 280f)
                            }
                        }
                        .padding(end = 8.dp),
                )
            }
        }
        val belowActionsPolicy = draftCanvasBelowActionsPolicy(
            showSaveBelowCanvas = showSaveBelowCanvas,
            hasSaveAction = saveAction != null,
            hasCustomActions = belowCanvasActionContent != null,
        )
        if (!compactWorkbench && belowActionsPolicy.showActionRow) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(1.dp)
                    .background(OpenPhysicsColors.Border.copy(alpha = 0.55f)),
            )
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val action = saveAction
                if (belowActionsPolicy.showSaveAction && action != null) {
                    OutlinedButton(
                        onClick = action,
                        enabled = info.strokeCount > 0,
                        modifier = (if (belowCanvasActionContent == null) Modifier else Modifier.weight(1f))
                            .height(42.dp),
                        shape = RoundedCornerShape(OpenPhysicsRadius.Medium),
                        border = ButtonDefaults.outlinedButtonBorder(enabled = info.strokeCount > 0),
                        contentPadding = PaddingValues(horizontal = 22.dp, vertical = 0.dp),
                        colors = ButtonDefaults.outlinedButtonColors(
                            containerColor = if (info.strokeCount > 0) {
                                OpenPhysicsColors.Primary
                            } else {
                                Color(0xFFD1D5DB)
                            },
                            contentColor = OpenPhysicsColors.Surface,
                            disabledContainerColor = Color(0xFFD1D5DB),
                            disabledContentColor = OpenPhysicsColors.Surface,
                        ),
                    ) {
                        Text(
                            text = saveActionLabel,
                            fontWeight = androidx.compose.ui.text.font.FontWeight.Bold,
                        )
                    }
                }
                belowCanvasActionContent?.invoke(this)
            }
        }
    }
}

@Composable
private fun DraftCanvasContainer(
    modifier: Modifier,
    title: String,
    subtitle: String,
    compact: Boolean,
    trailing: (@Composable () -> Unit)?,
    content: @Composable ColumnScope.() -> Unit,
) {
    if (compact) {
        Column(
            modifier = modifier.padding(start = 4.dp, end = 4.dp, bottom = 4.dp),
            verticalArrangement = Arrangement.spacedBy(0.dp),
            content = content,
        )
    } else {
        LearningCard(modifier = modifier, title = title, subtitle = subtitle, trailing = trailing, content = content)
    }
}

@Composable
internal fun DraftWorkspaceAction(text: String, onClick: () -> Unit, enabled: Boolean = true) {
    TextButton(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.height(40.dp),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp),
    ) {
        Text(text, maxLines = 1)
    }
}

@Composable
private fun DraftImageBackgroundControl(
    imageEnabled: Boolean,
    onToggleImage: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = 0.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = "题图背景",
            color = OpenPhysicsColors.Muted,
            fontWeight = androidx.compose.ui.text.font.FontWeight.Bold,
        )
        OutlinedButton(
            onClick = onToggleImage,
            modifier = Modifier.height(36.dp),
            shape = RoundedCornerShape(999.dp),
            contentPadding = PaddingValues(horizontal = 14.dp, vertical = 0.dp),
            colors = ButtonDefaults.outlinedButtonColors(
                containerColor = if (imageEnabled) OpenPhysicsColors.PrimarySoft else OpenPhysicsColors.Surface,
                contentColor = OpenPhysicsColors.PrimaryDeep,
            ),
        ) {
            Text(if (imageEnabled) "移出草稿纸" else "放入草稿纸")
        }
    }
}

@Composable
private fun CompactDraftToolbar(
    tool: DraftTool,
    penWidth: Dp,
    penColorArgb: Int,
    eraserSize: Dp,
    fingerWritingEnabled: Boolean,
    canUndo: Boolean,
    canRedo: Boolean,
    onToolChange: (DraftTool) -> Unit,
    onPenWidthChange: (Dp) -> Unit,
    onPenColorChange: (Int) -> Unit,
    onEraserSizeChange: (Dp) -> Unit,
    onFingerWritingChange: (Boolean) -> Unit,
    onUndo: () -> Unit,
    onRedo: () -> Unit,
    onClear: () -> Unit,
    onSave: (() -> Unit)? = null,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PenToolMenuButton(
            symbol = "✎",
            selected = tool == DraftTool.Pen,
            selectedSize = penWidth,
            selectedColorArgb = penColorArgb,
            onOpen = { onToolChange(DraftTool.Pen) },
            onSizeSelected = {
                onToolChange(DraftTool.Pen)
                onPenWidthChange(it)
            },
            onColorSelected = {
                onToolChange(DraftTool.Pen)
                onPenColorChange(it)
            },
        )
        ToolSizeMenuButton(
            symbol = "○",
            selected = tool == DraftTool.Eraser,
            sizes = DraftEraserSizes,
            selectedSize = eraserSize,
            onOpen = { onToolChange(DraftTool.Eraser) },
            onSizeSelected = {
                onToolChange(DraftTool.Eraser)
                onEraserSizeChange(it)
            },
        )
        ToolbarButton(
            text = "指",
            selected = fingerWritingEnabled,
            modifier = Modifier.size(width = 42.dp, height = 36.dp),
            onClick = { onFingerWritingChange(!fingerWritingEnabled) },
        )
        ToolbarButton("↶", enabled = canUndo, modifier = Modifier.size(width = 42.dp, height = 36.dp), onClick = onUndo)
        ToolbarButton("↷", enabled = canRedo, modifier = Modifier.size(width = 42.dp, height = 36.dp), onClick = onRedo)
        ToolbarButton("×", modifier = Modifier.size(width = 42.dp, height = 36.dp), onClick = onClear)
        onSave?.let {
            ToolbarButton("✓", modifier = Modifier.weight(1f).height(36.dp), onClick = it)
        }
    }
}

@Composable
private fun VerticalDraftToolbar(
    tool: DraftTool,
    penWidth: Dp,
    penColorArgb: Int,
    eraserSize: Dp,
    fingerWritingEnabled: Boolean,
    canUndo: Boolean,
    canRedo: Boolean,
    onToolChange: (DraftTool) -> Unit,
    onPenWidthChange: (Dp) -> Unit,
    onPenColorChange: (Int) -> Unit,
    onEraserSizeChange: (Dp) -> Unit,
    onFingerWritingChange: (Boolean) -> Unit,
    onUndo: () -> Unit,
    onRedo: () -> Unit,
    onClear: () -> Unit,
    modifier: Modifier = Modifier,
    onSave: (() -> Unit)? = null,
    imageEnabled: Boolean = false,
) {
    var expanded by remember { mutableStateOf(false) }
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        PenToolMenuButton(
            symbol = "✎",
            selected = tool == DraftTool.Pen,
            selectedSize = penWidth,
            selectedColorArgb = penColorArgb,
            onOpen = { onToolChange(DraftTool.Pen) },
            onSizeSelected = {
                onToolChange(DraftTool.Pen)
                onPenWidthChange(it)
            },
            onColorSelected = {
                onToolChange(DraftTool.Pen)
                onPenColorChange(it)
            },
        )
        ToolSizeMenuButton(
            symbol = "○",
            selected = tool == DraftTool.Eraser,
            sizes = DraftEraserSizes,
            selectedSize = eraserSize,
            onOpen = { onToolChange(DraftTool.Eraser) },
            onSizeSelected = {
                onToolChange(DraftTool.Eraser)
                onEraserSizeChange(it)
            },
        )
        if (expanded) {
            if (imageEnabled) {
                ToolbarButton(
                    text = "⤢",
                    selected = tool == DraftTool.ImageMove,
                    modifier = Modifier.size(width = 42.dp, height = 36.dp),
                    onClick = { onToolChange(DraftTool.ImageMove) },
                )
            }
            ToolbarButton(
                text = "指",
                selected = fingerWritingEnabled,
                modifier = Modifier.size(width = 42.dp, height = 36.dp),
                onClick = { onFingerWritingChange(!fingerWritingEnabled) },
            )
            ToolbarButton("↶", enabled = canUndo, modifier = Modifier.size(width = 42.dp, height = 36.dp), onClick = onUndo)
            ToolbarButton("↷", enabled = canRedo, modifier = Modifier.size(width = 42.dp, height = 36.dp), onClick = onRedo)
            ToolbarButton("×", modifier = Modifier.size(width = 42.dp, height = 36.dp), onClick = onClear)
            onSave?.let {
                ToolbarButton("✓", modifier = Modifier.size(width = 42.dp, height = 36.dp), onClick = it)
            }
        }
        ToolbarButton(
            text = if (expanded) "⌃" else "⌄",
            modifier = Modifier.size(width = 42.dp, height = 36.dp),
            onClick = { expanded = !expanded },
        )
    }
}

@Composable
private fun PenToolMenuButton(
    symbol: String,
    selected: Boolean,
    selectedSize: Dp,
    selectedColorArgb: Int,
    onOpen: () -> Unit,
    onSizeSelected: (Dp) -> Unit,
    onColorSelected: (Int) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Box(modifier = Modifier.wrapContentSize(Alignment.TopStart)) {
        ToolbarButton(
            text = symbol,
            selected = selected,
            modifier = Modifier.size(width = 42.dp, height = 42.dp),
        ) {
            onOpen()
            expanded = true
        }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            modifier = Modifier
                .background(OpenPhysicsColors.Surface, RoundedCornerShape(14.dp))
                .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(14.dp))
                .padding(10.dp),
        ) {
            Column(
                modifier = Modifier.width(132.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(18.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    DraftPenSizes.forEach { size ->
                        ToolDotButton(
                            size = size,
                            selected = selectedSize == size,
                            color = Color(selectedColorArgb),
                        ) {
                            onSizeSelected(size)
                            expanded = false
                        }
                    }
                }
                Row(
                    horizontalArrangement = Arrangement.spacedBy(18.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    DraftPenColors.forEach { colorArgb ->
                        ToolColorButton(
                            color = Color(colorArgb),
                            selected = selectedColorArgb == colorArgb,
                        ) {
                            onColorSelected(colorArgb)
                            expanded = false
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ToolSizeMenuButton(
    symbol: String,
    selected: Boolean,
    sizes: List<Dp>,
    selectedSize: Dp,
    onOpen: () -> Unit,
    onSizeSelected: (Dp) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Box(modifier = Modifier.wrapContentSize(Alignment.TopStart)) {
        ToolbarButton(
            text = symbol,
            selected = selected,
            modifier = Modifier.size(width = 42.dp, height = 42.dp),
        ) {
            onOpen()
            expanded = true
        }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            modifier = Modifier
                .background(OpenPhysicsColors.Surface, RoundedCornerShape(14.dp))
                .border(1.dp, OpenPhysicsColors.Border, RoundedCornerShape(14.dp))
                .padding(10.dp),
        ) {
            Row(
                modifier = Modifier.width(86.dp),
                horizontalArrangement = Arrangement.spacedBy(18.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                sizes.forEach { size ->
                    ToolDotButton(
                        size = size,
                        selected = selectedSize == size,
                        color = OpenPhysicsColors.Primary,
                        hollow = true,
                    ) {
                        onSizeSelected(size)
                        expanded = false
                    }
                }
            }
        }
    }
}

@Composable
private fun ToolDotButton(
    size: Dp,
    selected: Boolean,
    color: Color,
    hollow: Boolean = false,
    onClick: () -> Unit,
) {
    Box(
        modifier = Modifier
            .size(34.dp)
            .background(
                color = if (selected) OpenPhysicsColors.PrimarySoft else Color.Transparent,
                shape = CircleShape,
            )
            .border(
                width = if (selected) 1.dp else 0.dp,
                color = if (selected) OpenPhysicsColors.Primary else Color.Transparent,
                shape = CircleShape,
            )
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        val dotSize = if (hollow) {
            (size.value * 0.45f).dp.coerceIn(14.dp, 24.dp)
        } else {
            (size.value * 3f).dp.coerceIn(3.dp, 24.dp)
        }
        Box(
            modifier = Modifier
                .size(dotSize)
                .then(
                    if (hollow) {
                        Modifier.border(
                            width = 2.dp,
                            color = if (selected) OpenPhysicsColors.Primary else OpenPhysicsColors.Muted,
                            shape = CircleShape,
                        )
                    } else {
                        Modifier.background(color, CircleShape)
                    },
                ),
        )
    }
}

@Composable
private fun ToolColorButton(
    color: Color,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Box(
        modifier = Modifier
            .size(34.dp)
            .background(
                color = if (selected) OpenPhysicsColors.PrimarySoft else Color.Transparent,
                shape = CircleShape,
            )
            .border(
                width = if (selected) 1.dp else 0.dp,
                color = if (selected) OpenPhysicsColors.Primary else Color.Transparent,
                shape = CircleShape,
            )
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier
                .size(20.dp)
                .background(color, CircleShape),
        )
    }
}

@Composable
private fun ToolbarButton(
    text: String,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier,
        shape = RoundedCornerShape(OpenPhysicsRadius.Small),
        contentPadding = PaddingValues(horizontal = 0.dp, vertical = 0.dp),
        colors = ButtonDefaults.outlinedButtonColors(
            containerColor = if (selected) OpenPhysicsColors.PrimarySoft else OpenPhysicsColors.Surface,
            contentColor = if (selected) OpenPhysicsColors.PrimaryDeep else OpenPhysicsColors.Muted,
        ),
    ) {
        Text(text, maxLines = 1)
    }
}

private fun hasConnectedStylus(): Boolean = InputDevice.getDeviceIds().any { deviceId ->
    InputDevice.getDevice(deviceId)?.supportsSource(InputDevice.SOURCE_STYLUS) == true
}
