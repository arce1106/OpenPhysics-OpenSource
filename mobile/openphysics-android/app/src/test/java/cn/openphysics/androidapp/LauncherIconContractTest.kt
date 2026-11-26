package cn.openphysics.androidapp

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

class LauncherIconContractTest {
    @Test
    fun `adaptive icon foreground stays inside conservative launcher safe zone`() {
        val foreground = sourceFile("src/main/res/drawable/ic_launcher_foreground.xml").readText()
        val adaptiveIcon = sourceFile("src/main/res/mipmap-anydpi-v26/ic_launcher.xml").readText()
        val adaptiveRoundIcon = sourceFile("src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml").readText()

        assertTrue(foreground.contains("android:scaleX=\"0.68\""))
        assertTrue(foreground.contains("android:scaleY=\"0.68\""))
        assertTrue(adaptiveIcon.contains("@drawable/ic_launcher_foreground"))
        assertTrue(adaptiveRoundIcon.contains("@drawable/ic_launcher_foreground"))
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
