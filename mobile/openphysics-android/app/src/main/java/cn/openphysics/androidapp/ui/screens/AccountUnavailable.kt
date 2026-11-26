package cn.openphysics.androidapp.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import cn.openphysics.androidapp.ui.components.PrimaryActionButton
import cn.openphysics.androidapp.ui.design.OpenPhysicsColors

internal const val AccountUnavailableActionLabel = "查看账号状态"

/**
 * The one locked-state banner, as on iOS 专题复习: the account availability, and a button
 * straight to 账号状态. Locked actions on the page open 账号状态 too instead of an error page.
 */
@Composable
internal fun AccountUnavailableBanner(title: String, message: String, onAccountUnavailable: () -> Unit) {
    if (LocalPhonePresentation.current) {
        PhoneSoftSection {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text(message, color = PhoneColors.Muted)
            PhoneAction(AccountUnavailableActionLabel, onAccountUnavailable, Modifier.fillMaxWidth())
        }
        return
    }
    Column(
        Modifier.fillMaxWidth().background(OpenPhysicsColors.PrimarySoft, RoundedCornerShape(14.dp)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(title, fontWeight = FontWeight.Bold, color = OpenPhysicsColors.Ink)
        Text(message, color = OpenPhysicsColors.Muted)
        PrimaryActionButton(text = AccountUnavailableActionLabel, onClick = onAccountUnavailable, modifier = Modifier.width(180.dp))
    }
}

internal const val LockedKnowledgePointTitle = "登录后学习本知识点"
internal const val LockedKnowledgePointMessage =
    "有效账号可学习全部知识点。请重新登录或联系部署管理员，已有记录会保留。"
internal const val LockedActionDetail = "登录后开启"

@Composable
internal fun PendingContentNotice(name: String) {
    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(name, style = MaterialTheme.typography.titleMedium)
        Text("内容待补充", color = OpenPhysicsColors.Muted)
        Text("目录已保留，学习内容和题目待部署者补充。", color = OpenPhysicsColors.Muted)
    }
}
