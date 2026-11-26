package cn.openphysics.androidapp.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import cn.openphysics.androidapp.data.api.StudentClassMembership
import cn.openphysics.androidapp.domain.StudentSession
import kotlinx.coroutines.launch

@Composable
fun StudentClassesPanel(owner: StudentSession, actions: StudentClassActions, enabled: Boolean = true,
    providedStore: StudentClassesStore? = null, onBusyChange: (Boolean) -> Unit) {
    val ownedStore = remember(owner.studentId, actions) { StudentClassesStore(actions) }
    val store = providedStore ?: ownedStore
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    var choosingLeave by remember(owner.studentId) { mutableStateOf(false) }
    var leaving by remember(owner.studentId) { mutableStateOf<StudentClassMembership?>(null) }
    val ready = enabled && !store.busy
    LaunchedEffect(store) { store.load(owner) }
    SideEffect { onBusyChange(store.busy) }
    DisposableEffect(store) { onDispose { store.deactivate(); onBusyChange(false) } }
    fun preview() { focus.clearFocus(); scope.launch { store.preview(owner) } }

    Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp), color = Color.White) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(Modifier.fillMaxWidth().heightIn(min = 40.dp).clickable(role = Role.Button) { store.expanded = !store.expanded }
                .testTag("classes.toggle"), verticalAlignment = Alignment.CenterVertically) {
                Text("我的班级", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                if (store.busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Text(if (store.expanded) "收起" else "展开", Modifier.padding(start = 12.dp),
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary)
            }
            if (store.expanded) {
                store.memberships.forEach { membership ->
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(membership.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                        Text(membership.teacherLabel, style = MaterialTheme.typography.bodyMedium, color = PhoneColors.Muted)
                        if (membership.archived || !membership.teacherActive) Text(if (membership.archived) "班级已归档" else "教师账号已停用",
                            style = MaterialTheme.typography.bodySmall, color = PhoneColors.Muted)
                    }
                }
                if (store.loaded && store.memberships.isEmpty()) Text("尚未加入班级", style = MaterialTheme.typography.bodyMedium, color = PhoneColors.Muted)
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedButton(onClick = { store.adding = !store.adding; store.renaming = false }, enabled = ready, modifier = Modifier.weight(1f).testTag("classes.add")) { Text("加入班级") }
                    OutlinedButton(onClick = {
                        store.renaming = !store.renaming; store.adding = false
                        if (store.renaming) store.newName = owner.displayName
                    }, enabled = ready && store.memberships.isNotEmpty(), modifier = Modifier.weight(1f).testTag("classes.rename")) { Text("修改姓名") }
                    OutlinedButton(onClick = {
                        if (store.memberships.size == 1) leaving = store.memberships.first() else choosingLeave = true
                    }, enabled = ready && store.memberships.isNotEmpty(), modifier = Modifier.weight(1f).testTag("classes.leave")) { Text("退出班级") }
                }
                if (store.adding) {
                    Text("班级邀请码", style = MaterialTheme.typography.bodyMedium)
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        ClassInput(store.code, { store.code = it }, "班级邀请码", "8 位邀请码", ready,
                            Modifier.weight(1f).testTag("classes.code"), code = true, onSearch = ::preview)
                        OutlinedButton(onClick = ::preview, enabled = enabled && store.canPreview, contentPadding = PaddingValues(horizontal = 12.dp),
                            modifier = Modifier.testTag("classes.lookup")) { Text("查看班级") }
                    }
                    store.invitation?.let { invitation ->
                        Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.primaryContainer, RoundedCornerShape(12.dp))
                            .padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                Text(invitation.membership.name, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                                if (!invitation.alreadyJoined) Button(onClick = {
                                    focus.clearFocus(); scope.launch { store.join(owner); if (store.code.isEmpty()) store.adding = false }
                                }, enabled = enabled && store.canJoin, contentPadding = PaddingValues(horizontal = 12.dp),
                                    modifier = Modifier.testTag("classes.confirm")) { Text("同意并加入") }
                            }
                            Text(invitation.membership.teacherName, color = PhoneColors.Muted, style = MaterialTheme.typography.bodyMedium)
                            if (!invitation.alreadyJoined && invitation.disclosure.isNotBlank()) Text(invitation.disclosure,
                                color = PhoneColors.Muted, style = MaterialTheme.typography.bodySmall,
                                modifier = Modifier.testTag("classes.disclosure"))
                            if (invitation.alreadyJoined) Text("已加入此班级", color = PhoneColors.Muted)
                            else {
                                Text("账号：${owner.username}", color = PhoneColors.Muted, style = MaterialTheme.typography.bodyMedium)
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    Text("学生姓名", style = MaterialTheme.typography.bodyMedium)
                                    ClassInput(store.studentName, { store.studentName = it }, "学生姓名", "填写真实姓名", ready,
                                        Modifier.weight(1f).testTag("classes.student-name"))
                                }
                            }
                        }
                    }
                }
                if (store.renaming) {
                    Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.primaryContainer, RoundedCornerShape(12.dp))
                        .padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text("学生姓名", style = MaterialTheme.typography.bodyMedium)
                            ClassInput(store.newName, { store.newName = it }, "修改学生姓名", "填写真实姓名", ready,
                                Modifier.weight(1f).testTag("classes.new-name"))
                            Button(onClick = { focus.clearFocus(); scope.launch { store.rename(owner) } }, enabled = enabled && store.canRename,
                                contentPadding = PaddingValues(horizontal = 12.dp), modifier = Modifier.testTag("classes.rename-save")) { Text("保存") }
                        }
                        Text("所有班级的老师都会看到新的姓名。", style = MaterialTheme.typography.bodySmall, color = PhoneColors.Muted)
                    }
                }
                if (store.error.isNotBlank()) Text(store.error, color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium, modifier = Modifier.testTag("classes.error"))
                if (store.notice.isNotBlank()) Text(store.notice, color = MaterialTheme.colorScheme.primary,
                    style = MaterialTheme.typography.bodyMedium, modifier = Modifier.testTag("classes.notice"))
                if (!store.loaded && !store.busy) TextButton(onClick = { scope.launch { store.load(owner) } }, enabled = enabled) { Text("重新加载") }
            }
        }
    }
    if (choosingLeave) AlertDialog(onDismissRequest = { choosingLeave = false }, title = { Text("选择要退出的班级") }, text = {
        Column { store.memberships.forEach { membership ->
            TextButton(onClick = { choosingLeave = false; leaving = membership }, modifier = Modifier.fillMaxWidth()) { Text(membership.name) }
        } }
    }, confirmButton = {}, dismissButton = { TextButton(onClick = { choosingLeave = false }) { Text("取消") } })
    leaving?.let { membership ->
        AlertDialog(onDismissRequest = { leaving = null }, title = { Text("退出${membership.name}？") },
            confirmButton = { TextButton(onClick = { leaving = null; scope.launch { store.leave(membership, owner) } }) { Text("退出班级") } },
            dismissButton = { TextButton(onClick = { leaving = null }) { Text("取消") } })
    }
}

