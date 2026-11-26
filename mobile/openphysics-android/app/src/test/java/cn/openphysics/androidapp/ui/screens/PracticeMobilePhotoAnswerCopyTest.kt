package cn.openphysics.androidapp.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Test

class PracticeMobilePhotoAnswerCopyTest {
    @Test
    fun `mobile photo answer copy keeps save first then batch grading flow`() {
        assertEquals("拍照上传作答", MobilePhotoAnswerCopy.Title)
        assertEquals("先保存本题作答，最后统一提交批改。", MobilePhotoAnswerCopy.Subtitle)
        assertEquals("保存本题作答", MobilePhotoAnswerCopy.SavePendingPhoto)
        assertEquals("本题作答已保存", MobilePhotoAnswerCopy.SavedStatus)
        assertEquals("最后提交整套时会统一批改。", MobilePhotoAnswerCopy.SavedHint)
    }
}
