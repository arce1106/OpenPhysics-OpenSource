package cn.openphysics.androidapp.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PanePreviewWebViewClientTest {
    private val pane = "https://openphysics.example/panes/learning-content/"

    @Test
    fun previewMustBeExplicitlyEnabled() {
        assertNull(bundledPaneAssetPath(pane, pane, false))
        assertEquals("panes/learning-content/index.html", bundledPaneAssetPath(pane, pane, true))
        assertEquals("panes/learning-content/assets/index-Ab_12.js",
            bundledPaneAssetPath("${pane}assets/index-Ab_12.js?v=1", pane, true))
    }

    @Test
    fun apiImagesAndExternalOriginsStillUseTheNetwork() {
        listOf(
            "https://openphysics.example/api/student/history",
            "https://openphysics.example/static/answers/image.png?signature=abc",
            "https://other.example/panes/learning-content/",
            "http://openphysics.example/panes/learning-content/",
            "https://openphysics.example:8443/panes/learning-content/",
            "https://user@openphysics.example/panes/learning-content/",
        ).forEach { assertNull(bundledPaneAssetPath(it, pane, true)) }
    }

    @Test
    fun onlyBuiltPaneFilesCanBeReadFromAssets() {
        listOf("../secret", "assets/../../secret", "assets/%2e%2e/secret", "assets//file.js", "other.json")
            .forEach { assertNull(bundledPaneAssetPath(pane + it, pane, true)) }
    }
}
