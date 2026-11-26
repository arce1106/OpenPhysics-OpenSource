package cn.openphysics.androidapp.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import cn.openphysics.androidapp.ui.design.OpenPhysicsTone

@Composable
fun MistakeTag(
    text: String,
    modifier: Modifier = Modifier,
    tone: OpenPhysicsTone = OpenPhysicsTone.Warning,
) {
    StatusChip(text = text, modifier = modifier, tone = tone)
}
