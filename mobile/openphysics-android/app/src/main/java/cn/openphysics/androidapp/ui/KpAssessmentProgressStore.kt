package cn.openphysics.androidapp.ui

import android.content.Context
import android.content.SharedPreferences
import java.security.MessageDigest

enum class KpAssessmentProgress { InProgress, Completed }

/** Records the assessment stage only; it does not preserve questions, answers or images. */
internal class KpAssessmentProgressStore(private val prefs: SharedPreferences) {
    constructor(context: Context) : this(context.getSharedPreferences(PrefsName, Context.MODE_PRIVATE))

    fun get(studentId: String, kpId: String): KpAssessmentProgress? = when (prefs.getString(key(studentId, kpId), null)) {
        InProgressValue -> KpAssessmentProgress.InProgress
        CompletedValue -> KpAssessmentProgress.Completed
        else -> null
    }

    fun markInProgress(studentId: String, kpId: String) {
        synchronized(prefs) {
            val key = key(studentId, kpId)
            if (prefs.getString(key, null) == CompletedValue) return
            check(prefs.edit().putString(key, InProgressValue).commit()) { "评估状态保存失败" }
        }
    }

    fun markCompleted(studentId: String, kpId: String) {
        synchronized(prefs) {
            check(prefs.edit().putString(key(studentId, kpId), CompletedValue).commit()) { "评估状态保存失败" }
        }
    }

    private fun key(studentId: String, kpId: String): String {
        require(studentId.isNotBlank() && kpId.isNotBlank())
        val identity = "${studentId.length}:$studentId${kpId.length}:$kpId"
        val digest = MessageDigest.getInstance("SHA-256").digest(identity.toByteArray(Charsets.UTF_8))
        return "$KeyPrefix${digest.joinToString("") { "%02x".format(it) }}"
    }

    private companion object {
        const val PrefsName = "openphysics_kp_assessment_progress"
        const val KeyPrefix = "kp-assessment:v1:"
        const val InProgressValue = "in_progress"
        const val CompletedValue = "completed"
    }
}
