package cn.openphysics.androidapp.ui

import android.content.SharedPreferences
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class KpAssessmentProgressStoreTest {
    @Test
    fun `progress persists across store instances and is isolated by student and knowledge point`() {
        val prefs = MemoryAssessmentPreferences()
        val store = KpAssessmentProgressStore(prefs)
        store.markInProgress("student-a", "kp-1")
        store.markCompleted("student-a", "kp-2")

        val reopened = KpAssessmentProgressStore(prefs)
        assertEquals(KpAssessmentProgress.InProgress, reopened.get("student-a", "kp-1"))
        assertEquals(KpAssessmentProgress.Completed, reopened.get("student-a", "kp-2"))
        assertNull(reopened.get("student-b", "kp-1"))
        assertNull(reopened.get("student-a", "kp-3"))
    }

    @Test
    fun `in progress cannot overwrite completed assessment`() {
        val store = KpAssessmentProgressStore(MemoryAssessmentPreferences())
        store.markInProgress("student", "kp")
        store.markCompleted("student", "kp")
        store.markInProgress("student", "kp")
        assertEquals(KpAssessmentProgress.Completed, store.get("student", "kp"))
    }
}

private class MemoryAssessmentPreferences : SharedPreferences {
    private val values = mutableMapOf<String, Any?>()
    override fun getAll(): MutableMap<String, *> = values.toMutableMap()
    override fun getString(key: String?, defValue: String?): String? = values[key] as? String ?: defValue
    @Suppress("UNCHECKED_CAST")
    override fun getStringSet(key: String?, defValues: MutableSet<String>?): MutableSet<String>? =
        values[key] as? MutableSet<String> ?: defValues
    override fun getInt(key: String?, defValue: Int): Int = values[key] as? Int ?: defValue
    override fun getLong(key: String?, defValue: Long): Long = values[key] as? Long ?: defValue
    override fun getFloat(key: String?, defValue: Float): Float = values[key] as? Float ?: defValue
    override fun getBoolean(key: String?, defValue: Boolean): Boolean = values[key] as? Boolean ?: defValue
    override fun contains(key: String?): Boolean = key in values
    override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) = Unit
    override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) = Unit
    override fun edit(): SharedPreferences.Editor = object : SharedPreferences.Editor {
        private val updates = mutableMapOf<String, Any?>()
        private var cleared = false
        private fun put(key: String?, value: Any?): SharedPreferences.Editor = apply { updates[requireNotNull(key)] = value }
        override fun putString(key: String?, value: String?) = put(key, value)
        override fun putStringSet(key: String?, values: MutableSet<String>?) = put(key, values)
        override fun putInt(key: String?, value: Int) = put(key, value)
        override fun putLong(key: String?, value: Long) = put(key, value)
        override fun putFloat(key: String?, value: Float) = put(key, value)
        override fun putBoolean(key: String?, value: Boolean) = put(key, value)
        override fun remove(key: String?) = put(key, null)
        override fun clear(): SharedPreferences.Editor = apply { cleared = true }
        override fun commit(): Boolean {
            if (cleared) values.clear()
            updates.forEach { (key, value) -> if (value == null) values.remove(key) else values[key] = value }
            return true
        }
        override fun apply() { commit() }
    }
}