@Composable
private fun ClassInput(value: String, onChange: (String) -> Unit, label: String, placeholder: String,
    enabled: Boolean, modifier: Modifier = Modifier, code: Boolean = false, onSearch: () -> Unit = {}) {
    val focus = LocalFocusManager.current
    BasicTextField(value, onChange, enabled = enabled, singleLine = true,
        textStyle = MaterialTheme.typography.bodyLarge.copy(color = PhoneColors.Ink),
        keyboardOptions = KeyboardOptions(capitalization = if (code) KeyboardCapitalization.Characters else KeyboardCapitalization.Words,
            autoCorrectEnabled = false, imeAction = if (code) ImeAction.Search else ImeAction.Done),
        keyboardActions = KeyboardActions(onSearch = { onSearch() }, onDone = { focus.clearFocus() }),
        modifier = modifier.semantics { contentDescription = label }.heightIn(min = 48.dp)
            .background(Color.White, RoundedCornerShape(10.dp)).border(1.dp, PhoneColors.Divider, RoundedCornerShape(10.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        decorationBox = { field -> Box(contentAlignment = Alignment.CenterStart) {
            if (value.isEmpty()) Text(placeholder, style = MaterialTheme.typography.bodyLarge, color = PhoneColors.Muted)
            field()
        } })
}
