package cn.openphysics.androidapp.ui.screens

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import cn.openphysics.androidapp.data.api.*
import cn.openphysics.androidapp.domain.StudentSession
import kotlinx.coroutines.CancellationException

data class StudentClassActions(
    val load: suspend (StudentSession) -> List<StudentClassMembership>,
    val preview: suspend (String, StudentSession) -> StudentClassInvitation,
    val join: suspend (String, String, String, StudentSession) -> StudentClassJoinResult,
    val leave: suspend (StudentClassMembership, StudentSession) -> Unit,
    /** Corrects the real name every class teacher sees; returns the saved name. */
    val rename: suspend (String, StudentSession) -> String = { _, _ -> error("当前版本不支持修改姓名") },
)

class StudentClassesStore(private val actions: StudentClassActions) {
    var expanded by mutableStateOf(true)
    var adding by mutableStateOf(false)
    var memberships by mutableStateOf<List<StudentClassMembership>>(emptyList()); private set
    var invitation by mutableStateOf<StudentClassInvitation?>(null); private set
    var busy by mutableStateOf(false); private set
    var loaded by mutableStateOf(false); private set
    var error by mutableStateOf(""); private set
    var notice by mutableStateOf(""); private set
    var studentName by mutableStateOf("")
    var renaming by mutableStateOf(false)
    var newName by mutableStateOf("")
    val canRename: Boolean get() = !busy && memberships.isNotEmpty() && validStudentClassName(newName)
    private var rawCode by mutableStateOf("")
    var code: String
        get() = rawCode
        set(value) { rawCode = value; invitation = null; previewedCode = null; error = ""; notice = "" }
    val canPreview: Boolean get() = !busy && validClassCode(code)
    val canJoin: Boolean get() = !busy && validStudentClassName(studentName) && invitation?.alreadyJoined == false
        && previewedCode == normalizeClassCode(code)
    private var studentId: String? = null
    private var generation = 0L
    private var previewedCode: String? = null

    fun deactivate() {
        generation++; studentId = null; memberships = emptyList(); invitation = null
        code = ""; studentName = ""; busy = false; loaded = false; error = ""; notice = ""
        expanded = true; adding = false; renaming = false; newName = ""
    }

    suspend fun load(owner: StudentSession) {
        if (studentId != owner.studentId) { deactivate(); studentId = owner.studentId }
        perform(owner) {
            val result = actions.load(owner)
            return@perform { memberships = result; loaded = true }
        }
    }

    suspend fun preview(owner: StudentSession) {
        if (!canPreview) return
        val requestedCode = normalizeClassCode(code)
        invitation = null; previewedCode = null
        perform(owner) {
            val result = actions.preview(requestedCode, owner)
            return@perform {
                if (normalizeClassCode(code) == requestedCode) { invitation = result; previewedCode = requestedCode }
            }
        }
    }

    suspend fun join(owner: StudentSession) {
        if (!canJoin) return
        val preview = invitation ?: return
        val name = studentName.trim()
        val requestedCode = previewedCode ?: return
        perform(owner) {
            val result = actions.join(requestedCode, preview.disclosureVersion, name, owner)
            return@perform {
                memberships = listOf(result.membership) + memberships.filterNot { it.id == result.membership.id }
                loaded = true; code = ""; notice = "已加入班级"
            }
        }
    }

    suspend fun rename(owner: StudentSession) {
        if (!canRename) return
        val name = newName.trim()
        perform(owner) {
            val saved = actions.rename(name, owner)
            return@perform { newName = saved; renaming = false; notice = "姓名已更新为 $saved" }
        }
    }

    suspend fun leave(membership: StudentClassMembership, owner: StudentSession) {
        if (memberships.none { it.id == membership.id }) return
        perform(owner) {
            actions.leave(membership, owner)
            return@perform {
                memberships = memberships.filterNot { it.id == membership.id }
                invitation = null; previewedCode = null; notice = "已退出班级"
            }
        }
    }

    private suspend fun perform(owner: StudentSession, action: suspend () -> (() -> Unit)) {
        if (busy || studentId != owner.studentId) return
        val requestGeneration = generation
        busy = true; error = ""; notice = ""
        try {
            val apply = action()
            if (generation == requestGeneration) apply()
        } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            if (generation == requestGeneration) {
                error = failure.message ?: "操作失败，请重试"
                invitation = null; previewedCode = null
            }
        } finally { if (generation == requestGeneration) busy = false }
    }
}
