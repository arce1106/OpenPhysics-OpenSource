package cn.openphysics.androidapp.ui.screens

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import cn.openphysics.androidapp.BuildConfig
import cn.openphysics.androidapp.data.api.LoginCaptcha
import cn.openphysics.androidapp.data.api.LoginCredentials
import kotlinx.coroutines.launch

internal object LoginScreenCopy {
    const val PasswordTab = "账号密码登录"
    const val Agreement = "登录即表示同意"
}
@Composable
fun LoginScreen(message: String = "", busy: Boolean, captchaRequired: Boolean,
                onLogin: (LoginCredentials) -> Unit, loadCaptcha: suspend () -> LoginCaptcha) {
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var captcha by remember { mutableStateOf<LoginCaptcha?>(null) }
    var answer by remember { mutableStateOf("") }
    var captchaBusy by remember { mutableStateOf(false) }
    var localError by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    fun refresh() { scope.launch {
        captchaBusy = true; captcha = null; answer = ""
        try { captcha = loadCaptcha() } catch (error: Exception) { localError = error.message ?: "验证码加载失败" }
        finally { captchaBusy = false }
    } }
    LaunchedEffect(captchaRequired) { if (captchaRequired) refresh() }
    val valid = username.isNotBlank() && password.isNotEmpty() && !busy &&
        (!captchaRequired || (!captchaBusy && captcha != null && answer.isNotBlank()))
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(Modifier.widthIn(max = 480.dp).padding(24.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("OpenPhysics", style = MaterialTheme.typography.headlineLarge)
            Text("学生登录", style = MaterialTheme.typography.titleLarge)
            OutlinedTextField(value = username, onValueChange = { username = it }, label = { Text("账号") }, singleLine = true, enabled = !busy, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = password, onValueChange = { password = it }, label = { Text("密码") }, singleLine = true, enabled = !busy,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
            if (captchaRequired) {
                captcha?.let { challenge ->
                    val image = remember(challenge.imageBase64) { runCatching { BitmapFactory.decodeByteArray(Base64.decode(challenge.imageBase64.substringAfter(','), Base64.DEFAULT), 0, Base64.decode(challenge.imageBase64.substringAfter(','), Base64.DEFAULT).size).asImageBitmap() }.getOrNull() }
                    image?.let { Image(it, "图形验证码", Modifier.height(64.dp)) }
                }
                OutlinedTextField(value = answer, onValueChange = { answer = it }, label = { Text("图形验证码") }, singleLine = true, enabled = !busy)
                TextButton(onClick = { refresh() }, enabled = !busy && !captchaBusy) { Text("换一张") }
            }
            if (message.isNotBlank() || localError.isNotBlank()) Text(localError.ifBlank { message }, color = MaterialTheme.colorScheme.error)
            Button(onClick = { if (valid) onLogin(LoginCredentials(username.trim(), password, captchaId = captcha?.id.orEmpty(), captchaAnswer = answer.trim())) }, enabled = valid, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "登录中…" else "登录") }
            Text("账号开通或忘记密码，请联系本部署的管理员。", style = MaterialTheme.typography.bodyMedium)
            Text("登录即表示同意本部署的用户协议和隐私政策。", style = MaterialTheme.typography.bodySmall)
            Text("版本 ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.labelSmall)
        }
    }
}
