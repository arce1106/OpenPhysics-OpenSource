package cn.openphysics.androidapp.data.api

import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.concurrent.thread
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class StudentClassesApiTest {
    private val sample = """{"id":"class-a","name":"高三（3）","teacher_name":"王老师","student_number":"007","archived":false,"teacher_active":true}"""

    @Test fun transportUsesSameMembershipEndpointsOwnerAndNameWithoutAiCalls() {
        val calls = CopyOnWriteArrayList<String>()
        val server = ClassTestServer { request ->
            assertEquals("Bearer current-token", request.headers["authorization"])
            val path = request.path; val method = request.method
            calls.add("$method $path")
            val body = request.body
            val result = when {
                path.endsWith("/preview") -> {
                    assertEquals(setOf("code"), JSONObject(body).keySet())
                    JSONObject(sample).put("already_joined", false).put("disclosure_version", "version-1").toString()
                }
                path.endsWith("/join") -> {
                    val payload = JSONObject(body)
                    assertEquals(setOf("code", "disclosure_version", "student_name"), payload.keySet())
                    assertEquals("AM7EMGX6", payload.getString("code")); assertEquals("张三", payload.getString("student_name"))
                    assertEquals("version-1", payload.getString("disclosure_version"))
                    JSONObject(sample).put("added", true).put("student_name", "张三").toString()
                }
                method == "DELETE" -> ""
                else -> "[$sample]"
            }
            (if (method == "DELETE") 204 else 200) to result
        }
        try {
            val api = ApiClient(baseUrl = "http://127.0.0.1:${server.port}/api/student")
            assertEquals("007", api.getStudentClasses("current-token").single().studentNumber)
            val preview = api.previewClassInvitation(" am7emgx6 ", "current-token")
            assertEquals("王老师", preview.membership.teacherName)
            assertEquals("张三", api.joinStudentClass("AM7EMGX6", preview.disclosureVersion, " 张三 ", "current-token").studentName)
            api.leaveStudentClass("class-a", "current-token")
            assertEquals(listOf("GET /api/student/classes", "POST /api/student/class-invitations/preview",
                "POST /api/student/classes/join", "DELETE /api/student/classes/class-a"), calls)
        } finally { server.close() }
    }

    @Test fun unauthorizedMembershipReadUsesExistingLogoutNotification() {
        val server = ClassTestServer { 401 to """{"detail":"登录已失效"}""" }
        try {
            val rejected = mutableListOf<String>()
            val api = ApiClient(onUnauthorized = { rejected.add(it) }, baseUrl = "http://127.0.0.1:${server.port}")
            val error = assertThrows(ApiHttpException::class.java) { api.getStudentClasses("expired-token") }
            assertEquals(401, error.statusCode); assertEquals(listOf("expired-token"), rejected)
        } finally { server.close() }
    }

    @Test fun invalidNameIsRejectedBeforeAnyRequestAndPreviewNeverSendsStudentIdentity() {
        assertEquals(setOf("code"), classInvitationPayload("AM7EMGX6").keySet())
        for (name in listOf("", "  ", "张\n三", "张".repeat(41))) {
            assertThrows(IllegalArgumentException::class.java) { classInvitationPayload("AM7EMGX6", "v1", name) }
        }
        assertTrue(validStudentClassName("张三")); assertTrue(validStudentClassName("Li Hua"))
        assertNull(parseStudentClass(JSONObject(sample).put("student_number", JSONObject.NULL)).studentNumber)
    }
}

private data class ClassTestRequest(val method: String, val path: String, val headers: Map<String, String>, val body: String)

/** Real HTTP transport without additional Android/JDK-specific server dependencies. */
private class ClassTestServer(respond: (ClassTestRequest) -> Pair<Int, String>) : AutoCloseable {
    private val socket = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
    val port: Int get() = socket.localPort
    private val worker = thread(isDaemon = true) {
        while (!socket.isClosed) {
            val connection = try { socket.accept() } catch (_: Exception) { break }
            connection.use { client ->
                client.soTimeout = 5000
                val input = client.getInputStream()
                val header = StringBuilder()
                while (!header.endsWith("\r\n\r\n")) {
                    val next = input.read(); if (next < 0) break; header.append(next.toChar())
                }
                val lines = header.toString().split("\r\n")
                val first = lines.first().split(' ')
                val headers = lines.drop(1).filter { ':' in it }.associate {
                    it.substringBefore(':').lowercase() to it.substringAfter(':').trim()
                }
                val body = ByteArray(headers["content-length"]?.toInt() ?: 0)
                var offset = 0
                while (offset < body.size) {
                    val read = input.read(body, offset, body.size - offset); if (read < 0) break; offset += read
                }
                val response = try {
                    respond(ClassTestRequest(first[0], first[1], headers, body.toString(Charsets.UTF_8)))
                } catch (failure: Throwable) { 500 to JSONObject().put("detail", failure.toString()).toString() }
                val bytes = response.second.toByteArray(Charsets.UTF_8)
                client.getOutputStream().apply {
                    write("HTTP/1.1 ${response.first} Result\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray())
                    if (response.first != 204) write(bytes)
                    flush()
                }
            }
        }
    }
    override fun close() { socket.close(); worker.join(1000) }
}
