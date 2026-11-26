package cn.openphysics.androidapp.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.text.font.FontWeight
import cn.openphysics.androidapp.BuildConfig
import cn.openphysics.androidapp.data.api.*
import cn.openphysics.androidapp.domain.StudentAccessPolicy
import cn.openphysics.androidapp.domain.StudentSession
import cn.openphysics.androidapp.ui.theme.AppFontSize
import java.net.URI

internal fun settingsEnvironmentLabel(apiBaseUrl: String): String {
    val host = settingsApiHost(apiBaseUrl)
    return when {
        host == "未配置" -> "未配置"
        host == "openphysics.example" -> "云端服务"
        host.startsWith("10.0.2.2") || host.startsWith("127.0.0.1") ||
            host.startsWith("localhost") || host.startsWith("192.168.") -> "本地服务"
        else -> "自定义服务"
    }
}

internal fun settingsApiHost(apiBaseUrl: String): String {
    val value = apiBaseUrl.trim()
    if (value.isBlank()) return "未配置"
    return runCatching {
        val uri = URI(value)
        val host = uri.host ?: return@runCatching ""
        if (uri.port > 0) "$host:${uri.port}" else host
    }.getOrNull()?.takeIf { it.isNotBlank() }
        ?: value.removePrefix("http://").removePrefix("https://").substringBefore("/").ifBlank { "未配置" }
}

internal fun phoneAccountLine(session: StudentSession): String = if (StudentAccessPolicy.hasFullLearningAccess(session)) "完整学习功能可用" else "账号不可用"

@Composable
private fun PhoneAccountFieldRow(label: String, value: String, action: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable(role = Role.Button, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(label, Modifier.width(56.dp), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
        Text(value, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge, color = PhoneColors.Muted, maxLines = 1)
        Text(action, style = MaterialTheme.typography.bodyLarge, color = PhoneColors.Primary)
    }
}

private val legalDocuments = listOf("用户协议" to "terms", "隐私政策" to "privacy", "未成年人保护规则" to "minors")

private fun legalUrl(path: String): String = BuildConfig.API_BASE_URL.substringBefore("/api/") + "/legal/" + path

@Composable
private fun TabletSettingsCard(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(20.dp)).padding(horizontal = 18.dp, vertical = 6.dp),
        content = content)
}

@Composable
private fun TabletSettingsRow(
    title: String,
    subtitle: String,
    titleColor: Color = Color(0xFF0F172A),
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(enabled = enabled, role = Role.Button, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Column(Modifier.weight(1f).padding(vertical = 8.dp)) {
            Text(title, color = titleColor, style = MaterialTheme.typography.bodyLarge)
            if (subtitle.isNotBlank()) Text(subtitle, color = Color(0xFF64748B), style = MaterialTheme.typography.labelMedium)
        }
        PhoneIcon(PhoneSymbol.Next, Modifier.size(16.dp), Color(0xFF94A3B8))
    }
}

