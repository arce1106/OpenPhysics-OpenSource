package cn.openphysics.androidapp.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import cn.openphysics.androidapp.ui.design.OpenPhysicsColors
import cn.openphysics.androidapp.ui.design.OpenPhysicsElevation
import cn.openphysics.androidapp.ui.design.OpenPhysicsRadius
import cn.openphysics.androidapp.ui.design.OpenPhysicsSpacing

@Composable
fun LearningCard(
    modifier: Modifier = Modifier,
    title: String = "",
    subtitle: String = "",
    meta: String = "",
    onClick: (() -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit = {},
) {
    val clickableModifier = if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier
    Card(
        modifier = modifier
            .fillMaxWidth()
            .then(clickableModifier),
        shape = RoundedCornerShape(OpenPhysicsRadius.Large),
        colors = CardDefaults.cardColors(containerColor = OpenPhysicsColors.Surface),
        elevation = CardDefaults.cardElevation(defaultElevation = OpenPhysicsElevation.Card),
        border = BorderStroke(1.dp, OpenPhysicsColors.Border),
    ) {
        Column(
            modifier = Modifier.padding(OpenPhysicsSpacing.CardPadding),
            verticalArrangement = Arrangement.spacedBy(OpenPhysicsSpacing.CardGap),
        ) {
            if (title.isNotBlank() || subtitle.isNotBlank() || meta.isNotBlank() || trailing != null) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(OpenPhysicsSpacing.InlineGap),
                    verticalAlignment = Alignment.Top,
                ) {
                    Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        if (meta.isNotBlank()) {
                            Text(
                                text = meta,
                                color = OpenPhysicsColors.PrimaryDeep,
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.Normal,
                            )
                        }
                        if (title.isNotBlank()) {
                            Text(
                                text = title,
                                color = OpenPhysicsColors.Ink,
                                style = MaterialTheme.typography.titleLarge,
                                fontWeight = FontWeight.Normal,
                            )
                        }
                        if (subtitle.isNotBlank()) {
                            Text(
                                text = subtitle,
                                color = OpenPhysicsColors.Muted,
                                style = MaterialTheme.typography.bodyMedium,
                            )
                        }
                    }
                    trailing?.invoke()
                }
            }
            content()
        }
    }
}
