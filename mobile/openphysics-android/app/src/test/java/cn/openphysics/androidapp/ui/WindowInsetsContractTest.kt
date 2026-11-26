package cn.openphysics.androidapp.ui

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

class WindowInsetsContractTest {
    @Test
    fun `activity enables edge to edge and app root consumes system insets`() {
        val activity = sourceFile("src/main/java/cn/openphysics/androidapp/MainActivity.kt").readText()
        val app = sourceFile("src/main/java/cn/openphysics/androidapp/ui/OpenPhysicsApp.kt").readText()
        val manifest = sourceFile("src/main/AndroidManifest.xml").readText()

        assertTrue(activity.contains("enableEdgeToEdge()"))
        assertTrue(app.contains(".windowInsetsPadding(WindowInsets.safeDrawing)"))
        assertTrue(app.contains(".imePadding()"))
        assertTrue(manifest.contains("android:windowSoftInputMode=\"adjustResize\""))
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
