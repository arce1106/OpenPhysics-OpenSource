package cn.openphysics.androidapp.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import cn.openphysics.androidapp.ui.design.OpenPhysicsColors
import cn.openphysics.androidapp.ui.design.OpenPhysicsRadius
import cn.openphysics.androidapp.ui.design.OpenPhysicsSpacing

@Composable
fun BottomActionBar(
    primaryText: String,
    onPrimary: () -> Unit,
    modifier: Modifier = Modifier,
    primaryEnabled: Boolean = true,
    secondaryText: String = "",
    onSecondary: (() -> Unit)? = null,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(OpenPhysicsColors.Surface, RoundedCornerShape(OpenPhysicsRadius.Large))
            .padding(OpenPhysicsSpacing.InlineGap),
        horizontalArrangement = Arrangement.spacedBy(OpenPhysicsSpacing.InlineGap),
    ) {
        if (secondaryText.isNotBlank() && onSecondary != null) {
            SecondaryActionButton(
                text = secondaryText,
                onClick = onSecondary,
                modifier = Modifier.weight(1f),
            )
        }
        PrimaryActionButton(
            text = primaryText,
            onClick = onPrimary,
            enabled = primaryEnabled,
            modifier = Modifier.weight(1f),
        )
    }
}
