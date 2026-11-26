package cn.openphysics.androidapp.data.api

import java.util.Locale
import org.json.JSONObject

data class StudentClassMembership(
    val id: String,
    val name: String,
    val teacherName: String,
    val studentNumber: String?,
    val archived: Boolean,
    val teacherActive: Boolean,
) {
    val teacherLabel: String get() = listOfNotNull(teacherName,
        studentNumber?.takeIf { it.isNotBlank() }?.let { "学号 $it" }).joinToString(" · ")
}

data class StudentClassInvitation(
    val membership: StudentClassMembership,
    val alreadyJoined: Boolean,
    val disclosureVersion: String,
    /** What joining shares with the teacher; shown before the student agrees. */
    val disclosure: String = "",
)

/** An invitation looked up before signing in: the class, its teacher and what joining shares. */
data class PublicClassInvitation(
    val name: String,
    val teacherName: String,
    val disclosureVersion: String,
    val disclosure: String,
)

data class StudentClassJoinResult(val membership: StudentClassMembership, val studentName: String)

internal fun normalizeClassCode(code: String): String = code.trim().uppercase(Locale.ROOT)
internal fun validClassCode(code: String): Boolean = Regex("[A-Z0-9]{8}").matches(normalizeClassCode(code))
internal fun validStudentClassName(value: String): Boolean {
    val name = value.trim()
    return name.isNotEmpty() && name.codePointCount(0, name.length) <= 40 && name.none {
        Character.isISOControl(it) || Character.getType(it) in setOf(
            Character.FORMAT.toInt(), Character.PRIVATE_USE.toInt(), Character.UNASSIGNED.toInt(),
            Character.LINE_SEPARATOR.toInt(), Character.PARAGRAPH_SEPARATOR.toInt(),
        ) || (Character.isSpaceChar(it) && it != ' ')
    }
}

internal fun parseStudentClass(json: JSONObject) = StudentClassMembership(
    id = json.getString("id"), name = json.getString("name"), teacherName = json.getString("teacher_name"),
    studentNumber = if (json.isNull("student_number")) null else json.getString("student_number"),
    archived = json.getBoolean("archived"), teacherActive = json.getBoolean("teacher_active"),
)

internal fun parseClassInvitation(json: JSONObject) = StudentClassInvitation(
    parseStudentClass(json), json.getBoolean("already_joined"), json.getString("disclosure_version"),
    json.optString("disclosure", ""),
)

internal fun parsePublicClassInvitation(json: JSONObject) = PublicClassInvitation(
    name = json.getString("name"), teacherName = json.getString("teacher_name"),
    disclosureVersion = json.getString("disclosure_version"), disclosure = json.optString("disclosure", ""),
)

internal fun classInvitationPayload(code: String, disclosureVersion: String? = null, studentName: String? = null): JSONObject {
    require(validClassCode(code)) { "请输入8位班级邀请码" }
    return JSONObject().put("code", normalizeClassCode(code)).apply {
        if (disclosureVersion != null) {
            require(disclosureVersion.isNotBlank()) { "请重新查看班级后加入" }
            require(studentName != null && validStudentClassName(studentName)) { "请填写学生真实姓名（1—40字）" }
            put("disclosure_version", disclosureVersion)
            put("student_name", studentName!!.trim())
        }
    }
}
