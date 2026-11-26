package cn.openphysics.androidapp.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import cn.openphysics.androidapp.ui.design.OpenPhysicsColors
import cn.openphysics.androidapp.ui.design.OpenPhysicsRadius
import cn.openphysics.androidapp.ui.components.PrimaryActionButton
import cn.openphysics.androidapp.ui.components.SecondaryActionButton

@Composable
fun ErrorScreen(
    title: String,
    message: String,
    onBack: () -> Unit,
    actionLabel: String = "",
    onAction: (() -> Unit)? = null,
) {
    if (LocalPhonePresentation.current) {
        // Never a dead end: like iOS's empty-state views, there is always a clear way out.
        val hasAction = onAction != null && actionLabel.isNotBlank()
        PhoneDetailPage(
            title = "",
            onBack = onBack,
            footer = {
                if (hasAction) {
                    PhoneAction("返回", onBack, Modifier.weight(0.38f), primary = false)
                    PhoneAction(actionLabel, onAction!!, Modifier.weight(0.62f))
                } else {
                    PhoneAction("返回", onBack, Modifier.fillMaxWidth())
                }
            },
        ) {
            Column(Modifier.fillMaxWidth().padding(top = 72.dp), horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.size(56.dp).background(PhoneColors.Soft, RoundedCornerShape(16.dp)), contentAlignment = Alignment.Center) {
                    PhoneIcon(PhoneSymbol.Review, Modifier.size(26.dp), PhoneColors.Primary)
                }
                Text(title, style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center)
                Text(message, style = MaterialTheme.typography.bodyMedium, color = PhoneColors.Muted, textAlign = TextAlign.Center)
            }
        }
        return
    }
    // Tablet: a centred empty-state card with an explicit way back and, when possible, a retry.
    Box(Modifier.fillMaxSize().background(OpenPhysicsColors.Background).padding(24.dp), contentAlignment = Alignment.Center) {
        Column(
            Modifier
                .widthIn(max = 520.dp)
                .fillMaxWidth()
                .background(Color.White, RoundedCornerShape(OpenPhysicsRadius.Large))
                .padding(horizontal = 32.dp, vertical = 36.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(Modifier.size(56.dp).background(OpenPhysicsColors.PrimarySoft, RoundedCornerShape(16.dp)), contentAlignment = Alignment.Center) {
                PhoneIcon(PhoneSymbol.Review, Modifier.size(26.dp), OpenPhysicsColors.PrimaryDeep)
            }
            Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold,
                color = OpenPhysicsColors.Ink, textAlign = TextAlign.Center)
            Text(message, style = MaterialTheme.typography.bodyMedium, color = OpenPhysicsColors.Muted, textAlign = TextAlign.Center)
            Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                SecondaryActionButton(text = "返回", onClick = onBack, modifier = Modifier.weight(1f))
                if (onAction != null && actionLabel.isNotBlank()) {
                    PrimaryActionButton(text = actionLabel, onClick = onAction, modifier = Modifier.weight(1f))
                }
            }
        }
    }
}
