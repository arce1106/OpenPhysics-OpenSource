package cn.openphysics.androidapp.ui.screens

import android.graphics.Bitmap
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import cn.openphysics.androidapp.ui.draft.DraftCanvasPanel
import cn.openphysics.androidapp.ui.draft.DraftBackgroundImage
import cn.openphysics.androidapp.ui.draft.DraftCanvasSnapshot
import cn.openphysics.androidapp.ui.design.OpenPhysicsColors
import cn.openphysics.androidapp.ui.design.OpenPhysicsRadius

@Composable
internal fun TabletPracticeQuestionScreen(
    promptContent: @Composable ColumnScope.() -> Unit,
    answerContent: @Composable ColumnScope.() -> Unit,
    modifier: Modifier = Modifier,
    topContent: (@Composable ColumnScope.() -> Unit)? = null,
    bottomContent: (@Composable ColumnScope.() -> Unit)? = null,
    promptWeight: Float = 0.48f,
    answerWeight: Float = 0.52f,
    promptScrollable: Boolean = true,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .then(modifier)
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        topContent?.let { content ->
            TabletWorkbenchPane(
                modifier = Modifier.fillMaxWidth(),
                scrollable = false,
                content = content,
            )
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            TabletWorkbenchPane(
                modifier = Modifier
                    .weight(promptWeight)
                    .fillMaxHeight(),
                scrollable = promptScrollable,
                content = promptContent,
            )
            TabletWorkbenchPane(
                modifier = Modifier
                    .weight(answerWeight)
                    .fillMaxHeight(),
                scrollable = false,
                content = answerContent,
            )
        }
        bottomContent?.let { content ->
            TabletWorkbenchPane(
                modifier = Modifier.fillMaxWidth(),
                scrollable = false,
                content = content,
            )
        }
    }
}

@Composable
private fun TabletWorkbenchPane(
    modifier: Modifier,
    scrollable: Boolean,
    content: @Composable ColumnScope.() -> Unit,
) {
    val scrollModifier = if (scrollable) Modifier.verticalScroll(rememberScrollState()) else Modifier
    Column(
        modifier = modifier
            .background(OpenPhysicsColors.Surface, RoundedCornerShape(OpenPhysicsRadius.Large))
            .then(scrollModifier)
            .padding(4.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
        content = content,
    )
}

@Composable
internal fun TabletDraftWorkspace(
    questionId: String,
    snapshots: MutableMap<String, DraftCanvasSnapshot>,
    answer: String,
    isChoice: Boolean,
    modifier: Modifier,
    hasImageBackground: Boolean = false,
    backgroundBitmap: Bitmap? = null,
    backgroundImageMetadata: DraftBackgroundImage? = null,
    imageToggleAvailable: Boolean = false,
    imageEnabled: Boolean = false,
    onToggleImage: (() -> Unit)? = null,
    showSaveBelowCanvas: Boolean = false,
    saveActionLabel: String = "保存本题作答",
    belowCanvasActionContent: (@Composable androidx.compose.foundation.layout.RowScope.() -> Unit)? = null,
    onSaveAsAnswer: ((ByteArray, String) -> Unit)? = null,
    onScratchImageChange: ((ByteArray?, String) -> Unit)? = null,
    onScratchImageExporterChange: (((() -> Unit)?) -> Unit)? = null,
    onSnapshotChange: ((DraftCanvasSnapshot) -> Unit)? = null,
) {
    DraftCanvasPanel(
        questionId = questionId,
        snapshots = snapshots,
        modifier = modifier,
        title = "",
        subtitle = "",
        backgroundBitmap = backgroundBitmap,
        backgroundImageMetadata = backgroundImageMetadata,
        toolbarOverlay = true,
        compactWorkbench = true,
        showStatus = false,
        imageToggleAvailable = imageToggleAvailable,
        imageEnabled = imageEnabled,
        onToggleImage = onToggleImage,
        showSaveInToolbar = false,
        showSaveBelowCanvas = showSaveBelowCanvas,
        saveActionLabel = saveActionLabel,
        belowCanvasActionContent = belowCanvasActionContent,
        onSaveAsAnswer = onSaveAsAnswer,
        onScratchImageChange = onScratchImageChange,
        onScratchImageExporterChange = onScratchImageExporterChange,
        onSnapshotChange = onSnapshotChange,
    )
}
