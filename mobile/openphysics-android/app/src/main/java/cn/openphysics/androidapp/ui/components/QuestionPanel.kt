package cn.openphysics.androidapp.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import cn.openphysics.androidapp.ui.design.OpenPhysicsSpacing
import cn.openphysics.androidapp.ui.design.OpenPhysicsTone

@Composable
fun QuestionPanel(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String = "",
    chipText: String = "",
    onHeaderClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    LearningCard(modifier = modifier) {
        val headerModifier = if (onHeaderClick == null) Modifier else Modifier.clickable(onClick = onHeaderClick)
        Row(
            modifier = headerModifier,
            horizontalArrangement = Arrangement.spacedBy(OpenPhysicsSpacing.InlineGap),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                SectionHeader(title = title, subtitle = subtitle)
            }
            if (chipText.isNotBlank()) {
                StatusChip(text = chipText, tone = OpenPhysicsTone.Primary)
            }
        }
        content()
    }
}
