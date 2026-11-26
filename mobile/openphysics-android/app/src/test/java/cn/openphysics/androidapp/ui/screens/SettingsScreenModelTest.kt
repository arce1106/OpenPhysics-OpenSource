package cn.openphysics.androidapp.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Test

class SettingsScreenModelTest {

    @Test
    fun `settings environment label distinguishes cloud local and custom service`() {
        assertEquals("云端服务", settingsEnvironmentLabel("https://openphysics.example/api/student"))
        assertEquals("本地服务", settingsEnvironmentLabel("http://10.0.2.2:8000/api/student"))
        assertEquals("自定义服务", settingsEnvironmentLabel("https://physics.example.com/api/student"))
    }

    @Test
    fun `settings api host extracts a compact host label`() {
        assertEquals("openphysics.example", settingsApiHost("https://openphysics.example/api/student"))
        assertEquals("10.0.2.2:8000", settingsApiHost("http://10.0.2.2:8000/api/student"))
        assertEquals("未配置", settingsApiHost(""))
    }
}
