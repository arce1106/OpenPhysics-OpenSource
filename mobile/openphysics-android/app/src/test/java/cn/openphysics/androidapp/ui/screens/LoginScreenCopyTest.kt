package cn.openphysics.androidapp.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class LoginScreenCopyTest {
    @Test
    fun `login card keeps copy concise without student login phrasing`() {
        assertEquals("账号密码登录", LoginScreenCopy.PasswordTab)
        assertEquals("登录即表示同意", LoginScreenCopy.Agreement)
    }
}
