package cn.openphysics.androidapp.data.api

import org.junit.Assert.assertEquals
import org.junit.Test

class ResourceUrlsTest {
    @Test
    fun preservesSignedQueryAndAlreadyEncodedFilename() {
        val path = "/api/student/answer-images/student-1/%E7%AD%94%E6%A1%88%201.jpg?expires=2000000000&signature=a%2Bb%3D#preview"
        val url = ResourceUrls.resolve("https://openphysics.example/api/student", path)

        assertEquals("https://openphysics.example$path", url)
        assertEquals("expires=2000000000&signature=a%2Bb%3D", java.net.URI(url).rawQuery)
        assertEquals("preview", java.net.URI(url).rawFragment)
    }

    @Test
    fun encodesOnlyRawPathWhenSignedQueryIsPresent() {
        assertEquals(
            "https://openphysics.example/static/questions/%E7%AD%94%E6%A1%88%20%281%29.jpg?signature=a+b%2Fc&expires=2000000000",
            ResourceUrls.resolve("https://openphysics.example/api/student", "static/questions/答案 (1).jpg?signature=a+b%2Fc&expires=2000000000"),
        )
    }

    @Test
    fun resolvesRelativeStaticQuestionImageAgainstApiOrigin() {
        val url = ResourceUrls.resolve(
            apiBaseUrl = "https://openphysics.example/api/student",
            imagePath = "/static/questions/第一章 1_image1.png",
        )

        assertEquals(
            "https://openphysics.example/static/questions/%E7%AC%AC%E4%B8%80%E7%AB%A0%201_image1.png",
            url,
        )
    }

    @Test
    fun leavesAbsoluteUrlsUsable() {
        val url = ResourceUrls.resolve(
            apiBaseUrl = "http://10.0.2.2:8000/api/student",
            imagePath = "https://example.com/static/questions/a.png",
        )

        assertEquals("https://example.com/static/questions/a.png", url)
    }
}
