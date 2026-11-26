package cn.openphysics.androidapp.ui.screens

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TutorAssistantKeyboardTest {
    @Test
    fun `empty tutor keeps quick prompts before the student starts typing`() {
        val state = tutorAssistantPresentationState(
            hasMessages = false,
            inputFocused = false,
            imeVisible = false,
        )

        assertEquals(true, state.showQuickPrompts)
        assertEquals(false, state.compactComposer)
        assertEquals(true, state.allowDialogDrag)
    }

    @Test
    fun `focused tutor prioritizes the composer over quick prompts`() {
        val state = tutorAssistantPresentationState(
            hasMessages = false,
            inputFocused = true,
            imeVisible = true,
        )

        assertEquals(false, state.showQuickPrompts)
        assertEquals(true, state.compactComposer)
        assertEquals(false, state.allowDialogDrag)
    }

    @Test
    fun `visible keyboard alone enters focused presentation`() {
        val state = tutorAssistantPresentationState(
            hasMessages = false,
            inputFocused = false,
            imeVisible = true,
        )

        assertEquals(false, state.showQuickPrompts)
        assertEquals(true, state.compactComposer)
        assertEquals(false, state.allowDialogDrag)
    }

    @Test
    fun `tutor dialog owns keyboard avoidance and send action`() {
        val source = sourceFile(
            "src/main/java/cn/openphysics/androidapp/ui/screens/TutorAssistantComponents.kt",
        ).readText()

        assertTrue(source.contains("decorFitsSystemWindows = false"))
        assertTrue(source.contains("WindowInsets.safeDrawing.only("))
        assertTrue(source.contains(".windowInsetsPadding(WindowInsets.ime)"))
        assertTrue(source.contains("ImeAction.Send"))
        assertTrue(source.contains(".bringIntoViewRequester("))
    }

    private fun sourceFile(relativePath: String): File {
        val candidates = listOf(
            File(relativePath),
            File("app/$relativePath"),
            File("mobile/openphysics-android/app/$relativePath"),
        )
        return candidates.firstOrNull(File::isFile)
            ?: error("Cannot locate Android source file: $relativePath")
    }
}
