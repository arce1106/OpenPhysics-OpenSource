import XCTest
@testable import OpenPhysicsIOS

@MainActor
final class StudentClassesTests: XCTestCase {
    private var student: StudentSession {
        StudentSession(token: "class-test-token", studentID: "class-test-student", username: "测试学生",
            displayName: "测试学生", accountStatus: "active")
    }

    private func fixture() -> (StudentClassesStore, APIClient) {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ClassTestURLProtocol.self]
        let api = APIClient(authorizeAI: { _, _, _ in XCTFail("Class membership must not request AI consent") },
            baseURL: URL(string: "https://classes.test/api/student")!, session: URLSession(configuration: config))
        let store = StudentClassesStore(api: api)
        return (store, api)
    }

    override func tearDown() { ClassTestURLProtocol.handler = nil; super.tearDown() }

    func testPreviewConfirmJoinAndLeaveUseCurrentAccountAndDisclosureVersion() async throws {
        var requests: [String] = []
        ClassTestURLProtocol.handler = { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer class-test-token")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-OpenPhysics-Privacy-Client"), "ios")
            let path = request.url!.path
            requests.append("\(request.httpMethod!) \(path)")
            if path.hasSuffix("/preview") {
                XCTAssertEqual(try request.jsonBody()["code"] as? String, "AM7EMGX6")
                return (200, classJSON(preview: true))
            }
            if path.hasSuffix("/join") {
                let body = try request.jsonBody()
                XCTAssertEqual(body["code"] as? String, "AM7EMGX6")
                XCTAssertEqual(body["disclosure_version"] as? String, "class-sharing-test")
                XCTAssertNil(body["student_id"])
                XCTAssertEqual(body["student_name"] as? String, "张三")
                return (200, classJSON())
            }
            if request.httpMethod == "DELETE" { return (204, Data()) }
            XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalCacheData)
            return (200, Data("[]".utf8))
        }
        let (store, _) = fixture()
        await store.load(for: student)
        store.studentName = " 张三 "
        store.code = " am7emgx6 "
        await store.preview(for: student)
        XCTAssertEqual(store.invitation?.membership.teacherName, "王老师")
        XCTAssertTrue(store.memberships.isEmpty, "Preview must not join the class")
        await store.join(for: student)
        XCTAssertEqual(store.memberships.first?.studentNumber, "007")
        XCTAssertNil(store.invitation)
        XCTAssertEqual(store.code, "")
        await store.leave(try XCTUnwrap(store.memberships.first), for: student)
        XCTAssertTrue(store.memberships.isEmpty)
        XCTAssertEqual(requests, ["GET /api/student/classes", "POST /api/student/class-invitations/preview",
            "POST /api/student/classes/join", "DELETE /api/student/classes/class-1"])
    }

    func testEditedCodeCannotJoinAnOldPreviewAndInvalidCodesDoNotSendRequests() async {
        var calls = 0
        ClassTestURLProtocol.handler = { request in
            calls += 1
            return request.url!.path.hasSuffix("/preview") ? (200, classJSON(preview: true)) : (200, Data("[]".utf8))
        }
        let (store, _) = fixture()
        await store.load(for: student)
        store.studentName = " 张三 "
        store.code = "123"; await store.preview(for: student)
        XCTAssertEqual(calls, 1)
        store.code = "AM7EMGX6"; await store.preview(for: student)
        store.code = "BN8FNHR7"
        await store.join(for: student)
        XCTAssertNil(store.invitation)
        XCTAssertEqual(calls, 2)
    }

    func testExpiredInvitationAndUnauthorizedSessionStayUnjoinedAndCanRetry() async {
        var previewCalls = 0
        ClassTestURLProtocol.handler = { request in
            if request.url!.path.hasSuffix("/preview") {
                previewCalls += 1
                return previewCalls == 1 ? (410, Data(#"{"detail":"邀请码已过期"}"#.utf8)) : (200, classJSON(preview: true))
            }
            if request.url!.path.hasSuffix("/join") { return (401, Data(#"{"detail":"登录失效"}"#.utf8)) }
            return (200, Data("[]".utf8))
        }
        let (store, _) = fixture()
        await store.load(for: student)
        store.studentName = " 张三 "
        store.code = "AM7EMGX6"; await store.preview(for: student)
        XCTAssertTrue(store.message.contains("邀请码已过期"))
        XCTAssertFalse(store.busy)
        await store.preview(for: student)
        XCTAssertNotNil(store.invitation)
        await store.join(for: student)
        XCTAssertTrue(store.sessionExpired)
        XCTAssertNil(store.invitation)
        XCTAssertTrue(store.memberships.isEmpty)
    }

    func testAlreadyJoinedInvitationDoesNotPostAgain() async {
        ClassTestURLProtocol.handler = { request in
            XCTAssertNotEqual(request.url!.lastPathComponent, "join")
            return request.url!.path.hasSuffix("/preview") ? (200, classJSON(preview: true, joined: true)) : (200, Data("[]".utf8))
        }
        let (store, _) = fixture()
        await store.load(for: student)
        store.studentName = " 张三 "
        store.code = "AM7EMGX6"; await store.preview(for: student); await store.join(for: student)
        XCTAssertTrue(store.invitation?.alreadyJoined == true)
    }

    func testMissingOrInvalidStudentNameCannotConfirmJoin() async {
        ClassTestURLProtocol.handler = { request in
            XCTAssertFalse(request.url!.path.hasSuffix("/join"))
            return request.url!.path.hasSuffix("/preview") ? (200, classJSON(preview: true)) : (200, Data("[]".utf8))
        }
        let (store, _) = fixture()
        await store.load(for: student)
        store.code = "AM7EMGX6"; await store.preview(for: student)
        for name in ["", "   ", "张\n三", String(repeating: "张", count: 41)] {
            store.studentName = name
            XCTAssertFalse(store.canJoin)
            await store.join(for: student)
        }
        XCTAssertTrue(store.memberships.isEmpty)
    }

    func testDuplicateTapAndAccountSwitchCannotApplyOldResults() async throws {
        let started = expectation(description: "preview started")
        var previewRequests = 0
        ClassTestURLProtocol.handler = { request in
            if request.url!.path.hasSuffix("/preview") {
                previewRequests += 1; started.fulfill()
                Thread.sleep(forTimeInterval: 0.15)
                return (200, classJSON(preview: true))
            }
            return (200, Data("[]".utf8))
        }
        let (store, _) = fixture()
        await store.load(for: student)
        store.studentName = " 张三 "
        store.code = "AM7EMGX6"
        let first = Task { await store.preview(for: student) }
        await fulfillment(of: [started], timeout: 2)
        await store.preview(for: student)
        await store.load(for: nil)
        await first.value
        XCTAssertEqual(previewRequests, 1)
        XCTAssertNil(store.invitation)
        XCTAssertTrue(store.memberships.isEmpty)
        XCTAssertFalse(store.busy)
        XCTAssertEqual(store.code, "")
    }
}

private func classJSON(preview: Bool = false, joined: Bool = false) -> Data {
    var value: [String: Any] = ["id": "class-1", "name": "高三（3）", "grade": "高三", "teacher_name": "王老师",
        "student_number": "007", "archived": false, "teacher_active": true]
    if preview { value.merge(["already_joined": joined, "disclosure_version": "class-sharing-test", "disclosure": "测试说明"]) { _, new in new } }
    return try! JSONSerialization.data(withJSONObject: value)
}

private final class ClassTestURLProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, data) = try XCTUnwrap(Self.handler)(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

private extension URLRequest {
    func jsonBody() throws -> [String: Any] {
        var data = httpBody ?? Data()
        if data.isEmpty, let stream = httpBodyStream {
            stream.open(); defer { stream.close() }
            let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 1024)
            defer { buffer.deallocate() }
            while stream.hasBytesAvailable {
                let count = stream.read(buffer, maxLength: 1024)
                if count <= 0 { break }
                data.append(buffer, count: count)
            }
        }
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
}