@Composable
fun SettingsScreen(
    session: StudentSession,
    onHome: () -> Unit, onLearn: () -> Unit, onPractice: () -> Unit,
    onReview: () -> Unit, onBack: () -> Unit,
    fontSize: AppFontSize, onFontSizeChange: (AppFontSize) -> Unit, onLogout: () -> Unit,
    loadSettings: suspend (StudentSession) -> AccountSettings,

    request: suspend (SecurityAction, Map<String, String>, StudentSession) -> AccountSecurityResult,
    classActions: StudentClassActions,
    classStore: StudentClassesStore? = null,

    onHistory: () -> Unit = {},

    deleteAccount: suspend (StudentSession, String) -> Unit = { _, _ -> error("unavailable") },
) {
    val phone = LocalPhonePresentation.current
    val uriHandler = LocalUriHandler.current
    var accountOpen by rememberSaveable { mutableStateOf(false) }
    var sizeOpen by rememberSaveable { mutableStateOf(false) }
    var legalOpen by rememberSaveable { mutableStateOf(false) }
    var deletionOpen by rememberSaveable { mutableStateOf(false) }
    var deletionBusy by remember { mutableStateOf(false) }
    var accountBusy by remember { mutableStateOf(false) }
    var classBusy by remember { mutableStateOf(false) }
    val busy = accountBusy || classBusy
    var dirty by remember { mutableStateOf(false) }
    var pendingNavigation by remember { mutableStateOf<(() -> Unit)?>(null) }
    fun navigate(action: () -> Unit) {
        if (busy) return
        if (dirty) pendingNavigation = action else action()
    }
    val sidebarGuard = LocalTabletNavigationGuard.current
    DisposableEffect(sidebarGuard) {
        sidebarGuard?.intercept = { action -> if (!deletionBusy) navigate(action) }
        onDispose { sidebarGuard?.intercept = null }
    }
    BackHandler(enabled = deletionOpen) { if (!deletionBusy) deletionOpen = false }
    BackHandler(enabled = !deletionOpen && (busy || dirty || (phone && accountOpen))) {
        navigate { if (phone && accountOpen) accountOpen = false else onBack() }
    }
    if (deletionOpen) {
        key(session.studentId) {
            AccountDeletionPage(session, deleteAccount,
                onBusyChange = { deletionBusy = it }, onClose = { deletionOpen = false })
        }
        return
    }
    if (pendingNavigation != null) AlertDialog(
        onDismissRequest = { pendingNavigation = null },
        title = { Text("放弃未保存的修改？") },
        text = { Text("离开后，本次填写但未保存的内容将被清除。") },
        confirmButton = { TextButton(onClick = {
            val action = pendingNavigation; pendingNavigation = null; action?.invoke()
        }) { Text("放弃并离开") } },
        dismissButton = { TextButton(onClick = { pendingNavigation = null }) { Text("继续编辑") } },
    )
    if (phone && accountOpen) {
        DisposableEffect(Unit) {
            onDispose { accountBusy = false; dirty = false }
        }
        PhoneDetailPage("账号与安全", { navigate { accountOpen = false } }, showFooter = false) {
            key(session.studentId) {
                PersonalCenterPanel(session, loadSettings, request,
                    onGuardState = { saving, edited -> accountBusy = saving; dirty = edited }, externalBusy = classBusy)
            }
        }
        return
    }
    MainPage(activeTab = MainTab.Me, onHome = { navigate(onHome) },
        onLearn = { navigate(onLearn) }, onPractice = { navigate(onPractice) },
        onReview = { navigate(onReview) }, onMe = {}, onSettings = {}) {
        if (phone) {
            PhoneRootTitle("我的")
            // iOS 我的: profile with account state, account fields listed in place, then the rest.
            var account by remember(session.studentId) { mutableStateOf<AccountSettings?>(null) }
            LaunchedEffect(session.studentId, accountOpen) {
                if (!accountOpen) account = runCatching { loadSettings(session) }.getOrNull() ?: account
            }
            PhoneCard(Modifier, padding = PaddingValues(horizontal = 16.dp, vertical = 14.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(46.dp).background(PhoneColors.Primary, CircleShape), contentAlignment = Alignment.Center) {
                        PhoneIcon(PhoneSymbol.User, Modifier.size(24.dp), Color.White)
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(session.displayLabel(), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Text(phoneAccountLine(session), color = PhoneColors.Muted, style = MaterialTheme.typography.labelMedium)
                    }
                    PhoneIcon(PhoneSymbol.Next, Modifier.size(16.dp), PhoneColors.Muted)
                }
            }
            Text("账号与安全", style = MaterialTheme.typography.labelMedium, color = PhoneColors.Muted,
                modifier = Modifier.padding(start = 4.dp, bottom = 0.dp))
            PhoneCard {
                val current = account
                PhoneAccountFieldRow("用户名", current?.username ?: "…", "修改") { navigate { accountOpen = true } }
                HorizontalDivider(color = PhoneColors.Divider)
                PhoneAccountFieldRow("密码", if (current?.hasPassword == false) "未设置" else "已设置",
                    if (current?.hasPassword == false) "设置" else "修改") { navigate { accountOpen = true } }
                HorizontalDivider(color = PhoneColors.Divider)
            }
            StudentClassesPanel(session, classActions, enabled = !accountBusy && !dirty, providedStore = classStore, onBusyChange = { classBusy = it })
            PhoneCard {
                PhoneListRow("练习记录", "查看作答与批改结果", { navigate(onHistory) })
                PhoneListRow("阅读字号", "跟随系统字号，可进一步调整", { sizeOpen = true }, fontSize.label)
                Text("版本 ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.labelMedium)
                PhoneListRow("用户协议与隐私政策", "查看协议、隐私政策和未成年人保护规则", { legalOpen = true })
                PhoneListRow("注销账号", onClick = { navigate { deletionOpen = true } },
                    enabled = !busy, titleColor = Color(0xFFB42318), divider = false)
            }
            PhoneCard(Modifier.clickable(enabled = !busy, role = Role.Button) { navigate(onLogout) }) {
                Box(Modifier.fillMaxWidth().heightIn(min = 54.dp), contentAlignment = Alignment.Center) {
                    Text("退出登录", color = Color(0xFFB42318), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                }
            }
            if (sizeOpen) PhonePracticeSheet("阅读字号", { sizeOpen = false }) {
                Column {
                    AppFontSize.entries.forEach { size ->
                        PhoneListRow(size.label, onClick = { onFontSizeChange(size); sizeOpen = false },
                            trailing = if (fontSize == size) PhoneSymbol.Check else null)
                    }
                }
            }
            if (legalOpen) PhonePracticeSheet("用户协议与隐私政策", { legalOpen = false }) {
                Column {
                    legalDocuments.forEach { (label, path) ->
                        PhoneListRow(label, onClick = { runCatching { uriHandler.openUri(legalUrl(path)) } })
                    }
                }
                Spacer(Modifier.height(12.dp))
            }
            return@MainPage
        }
        // iPad 个人中心: one centred column of grouped white cards under the section title bar.
        Column(Modifier.widthIn(max = 640.dp).fillMaxWidth().align(Alignment.CenterHorizontally),
            verticalArrangement = Arrangement.spacedBy(14.dp)) {
            TabletLearningPageHeader(title = "个人中心", onHome = { navigate(onHome) })
            TabletSettingsCard {
                Row(Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.size(36.dp).background(Color(0xFF0E7C86), CircleShape), contentAlignment = Alignment.Center) {
                        PhoneIcon(PhoneSymbol.User, Modifier.size(20.dp), Color.White)
                    }
                    Column(Modifier.weight(1f)) {
                        Text(session.displayLabel(), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        Text(tabletAccountLine(session), style = MaterialTheme.typography.labelMedium, color = Color(0xFF64748B))
                    }
                    Text("账号状态", color = Color(0xFF0E7C86), style = MaterialTheme.typography.labelLarge)
                }
            }
            Text("账号与安全", Modifier.padding(start = 6.dp), style = MaterialTheme.typography.labelMedium, color = Color(0xFF64748B))
            key(session.studentId) {
                PersonalCenterPanel(session, loadSettings, request,
                    onGuardState = { saving, edited -> accountBusy = saving; dirty = edited }, externalBusy = classBusy)
            }
            StudentClassesPanel(session, classActions, enabled = !accountBusy && !dirty, providedStore = classStore, onBusyChange = { classBusy = it })
            TabletSettingsCard {
                TabletSettingsRow("练习记录", "查看作答、批改与解析", onClick = { navigate(onHistory) })
                HorizontalDivider(color = Color(0xFFE7EEF6))
                Row(Modifier.fillMaxWidth().heightIn(min = 52.dp), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("阅读字号", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                    AppFontSize.entries.forEach { size ->
                        FilterChip(selected = fontSize == size, onClick = { onFontSizeChange(size) }, label = { Text(size.label) })
                    }
                }
                HorizontalDivider(color = Color(0xFFE7EEF6))
                Text("版本 ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.labelMedium)
                legalDocuments.forEach { (label, path) ->
                    HorizontalDivider(color = Color(0xFFE7EEF6))
                    TabletSettingsRow(label, "", onClick = { runCatching { uriHandler.openUri(legalUrl(path)) } })
                }
                HorizontalDivider(color = Color(0xFFE7EEF6))
                TabletSettingsRow("注销账号", "查看注销说明与确认步骤", titleColor = Color(0xFFB42318),
                    enabled = !busy, onClick = { navigate { deletionOpen = true } })
            }
            Box(Modifier.fillMaxWidth().heightIn(min = 52.dp)
                .background(Color.White, RoundedCornerShape(20.dp))
                .clickable(enabled = !busy, role = Role.Button) { navigate(onLogout) },
                contentAlignment = Alignment.Center) {
                Text("退出登录", color = Color(0xFFDC2626), style = MaterialTheme.typography.bodyLarge)
            }
        }
    }
}
