import Foundation

struct APIClient {
    /// AI grading may queue up to 15 s and run up to 90 s on the server, and
    /// nginx closes the request at 120 s. Waiting longer than both means the
    /// student gets the server's own answer (or its reason) instead of a
    /// client-side timeout that a retry would only repeat.
    static let aiRequestTimeout: TimeInterval = 125

    let baseURL: URL
    var session: URLSession = .shared
    var authorizeAI: (APIClient, String, String) async throws -> Void

    init(authorizeAI: @escaping (APIClient, String, String) async throws -> Void = { api, token, path in
        try await PrivacyConsentCenter.shared.authorize(api: api, token: token, path: path)
    }, baseURL: URL = AppConfig.apiBaseURL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
        self.authorizeAI = authorizeAI
    }

    func login(username: String, password: String) async throws -> StudentSession {
        let body = LoginRequest(username: username, password: password)
        let response: StudentLoginResponse = try await request(
            path: "auth/login",
            method: "POST",
            body: body,
            token: nil
        )
        return response.session
    }

    func currentStudent(for studentSession: StudentSession) async throws -> StudentSession {
        let student: StudentPublic = try await request(
            path: "auth/me",
            token: studentSession.token
        )
        return student.session(token: studentSession.token)
    }

    func dashboard(for studentSession: StudentSession) async throws -> DashboardData {
        try await request(
            path: "dashboard",
            queryItems: [URLQueryItem(name: "student_id", value: studentSession.studentID)],
            token: studentSession.token
        )
    }

    func dailyLearningLoop(
        for studentSession: StudentSession
    ) async throws -> DailyLearningLoop {
        try await request(
            path: "reward/daily-loop",
            queryItems: [
                URLQueryItem(name: "student_id", value: studentSession.studentID)],
            token: studentSession.token
        )
    }

    func dailyLearningLoopHistory(
        for studentSession: StudentSession,
        days: Int = 35
    ) async throws -> DailyLearningLoopHistory {
        try await request(
            path: "reward/daily-loop/history",
            queryItems: [
                URLQueryItem(name: "student_id", value: studentSession.studentID),
                URLQueryItem(
                    name: "days",
                    value: String(min(max(days, 1), 62))
                )],
            token: studentSession.token
        )
    }

    func growthReport(
        for studentSession: StudentSession
    ) async throws -> GrowthReportData? {
        let response: GrowthReportResponse = try await request(
            path: "reward/growth-report",
            queryItems: [
                URLQueryItem(name: "student_id", value: studentSession.studentID),
                URLQueryItem(name: "refresh", value: "true")],
            token: studentSession.token
        )
        return response.report
    }

    func generateGrowthReport(
        for studentSession: StudentSession
    ) async throws -> GrowthReportData? {
        let response: GrowthReportResponse = try await request(
            path: "reward/growth-report",
            method: "POST",
            queryItems: [
                URLQueryItem(name: "student_id", value: studentSession.studentID)],
            body: EmptyRequest(),
            token: studentSession.token
        )
        return response.report
    }

