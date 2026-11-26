package cn.openphysics.androidapp.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import cn.openphysics.androidapp.ui.design.OpenPhysicsRadius
import cn.openphysics.androidapp.ui.design.OpenPhysicsTone
import cn.openphysics.androidapp.ui.design.tonePalette

@Composable
fun StatusChip(
    text: String,
    modifier: Modifier = Modifier,
    tone: OpenPhysicsTone = OpenPhysicsTone.Neutral,
) {
    if (text.isBlank()) return
    val palette = tonePalette(tone)
    Text(
        text = text,
        modifier = modifier
            .background(palette.background, RoundedCornerShape(OpenPhysicsRadius.Pill))
            .border(1.dp, palette.border, RoundedCornerShape(OpenPhysicsRadius.Pill))
            .padding(horizontal = 9.dp, vertical = 4.dp),
        color = palette.foreground,
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.Normal,
    )
}
