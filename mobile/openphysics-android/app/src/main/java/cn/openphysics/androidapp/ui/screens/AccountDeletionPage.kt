package cn.openphysics.androidapp.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import cn.openphysics.androidapp.domain.StudentSession
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@Composable
internal fun AccountDeletionPage(owner: StudentSession, deleteAccount: suspend (StudentSession, String) -> Unit,
    onBusyChange: (Boolean) -> Unit, onClose: () -> Unit) {
    var password by remember { mutableStateOf("") }
    var confirmed by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    SideEffect { onBusyChange(busy) }
    DisposableEffect(owner.studentId) { onDispose { onBusyChange(false) } }
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("注销账号", style = MaterialTheme.typography.headlineSmall)
        Text("注销会删除本账号的学习记录、作答与相关个人数据，且无法撤销。其他学生的数据不受影响。")
        AccountInput("当前密码", password, { password = it }, !busy, secret = true)
        Row { Checkbox(checked = confirmed, onCheckedChange = { confirmed = it }, enabled = !busy); Text("我已了解注销影响，并确认注销本账号") }
        if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
        Button(onClick = {
            if (!busy && confirmed && password.isNotEmpty()) { busy = true; scope.launch {
                try { deleteAccount(owner, password); password = "" }
                catch (failure: Exception) { if (failure is CancellationException) throw failure; error = failure.message ?: "注销失败，请重试" }
                finally { busy = false }
            } }
        }, enabled = !busy && confirmed && password.isNotEmpty()) { Text(if (busy) "处理中…" else "确认注销") }
        TextButton(onClick = onClose, enabled = !busy) { Text("返回") }
    }
}
