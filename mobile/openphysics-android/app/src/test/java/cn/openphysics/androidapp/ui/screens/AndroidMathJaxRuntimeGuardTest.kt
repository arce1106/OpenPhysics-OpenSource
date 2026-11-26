package cn.openphysics.androidapp.ui.screens

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class AndroidMathJaxRuntimeGuardTest {
    @Test
    fun androidMainSourcesDoNotReferenceMathJaxRuntime() {
        val sourceRoot = File("src/main/java")
        val forbidden = listOf("MathJax", "tex-svg.js", "CdnMathJax", "LocalMathJax")
        val matches = sourceRoot
            .walkTopDown()
            .filter { it.isFile && it.extension in setOf("kt", "java") }
            .flatMap { file ->
                file.readLines().mapIndexedNotNull { index, line ->
                    val token = forbidden.firstOrNull { line.contains(it) }
                    if (token == null) null else "${file.relativeTo(sourceRoot)}:${index + 1}:$token"
                }
            }
            .toList()

        assertTrue(
            "Android main sources still reference MathJax runtime:\n${matches.joinToString("\n")}",
            matches.isEmpty(),
        )
    }
}
