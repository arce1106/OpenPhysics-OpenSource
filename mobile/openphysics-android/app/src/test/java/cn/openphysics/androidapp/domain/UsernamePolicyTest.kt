package cn.openphysics.androidapp.domain

import java.io.File
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class UsernamePolicyTest {
    @Test fun sharedClientServerCases() {
        val fixture = generateSequence(File(requireNotNull(System.getProperty("user.dir")))) { it.parentFile }
            .map { File(it, "frontend/shared/username-policy-cases.json") }.first { it.isFile }
        val cases = JSONObject(fixture.readText())
        for (group in listOf("valid", "invalid")) {
            val values = cases.getJSONArray(group)
            for (index in 0 until values.length()) {
                val value = values.getString(index)
                assertEquals(value, group == "valid", UsernamePolicy.valid(value))
            }
        }
        assertEquals(10, UsernamePolicy.length("演示学习者"))
        assertEquals(13, UsernamePolicy.length("物理seed_2026"))
    }
}
