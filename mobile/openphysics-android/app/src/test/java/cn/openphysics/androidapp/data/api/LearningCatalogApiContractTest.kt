package cn.openphysics.androidapp.data.api

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

class LearningCatalogApiContractTest {
    @Test
    fun `gaokao uses reusable learning catalog endpoints and rendered sessions`() {
        val source = File("src/main/java/cn/openphysics/androidapp/data/api/ApiClient.kt").readText()

        assertTrue(source.contains("/learning-catalogs/\${enc(catalogCode)}"))
        assertTrue(source.contains("/learning-catalogs/\${enc(catalogCode)}/resume"))
        assertTrue(source.contains("/nodes/\${enc(nodeId)}/overview"))
        assertTrue(source.contains("/nodes/\${enc(nodeId)}/session"))
        assertTrue(source.contains("/nodes/\${enc(nodeId)}/evidence"))
        assertTrue(source.contains("withRenderedContent("))
        assertTrue(source.contains(".put(\"answer_id\", answerId)"))
    }
}
