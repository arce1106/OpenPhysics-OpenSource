import XCTest
import PencilKit
import UIKit
import SwiftUI
import WebKit
@testable import OpenPhysicsIOS

final class APIModelsTests: XCTestCase {
    func testActiveAccountHasFullLearningAccessWithoutPurchases() {
        let account = makeTestStudentSession()
        XCTAssertTrue(StudentAccessPolicy.hasFullLearningAccess(account))
        XCTAssertFalse(StudentAccessPolicy.hasFullLearningAccess(account.withAccountActive(false)))
        XCTAssertFalse(StudentAccessPolicy.hasFullLearningAccess(nil))
    }

    func testGradingPreservesRawPointsAndPrecisePercentageForPane() throws {
        let data = Data("{\"score\":7.5,\"max_score\":12,\"process_score\":62,\"process_score_percent\":62.5}".utf8)
        let grading = try JSONDecoder.openPhysics.decode(ReviewProcessGrading.self, from: data)
        XCTAssertEqual(grading.score, 7.5)
        XCTAssertEqual(grading.maxScore, 12)
        XCTAssertEqual(grading.processScorePercent, 62.5)
        XCTAssertEqual(grading.paneDictionary["score"] as? Double, 7.5)
        XCTAssertEqual(grading.paneDictionary["max_score"] as? Double, 12)
    }

    func testAccountErasureClearsOnlyItsLocalTutorHistory() throws {
        let suite = "privacy-test-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set(Data("private".utf8), forKey: "openphysics.learn-chat.v3.owner.kp1")
        defaults.set(Data("other".utf8), forKey: "openphysics.learn-chat.v3.other.kp1")
        LocalAccountPrivacy.erase("owner", defaults: defaults)
        XCTAssertNil(defaults.data(forKey: "openphysics.learn-chat.v3.owner.kp1"))
        XCTAssertNotNil(defaults.data(forKey: "openphysics.learn-chat.v3.other.kp1"))
        XCTAssertTrue(LocalAccountPrivacy.isErased("owner", defaults: defaults))
        XCTAssertFalse(LocalAccountPrivacy.isErased("other", defaults: defaults))
    }
    func testAIConsentVersionsAndReadOnlyRoutes() throws {
        let state = try JSONDecoder.openPhysics.decode(PrivacyConsentState.self, from: Data(
            "{\"privacy_version\":\"2026-10-11.2\",\"ai_version\":\"ios-ai-2026-10-11.2\",\"ios_terms\":true,\"ios_ai\":true}".utf8))
        XCTAssertTrue(state.aiAccepted)
        XCTAssertFalse(PrivacyConsentState(privacyVersion: "old", aiVersion: PrivacyPolicy.aiVersion, iosTerms: true, iosAi: true).aiAccepted)
        XCTAssertFalse(PrivacyConsentState(privacyVersion: PrivacyPolicy.version, aiVersion: "old", iosTerms: true, iosAi: true).aiAccepted)
        for path in ["practice/submit", "practice/submit-photo", "practice/process-evidence", "learn/chat", "tutor/question-chat"] {
            XCTAssertTrue(PrivacyPolicy.needsAI(path: path, method: "POST"))
            XCTAssertFalse(PrivacyPolicy.needsAI(path: path, method: "GET"))
        }
        for path in ["auth/privacy-consent", "auth/account-deletion", "practice/self-review", "reward/growth-report"] {
            XCTAssertFalse(PrivacyPolicy.needsAI(path: path, method: "POST"))
        }
    }

