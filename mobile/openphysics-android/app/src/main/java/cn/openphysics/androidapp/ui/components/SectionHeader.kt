package cn.openphysics.androidapp.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import cn.openphysics.androidapp.ui.design.OpenPhysicsColors

@Composable
fun SectionHeader(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String = "",
    actionText: String = "",
    onAction: (() -> Unit)? = null,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                color = OpenPhysicsColors.Ink,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Normal,
            )
            if (subtitle.isNotBlank()) {
                Text(
                    text = subtitle,
                    color = OpenPhysicsColors.Muted,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
        if (actionText.isNotBlank() && onAction != null) {
            TextButton(onClick = onAction) {
                Text(actionText, color = OpenPhysicsColors.PrimaryDeep, fontWeight = FontWeight.Normal)
            }
        }
    }
}
