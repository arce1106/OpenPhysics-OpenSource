package cn.openphysics.androidapp.ui.components

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.BorderStroke
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import cn.openphysics.androidapp.ui.design.OpenPhysicsColors
import cn.openphysics.androidapp.ui.design.OpenPhysicsRadius
import cn.openphysics.androidapp.ui.design.OpenPhysicsSpacing

@Composable
fun PrimaryActionButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = OpenPhysicsSpacing.ButtonHeight),
        shape = RoundedCornerShape(OpenPhysicsRadius.Medium),
        colors = ButtonDefaults.buttonColors(
            containerColor = OpenPhysicsColors.Primary,
            contentColor = OpenPhysicsColors.Surface,
            disabledContainerColor = OpenPhysicsColors.Border,
            disabledContentColor = OpenPhysicsColors.Subtle,
        ),
        contentPadding = PaddingValues(horizontal = OpenPhysicsSpacing.CardPadding, vertical = OpenPhysicsSpacing.InlineGap),
    ) {
        Text(text, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Normal)
    }
}

@Composable
fun SecondaryActionButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = OpenPhysicsSpacing.ButtonHeight),
        shape = RoundedCornerShape(OpenPhysicsRadius.Medium),
        colors = ButtonDefaults.outlinedButtonColors(
            contentColor = OpenPhysicsColors.PrimaryDeep,
            disabledContentColor = OpenPhysicsColors.Subtle,
        ),
        border = BorderStroke(1.dp, OpenPhysicsColors.Border),
        contentPadding = PaddingValues(horizontal = OpenPhysicsSpacing.CardPadding, vertical = OpenPhysicsSpacing.InlineGap),
    ) {
        Text(text, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Normal)
    }
}
