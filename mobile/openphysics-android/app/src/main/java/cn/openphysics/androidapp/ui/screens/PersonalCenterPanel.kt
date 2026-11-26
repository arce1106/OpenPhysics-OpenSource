package cn.openphysics.androidapp.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import cn.openphysics.androidapp.data.api.AccountSecurityResult
import cn.openphysics.androidapp.data.api.AccountSettings
import cn.openphysics.androidapp.data.api.SecurityAction
import cn.openphysics.androidapp.domain.StudentSession
import cn.openphysics.androidapp.domain.UsernamePolicy
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@Composable
fun PersonalCenterPanel(owner: StudentSession, loadSettings: suspend (StudentSession) -> AccountSettings,
    request: suspend (SecurityAction, Map<String, String>, StudentSession) -> AccountSecurityResult,
    onGuardState: (Boolean, Boolean) -> Unit, externalBusy: Boolean = false) {
    var settings by remember(owner.studentId) { mutableStateOf<AccountSettings?>(null) }
    var editor by remember { mutableStateOf<String?>(null) }
    var username by remember { mutableStateOf("") }
    var currentPassword by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var notice by remember { mutableStateOf("") }
    var reload by remember { mutableIntStateOf(0) }
    var nextEditor by remember { mutableStateOf<String?>(null) }
    var confirming by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val dirty = editor?.let { if (it == "username") username != settings?.username else currentPassword.isNotEmpty() || password.isNotEmpty() || confirmation.isNotEmpty() } ?: false
    SideEffect { onGuardState(busy, dirty) }
    DisposableEffect(owner.studentId) { onDispose { onGuardState(false, false) } }
    LaunchedEffect(owner.studentId, reload) {
        try { settings = loadSettings(owner); error = "" }
        catch (failure: Exception) { if (failure is CancellationException) throw failure; error = failure.message ?: "账号信息加载失败" }
    }
    fun select(next: String?) { editor = next; username = settings?.username.orEmpty(); currentPassword = ""; password = ""; confirmation = ""; error = "" }
    fun requestSelect(next: String?) { if (dirty) { nextEditor = next; confirming = true } else select(next) }
    fun submit() {
        if (busy || externalBusy) return
        val fields = if (editor == "username") {
            if (!UsernamePolicy.valid(username.trim())) { error = UsernamePolicy.Hint; return }
            mapOf("username" to username.trim())
        } else {
            if (currentPassword.isEmpty() || password.trim().length !in 6..128 || password != confirmation) { error = "请填写原密码，确保新密码为6—128位且两次输入一致"; return }
            mapOf("current_password" to currentPassword, "new_password" to password)
        }
        busy = true; error = ""
        scope.launch {
            try { settings = checkNotNull(request(SecurityAction.Credentials, fields, owner).settings); select(null); notice = "账号设置已保存，当前登录已更新。" }
            catch (failure: Exception) { if (failure is CancellationException) throw failure; error = failure.message ?: "保存失败，请重试" }
            finally { busy = false }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        val current = settings
        if (current == null) {
            Text(if (error.isBlank()) "正在读取账号…" else error)
            if (error.isNotBlank()) TextButton(onClick = { reload++ }) { Text("重试") }
        } else {
            Text("账号与安全", style = MaterialTheme.typography.titleMedium)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("用户名：${current.username}")
                TextButton(onClick = { requestSelect("username") }, enabled = !busy && !externalBusy && current.changesRemaining > 0) { Text("修改用户名") }
            }
            TextButton(onClick = { requestSelect("password") }, enabled = !busy && !externalBusy) { Text("修改密码") }
            if (editor == "username") {
                AccountInput("新账号", username, { username = it }, !busy && !externalBusy)
                Text(UsernamePolicy.Hint, style = MaterialTheme.typography.bodySmall)
            } else if (editor == "password") {
                AccountInput("原密码", currentPassword, { currentPassword = it }, !busy && !externalBusy, secret = true)
                AccountInput("新密码", password, { password = it }, !busy && !externalBusy, secret = true)
                AccountInput("确认新密码", confirmation, { confirmation = it }, !busy && !externalBusy, secret = true)
            }
            if (editor != null) Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Button(onClick = { submit() }, enabled = !busy && !externalBusy) { Text("保存") }
                TextButton(onClick = { requestSelect(null) }, enabled = !busy && !externalBusy) { Text("取消") }
            }
            Text("忘记密码，请联系本部署的管理员核实身份后重置。", style = MaterialTheme.typography.bodySmall)
            if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
            if (notice.isNotBlank()) Text(notice)
        }
    }
    if (confirming) AlertDialog(onDismissRequest = { confirming = false }, title = { Text("放弃未保存的修改？") },
        confirmButton = { TextButton(onClick = { confirming = false; select(nextEditor) }) { Text("放弃修改") } },
        dismissButton = { TextButton(onClick = { confirming = false }) { Text("继续编辑") } })
}

@Composable
internal fun AccountInput(label: String, value: String, change: (String) -> Unit, enabled: Boolean,
    modifier: Modifier = Modifier, secret: Boolean = false) {
    OutlinedTextField(value = value, onValueChange = change, enabled = enabled, label = { Text(label) },
        singleLine = true, visualTransformation = if (secret) PasswordVisualTransformation() else VisualTransformation.None,
        modifier = modifier.fillMaxWidth())
}