    @MainActor
    func testPrivacyEntryDoesNotMistakeLoadingOrFailureForMissingConsent() async throws {
        let privacy = PrivacyConsentCenter(api: parityClient())
        let student = makeTestStudentSession()
        let began = expectation(description: "consent read started")
        let gate = DispatchSemaphore(value: 0)
        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.httpMethod, "GET")
            began.fulfill()
            _ = gate.wait(timeout: .now() + 3)
            return (200, privacyReceiptJSON())
        }
        defer { MockURLProtocol.handler = nil; gate.signal() }
        XCTAssertEqual(privacy.entryState(for: student.token), .loading)
        let activation = Task { await privacy.activate(student) }
        await fulfillment(of: [began], timeout: 2)
        XCTAssertNil(privacy.state)
        XCTAssertEqual(privacy.entryState(for: student.token), .loading)
        gate.signal()
        await activation.value
        XCTAssertEqual(privacy.entryState(for: student.token), .ready)

        privacy.reset()
        MockURLProtocol.handler = { _ in throw URLError(.notConnectedToInternet) }
        await privacy.activate(student)
        XCTAssertNil(privacy.state)
        XCTAssertEqual(privacy.entryState(for: student.token), .unavailable)

        MockURLProtocol.handler = { _ in (200, privacyReceiptJSON(terms: false, ai: false)) }
        await privacy.refresh()
        XCTAssertEqual(privacy.entryState(for: student.token), .review)
        XCTAssertEqual(privacy.entryState(for: "another-account"), .loading)
    }

    @MainActor
    func testLoginReceiptEntersDirectlyWithoutReloadOrRestoringWithdrawnAI() async throws {
        let privacy = PrivacyConsentCenter(api: parityClient())
        let student = makeTestStudentSession()
        MockURLProtocol.handler = { _ in XCTFail("The saved login receipt must not be fetched again"); return (500, Data()) }
        defer { MockURLProtocol.handler = nil }
        for enabled in [true, false] {
            let receipt = try JSONDecoder.openPhysics.decode(PrivacyConsentState.self, from: privacyReceiptJSON(ai: enabled))
            privacy.acceptLoginReceipt(receipt, token: student.token)
            await privacy.activate(student)
            XCTAssertEqual(privacy.entryState(for: student.token), .ready)
            XCTAssertEqual(privacy.state?.aiAccepted, enabled)
            XCTAssertFalse(privacy.showsAI)
        }
    }

    @MainActor
    func testLoginPublishesSessionOnlyAfterInstallingSavedReceipt() async throws {
        let privacy = PrivacyConsentCenter.shared
        privacy.reset()
        defer { privacy.reset(); MockURLProtocol.handler = nil }
        MockURLProtocol.handler = { _ in (404, Data()) }
        let student = makeTestStudentSession()
        let app = AppSession(apiClient: parityClient(), sessionStore: PermissionTestSessionStore(session: nil))
        let receipt = try JSONDecoder.openPhysics.decode(PrivacyConsentState.self, from: privacyReceiptJSON())
        var observedSession = false
        let observation = app.$studentSession.sink { session in
            guard let session else { return }
            observedSession = true
            XCTAssertEqual(privacy.entryState(for: session.token), .ready)
            XCTAssertTrue(privacy.state?.aiAccepted == true)
        }
        defer { observation.cancel() }
        try await app.acceptAuthentication(student, privacyReceipt: receipt)
        XCTAssertTrue(observedSession)
    }

    @MainActor
    func testLateConsentReadCannotReplaceAnotherAccountsReceipt() async throws {
        let privacy = PrivacyConsentCenter(api: parityClient())
        let began = expectation(description: "old account read started")
        let gate = DispatchSemaphore(value: 0)
        MockURLProtocol.handler = { _ in
            began.fulfill()
            _ = gate.wait(timeout: .now() + 3)
            return (200, privacyReceiptJSON())
        }
        defer { MockURLProtocol.handler = nil; gate.signal() }
        let activation = Task { await privacy.activate(makeTestStudentSession()) }
        await fulfillment(of: [began], timeout: 2)
        let withdrawn = try JSONDecoder.openPhysics.decode(PrivacyConsentState.self, from: privacyReceiptJSON(ai: false))
        privacy.acceptLoginReceipt(withdrawn, token: "new-account")
        gate.signal()
        await activation.value
        XCTAssertEqual(privacy.entryState(for: "new-account"), .ready)
        XCTAssertFalse(privacy.state?.aiAccepted == true)
        XCTAssertEqual(privacy.token, "new-account")
    }

    @MainActor
    func testLoginAgreementGrantsAIOnlyWhenIncludedAndPreservesWithdrawal() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        let api = APIClient(baseURL: URL(string: "https://example.test/api/student")!, session: URLSession(configuration: config))
        defer { MockURLProtocol.handler = nil }
        for (includesAI, existingAI, withdrawn) in [(false, false, false), (true, false, false), (false, true, false), (true, true, false), (true, false, true)] {
            var scopes: [String] = []
            MockURLProtocol.handler = { request in
                XCTAssertEqual(request.url?.path, "/api/student/auth/privacy-consent")
                XCTAssertEqual(request.httpMethod, "POST")
                XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer synthetic-registration")
                let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.bodyData)) as? [String: Any])
                let scope = try XCTUnwrap(body["scope"] as? String)
                scopes.append(scope)
                XCTAssertEqual(body["granted"] as? Bool, true)
                if scope == "ios_ai" { XCTAssertEqual(body["preserve_withdrawal"] as? Bool, true) }
                XCTAssertEqual(body["version"] as? String, scope == "ios_ai" ? PrivacyPolicy.aiVersion : PrivacyPolicy.version)
                return (200, try JSONSerialization.data(withJSONObject: [
                    "privacy_version": PrivacyPolicy.version, "ai_version": PrivacyPolicy.aiVersion,
                    "ios_terms": true, "ios_ai": existingAI || scope == "ios_ai", "ios_ai_withdrawn": withdrawn]))
            }
            let saved = try await api.recordLoginPrivacyConsent(termsAccepted: true, aiAccepted: includesAI, token: "synthetic-registration")
            XCTAssertEqual(scopes, includesAI && !existingAI && !withdrawn ? ["ios_terms", "ios_ai"] : ["ios_terms"])
            XCTAssertEqual(saved.aiAccepted, (includesAI && !withdrawn) || existingAI)
        }
    }

    @MainActor
    func testRegistrationAgreementNeverGrantsAfterMissingChoiceOrFailedReceipt() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        let api = APIClient(baseURL: URL(string: "https://example.test/api/student")!, session: URLSession(configuration: config))
        defer { MockURLProtocol.handler = nil }
        MockURLProtocol.handler = { _ in XCTFail("Missing agreement must send no receipt"); return (500, Data()) }
        do {
            _ = try await api.recordLoginPrivacyConsent(termsAccepted: false, aiAccepted: true, token: "synthetic")
            XCTFail("Expected refusal")
        } catch is PrivacyConsentError {} catch { XCTFail("Unexpected error: \(error)") }
        for failedScope in ["ios_terms", "ios_ai"] {
            var scopes: [String] = []
            MockURLProtocol.handler = { request in
                let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.bodyData)) as? [String: Any])
                let scope = try XCTUnwrap(body["scope"] as? String)
                scopes.append(scope)
                if scope == failedScope { return (503, Data(#"{"detail":"Synthetic failure"}"#.utf8)) }
                return (200, try JSONSerialization.data(withJSONObject: [
                    "privacy_version": PrivacyPolicy.version, "ai_version": PrivacyPolicy.aiVersion,
                    "ios_terms": true, "ios_ai": false, "ios_ai_withdrawn": false]))
            }
            do {
                _ = try await api.recordLoginPrivacyConsent(termsAccepted: true, aiAccepted: true, token: "synthetic")
                XCTFail("Failed receipts must not report agreement saved")
            } catch is APIError {} catch { XCTFail("Unexpected error: \(error)") }
            XCTAssertEqual(scopes, failedScope == "ios_terms" ? ["ios_terms"] : ["ios_terms", "ios_ai"])
        }
    }

    @MainActor
    func testLoginPreservesConcurrentWithdrawalAndDoesNotGuessOnOlderServers() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        let api = APIClient(baseURL: URL(string: "https://example.test/api/student")!, session: URLSession(configuration: config))
        defer { MockURLProtocol.handler = nil }
        for oldServer in [false, true] {
            var scopes: [String] = []
            MockURLProtocol.handler = { request in
                let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.bodyData)) as? [String: Any])
                let scope = try XCTUnwrap(body["scope"] as? String)
                scopes.append(scope)
                var state: [String: Any] = ["privacy_version": PrivacyPolicy.version, "ai_version": PrivacyPolicy.aiVersion,
                    "ios_terms": true, "ios_ai": false]
                if !oldServer { state["ios_ai_withdrawn"] = scope == "ios_ai" }
                return (200, try JSONSerialization.data(withJSONObject: state))
            }
            let saved = try await api.recordLoginPrivacyConsent(termsAccepted: true, aiAccepted: true, token: "synthetic")
            XCTAssertFalse(saved.aiAccepted)
            XCTAssertEqual(scopes, oldServer ? ["ios_terms"] : ["ios_terms", "ios_ai"])
        }
    }

    @MainActor
    func testDecliningAIStopsJSONStreamingAndUploadsBeforeNetworking() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        let api = APIClient(authorizeAI: { _, _, _ in throw PrivacyConsentError.required },
            baseURL: URL(string: "https://example.test/api/student")!, session: URLSession(configuration: config))
        MockURLProtocol.handler = { _ in XCTFail("No request may be sent without AI consent"); return (500, Data()) }
        defer { MockURLProtocol.handler = nil }
        let student = makeTestStudentSession()
        let media = AnswerMediaDraft(kind: .photo, fileURL: URL(fileURLWithPath: "/not-created/privacy-test.jpg"), mimeType: "image/jpeg")
        do {
            let _: PrivacyConsentState = try await api.request(path: "tutor/question-chat", method: "POST", token: student.token)
            XCTFail("Expected refusal")
        } catch is PrivacyConsentError {} catch { XCTFail("Unexpected error: \(error)") }
        do {
            _ = try await api.streamLearningChat(for: student, kpId: "kp", message: "Synthetic", history: [], onContent: { _ in })
            XCTFail("Expected refusal")
        } catch is PrivacyConsentError {} catch { XCTFail("Unexpected error: \(error)") }
        do {
            _ = try await api.submitPhotoAnswer(for: student, questionId: "q", media: media, timeSpentMs: 1, submissionId: "privacy-test")
            XCTFail("Expected refusal before reading image")
        } catch is PrivacyConsentError {} catch { XCTFail("Unexpected error: \(error)") }
        do {
            _ = try await api.submitProcessEvidence(for: student, questionId: "q", answerId: 1, media: media, timeSpentMs: 1)
            XCTFail("Expected refusal before reading image")
        } catch is PrivacyConsentError {} catch { XCTFail("Unexpected error: \(error)") }
    }
    func testDeletionRequestUsesExplicitConsentAndOnlyChosenProof() throws {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        let request = AccountDeletionRequest(confirmed: true, currentPassword: "synthetic-password")
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoder.encode(request)) as? [String: Any])
        XCTAssertEqual(Set(object.keys), ["confirmed", "current_password"])
        XCTAssertEqual(object["confirmed"] as? Bool, true)
        XCTAssertTrue(try JSONDecoder().decode(AccountDeletionResult.self, from: Data(#"{"deleted":true}"#.utf8)).deleted)
    }


    @MainActor
    func testLateAccountRefreshCannotRestoreLoggedOutSession() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let storage = PermissionTestSessionStore(session: makeTestStudentSession())
        let app = AppSession(apiClient: APIClient(authorizeAI: { _, _, _ in }, baseURL: URL(string: "https://example.test/api/student")!,
            session: URLSession(configuration: configuration)), sessionStore: storage)
        let profile = Data(#"{"id":"student-1","username":"learner","display_name":"学习者","status":"active"}"#.utf8)
        MockURLProtocol.handler = { request in
            request.url?.path.hasSuffix("/auth/me") == true ? (200, profile) : (404, Data())
        }
        defer { MockURLProtocol.handler = nil }
        await app.restore()
        XCTAssertNotNil(app.studentSession)
        let requested = expectation(description: "refresh started")
        let gate = DispatchSemaphore(value: 0)
        MockURLProtocol.handler = { _ in
            requested.fulfill()
            _ = gate.wait(timeout: .now() + 3)
            return (200, profile)
        }
        let task = Task { await app.refreshStudentSession() }
        await fulfillment(of: [requested], timeout: 2)
        app.logout()
        gate.signal()
        await task.value
        XCTAssertNil(app.studentSession)
        XCTAssertNil(storage.session)
        await app.refreshAccess(for: "old-token")
        XCTAssertNil(app.studentSession)
    }

    @MainActor


    func testCurrentStudentRefreshUsesAuthMeAndPreservesToken() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let client = APIClient(authorizeAI: { _, _, _ in },
            baseURL: URL(string: "https://example.test/api/student")!,
            session: URLSession(configuration: configuration)
        )
        let cached = StudentSession(
            token: "cached-token",
            studentID: "student-1",
            username: "learner",
            displayName: "学习者",
            accountStatus: "active")

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/student/auth/me")
            XCTAssertEqual(
                request.value(forHTTPHeaderField: "Authorization"),
                "Bearer cached-token"
            )
            return (
                200,
                Data(
                    #"{"id":"student-1","username":"learner","display_name":"学习者","status":"active"}"#.utf8
                )
            )
        }
        defer { MockURLProtocol.handler = nil }

        let refreshed = try await client.currentStudent(for: cached)

        XCTAssertEqual(refreshed.token, "cached-token")
        XCTAssertEqual(refreshed.accountStatus, "active")
        XCTAssertTrue(StudentAccessPolicy.hasFullLearningAccess(refreshed))
    }

    func testTopicPerformanceSeparatesCoverageAndUnknown() throws {
        var data = try XCTUnwrap(JSONSerialization.jsonObject(with: gaokaoOverviewJSON()) as? [String: Any])
        data["core_knowledge_point_count"] = 25
        data["attempted_knowledge_point_count"] = 9
        data["performance_score"] = 0.6
        data["evidence_count"] = 10
        let overview = try JSONDecoder.openPhysics.decode(LearningCatalogTopicOverview.self, from: JSONSerialization.data(withJSONObject: data))
        XCTAssertEqual(overview.topicPerformanceLabel, "60% 专题作答表现")
        XCTAssertEqual(overview.untestedKnowledgePointCount, 16)
        XCTAssertEqual(overview.evidenceCount, 10)
        data["performance_score"] = NSNull()
        let untested = try JSONDecoder.openPhysics.decode(LearningCatalogTopicOverview.self, from: JSONSerialization.data(withJSONObject: data))
        XCTAssertEqual(untested.topicPerformanceLabel, "专题表现待检测")
    }

    func testGaokaoIsAFirstClassNavigationSection() {
        XCTAssertEqual(
            AppSection.allCases,
            [.today, .sync, .reinforcement, .gaokao, .review, .account]
        )
        XCTAssertEqual(AppSection.today.title, "首页")
        XCTAssertEqual(AppSection.today.symbol, "house")
        XCTAssertEqual(AppSection.gaokao.title, "高考复习")
        XCTAssertEqual(AppSection.gaokao.symbol, "graduationcap")
    }

    func testSidebarRevealRequiresIntentionalRightSwipeFromLeftEdge() {
        XCTAssertTrue(
            SidebarRevealPolicy.shouldReveal(
                startX: 18,
                horizontalDistance: 120,
                verticalDistance: 12
            )
        )
        XCTAssertFalse(
            SidebarRevealPolicy.shouldReveal(
                startX: 80,
                horizontalDistance: 120,
                verticalDistance: 12
            )
        )
        XCTAssertFalse(
            SidebarRevealPolicy.shouldReveal(
                startX: 18,
                horizontalDistance: 40,
                verticalDistance: 4
            )
        )
    }

    func testWorkspaceControlPanelAdaptsToAvailableDetailWidth() {
        XCTAssertEqual(
            OpenPhysicsWorkspaceMetrics.controlPanelWidth(for: 1_200),
            280
        )
        XCTAssertEqual(
            OpenPhysicsWorkspaceMetrics.controlPanelWidth(for: 820),
            220
        )
        XCTAssertEqual(
            OpenPhysicsWorkspaceMetrics.controlPanelWidth(for: 600),
            220
        )
    }

    func testReviewDetailKeepsTutorAndVariationActionsInHeader() {
        XCTAssertEqual(ReviewDetailLayoutPolicy.headerActions, ["AI 助教", "做变式题"])
    }

    func testLoginResponseBuildsSession() throws {
        let data = Data(
            """
            {
              "access_token": "token-1",
              "student": {
                "id": "student-1",
                "username": "learner",
                "display_name": "学习者",
                "status": "active"}
            }
            """.utf8
        )

        let response = try JSONDecoder.openPhysics.decode(StudentLoginResponse.self, from: data)

        XCTAssertEqual(response.session.studentID, "student-1")
        XCTAssertEqual(response.session.displayLabel, "学习者")
        XCTAssertTrue(StudentAccessPolicy.hasFullLearningAccess(response.session))
    }

    func testDashboardDecodesSnakeCaseFields() throws {
        let data = Data(
            """
            {
              "diagnosis": {
                "overall_mastery": 0.62,
                "mastered_count": 8,
                "in_progress_count": 3,
                "locked_count": 2,
                "weak_points": [
                  {"kp_id": "kp-1", "kp_name": "牛顿第二定律", "mastery": 0.35}
                ]
              },
              "plan": {
                "kp_id": "kp-1",
                "kp_name": "牛顿第二定律",
                "mastery": 0.35,
                "reason": "当前最值得提升",
                "estimated_questions": 5,
                "estimated_minutes": 12
              },
              "motivation": {
                "streak_days": 2,
                "weekly_kps_mastered": 1,
                "mistake_backlog_count": 4,
                "next_milestone": "完成今日任务"
              },
              "knowledge_map": []
            }
            """.utf8
        )

        let dashboard = try JSONDecoder.openPhysics.decode(DashboardData.self, from: data)

        XCTAssertEqual(dashboard.diagnosis.masteredCount, 8)
        XCTAssertEqual(dashboard.plan?.estimatedMinutes, 12)
        XCTAssertEqual(dashboard.diagnosis.weakPoints.first?.kpId, "kp-1")
    }

    func testTodayTaskPrioritizesMistakeBacklogLikeWebAndAndroid() {
        let dashboard = DashboardData(
            diagnosis: DiagnosisSummary(
                overallMastery: 0.2,
                masteredCount: 0,
                inProgressCount: 1,
                lockedCount: 0,
                weakPoints: []
            ),
            plan: PlanRecommendation(
                kpId: "kp-1",
                kpName: "质点",
                mastery: 0.1,
                reason: "继续教材进度",
                estimatedQuestions: 5,
                estimatedMinutes: 15
            ),
            motivation: MotivationPanel(
                streakDays: 0,
                weeklyKpsMastered: 0,
                mistakeBacklogCount: 28,
                nextMilestone: nil
            )
        )

        let task = buildTodayHomeTask(dashboard)

        XCTAssertEqual(task.title, "先清除 28 道待复盘错题")
        XCTAssertEqual(task.actionTitle, "去复盘错题")
        XCTAssertEqual(task.destination, .review)
    }

    func testHomeMilestoneOpensNamedPointInsteadOfGeneralRecommendation() {
        let first = makeSyncPoint(id: "first", name: "质点", section: "1.1")
        let target = makeSyncPoint(id: "timer", name: "打点计时器", section: "1.4")
        let points = [first, target]

        for milestone in ["开始同步学习「打点计时器」", "完成「打点计时器」达到掌握水平"] {
            XCTAssertEqual(homeMilestoneKnowledgePoint(
                milestone: milestone, points: points, preferredID: first.id
            )?.id, target.id)
        }
        XCTAssertEqual(homeMilestoneKnowledgePoint(
            milestone: "开始同步学习「质点」", points: points, preferredID: target.id
        )?.id, first.id)
        XCTAssertNil(homeMilestoneKnowledgePoint(
            milestone: "开始同步学习「不存在的知识点」", points: points, preferredID: first.id
        ))
        XCTAssertNil(homeMilestoneKnowledgePoint(
            milestone: "保持学习节奏", points: points, preferredID: first.id
        ))
    }

    func testTodayTaskUsesPlanWhenMistakeBacklogIsClear() {
        let dashboard = DashboardData(
            diagnosis: DiagnosisSummary(
                overallMastery: 0.2,
                masteredCount: 0,
                inProgressCount: 1,
                lockedCount: 0,
                weakPoints: []
            ),
            plan: PlanRecommendation(
                kpId: "kp-1",
                kpName: "质点",
                mastery: 0.1,
                reason: "继续教材进度",
                estimatedQuestions: 5,
                estimatedMinutes: 15
            ),
            motivation: MotivationPanel(
                streakDays: 0,
                weeklyKpsMastered: 0,
                mistakeBacklogCount: 0,
                nextMilestone: nil
            )
        )

        let task = buildTodayHomeTask(dashboard)

        XCTAssertEqual(task.title, "推进「质点」")
        XCTAssertEqual(task.destination, .sync)
    }

    func testHomeLoopAndGrowthReportDecodeWebContracts() throws {
        let loopData = Data(
            """
            {
              "date": "2026-07-29",
              "is_effective_day": false,
              "is_high_quality_day": false,
              "rings": {
                "practice": {
                  "key": "practice",
                  "label": "做题环",
                  "completed": false,
                  "current": 2,
                  "actual_current": 2,
                  "target": 5,
                  "overflow": 0,
                  "auto_completed": false,
                  "pending_mistakes": null,
                  "evidence": "今日完成 2 题"
                },
                "review": {
                  "key": "review",
                  "label": "复盘环",
                  "completed": false,
                  "current": 0,
                  "actual_current": 0,
                  "target": 3,
                  "overflow": 0,
                  "auto_completed": false,
                  "pending_mistakes": 28,
                  "evidence": "仍有待复盘错题"
                }
              },
              "summary": "今日学习继续",
              "next_action": "先复盘错题",
              "streak_days": 0
            }
            """.utf8
        )
        let reportData = Data(
            """
            {
              "report": {
                "id": "report-1",
                "summary": "本周你完成了 9 道题，正确率 67%。",
                "metrics": {
                  "total_answers": 9,
                  "correct_answers": 6,
                  "correct_rate": "67%",
                  "mistakes_corrected": 2,
                  "weekly_xp": 12,
                  "mastered_kps": ["质点"],
                  "weak_kps": ["参考系"]
                },
                "start_date": "2026-07-22",
                "end_date": "2026-07-29"
              }
            }
            """.utf8
        )

        let loop = try JSONDecoder.openPhysics.decode(
            DailyLearningLoop.self,
            from: loopData
        )
        let report = try JSONDecoder.openPhysics.decode(
            GrowthReportResponse.self,
            from: reportData
        ).report

        XCTAssertEqual(loop.rings.practice.progress, 0.4, accuracy: 0.001)
        XCTAssertEqual(loop.rings.review.pendingMistakes, 28)
        XCTAssertEqual(report?.metrics?.totalAnswers, 9)
        XCTAssertEqual(report?.metrics?.correctRate, "67%")
    }

    func testHomeLearningLoopPresentationKeepsWebAndAndroidTwoRingMeaning() {
        let dashboard = DashboardData(
            diagnosis: DiagnosisSummary(
                overallMastery: 0,
                masteredCount: 0,
                inProgressCount: 0,
                lockedCount: 0,
                weakPoints: []
            ),
            plan: nil,
            motivation: MotivationPanel(
                streakDays: 0,
                weeklyKpsMastered: 0,
                mistakeBacklogCount: 28,
                nextMilestone: nil
            )
        )
        let loop = DailyLearningLoop(
            date: "2026-07-29",
            isEffectiveDay: true,
            isHighQualityDay: false,
            rings: DailyLoopRings(
                practice: DailyLoopRing(
                    key: "practice",
                    label: "做题环",
                    completed: false,
                    current: 2,
                    actualCurrent: 2,
                    target: 5,
                    overflow: 0,
                    autoCompleted: false,
                    pendingMistakes: nil,
                    evidence: "今日完成 2 题"
                ),
                review: DailyLoopRing(
                    key: "review",
                    label: "复盘环",
                    completed: false,
                    current: 0,
                    actualCurrent: 0,
                    target: 3,
                    overflow: 0,
                    autoCompleted: false,
                    pendingMistakes: 28,
                    evidence: "仍有待复盘错题"
                )
            ),
            summary: "",
            nextAction: "",
            streakDays: 0
        )

        let presentation = buildHomeLearningLoopPresentation(
            loop: loop,
            dashboard: dashboard
        )

        XCTAssertEqual(presentation.practice.countLabel, "2/5")
        XCTAssertEqual(presentation.practice.progress, 0.4, accuracy: 0.001)
        XCTAssertEqual(presentation.review.countLabel, "0/3")
        XCTAssertEqual(presentation.closedCount, 0)
        XCTAssertEqual(presentation.centerValue, "0/2")
    }

    func testHomeLearningLoopPresentationShowsClosedAndOverflowStates() {
        let dashboard = DashboardData(
            diagnosis: DiagnosisSummary(
                overallMastery: 0,
                masteredCount: 0,
                inProgressCount: 0,
                lockedCount: 0,
                weakPoints: []
            ),
            plan: nil,
            motivation: MotivationPanel(
                streakDays: 1,
                weeklyKpsMastered: 1,
                mistakeBacklogCount: 0,
                nextMilestone: nil
            )
        )
        let loop = DailyLearningLoop(
            date: "2026-07-29",
            isEffectiveDay: true,
            isHighQualityDay: true,
            rings: DailyLoopRings(
                practice: DailyLoopRing(
                    key: "practice",
                    label: "做题环",
                    completed: true,
                    current: 5,
                    actualCurrent: 7,
                    target: 5,
                    overflow: 2,
                    autoCompleted: false,
                    pendingMistakes: nil,
                    evidence: "今日完成 7 题"
                ),
                review: DailyLoopRing(
                    key: "review",
                    label: "复盘环",
                    completed: true,
                    current: 3,
                    actualCurrent: 0,
                    target: 3,
                    overflow: 0,
                    autoCompleted: true,
                    pendingMistakes: 0,
                    evidence: "暂无待复盘错题"
                )
            ),
            summary: "",
            nextAction: "",
            streakDays: 1
        )

        let presentation = buildHomeLearningLoopPresentation(
            loop: loop,
            dashboard: dashboard
        )

        XCTAssertEqual(presentation.closedCount, 2)
        XCTAssertEqual(presentation.centerValue, "双环")
        XCTAssertEqual(presentation.practice.countLabel, "7/5")
        XCTAssertEqual(presentation.practice.overflowProgress, 0.4, accuracy: 0.001)
        XCTAssertEqual(presentation.review.countLabel, "0/3 · 已清空")
        XCTAssertTrue(presentation.review.completed)
    }

    func testDailyLoopHistoryMergesTodayAndBuildsWebAlignedMonths() throws {
        let historyData = Data(
            """
            {
              "start_date": "2026-06-30",
              "end_date": "2026-07-29",
              "practice_target": 5,
              "review_target": 3,
              "summary": {
                "practice_total": 1,
                "review_total": 0,
                "practice_closed_days": 0,
                "review_closed_days": 0,
                "dual_closed_days": 0,
                "effective_days": 1
              },
              "days": [{
                "date": "2026-06-30",
                "is_effective_day": true,
                "is_high_quality_day": false,
                "rings": {
                  "practice": {
                    "key": "practice",
                    "label": "做题环",
                    "completed": false,
                    "current": 1,
                    "actual_current": 1,
                    "target": 5,
                    "overflow": 0,
                    "auto_completed": false,
                    "pending_mistakes": null,
                    "evidence": "完成 1 题"
                  },
                  "review": {
                    "key": "review",
                    "label": "复盘环",
                    "completed": false,
                    "current": 0,
                    "actual_current": 0,
                    "target": 3,
                    "overflow": 0,
                    "auto_completed": false,
                    "pending_mistakes": 1,
                    "evidence": "待复盘"
                  }
                },
                "summary": "",
                "next_action": ""
              }]
            }
            """.utf8
        )
        let todayData = Data(
            """
            {
              "date": "2026-07-29",
              "is_effective_day": true,
              "is_high_quality_day": true,
              "rings": {
                "practice": {
                  "key": "practice",
                  "label": "做题环",
                  "completed": true,
                  "current": 6,
                  "actual_current": 6,
                  "target": 5,
                  "overflow": 1,
                  "auto_completed": false,
                  "pending_mistakes": null,
                  "evidence": "完成 6 题"
                },
                "review": {
                  "key": "review",
                  "label": "复盘环",
                  "completed": true,
                  "current": 3,
                  "actual_current": 0,
                  "target": 3,
                  "overflow": 0,
                  "auto_completed": true,
                  "pending_mistakes": 0,
                  "evidence": "已清空"
                }
              },
              "summary": "双环闭合",
              "next_action": "保持节奏",
              "streak_days": 1
            }
            """.utf8
        )
        let history = try JSONDecoder.openPhysics.decode(
            DailyLearningLoopHistory.self,
            from: historyData
        )
        let today = try JSONDecoder.openPhysics.decode(
            DailyLearningLoop.self,
            from: todayData
        )

        let merged = history.mergingToday(today)
        let months = buildHomeLoopCalendarMonths(
            history: merged,
            todayDate: today.date
        )

        XCTAssertEqual(merged.days.map(\.date), ["2026-06-30", "2026-07-29"])
        XCTAssertEqual(merged.summary.practiceTotal, 7)
        XCTAssertEqual(merged.summary.reviewTotal, 0)
        XCTAssertEqual(merged.summary.dualClosedDays, 1)
        XCTAssertEqual(months.map(\.label), ["2026年7月", "2026年6月"])
        XCTAssertNil(months[0].cells[0].isoDate)
        XCTAssertNil(months[0].cells[1].isoDate)
        XCTAssertEqual(months[0].cells[2].isoDate, "2026-07-01")
        XCTAssertTrue(
            months[0].cells.first { $0.isoDate == "2026-07-29" }?.isToday
                == true
        )
    }

    func testDailyLoopHistoryAPIUsesLazyThirtyFiveDayContract() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let apiClient = APIClient(authorizeAI: { _, _, _ in },
            baseURL: URL(string: "https://example.test/api/student")!,
            session: URLSession(configuration: configuration)
        )
        let student = StudentSession(
            token: "token",
            studentID: "student-1",
            username: "learner",
            displayName: "学习者",
            accountStatus: "active")

        MockURLProtocol.handler = { request in
            XCTAssertTrue(
                request.url?.path.hasSuffix("/reward/daily-loop/history")
                    == true
            )
            let queryItems = URLComponents(
                url: try XCTUnwrap(request.url),
                resolvingAgainstBaseURL: false
            )?.queryItems
            XCTAssertEqual(
                queryItems?.first { $0.name == "student_id" }?.value,
                "student-1"
            )
            XCTAssertEqual(
                queryItems?.first { $0.name == "days" }?.value,
                "35"
            )
            return (
                200,
                Data(
                    """
                    {
                      "start_date": "2026-06-25",
                      "end_date": "2026-07-29",
                      "practice_target": 5,
                      "review_target": 3,
                      "summary": {
                        "practice_total": 0,
                        "review_total": 0,
                        "practice_closed_days": 0,
                        "review_closed_days": 0,
                        "dual_closed_days": 0,
                        "effective_days": 0
                      },
                      "days": []
                    }
                    """.utf8
                )
            )
        }
        defer { MockURLProtocol.handler = nil }

        let history = try await apiClient.dailyLearningLoopHistory(
            for: student
        )

        XCTAssertEqual(history.startDate, "2026-06-25")
        XCTAssertEqual(history.practiceTarget, 5)
        XCTAssertTrue(history.days.isEmpty)
    }

    func testAnswerHistoryDecodesAndFiltersLikeWebHistory() throws {
        let data = Data(
            """
            [
              {
                "id": 11,
                "question_id": "q-correct",
                "stem_text": "速度是矢量。",
                "stem_rendered": null,
                "question_type": "single_choice",
                "options": [{"label": "A", "text": "正确"}],
                "images": [],
                "knowledge_points": [{"id": "kp-1", "name": "速度"}],
                "given_answer": "A",
                "is_correct": true,
                "correct_answer": "A",
                "correct_answer_rendered": null,
                "explanation": "速度有方向。",
                "explanation_rendered": null,
                "process_grading": null,
                "reviewed_at": null,
                "time_spent_ms": 900,
                "created_at": "2026-07-29T10:00:00Z"
              },
              {
                "id": 12,
                "question_id": "q-review",
                "stem_text": "请写出推导过程。",
                "stem_rendered": null,
                "question_type": "problem_solving",
                "options": [],
                "images": [],
                "knowledge_points": [{"id": "kp-2", "name": "加速度"}],
                "given_answer": "过程",
                "is_correct": false,
                "correct_answer": "标准过程",
                "correct_answer_rendered": null,
                "explanation": "逐步推导。",
                "explanation_rendered": null,
                "process_grading": {"needs_human_review": true},
                "reviewed_at": null,
                "time_spent_ms": 1800,
                "created_at": "2026-07-29T10:01:00Z"
              }
            ]
            """.utf8
        )

        let records = try JSONDecoder.openPhysics.decode(
            [AnswerHistoryRecord].self,
            from: data
        )

        XCTAssertEqual(records.first?.knowledgePointNames, ["速度"])
        XCTAssertEqual(
            filterPracticeHistory(records, by: .correct).map(\.id),
            [11]
        )
        XCTAssertEqual(
            filterPracticeHistory(records, by: .wrong).map(\.id),
            [12]
        )
        XCTAssertEqual(
            filterPracticeHistory(records, by: .review).map(\.id),
            [12]
        )
        XCTAssertEqual(records[1].reviewSummary.answerId, 12)
    }

    func testGrowthHistoryScopeKeepsWebDateRangeAndLargerPage() {
        let scope = PracticeHistoryScope.growth(
            fromDate: "2026-07-22",
            toDate: "2026-07-29"
        )

        XCTAssertEqual(scope.fromDate, "2026-07-22")
        XCTAssertEqual(scope.toDate, "2026-07-29")
        XCTAssertEqual(scope.pageSize, 100)
        XCTAssertEqual(
            scope.subtitle,
            "成长回顾区间：2026-07-22 至 2026-07-29"
        )
    }

    func testPracticeSessionDecodesQuestionAndOptions() throws {
        let data = Data(
            """
            {
              "student_id": "student-1",
              "session_type": "practice",
              "strategy": "target_weak_kp",
              "session_objective": "牛顿第二定律巩固",
              "questions": [
                {
                  "id": "question-1",
                  "stem_text": "关于加速度，正确的是（ ）",
                  "question_type": "single_choice",
                  "options": [
                    {"label": "A", "text": "加速度是矢量", "rendered": null, "text_rendered": null},
                    {"label": "B", "text": "加速度是标量", "rendered": null, "text_rendered": null}
                  ],
                  "images": [],
                  "stem_rendered": null
                }
              ]
            }
            """.utf8
        )

        let session = try JSONDecoder.openPhysics.decode(PracticeSession.self, from: data)

        XCTAssertEqual(session.sessionObjective, "牛顿第二定律巩固")
        XCTAssertEqual(session.questions.first?.options.count, 2)
        XCTAssertTrue(session.questions.first?.isChoice == true)
    }

    func testSubmitResultDecodesMasteryAndReplayState() throws {
        let data = Data(
            """
            {
              "answer_id": 42,
              "is_correct": true,
              "correct_answer": "A",
              "correct_answer_rendered": null,
              "explanation": "加速度既有大小也有方向。",
              "explanation_rendered": null,
              "mastery_update": {
                "kp-1": {"before": 0.4, "after": 0.52, "name": "加速度"}
              },
              "detected_misconception": null,
              "ai_feedback": "判断正确。",
              "ai_feedback_rendered": null,
              "extracted_answer": "A",
              "idempotent_replay": false
            }
            """.utf8
        )

        let result = try JSONDecoder.openPhysics.decode(SubmitAnswerResult.self, from: data)

        XCTAssertTrue(result.isCorrect)
        XCTAssertEqual(result.answerId, 42)
        XCTAssertEqual(result.masteryUpdate["kp-1"]?.after, 0.52)
        XCTAssertFalse(result.idempotentReplay)
    }

    func testSelfReviewMatchesWebQuestionTypesAndSubpartDetection() throws {
        let data = Data(
            """
            {
              "id": "question-1",
              "stem_text": "计算：(1)运动时间；(2)末速度",
              "question_type": "problem_solving",
              "options": [],
              "images": [],
              "stem_rendered": null,
              "answer": "(1)6 s；(2)60 m/s",
              "correct_answer": "(1)6 s；(2)60 m/s",
              "correct_answer_rendered": null,
              "explanation": "先求时间，再求速度。",
              "explanation_rendered": null
            }
            """.utf8
        )

        let question = try JSONDecoder.openPhysics.decode(PracticeQuestion.self, from: data)

        XCTAssertTrue(question.supportsSelfReview)
        XCTAssertEqual(question.initialSelfReviewItems.map(\.label), ["(1)", "(2)"])
        XCTAssertTrue(
            SelfReview.items(answer: "42", stem: "求结果").map(\.label) == ["整题"]
        )
    }

    @MainActor
    func testPracticeRetryReusesSubmissionId() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let apiClient = APIClient(authorizeAI: { _, _, _ in },
            baseURL: URL(string: "https://example.test/api/student")!,
            session: URLSession(configuration: configuration)
        )
        let store = PracticeStore(apiClient: apiClient)
        let student = StudentSession(
            token: "token",
            studentID: "student-1",
            username: "learner",
            displayName: "学习者",
            accountStatus: "active")

        var submittedIds: [String] = []
        var submitAttempts = 0
        MockURLProtocol.handler = { request in
            if request.url?.path.hasSuffix("/practice/session") == true {
                return (
                    200,
                    Data(
                        """
                        {
                          "student_id": "student-1",
                          "session_type": "practice",
                          "strategy": "weak_kp",
                          "session_objective": "测试练习",
                          "questions": [{
                            "id": "question-1",
                            "stem_text": "请选择",
                            "question_type": "single_choice",
                            "target_knowledge_point_id": "kp-1",
                            "options": [{"label": "A", "text": "答案", "rendered": null, "text_rendered": null}],
                            "images": [],
                            "stem_rendered": null
                          }]
                        }
                        """.utf8
                    )
                )
            }

            let body = try XCTUnwrap(request.bodyData)
            let payload = try XCTUnwrap(
                JSONSerialization.jsonObject(with: body) as? [String: Any]
            )
            submittedIds.append(try XCTUnwrap(payload["submission_id"] as? String))
            submitAttempts += 1
            if submitAttempts == 1 {
                return (500, Data(#"{"detail":"temporary"}"#.utf8))
            }
            return (
                200,
                Data(
                    """
                    {
                      "answer_id": 9,
                      "is_correct": true,
                      "correct_answer": "A",
                      "correct_answer_rendered": null,
                      "explanation": "正确",
                      "explanation_rendered": null,
                      "mastery_update": {},
                      "detected_misconception": null,
                      "ai_feedback": "很好",
                      "ai_feedback_rendered": null,
                      "extracted_answer": "A",
                      "idempotent_replay": false
                    }
                    """.utf8
                )
            )
        }

        let didStart = await store.start(student: student, kpId: "kp-1", count: 1)
        XCTAssertTrue(didStart)
        store.setAnswer("A", for: "question-1")
        await store.submit(student: student)
        XCTAssertNil(store.currentResult)
        await store.submit(student: student)

        XCTAssertEqual(submittedIds.count, 2)
        XCTAssertFalse(try XCTUnwrap(submittedIds.first).isEmpty)
        XCTAssertEqual(submittedIds.first, submittedIds.last)
        XCTAssertTrue(store.currentResult?.isCorrect == true)
        MockURLProtocol.handler = nil
    }

    @MainActor
    func testPracticeChangedAnswerRotatesSubmissionIdAfterFailure() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let store = PracticeStore(
            apiClient: APIClient(authorizeAI: { _, _, _ in },
                baseURL: URL(string: "https://example.test/api/student")!,
                session: URLSession(configuration: configuration)
            )
        )
        let student = StudentSession(
            token: "token",
            studentID: "student-1",
            username: "learner",
            displayName: "学习者",
            accountStatus: "active")
        var submissions: [(answer: String, id: String)] = []

        MockURLProtocol.handler = { request in
            if request.url?.path.hasSuffix("/practice/session") == true {
                return (
                    200,
                    Data(
                        """
                        {
                          "student_id": "student-1",
                          "session_type": "practice",
                          "strategy": "weak_kp",
                          "session_objective": "测试练习",
                          "questions": [{
                            "id": "question-1",
                            "stem_text": "请选择",
                            "question_type": "single_choice",
                            "options": [
                              {"label": "A", "text": "选项 A"},
                              {"label": "B", "text": "选项 B"}
                            ],
                            "images": []
                          }]
                        }
                        """.utf8
                    )
                )
            }

            let body = try XCTUnwrap(request.bodyData)
            let payload = try XCTUnwrap(
                JSONSerialization.jsonObject(with: body) as? [String: Any]
            )
            submissions.append(
                (
                    answer: try XCTUnwrap(payload["given_answer"] as? String),
                    id: try XCTUnwrap(payload["submission_id"] as? String)
                )
            )
            if submissions.count == 1 {
                return (500, Data(#"{"detail":"temporary"}"#.utf8))
            }
            return (
                200,
                Data(
                    """
                    {
                      "answer_id": 10,
                      "is_correct": true,
                      "correct_answer": "B",
                      "mastery_update": {},
                      "idempotent_replay": false
                    }
                    """.utf8
                )
            )
        }
        defer { MockURLProtocol.handler = nil }

        let didStart = await store.start(student: student, kpId: "kp-1", count: 1)
        XCTAssertTrue(didStart)
        store.setAnswer("A", for: "question-1")
        await store.submit(student: student)
        store.setAnswer("B", for: "question-1")
        await store.submit(student: student)

        XCTAssertEqual(submissions.map(\.answer), ["A", "B"])
        XCTAssertNotEqual(submissions.first?.id, submissions.last?.id)
        XCTAssertTrue(store.currentResult?.isCorrect == true)
    }

    @MainActor
    func testWrongChoiceUploadsOnlyFinalDrawingAsProcessEvidence() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let draftRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: draftRoot) }
        let store = PracticeStore(
            apiClient: APIClient(authorizeAI: { _, _, _ in },
                baseURL: URL(string: "https://example.test/api/student")!,
                session: URLSession(configuration: configuration)
            ),
            draftFileStore: AnswerDraftFileStore(rootURL: draftRoot)
        )
        let student = StudentSession(
            token: "token",
            studentID: "student-1",
            username: "learner",
            displayName: "学习者",
            accountStatus: "active")
        let point = PKStrokePoint(
            location: CGPoint(x: 120, y: 80),
            timeOffset: 0,
            size: CGSize(width: 5, height: 5),
            opacity: 1,
            force: 1,
            azimuth: 0,
            altitude: .pi / 2
        )
        let drawing = PKDrawing(
            strokes: [
                PKStroke(
                    ink: PKInk(.pen, color: .black),
                    path: PKStrokePath(
                        controlPoints: [point],
                        creationDate: Date()
                    )
                )]
        )
        var evidenceQuestionIds: [String] = []

        MockURLProtocol.handler = { request in
            let path = try XCTUnwrap(request.url?.path)
            if path.hasSuffix("/practice/session") {
                return (
                    200,
                    Data(
                        """
                        {
                          "student_id": "student-1",
                          "session_type": "practice",
                          "strategy": "weak_kp",
                          "session_objective": "测试练习",
                          "questions": [
                            {
                              "id": "question-wrong",
                              "stem_text": "第一题",
                              "question_type": "single_choice",
                              "options": [{"label": "A", "text": "选项"}],
                              "images": []
                            },
                            {
                              "id": "question-correct",
                              "stem_text": "第二题",
                              "question_type": "single_choice",
                              "options": [{"label": "A", "text": "选项"}],
                              "images": []
                            }
                          ]
                        }
                        """.utf8
                    )
                )
            }
            if path.hasSuffix("/practice/submit") {
                let body = try XCTUnwrap(request.bodyData)
                let payload = try XCTUnwrap(
                    JSONSerialization.jsonObject(with: body) as? [String: Any]
                )
                let questionId = try XCTUnwrap(payload["question_id"] as? String)
                let isCorrect = questionId == "question-correct"
                return (
                    200,
                    Data(
                        """
                        {
                          "answer_id": \(isCorrect ? 12 : 11),
                          "is_correct": \(isCorrect),
                          "correct_answer": "A",
                          "mastery_update": {},
                          "idempotent_replay": false
                        }
                        """.utf8
                    )
                )
            }
            if path.hasSuffix("/practice/process-evidence") {
                let body = try XCTUnwrap(request.bodyData)
                let text = String(decoding: body, as: UTF8.self)
                XCTAssertTrue(text.contains("final_choice_scratch"))
                XCTAssertTrue(text.contains("question-wrong"))
                evidenceQuestionIds.append("question-wrong")
                return (
                    200,
                    Data(
                        """
                        {
                          "answer_id": 11,
                          "question_id": "question-wrong",
                          "process_grading": {
                            "feedback": "已保存最后一版草稿",
                            "process_evidence_kind": "final_choice_scratch",
                            "needs_human_review": false
                          }
                        }
                        """.utf8
                    )
                )
            }
            XCTFail("Unexpected path: \(path)")
            return (404, Data())
        }
        defer { MockURLProtocol.handler = nil }

        let didStart = await store.start(student: student, kpId: "kp-1", count: 2)
        XCTAssertTrue(didStart)
        store.setDrawing(drawing, student: student, questionId: "question-wrong")
        store.setAnswer("A", for: "question-wrong")
        await store.submit(student: student)
        XCTAssertEqual(
            store.currentResult?.processGrading?.processEvidenceKind,
            "final_choice_scratch"
        )

        store.moveForward()
        store.setDrawing(drawing, student: student, questionId: "question-correct")
        store.setAnswer("A", for: "question-correct")
        await store.submit(student: student)

        XCTAssertEqual(evidenceQuestionIds, ["question-wrong"])
        XCTAssertTrue(store.currentResult?.isCorrect == true)
    }

    @MainActor
    func testManualCorrectionReplacesAIResultAndMasteryUpdate() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let store = PracticeStore(
            apiClient: APIClient(authorizeAI: { _, _, _ in },
                baseURL: URL(string: "https://example.test/api/student")!,
                session: URLSession(configuration: configuration)
            )
        )
        let student = StudentSession(
            token: "token",
            studentID: "student-1",
            username: "learner",
            displayName: "学习者",
            accountStatus: "active")

        MockURLProtocol.handler = { request in
            let path = try XCTUnwrap(request.url?.path)
            if path.hasSuffix("/practice/session") {
                return (
                    200,
                    Data(
                        """
                        {
                          "student_id": "student-1",
                          "session_type": "practice",
                          "strategy": "weak_kp",
                          "session_objective": "测试练习",
                          "questions": [{
                            "id": "question-1",
                            "stem_text": "请选择",
                            "question_type": "single_choice",
                            "options": [{"label": "A", "text": "选项"}],
                            "images": []
                          }]
                        }
                        """.utf8
                    )
                )
            }
            if path.hasSuffix("/practice/submit") {
                return (
                    200,
                    Data(
                        """
                        {
                          "answer_id": 31,
                          "is_correct": false,
                          "correct_answer": "A",
                          "mastery_update": {
                            "kp-1": {"before": 0.3, "after": 0.2, "name": "速度"}
                          },
                          "extracted_answer": "A",
                          "process_grading": {
                            "feedback": "AI 判断错误",
                            "grading_confidence": 0.3,
                            "needs_human_review": true
                          },
                          "idempotent_replay": false
                        }
                        """.utf8
                    )
                )
            }
            if path.hasSuffix("/practice/answers/31/correct") {
                let body = try XCTUnwrap(request.bodyData)
                let payload = try XCTUnwrap(
                    JSONSerialization.jsonObject(with: body) as? [String: Any]
                )
                XCTAssertEqual(payload["corrected_answer"] as? String, "A")
                XCTAssertEqual(payload["is_correct"] as? Bool, true)
                XCTAssertNotNil(payload["correction_reason"] as? String)
                return (
                    200,
                    Data(
                        """
                        {
                          "answer_id": 31,
                          "is_correct": true,
                          "correct_answer": "A",
                          "mastery_update": {
                            "kp-1": {"before": 0.2, "after": 0.45, "name": "速度"}
                          },
                          "extracted_answer": "A",
                          "process_grading": {
                            "feedback": "已按人工纠错结果修正。",
                            "needs_human_review": false
                          },
                          "idempotent_replay": false
                        }
                        """.utf8
                    )
                )
            }
            XCTFail("Unexpected path: \(path)")
            return (404, Data())
        }
        defer { MockURLProtocol.handler = nil }

        let didStart = await store.start(student: student, kpId: "kp-1", count: 1)
        XCTAssertTrue(didStart)
        store.setAnswer("A", for: "question-1")
        await store.submit(student: student)
        XCTAssertTrue(store.currentResult?.processGrading?.needsHumanReview == true)

        await store.correctCurrentGrading(student: student, isCorrect: true)

        XCTAssertTrue(store.currentResult?.isCorrect == true)
        XCTAssertEqual(store.currentResult?.masteryUpdate["kp-1"]?.after, 0.45)
        XCTAssertFalse(store.currentResult?.processGrading?.needsHumanReview == true)
    }

    @MainActor
    func testAssessmentUsesDiagnosticSessionAndFinalizesSubmittedAnswers() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let apiClient = APIClient(authorizeAI: { _, _, _ in },
            baseURL: URL(string: "https://example.test/api/student")!,
            session: URLSession(configuration: configuration)
        )
        let store = PracticeStore(apiClient: apiClient)
        let student = StudentSession(
            token: "token",
            studentID: "student-1",
            username: "learner",
            displayName: "学习者",
            accountStatus: "active")

        var requestedQuestionCount: Int?
        var submittedFeedbackAnswerId: Int?
        MockURLProtocol.handler = { request in
            if request.url?.path.hasSuffix("/diagnose/kp/kp-1") == true {
                let body = try XCTUnwrap(request.bodyData)
                let payload = try XCTUnwrap(
                    JSONSerialization.jsonObject(with: body) as? [String: Any]
                )
                requestedQuestionCount = payload["question_count"] as? Int
                return (
                    200,
                    Data(
                        """
                        {
                          "session_type": "kp_diagnostic",
                          "strategy": "kp_diagnostic",
                          "session_objective": "掌握评估「质点」",
                          "questions": [{
                            "id": "question-1",
                            "stem_text": "请选择",
                            "question_type": "single_choice",
                            "target_knowledge_point_id": "kp-1",
                            "options": [{"label": "A", "text": "答案", "rendered": null, "text_rendered": null}],
                            "images": [],
                            "stem_rendered": null
                          }]
                        }
                        """.utf8
                    )
                )
            }
            if request.url?.path.hasSuffix("/practice/submit") == true {
                let body = try XCTUnwrap(request.bodyData)
                let payload = try XCTUnwrap(
                    JSONSerialization.jsonObject(with: body) as? [String: Any]
                )
                XCTAssertEqual(payload["target_knowledge_point_id"] as? String, "kp-1")
                return (
                    200,
                    Data(
                        """
                        {
                          "answer_id": 17,
                          "is_correct": true,
                          "correct_answer": "A",
                          "correct_answer_rendered": null,
                          "explanation": "正确",
                          "explanation_rendered": null,
                          "mastery_update": {
                            "kp-1": {"before": 0.2, "after": 0.83, "name": "质点"}
                          },
                          "detected_misconception": null,
                          "ai_feedback": "很好",
                          "ai_feedback_rendered": null,
                          "extracted_answer": "A",
                          "idempotent_replay": false
                        }
                        """.utf8
                    )
                )
            }

            XCTAssertTrue(
                request.url?.path.hasSuffix(
                    "/diagnose/kp/kp-1/submitted-feedback"
                ) == true
            )
            let body = try XCTUnwrap(request.bodyData)
            let payload = try XCTUnwrap(
                JSONSerialization.jsonObject(with: body) as? [String: Any]
            )
            let answers = try XCTUnwrap(payload["answers"] as? [[String: Any]])
            submittedFeedbackAnswerId = answers.first?["answer_id"] as? Int
            return (
                200,
                Data(
                    """
                    {
                      "kp_id": "kp-1",
                      "kp_name": "质点",
                      "correct_count": 1,
                      "total_count": 1,
                      "mastery_before": 0.2,
                      "mastery_after": 0.83,
                      "recommendation": "mastered",
                      "feedback": "已经很好地掌握。"
                    }
                    """.utf8
                )
            )
        }

        let didStart = await store.startAssessment(
            student: student,
            kpId: "kp-1",
            count: 3
        )
        XCTAssertTrue(didStart)
        XCTAssertTrue(store.isAssessment)
        store.setAnswer("A", for: "question-1")
        await store.submit(student: student)

        XCTAssertEqual(requestedQuestionCount, 3)
        XCTAssertEqual(store.answeredCount, 1)
        XCTAssertNil(store.currentResult)
        XCTAssertNil(submittedFeedbackAnswerId)

        await store.finalizeAssessment(student: student)

        XCTAssertEqual(submittedFeedbackAnswerId, 17)
        XCTAssertTrue(store.currentResult?.isCorrect == true)
        XCTAssertEqual(store.diagnosticResult?.recommendation, "mastered")
        XCTAssertEqual(store.diagnosticResult?.masteryAfter, 0.83)
        MockURLProtocol.handler = nil
    }

    @MainActor
    func testAssessmentSummaryFailureKeepsExitProtectionAndRetriesWithoutRegrading() async throws {
        let store = PracticeStore(apiClient: parityClient())
        let student = makeTestStudentSession()
        var submissions = 0
        var summaries = 0
        MockURLProtocol.handler = { request in
            let path = request.url!.path
            if path.hasSuffix("/diagnose/kp/kp-1") {
                return (200, gaokaoPracticeSessionJSON(questionCount: 1))
            }
            if path.hasSuffix("/practice/submit") {
                submissions += 1
                return (200, Data(#"{"answer_id":17,"is_correct":true,"correct_answer":"A","mastery_update":{},"idempotent_replay":false}"#.utf8))
            }
            if path.hasSuffix("/submitted-feedback") {
                summaries += 1
                let body = try XCTUnwrap(JSONSerialization.jsonObject(with: request.bodyData!) as? [String: Any])
                XCTAssertEqual((body["answers"] as? [[String: Any]])?.first?["answer_id"] as? Int, 17)
                if summaries == 1 { return (503, Data()) }
                return (200, Data(#"{"kp_id":"kp-1","kp_name":"质点","correct_count":1,"total_count":1,"mastery_before":0.2,"mastery_after":0.8,"recommendation":"mastered","feedback":"已掌握"}"#.utf8))
            }
            return try phoneFixtureResponse(request)
        }
        defer { MockURLProtocol.handler = nil }
        let started = await store.startAssessment(student: student, kpId: "kp-1", count: 1)
        XCTAssertTrue(started)
        store.setAnswer("A", for: "gaokao-q1")
        await store.finalizeAssessment(student: student)
        XCTAssertTrue(store.isComplete)
        XCTAssertNil(store.diagnosticResult)
        XCTAssertTrue(store.assessmentSummaryPending)
        XCTAssertTrue(store.needsExitConfirmation, "Grading completion is not diagnostic completion")
        XCTAssertTrue(store.canFinalizeAssessment)
        XCTAssertEqual(store.assessmentSubmitTitle, "重新获取结果")
        XCTAssertTrue(store.exitConfirmationMessage.contains("本组结果尚未生成"))
        let retainedAttempt = store.attemptId

        let app = AppSession(apiClient: parityClient(), sessionStore: PermissionTestSessionStore(session: nil))
        try await app.acceptAuthentication(student)
        app.activePractice = store
        var navigated = false
        app.requestLeavingPractice { navigated = true }
        XCTAssertFalse(navigated)
        XCTAssertTrue(app.showsPracticeExitConfirmation)
        app.cancelPracticeExit()
        XCTAssertEqual(store.attemptId, retainedAttempt)
        XCTAssertEqual(store.answers["gaokao-q1"], "A")

        await store.finalizeAssessment(student: student)
        XCTAssertEqual(submissions, 1, "Summary retry must reuse submitted answer IDs")
        XCTAssertEqual(summaries, 2)
        XCTAssertTrue(store.hasAssessmentResult)
        XCTAssertFalse(store.needsExitConfirmation)
        XCTAssertEqual(store.diagnosticResult?.kpId, "kp-1")
    }

    @MainActor
    func testKpPracticeDefersGradingRetriesRemainingAndPreservesResultOnRestartFailure() async throws {
        let store = PracticeStore(apiClient: parityClient())
        let student = makeTestStudentSession()
        var attempts: [String: Int] = [:]
        var submissionIDs: [String: String] = [:]
        var failRestart = false
        let lock = NSLock()
        MockURLProtocol.handler = { request in
            lock.lock()
            defer { lock.unlock() }
            let path = request.url!.path
            if path.hasSuffix("/practice/session") {
                return failRestart ? (503, Data()) : (200, gaokaoPracticeSessionJSON(questionCount: 2))
            }
            if path.hasSuffix("/practice/submit") {
                let body = try XCTUnwrap(JSONSerialization.jsonObject(with: request.bodyData!) as? [String: Any])
                let id = try XCTUnwrap(body["question_id"] as? String)
                let submissionID = try XCTUnwrap(body["submission_id"] as? String)
                if let previous = submissionIDs[id] { XCTAssertEqual(previous, submissionID) }
                submissionIDs[id] = submissionID
                attempts[id, default: 0] += 1
                if id == "gaokao-q2", attempts[id] == 1 { return (503, Data()) }
                return (200, Data(#"{"answer_id":17,"is_correct":false,"correct_answer":"B","mastery_update":{},"process_grading":{"process_score":50},"idempotent_replay":false}"#.utf8))
            }
            XCTFail("Knowledge-point practice should not request diagnostic feedback: \(path)")
            return (404, Data())
        }
        defer { MockURLProtocol.handler = nil }
        let started = await store.start(student: student, kpId: "kp-1", count: 2, deferredGrading: true)
        XCTAssertTrue(started)
        XCTAssertTrue(store.isSetPractice)
        for index in 0..<2 {
            store.goToQuestion(index)
            store.setAnswer("A", for: "gaokao-q\(index + 1)")
            await store.submit(student: student)
        }
        XCTAssertTrue(attempts.isEmpty, "Selections must not grade before whole-set submission")
        XCTAssertEqual(store.answeredCount, 2)
        await store.finalizeAssessment(student: student)
        XCTAssertEqual(store.results.count, 1)
        XCTAssertTrue(store.needsExitConfirmation)
        XCTAssertEqual(store.assessmentSubmitTitle, "继续批改")
        await store.finalizeAssessment(student: student)
        XCTAssertEqual(attempts, ["gaokao-q1": 1, "gaokao-q2": 2])
        XCTAssertTrue(store.hasAssessmentResult)
        XCTAssertFalse(store.needsExitConfirmation)
        XCTAssertEqual(store.setPracticeSummary?.correctCount, 1, "Partial process scores count as fractional credit")
        XCTAssertEqual(store.setPracticeSummary?.accuracyPercent, 50)
        failRestart = true
        let completedAttempt = store.attemptId
        let restarted = await store.start(student: student, kpId: "kp-1", count: 5, deferredGrading: true)
        XCTAssertFalse(restarted)
        XCTAssertEqual(store.attemptId, completedAttempt)
        XCTAssertEqual(store.results.count, 2)
        XCTAssertNotNil(store.setPracticeSummary)
    }

    @MainActor
    func testAssessmentAutoSavesDraftWhenSwitchingQuestions() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let store = PracticeStore(
            apiClient: APIClient(authorizeAI: { _, _, _ in },
                baseURL: URL(string: "https://example.test/api/student")!,
                session: URLSession(configuration: configuration)
            )
        )
        let student = StudentSession(
            token: "token",
            studentID: "student-1",
            username: "learner",
            displayName: "学习者",
            accountStatus: "active")

        MockURLProtocol.handler = { request in
            XCTAssertTrue(request.url?.path.hasSuffix("/diagnose/kp/kp-1") == true)
            return (
                200,
                Data(
                    """
                    {
                      "session_type": "kp_diagnostic",
                      "strategy": "kp_diagnostic",
                      "session_objective": "掌握评估",
                      "questions": [
                        {
                          "id": "question-1",
                          "stem_text": "第一题",
                          "question_type": "single_choice",
                          "options": [{"label": "A", "text": "选项"}],
                          "images": [],
                          "stem_rendered": null
                        },
                        {
                          "id": "question-2",
                          "stem_text": "第二题",
                          "question_type": "single_choice",
                          "options": [{"label": "B", "text": "选项"}],
                          "images": [],
                          "stem_rendered": null
                        }
                      ]
                    }
                    """.utf8
                )
            )
        }
        defer { MockURLProtocol.handler = nil }

        let didStart = await store.startAssessment(
            student: student,
            kpId: "kp-1",
            count: 2
        )
        XCTAssertTrue(didStart)

        store.setAnswer("A", for: "question-1")
        store.goToQuestion(1)
        XCTAssertTrue(store.collectedQuestionIds.contains("question-1"))
        XCTAssertEqual(store.answeredCount, 1)

        store.setAnswer("B", for: "question-2")
        XCTAssertEqual(store.answeredCount, 2)
        XCTAssertTrue(store.allAssessmentAnswersCollected)

        store.goToQuestion(0)
        XCTAssertEqual(store.currentAnswer, "A")
        XCTAssertFalse(store.currentAnswerIsCollected)
        store.setAnswer("C", for: "question-1")
        XCTAssertEqual(store.currentAnswer, "C")
    }

    @MainActor
    func testSelfReviewRetryReusesSubmissionIdAndSendsCompletedItems() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let apiClient = APIClient(authorizeAI: { _, _, _ in },
            baseURL: URL(string: "https://example.test/api/student")!,
            session: URLSession(configuration: configuration)
        )
        let store = PracticeStore(apiClient: apiClient)
        let student = StudentSession(
            token: "token",
            studentID: "student-1",
            username: "learner",
            displayName: "学习者",
            accountStatus: "active")

        var submittedIds: [String] = []
        var submittedStatuses: [[String]] = []
        var submitAttempts = 0
        MockURLProtocol.handler = { request in
            if request.url?.path.hasSuffix("/practice/session") == true {
                return (
                    200,
                    Data(
                        """
                        {
                          "student_id": "student-1",
                          "session_type": "practice",
                          "strategy": "weak_kp",
                          "session_objective": "测试自评",
                          "questions": [{
                            "id": "question-1",
                            "stem_text": "计算：(1)时间；(2)速度",
                            "question_type": "problem_solving",
                            "target_knowledge_point_id": "kp-self-review",
                            "options": [],
                            "images": [],
                            "stem_rendered": null,
                            "answer": "(1)6 s；(2)60 m/s",
                            "correct_answer": "(1)6 s；(2)60 m/s",
                            "correct_answer_rendered": null,
                            "explanation": "解析",
                            "explanation_rendered": null
                          }]
                        }
                        """.utf8
                    )
                )
            }

            XCTAssertTrue(request.url?.path.hasSuffix("/practice/self-review") == true)
            let body = try XCTUnwrap(request.bodyData)
            let payload = try XCTUnwrap(
                JSONSerialization.jsonObject(with: body) as? [String: Any]
            )
            XCTAssertEqual(
                payload["target_knowledge_point_id"] as? String,
                "kp-self-review"
            )
            submittedIds.append(try XCTUnwrap(payload["submission_id"] as? String))
            let items = try XCTUnwrap(payload["items"] as? [[String: Any]])
            submittedStatuses.append(items.compactMap { $0["status"] as? String })
            submitAttempts += 1
            if submitAttempts == 1 {
                return (500, Data(#"{"detail":"temporary"}"#.utf8))
            }
            return (
                200,
                Data(
                    """
                    {
                      "answer_id": 10,
                      "is_correct": false,
                      "correct_answer": "(1)6 s；(2)60 m/s",
                      "correct_answer_rendered": null,
                      "explanation": "解析",
                      "explanation_rendered": null,
                      "mastery_update": {},
                      "detected_misconception": {"name": "自评待复盘"},
                      "ai_feedback": "已按学生对照解析自评记录本题。",
                      "ai_feedback_rendered": null,
                      "extracted_answer": "自评：(1)完全正确；(2)不会",
                      "idempotent_replay": false
                    }
                    """.utf8
                )
            )
        }

        let didStart = await store.start(student: student, kpId: "kp-1", count: 1)
        XCTAssertTrue(didStart)
        store.setSelfReviewStatus(.correct, itemId: "(1)", questionId: "question-1")
        store.setSelfReviewStatus(.wrong, itemId: "(2)", questionId: "question-1")
        XCTAssertTrue(store.canSubmitCurrentSelfReview)

        await store.submitSelfReview(student: student)
        XCTAssertNil(store.currentResult)
        await store.submitSelfReview(student: student)

        XCTAssertEqual(submittedIds.count, 2)
        XCTAssertEqual(submittedIds.first, submittedIds.last)
        XCTAssertEqual(submittedStatuses, [["correct", "wrong"], ["correct", "wrong"]])
        XCTAssertEqual(store.currentResult?.extractedAnswer, "自评：(1)完全正确；(2)不会")
        MockURLProtocol.handler = nil
    }

    func testPhotoDraftIsNormalizedIntoPrivateJPEG() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = AnswerDraftFileStore(rootURL: root)
        let image = UIGraphicsImageRenderer(size: CGSize(width: 80, height: 60)).image {
            UIColor.systemTeal.setFill()
            $0.fill(CGRect(x: 0, y: 0, width: 80, height: 60))
        }
        let png = try XCTUnwrap(image.pngData())

        let draft = try store.savePhoto(
            data: png,
            studentId: "student/1",
            questionId: "question:1"
        )

        XCTAssertEqual(draft.kind, .photo)
        XCTAssertEqual(draft.mimeType, "image/jpeg")
        XCTAssertTrue(FileManager.default.fileExists(atPath: draft.fileURL.path))
        XCTAssertNotNil(UIImage(contentsOfFile: draft.fileURL.path))
        XCTAssertFalse(draft.fileURL.path.contains("student/1"))
    }

    func testBlankHandwritingIsNotExported() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = AnswerDraftFileStore(rootURL: root)

        XCTAssertThrowsError(
            try store.exportDrawing(
                PKDrawing(),
                studentId: "student-1",
                questionId: "question-1"
            )
        ) { error in
            XCTAssertEqual(error as? AnswerDraftError, .blankDrawing)
        }
    }

    func testQuestionDrawingBackgroundUsesSameCompactTopLeadingLayoutAsWeb() {
        let rect = QuestionDrawingBackgroundLayout.rect(
            sourceSize: CGSize(width: 200, height: 100),
            canvasSize: CGSize(width: 1_000, height: 500)
        )

        XCTAssertEqual(rect.origin.x, 16, accuracy: 0.001)
        XCTAssertEqual(rect.origin.y, 16, accuracy: 0.001)
        XCTAssertEqual(rect.width, 84, accuracy: 0.001)
        XCTAssertEqual(rect.height, 42, accuracy: 0.001)
    }

    func testHandwritingExportFlattensQuestionImageIntoFullCanvas() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = AnswerDraftFileStore(rootURL: root)
        let point = PKStrokePoint(
            location: CGPoint(x: 200, y: 150),
            timeOffset: 0,
            size: CGSize(width: 6, height: 6),
            opacity: 1,
            force: 1,
            azimuth: 0,
            altitude: .pi / 2
        )
        let drawing = PKDrawing(
            strokes: [
                PKStroke(
                    ink: PKInk(.pen, color: .black),
                    path: PKStrokePath(
                        controlPoints: [point],
                        creationDate: Date()
                    )
                )]
        )
        let questionImage = UIGraphicsImageRenderer(
            size: CGSize(width: 100, height: 60)
        ).image {
            UIColor.systemTeal.setFill()
            $0.fill(CGRect(x: 0, y: 0, width: 100, height: 60))
        }

        let draft = try store.exportDrawing(
            drawing,
            backgroundImage: questionImage,
            canvasSize: CGSize(width: 400, height: 300),
            studentId: "student-1",
            questionId: "question-1"
        )
        let exported = try XCTUnwrap(UIImage(contentsOfFile: draft.fileURL.path))

        XCTAssertEqual(draft.kind, .handwriting)
        XCTAssertEqual(
            exported.size.width / exported.size.height,
            4.0 / 3.0,
            accuracy: 0.01
        )
        XCTAssertLessThanOrEqual(max(exported.size.width, exported.size.height), 2_048)
    }

    func testSyncDirectorySelectsMostRecentLearningContext() throws {
        let data = Data(
            """
            {
              "kps": [
                {
                  "id": "kp-1",
                  "name": "电流的磁场",
                  "volume": "选择性必修第二册",
                  "chapter": "第一章 安培力",
                  "section": "第一节",
                  "mastery": 0.8,
                  "status": "current",
                  "learning_state": "practice",
                  "learning_state_label": "需巩固",
                  "learning_state_tone": "practice",
                  "blocked_by": [],
                  "last_practiced": "2026-07-27T10:00:00+00:00"
                },
                {
                  "id": "kp-2",
                  "name": "安培力方向",
                  "volume": "选择性必修第二册",
                  "chapter": "第一章 安培力",
                  "section": "第二节",
                  "mastery": 0.2,
                  "status": "needs_learning",
                  "learning_state": "to_learn",
                  "learning_state_label": "待学习",
                  "learning_state_tone": "locked",
                  "blocked_by": ["kp-1"],
                  "last_practiced": null
                }
              ],
              "stats": {
                "mastered": 0,
                "in_progress": 2,
                "locked": 0,
                "total": 2,
                "learning": 0,
                "to_learn": 1,
                "practice": 1
              },
              "relations": [{
                "id": 1,
                "source_id": "kp-1",
                "target_id": "kp-2",
                "relation_type": "prerequisite",
                "reason": "先理解磁场"
              }]
            }
            """.utf8
        )

        let directory = try JSONDecoder.openPhysics.decode(SyncDirectory.self, from: data)
        let initial = try XCTUnwrap(directory.initialSelection)

        XCTAssertEqual(directory.volumes, ["选择性必修第二册"])
        XCTAssertEqual(initial.chapter?.name, "第一章 安培力")
        XCTAssertEqual(initial.point?.id, "kp-1")
        XCTAssertEqual(directory.relations.first?.targetId, "kp-2")
    }

    func testSyncOpensAtLastPractisedPointAndRecommendsByLearningState() throws {
        func point(_ id: String, _ state: String, _ practiced: String?) -> String {
            """
            {"id": "\(id)", "name": "\(id)", "volume": "必修第一册", "chapter": "第一章 运动的描述",
             "section": null, "mastery": 0.5, "status": "current", "learning_state": "\(state)",
             "learning_state_label": "", "learning_state_tone": "\(state)", "blocked_by": [],
             "last_practiced": \(practiced.map { "\"\($0)\"" } ?? "null")}
            """
        }
        let data = Data(
            """
            {
              "kps": [
                \(point("kp-reference", "practice", "2026-07-25T10:00:00+00:00")),
                \(point("kp-mass-point", "mastered", "2026-07-27T10:00:00+00:00")),
                \(point("kp-timer", "to_learn", nil))
              ],
              "stats": {"mastered": 1, "in_progress": 2, "locked": 0, "total": 3,
                        "learning": 0, "to_learn": 1, "practice": 1},
              "relations": []
            }
            """.utf8
        )
        let directory = try JSONDecoder.openPhysics.decode(SyncDirectory.self, from: data)

        // Opens where the student left off, as on the web.
        XCTAssertEqual(directory.initialSelection?.point?.id, "kp-mass-point")
        // 「推荐」 follows the web rule shared with the home milestone: practice before to_learn.
        XCTAssertEqual(directory.recommendedKnowledgePoint(in: directory.kps)?.id, "kp-reference")
        XCTAssertEqual(
            directory.recommendedKnowledgePoint(in: directory.kps.filter { $0.id != "kp-reference" })?.id,
            "kp-timer"
        )
    }

    func testKnowledgeCardBuildsH5PanePayloadFields() throws {
        let data = Data(
            """
            {
              "kp_id": "kp-1",
              "kp_name": "安培力",
              "card": {
                "content_id": "card-1",
                "kp_id": "kp-1",
                "kp_name": "安培力",
                "title": "安培力知识卡",
                "sections": [{
                  "type": "formula",
                  "title": "关键公式",
                  "content": {
                    "latex": "F=BIL",
                    "variable_table": [
                      {"symbol": "F", "name": "安培力", "unit": "N"}
                    ]
                  },
                  "content_rendered": null
                }],
                "source": "curated",
                "consumed": false
              },
              "slides": null,
              "simulations": [],
              "examples": [],
              "progress": {"card": {"consumed": 0, "total": 1}}
            }
            """.utf8
        )

        let bundle = try JSONDecoder.openPhysics.decode(LearnBundle.self, from: data)
        let card = try XCTUnwrap(bundle.card)
        let section = try XCTUnwrap(card.sections.first)
        let content = try XCTUnwrap(section.paneDictionary["content"] as? [String: Any])
        let variables = try XCTUnwrap(content["variable_table"] as? [[String: Any]])

        XCTAssertEqual(card.contentId, "card-1")
        XCTAssertEqual(section.paneDictionary["type"] as? String, "formula")
        XCTAssertEqual(content["latex"] as? String, "F=BIL")
        XCTAssertEqual(variables.first?["unit"] as? String, "N")
    }

    func testLearningVideosDecodeWebLectureAndExperimentStructure() throws {
        let data = Data(
            """
            {
              "kp_id": "kp-1",
              "kp_name": "自由落体运动",
              "query": "高一物理 自由落体",
              "items": [{
                "id": "main-video",
                "title": "知识点讲解",
                "url": "https://www.bilibili.com/video/BVMAIN/",
                "uploader": "物理老师",
                "duration": "08:00",
                "cover_url": "//i0.hdslb.com/cover.jpg",
                "source": "teacher_curated",
                "category": "最相关讲解",
                "play_count": 1000,
                "reason": "匹配当前知识点",
                "match_focus": "自由落体"
              }],
              "experiment": null,
              "experiments": [{
                "id": "experiment-video",
                "title": "自由落体实验",
                "url": "https://www.bilibili.com/video/BVEXP/",
                "uploader": "实验老师",
                "duration": "02:18",
                "cover_url": null,
                "source": "teacher_experiment_curated",
                "category": "演示实验",
                "reason": "观察实验现象",
                "match_focus": "自由落体"
              }],
              "fallback": true
            }
            """.utf8
        )

        let response = try JSONDecoder.openPhysics.decode(
            LearningVideoRecommendationResponse.self,
            from: data
        )

        XCTAssertEqual(response.items.first?.title, "知识点讲解")
        XCTAssertEqual(response.experimentItems.first?.title, "自由落体实验")
        XCTAssertEqual(
            AppConfig.resolvedAssetURL(response.items.first?.coverUrl)?.absoluteString,
            "https://i0.hdslb.com/cover.jpg"
        )
    }

    func testChapterGraphMatchesWebThreeRowLayoutAndRelations() {
        let points = (0..<13).map { index in
            makeSyncPoint(
                id: "kp-\(index + 1)",
                name: "知识点 \(index + 1)",
                section: "1.\(index / 3 + 1) 小节"
            )
        }
        let relation = SyncDirectoryRelation(
            id: 88,
            sourceId: "kp-1",
            targetId: "kp-5",
            relationType: "prerequisite",
            reason: nil
        )

        let layout = ChapterGraphLayout.build(
            knowledgePoints: points,
            relations: [relation]
        )

        XCTAssertEqual(layout.height, 620)
        XCTAssertEqual(layout.width, 1_008)
        XCTAssertEqual(layout.nodes[0].row, 0)
        XCTAssertEqual(layout.nodes[1].row, 1)
        XCTAssertEqual(layout.nodes[2].row, 2)
        XCTAssertEqual(layout.nodes[3].column, 1)
        XCTAssertEqual(layout.sections.map(\.title), [
            "1.1 小节",
            "1.2 小节",
            "1.3 小节",
            "1.4 小节",
            "1.5 小节"])
        XCTAssertEqual(layout.edges.count, 1)
        XCTAssertEqual(layout.edges.first?.from.id, "kp-1")
        XCTAssertEqual(layout.edges.first?.to.id, "kp-5")
    }

    func testChapterGraphUsesWebSemanticFallbackRelations() {
        let names = [
            "质点",
            "参考系",
            "坐标系",
            "时刻和时间间隔",
            "位移",
            "速度",
            "加速度",
            "v-t 图像"]
        let points = names.enumerated().map { index, name in
            makeSyncPoint(
                id: "semantic-\(index)",
                name: name,
                section: "1.1 运动的描述"
            )
        }

        let layout = ChapterGraphLayout.build(
            knowledgePoints: points,
            relations: []
        )
        let edgePairs = Set(layout.edges.map {
            "\($0.from.knowledgePoint.name)->\($0.to.knowledgePoint.name)"
        })

        XCTAssertTrue(edgePairs.contains("质点->参考系"))
        XCTAssertTrue(edgePairs.contains("参考系->坐标系"))
        XCTAssertTrue(edgePairs.contains("坐标系->位移"))
        XCTAssertTrue(edgePairs.contains("时刻和时间间隔->速度"))
        XCTAssertTrue(edgePairs.contains("位移->速度"))
        XCTAssertTrue(edgePairs.contains("速度->加速度"))
        XCTAssertTrue(edgePairs.contains("速度->v-t 图像"))
        XCTAssertTrue(edgePairs.contains("加速度->v-t 图像"))
    }

    func testChapterGraphUsesTheAndroidTabletGrid() {
        let sections = ["1.1 质点 参考系", "1.1 质点 参考系", "1.2 时间 位移", "1.2 时间 位移",
                        "1.2 时间 位移", "1.2 时间 位移", "1.3 位置变化快慢的描述——速度"]
        let points = sections.enumerated().map { index, section in
            makeSyncPoint(id: "kp-\(index)", name: "知识点 \(index)", section: section)
        }
        let relations = [
            SyncDirectoryRelation(id: 1, sourceId: "kp-0", targetId: "kp-5", relationType: "prerequisite", reason: nil),
            SyncDirectoryRelation(id: 2, sourceId: "kp-5", targetId: "kp-6", relationType: "prerequisite", reason: nil),
            SyncDirectoryRelation(id: 3, sourceId: "kp-1", targetId: "kp-2", relationType: "prerequisite", reason: nil)]

        let layout = ChapterGraphLayout.build(knowledgePoints: points, relations: relations)

        // Three points per column in textbook order, as on Android.
        XCTAssertEqual(layout.nodes.map(\.column), [0, 0, 0, 1, 1, 1, 2])
        XCTAssertEqual(layout.nodes.map(\.row), [0, 1, 2, 0, 1, 2, 0])
        // Each section title sits over its first point.
        XCTAssertEqual(layout.sections.map(\.title), ["1.1 质点 参考系", "1.2 时间 位移", "1.3 位置变化快慢的描述——速度"])
        XCTAssertEqual(layout.sections.map(\.centerX), [layout.nodes[0].center.x, layout.nodes[2].center.x, layout.nodes[6].center.x])
        XCTAssertEqual(Set(layout.edges.map(\.relationId)), [1, 2, 3])
        // A link inside one column runs straight down, leaving and entering at the rims.
        let vertical = ChapterGraphLayout.path(from: layout.nodes[0], to: layout.nodes[2])
        XCTAssertEqual(vertical.controlA.x, layout.nodes[0].center.x)
        XCTAssertGreaterThan(vertical.start.y, layout.nodes[0].center.y)
    }

    func testChapterGraphDrawsPrerequisitesOnceAndKeepsOtherRelationsAside() {
        let points = (0..<4).map { makeSyncPoint(id: "kp-\($0)", name: "知识点 \($0)", section: "1.1 小节") }
        func relation(_ id: Int, _ from: Int, _ to: Int, _ type: String = "prerequisite_of") -> SyncDirectoryRelation {
            SyncDirectoryRelation(id: id, sourceId: "kp-\(from)", targetId: "kp-\(to)", relationType: type, reason: nil)
        }
        let layout = ChapterGraphLayout.build(knowledgePoints: points, relations: [
            relation(1, 0, 1), relation(2, 1, 2), relation(3, 0, 2), relation(4, 2, 3),
            relation(5, 0, 3, "confused_with"), relation(6, 3, 0, "confused_with")])

        // 0→2 is implied by 0→1→2, so only the chain is drawn.
        XCTAssertEqual(layout.edges.map(\.relationId), [1, 2, 4])
        // Non-prerequisite relations are kept aside (once per pair) for the focused point.
        XCTAssertEqual(layout.relatedEdges.map(\.relationId), [5])
    }

    func testChapterGraphReductionKeepsPathsLeavingACycle() {
        let relations = [
            SyncDirectoryRelation(id: 1, sourceId: "a", targetId: "b", relationType: "prerequisite", reason: nil),
            SyncDirectoryRelation(id: 2, sourceId: "b", targetId: "a", relationType: "prerequisite", reason: nil),
            SyncDirectoryRelation(id: 3, sourceId: "a", targetId: "c", relationType: "prerequisite", reason: nil),
            SyncDirectoryRelation(id: 4, sourceId: "b", targetId: "c", relationType: "prerequisite", reason: nil)]
        let reduced = ChapterGraphLayout.transitivelyReduced(relations)
        XCTAssertTrue(reduced.contains { $0.id == 1 })
        XCTAssertTrue(reduced.contains { $0.id == 2 })
        XCTAssertTrue(reduced.contains { $0.targetId == "c" }, "Reduction must keep the cycle connected to its next knowledge point")
    }

    func testChapterGraphReductionPreservesReachabilityForEveryThreePointGraph() {
        let pairs = (0..<3).flatMap { from in (0..<3).filter { $0 != from }.map { (from, $0) } }
        func reachable(_ edges: [SyncDirectoryRelation], _ from: String, _ to: String) -> Bool {
            var stack = [from]
            var seen: Set<String> = []
            while let node = stack.popLast() {
                if node == to { return true }
                guard seen.insert(node).inserted else { continue }
                stack.append(contentsOf: edges.filter { $0.sourceId == node }.map(\.targetId))
            }
            return false
        }
        for mask in 0..<(1 << pairs.count) {
            let edges = pairs.enumerated().compactMap { index, pair -> SyncDirectoryRelation? in
                guard mask & (1 << index) != 0 else { return nil }
                return SyncDirectoryRelation(id: index, sourceId: "\(pair.0)", targetId: "\(pair.1)", relationType: "prerequisite", reason: nil)
            }
            let reduced = ChapterGraphLayout.transitivelyReduced(edges + edges)
            XCTAssertEqual(Set(reduced.map(\.id)).count, reduced.count, "Duplicate arrows: \(mask)")
            for (from, to) in pairs {
                XCTAssertEqual(reachable(edges, "\(from)", "\(to)"), reachable(reduced, "\(from)", "\(to)"), "Graph \(mask): \(from)→\(to)")
            }
        }
    }

    func testSyncPracticeActionsFollowLearningStateRatherThanScore() throws {
        for state in ["to_learn", "learning", "locked", "practice", "mastered"] {
            for mastery in [0.0, 1.0] {
                let data = try JSONSerialization.data(withJSONObject: [
                    "id": "kp-action", "name": "速度", "mastery": mastery,
                    "status": "needs_learning", "learning_state": state,
                    "learning_state_label": "状态", "learning_state_tone": "learning", "blocked_by": []])
                let point = try JSONDecoder.openPhysics.decode(SyncKnowledgePoint.self, from: data)
                let consolidation = ["practice", "mastered"].contains(state)
                XCTAssertEqual(point.usesConsolidationPractice, consolidation, state)
                XCTAssertEqual(point.practiceActionTitle, consolidation ? "巩固小练" : "掌握评估", state)
                XCTAssertEqual(point.learningActionLabel, consolidation ? "回看知识卡" : state == "learning" ? "继续学习" : "开始学习", state)
            }
        }
    }

    func testTabletSidebarStaysCollapsedOnlyInPortraitWidths() {
        // Portrait: iPad mini 744, 11-inch 834, 13-inch 1032 → the sidebar opens on demand.
        for width: CGFloat in [744, 834, 1_032] {
            XCTAssertTrue(TabletShellLayoutPolicy.keepsSidebarCollapsed(width: width), "\(width)")
        }
        // Landscape: iPad mini 1133, 11-inch 1210, 13-inch 1376 keep the side-by-side layout.
        for width: CGFloat in [1_133, 1_210, 1_376] {
            XCTAssertFalse(TabletShellLayoutPolicy.keepsSidebarCollapsed(width: width), "\(width)")
        }
        XCTAssertFalse(TabletShellLayoutPolicy.keepsSidebarCollapsed(width: 0))
    }

    @MainActor
    func testReviewNotebookRetriesADroppedConnectionAndIgnoresCancellation() async {
        var calls = 0
        MockURLProtocol.handler = { _ in
            calls += 1
            if calls == 1 { throw URLError(.networkConnectionLost) }
            return (200, phoneReviewJSON())
        }
        defer { MockURLProtocol.handler = nil }
        let store = ReviewStore(apiClient: parityClient())

        await store.load(student: makeTestStudentSession())

        XCTAssertEqual(calls, 2)
        XCTAssertNotNil(store.data)
        XCTAssertEqual(store.message, "")

        MockURLProtocol.handler = { _ in throw URLError(.cancelled) }
        await store.load(student: makeTestStudentSession(), force: true)
        XCTAssertEqual(store.message, "", "A cancelled request is not reported as a network failure.")
        XCTAssertFalse(store.isLoading)
    }

    func testMultipartBodyContainsFieldsAndFileWithoutChangingSource() throws {
        let sourceURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("\(UUID().uuidString).jpg")
        let source = Data("image-bytes".utf8)
        try source.write(to: sourceURL)
        defer { try? FileManager.default.removeItem(at: sourceURL) }

        let multipart = try MultipartFormDataFile.build(
            fields: [
                "question_id": "question-1",
                "submission_id": "submission-1"],
            fileFieldName: "image",
            sourceFileURL: sourceURL,
            fileName: "answer.jpg",
            mimeType: "image/jpeg"
        )
        defer { multipart.remove() }

        let body = try Data(contentsOf: multipart.fileURL)
        let text = try XCTUnwrap(String(data: body, encoding: .utf8))
        XCTAssertTrue(text.contains("name=\"question_id\""))
        XCTAssertTrue(text.contains("question-1"))
        XCTAssertTrue(text.contains("filename=\"answer.jpg\""))
        XCTAssertTrue(text.contains("image-bytes"))
        XCTAssertTrue(text.contains("name=\"question_id\"\r\n\r\nquestion-1\r\n--\(multipart.boundary)"))
        XCTAssertTrue(text.contains("Content-Type: image/jpeg\r\n\r\nimage-bytes\r\n--\(multipart.boundary)--\r\n"))
        XCTAssertEqual(try Data(contentsOf: sourceURL), source)
    }

    func testPracticeSubmissionSummaryMatchesWebSourceBreakdown() {
        let summary = PracticeSubmissionSourceSummary(
            choice: 2,
            text: 1,
            handwriting: 1,
            photo: 1,
            selfReview: 1,
            unanswered: 2
        )

        XCTAssertEqual(summary.answered, 6)
        XCTAssertEqual(
            summary.displayText,
            "已作答 6 · 选择 2 · 文字 1 · 手写 1 · 照片 1 · 自评 1 · 未作答 2"
        )
    }

    func testReinforcementChapterPlanPrefersRecommendedWeakChapter() {
        let weak = makeSyncPoint(
            id: "kp-weak",
            name: "质点",
            section: "1.1 质点 参考系"
        )
        let stable = SyncKnowledgePoint(
            id: "kp-stable",
            name: "重力",
            volume: "必修 第一册",
            chapter: "第三章 相互作用",
            section: "3.1 重力",
            mastery: 0.9,
            status: "mastered",
            learningState: "mastered",
            learningStateLabel: "已掌握",
            learningStateTone: "mastered",
            blockedBy: [],
            lastPracticed: nil
        )
        let directory = SyncDirectory(
            kps: [weak, stable],
            stats: SyncDirectoryStats(
                mastered: 1,
                inProgress: 0,
                locked: 0,
                total: 2,
                learning: 0,
                toLearn: 1,
                practice: 0
            ),
            relations: []
        )
        let start = ReinforcementStartData(
            isFirstTime: false,
            hasDiagnosed: true,
            recommendedKps: [
                ReinforcementRecommendedKnowledgePoint(
                    kpId: "kp-weak",
                    kpName: "质点",
                    mastery: 0.2,
                    reason: "近期掌握不稳定"
                )]
        )

        let plans = directory.reinforcementChapterPlans(start: start)
        let preferred = directory.preferredReinforcementChapter(
            in: plans,
            start: start
        )

        XCTAssertEqual(preferred?.name, "第一章 运动的描述")
        XCTAssertEqual(preferred?.weakCount, 1)
        XCTAssertEqual(preferred?.statusLabel, "有薄弱")
    }

    func testScopeDiagnosticResultUsesBackendSnakeCaseContract() throws {
        let data = Data(
            """
            {
              "diagnostic_attempt_id": "attempt-1",
              "scope_type": "chapter",
              "scope_id": "第一章 运动的描述",
              "scope_name": "第一章 运动的描述",
              "kp_results": [{
                "id": "result-1",
                "kp_id": "kp-1",
                "kp_name": "质点",
                "group_id": null,
                "group_name": null,
                "correct_count": 1,
                "total_count": 2,
                "mastery_before": 0.2,
                "mastery_after": 0.35,
                "is_weak": true
              }],
              "correct_count": 6,
              "total_count": 10,
              "weak_kp_ids": ["kp-1"],
              "recommendation": "practice",
              "feedback": "建议先补齐薄弱知识点。"
            }
            """.utf8
        )

        let result = try JSONDecoder.openPhysics.decode(
            ScopeDiagnosticResult.self,
            from: data
        )
        XCTAssertEqual(result.accuracyPercent, 60)
        XCTAssertEqual(result.kpResults.first?.kpId, "kp-1")

        let encoded = try JSONEncoder.openPhysics.encode(result)
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: encoded) as? [String: Any]
        )
        XCTAssertEqual(object["scope_type"] as? String, "chapter")
        XCTAssertEqual(object["diagnostic_attempt_id"] as? String, "attempt-1")
    }

    func testImprovementRetestResultDecodesPlanAndTaskOutcome() throws {
        let data = Data(
            """
            {
              "attempt_id": "retest-1",
              "plan": {
                "id": "plan-1",
                "student_id": "student-1",
                "diagnostic_attempt_id": "diagnostic-1",
                "scope_type": "chapter",
                "scope_id": "第一章 运动的描述",
                "scope_name": "第一章 运动的描述",
                "created_at": "2026-07-28T12:00:00Z",
                "updated_at": "2026-07-28T12:10:00Z",
                "completed_at": "2026-07-28T12:10:00Z",
                "correct_count": 6,
                "total_count": 10,
                "weak_count": 1,
                "status": "completed",
                "current_task_id": null,
                "source_result": null,
                "tasks": []
              },
              "correct_count": 2,
              "total_count": 3,
              "passed_count": 1,
              "needs_retest_count": 0,
              "task_results": [{
                "task_id": "task-1",
                "kp_id": "kp-1",
                "kp_name": "质点",
                "correct_count": 2,
                "total_count": 3,
                "mastery_before": 0.4,
                "mastery_after": 0.7,
                "passed": true,
                "next_status": "passed",
                "feedback": "已经稳定掌握。"
              }]
            }
            """.utf8
        )

        let result = try JSONDecoder.openPhysics.decode(
            ImprovementRetestResult.self,
            from: data
        )

        XCTAssertEqual(result.accuracyPercent, 67)
        XCTAssertTrue(result.plan.isCompleted)
        XCTAssertTrue(result.taskResults.first?.passed == true)
    }

    func testImprovementPlanDecodesLegacySourceResultWithoutWeakFlag() throws {
        let data = Data(
            """
            {
              "id": "plan-legacy",
              "student_id": "student-1",
              "diagnostic_attempt_id": "diagnostic-legacy",
              "scope_type": "chapter",
              "scope_id": "第三章 相互作用——力",
              "scope_name": "第三章 相互作用——力",
              "created_at": "2026-07-28T12:00:00Z",
              "updated_at": null,
              "completed_at": null,
              "correct_count": 0,
              "total_count": 10,
              "weak_count": 1,
              "status": "diagnosed",
              "current_task_id": "task-1",
              "source_result": {
                "diagnostic_attempt_id": "diagnostic-legacy",
                "scope_type": "chapter",
                "scope_id": "第三章 相互作用——力",
                "scope_name": "第三章 相互作用——力",
                "kp_results": [{
                  "kp_id": "kp-1",
                  "kp_name": "重力",
                  "correct_count": 0,
                  "total_count": 1,
                  "mastery_before": 0.0,
                  "mastery_after": 0.0
                }],
                "correct_count": 0,
                "total_count": 10,
                "weak_kp_ids": ["kp-1"],
                "recommendation": "study",
                "feedback": "建议先回看薄弱知识。"
              },
              "tasks": [{
                "id": "task-1",
                "plan_id": "plan-legacy",
                "kp_id": "kp-1",
                "kp_name": "重力",
                "group_id": null,
                "group_name": null,
                "correct_count": 0,
                "total_count": 1,
                "mastery_before": 0.0,
                "mastery_after": 0.0,
                "is_weak": true,
                "priority": 1,
                "status": "pending",
                "recommended_action": "review_then_practice",
                "reason": "基础不稳"
              }]
            }
            """.utf8
        )

        let plan = try JSONDecoder.openPhysics.decode(
            ImprovementPlan.self,
            from: data
        )

        XCTAssertEqual(plan.currentTask?.kpName, "重力")
        XCTAssertTrue(plan.sourceResult?.kpResults.first?.isWeak == true)
    }

    @MainActor
    func testDiagnosticHistoryFiltersAndPaginatesWithinSelectedChapter() async throws {
        let chapter = "第一章 运动的描述"
        var queries: [[String: String]] = []
        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/student/diagnostics/scope/attempts")
            let query = Dictionary(uniqueKeysWithValues: URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!
                .queryItems!.map { ($0.name, $0.value ?? "") })
            queries.append(query)
            let offset = Int(query["offset"]!)!
            let ids = query["scope_id"] == chapter ? (offset == 0 ? ["chapter-1", "chapter-2"] : ["chapter-3"]) : ["other-unit"]
            return (200, try diagnosticHistoryFixture(ids: ids, chapter: query["scope_id"] ?? "第二章", total: query["scope_id"] == chapter ? 3 : 1, offset: offset))
        }
        defer { MockURLProtocol.handler = nil }
        let store = ReinforcementStore(apiClient: parityClient())
        let student = makeTestStudentSession()
        await store.loadDiagnosticHistory(student: student, scope: .chapter(chapter))
        XCTAssertEqual(store.diagnosticHistory.map(\.attemptId), ["chapter-1", "chapter-2"])
        XCTAssertTrue(store.hasMoreDiagnosticHistory)
        await store.loadDiagnosticHistory(student: student, reset: false)
        XCTAssertEqual(store.diagnosticHistory.map(\.attemptId), ["chapter-1", "chapter-2", "chapter-3"])
        XCTAssertFalse(store.hasMoreDiagnosticHistory)
        XCTAssertEqual(queries[1]["scope_type"], "chapter")
        XCTAssertEqual(queries[1]["scope_id"], chapter)
        XCTAssertEqual(queries[1]["offset"], "2")
        await store.loadDiagnosticHistory(student: student, scope: .all)
        XCTAssertNil(queries[2]["scope_type"])
        XCTAssertNil(queries[2]["scope_id"])
        XCTAssertEqual(queries[2]["offset"], "0")
        XCTAssertEqual(store.diagnosticHistory.map(\.attemptId), ["other-unit"])
        XCTAssertEqual(store.diagnosticHistoryTotal, 1)
    }

    @MainActor
    func testDiagnosticHistoryIgnoresLateResponseAfterChangingScope() async throws {
        let began = expectation(description: "chapter request began")
        let gate = DispatchSemaphore(value: 0)
        MockURLProtocol.handler = { request in
            let scoped = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!.contains { $0.name == "scope_id" }
            if scoped { began.fulfill(); _ = gate.wait(timeout: .now() + 3) }
            return (200, try diagnosticHistoryFixture(ids: [scoped ? "old-chapter" : "all-result"], chapter: "第一章", total: 1, offset: 0))
        }
        defer { MockURLProtocol.handler = nil; gate.signal() }
        let store = ReinforcementStore(apiClient: parityClient())
        let student = makeTestStudentSession()
        let old = Task { await store.loadDiagnosticHistory(student: student, scope: .chapter("第一章")) }
        await fulfillment(of: [began], timeout: 2)
        let newest = Task { await store.loadDiagnosticHistory(student: student, scope: .all) }
        while store.diagnosticHistoryScope != .all { await Task.yield() }
        gate.signal()
        await old.value
        XCTAssertFalse(store.diagnosticHistory.contains { $0.attemptId == "old-chapter" })
        await newest.value
        XCTAssertEqual(store.diagnosticHistory.map(\.attemptId), ["all-result"])
        XCTAssertFalse(store.isLoadingHistory)
    }

    @MainActor
    func testDiagnosticHistoryFailureClearsOldScopeAndCanRetry() async throws {
        var fail = false
        MockURLProtocol.handler = { _ in
            if fail { return (503, Data(#"{"detail":"暂时不可用"}"#.utf8)) }
            return (200, try diagnosticHistoryFixture(ids: ["record"], chapter: "第一章", total: 1, offset: 0))
        }
        defer { MockURLProtocol.handler = nil }
        let store = ReinforcementStore(apiClient: parityClient())
        let student = makeTestStudentSession()
        await store.loadDiagnosticHistory(student: student, scope: .all)
        fail = true
        await store.loadDiagnosticHistory(student: student, scope: .chapter("第一章"))
        XCTAssertTrue(store.diagnosticHistory.isEmpty)
        XCTAssertFalse(store.diagnosticHistoryError.isEmpty)
        XCTAssertFalse(store.isLoadingHistory)
        fail = false
        await store.loadDiagnosticHistory(student: student)
        XCTAssertEqual(store.diagnosticHistory.map(\.attemptId), ["record"])
        XCTAssertEqual(store.diagnosticHistoryScope, .chapter("第一章"))
        XCTAssertTrue(store.diagnosticHistoryError.isEmpty)
    }

    @MainActor
    func testSwitchingChapterDoesNotReuseAnotherUnitsPlanOrHideAssessment() async throws {
        let firstName = "第一章 运动的描述"
        var chapterQueries: [String] = []
        MockURLProtocol.handler = { request in
            if request.url!.path.hasSuffix("/plans/latest") {
                let scope = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems?.first { $0.name == "scope_id" }?.value
                if let scope { chapterQueries.append(scope) }
                if scope != nil && scope != firstName { return (204, Data()) }
                return (200, Data(#"{"id":"first-plan","student_id":"student-1","diagnostic_attempt_id":"attempt-1","scope_type":"chapter","scope_id":"第一章 运动的描述","scope_name":"第一章 运动的描述","created_at":"2026-10-14T00:00:00Z","correct_count":9,"total_count":10,"weak_count":1,"status":"ready_for_retest","tasks":[]}"#.utf8))
            }
            return try phoneFixtureResponse(request)
        }
        defer { MockURLProtocol.handler = nil }
        let store = ReinforcementStore(apiClient: parityClient())
        let student = makeTestStudentSession()
        await store.load(student: student)
        let first = try XCTUnwrap(store.chapterPlans.first { $0.name == firstName })
        let other = try XCTUnwrap(store.chapterPlans.first { $0.name != firstName })
        store.selectChapter(first)
        await store.loadSelectedChapterSummary(student: student)
        XCTAssertEqual(store.selectedChapterPlan?.id, "first-plan")
        XCTAssertTrue(store.selectedChapterShowsPlanCard)
        store.selectChapter(other)
        XCTAssertNil(store.selectedChapterPlan)
        XCTAssertFalse(store.selectedChapterShowsPlanCard)
        await store.loadSelectedChapterSummary(student: student)
        XCTAssertNil(store.latestPlan)
        XCTAssertFalse(store.selectedChapterShowsPlanCard)
        store.selectChapter(first)
        await store.loadSelectedChapterSummary(student: student)
        XCTAssertEqual(store.selectedChapterPlan?.id, "first-plan")
        XCTAssertEqual(chapterQueries, [first.name, other.name, first.name])
    }

    func testDiagnosticAttemptDetailDecodesWebAndAndroidHistoryContract() throws {
        let data = Data(
            """
            {
              "attempt_id": "attempt-1",
              "student_id": "student-1",
              "scope_type": "chapter",
              "scope_id": "第一章 运动的描述",
              "scope_name": "第一章 运动的描述",
              "diagnostic_type": "scope",
              "status": "submitted",
              "created_at": "2026-07-12T03:23:00Z",
              "submitted_at": "2026-07-12T03:25:00Z",
              "question_ids": ["q-1"],
              "answer_ids": [1],
              "result": {"feedback": "建议先回看基础概念"},
              "correct_count": 1,
              "total_count": 5,
              "weak_count": 1,
              "weak_kp_ids": ["kp-1"],
              "recommendation": "study",
              "feedback": "建议先回看基础概念",
              "kp_results": [{
                "id": "result-1",
                "kp_id": "kp-1",
                "kp_name": "质点",
                "group_id": "group-1",
                "group_name": "1.1 质点 参考系",
                "correct_count": 1,
                "total_count": 2,
                "mastery_before": 0.1,
                "mastery_after": 0.25,
                "is_weak": true
              }],
              "linked_plan_id": "plan-1",
              "linked_plan_status": "in_progress",
              "linked_report_available": false
            }
            """.utf8
        )

        let attempt = try JSONDecoder.openPhysics.decode(
            ScopeDiagnosticAttemptDetail.self,
            from: data
        )

        XCTAssertEqual(attempt.attemptId, "attempt-1")
        XCTAssertEqual(attempt.accuracyPercent, 20)
        XCTAssertEqual(attempt.kpResults.first?.kpName, "质点")
        XCTAssertTrue(attempt.kpResults.first?.isWeak == true)
        XCTAssertEqual(attempt.linkedPlanId, "plan-1")
    }

    func testReviewNotebookDecodesSummaryPayloadUsedByWebAndAndroid() throws {
        let data = Data(
            """
            {
              "groups": [{
                "kp_id": "kp-displacement",
                "kp_name": "路程与位移",
                "wrong_count": 1,
                "mistakes": [{
                  "answer_id": 17,
                  "question_id": "q-17",
                  "stem_text": "关于位移，下列说法正确的是（ ）",
                  "question_type": "single_choice",
                  "options": [{"label": "A", "text": "位移是矢量"}],
                  "images": [],
                  "given_answer": "B",
                  "misconception": {
                    "id": "option_judgment_error",
                    "name": "选项判断错误"
                  },
                  "process_grading": {"needs_human_review": false},
                  "created_at": "2026-07-18T10:00:00Z"
                }]
              }],
              "clearance_progress": {"reviewed": 3, "total": 8},
              "review_center": {
                "total_pending": 5,
                "primary_focus": {
                  "error_type": "option_judgment_error",
                  "error_name": "选项判断错误",
                  "count": 5,
                  "kp_names": ["路程与位移"],
                  "sample_answer_id": 17,
                  "sample_question_id": "q-17",
                  "first_error": "忽略了方向",
                  "next_action": "先判断物理量类型"
                },
                "error_groups": [],
                "review_steps": [],
                "stage_counts": {}
              }
            }
            """.utf8
        )

        let review = try JSONDecoder.openPhysics.decode(ReviewData.self, from: data)

        XCTAssertEqual(review.pendingCount, 5)
        XCTAssertEqual(review.clearancePercent, 38)
        XCTAssertEqual(review.allMistakes.first?.misconceptionName, "选项判断错误")
        XCTAssertEqual(review.allMistakes.first?.options?.first?.label, "A")
    }

    func testQuestionTutorChatUsesCurrentMistakeContext() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let client = APIClient(authorizeAI: { _, _, _ in },
            baseURL: URL(string: "https://example.test/api/student")!,
            session: URLSession(configuration: configuration)
        )
        let student = StudentSession(
            token: "token",
            studentID: "student-1",
            username: "learner",
            displayName: "学习者",
            accountStatus: "active")

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/student/tutor/question-chat")
            XCTAssertEqual(request.httpMethod, "POST")
            let body = try XCTUnwrap(request.bodyData)
            let json = try XCTUnwrap(
                JSONSerialization.jsonObject(with: body) as? [String: Any]
            )
            XCTAssertEqual(json["question_id"] as? String, "question-17")
            XCTAssertEqual(json["given_answer"] as? String, "B")
            XCTAssertEqual(json["message"] as? String, "我第一步错在哪？")
            let history = try XCTUnwrap(json["history"] as? [[String: Any]])
            XCTAssertEqual(history.first?["role"] as? String, "assistant")
            return (200, Data(#"{"text":"先判断速度是否有方向。"}"#.utf8))
        }
        defer { MockURLProtocol.handler = nil }

        let response = try await client.questionTutorChat(
            for: student,
            questionId: "question-17",
            givenAnswer: "B",
            message: "我第一步错在哪？",
            history: [
                LearningChatMessage(role: "assistant", content: "先看题干。")],
            processGrading: nil
        )

        XCTAssertEqual(response, "先判断速度是否有方向。")
    }

    @MainActor
    func testReviewRetryKeepsCorrectResultAndCanRetryClearingOriginalMistake() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let store = PracticeStore(
            apiClient: APIClient(authorizeAI: { _, _, _ in },
                baseURL: URL(string: "https://example.test/api/student")!,
                session: URLSession(configuration: configuration)
            )
        )
        let student = StudentSession(
            token: "token",
            studentID: "student-1",
            username: "learner",
            displayName: "学习者",
            accountStatus: "active")
        var requestedPaths: [String] = []
        var completionAttempts = 0
        MockURLProtocol.handler = { request in
            let path = try XCTUnwrap(request.url?.path)
            requestedPaths.append(path)
            if path.hasSuffix("/review/variations/17") {
                return (
                    200,
                    Data(
                        """
                        {
                          "variations": [{
                            "variation_type": "same_model",
                            "title": "做变式题",
                            "reason": "做对即可清除",
                            "question": {
                              "id": "variation-1",
                              "stem_text": "请选择正确选项",
                              "question_type": "single_choice",
                              "options": [{"label": "A", "text": "正确"}],
                              "images": [],
                              "stem_rendered": null
                            }
                          }]
                        }
                        """.utf8
                    )
                )
            }
            if path.hasSuffix("/practice/submit") {
                return (
                    200,
                    Data(
                        """
                        {
                          "answer_id": 99,
                          "is_correct": true,
                          "correct_answer": "A",
                          "correct_answer_rendered": null,
                          "explanation": "正确",
                          "explanation_rendered": null,
                          "mastery_update": {},
                          "detected_misconception": null,
                          "ai_feedback": "很好",
                          "ai_feedback_rendered": null,
                          "extracted_answer": "A",
                          "idempotent_replay": false
                        }
                        """.utf8
                    )
                )
            }
            if path.hasSuffix("/review/17/complete") {
                let body = try XCTUnwrap(request.bodyData)
                let payload = try XCTUnwrap(
                    JSONSerialization.jsonObject(with: body) as? [String: Any]
                )
                XCTAssertEqual(payload["retry_answer_id"] as? Int, 99)
                completionAttempts += 1
                if completionAttempts == 1 {
                    return (500, Data(#"{"detail":"temporary"}"#.utf8))
                }
                return (200, Data(#"{"cleared":true}"#.utf8))
            }
            XCTFail("Unexpected path: \(path)")
            return (404, Data())
        }

        let started = await store.startReviewRetry(student: student, answerId: 17)
        XCTAssertTrue(started)
        store.setAnswer("A", for: "variation-1")
        await store.submit(student: student)

        XCTAssertFalse(store.reviewRetryCleared)
        XCTAssertTrue(store.currentResult?.isCorrect == true)
        await store.retryReviewCompletion(student: student)

        XCTAssertTrue(store.reviewRetryCleared)
        XCTAssertTrue(store.currentResult?.isCorrect == true)
        XCTAssertEqual(completionAttempts, 2)
        XCTAssertEqual(
            requestedPaths.filter { $0.hasSuffix("/review/17/complete") }.count,
            2
        )
    }

    func testGaokaoCatalogDecodesBackendTreeAndLayerContracts() throws {
        let catalog = try JSONDecoder.openPhysics.decode(
            LearningCatalogData.self,
            from: gaokaoCatalogJSON()
        )

        XCTAssertEqual(catalog.name, "高考复习")
        XCTAssertEqual(catalog.knowledgeBlocks.count, 1)
        XCTAssertEqual(catalog.topicCount, 1)
        XCTAssertEqual(catalog.knowledgeBlocks.first?.topics.first?.title, "运动描述")
        XCTAssertEqual(catalog.knowledgeBlocks.first?.topics.first?.displayCode, "01")
        XCTAssertEqual(catalog.knowledgeBlocks.first?.topics.first?.topicDisplayCode, "01")
        XCTAssertEqual(LearningCatalogTopicLayer.diagnostic.questionCount, 8)
        XCTAssertEqual(LearningCatalogTopicLayer.foundation.questionCount, 5)
        XCTAssertEqual(LearningCatalogTopicLayer.breakthrough.questionCount, 4)
        XCTAssertEqual(LearningCatalogTopicLayer.transfer.questionCount, 4)
        XCTAssertEqual(LearningCatalogTopicLayer.paper.questionCount, 10)
        XCTAssertEqual(
            LearningCatalogTopicLayer.foundation.description,
            "5 题 · 专题内基础梯度 · 题型按专题特点安排。"
        )
        XCTAssertEqual(
            LearningCatalogTopicLayer.breakthrough.description,
            "4 题 · 专题内中段梯度 · 突出典型模型与关键方法。"
        )
        XCTAssertEqual(
            LearningCatalogTopicLayer.transfer.description,
            "4 题 · 专题内较高梯度 · 侧重综合迁移与复杂情境。"
        )
    }

    func testGaokaoAPIClientUsesSharedCatalogContracts() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let client = APIClient(authorizeAI: { _, _, _ in },
            baseURL: URL(string: "https://example.test/api/student")!,
            session: URLSession(configuration: configuration)
        )
        let student = makeTestStudentSession()
        var requestedPaths: [String] = []

        MockURLProtocol.handler = { request in
            let path = try XCTUnwrap(request.url?.path)
            requestedPaths.append(path)
            XCTAssertEqual(
                request.value(forHTTPHeaderField: "Authorization"),
                "Bearer token"
            )

            if path.hasSuffix("/learning-catalogs/gaokao_review") {
                return (200, gaokaoCatalogJSON())
            }
            if path.hasSuffix("/nodes/gaokao_topic_01/overview") {
                return (200, gaokaoOverviewJSON())
            }
            if path.hasSuffix("/nodes/gaokao_topic_01/session") {
                XCTAssertEqual(
                    URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false)?
                        .queryItems?.first(where: { $0.name == "include_rendered" })?.value,
                    "1"
                )
                let payload = try XCTUnwrap(
                    JSONSerialization.jsonObject(
                        with: try XCTUnwrap(request.bodyData)
                    ) as? [String: Any]
                )
                XCTAssertEqual(payload["layer"] as? String, "paper")
                XCTAssertEqual(payload["question_count"] as? Int, 10)
                return (200, gaokaoPracticeSessionJSON(questionCount: 1))
            }
            if path.hasSuffix("/nodes/gaokao_topic_01/evidence") {
                let payload = try XCTUnwrap(
                    JSONSerialization.jsonObject(
                        with: try XCTUnwrap(request.bodyData)
                    ) as? [String: Any]
                )
                XCTAssertEqual(payload["layer"] as? String, "paper")
                XCTAssertEqual(payload["answer_id"] as? Int, 42)
                return (200, gaokaoOverviewJSON())
            }
            XCTFail("Unexpected path: \(path)")
            return (404, Data())
        }
        defer { MockURLProtocol.handler = nil }

        let catalog = try await client.learningCatalog(
            for: student,
            catalogCode: "gaokao_review"
        )
        let overview = try await client.learningCatalogTopicOverview(
            for: student,
            catalogCode: "gaokao_review",
            nodeId: "gaokao_topic_01"
        )
        let session = try await client.learningCatalogTopicSession(
            for: student,
            catalogCode: "gaokao_review",
            nodeId: "gaokao_topic_01",
            layer: .paper,
            questionCount: 20
        )
        let updated = try await client.recordLearningCatalogTopicEvidence(
            for: student,
            catalogCode: "gaokao_review",
            nodeId: "gaokao_topic_01",
            layer: .paper,
            answerId: 42
        )

        XCTAssertEqual(catalog.topicCount, 1)
        XCTAssertEqual(overview.recommendedLayer, .foundation)
        XCTAssertEqual(session.questions.count, 1)
        XCTAssertEqual(updated.nodeId, "gaokao_topic_01")
        XCTAssertEqual(requestedPaths.count, 4)
    }

    @MainActor
    func testGaokaoTrainingGradesImmediatelyAndResynchronizesCorrection() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let store = PracticeStore(
            apiClient: APIClient(authorizeAI: { _, _, _ in },
                baseURL: URL(string: "https://example.test/api/student")!,
                session: URLSession(configuration: configuration)
            )
        )
        let student = makeTestStudentSession()
        var submitCount = 0
        var evidenceCount = 0

        MockURLProtocol.handler = { request in
            let path = try XCTUnwrap(request.url?.path)
            if path.hasSuffix("/nodes/gaokao_topic_01/session") {
                return (200, gaokaoPracticeSessionJSON(questionCount: 1))
            }
            if path.hasSuffix("/practice/submit") {
                submitCount += 1
                return (
                    200,
                    Data(
                        """
                        {
                          "answer_id": 201,
                          "is_correct": true,
                          "correct_answer": "A",
                          "mastery_update": {},
                          "idempotent_replay": false
                        }
                        """.utf8
                    )
                )
            }
            if path.hasSuffix("/practice/answers/201/correct") {
                return (
                    200,
                    Data(
                        """
                        {
                          "answer_id": 201,
                          "is_correct": false,
                          "correct_answer": "A",
                          "mastery_update": {},
                          "idempotent_replay": false
                        }
                        """.utf8
                    )
                )
            }
            if path.hasSuffix("/nodes/gaokao_topic_01/evidence") {
                evidenceCount += 1
                return (200, gaokaoOverviewJSON())
            }
            XCTFail("Unexpected path: \(path)")
            return (404, Data())
        }
        defer { MockURLProtocol.handler = nil }

        let started = await store.startLearningCatalogTopic(
            student: student,
            catalogCode: "gaokao_review",
            nodeId: "gaokao_topic_01",
            topicTitle: "运动描述",
            layer: .foundation
        )
        XCTAssertTrue(started)
        XCTAssertFalse(store.isAssessment)

        store.setAnswer("A", for: "gaokao-q1")
        await store.submit(student: student)

        XCTAssertEqual(submitCount, 1)
        XCTAssertEqual(evidenceCount, 1)
        XCTAssertTrue(store.currentResult?.isCorrect == true)
        XCTAssertEqual(store.learningCatalogSummary?.scoreLabel, "1")

        await store.correctCurrentGrading(student: student, isCorrect: false)

        XCTAssertEqual(evidenceCount, 2)
        XCTAssertTrue(store.currentResult?.isCorrect == false)
        XCTAssertEqual(store.learningCatalogSummary?.scoreLabel, "0")
    }

    @MainActor
    func testGaokaoDiagnosticDefersGradingAndRetriesEvidenceWithoutLosingResult() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let store = PracticeStore(
            apiClient: APIClient(authorizeAI: { _, _, _ in },
                baseURL: URL(string: "https://example.test/api/student")!,
                session: URLSession(configuration: configuration)
            )
        )
        let student = makeTestStudentSession()
        var submitCount = 0
        var evidenceAttemptsByAnswer: [Int: Int] = [:]

        MockURLProtocol.handler = { request in
            let path = try XCTUnwrap(request.url?.path)
            if path.hasSuffix("/nodes/gaokao_topic_01/session") {
                let payload = try XCTUnwrap(
                    JSONSerialization.jsonObject(
                        with: try XCTUnwrap(request.bodyData)
                    ) as? [String: Any]
                )
                XCTAssertEqual(payload["layer"] as? String, "diagnostic")
                XCTAssertEqual(payload["question_count"] as? Int, 8)
                return (200, gaokaoPracticeSessionJSON(questionCount: 2))
            }
            if path.hasSuffix("/practice/submit") {
                submitCount += 1
                let payload = try XCTUnwrap(
                    JSONSerialization.jsonObject(
                        with: try XCTUnwrap(request.bodyData)
                    ) as? [String: Any]
                )
                let questionId = try XCTUnwrap(payload["question_id"] as? String)
                let answerId = questionId == "gaokao-q1" ? 101 : 102
                let isCorrect = questionId == "gaokao-q1"
                let processGrading = isCorrect
                    ? "null"
                    : #"{"process_score":60}"#
                return (
                    200,
                    Data(
                        """
                        {
                          "answer_id": \(answerId),
                          "is_correct": \(isCorrect),
                          "correct_answer": "A",
                          "mastery_update": {},
                          "process_grading": \(processGrading),
                          "idempotent_replay": false
                        }
                        """.utf8
                    )
                )
            }
            if path.hasSuffix("/nodes/gaokao_topic_01/evidence") {
                let payload = try XCTUnwrap(
                    JSONSerialization.jsonObject(
                        with: try XCTUnwrap(request.bodyData)
                    ) as? [String: Any]
                )
                let answerId = try XCTUnwrap(payload["answer_id"] as? Int)
                XCTAssertEqual(payload["layer"] as? String, "diagnostic")
                evidenceAttemptsByAnswer[answerId, default: 0] += 1
                if answerId == 101, evidenceAttemptsByAnswer[answerId] == 1 {
                    return (500, Data(#"{"detail":"temporary"}"#.utf8))
                }
                return (200, gaokaoOverviewJSON())
            }
            XCTFail("Unexpected path: \(path)")
            return (404, Data())
        }
        defer { MockURLProtocol.handler = nil }

        let started = await store.startLearningCatalogTopic(
            student: student,
            catalogCode: "gaokao_review",
            nodeId: "gaokao_topic_01",
            topicTitle: "运动描述",
            layer: .diagnostic
        )
        XCTAssertTrue(started)
        XCTAssertTrue(store.isAssessment)

        store.setAnswer("A", for: "gaokao-q1")
        await store.submit(student: student)
        XCTAssertEqual(submitCount, 0)
        XCTAssertNil(store.results["gaokao-q1"])

        store.goToQuestion(1)
        store.setAnswer("B", for: "gaokao-q2")
        await store.submit(student: student)
        XCTAssertEqual(submitCount, 0)
        XCTAssertTrue(store.allAssessmentAnswersCollected)

        await store.finalizeAssessment(student: student)

        XCTAssertEqual(submitCount, 2)
        XCTAssertEqual(store.learningCatalogSummary?.correctCount, 1.6)
        XCTAssertEqual(store.learningCatalogSummary?.totalCount, 2)
        XCTAssertEqual(store.learningCatalogSummary?.accuracyPercent, 80)
        XCTAssertFalse(store.evidenceSyncMessage.isEmpty)
        XCTAssertNotNil(store.results["gaokao-q1"])
        XCTAssertNotNil(store.results["gaokao-q2"])

        await store.retryLearningCatalogEvidence(student: student)

        XCTAssertTrue(store.evidenceSyncMessage.isEmpty)
        XCTAssertEqual(evidenceAttemptsByAnswer[101], 2)
        XCTAssertEqual(evidenceAttemptsByAnswer[102], 1)
    }
}

private func makeTestStudentSession() -> StudentSession {
    StudentSession(
        token: "token",
        studentID: "student-1",
        username: "learner",
        displayName: "学习者",
        accountStatus: "active")
}

private final class PermissionTestSessionStore: SessionStoring {
    var session: StudentSession?
    init(session: StudentSession?) { self.session = session }
    func readSession() throws -> StudentSession? { session }
    func saveSession(_ session: StudentSession) throws { self.session = session }
    func clearSession() throws { session = nil }
}

private func permissionDirectoryJSON() -> Data {
    Data(#"{"kps":[{"id":"trial-kp","name":"质点","volume":"必修 第一册","chapter":"第一章 运动的描述","section":"1.1 质点 参考系","mastery":0,"status":"not_started","learning_state":"to_learn","learning_state_label":"待学习","learning_state_tone":"neutral","blocked_by":[]},{"id":"paid-kp","name":"曲线运动","volume":"必修 第二册","chapter":"第一章 曲线运动","section":"1.1 曲线运动","mastery":0,"status":"not_started","learning_state":"to_learn","learning_state_label":"待学习","learning_state_tone":"neutral","blocked_by":[]}],"stats":{"mastered":0,"in_progress":0,"locked":0,"total":2,"learning":0,"to_learn":2,"practice":0},"relations":[]}"#.utf8)
}

private func gaokaoCatalogJSON() -> Data {
    Data(
        """
        {
          "id": "catalog-1",
          "code": "gaokao_review",
          "name": "高考复习",
          "description": "专题复习",
          "version": 1,
          "enabled": true,
          "sort_order": 2,
          "config": {"subject": "physics"},
          "node_count": 2,
          "topic_count": 1,
          "nodes": [{
            "id": "gaokao_block_01",
            "code": "block_01",
            "node_type": "block",
            "title": "一、运动与相互作用",
            "description": null,
            "sort_order": 1,
            "config": {"featured": true},
            "mapping_summary": {
              "knowledge_point_count": 2,
              "label_rule_count": 0,
              "question_override_count": 0
            },
            "children": [{
              "id": "gaokao_topic_01",
              "code": "topic_01",
              "node_type": "topic",
              "title": "运动描述",
              "description": null,
              "sort_order": 1,
              "config": {"display_code": "01", "enabled": true},
              "mapping_summary": {
                "knowledge_point_count": 2,
                "label_rule_count": 0,
                "question_override_count": 0
              },
              "children": []
            }]
          }]
        }
        """.utf8
    )
}

private func gaokaoOverviewJSON() -> Data {
    Data(
        """
        {
          "catalog_code": "gaokao_review",
          "node_id": "gaokao_topic_01",
          "topic_code": "01",
          "title": "运动描述",
          "description": null,
          "status": "in_progress",
          "status_label": "复习中",
          "recommended_layer": "foundation",
          "recommended_layer_name": "基础巩固",
          "next_action": "继续巩固",
          "core_knowledge_point_count": 2,
          "attempted_knowledge_point_count": 1,
          "mastered_knowledge_point_count": 1,
          "needs_review_knowledge_point_count": 1,
          "average_mastery": 0.5,
          "last_practiced": "2026-08-10T01:02:03Z"
        }
        """.utf8
    )
}

private func gaokaoPracticeSessionJSON(questionCount: Int) -> Data {
    let questions = (1 ... questionCount).map { index in
        """
        {
          "id": "gaokao-q\(index)",
          "stem_text": "第 \(index) 题",
          "question_type": "single_choice",
          "options": [
            {"label": "A", "text": "选项 A"},
            {"label": "B", "text": "选项 B"}
          ],
          "images": [],
          "stem_rendered": null
        }
        """
    }.joined(separator: ",")
    return Data(
        """
        {
          "student_id": "student-1",
          "session_type": "gaokao_review_diagnostic",
          "strategy": "gaokao_review_diagnostic",
          "session_objective": "专题摸底「运动描述」",
          "questions": [\(questions)]
        }
        """.utf8
    )
}

private func makeSyncPoint(
    id: String,
    name: String,
    section: String
) -> SyncKnowledgePoint {
    SyncKnowledgePoint(
        id: id,
        name: name,
        volume: "必修 第一册",
        chapter: "第一章 运动的描述",
        section: section,
        mastery: 0.2,
        status: "needs_learning",
        learningState: "to_learn",
        learningStateLabel: "未开始",
        learningStateTone: "learning",
        blockedBy: [],
        lastPracticed: nil
    )
}

private final class MockURLProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, Data))?
    static var responseHeaders: [String: String] = [:]

    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        do {
            let handler = try XCTUnwrap(Self.handler)
            let (statusCode, data) = try handler(request)
            let response = try XCTUnwrap(
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: statusCode,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"].merging(Self.responseHeaders) { _, custom in custom }
                )
            )
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

private extension URLRequest {
    var bodyData: Data? {
        if let httpBody { return httpBody }
        guard let stream = httpBodyStream else { return nil }

        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 1_024)
        while true {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count < 0 { return nil }
            if count == 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}

extension APIModelsTests {
    @MainActor
    func testUntouchedSelfReviewQuestionNeedsNoExitConfirmation() async {
        MockURLProtocol.handler = { _ in
            (200, Data(#"{"student_id":"student-1","session_type":"practice","strategy":"weak_kp","session_objective":"测试自评","questions":[{"id":"question-1","stem_text":"计算：(1)时间；(2)速度","question_type":"problem_solving","options":[],"images":[],"stem_rendered":null,"answer":"(1)6 s；(2)60 m/s","correct_answer":"(1)6 s；(2)60 m/s"}]}"#.utf8))
        }
        defer { MockURLProtocol.handler = nil }
        let store = PracticeStore(apiClient: parityClient())
        let started = await store.start(student: makeTestStudentSession(), kpId: "kp-1", count: 1)
        XCTAssertTrue(started)
        XCTAssertFalse(store.needsExitConfirmation, "Nothing entered yet: leaving loses nothing")

        store.setSelfReviewStatus(.correct, itemId: "(1)", questionId: "question-1")
        XCTAssertTrue(store.needsExitConfirmation, "A marked self-review item is unsaved work")
    }
}

extension APIModelsTests {


    @MainActor
    func testTeacherHomeworkListsThenAnswersThroughThePaperFlow() async throws {
        let client = parityClient()
        let student = makeTestStudentSession()
        var answers: [String: Any] = [:]
        MockURLProtocol.handler = { request in
            let path = request.url!.path
            if path.hasSuffix("/teacher-homework") {
                return (200, Data(#"[{"attempt_id":"attempt-1","assignment_id":"assignment-1","title":"第一章个性化作业","class_name":"高三（7）","question_count":3,"graded_count":1,"status":"grading","published_at":null}]"#.utf8))
            }
            if path.hasSuffix("/teacher-homework/attempt-1/session") {
                XCTAssertEqual(request.httpMethod, "POST")
                return (200, try teacherPaperSessionJSON(status: answers.count == 3 ? "completed" : "in_progress"))
            }
            if path.hasSuffix("/teacher-paper-attempts/attempt-1/submit") {
                return (200, try JSONSerialization.data(withJSONObject: teacherPaperObject(status: "grading")))
            }
            if path.hasSuffix("/practice/submit") {
                let body = try XCTUnwrap(JSONSerialization.jsonObject(with: request.bodyData!) as? [String: Any])
                XCTAssertEqual(body["teacher_paper_attempt_id"] as? String, "attempt-1")
                let id = try XCTUnwrap(body["question_id"] as? String)
                let answer = paperAnswer(index: Int(id.suffix(1))!, available: false)
                answers[id] = answer
                return (200, try JSONSerialization.data(withJSONObject: answer))
            }
            XCTFail("Unexpected request: \(path)"); return (404, Data())
        }
        defer { MockURLProtocol.handler = nil }

        let homework = try await client.teacherHomework(for: student)
        XCTAssertEqual(homework.first?.actionTitle, "继续批改")
        XCTAssertEqual(homework.first?.detail, "高三（7） · 已批改 1/3")

        let store = PracticeStore(apiClient: client)
        let started = await store.startTeacherHomework(student: student, attemptId: "attempt-1", title: "第一章个性化作业")
        XCTAssertTrue(started)
        XCTAssertTrue(store.isTeacherPaper)
        XCTAssertTrue(store.isAssessment)
        for index in 1...3 { store.setAnswer("A", for: "gaokao-q\(index)") }
        await store.finalizeAssessment(student: student)
        XCTAssertTrue(store.teacherPaperCompleted)
        XCTAssertEqual(store.results.count, 3)
    }

    @MainActor
    func testPracticeExitCanCancelThenDiscardWithoutDeletingSubmittedEvidence() async throws {
        let client = parityClient()
        MockURLProtocol.handler = { request in
            if request.url!.path.hasSuffix("/session") { return (200, gaokaoPracticeSessionJSON(questionCount: 2)) }
            return (404, Data())
        }
        defer { MockURLProtocol.handler = nil }
        let student = makeTestStudentSession()
        let app = AppSession(apiClient: client, sessionStore: PermissionTestSessionStore(session: nil))
        try await app.acceptAuthentication(student)
        let store = PracticeStore(apiClient: client)
        let started = await store.startLearningCatalogTopic(student: student, catalogCode: "gaokao_review",
            nodeId: "gaokao_topic_01", topicTitle: "运动描述", layer: .diagnostic)
        XCTAssertTrue(started)
        store.setAnswer("A", for: "gaokao-q1")
        app.activePractice = store
        var navigations = 0
        app.requestLeavingPractice { navigations += 1 }
        XCTAssertTrue(app.showsPracticeExitConfirmation)
        XCTAssertEqual(navigations, 0)
        app.cancelPracticeExit()
        XCTAssertEqual(store.answers["gaokao-q1"], "A")
        app.requestLeavingPractice { navigations += 1 }
        app.confirmPracticeExit()
        XCTAssertEqual(navigations, 1)
        XCTAssertNil(store.session)
        XCTAssertTrue(store.answers.isEmpty)
        XCTAssertFalse(app.showsPracticeExitConfirmation)
        XCTAssertNotNil(app.studentSession)
    }

    @MainActor
    func testSyncRefreshKeepsSelectedPointAndUpdatesLearningEntry() async throws {
        var refreshed = false
        MockURLProtocol.handler = { request in
            if request.url!.path.hasSuffix("/mastery-judgments/kps") {
                return (200, Data(#"{"items":[{"kp_id":"paid-kp","mastery_score":0.73,"mastery_level":"stable","intervention_status":"none","confidence":"high"}]}"#.utf8))
            }
            var object = try XCTUnwrap(JSONSerialization.jsonObject(with: permissionDirectoryJSON()) as? [String: Any])
            if refreshed {
                var points = object["kps"] as! [[String: Any]]
                points[1]["learning_state"] = "practice"
                points[1]["mastery"] = 0.73
                object["kps"] = points
            }
            return (200, try JSONSerialization.data(withJSONObject: object))
        }
        defer { MockURLProtocol.handler = nil }
        let store = SyncLearningStore(apiClient: parityClient())
        let student = makeTestStudentSession()
        await store.load(student: student)
        let point = try XCTUnwrap(store.directory?.kps.last)
        store.selectKnowledgePoint(point)
        refreshed = true
        await store.load(student: student, force: true)
        XCTAssertEqual(store.selectedKnowledgePoint?.id, "paid-kp")
        XCTAssertEqual(store.selectedKnowledgePoint?.learningActionLabel, "回看知识卡")
        XCTAssertEqual(store.selectedKnowledgePoint?.practiceActionTitle, "巩固小练")
        XCTAssertEqual(store.selectedKnowledgePoint?.masteryPercent, 73)
        XCTAssertEqual(store.selectedKnowledgePoint?.masteryLabel, "较稳定")
        XCTAssertTrue(store.showsKnowledgePointDetail)
    }

    func testMasteryBandsAndEvidenceLabelsAreIndependent() {
        for (percent, band) in [(0, MasteryColorBand.weak), (39, .weak), (40, .developing),
                                (69, .developing), (70, .stable), (79, .stable), (80, .mastered), (100, .mastered)] {
            XCTAssertEqual(MasteryColorBand.forPercent(percent), band)
        }
        let judgment = KnowledgeMasteryJudgment(kpId: "kp", masteryScore: 0.9, masteryLevel: "mastered",
                                               interventionStatus: "none", confidence: "low")
        XCTAssertEqual(judgment.label, "证据较少")
        XCTAssertEqual(MasteryColorBand.forPercent(90), .mastered)
    }

    func testQuestionVideoMetadataSurvivesHistoryAndNotebookMapping() throws {
        let record = try JSONDecoder.openPhysics.decode(AnswerHistoryRecord.self, from: Data(#"{"id":17,"question_id":"q1","stem_text":"题目","question_type":"single_choice","options":[],"images":[],"given_answer":"A","correct_answer":"B","is_correct":false,"lesson_video":{"id":"v1","title":"视频","duration_seconds":60,"available":true}}"#.utf8))
        XCTAssertTrue(record.lessonVideo?.available == true)
        let detail = record.reviewSummary.paneDetailDictionary
        XCTAssertEqual((detail["lesson_video"] as? [String: Any])?["id"] as? String, "v1")
        XCTAssertTrue(detail["process_grading"] is NSNull, "No placeholder 过程批改 block without grading")
        XCTAssertNotNil(record.paneDictionary["lesson_video"])
        let old = try JSONDecoder.openPhysics.decode(PracticeSession.self, from: gaokaoPracticeSessionJSON(questionCount: 1))
        XCTAssertNil(old.teacherPaper)
        XCTAssertNil(old.answers)
    }

    func testVideoPlaybackIsRequestedForSpecificSubmittedAnswer() async throws {
        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/student/questions/q1/lesson-video")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token")
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: request.bodyData!) as? [String: Any])
            XCTAssertEqual(body["answer_id"] as? Int, 17)
            return (200, Data(#"{"question_id":"q1","title":"第一题","duration_seconds":30,"video_url":"/api/student/teacher-paper-media?token=signed"}"#.utf8))
        }
        defer { MockURLProtocol.handler = nil }
        let video = try await parityClient().lessonVideo(for: makeTestStudentSession(), questionId: "q1", answerId: 17)
        XCTAssertEqual(video.durationSeconds, 30)
    }

    func testUsernameOnlyUpdateDoesNotAskForPasswordOrSMS() throws {
        let data = try JSONEncoder.openPhysics.encode(AccountRequest(username: "演示学习者", renewSession: true))
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(body["username"] as? String, "演示学习者")
        XCTAssertEqual(body["renew_session"] as? Bool, true)
        XCTAssertNil(body["current_password"])
        XCTAssertNil(body["code"])
        XCTAssertNil(body["new_password"])
        let scoped = try JSONEncoder.openPhysics.encode(AccountRequest(captchaId: "c1", captchaAnswer: "ABCD"))
        let scopedBody = try XCTUnwrap(JSONSerialization.jsonObject(with: scoped) as? [String: Any])
        XCTAssertEqual(Set(scopedBody.keys), ["captcha_id", "captcha_answer"])
    }


}

private func privacyReceiptJSON(terms: Bool = true, ai: Bool = true) -> Data {
    Data("{\"privacy_version\":\"2026-10-11.2\",\"ai_version\":\"ios-ai-2026-10-11.2\",\"ios_terms\":\(terms),\"ios_ai\":\(ai),\"ios_ai_withdrawn\":\(!ai)}".utf8)
}

private func parityClient() -> APIClient {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [MockURLProtocol.self]
    return APIClient(authorizeAI: { _, _, _ in }, baseURL: URL(string: "https://example.test/api/student")!, session: URLSession(configuration: config))
}

private func teacherPaperObject(status: String) -> [String: Any] {
    ["id": "wang-paper", "title": "运动描述", "question_count": 3, "has_video": true,
     "attempt_id": "attempt-1", "status": status, "attempt_token": "attempt-token"]
}

private func paperAnswer(index: Int, available: Bool) -> [String: Any] {
    ["answer_id": 100 + index, "is_correct": true, "given_answer": "A", "correct_answer": "A",
     "explanation": "解析", "mastery_update": [String: Any](), "idempotent_replay": false,
     "lesson_video": ["id": "v\(index)", "title": "第\(index)题", "duration_seconds": 60, "available": available]]
}

private func teacherPaperSessionJSON(status: String) throws -> Data {
    var result = try XCTUnwrap(JSONSerialization.jsonObject(with: gaokaoPracticeSessionJSON(questionCount: 3)) as? [String: Any])
    result["teacher_paper"] = teacherPaperObject(status: status)
    if status == "completed" {
        result["answers"] = Dictionary(uniqueKeysWithValues: (1...3).map { ("gaokao-q\($0)", paperAnswer(index: $0, available: true)) })
    }
    return try JSONSerialization.data(withJSONObject: result)
}

extension APIModelsTests {
    @MainActor
    func testCompactLearningLayoutsAcrossDevices() async throws {
        guard ProcessInfo.processInfo.environment["OPENPHYSICS_LAYOUT_QA"] == "1" else {
            throw XCTSkip("Opt-in compact learning layout and shared tutor audit")
        }
        let phone = UIDevice.current.userInterfaceIdiom == .phone
        MockURLProtocol.handler = { request in
            if request.url?.path.hasSuffix("/tutor/question-chat") == true {
                return (200, Data(#"{"text":"先看速度的方向。速度既有大小，也有方向，所以它是矢量。\n\n试着比较：向东走 3 米，再向西走 3 米，路程和位移分别是多少？"}"#.utf8))
            }
            // Batch mastery lookup uses POST with a list of knowledge-point IDs.
            if request.url?.path.hasSuffix("/mastery-judgments/kps") != true,
               request.url?.path.hasSuffix("/reward/growth-report") != true {
                XCTAssertEqual(request.httpMethod, "GET", "Unexpected write while browsing: \(request.url?.path ?? "")")
            }
            if request.url?.path.hasSuffix("/overview") == true {
                var raw = try JSONSerialization.jsonObject(with: gaokaoOverviewJSON()) as! [String: Any]
                raw["title"] = "运动描述、运动图像与追及相遇"
                raw["core_knowledge_point_count"] = 25
                raw["attempted_knowledge_point_count"] = 0
                raw["evidence_count"] = 0
                raw["last_practiced"] = NSNull()
                raw["teacher_papers"] = [teacherPaperObject(status: "not_started")]
                return (200, try JSONSerialization.data(withJSONObject: raw))
            }
            return try phoneFixtureResponse(request)
        }
        defer { MockURLProtocol.handler = nil }
        let student = makeTestStudentSession()
        let app = AppSession(apiClient: parityClient(), sessionStore: PermissionTestSessionStore(session: nil))
        defer { app.logout() }
        try await app.acceptAuthentication(student)
        let sync = SyncLearningStore(apiClient: parityClient())
        await sync.load(student: student)
        let gaokao = GaokaoReviewStore(apiClient: parityClient())
        await gaokao.load(student: student)
        let reinforcement = ReinforcementStore(apiClient: parityClient())
        await reinforcement.load(student: student)
        let pages: [(String, AnyView)] = [
            ("home", AnyView(HomeView())),
            ("account", AnyView(AccountView(form: AccountFormState(api: parityClient())).environmentObject(PrivacyConsentCenter.shared))),
            ("sync", AnyView(SyncLearningView(store: sync))),
            ("reinforcement", AnyView(ReinforcementView(store: reinforcement))),
            ("gaokao-topic", AnyView(GaokaoReviewView(store: gaokao, showsTopic: true)))
        ]
        for (name, page) in pages {
            let host = PhoneRenderHost(NavigationStack { page }.environmentObject(app), landscape: !phone)
            try await host.capture("layout-\(phone ? "phone" : "ipad")-\(name)")
            host.close()
        }
        let tutorStore = ReviewStore(apiClient: parityClient())
        await tutorStore.load(student: student)
        let mistake = try XCTUnwrap(tutorStore.data?.allMistakes.first)
        let tutor = PhoneRenderHost(ReviewTutorSheet(store: tutorStore, mistake: mistake)
            .environmentObject(app), landscape: !phone)
        try await tutor.capture("tutor-\(phone ? "phone" : "ipad")-question-empty")
        await tutorStore.sendTutorMessage("这一步为什么要考虑方向？", mistake: mistake, student: student)
        XCTAssertEqual(tutorStore.tutorMessages.count, 2)
        _ = try await tutor.webView(matching: ".op-pane-knowledge-section", count: 1)
        try await tutor.capture("tutor-\(phone ? "phone" : "ipad")-conversation")
        tutor.close()
        let point = makeSyncPoint(id: "kp-1", name: "速度与加速度", section: "运动的描述")
        let knowledgeTutor = LearningTutorSheet(store: KnowledgeLearningStore(apiClient: parityClient()),
                                               student: student, point: point)
        let learningTutor = PhoneRenderHost(knowledgeTutor, landscape: !phone)
        try await learningTutor.capture("tutor-\(phone ? "phone" : "ipad")-knowledge-empty")
        learningTutor.close()
        let largeTutor = PhoneRenderHost(knowledgeTutor, size: .accessibility1, landscape: !phone)
        try await largeTutor.capture("tutor-\(phone ? "phone" : "ipad")-large-text")
        largeTutor.close()
        if phone {
            let largeTopic = PhoneRenderHost(NavigationStack {
                GaokaoReviewView(store: gaokao, showsTopic: true)
            }.environmentObject(app), size: .accessibility1)
            try await largeTopic.capture("layout-phone-gaokao-large-text"); largeTopic.close()
            let largePoint = PhoneRenderHost(NavigationStack {
                SyncLearningView(store: sync)
            }.environmentObject(app), size: .accessibility1)
            // Match a real tap after the navigation stack has appeared. Presenting a destination
            // in the first synchronous layout can stall SwiftUI on the iOS 27 simulator.
            try await Task.sleep(nanoseconds: 300_000_000)
            let selectedPoint = try XCTUnwrap(sync.selectedKnowledgePoint)
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) { sync.selectKnowledgePoint(selectedPoint) }
            try await largePoint.capture("layout-phone-knowledge-large-text"); largePoint.close()
        }
    }

    @MainActor
    func testChapterGraphFocusRevealsDistantRecommendedAndSelectedPoints() async throws {
        guard ProcessInfo.processInfo.environment["OPENPHYSICS_LAYOUT_QA"] == "1" else {
            throw XCTSkip("Opt-in chapter graph rendering and focus scrolling")
        }
        let points = (0..<36).map { index in
            makeSyncPoint(id: "focus-\(index)", name: "长名称知识点 \(index)：速度与加速度的关系", section: "第 \(index / 3 + 1) 节")
        }
        let relations = (0..<35).map { index in
            SyncDirectoryRelation(id: index, sourceId: points[index].id, targetId: points[index + 1].id,
                                  relationType: "prerequisite", reason: nil)
        }
        func scrollViews(in view: UIView) -> [UIScrollView] {
            (view as? UIScrollView).map { [$0] } ?? view.subviews.flatMap { scrollViews(in: $0) }
        }
        for selected in [nil, points[0].id] as [String?] {
            let host = PhoneRenderHost(VStack {
                ChapterGraphEdgeLegend(focusTitle: selected == nil ? "推荐路径" : "所选知识点")
                ChapterKnowledgeGraphView(knowledgePoints: points, relations: relations,
                    recommendedKnowledgePointId: points.last?.id, selectedKnowledgePointId: selected, onSelect: { _ in })
            }.padding(16), landscape: UIDevice.current.userInterfaceIdiom == .pad)
            defer { host.close() }
            try await host.capture("chapter-graph-\(selected == nil ? "recommended" : "selected")")
            let scroll = try XCTUnwrap(scrollViews(in: host.controller.view).first { $0.contentSize.width > $0.bounds.width + 10 })
            if selected == nil {
                XCTAssertGreaterThan(scroll.contentOffset.x, 100, "A distant recommendation must scroll into view")
            } else {
                XCTAssertLessThan(scroll.contentOffset.x, 100, "The selected point must take priority over the recommendation")
            }
        }
    }


}

@MainActor
private final class ParityHistoryData: ObservableObject {
    @Published var records: [AnswerHistoryRecord]
    init(records: [AnswerHistoryRecord]) { self.records = records }
}

private struct ParityHistoryView: View {
    @ObservedObject var data: ParityHistoryData
    var body: some View {
        HistoryRecordsPaneView(records: data.records, onOpenReview: { _ in }, onError: { _ in })
            .padding(16).background(OpenPhysicsTheme.pageBackground)
    }
}

@MainActor
private final class ParityRenderHost<Content: View> {
    let controller: ParityLandscapeController<Content>
    let window: UIWindow
    init(_ content: Content) {
        controller = ParityLandscapeController(rootView: content)
        if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene {
            window = UIWindow(windowScene: scene)
        } else {
            window = UIWindow(frame: CGRect(x: 0, y: 0, width: 1180, height: 820))
        }
        window.rootViewController = controller
        window.makeKeyAndVisible()
        controller.setNeedsUpdateOfSupportedInterfaceOrientations()
        window.windowScene?.requestGeometryUpdate(.iOS(interfaceOrientations: .landscapeRight))
        controller.view.frame = window.bounds
        controller.view.layoutIfNeeded()
    }
    func close() { window.isHidden = true; window.rootViewController = nil }
    func webView(matching selector: String, count: Int) async throws -> WKWebView {
        for _ in 0..<80 {
            controller.view.layoutIfNeeded()
            if let web = findWebView(controller.view),
               let found = try? await web.evaluateJavaScript("document.querySelectorAll('\(selector)').length") as? Int,
               found == count { return web }
            try await Task.sleep(nanoseconds: 200_000_000)
        }
        XCTFail("Renderer failed to show \(count) \(selector)")
        throw APIError.invalidResponse
    }
    private func findWebView(_ root: UIView) -> WKWebView? {
        if let web = root as? WKWebView { return web }
        return root.subviews.lazy.compactMap(findWebView).first
    }
    func capture(_ name: String) throws {
        XCTAssertGreaterThan(controller.view.bounds.width, controller.view.bounds.height, "Snapshot must use a landscape tablet window")
        let renderer = UIGraphicsImageRenderer(bounds: controller.view.bounds)
        let image = renderer.image { _ in controller.view.drawHierarchy(in: controller.view.bounds, afterScreenUpdates: true) }
        let attachment = XCTAttachment(image: image)
        attachment.name = "ios-parity-\(name)"; attachment.lifetime = .keepAlways
        XCTContext.runActivity(named: name) { $0.add(attachment) }
        let folder = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("parity-screenshots")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try image.pngData()?.write(to: folder.appendingPathComponent("\(name).png"))
    }
}

private final class ParityLandscapeController<Content: View>: UIHostingController<Content> {
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }
    override var preferredInterfaceOrientationForPresentation: UIInterfaceOrientation { .landscapeRight }
}

extension APIModelsTests {

}

extension APIModelsTests {
    @MainActor
    func testPhotoPreviewRetakeAndCancelNeverReplaceSavedAnswerBeforeConfirmation() async throws {
        var requests = 0
        MockURLProtocol.handler = { _ in requests += 1; return (200, photoAuditSession()) }
        defer { MockURLProtocol.handler = nil }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = PracticeStore(apiClient: parityClient(), draftFileStore: AnswerDraftFileStore(rootURL: root))
        let student = makeTestStudentSession()
        let started = await store.start(student: student, kpId: "paid-kp")
        XCTAssertTrue(started)
        let original = photoAuditImage(.blue)
        XCTAssertTrue(store.attachPhoto(data: original, student: student, questionId: "photo-q1"))
        let oldFile = try XCTUnwrap(store.currentMediaDraft?.fileURL)
        let oldBytes = try Data(contentsOf: oldFile)
        let context = try XCTUnwrap(store.beginPhotoSelection(student: student))
        let selection = AnswerPhotoSelection()
        selection.preview(photoAuditImage(.red))
        selection.preview(photoAuditImage(.green)) // Retake, still only a candidate.
        XCTAssertEqual(try Data(contentsOf: oldFile), oldBytes)
        XCTAssertEqual(store.currentAnswerMode, .photo)
        selection.cancel()
        XCTAssertNil(selection.data)
        XCTAssertEqual(try Data(contentsOf: oldFile), oldBytes)
        XCTAssertEqual(requests, 1, "Taking and previewing photos must not upload or grade them")
        selection.preview(photoAuditImage(.red))
        XCTAssertTrue(store.confirmPhoto(data: try XCTUnwrap(selection.data), student: student, context: context))
        XCTAssertNotEqual(try Data(contentsOf: oldFile), oldBytes)
        XCTAssertEqual(requests, 1, "Confirmation attaches locally; grading still requires explicit submission")
    }

    @MainActor
    func testUnconfirmedPhotoPreservesHandwritingAndRejectsStaleQuestionAttemptOrAccount() async throws {
        MockURLProtocol.handler = { _ in (200, photoAuditSession()) }
        defer { MockURLProtocol.handler = nil }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = PracticeStore(apiClient: parityClient(), draftFileStore: AnswerDraftFileStore(rootURL: root))
        let student = makeTestStudentSession()
        _ = await store.start(student: student, kpId: "paid-kp")
        let context = try XCTUnwrap(store.beginPhotoSelection(student: student))
        let selection = AnswerPhotoSelection()
        selection.preview(photoAuditImage(.blue))
        selection.cancel()
        XCTAssertNil(store.currentMediaDraft)
        XCTAssertEqual(store.currentAnswerMode, .handwriting)
        store.goToQuestion(1)
        XCTAssertFalse(store.confirmPhoto(data: photoAuditImage(.red), student: student, context: context))
        store.goToQuestion(0)
        let other = photoAuditStudent(token: "other-token")
        XCTAssertFalse(store.confirmPhoto(data: photoAuditImage(.red), student: other, context: context))
        store.discardUnfinishedWork(studentId: student.studentID)
        _ = await store.start(student: student, kpId: "paid-kp")
        XCTAssertFalse(store.confirmPhoto(data: photoAuditImage(.red), student: student, context: context))
        XCTAssertNil(store.currentMediaDraft)
    }

    @MainActor
    func testInvalidPhotoKeepsExistingCandidateAndSavedFile() async throws {
        MockURLProtocol.handler = { _ in (200, photoAuditSession()) }
        defer { MockURLProtocol.handler = nil }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = PracticeStore(apiClient: parityClient(), draftFileStore: AnswerDraftFileStore(rootURL: root))
        let student = makeTestStudentSession()
        _ = await store.start(student: student, kpId: "paid-kp")
        let data = photoAuditImage(.blue)
        let selection = AnswerPhotoSelection()
        selection.preview(data)
        // A large picture is compacted on preview, so compare with the candidate it became.
        let candidate = try XCTUnwrap(selection.data)
        selection.preview(Data("not an image".utf8))
        XCTAssertEqual(selection.data, candidate)
        XCTAssertFalse(selection.message.isEmpty)
        let context = try XCTUnwrap(store.beginPhotoSelection(student: student))
        XCTAssertTrue(store.confirmPhoto(data: data, student: student, context: context))
        let saved = try XCTUnwrap(store.currentMediaDraft?.fileURL)
        let bytes = try Data(contentsOf: saved)
        XCTAssertFalse(store.confirmPhoto(data: Data(), student: student, context: context))
        XCTAssertEqual(try Data(contentsOf: saved), bytes)
    }

    @MainActor
    func testSuccessfulSubmissionRefreshesSelectedMasteryWithoutCompletionButton() async throws {
        var submitted = false
        MockURLProtocol.handler = { request in
            switch request.url!.lastPathComponent {
            case "session": return (200, gaokaoPracticeSessionJSON(questionCount: 1))
            case "submit": submitted = true; return (200, auditGradedAnswer())
            case "directory": return (200, try auditDirectory(mastery: submitted ? 0.73 : 0.20))
            case "kps": return (200, auditJudgments(mastery: submitted ? 0.73 : 0.20))
            default: return (404, Data())
            }
        }
        defer { MockURLProtocol.handler = nil }
        let student = makeTestStudentSession()
        let sync = SyncLearningStore(apiClient: parityClient())
        await sync.load(student: student)
        sync.selectKnowledgePoint(try XCTUnwrap(sync.directory?.kps.last))
        let practice = PracticeStore(apiClient: parityClient())
        _ = await practice.start(student: student, kpId: "paid-kp")
        practice.setAnswer("A", for: "gaokao-q1")
        await practice.submit(student: student)
        for _ in 0..<150 where sync.selectedKnowledgePoint?.masteryPercent != 73 {
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertEqual(sync.selectedKnowledgePoint?.masteryPercent, 73)
        XCTAssertEqual(sync.directory?.kps.last?.masteryPercent, 73)
        XCTAssertTrue(sync.showsKnowledgePointDetail)
    }

    @MainActor
    func testForceRefreshDuringInflightRequestFetchesNewerSnapshot() async throws {
        let began = expectation(description: "old directory request")
        let gate = DispatchSemaphore(value: 0)
        var requests = 0
        MockURLProtocol.handler = { request in
            if request.url!.lastPathComponent == "directory" {
                requests += 1
                if requests == 1 {
                    began.fulfill()
                    _ = gate.wait(timeout: .now() + 3)
                    return (200, try auditDirectory(mastery: 0.20))
                }
                return (200, try auditDirectory(mastery: 0.85))
            }
            return (200, auditJudgments(mastery: requests == 1 ? 0.20 : 0.85))
        }
        defer { MockURLProtocol.handler = nil; gate.signal() }
        let store = SyncLearningStore(apiClient: parityClient())
        let student = makeTestStudentSession()
        let first = Task { await store.load(student: student) }
        await fulfillment(of: [began], timeout: 2)
        let second = Task { await store.load(student: student, force: true) }
        await Task.yield()
        gate.signal()
        await first.value
        await second.value
        XCTAssertEqual(requests, 2)
        XCTAssertEqual(store.directory?.kps.last?.masteryPercent, 85)
    }

    @MainActor
    func testProgressRefreshRetriesTransientFailureAndIgnoresOtherAccountEvents() async throws {
        var requests = 0
        MockURLProtocol.handler = { request in
            if request.url!.lastPathComponent == "directory" {
                requests += 1
                return requests == 1 ? (503, Data()) : (200, try auditDirectory(mastery: 0.73))
            }
            return (200, auditJudgments(mastery: 0.73))
        }
        defer { MockURLProtocol.handler = nil }
        let store = SyncLearningStore(apiClient: parityClient())
        await store.load(student: makeTestStudentSession())
        XCTAssertEqual(requests, 2)
        XCTAssertEqual(store.directory?.kps.last?.masteryPercent, 73)
        NotificationCenter.default.post(name: .studentLearningProgressChanged, object: "other-token")
        try await Task.sleep(nanoseconds: 250_000_000)
        XCTAssertEqual(requests, 2)
    }

    @MainActor
    func testWrongVariationContinuesWithNewSubmissionAndExcludesPreviousQuestions() async throws {
        var variants = 0
        var ids: [String] = []
        var receivedExclusions: [String] = []
        MockURLProtocol.handler = { request in
            let path = request.url!.path
            if path.contains("/review/variations/") || path.contains("/review/retry/") {
                let excluded = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "exclude_question_ids" }?.value ?? ""
                receivedExclusions.append(excluded)
                if path.contains("/review/retry/") { return (200, Data(#"{"question":null}"#.utf8)) }
                variants += 1
                if variants > 2 { return (200, Data(#"{"variations":[]}"#.utf8)) }
                return (200, auditVariation("variation-\(variants)"))
            }
            if path.hasSuffix("/practice/submit") {
                let payload = try JSONSerialization.jsonObject(with: XCTUnwrap(request.bodyData)) as! [String: Any]
                ids.append(try XCTUnwrap(payload["submission_id"] as? String))
                return (200, auditGradedAnswer())
            }
            XCTFail("Unexpected request: \(path)")
            return (404, Data())
        }
        defer { MockURLProtocol.handler = nil }
        let store = PracticeStore(apiClient: parityClient())
        let student = makeTestStudentSession()
        _ = await store.startReviewRetry(student: student, answerId: 17)
        store.setAnswer("A", for: "variation-1")
        await store.submit(student: student)
        await store.continueReviewRetry(student: student)
        XCTAssertEqual(store.currentQuestion?.id, "variation-2")
        XCTAssertNil(store.currentResult)
        XCTAssertTrue(store.answers.isEmpty)
        store.setAnswer("A", for: "variation-2")
        await store.submit(student: student)
        let previousResult = store.currentResult
        await store.continueReviewRetry(student: student)
        XCTAssertEqual(store.currentQuestion?.id, "variation-2")
        XCTAssertEqual(store.currentResult, previousResult)
        XCTAssertTrue(store.message.contains("没有更多合适"))
        XCTAssertEqual(receivedExclusions, ["", "variation-1", "variation-1,variation-2", "variation-1,variation-2"])
        XCTAssertEqual(Set(ids).count, 2)
        XCTAssertFalse(store.reviewRetryCleared)
    }

    @MainActor
    func testUnfinishedVariationReentryKeepsAnswerAndNetworkFailureKeepsGradedRound() async throws {
        var fail = false
        var requests = 0
        MockURLProtocol.handler = { request in
            requests += 1
            if request.url!.path.hasSuffix("/practice/submit") { return (200, auditGradedAnswer()) }
            return fail ? (503, Data()) : (200, auditVariation("variation-1"))
        }
        defer { MockURLProtocol.handler = nil }
        let store = PracticeStore(apiClient: parityClient())
        let student = makeTestStudentSession()
        _ = await store.startReviewRetry(student: student, answerId: 17)
        store.setAnswer("A", for: "variation-1")
        _ = await store.startReviewRetry(student: student, answerId: 17)
        XCTAssertEqual(requests, 1)
        XCTAssertEqual(store.currentAnswer, "A")
        await store.submit(student: student)
        let oldResult = store.currentResult
        fail = true
        await store.continueReviewRetry(student: student)
        XCTAssertEqual(store.currentResult, oldResult)
        XCTAssertEqual(store.currentQuestion?.id, "variation-1")
        XCTAssertFalse(store.message.isEmpty)
    }

    func testBilibiliSearchKeepsChineseAndLiteralPlusAndWebFallback() throws {
        let raw = "https://search.bilibili.com/all?keyword=%E7%89%A9%E7%90%86+F%3Dma%2Ba%26b"
        let targets = LearningVideoLink.targets(raw)
        let app = try XCTUnwrap(targets.first { $0.url.scheme == "bilibili" })
        let keyword = URLComponents(url: app.url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "keyword" }?.value
        XCTAssertEqual(keyword, "物理 F=ma+a&b")
        XCTAssertTrue(app.url.absoluteString.contains("%2B"))
        XCTAssertTrue(targets.contains { $0.universalLinksOnly && $0.url.host == "m.bilibili.com" })
        XCTAssertEqual(targets.last?.url.absoluteString, raw)
        XCTAssertFalse(try XCTUnwrap(targets.last).universalLinksOnly)
    }

    func testVideoLinksKeepPartsTimesAndRejectUnsafeURLs() throws {
        let raw = "https://www.bilibili.com/video/BV1234567890?p=2&t=37#reply"
        let targets = LearningVideoLink.targets(raw)
        let app = try XCTUnwrap(targets.first { $0.url.scheme == "bilibili" })
        XCTAssertEqual(URLComponents(url: app.url, resolvingAgainstBaseURL: false)?.queryItems?.first?.value, raw)
        XCTAssertEqual(targets.first?.url.absoluteString, raw)
        XCTAssertEqual(LearningVideoLink.targets("https://b23.tv/example?t=20").last?.url.absoluteString, "https://b23.tv/example?t=20")
        XCTAssertEqual(LearningVideoLink.targets("https://notbilibili.com/video").count, 1)
        for invalid in ["javascript:alert(1)", "file:///tmp/test", "bilibili://root", "https://user:pass@bilibili.com/video"] {
            XCTAssertTrue(LearningVideoLink.targets(invalid).isEmpty)
        }
    }

    @MainActor
    func testVideoLaunchStopsAtWorkingAppAndOtherwiseFallsBackToOriginalWebURL() async {
        let raw = "https://search.bilibili.com/all?keyword=physics"
        var attempts: [LearningVideoTarget] = []
        let appOpened = await LearningVideoLink.open(raw) { target in
            attempts.append(target)
            return target.url.scheme == "bilibili"
        }
        XCTAssertTrue(appOpened)
        XCTAssertEqual(attempts.last?.url.scheme, "bilibili")
        XCTAssertFalse(attempts.contains { !$0.universalLinksOnly && $0.url.scheme == "https" })
        attempts = []
        let webOpened = await LearningVideoLink.open(raw) { target in
            attempts.append(target)
            return !target.universalLinksOnly && target.url.scheme == "https"
        }
        XCTAssertTrue(webOpened)
        XCTAssertEqual(attempts.last?.url.absoluteString, raw)
    }

    @MainActor
    func testPhotoConfirmationLandscapeLayout() async throws {
        XCTAssertNotNil(Bundle.main.object(forInfoDictionaryKey: "NSCameraUsageDescription"))
        let selection = AnswerPhotoSelection()
        selection.preview(photoAuditImage(.white))
        let host = ParityRenderHost(AnswerPhotoCaptureView(selection: selection) { _ in
            XCTFail("Previewing must not confirm a photo")
            return nil
        })
        try await Task.sleep(nanoseconds: 400_000_000)
        try host.capture("photo-confirmation")
        host.close()
    }
}

private func photoAuditSession() -> Data {
    Data(#"{"student_id":"student-1","session_type":"practice","strategy":"test","session_objective":"照片作答测试","questions":[{"id":"photo-q1","stem_text":"写出计算过程","question_type":"problem_solving","options":[],"images":[]},{"id":"photo-q2","stem_text":"第二题","question_type":"problem_solving","options":[],"images":[]}]}"#.utf8)
}

private func photoAuditImage(_ color: UIColor) -> Data {
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: 900, height: 600))
    return renderer.pngData { context in
        color.setFill()
        context.fill(CGRect(x: 0, y: 0, width: 900, height: 600))
        let text = "作答照片预览（测试）\n\nv = v₀ + at\n\n请检查字迹和完整性，拍得不好可以重拍。" as NSString
        text.draw(in: CGRect(x: 45, y: 65, width: 810, height: 480), withAttributes: [.font: UIFont.systemFont(ofSize: 28), .foregroundColor: UIColor.black])
    }
}

private func photoAuditStudent(token: String) -> StudentSession {
    StudentSession(token: token, studentID: token, username: "test", displayName: "测试", accountStatus: "active")
}

private func auditDirectory(mastery: Double) throws -> Data {
    var raw = try JSONSerialization.jsonObject(with: permissionDirectoryJSON()) as! [String: Any]
    var points = raw["kps"] as! [[String: Any]]
    points[1]["mastery"] = mastery
    points[1]["learning_state"] = "practice"
    raw["kps"] = points
    return try JSONSerialization.data(withJSONObject: raw)
}

private func auditJudgments(mastery: Double) -> Data {
    Data("{\"items\":[{\"kp_id\":\"paid-kp\",\"mastery_score\":\(mastery),\"mastery_level\":\"stable\",\"intervention_status\":\"none\",\"confidence\":\"high\"}]}".utf8)
}

private func auditGradedAnswer() -> Data {
    Data(#"{"answer_id":99,"is_correct":false,"correct_answer":"B","explanation":"测试解析","mastery_update":{"paid-kp":{"before":0.2,"after":0.73,"name":"测试知识点"}},"idempotent_replay":false}"#.utf8)
}

private func auditVariation(_ id: String) -> Data {
    Data("{\"variations\":[{\"variation_type\":\"same_model\",\"title\":\"做变式题\",\"reason\":\"同一知识点\",\"question\":{\"id\":\"\(id)\",\"stem_text\":\"变式测试\",\"question_type\":\"single_choice\",\"options\":[{\"label\":\"A\",\"text\":\"选项\"}],\"images\":[]}}]}".utf8)
}

private func phoneDashboardJSON() -> Data {
    Data(
"""
            {
              "diagnosis": {
                "overall_mastery": 0.62,
                "mastered_count": 8,
                "in_progress_count": 3,
                "locked_count": 2,
                "weak_points": [
                  {"kp_id": "kp-1", "kp_name": "牛顿第二定律", "mastery": 0.35}
                ]
              },
              "plan": {
                "kp_id": "kp-1",
                "kp_name": "牛顿第二定律",
                "mastery": 0.35,
                "reason": "当前最值得提升",
                "estimated_questions": 5,
                "estimated_minutes": 12
              },
              "motivation": {
                "streak_days": 2,
                "weekly_kps_mastered": 1,
                "mistake_backlog_count": 4,
                "next_milestone": "完成今日任务"
              },
              "knowledge_map": []
            }
            """
        .utf8)
}

private func phoneReviewJSON() -> Data {
    Data(
"""
            {
              "groups": [{
                "kp_id": "kp-displacement",
                "kp_name": "路程与位移",
                "wrong_count": 1,
                "mistakes": [{
                  "answer_id": 17,
                  "question_id": "q-17",
                  "stem_text": "关于位移，下列说法正确的是（ ）",
                  "question_type": "single_choice",
                  "options": [{"label": "A", "text": "位移是矢量"}],
                  "images": [],
                  "given_answer": "B",
                  "misconception": {
                    "id": "option_judgment_error",
                    "name": "选项判断错误"
                  },
                  "process_grading": {"needs_human_review": false},
                  "created_at": "2026-07-18T10:00:00Z"
                }]
              }],
              "clearance_progress": {"reviewed": 3, "total": 8},
              "review_center": {
                "total_pending": 5,
                "primary_focus": {
                  "error_type": "option_judgment_error",
                  "error_name": "选项判断错误",
                  "count": 5,
                  "kp_names": ["路程与位移"],
                  "sample_answer_id": 17,
                  "sample_question_id": "q-17",
                  "first_error": "忽略了方向",
                  "next_action": "先判断物理量类型"
                },
                "error_groups": [],
                "review_steps": [],
                "stage_counts": {}
              }
            }
            """
        .utf8)
}

private func phoneKnowledgeJSON() -> Data {
    Data(
"""
            {
              "kp_id": "kp-1",
              "kp_name": "安培力",
              "card": {
                "content_id": "card-1",
                "kp_id": "kp-1",
                "kp_name": "安培力",
                "title": "安培力知识卡",
                "sections": [{
                  "type": "formula",
                  "title": "关键公式",
                  "content": {
                    "latex": "F=BIL",
                    "variable_table": [
                      {"symbol": "F", "name": "安培力", "unit": "N"}
                    ]
                  },
                  "content_rendered": null
                }],
                "source": "curated",
                "consumed": false
              },
              "slides": null,
              "simulations": [],
              "examples": [],
              "progress": {"card": {"consumed": 0, "total": 1}}
            }
            """
        .utf8)
}


extension APIModelsTests {
    @MainActor
    func testCompactAISettingsRenderWithoutChangingConsent() async throws {
        var reads = 0
        var enabled = true
        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.httpMethod, "GET", "Opening settings must not grant or revoke consent")
            XCTAssertEqual(request.url?.lastPathComponent, "privacy-consent")
            reads += 1
            return (200, privacyReceiptJSON(ai: enabled))
        }
        defer { MockURLProtocol.handler = nil }
        let privacy = PrivacyConsentCenter(api: parityClient())
        for (name, ai, size) in [("compact-ai-enabled", true, DynamicTypeSize.large),
                                ("compact-ai-enabled-large-text", true, .accessibility1),
                                ("compact-ai-disabled", false, .large),
                                ("compact-ai-disabled-large-text", false, .accessibility1)] {
            enabled = ai
            let receipt = try JSONDecoder.openPhysics.decode(PrivacyConsentState.self, from: privacyReceiptJSON(ai: ai))
            privacy.acceptLoginReceipt(receipt, token: "synthetic")
            let host = PhoneRenderHost(AIPrivacyView(privacy: privacy), size: size)
            try await host.capture(name)
            host.close()
            XCTAssertEqual(privacy.state?.aiAccepted, ai)
        }
        XCTAssertEqual(reads, 4)
    }


    func testUniversalAppRetainsTabletAndAddsPhoneWithPortraitSupport() throws {
        let families = try XCTUnwrap(Bundle.main.object(forInfoDictionaryKey: "UIDeviceFamily") as? [Int])
        XCTAssertEqual(Set(families), [1, 2])
        let plist = try Data(contentsOf: Bundle.main.bundleURL.appendingPathComponent("Info.plist"))
        let rawInfo = try XCTUnwrap(PropertyListSerialization.propertyList(from: plist, format: nil) as? [String: Any])
        let orientations = try XCTUnwrap(rawInfo["UISupportedInterfaceOrientations"] as? [String])
        XCTAssertTrue(orientations.contains("UIInterfaceOrientationPortrait"))
        XCTAssertTrue(orientations.contains("UIInterfaceOrientationLandscapeRight"))
        XCTAssertEqual(PhoneTab.destination(for: .sync), .learning)
        XCTAssertEqual(PhoneTab.destination(for: .reinforcement), .learning)
        XCTAssertEqual(PhoneTab.destination(for: .gaokao), .learning)
        XCTAssertEqual(PhoneTab.destination(for: .review), .review)
    }

    @MainActor
    func testPhoneRenderedPagesAndAnswerBridge() async throws {
        guard ProcessInfo.processInfo.environment["OPENPHYSICS_PHONE_QA"] == "1" else {
            throw XCTSkip("Opt-in iPhone audit with synthetic data and local rich-content server")
        }
        XCTAssertEqual(UIDevice.current.userInterfaceIdiom, .phone)
        MockURLProtocol.handler = phoneFixtureResponse
        defer { MockURLProtocol.handler = nil }
        let student = makeTestStudentSession()
        let app = AppSession(apiClient: parityClient(), sessionStore: PermissionTestSessionStore(session: nil))
        defer { app.logout() }
        try await app.acceptAuthentication(student)
        XCTAssertNotNil(app.dashboard)
        let login = PhoneRenderHost(LoginView(form: AccountFormState(api: parityClient())).environmentObject(app))
        try await login.capture("login"); login.close()
        let account = PhoneRenderHost(NavigationStack {
            AccountView(form: AccountFormState(api: parityClient()))
                .environmentObject(PrivacyConsentCenter.shared)
        }.environmentObject(app))
        try await account.capture("account"); account.close()
        let historyStore = PracticeHistoryStore(apiClient: parityClient())
        let history = PhoneRenderHost(NavigationStack {
            PracticeHistoryView(scope: .all, store: historyStore)
        }.environmentObject(app))
        _ = try await history.webView(matching: ".op-pane-history-record", count: 1)
        try await history.capture("history"); history.close()
        let home = PhoneRenderHost(MainShellView().environmentObject(app))
        try await home.capture("home")
        XCTAssertTrue(home.controller.view.bounds.width < 440)
        home.close()
        let hub = PhoneRenderHost(NavigationStack { PhoneLearningHubView() }.environmentObject(app))
        try await hub.capture("learning-hub"); hub.close()

        let directory = SyncLearningStore(apiClient: parityClient())
        await directory.load(student: student)
        let sync = PhoneRenderHost(NavigationStack { SyncLearningView(store: directory) }.environmentObject(app))
        try await sync.capture("directory")
        directory.selectKnowledgePoint(try XCTUnwrap(directory.selectedKnowledgePoint))
        try await sync.capture("knowledge-entry"); sync.close()

        let learning = KnowledgeLearningStore(apiClient: parityClient())
        let point = makeSyncPoint(id: "kp-1", name: "安培力", section: "磁场中的力")
        let knowledge = PhoneRenderHost(NavigationStack {
            KnowledgeLearningView(point: point, store: learning, onCompleted: {})
        }.environmentObject(app))
        _ = try await knowledge.webView(matching: ".op-pane-knowledge-card", count: 1)
        try await knowledge.capture("knowledge-card"); knowledge.close()

        let reinforcement = ReinforcementStore(apiClient: parityClient())
        await reinforcement.load(student: student)
        XCTAssertNotNil(reinforcement.startData)
        let reinforce = PhoneRenderHost(NavigationStack { ReinforcementView(store: reinforcement) }.environmentObject(app))
        try await reinforce.capture("reinforcement"); reinforce.close()

        let gaokao = GaokaoReviewStore(apiClient: parityClient())
        await gaokao.load(student: student)
        let catalog = PhoneRenderHost(NavigationStack { GaokaoReviewView(store: gaokao) }.environmentObject(app))
        try await catalog.capture("gaokao-catalog"); catalog.close()
        let topic = try XCTUnwrap(gaokao.catalog?.knowledgeBlocks.first?.topics.first)
        await gaokao.selectTopic(topic, student: student)
        let topicHost = PhoneRenderHost(NavigationStack { GaokaoReviewView(store: gaokao, showsTopic: true) }.environmentObject(app))
        try await topicHost.capture("gaokao-topic"); topicHost.close()

        let reviewStore = ReviewStore(apiClient: parityClient())
        await reviewStore.load(student: student)
        let review = PhoneRenderHost(NavigationStack { ReviewView(store: reviewStore) }.environmentObject(app))
        let reviewWeb = try await review.webView(matching: ".op-pane-review-main", count: 1)
        let selectionDisplay = try await reviewWeb.evaluateJavaScript("getComputedStyle(document.querySelector('.op-pane-review-check')).display") as? String
        XCTAssertEqual(selectionDisplay, "none")
        let reviewTitleWidth = try await reviewWeb.evaluateJavaScript("document.querySelector('.op-pane-review-main').getBoundingClientRect().width") as? Double
        XCTAssertGreaterThan(reviewTitleWidth ?? 0, 280, "Hiding print selection must also remove its reserved grid column")
        try await review.capture("mistakes"); review.close()

        let mistake = try XCTUnwrap(reviewStore.data?.allMistakes.first)
        let detail = await reviewStore.detail(for: mistake, student: student)
        XCTAssertNotNil(detail, reviewStore.message)
        let mistakeHost = PhoneRenderHost(NavigationStack {
            ReviewMistakeDetailView(store: reviewStore, summary: mistake)
        }.environmentObject(app))
        // iPhone mistake detail now shares the result-first renderer; iPad retains review detail.
        let mistakeWeb = try await mistakeHost.webView(matching: ".op-pane-practice-result", count: 1)
        let mistakeText = try await mistakeWeb.evaluateJavaScript("document.body.innerText") as? String
        XCTAssertTrue(mistakeText?.contains("位移") == true)
        try await mistakeHost.capture("mistake-detail"); mistakeHost.close()

        let practice = PracticeStore(apiClient: parityClient())
        let started = await practice.startAssessment(student: student, kpId: "kp-1", count: 3)
        XCTAssertTrue(started)
        let task = PhoneRenderHost(NavigationStack { PracticeWorkspaceView(store: practice) }.environmentObject(app))
        let web = try await task.webView(matching: ".op-pane-stem", count: 1)
        XCTAssertGreaterThan(web.bounds.width, 330, "The question must use the phone width, not half the screen")
        XCTAssertGreaterThan(web.bounds.height, 360)
        XCTAssertFalse(task.contains(PKCanvasView.self), "Phone choice questions must not create handwriting canvases")
        try await task.capture("practice-long-question")
        let overflow = try await web.evaluateJavaScript("document.documentElement.scrollWidth > innerWidth + 1") as? Bool
        XCTAssertEqual(overflow, false)
        _ = try await web.evaluateJavaScript("window.scrollTo(0, document.documentElement.scrollHeight)")
        try await task.capture("practice-options")
        // Exercise the actual WebKit -> Swift answer callback, including the final question.
        for index in 0..<3 {
            practice.goToQuestion(index)
            try await Task.sleep(nanoseconds: 300_000_000)
            let currentWeb = try await task.webView(matching: ".op-pane-stem", count: 1)
            _ = try await currentWeb.evaluateJavaScript("document.querySelector('.op-pane-option').click()")
            try await Task.sleep(nanoseconds: 150_000_000)
        }
        XCTAssertEqual(practice.answeredCount, 3)
        XCTAssertTrue(practice.canFinalizeAssessment)
        XCTAssertEqual(practice.currentAnswer, "A")
        XCTAssertTrue(practice.results.isEmpty, "Assessment selection must not grade before whole-set submission")
        try await task.capture("assessment-last-answer"); task.close()

        let ordinary = PracticeStore(apiClient: parityClient())
        MockURLProtocol.handler = { request in
            if request.url?.path.hasSuffix("/practice/session") == true {
                var raw = try JSONSerialization.jsonObject(with: gaokaoPracticeSessionJSON(questionCount: 2)) as! [String: Any]
                raw["session_type"] = "practice"; raw["session_objective"] = "日常练习"
                return (200, try JSONSerialization.data(withJSONObject: raw))
            }
            return (200, Data(#"{"answer_id":91,"is_correct":false,"correct_answer":"B","explanation":"比较速度与时间的关系，再判断运动性质。","mastery_update":{},"ai_feedback":"先找出题目中的已知条件。","extracted_answer":"A","idempotent_replay":false}"#.utf8))
        }
        let ordinaryStarted = await ordinary.start(student: student, kpId: "kp-1", count: 2)
        XCTAssertTrue(ordinaryStarted)
        ordinary.setAnswer("A", for: try XCTUnwrap(ordinary.currentQuestion).id)
        await ordinary.submit(student: student)
        XCTAssertEqual(ordinary.currentResult?.isCorrect, false)
        let resultHost = PhoneRenderHost(NavigationStack { PracticeWorkspaceView(store: ordinary) }.environmentObject(app))
        let resultWeb = try await resultHost.webView(matching: ".op-pane-practice-result", count: 1)
        let resultText = try await resultWeb.evaluateJavaScript("document.body.innerText") as? String
        XCTAssertTrue(resultText?.contains("先找出题目中的已知条件") == true)
        try await resultHost.capture("practice-feedback"); resultHost.close()

        let photoPractice = PracticeStore(apiClient: parityClient())
        MockURLProtocol.handler = { _ in (200, photoAuditSession()) }
        let photoStarted = await photoPractice.start(student: student, kpId: "kp-1")
        XCTAssertTrue(photoStarted)
        let context = try XCTUnwrap(photoPractice.beginPhotoSelection(student: student))
        XCTAssertTrue(photoPractice.confirmPhoto(data: photoAuditImage(.white), student: student, context: context))
        let photoHost = PhoneRenderHost(NavigationStack { PracticeWorkspaceView(store: photoPractice) }.environmentObject(app))
        _ = try await photoHost.webView(matching: ".op-pane-stem", count: 1)
        XCTAssertFalse(photoHost.contains(PKCanvasView.self))
        try await photoHost.capture("photo-answer"); photoHost.close()
        let selection = AnswerPhotoSelection(); selection.preview(photoAuditImage(.white))
        let preview = PhoneRenderHost(AnswerPhotoCaptureView(selection: selection) { _ in
            XCTFail("Preview must not save or submit automatically"); return nil
        })
        try await preview.capture("photo-confirmation"); preview.close()
        MockURLProtocol.handler = phoneFixtureResponse

        let cardItems = [PracticeQuestionNavigationState.pending, .answered, .correct, .wrong].enumerated().map {
            PracticeQuestionNavigationItem(id: "card-\($0.offset)", index: $0.offset, state: $0.element)
        }
        for (name, size) in [("answer-card", DynamicTypeSize.large), ("answer-card-large-text", .accessibility1)] {
            let card = PhoneRenderHost(PracticeAnswerCard(items: cardItems, currentIndex: 3, navigationEnabled: true,
                                                        onSelectQuestion: { _ in }, onClose: {}), size: size)
            try await card.capture(name); card.close()
        }
        let largeEntry = PhoneRenderHost(NavigationStack { SyncLearningView(store: directory) }.environmentObject(app), size: .accessibility1)
        try await largeEntry.capture("knowledge-entry-large-text"); largeEntry.close()

        var failSummary = true
        MockURLProtocol.handler = { request in
            let path = request.url!.path
            if path.hasSuffix("/submitted-feedback") {
                if failSummary { return (503, Data()) }
                return (200, Data(#"{"kp_id":"kp-1","kp_name":"质点","correct_count":1,"total_count":2,"mastery_before":0.2,"mastery_after":0.4,"recommendation":"study","feedback":"建议回看概念，并结合小练确认理解。"}"#.utf8))
            }
            if path.hasSuffix("/practice/submit") {
                let body = try JSONSerialization.jsonObject(with: request.bodyData!) as! [String: Any]
                let isFirst = (body["question_id"] as? String) == "gaokao-q1"
                return (200, try JSONSerialization.data(withJSONObject: ["answer_id": isFirst ? 17 : 18, "is_correct": isFirst,
                    "correct_answer": isFirst ? "A" : "B", "mastery_update": [:], "idempotent_replay": false,
                    "explanation": "根据运动图像的斜率判断速度。", "ai_feedback": "注意图像的纵轴与横轴。"] as [String: Any]))
            }
            if path.hasSuffix("/diagnose/kp/kp-1") || path.hasSuffix("/practice/session") {
                return (200, gaokaoPracticeSessionJSON(questionCount: 2))
            }
            return try phoneFixtureResponse(request)
        }
        let failureStore = PracticeStore(apiClient: parityClient())
        _ = await failureStore.startAssessment(student: student, kpId: "kp-1", count: 2)
        for index in 1...2 { failureStore.setAnswer("A", for: "gaokao-q\(index)") }
        await failureStore.finalizeAssessment(student: student)
        XCTAssertTrue(failureStore.assessmentSummaryPending)
        let failureHost = PhoneRenderHost(NavigationStack { PracticeWorkspaceView(store: failureStore) }.environmentObject(app))
        _ = try await failureHost.webView(matching: ".op-pane-stem", count: 1)
        try await failureHost.capture("assessment-result-retry")
        failSummary = false
        await failureStore.finalizeAssessment(student: student)
        try await failureHost.capture("assessment-result-study", includingPresentation: true); failureHost.close()
        _ = await failureStore.start(student: student, kpId: "kp-1", count: 2, deferredGrading: true)
        let smallPractice = PhoneRenderHost(NavigationStack { PracticeWorkspaceView(store: failureStore) }.environmentObject(app))
        _ = try await smallPractice.webView(matching: ".op-pane-stem", count: 1)
        for index in 1...2 { failureStore.setAnswer("A", for: "gaokao-q\(index)") }
        await failureStore.finalizeAssessment(student: student)
        XCTAssertEqual(failureStore.setPracticeSummary?.correctCount, 1)
        try await smallPractice.capture("kp-practice-result", includingPresentation: true); smallPractice.close()
        MockURLProtocol.handler = phoneFixtureResponse

        let large = PhoneRenderHost(MainShellView().environmentObject(app), size: .accessibility1)
        try await large.capture("home-large-text"); large.close()
        let largeTask = PhoneRenderHost(NavigationStack { PracticeWorkspaceView(store: practice) }.environmentObject(app), size: .accessibility1)
        let largeWeb = try await largeTask.webView(matching: ".op-pane-stem", count: 1)
        let fontSize = try await largeWeb.evaluateJavaScript("parseFloat(getComputedStyle(document.querySelector('.op-pane-root')).fontSize)") as? Double
        XCTAssertGreaterThan(fontSize ?? 0, 20, "Phone H5 must respect system Dynamic Type")
        try await largeTask.capture("practice-large-text"); largeTask.close()
        let landscape = PhoneRenderHost(NavigationStack { PracticeWorkspaceView(store: practice) }.environmentObject(app), landscape: true)
        _ = try await landscape.webView(matching: ".op-pane-stem", count: 1)
        try await landscape.capture("practice-landscape")
        XCTAssertGreaterThan(landscape.controller.view.bounds.width, landscape.controller.view.bounds.height)
        XCTAssertFalse(landscape.contains(PKCanvasView.self)); landscape.close()
    }
}

private func phoneFixtureResponse(_ request: URLRequest) throws -> (Int, Data) {
    let path = request.url?.path ?? ""
    if path.hasSuffix("/auth/capabilities") { return (200, Data(#"{"self_registration_enabled":false,"sms_login_enabled":true,"sms_password_reset_enabled":true,"sms_phone_change_enabled":true,"sms_phone_bind_enabled":true}"#.utf8)) }
    if path.hasSuffix("/classes") { return (200, Data("[]".utf8)) }
    if path.hasSuffix("/auth/account-credentials") { return (200, Data(#"{"username":"学习者","has_password":true,"username_change_limit":2,"username_change_window_days":30,"username_changes_remaining":2}"#.utf8)) }
    if path.hasSuffix("/history/answers") { return (200, Data(#"[{"id":17,"question_id":"q-17","stem_text":"关于位移，下列说法正确的是（ ）","question_type":"single_choice","options":[{"label":"A","text":"位移是矢量"},{"label":"B","text":"位移是标量"}],"images":[],"given_answer":"B","correct_answer":"A","is_correct":false,"created_at":"2026-09-28T00:00:00Z"}]"#.utf8)) }
    if path.hasSuffix("/dashboard") { return (200, phoneDashboardJSON()) }
    if path.hasSuffix("/directory") { return (200, permissionDirectoryJSON()) }
    if path.hasSuffix("/judgments") { return (200, Data(#"{"items":[]}"#.utf8)) }
    if path.hasSuffix("/train/start") { return (200, Data(#"{"is_first_time":false,"has_diagnosed":true,"recommended_kps":[]}"#.utf8)) }
    if path.contains("/improvement/") { return (204, Data()) }
    if path.hasSuffix("/gaokao_review") { return (200, gaokaoCatalogJSON()) }
    if path.hasSuffix("/overview") { return (200, gaokaoOverviewJSON()) }
    if path.hasSuffix("/review") { return (200, phoneReviewJSON()) }
    if path.hasSuffix("/review/17") {
        let notebook = try JSONSerialization.jsonObject(with: phoneReviewJSON()) as! [String: Any]
        let group = (notebook["groups"] as! [[String: Any]])[0]
        var detail = (group["mistakes"] as! [[String: Any]])[0]
        detail["correct_answer"] = "A"
        detail["explanation"] = "位移描述位置的变化，方向从初位置指向末位置。"
        return (200, try JSONSerialization.data(withJSONObject: detail))
    }
    if path.hasSuffix("/learn/kp-1") { return (200, phoneKnowledgeJSON()) }
    if path.contains("/diagnose/kp/") {
        var raw = try JSONSerialization.jsonObject(with: gaokaoPracticeSessionJSON(questionCount: 3)) as! [String: Any]
        var questions = raw["questions"] as! [[String: Any]]
        for index in questions.indices {
            questions[index]["stem_text"] = "第 \(index + 1) 题：" + String(repeating: "汽车从静止开始沿水平直线运动，请分析速度、时间、加速度和位移的关系。", count: 6)
            questions[index]["options"] = [
                ["label":"A", "text":"速度随时间均匀增加，加速度保持不变。"],
                ["label":"B", "text":"位移与时间成正比。"],
                ["label":"C", "text":"速度的方向一定与加速度相反。"],
                ["label":"D", "text":"运动过程中的平均速度始终为零。"]]
        }
        raw["questions"] = questions
        return (200, try JSONSerialization.data(withJSONObject: raw))
    }
    return (404, Data())
}

@MainActor
private final class PhoneRenderHost<Content: View> {
    let controller: PhoneAuditController
    let window: UIWindow
    init(_ content: Content, size: DynamicTypeSize = .large, landscape: Bool = false) {
        controller = PhoneAuditController(rootView: AnyView(content.dynamicTypeSize(size)), landscape: landscape)
        window = UIWindow(windowScene: UIApplication.shared.connectedScenes.first as! UIWindowScene)
        window.rootViewController = controller
        window.makeKeyAndVisible()
        controller.setNeedsUpdateOfSupportedInterfaceOrientations()
        window.windowScene?.requestGeometryUpdate(.iOS(interfaceOrientations: landscape ? .landscapeRight : .portrait))
        controller.view.layoutIfNeeded()
    }
    func close() { window.isHidden = true; window.rootViewController = nil }
    func contains<T: UIView>(_ type: T.Type) -> Bool { find(controller.view, type: type) != nil }
    func textFieldFrames() -> [CGRect] {
        controller.view.layoutIfNeeded()
        func collect(_ view: UIView) -> [CGRect] {
            if let field = view as? UITextField, !field.isHidden, field.bounds.width > 0 {
                return [field.convert(field.bounds, to: controller.view)]
            }
            return view.subviews.flatMap(collect)
        }
        return collect(controller.view).sorted { $0.minY < $1.minY }
    }
    private func find<T: UIView>(_ root: UIView, type: T.Type) -> T? {
        if let match = root as? T { return match }
        return root.subviews.lazy.compactMap { self.find($0, type: type) }.first
    }
    func webView(matching selector: String, count: Int) async throws -> WKWebView {
        for _ in 0..<80 {
            controller.view.layoutIfNeeded()
            if let web = find(controller.view, type: WKWebView.self),
               let found = try? await web.evaluateJavaScript("document.querySelectorAll('\(selector)').length") as? Int,
               found == count { return web }
            try await Task.sleep(nanoseconds: 200_000_000)
        }
        try await capture("missing-selector-\(selector)")
        XCTFail("Phone renderer did not show \(selector)"); throw APIError.invalidResponse
    }
    func capture(_ name: String, includingPresentation: Bool = false) async throws {
        try await Task.sleep(nanoseconds: 550_000_000)
        controller.view.layoutIfNeeded()
        if includingPresentation { XCTAssertNotNil(controller.presentedViewController, "Completion should open its result sheet") }
        let target: UIView = includingPresentation ? window : controller.view
        let renderer = UIGraphicsImageRenderer(bounds: target.bounds)
        let image = renderer.image { _ in target.drawHierarchy(in: target.bounds, afterScreenUpdates: true) }
        let attachment = XCTAttachment(image: image)
        attachment.name = "iphone-\(name)"; attachment.lifetime = .keepAlways
        XCTContext.runActivity(named: name) { $0.add(attachment) }
    }
}

private func diagnosticHistoryFixture(ids: [String], chapter: String, total: Int, offset: Int) throws -> Data {
    let items: [[String: Any]] = ids.map { id in
        ["attempt_id": id, "scope_type": "chapter", "scope_id": chapter, "scope_name": chapter,
         "diagnostic_type": "scope", "created_at": "2026-10-14T00:00:00Z", "submitted_at": "2026-10-14T00:01:00Z",
         "correct_count": 9, "total_count": 10, "weak_count": 1, "linked_report_available": false]
    }
    return try JSONSerialization.data(withJSONObject: ["items": items, "total": total, "limit": 10, "offset": offset])
}

private final class PhoneAuditController: UIHostingController<AnyView> {
    let landscape: Bool
    init(rootView: AnyView, landscape: Bool) { self.landscape = landscape; super.init(rootView: rootView) }
    @MainActor required dynamic init?(coder aDecoder: NSCoder) { fatalError("init(coder:) is not used") }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { landscape ? .landscapeRight : .portrait }
}

extension APIModelsTests {
    func testServerReasonIsShownInsteadOfAGenericRetryMessage() {
        let unreadable = "AI 未能识别图片中的作答，本次不计入学习记录。请重新拍照（光线充足、只拍本题），或改用文字作答。"
        XCTAssertEqual(APIError.http(statusCode: 422, detail: unreadable).errorDescription, unreadable)
        XCTAssertEqual(APIError.http(statusCode: 504, detail: "AI 处理超时，请稍后重试。").errorDescription,
                       "AI 处理超时，请稍后重试。")
        // Internal English details and missing details keep the generic text.
        XCTAssertEqual(APIError.http(statusCode: 404, detail: "Question q1 not found").errorDescription,
                       "请求失败（404），请稍后重试。")
        XCTAssertEqual(APIError.http(statusCode: 500, detail: nil).errorDescription, "云端服务暂时不可用，请稍后重试。")
        XCTAssertEqual(APIError.http(statusCode: 401, detail: "账号已注销").errorDescription,
                       "用户名或密码不正确，或者登录已失效。")
    }

    @MainActor
    func testAssessmentGradingFailureNamesTheQuestionAndKeepsTheReason() {
        XCTAssertEqual(
            PracticeStore.assessmentGradingFailureMessage(
                completed: 2, total: 3, questionNumber: 3, reason: "AI 未能识别图片中的作答，请重新拍照。"
            ),
            "已完成批改 2/3。第 3 题：AI 未能识别图片中的作答，请重新拍照。"
        )
        XCTAssertEqual(
            PracticeStore.assessmentGradingFailureMessage(completed: 0, total: 2, questionNumber: nil, reason: "连接超时"),
            "已完成批改 0/2。连接超时"
        )
    }

    @MainActor
    func testReopenedTeacherPaperResumesAtTheFirstUngradedQuestion() throws {
        let questions = try JSONDecoder.openPhysics.decode(PracticeSession.self, from: gaokaoPracticeSessionJSON(questionCount: 4)).questions
        // Three graded, the last failed: reopening lands on the one still to retake.
        XCTAssertEqual(PracticeStore.teacherPaperResumeIndex(questions: questions, graded: ["gaokao-q1", "gaokao-q2", "gaokao-q3"]), 3)
        XCTAssertEqual(PracticeStore.teacherPaperResumeIndex(questions: questions, graded: ["gaokao-q1", "gaokao-q3"]), 1)
        XCTAssertEqual(PracticeStore.teacherPaperResumeIndex(questions: questions, graded: []), 0)
        XCTAssertEqual(PracticeStore.teacherPaperResumeIndex(questions: questions, graded: Set(questions.map(\.id))), 0)
    }

    func testHomeShowsOnlyTheNewestHomeworkAndFoldsOtherUnfinishedOnes() {
        func homework(_ id: String, _ status: String) -> TeacherHomework {
            TeacherHomework(attemptId: id, assignmentId: "a_\(id)", title: "作业 \(id)", className: "高三7班",
                            questionCount: 4, gradedCount: 0, status: status, publishedAt: nil)
        }
        // Newest first from the server; older finished results are reopened from 作业记录.
        let finished = HomeTeacherHomework([homework("3", "completed"), homework("2", "completed"), homework("1", "completed")])
        XCTAssertEqual(finished.rows(expanded: true).map(\.attemptId), ["3"])
        XCTAssertNil(finished.moreLabel(expanded: false))

        let mixed = HomeTeacherHomework([homework("4", "completed"), homework("3", "in_progress"),
                                         homework("2", "grading"), homework("1", "completed")])
        XCTAssertEqual(mixed.rows(expanded: false).map(\.attemptId), ["3"])
        XCTAssertEqual(mixed.moreLabel(expanded: false), "还有 1 份作业待完成")
        XCTAssertEqual(mixed.rows(expanded: true).map(\.attemptId), ["3", "2"])
        XCTAssertEqual(mixed.moreLabel(expanded: true), "收起")
        XCTAssertTrue(HomeTeacherHomework([]).rows(expanded: false).isEmpty)
    }

    func testFinishedHomeworkShowsItsScoreOutOf100AndWhetherTheTeacherReviewedIt() throws {
        let json = """
        [{"attempt_id": "1", "assignment_id": "a_1", "title": "作业 1", "class_name": "高三7班", "question_count": 4,
          "graded_count": 4, "status": "completed", "published_at": "2026-10-30T08:00:00+00:00", "delivery": "app",
          "score": 40.5, "max_score": 48, "score_percent": 84, "results_released": true},
         {"attempt_id": "2", "assignment_id": "a_2", "title": "作业 2", "class_name": "高三7班", "question_count": 4,
          "graded_count": 4, "status": "completed", "published_at": null, "delivery": "app",
          "score": 24, "max_score": 48, "score_percent": 50, "results_released": false},
         {"attempt_id": "3", "assignment_id": "a_3", "title": "作业 3", "class_name": "高三7班", "question_count": 4,
          "graded_count": 1, "status": "grading", "published_at": null}]
        """
        let items = try JSONDecoder.openPhysics.decode([TeacherHomework].self, from: Data(json.utf8))
        XCTAssertEqual(items[0].detail, "高三7班 · 4 题 · 84 分")
        XCTAssertEqual(homeworkRecordStatus(items[0]).status, "84 分")
        XCTAssertEqual(homeworkRecordStatus(items[0]).note, "老师已审核")
        XCTAssertEqual(homeworkRecordStatus(items[1]).note, "AI 批改，老师审核后可能调整")
        XCTAssertEqual(homeworkRecordStatus(items[2]).status, "批改中")
        XCTAssertEqual(homeworkRecordMeta(items[0]), "高三7班 · 4 题 · 布置于 2026-10-30")
        XCTAssertEqual(homeworkAverage(items), 67)
        // Older servers send no score: the row keeps its plain status.
        let plain = TeacherHomework(attemptId: "4", assignmentId: "a_4", title: "作业 4", className: "高三7班",
                                    questionCount: 4, gradedCount: 4, status: "completed", publishedAt: nil)
        XCTAssertEqual(plain.detail, "高三7班 · 4 题 · 已完成")
        XCTAssertNil(homeworkAverage([plain]))

        let paper = try JSONDecoder.openPhysics.decode(TeacherPaper.self, from: Data("""
        {"id": "homework:a_1", "title": "作业 1", "question_count": 4, "has_video": false, "attempt_id": "1",
         "status": "completed", "score_percent": 84, "results_released": true}
        """.utf8))
        XCTAssertEqual(paper.homeworkScore, HomeworkScore(percent: 84, released: true))
    }

    func testAIGradingRequestsOutwaitTheServerAndGateway() async throws {
        // Server: up to 15 s queue + 90 s AI; nginx closes at 120 s.
        XCTAssertGreaterThan(APIClient.aiRequestTimeout, 120)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let api = APIClient(authorizeAI: { _, _, _ in }, baseURL: URL(string: "https://example.test/api/student")!,
                            session: URLSession(configuration: configuration))
        var timeouts: [String: TimeInterval] = [:]
        MockURLProtocol.handler = { request in
            timeouts[request.url?.path ?? ""] = request.timeoutInterval
            return (422, Data(#"{"detail":"本题暂缺标准答案，系统不判对错，本次不计入学习记录。"}"#.utf8))
        }
        defer { MockURLProtocol.handler = nil }
        let student = makeTestStudentSession()
        for requiresAI in [true, false] {
            do {
                _ = try await api.submitAnswer(for: student, questionId: "q", answer: "1", timeSpentMs: 0,
                                               submissionId: "s-\(requiresAI)", requiresAI: requiresAI)
                XCTFail("expected the 422")
            } catch {
                XCTAssertEqual((error as? LocalizedError)?.errorDescription,
                               "本题暂缺标准答案，系统不判对错，本次不计入学习记录。")
            }
            XCTAssertEqual(timeouts["/api/student/practice/submit"], requiresAI ? APIClient.aiRequestTimeout : 30)
        }
    }
}

extension APIModelsTests {
    @MainActor
    func testLearningCompletionRefreshesHomeCountersAndNotebookAutomatically() async throws {
        var answers = 3
        var reviewReads = 0
        var growthReads = 0
        MockURLProtocol.handler = { request in
            let path = request.url!.path
            if path.hasSuffix("/reward/daily-loop") { return (200, try liveLoopFixture(answers)) }
            if path.hasSuffix("/reward/growth-report") {
                XCTAssertEqual(request.httpMethod, "GET")
                XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalCacheData)
                XCTAssertTrue(request.url!.query!.contains("refresh=true"))
                growthReads += 1
                return (200, liveGrowthFixture(answers))
            }
            if path.hasSuffix("/review") {
                reviewReads += 1
                return (200, answers == 3 ? Data(#"{"groups":[],"clearance_progress":{"reviewed":0,"total":0}}"#.utf8) : phoneReviewJSON())
            }
            return try phoneFixtureResponse(request)
        }
        defer { MockURLProtocol.handler = nil }
        let student = makeTestStudentSession()
        let app = AppSession(apiClient: parityClient(), sessionStore: PermissionTestSessionStore(session: nil))
        defer { app.logout() }
        try await app.acceptAuthentication(student)
        let review = ReviewStore(apiClient: parityClient())
        await review.load(student: student)
        XCTAssertEqual(app.dailyLearningLoop?.rings.practice.actualCurrent, 3)
        XCTAssertEqual(app.growthReport?.metrics?.totalAnswers, 3)
        XCTAssertTrue(review.data?.allMistakes.isEmpty == true)
        answers = 16
        NotificationCenter.default.post(name: .studentLearningProgressChanged, object: student.token)
        for _ in 0..<100 {
            if app.growthReport?.metrics?.totalAnswers == 16, review.data?.allMistakes.isEmpty == false { break }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        XCTAssertEqual(app.dailyLearningLoop?.rings.practice.actualCurrent, 16)
        XCTAssertEqual(app.growthReport?.metrics?.totalAnswers, 16)
        XCTAssertFalse(review.data?.allMistakes.isEmpty ?? true)
        let reads = (growthReads, reviewReads)
        NotificationCenter.default.post(name: .studentLearningProgressChanged, object: "another-account")
        try await Task.sleep(nanoseconds: 80_000_000)
        XCTAssertEqual(growthReads, reads.0)
        XCTAssertEqual(reviewReads, reads.1)
    }

    @MainActor
    func testHomeRefreshDoesNotPublishAnOlderInFlightSnapshot() async throws {
        let started = expectation(description: "old dashboard request started")
        let gate = DispatchSemaphore(value: 0)
        var reads = 0
        var shouldBlock = false
        var observedMastery: [Double] = []
        MockURLProtocol.handler = { request in
            if request.url!.path.hasSuffix("/dashboard") {
                reads += 1
                let count = reads
                if shouldBlock, count == 2 { started.fulfill(); _ = gate.wait(timeout: .now() + 4) }
                var json = try JSONSerialization.jsonObject(with: phoneDashboardJSON()) as! [String: Any]
                var diagnosis = json["diagnosis"] as! [String: Any]
                diagnosis["overall_mastery"] = Double(count) / 10
                json["diagnosis"] = diagnosis
                return (200, try JSONSerialization.data(withJSONObject: json))
            }
            if request.url!.path.hasSuffix("/growth-report") { return (200, liveGrowthFixture(16)) }
            return (200, try liveLoopFixture(16))
        }
        defer { gate.signal(); MockURLProtocol.handler = nil }
        let app = AppSession(apiClient: parityClient(), sessionStore: PermissionTestSessionStore(session: nil))
        defer { app.logout() }
        try await app.acceptAuthentication(makeTestStudentSession())
        let subscription = app.$dashboard.sink { if let value = $0 { observedMastery.append(value.diagnosis.overallMastery) } }
        defer { subscription.cancel() }
        shouldBlock = true
        let first = Task { await app.refreshDashboard() }
        await fulfillment(of: [started], timeout: 3)
        let second = Task { await app.refreshDashboard() }
        await Task.yield()
        gate.signal()
        await first.value
        await second.value
        XCTAssertEqual(app.dashboard?.diagnosis.overallMastery, 0.3)
        XCTAssertFalse(observedMastery.contains(0.2), "The older response must never replace current learning state")
        XCTAssertFalse(app.isWorking)
    }

    @MainActor
    func testNotebookRefreshDuringLoadRechecksBeforePublishing() async throws {
        let started = expectation(description: "old notebook started")
        let gate = DispatchSemaphore(value: 0)
        var calls = 0
        MockURLProtocol.handler = { _ in
            calls += 1
            if calls == 1 {
                started.fulfill(); _ = gate.wait(timeout: .now() + 4)
                return (200, Data(#"{"groups":[],"clearance_progress":{"reviewed":0,"total":0}}"#.utf8))
            }
            return (200, phoneReviewJSON())
        }
        defer { gate.signal(); MockURLProtocol.handler = nil }
        let store = ReviewStore(apiClient: parityClient())
        let first = Task { await store.load(student: makeTestStudentSession()) }
        await fulfillment(of: [started], timeout: 3)
        let second = Task { await store.load(student: makeTestStudentSession(), force: true) }
        await Task.yield()
        gate.signal()
        await first.value; await second.value
        XCTAssertEqual(calls, 2)
        XCTAssertFalse(store.data?.allMistakes.isEmpty ?? true)
        XCTAssertFalse(store.isLoading)
    }

    @MainActor
    func testTutorReplyRendersFormulaAndResizesAsContentArrives() async throws {
        let fixture = TutorRenderFixture()
        let host = PhoneRenderHost(TutorRenderFixtureView(fixture: fixture))
        defer { host.close() }
        let web = try await host.webView(matching: ".katex", count: 1)
        let before = web.bounds.height
        fixture.content = #"先回忆公式：$x=v_0t+\frac{1}{2}at^2$。题目给出 $x=4t-2t^2$，所以 $\frac{1}{2}a=-2$。"# + String(repeating: "\n请对照各项系数，检查加速度的大小与方向。", count: 6)
        _ = try await host.webView(matching: ".katex", count: 3)
        // The bubble resizes after the Pane reports its new height; give it time on a busy simulator.
        for _ in 0..<30 where web.bounds.height <= before {
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTAssertGreaterThan(web.bounds.height, before)
        let errors = try await web.evaluateJavaScript("document.querySelectorAll('.katex-error').length") as? Int
        XCTAssertEqual(errors, 0)
        let heading = try await web.evaluateJavaScript("getComputedStyle(document.querySelector('.op-pane-knowledge-section > h2')).display") as? String
        XCTAssertEqual(heading, "none")
        try await host.capture("tutor-formulas-fixed")
    }
}

private func liveGrowthFixture(_ answers: Int) -> Data {
    Data(#"{"report":{"id":"current-week","summary":"本周完成 \#(answers) 道题","start_date":"2026-10-09","end_date":"2026-10-16","metrics":{"total_answers":\#(answers)}}}"#.utf8)
}

private func liveLoopFixture(_ answers: Int) throws -> Data {
    let practice: [String: Any] = ["key":"practice", "label":"做题", "completed":answers >= 5, "current":min(5,answers), "actual_current":answers, "target":5, "overflow":max(0,answers-5), "auto_completed":false, "evidence":"已作答"]
    let review: [String: Any] = ["key":"review", "label":"复盘", "completed":false, "current":0, "actual_current":0, "target":3, "overflow":0, "auto_completed":false, "evidence":"待复盘"]
    return try JSONSerialization.data(withJSONObject: ["date":"2026-10-16", "is_effective_day":true, "is_high_quality_day":false, "rings":["practice":practice,"review":review], "summary":"学习中", "next_action":"继续学习", "streak_days":1])
}

@MainActor private final class TutorRenderFixture: ObservableObject {
    @Published var content = #"公式：$x=v_0t+\frac{1}{2}at^2$。"#
}
private struct TutorRenderFixtureView: View {
    @ObservedObject var fixture: TutorRenderFixture
    var body: some View {
        ScrollView { TutorMessageBubble(message: LearningChatMessage(role: "assistant", content: fixture.content)).padding(20) }
            .background(OpenPhysicsTheme.pageBackground)
    }
}

final class AIGradingWaitTests: XCTestCase {
    @MainActor
    func testFailedAIGradingOffersARetryAndASuccessClearsIt() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let draftRoot = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: draftRoot) }
        let store = PracticeStore(
            apiClient: APIClient(authorizeAI: { _, _, _ in },
                baseURL: URL(string: "https://example.test/api/student")!,
                session: URLSession(configuration: configuration)),
            draftFileStore: AnswerDraftFileStore(rootURL: draftRoot)
        )
        let student = makeTestStudentSession()
        var failNext = true
        MockURLProtocol.handler = { request in
            let path = try XCTUnwrap(request.url?.path)
            if path.hasSuffix("/practice/session") {
                return (200, Data("""
                    {"student_id": "student-1", "session_type": "practice", "strategy": "weak_kp",
                     "session_objective": "测试练习",
                     "questions": [{"id": "q-text", "stem_text": "求加速度", "question_type": "problem_solving",
                                    "options": [], "images": []}]}
                    """.utf8))
            }
            if path.hasSuffix("/practice/submit") {
                if failNext {
                    failNext = false
                    return (504, Data(#"{"detail":"AI 处理超时，请稍后重试"}"#.utf8))
                }
                return (200, Data("""
                    {"answer_id": 31, "is_correct": true, "correct_answer": "2m/s²",
                     "mastery_update": {}, "idempotent_replay": false}
                    """.utf8))
            }
            XCTFail("Unexpected path: \(path)")
            return (404, Data())
        }
        defer { MockURLProtocol.handler = nil }

        let started = await store.start(student: student, kpId: "kp-1", count: 1)
        XCTAssertTrue(started)
        store.setAnswerMode(.text, for: "q-text")
        store.setAnswer("2m/s²", for: "q-text")
        await store.submit(student: student)
        XCTAssertEqual(store.aiGradingFailure, .answer)
        XCTAssertNil(store.aiGradingStartedAt)
        XCTAssertTrue(store.message.contains("AI 处理超时"))

        await store.submit(student: student)
        XCTAssertNil(store.aiGradingFailure)
        XCTAssertEqual(store.currentResult?.answerId, 31)
    }
}

final class DraftImagePlacementTests: XCTestCase {
    func testPlacementScalesAroundTheDefaultSpotAndStaysReachable() {
        let source = CGSize(width: 400, height: 300), canvas = CGSize(width: 1000, height: 800)
        let base = QuestionDrawingBackgroundLayout.rect(sourceSize: source, canvasSize: canvas)
        let zoomed = QuestionDrawingBackgroundLayout.rect(
            sourceSize: source, canvasSize: canvas, placement: .init(offset: .zero, zoom: 2))
        XCTAssertEqual(zoomed.width, base.width * 2, accuracy: 0.01)
        XCTAssertEqual(zoomed.midX, base.midX, accuracy: 0.01)
        XCTAssertEqual(zoomed.midY, base.midY, accuracy: 0.01)
        let moved = QuestionDrawingBackgroundLayout.rect(
            sourceSize: source, canvasSize: canvas, placement: .init(offset: CGSize(width: 0.1, height: 0.05), zoom: 1))
        XCTAssertEqual(moved.minX - base.minX, 100, accuracy: 0.01)
        XCTAssertEqual(moved.minY - base.minY, 40, accuracy: 0.01)
        let flung = QuestionDrawingBackgroundLayout.rect(
            sourceSize: source, canvasSize: canvas, placement: .init(offset: CGSize(width: 5, height: -5), zoom: 1))
        XCTAssertEqual(flung.minX, canvas.width - 48, accuracy: 0.01)
        XCTAssertEqual(flung.maxY, 48, accuracy: 0.01)
        XCTAssertEqual(QuestionDrawingBackgroundPlacement.clampedZoom(10), 4)
        XCTAssertEqual(QuestionDrawingBackgroundPlacement.clampedZoom(0.1), 0.5)
    }

    func testSubmittedHandwritingFollowsTheMovedImage() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = AnswerDraftFileStore(rootURL: root)
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let figure = UIGraphicsImageRenderer(size: CGSize(width: 400, height: 300), format: format).image { context in
            UIColor.red.setFill(); context.fill(CGRect(x: 0, y: 0, width: 400, height: 300))
        }
        let point = PKStrokePoint(location: CGPoint(x: 600, y: 600), timeOffset: 0, size: CGSize(width: 6, height: 6),
                                  opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        let drawing = PKDrawing(strokes: [PKStroke(ink: PKInk(.pen, color: .black),
                                                   path: PKStrokePath(controlPoints: [point], creationDate: Date()))])
        func export(_ placement: QuestionDrawingBackgroundPlacement) throws -> Data {
            let draft = try store.exportDrawing(drawing, backgroundImage: figure, canvasSize: CGSize(width: 1000, height: 800),
                                                backgroundPlacement: placement, studentId: "s", questionId: "q")
            return try Data(contentsOf: draft.fileURL)
        }
        let original = try export(.init())
        let moved = try export(.init(offset: CGSize(width: 0.3, height: 0.2), zoom: 1.5))
        XCTAssertNotEqual(original, moved)
    }
}

final class AnswerPhotoEditingTests: XCTestCase {
    private func photo(width: Int, height: Int) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: CGSize(width: width, height: height), format: format).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        }
    }

    func testSavedPhotoIsAtMost1800PixelsWhateverTheScreenScale() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let large = UIGraphicsImageRenderer(size: CGSize(width: 4032, height: 3024), format: format).image { context in
            for row in 0..<24 {
                UIColor(white: CGFloat(row % 7) / 7, alpha: 1).setFill()
                context.fill(CGRect(x: 0, y: row * 126, width: 4032, height: 126))
            }
        }
        let data = try XCTUnwrap(large.jpegData(compressionQuality: 0.95))
        let draft = try AnswerDraftFileStore(rootURL: root).savePhoto(data: data, studentId: "s", questionId: "q")
        let saved = try XCTUnwrap(UIImage(contentsOfFile: draft.fileURL.path)?.cgImage)
        XCTAssertEqual(max(saved.width, saved.height), 1800)
        XCTAssertLessThanOrEqual(try Data(contentsOf: draft.fileURL).count, AnswerDraftFileStore.answerImageTargetBytes)
    }

    @MainActor
    func testLargePickedPhotoIsCompactedForEditing() throws {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let large = UIGraphicsImageRenderer(size: CGSize(width: 4032, height: 3024), format: format).image { context in
            UIColor.white.setFill(); context.fill(CGRect(x: 0, y: 0, width: 4032, height: 3024))
        }
        let selection = AnswerPhotoSelection()
        selection.preview(try XCTUnwrap(large.jpegData(compressionQuality: 0.9)))
        XCTAssertEqual(selection.image?.cgImage?.width, 2560)
        XCTAssertFalse(selection.isEdited)
    }

    func testQuarterTurnSwapsWidthAndHeight() {
        let rotated = AnswerPhotoEditor.rotated(photo(width: 400, height: 300), clockwise: true)
        XCTAssertEqual(rotated.cgImage?.width, 300)
        XCTAssertEqual(rotated.cgImage?.height, 400)
        XCTAssertEqual(rotated.imageOrientation, .up)
    }

    func testCropKeepsTheSelectedAnswerArea() throws {
        let cropped = try XCTUnwrap(AnswerPhotoEditor.cropped(
            photo(width: 1000, height: 800), to: CGRect(x: 0.1, y: 0.25, width: 0.5, height: 0.5)
        ))
        XCTAssertEqual(cropped.cgImage?.width, 500)
        XCTAssertEqual(cropped.cgImage?.height, 400)
        XCTAssertNil(AnswerPhotoEditor.cropped(photo(width: 10, height: 10), to: CGRect(x: 2, y: 2, width: 1, height: 1)))
    }

    func testCropBoxStaysInsideThePhotoAndAboveTheMinimumSize() {
        let start = CGRect(x: 0.2, y: 0.2, width: 0.6, height: 0.6)
        let pastEdge = AnswerPhotoCropView.resized(start, movingLeft: true, movingTop: true, dx: -1, dy: -1)
        XCTAssertEqual(pastEdge.minX, 0, accuracy: 0.0001)
        XCTAssertEqual(pastEdge.minY, 0, accuracy: 0.0001)
        let collapsed = AnswerPhotoCropView.resized(start, movingLeft: false, movingTop: false, dx: -1, dy: -1)
        XCTAssertEqual(collapsed.width, AnswerPhotoCropView.minimumSide, accuracy: 0.0001)
        XCTAssertEqual(collapsed.height, AnswerPhotoCropView.minimumSide, accuracy: 0.0001)
    }

    func testEveryEdgeAndCornerOfTheCropBoxCanBeGrabbed() {
        typealias Crop = AnswerPhotoCropView
        let box = CGRect(x: 100, y: 100, width: 200, height: 300)
        XCTAssertEqual(Crop.handle(at: CGPoint(x: 100, y: 250), box: box), Crop.Handle(left: true))
        XCTAssertEqual(Crop.handle(at: CGPoint(x: 300, y: 250), box: box), Crop.Handle(right: true))
        XCTAssertEqual(Crop.handle(at: CGPoint(x: 200, y: 100), box: box), Crop.Handle(top: true))
        XCTAssertEqual(Crop.handle(at: CGPoint(x: 200, y: 400), box: box), Crop.Handle(bottom: true))
        XCTAssertEqual(Crop.handle(at: CGPoint(x: 95, y: 405), box: box), Crop.Handle(left: true, bottom: true))
        XCTAssertEqual(Crop.handle(at: CGPoint(x: 305, y: 95), box: box), Crop.Handle(top: true, right: true))
        XCTAssertEqual(Crop.handle(at: CGPoint(x: 200, y: 250), box: box), .move)
        XCTAssertNil(Crop.handle(at: CGPoint(x: 10, y: 10), box: box))

        let start = CGRect(x: 0.2, y: 0.2, width: 0.6, height: 0.6)
        let leftOnly = Crop.adjusted(start, handle: Crop.Handle(left: true), dx: -0.1, dy: 0.3)
        XCTAssertEqual(leftOnly.minX, 0.1, accuracy: 0.0001)
        XCTAssertEqual(leftOnly.maxX, 0.8, accuracy: 0.0001)
        XCTAssertEqual(leftOnly.minY, 0.2, accuracy: 0.0001)
        let bottomOnly = Crop.adjusted(start, handle: Crop.Handle(bottom: true), dx: 0.3, dy: 0.5)
        XCTAssertEqual(bottomOnly.maxY, 1, accuracy: 0.0001)
        XCTAssertEqual(bottomOnly.width, 0.6, accuracy: 0.0001)
    }

    @MainActor
    func testEditsStayOnTheCandidateUntilReverted() throws {
        let selection = AnswerPhotoSelection()
        let original = try XCTUnwrap(photo(width: 400, height: 300).jpegData(compressionQuality: 0.9))
        selection.preview(original)
        selection.rotate(clockwise: false)
        XCTAssertTrue(selection.isEdited)
        XCTAssertEqual(selection.image?.cgImage?.width, 300)
        selection.revert()
        XCTAssertFalse(selection.isEdited)
        XCTAssertEqual(selection.data, original)
    }
}