    func answerHistory(
        for studentSession: StudentSession,
        limit: Int = 50,
        offset: Int = 0,
        fromDate: String? = nil,
        toDate: String? = nil
    ) async throws -> [AnswerHistoryRecord] {
        var queryItems = [
            URLQueryItem(name: "student_id", value: studentSession.studentID),
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "offset", value: String(offset)),
            URLQueryItem(name: "include_rendered", value: "1")]
        if let fromDate, !fromDate.isEmpty {
            queryItems.append(URLQueryItem(name: "from_date", value: fromDate))
        }
        if let toDate, !toDate.isEmpty {
            queryItems.append(URLQueryItem(name: "to_date", value: toDate))
        }
        return try await request(
            path: "history/answers",
            queryItems: queryItems,
            token: studentSession.token
        )
    }

    func directory(for studentSession: StudentSession, includePending: Bool = true) async throws -> SyncDirectory {
        try await request(
            path: "directory?include_pending=\(includePending)",
            token: studentSession.token
        )
    }

    func learningCatalog(
        for studentSession: StudentSession,
        catalogCode: String
    ) async throws -> LearningCatalogData {
        try await request(
            path: "learning-catalogs/\(catalogCode)",
            token: studentSession.token
        )
    }

    func learningCatalogResume(for student: StudentSession, catalogCode: String) async throws -> LearningCatalogResume {
        try await request(path: "learning-catalogs/\(catalogCode)/resume", token: student.token)
    }

    func learningCatalogTopicOverview(
        for studentSession: StudentSession,
        catalogCode: String,
        nodeId: String
    ) async throws -> LearningCatalogTopicOverview {
        try await request(
            path: "learning-catalogs/\(catalogCode)/nodes/\(nodeId)/overview",
            token: studentSession.token
        )
    }

    func learningCatalogTopicSession(
        for studentSession: StudentSession,
        catalogCode: String,
        nodeId: String,
        layer: LearningCatalogTopicLayer,
        questionCount: Int
    ) async throws -> PracticeSession {
        try await request(
            path: "learning-catalogs/\(catalogCode)/nodes/\(nodeId)/session",
            method: "POST",
            queryItems: [URLQueryItem(name: "include_rendered", value: "1")],
            body: LearningCatalogTopicSessionRequest(
                layer: layer,
                questionCount: max(1, min(questionCount, 10))
            ),
            token: studentSession.token
        )
    }

    /// The home card's list; `history` keeps every finished homework instead of the last week's.
    func teacherHomework(for student: StudentSession, history: Bool = false) async throws -> [TeacherHomework] {
        try await request(path: "teacher-homework",
                          queryItems: history ? [URLQueryItem(name: "history", value: "true")] : [],
                          token: student.token)
    }

    func teacherHomeworkSession(for student: StudentSession, attemptId: String) async throws -> PracticeSession {
        try await request(
            path: "teacher-homework/\(attemptId)/session",
            method: "POST",
            queryItems: [URLQueryItem(name: "include_rendered", value: "1")],
            body: EmptyRequest(),
            token: student.token
        )
    }

    func submitTeacherPaper(for student: StudentSession, attemptId: String) async throws -> TeacherPaper {
        try await request(path: "teacher-paper-attempts/\(attemptId)/submit", method: "POST",
                          body: EmptyRequest(), token: student.token)
    }

    func lessonVideo(for student: StudentSession, questionId: String, answerId: Int) async throws -> LessonVideoPlayback {
        try await request(path: "questions/\(questionId)/lesson-video", method: "POST",
                          body: LessonVideoRequest(answerId: answerId), token: student.token)
    }

    func recordLearningCatalogTopicEvidence(
        for studentSession: StudentSession,
        catalogCode: String,
        nodeId: String,
        layer: LearningCatalogTopicLayer,
        answerId: Int
    ) async throws -> LearningCatalogTopicOverview {
        try await request(
            path: "learning-catalogs/\(catalogCode)/nodes/\(nodeId)/evidence",
            method: "POST",
            body: LearningCatalogTopicEvidenceRequest(
                layer: layer,
                answerId: answerId
            ),
            token: studentSession.token
        )
    }

    func reinforcementStart(
        for studentSession: StudentSession
    ) async throws -> ReinforcementStartData {
        try await request(
            path: "train/start",
            queryItems: [
                URLQueryItem(
                    name: "student_id",
                    value: studentSession.studentID
                )],
            token: studentSession.token
        )
    }

    func scopeDiagnosticAttempts(
        for studentSession: StudentSession,
        scopeType: String? = nil,
        scopeId: String? = nil,
        limit: Int = 20,
        offset: Int = 0
    ) async throws -> ScopeDiagnosticAttemptListResponse {
        var queryItems = [
            URLQueryItem(name: "student_id", value: studentSession.studentID),
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "offset", value: String(offset))]
        if let scopeType {
            queryItems.append(URLQueryItem(name: "scope_type", value: scopeType))
        }
        if let scopeId {
            queryItems.append(URLQueryItem(name: "scope_id", value: scopeId))
        }
        return try await request(
            path: "diagnostics/scope/attempts",
            queryItems: queryItems,
            token: studentSession.token
        )
    }

    func scopeDiagnosticAttempt(
        for studentSession: StudentSession,
        attemptId: String
    ) async throws -> ScopeDiagnosticAttemptDetail {
        try await request(
            path: "diagnostics/scope/attempts/\(attemptId)",
            queryItems: [
                URLQueryItem(name: "student_id", value: studentSession.studentID)],
            token: studentSession.token
        )
    }

    func reviewNotebook(
        for studentSession: StudentSession
    ) async throws -> ReviewData {
        try await request(
            path: "review",
            queryItems: [
                URLQueryItem(name: "student_id", value: studentSession.studentID),
                URLQueryItem(name: "group_by", value: "kp"),
                URLQueryItem(name: "summary_only", value: "1"),
                URLQueryItem(name: "include_rendered", value: "1")],
            token: studentSession.token
        )
    }

    func reviewMistake(
        for studentSession: StudentSession,
        answerId: Int
    ) async throws -> ReviewMistake {
        try await request(
            path: "review/\(answerId)",
            queryItems: [
                URLQueryItem(name: "student_id", value: studentSession.studentID),
                URLQueryItem(name: "include_rendered", value: "1")],
            token: studentSession.token
        )
    }

    func reviewVariations(
        for studentSession: StudentSession,
        answerId: Int,
        excludingQuestionIds: [String] = []
    ) async throws -> ReviewVariationData {
        try await request(
            path: "review/variations/\(answerId)",
            queryItems: [
                URLQueryItem(name: "student_id", value: studentSession.studentID),
                URLQueryItem(name: "include_rendered", value: "1")] + (excludingQuestionIds.isEmpty ? [] : [URLQueryItem(name: "exclude_question_ids", value: excludingQuestionIds.suffix(200).joined(separator: ","))]),
            token: studentSession.token
        )
    }

    func retryReviewQuestion(
        for studentSession: StudentSession,
        answerId: Int,
        excludingQuestionIds: [String] = []
    ) async throws -> ReviewRetryData {
        try await request(
            path: "review/retry/\(answerId)",
            method: "POST",
            queryItems: [
                URLQueryItem(name: "student_id", value: studentSession.studentID),
                URLQueryItem(name: "include_rendered", value: "1")] + (excludingQuestionIds.isEmpty ? [] : [URLQueryItem(name: "exclude_question_ids", value: excludingQuestionIds.suffix(200).joined(separator: ","))]),
            body: EmptyRequest(),
            token: studentSession.token
        )
    }

    func questionTutorChat(
        for studentSession: StudentSession,
        questionId: String,
        givenAnswer: String,
        message: String,
        history: [LearningChatMessage],
        processGrading: ReviewProcessGrading?
    ) async throws -> String {
        let response: QuestionTutorChatResponse = try await request(
            path: "tutor/question-chat",
            method: "POST",
            queryItems: [URLQueryItem(name: "include_rendered", value: "1")],
            body: QuestionTutorChatRequest(
                questionId: questionId,
                givenAnswer: givenAnswer,
                message: message,
                history: Array(history.suffix(8)),
                processGrading: processGrading
            ),
            token: studentSession.token
        )
        return response.text
    }

    func completeReview(
        for studentSession: StudentSession,
        answerId: Int,
        retryAnswerId: Int? = nil
    ) async throws -> CompleteReviewResponse {
        try await request(
            path: "review/\(answerId)/complete",
            method: "POST",
            queryItems: [
                URLQueryItem(name: "student_id", value: studentSession.studentID)],
            body: CompleteReviewRequest(retryAnswerId: retryAnswerId),
            token: studentSession.token
        )
    }

    func learnBundle(
        for studentSession: StudentSession,
        kpId: String
    ) async throws -> LearnBundle {
        try await request(
            path: "learn/\(kpId)",
            queryItems: [URLQueryItem(name: "include_rendered", value: "1")],
            token: studentSession.token
        )
    }

    func learningVideos(
        for studentSession: StudentSession,
        kpId: String
    ) async throws -> LearningVideoRecommendationResponse {
        try await request(
            path: "learn/\(kpId)/videos",
            token: studentSession.token
        )
    }

    func streamLearningChat(
        for studentSession: StudentSession,
        kpId: String,
        message: String,
        history: [LearningChatMessage],
        onContent: @escaping (String) async -> Void
    ) async throws -> String {
        try await authorizeAI(self, studentSession.token, "learn/chat")
        let url = try makeURL(path: "learn/chat", queryItems: [])
        var request = URLRequest(url: url)
        request.setValue("ios", forHTTPHeaderField: "X-OpenPhysics-Privacy-Client")
        request.httpMethod = "POST"
        request.timeoutInterval = 90
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(
            "Bearer \(studentSession.token)",
            forHTTPHeaderField: "Authorization"
        )
        request.httpBody = try JSONEncoder().encode(
            LearningChatRequest(
                kpId: kpId,
                message: message,
                history: Array(history.suffix(8))
            )
        )

        do {
            let (bytes, response) = try await session.bytes(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.invalidResponse
            }
            if httpResponse.value(forHTTPHeaderField: "X-OpenPhysics-AI-Consent-Required") == "true" {
                throw PrivacyConsentError.required
            }
            guard (200..<300).contains(httpResponse.statusCode) else {
                notifyAccountUnavailable(statusCode: httpResponse.statusCode, token: studentSession.token)
                throw APIError.http(
                    statusCode: httpResponse.statusCode,
                    detail: nil
                )
            }

            var fullResponse = ""
            for try await line in bytes.lines {
                guard line.hasPrefix("data: ") else { continue }
                let payload = String(line.dropFirst(6))
                if payload == "[DONE]" { break }
                guard
                    let data = payload.data(using: .utf8),
                    let chunk = try? JSONDecoder().decode(
                        LearningChatChunk.self,
                        from: data
                    ),
                    !chunk.content.isEmpty
                else { continue }
                fullResponse += chunk.content
                await onContent(chunk.content)
            }
            return fullResponse
        } catch let error as APIError {
            throw error
        } catch let error as URLError {
            throw APIError.transport(error)
        }
    }

    func completeLearning(
        for studentSession: StudentSession,
        kpId: String,
        contentId: String,
        timeSpentSeconds: Int
    ) async throws -> LearnCompleteResponse {
        try await request(
            path: "learn/\(kpId)/complete",
            method: "POST",
            body: LearnCompleteRequest(
                kpId: kpId,
                contentId: contentId,
                contentType: "card",
                timeSpentSeconds: max(0, timeSpentSeconds)
            ),
            token: studentSession.token
        )
    }

    func practiceSession(
        for studentSession: StudentSession,
        targetKpId: String?,
        count: Int
    ) async throws -> PracticeSession {
        var queryItems = [
            URLQueryItem(name: "student_id", value: studentSession.studentID),
            URLQueryItem(name: "count", value: String(max(1, min(count, 20)))),
            URLQueryItem(name: "include_rendered", value: "1")]
        if let targetKpId, !targetKpId.isEmpty {
            queryItems.append(
                URLQueryItem(name: "target_kp", value: targetKpId)
            )
        }
        return try await request(
            path: "practice/session",
            queryItems: queryItems,
            token: studentSession.token
        )
    }

    func diagnosticSession(
        for studentSession: StudentSession,
        targetKpId: String,
        count: Int
    ) async throws -> PracticeSession {
        try await request(
            path: "diagnose/kp/\(targetKpId)",
            method: "POST",
            queryItems: [URLQueryItem(name: "include_rendered", value: "1")],
            body: KpDiagnoseRequest(
                questionCount: max(1, min(count, 5))
            ),
            token: studentSession.token
        )
    }

    func scopeDiagnosticSession(
        for studentSession: StudentSession,
        scopeType: String,
        scopeId: String,
        questionCount: Int
    ) async throws -> PracticeSession {
        try await request(
            path: "diagnose/scope",
            method: "POST",
            queryItems: [
                URLQueryItem(name: "student_id", value: studentSession.studentID),
                URLQueryItem(name: "include_rendered", value: "1")],
            body: ScopeDiagnoseRequest(
                scopeType: scopeType,
                scopeId: scopeId,
                questionCount: max(1, min(questionCount, 20))
            ),
            token: studentSession.token
        )
    }

    func submittedDiagnosticFeedback(
        for studentSession: StudentSession,
        kpId: String,
        answers: [SubmittedDiagnosticAnswer]
    ) async throws -> KpDiagnosticResult {
        try await request(
            path: "diagnose/kp/\(kpId)/submitted-feedback",
            method: "POST",
            body: SubmittedDiagnosticFeedbackRequest(answers: answers),
            token: studentSession.token
        )
    }

    func submittedScopeDiagnosticFeedback(
        for studentSession: StudentSession,
        scopeType: String,
        scopeId: String,
        answers: [SubmittedDiagnosticAnswer]
    ) async throws -> ScopeDiagnosticResult {
        try await request(
            path: "diagnose/scope/submitted-feedback",
            method: "POST",
            queryItems: [
                URLQueryItem(name: "student_id", value: studentSession.studentID)],
            body: SubmittedScopeDiagnosticFeedbackRequest(
                scopeType: scopeType,
                scopeId: scopeId,
                answers: answers
            ),
            token: studentSession.token
        )
    }

    func createImprovementPlan(
        for studentSession: StudentSession,
        diagnosticResult: ScopeDiagnosticResult
    ) async throws -> ImprovementPlan {
        try await request(
            path: "improvement/plans/from-scope-result",
            method: "POST",
            queryItems: [
                URLQueryItem(name: "student_id", value: studentSession.studentID)],
            body: CreateImprovementPlanRequest(
                diagnosticResult: diagnosticResult
            ),
            token: studentSession.token
        )
    }

    func latestImprovementPlan(
        for studentSession: StudentSession,
        scopeType: String? = nil,
        scopeId: String? = nil
    ) async throws -> ImprovementPlan? {
        var queryItems = [
            URLQueryItem(name: "student_id", value: studentSession.studentID)]
        if let scopeType {
            queryItems.append(URLQueryItem(name: "scope_type", value: scopeType))
        }
        if let scopeId {
            queryItems.append(URLQueryItem(name: "scope_id", value: scopeId))
        }
        return try await requestOptional(
            path: "improvement/plans/latest",
            queryItems: queryItems,
            token: studentSession.token
        )
    }

    func improvementPlan(
        for studentSession: StudentSession,
        planId: String
    ) async throws -> ImprovementPlan {
        try await request(
            path: "improvement/plans/\(planId)",
            queryItems: [
                URLQueryItem(name: "student_id", value: studentSession.studentID)],
            token: studentSession.token
        )
    }

    func latestCompletedImprovementReport(
        for studentSession: StudentSession,
        scopeType: String? = nil,
        scopeId: String? = nil
    ) async throws -> ImprovementReport? {
        var queryItems = [
            URLQueryItem(name: "student_id", value: studentSession.studentID)]
        if let scopeType {
            queryItems.append(URLQueryItem(name: "scope_type", value: scopeType))
        }
        if let scopeId {
            queryItems.append(URLQueryItem(name: "scope_id", value: scopeId))
        }
        return try await requestOptional(
            path: "improvement/reports/latest-completed",
            queryItems: queryItems,
            token: studentSession.token
        )
    }

    func improvementReport(
        for studentSession: StudentSession,
        planId: String
    ) async throws -> ImprovementReport {
        try await request(
            path: "improvement/reports/\(planId)",
            queryItems: [
                URLQueryItem(name: "student_id", value: studentSession.studentID)],
            token: studentSession.token
        )
    }

    func updateImprovementTaskStatus(
        for studentSession: StudentSession,
        planId: String,
        taskId: String,
        status: String
    ) async throws -> ImprovementPlan {
        try await request(
            path: "improvement/plans/\(planId)/tasks/\(taskId)",
            method: "PATCH",
            queryItems: [
                URLQueryItem(name: "student_id", value: studentSession.studentID)],
            body: UpdateImprovementTaskRequest(status: status),
            token: studentSession.token
        )
    }

    func moveToNextImprovementTask(
        for studentSession: StudentSession,
        planId: String
    ) async throws -> ImprovementPlan {
        try await request(
            path: "improvement/plans/\(planId)/next",
            method: "POST",
            queryItems: [
                URLQueryItem(name: "student_id", value: studentSession.studentID)],
            body: MoveToNextImprovementTaskRequest(markInProgress: true),
            token: studentSession.token
        )
    }

    func startImprovementRetest(
        for studentSession: StudentSession,
        planId: String
    ) async throws -> ImprovementRetestSession {
        try await request(
            path: "improvement/plans/\(planId)/retest/start",
            method: "POST",
            queryItems: [
                URLQueryItem(name: "student_id", value: studentSession.studentID),
                URLQueryItem(name: "include_rendered", value: "1")],
            body: EmptyRequest(),
            token: studentSession.token
        )
    }

    func submitImprovementRetestFeedback(
        for studentSession: StudentSession,
        planId: String,
        attemptId: String,
        answers: [SubmittedDiagnosticAnswer]
    ) async throws -> ImprovementRetestResult {
        try await request(
            path: "improvement/plans/\(planId)/retest/\(attemptId)/submitted-feedback",
            method: "POST",
            queryItems: [
                URLQueryItem(name: "student_id", value: studentSession.studentID)],
            body: SubmittedDiagnosticFeedbackRequest(answers: answers),
            token: studentSession.token
        )
    }

    func submitAnswer(
        for studentSession: StudentSession,
        questionId: String,
        answer: String,
        timeSpentMs: Int,
        targetKnowledgePointId: String? = nil,
        submissionId: String,
        teacherPaperAttemptId: String? = nil,
        topicContext: [String: String]? = nil,
        requiresAI: Bool = true
    ) async throws -> SubmitAnswerResult {
        try await request(
            path: "practice/submit",
            method: "POST",
            queryItems: [
                URLQueryItem(name: "student_id", value: studentSession.studentID),
                URLQueryItem(name: "include_rendered", value: "1")],
            body: SubmitAnswerRequest(
                questionId: questionId,
                givenAnswer: answer,
                timeSpentMs: timeSpentMs,
                targetKnowledgePointId: targetKnowledgePointId,
                submissionId: submissionId,
                teacherPaperAttemptId: teacherPaperAttemptId,
                topicContext: topicContext
            ),
            token: studentSession.token,
            requiresAI: requiresAI
        )
    }

    func submitPhotoAnswer(
        for studentSession: StudentSession,
        questionId: String,
        media: AnswerMediaDraft,
        timeSpentMs: Int,
        targetKnowledgePointId: String? = nil,
        submissionId: String,
        teacherPaperAttemptId: String? = nil,
        topicContext: [String: String]? = nil
    ) async throws -> SubmitAnswerResult {
        try await authorizeAI(self, studentSession.token, "practice/submit-photo")
        let url = try makeURL(
            path: "practice/submit-photo",
            queryItems: [
                URLQueryItem(name: "student_id", value: studentSession.studentID),
                URLQueryItem(name: "include_rendered", value: "1")]
        )
        var fields = [
            "question_id": questionId,
            "time_spent_ms": String(timeSpentMs),
            "submission_id": submissionId]
        if let teacherPaperAttemptId { fields["teacher_paper_attempt_id"] = teacherPaperAttemptId }
        if let topicContext {
            fields["topic_context"] = String(data: try JSONEncoder().encode(topicContext), encoding: .utf8)
        }
        if let targetKnowledgePointId, !targetKnowledgePointId.isEmpty {
            fields["target_knowledge_point_id"] = targetKnowledgePointId
        }
        let multipart = try MultipartFormDataFile.build(
            fields: fields,
            fileFieldName: "image",
            sourceFileURL: media.fileURL,
            fileName: media.fileURL.lastPathComponent,
            mimeType: media.mimeType
        )
        defer { multipart.remove() }

        var request = URLRequest(url: url)
        request.setValue("ios", forHTTPHeaderField: "X-OpenPhysics-Privacy-Client")
        request.httpMethod = "POST"
        request.timeoutInterval = Self.aiRequestTimeout
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(
            "Bearer \(studentSession.token)",
            forHTTPHeaderField: "Authorization"
        )
        request.setValue(multipart.contentType, forHTTPHeaderField: "Content-Type")

        do {
            let (data, response) = try await session.upload(
                for: request,
                fromFile: multipart.fileURL
            )
            return try decodeResponse(data: data, response: response, token: studentSession.token)
        } catch let error as APIError {
            throw error
        } catch let error as URLError {
            throw APIError.transport(error)
        }
    }

    func submitProcessEvidence(
        for studentSession: StudentSession,
        questionId: String,
        answerId: Int,
        media: AnswerMediaDraft,
        timeSpentMs: Int
    ) async throws -> ProcessEvidenceResponse {
        try await authorizeAI(self, studentSession.token, "practice/process-evidence")
        let url = try makeURL(
            path: "practice/process-evidence",
            queryItems: [
                URLQueryItem(name: "include_rendered", value: "1")]
        )
        let multipart = try MultipartFormDataFile.build(
            fields: [
                "question_id": questionId,
                "answer_id": String(answerId),
                "time_spent_ms": String(timeSpentMs),
                "evidence_kind": "final_choice_scratch"],
            fileFieldName: "image",
            sourceFileURL: media.fileURL,
            fileName: media.fileURL.lastPathComponent,
            mimeType: media.mimeType
        )
        defer { multipart.remove() }

        var request = URLRequest(url: url)
        request.setValue("ios", forHTTPHeaderField: "X-OpenPhysics-Privacy-Client")
        request.httpMethod = "POST"
        request.timeoutInterval = 90
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(
            "Bearer \(studentSession.token)",
            forHTTPHeaderField: "Authorization"
        )
        request.setValue(multipart.contentType, forHTTPHeaderField: "Content-Type")

        do {
            let (data, response) = try await session.upload(
                for: request,
                fromFile: multipart.fileURL
            )
            return try decodeResponse(data: data, response: response, token: studentSession.token)
        } catch let error as APIError {
            throw error
        } catch let error as URLError {
            throw APIError.transport(error)
        }
    }

    func correctAnswer(
        for studentSession: StudentSession,
        answerId: Int,
        correctedAnswer: String,
        isCorrect: Bool,
        correctionReason: String
    ) async throws -> SubmitAnswerResult {
        try await request(
            path: "practice/answers/\(answerId)/correct",
            method: "POST",
            queryItems: [
                URLQueryItem(name: "include_rendered", value: "1")],
            body: ManualCorrectionRequest(
                correctedAnswer: correctedAnswer,
                isCorrect: isCorrect,
                correctionReason: correctionReason
            ),
            token: studentSession.token
        )
    }

    func submitSelfReview(
        for studentSession: StudentSession,
        questionId: String,
        items: [SelfReviewItem],
        timeSpentMs: Int,
        targetKnowledgePointId: String? = nil,
        submissionId: String,
        teacherPaperAttemptId: String? = nil,
        topicContext: [String: String]? = nil
    ) async throws -> SubmitAnswerResult {
        let completedItems = items.compactMap { item -> SelfReviewRequest.Item? in
            guard let status = item.status else { return nil }
            return SelfReviewRequest.Item(label: item.label, status: status)
        }
        guard completedItems.count == items.count, !completedItems.isEmpty else {
            throw APIError.invalidSelfReview
        }
        return try await request(
            path: "practice/self-review",
            method: "POST",
            queryItems: [URLQueryItem(name: "include_rendered", value: "1")],
            body: SelfReviewRequest(
                questionId: questionId,
                items: completedItems,
                timeSpentMs: timeSpentMs,
                targetKnowledgePointId: targetKnowledgePointId,
                submissionId: submissionId,
                teacherPaperAttemptId: teacherPaperAttemptId,
                topicContext: topicContext
            ),
            token: studentSession.token
        )
    }

    func request<Response: Decodable>(
        path: String,
        method: String = "GET",
        queryItems: [URLQueryItem] = [],
        body: (any Encodable)? = nil,
        token: String?,
        requiresAI: Bool? = nil
    ) async throws -> Response {
        let usesAI = requiresAI ?? PrivacyPolicy.needsAI(path: path, method: method)
        if let token, usesAI {
            try await authorizeAI(self, token, path)
        }
        let url = try makeURL(path: path, queryItems: queryItems)

        var request = URLRequest(url: url)
        // Learning counters and notebooks must reflect the server after a submission.
        if method == "GET", token != nil { request.cachePolicy = .reloadIgnoringLocalCacheData }
        request.setValue("ios", forHTTPHeaderField: "X-OpenPhysics-Privacy-Client")
        request.httpMethod = method
        request.timeoutInterval = usesAI ? Self.aiRequestTimeout : 30
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder.openPhysics.encode(AnyEncodable(body))
        }

        do {
            let (data, response) = try await session.data(for: request)
            if path.hasPrefix("auth/"), let http = response as? HTTPURLResponse,
               !(200..<300).contains(http.statusCode) {
                let detail = (try? JSONDecoder().decode(APIErrorBody.self, from: data).detail)
                    ?? "账号操作失败，请稍后重试。"
                throw APIError.authentication(statusCode: http.statusCode, detail: detail,
                    captchaRequired: http.value(forHTTPHeaderField: "X-Login-Captcha-Required") == "true",
                    retryAfter: http.value(forHTTPHeaderField: "Retry-After").flatMap(Int.init))
            }
            return try decodeResponse(data: data, response: response, token: token)
        } catch let error as APIError {
            throw error
        } catch let error as URLError {
            throw APIError.transport(error)
        }
    }

    private func requestOptional<Response: Decodable>(
        path: String,
        queryItems: [URLQueryItem] = [],
        token: String?
    ) async throws -> Response? {
        let url = try makeURL(path: path, queryItems: queryItems)
        var request = URLRequest(url: url)
        request.setValue("ios", forHTTPHeaderField: "X-OpenPhysics-Privacy-Client")
        request.httpMethod = "GET"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        do {
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.invalidResponse
            }
            if httpResponse.statusCode == 204 || httpResponse.statusCode == 404 {
                return nil
            }
            guard (200..<300).contains(httpResponse.statusCode) else {
                notifyAccountUnavailable(statusCode: httpResponse.statusCode, token: token)
                let detail = try? JSONDecoder().decode(
                    APIErrorBody.self,
                    from: data
                ).detail
                throw APIError.http(
                    statusCode: httpResponse.statusCode,
                    detail: detail
                )
            }
            if data.isEmpty
                || String(data: data, encoding: .utf8)?
                    .trimmingCharacters(in: .whitespacesAndNewlines) == "null" {
                return nil
            }
            do {
                return try JSONDecoder.openPhysics.decode(Response.self, from: data)
            } catch {
                throw APIError.decoding(error)
            }
        } catch let error as APIError {
            throw error
        } catch let error as URLError {
            throw APIError.transport(error)
        }
    }

    private func makeURL(
        path: String,
        queryItems: [URLQueryItem]
    ) throws -> URL {
        guard var components = URLComponents(
            url: baseURL.appendingPathComponent(path),
            resolvingAgainstBaseURL: false
        ) else {
            throw APIError.invalidURL
        }
        if !queryItems.isEmpty {
            components.queryItems = queryItems
        }
        guard let url = components.url else { throw APIError.invalidURL }
        return url
    }

    private func decodeResponse<Response: Decodable>(
        data: Data,
        response: URLResponse,
        token: String?
    ) throws -> Response {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        if httpResponse.value(forHTTPHeaderField: "X-OpenPhysics-AI-Consent-Required") == "true" {
            throw PrivacyConsentError.required
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            notifyAccountUnavailable(statusCode: httpResponse.statusCode, token: token)
            let detail = try? JSONDecoder().decode(APIErrorBody.self, from: data).detail
            throw APIError.http(statusCode: httpResponse.statusCode, detail: detail)
        }
        do {
            if httpResponse.statusCode == 204, let empty = NoContentResponse() as? Response {
                return empty
            }
            return try JSONDecoder.openPhysics.decode(Response.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }

    private func notifyAccountUnavailable(statusCode: Int, token: String?) {
        guard statusCode == 401, let token, !token.isEmpty else { return }
        NotificationCenter.default.post(name: .studentAccessRefreshRequested, object: token)
    }
}

struct NoContentResponse: Decodable {}

private struct LoginRequest: Encodable {
    let username: String
    let password: String
}

private struct LearnCompleteRequest: Encodable {
    let kpId: String
    let contentId: String
    let contentType: String
    let timeSpentSeconds: Int
}

private struct LearningChatRequest: Encodable {
    let kpId: String
    let message: String
    let history: [LearningChatMessage]

    enum CodingKeys: String, CodingKey {
        case kpId = "kp_id"
        case message
        case history
    }
}

private struct LearningChatChunk: Decodable {
    let content: String
}

private struct QuestionTutorChatRequest: Encodable {
    let questionId: String
    let givenAnswer: String
    let message: String
    let history: [LearningChatMessage]
    let processGrading: ReviewProcessGrading?
}

private struct QuestionTutorChatResponse: Decodable {
    let text: String
}

private struct KpDiagnoseRequest: Encodable {
    let questionCount: Int

    enum CodingKeys: String, CodingKey {
        case questionCount = "question_count"
    }
}

private struct LearningCatalogTopicSessionRequest: Encodable {
    let layer: LearningCatalogTopicLayer
    let questionCount: Int

    enum CodingKeys: String, CodingKey {
        case layer
        case questionCount = "question_count"
    }
}

private struct LearningCatalogTopicEvidenceRequest: Encodable {
    let layer: LearningCatalogTopicLayer
    let answerId: Int

    enum CodingKeys: String, CodingKey {
        case layer
        case answerId = "answer_id"
    }
}

private struct ScopeDiagnoseRequest: Encodable {
    let scopeType: String
    let scopeId: String
    let questionCount: Int

    enum CodingKeys: String, CodingKey {
        case scopeType = "scope_type"
        case scopeId = "scope_id"
        case questionCount = "question_count"
    }
}

private struct SubmittedDiagnosticFeedbackRequest: Encodable {
    let answers: [SubmittedDiagnosticAnswer]
}

private struct SubmittedScopeDiagnosticFeedbackRequest: Encodable {
    let scopeType: String
    let scopeId: String
    let answers: [SubmittedDiagnosticAnswer]

    enum CodingKeys: String, CodingKey {
        case scopeType = "scope_type"
        case scopeId = "scope_id"
        case answers
    }
}

private struct CreateImprovementPlanRequest: Encodable {
    let diagnosticResult: ScopeDiagnosticResult

    enum CodingKeys: String, CodingKey {
        case diagnosticResult = "diagnostic_result"
    }
}

private struct UpdateImprovementTaskRequest: Encodable {
    let status: String
}

private struct MoveToNextImprovementTaskRequest: Encodable {
    let markInProgress: Bool

    enum CodingKeys: String, CodingKey {
        case markInProgress = "mark_in_progress"
    }
}

private struct EmptyRequest: Encodable {}

private struct CompleteReviewRequest: Encodable {
    let retryAnswerId: Int?

    enum CodingKeys: String, CodingKey {
        case retryAnswerId = "retry_answer_id"
    }
}

private struct ManualCorrectionRequest: Encodable {
    let correctedAnswer: String
    let isCorrect: Bool
    let correctionReason: String

    enum CodingKeys: String, CodingKey {
        case correctedAnswer = "corrected_answer"
        case isCorrect = "is_correct"
        case correctionReason = "correction_reason"
    }
}

private struct SubmitAnswerRequest: Encodable {
    let questionId: String
    let givenAnswer: String
    let timeSpentMs: Int
    let targetKnowledgePointId: String?
    let submissionId: String
    let teacherPaperAttemptId: String?
    let topicContext: [String: String]?

    enum CodingKeys: String, CodingKey {
        case questionId = "question_id"
        case givenAnswer = "given_answer"
        case timeSpentMs = "time_spent_ms"
        case targetKnowledgePointId = "target_knowledge_point_id"
        case submissionId = "submission_id"
        case teacherPaperAttemptId = "teacher_paper_attempt_id"
        case topicContext = "topic_context"
    }
}

private struct SelfReviewRequest: Encodable {
    struct Item: Encodable {
        let label: String
        let status: SelfReviewStatus
    }

    let questionId: String
    let items: [Item]
    let timeSpentMs: Int
    let targetKnowledgePointId: String?
    let submissionId: String
    let teacherPaperAttemptId: String?
    let topicContext: [String: String]?

    enum CodingKeys: String, CodingKey {
        case questionId = "question_id"
        case items
        case timeSpentMs = "time_spent_ms"
        case targetKnowledgePointId = "target_knowledge_point_id"
        case submissionId = "submission_id"
        case teacherPaperAttemptId = "teacher_paper_attempt_id"
        case topicContext = "topic_context"
    }
}

private struct LessonVideoRequest: Encodable {
    let answerId: Int
    enum CodingKeys: String, CodingKey { case answerId = "answer_id" }
}

private struct APIErrorBody: Decodable {
    let detail: String?
}

private struct AnyEncodable: Encodable {
    private let encodeValue: (Encoder) throws -> Void

    init(_ value: any Encodable) {
        encodeValue = value.encode
    }

    func encode(to encoder: Encoder) throws {
        try encodeValue(encoder)
    }
}

enum APIError: LocalizedError {
    case authentication(statusCode: Int, detail: String, captchaRequired: Bool, retryAfter: Int?)
    case invalidURL
    case invalidResponse
    case invalidSelfReview
    case http(statusCode: Int, detail: String?)
    case transport(URLError)
    case decoding(Error)

    var errorDescription: String? {
        switch self {
        case let .authentication(_, detail, _, _):
            return detail
        case .invalidURL, .invalidResponse:
            return "服务地址无效，请稍后重试。"
        case .invalidSelfReview:
            return "请先完成每一小问的自评。"
        case let .http(statusCode, detail):
            switch statusCode {
            case 401:
                return "用户名或密码不正确，或者登录已失效。"
            default:
                // The server's Chinese reason (e.g. an unreadable photo that needs a
                // retake) is what the student can act on; the web shows it too.
                if let detail = Self.studentFacingDetail(detail) { return detail }
                if statusCode >= 500 { return "云端服务暂时不可用，请稍后重试。" }
                return "请求失败（\(statusCode)），请稍后重试。"
            }
        case let .transport(error):
            if error.code == .timedOut {
                return "连接超时，请检查网络后重试。"
            }
            return "无法连接学习服务，请检查网络。"
        case .decoding:
            return "学习数据格式发生变化，请更新应用后重试。"
        }
    }

    static func studentFacingDetail(_ detail: String?) -> String? {
        guard
            let detail = detail?.trimmingCharacters(in: .whitespacesAndNewlines),
            !detail.isEmpty,
            detail.unicodeScalars.contains(where: { (0x4E00...0x9FFF).contains($0.value) })
        else { return nil }
        return detail
    }

    /// The request never got an HTTP answer (dropped connection, offline, cancelled).
    var isTransport: Bool {
        if case .transport = self { return true }
        return false
    }

    /// The request was cancelled by the app, not failed by the network.
    var isCancellation: Bool {
        if case let .transport(error) = self { return error.code == .cancelled }
        return false
    }

    var isUnauthorized: Bool {
        if case let .http(statusCode, _) = self { return statusCode == 401 }
        if case let .authentication(statusCode, _, _, _) = self { return statusCode == 401 }
        return false
    }

    var isAccountUnavailable: Bool {
        if case let .http(statusCode, _) = self { return statusCode == 401 }
        return false
    }
}
