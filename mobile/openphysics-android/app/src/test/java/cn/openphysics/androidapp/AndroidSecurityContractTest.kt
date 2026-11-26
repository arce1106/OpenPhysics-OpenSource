package cn.openphysics.androidapp

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidSecurityContractTest {
    @Test
    fun `release manifest disables cleartext and application backup`() {
        val manifest = sourceFile("src/main/AndroidManifest.xml").readText()
        val networkConfig = sourceFile("src/main/res/xml/network_security_config.xml").readText()
        val backupRules = sourceFile("src/main/res/xml/backup_rules.xml").readText()
        val extractionRules = sourceFile("src/main/res/xml/data_extraction_rules.xml").readText()
        val gradle = sourceFile("build.gradle").readText()

        assertTrue(manifest.contains("android:usesCleartextTraffic=\"false\""))
        assertTrue(manifest.contains("android:allowBackup=\"false\""))
        assertTrue(networkConfig.contains("cleartextTrafficPermitted=\"false\""))
        assertTrue(backupRules.contains("domain=\"sharedpref\" path=\".\""))
        assertTrue(extractionRules.contains("<cloud-backup>"))
        assertTrue(extractionRules.contains("<device-transfer>"))
        assertTrue(gradle.contains("https://openphysics.example/api/student"))
    }

    @Test
    fun `debug overlay alone permits local cleartext traffic`() {
        val manifest = sourceFile("src/debug/AndroidManifest.xml").readText()
        val networkConfig = sourceFile("src/debug/res/xml/network_security_config.xml").readText()

        assertTrue(manifest.contains("android:usesCleartextTraffic=\"true\""))
        assertTrue(networkConfig.contains("cleartextTrafficPermitted=\"true\""))
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
