import Foundation
import CryptoKit
import PencilKit
import UIKit

enum AIGradingFailure: Equatable {
    /// The current answer was not graded; submitting it again retries.
    case answer
    /// Part of a whole set, or its result, is missing; finishing the set again retries the rest.
    case set
}

enum PracticeWorkflow: Equatable {
    case practice
    case assessment(kpId: String)
    case kpPractice(kpId: String)
    /// A whole-set practice without one target point (混合提升), graded together like the web.
    case mixedPractice
    case scopeDiagnostic(
        scopeType: String,
        scopeId: String,
        scopeName: String
    )
    case improvementRetest(planId: String, attemptId: String)
    case reviewRetry(answerId: Int)
    case learningCatalog(LearningCatalogPracticeContext)
    /// A teacher's personalized homework: answered whole, then graded like a teacher paper.
    case teacherHomework(attemptId: String, title: String)

    var isAssessment: Bool {
        switch self {
        // The web grades every set except improvement-task practice and variations as a whole.
        case .assessment, .scopeDiagnostic, .kpPractice, .mixedPractice, .improvementRetest: return true
        case let .learningCatalog(context): return context.layer == .diagnostic
        case .teacherHomework: return true
        case .practice, .reviewRetry: return false
        }
    }

    var assessmentKnowledgePointId: String? {
        if case let .assessment(kpId) = self { return kpId }
        return nil
    }

    var title: String {
        switch self {
        case .practice: return "巩固练习"
        case .assessment: return "掌握评估"
        case .kpPractice: return "巩固小练"
        case .mixedPractice: return "混合提升"
        case let .scopeDiagnostic(_, _, scopeName):
            return "\(scopeName) · 单元检测"
        case .improvementRetest: return "阶段复测"
        case .reviewRetry: return "做变式题"
        case let .learningCatalog(context): return context.layer.title
        case .teacherHomework: return "老师作业"
        }
    }

    var learningCatalogContext: LearningCatalogPracticeContext? {
        guard case let .learningCatalog(context) = self else { return nil }
        return context
    }

    var practiceKnowledgePointId: String? {
        guard case let .kpPractice(kpId) = self else { return nil }
        return kpId
    }

    /// Whole-set practice summarised locally from its own results, with no diagnostic request.
    var isSetPractice: Bool {
        switch self {
        case .kpPractice, .mixedPractice: return true
        default: return false
        }
    }
}

@MainActor
final class PracticeStore: ObservableObject {
    @Published private(set) var attemptId = UUID()
    @Published private(set) var session: PracticeSession?
    @Published private(set) var workflow: PracticeWorkflow = .practice
    @Published private(set) var currentIndex = 0
    @Published private(set) var isLoading = false
    @Published private(set) var isSubmitting = false
    @Published private(set) var isFinalizing = false
    @Published private(set) var assessmentGradingCompleted = 0
    @Published private(set) var assessmentGradingTotal = 0
    /// When the current AI grading began (one answer or a whole set); nil when nothing is waiting on AI.
    @Published private(set) var aiGradingStartedAt: Date?
    /// Set when AI grading stopped without a result, so the workspace can offer a retry.
    @Published private(set) var aiGradingFailure: AIGradingFailure?
    @Published private(set) var results: [String: SubmitAnswerResult] = [:]
    @Published private(set) var diagnosticResult: KpDiagnosticResult?
    @Published private(set) var scopeDiagnosticResult: ScopeDiagnosticResult?
    @Published private(set) var improvementRetestResult: ImprovementRetestResult?
    @Published private(set) var reviewRetryCleared = false
    /// The server's reason for keeping the original mistake open after a correct variation.
    @Published private(set) var reviewRetryClearDetail = ""
    @Published private(set) var learningCatalogOverview: LearningCatalogTopicOverview?
    @Published private(set) var learningCatalogSummary: LearningCatalogPracticeSummary?
    @Published private(set) var evidenceSyncMessage = ""
    @Published private(set) var isCorrectingGrading = false
    @Published private(set) var collectedQuestionIds = Set<String>()
    @Published private(set) var answers: [String: String] = [:]
    @Published private(set) var answerModes: [String: PracticeAnswerMode] = [:]
    @Published private(set) var drawings: [String: PKDrawing] = [:]
    @Published private(set) var drawingBackgroundImagePaths: [String: String] = [:]
    /// Where the student dragged or pinched the question image on each draft paper.
    @Published private(set) var drawingBackgroundPlacements: [String: QuestionDrawingBackgroundPlacement] = [:]
    @Published private(set) var mediaDrafts: [String: AnswerMediaDraft] = [:]
    @Published private(set) var selfReviewItems: [String: [SelfReviewItem]] = [:]
    @Published var message = ""
    @Published private(set) var requiresLogin = false

    private let apiClient: APIClient
    private let draftFileStore: AnswerDraftFileStore
    private var submissionIds: [String: String] = [:]
    private var questionElapsedTimes: [String: Int] = [:]
    private var drawingCanvasSizes: [String: CGSize] = [:]
    private var backgroundImageCache: [String: UIImage] = [:]
    private var selfReviewCollectedQuestionIds = Set<String>()
    private var pendingLearningCatalogAnswerIds = Set<Int>()
    private var questionStartedAt = Date()
    private var reviewRoundOwner = ""
    private var reviewRoundQuestionIds: [Int: [String]] = [:]

    init(
        apiClient: APIClient = APIClient(),
        draftFileStore: AnswerDraftFileStore = AnswerDraftFileStore()
    ) {
        self.apiClient = apiClient
        self.draftFileStore = draftFileStore
    }

    var currentQuestion: PracticeQuestion? {
        guard let questions = session?.questions, questions.indices.contains(currentIndex) else {
            return nil
        }
        return questions[currentIndex]
    }

    var isAssessment: Bool { workflow.isAssessment }

    var isTeacherPaper: Bool {
        if case .teacherHomework = workflow { return true }
        return false
    }
    var teacherPaperCompleted: Bool { session?.teacherPaper?.isCompleted == true }
    var needsExitConfirmation: Bool {
        guard session != nil, hasUnsavedWork else { return false }
        return isAssessment ? !hasAssessmentResult : !isComplete
    }

    /// Nothing entered and nothing graded yet: leaving loses nothing, so no confirmation is needed.
    var hasUnsavedWork: Bool {
        !results.isEmpty || !collectedQuestionIds.isEmpty || !mediaDrafts.isEmpty
            || answers.values.contains { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            || drawings.values.contains { !$0.strokes.isEmpty }
            // Self-review items are pre-filled per sub-question; only a marked one is the student's work.
            || selfReviewItems.values.contains { $0.contains { $0.status != nil } }
    }

    var assessmentSummaryPending: Bool {
        isAssessment && isComplete && !hasAssessmentResult
    }

    var exitConfirmationMessage: String {
        assessmentSummaryPending
            ? "题目已批改，但本组结果尚未生成。退出后将无法在本页重试，已提交的批改记录会保留。"
            : "未提交的答案和草稿将被放弃，已提交的批改记录会保留。"
    }

    var assessmentSubmitTitle: String {
        if isFinalizing {
            return isComplete ? "生成结果…" : "批改 \(assessmentGradingCompleted)/\(assessmentGradingTotal)"
        }
        if assessmentSummaryPending { return "重新获取结果" }
        return results.isEmpty ? "交卷" : "继续批改"
    }

    func discardUnfinishedWork(studentId: String) {
        guard !isSubmitting, !isFinalizing, !isCorrectingGrading else { return }
        for question in session?.questions ?? [] {
            draftFileStore.removeDrafts(studentId: studentId, questionId: question.id)
        }
        attemptId = UUID()
        session = nil
        answers = [:]
        answerModes = [:]
        drawings = [:]
        mediaDrafts = [:]
        selfReviewItems = [:]
        drawingBackgroundImagePaths = [:]
        drawingBackgroundPlacements = [:]
        drawingCanvasSizes = [:]
        backgroundImageCache = [:]
        submissionIds = [:]
        results = [:]
        collectedQuestionIds = []
        selfReviewCollectedQuestionIds = []
        questionElapsedTimes = [:]
    }

    var isImprovementRetest: Bool {
        if case .improvementRetest = workflow { return true }
        return false
    }

    var isReviewRetry: Bool {
        if case .reviewRetry = workflow { return true }
        return false
    }

    var isLearningCatalog: Bool {
        workflow.learningCatalogContext != nil
    }

    var hasAssessmentResult: Bool {
        teacherPaperCompleted || diagnosticResult != nil
            || scopeDiagnosticResult != nil
            || improvementRetestResult != nil
            || learningCatalogSummary != nil
            || (isSetPractice && isComplete)
    }

    var isSetPractice: Bool { workflow.isSetPractice }

    var setPracticeSummary: LearningCatalogPracticeSummary? {
        guard isSetPractice, isComplete, let questions = session?.questions else { return nil }
        let credit = questions.compactMap { results[$0.id] }.reduce(0.0) {
            $0 + learningCatalogCredit(for: $1)
        }
        return LearningCatalogPracticeSummary(correctCount: (credit * 10).rounded() / 10, totalCount: questions.count)
    }

    var answeredCount: Int {
        guard let questions = session?.questions else { return 0 }
        if isAssessment {
            return questions.filter { hasAnswerDraft(for: $0) }.count
        }
        return questions.filter { results[$0.id] != nil }.count
    }

    var currentAnswer: String {
        guard let currentQuestion else { return "" }
        return answers[currentQuestion.id, default: ""]
    }

    var currentResult: SubmitAnswerResult? {
        guard let currentQuestion else { return nil }
        return results[currentQuestion.id]
    }

    var currentAnswerMode: PracticeAnswerMode {
        guard let currentQuestion else { return .text }
        return answerModes[currentQuestion.id] ?? .handwriting
    }

    var currentDrawing: PKDrawing {
        guard let currentQuestion else { return PKDrawing() }
        return drawings[currentQuestion.id] ?? PKDrawing()
    }

    var currentDrawingBackgroundImagePath: String? {
        guard let currentQuestion else { return nil }
        return drawingBackgroundImagePaths[currentQuestion.id]
    }

    var currentMediaDraft: AnswerMediaDraft? {
        guard let currentQuestion else { return nil }
        return mediaDrafts[currentQuestion.id]
    }

    var currentSelfReviewItems: [SelfReviewItem] {
        guard let currentQuestion else { return [] }
        return selfReviewItems[currentQuestion.id] ?? currentQuestion.initialSelfReviewItems
    }

    var canSubmitCurrentSelfReview: Bool {
        !currentSelfReviewItems.isEmpty
            && currentSelfReviewItems.allSatisfy { $0.status != nil }
    }

    var currentAnswerSummary: String {
        guard let question = currentQuestion else { return "" }
        if question.isChoice || currentAnswerMode == .text {
            return currentAnswer
        }
        switch currentAnswerMode {
        case .handwriting:
            return currentDrawing.strokes.isEmpty ? "" : "[手写作答]"
        case .photo:
            return currentMediaDraft == nil ? "" : "[照片作答]"
        case .text:
            return currentAnswer
        }
    }

    var canSubmitCurrentAnswer: Bool {
        !currentAnswerSummary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var currentAnswerIsCollected: Bool {
        guard let currentQuestion else { return false }
        return collectedQuestionIds.contains(currentQuestion.id)
    }

    var allAssessmentAnswersCollected: Bool {
        guard isAssessment, let questions = session?.questions, !questions.isEmpty else {
            return false
        }
        return questions.allSatisfy { hasAnswerDraft(for: $0) }
    }

    var canFinalizeAssessment: Bool {
        isAssessment
            && !hasAssessmentResult
            && (answeredCount > 0 || !results.isEmpty)
            && !isSubmitting
            && !isFinalizing
    }

    var assessmentSubmissionSummary: PracticeSubmissionSourceSummary {
        guard let questions = session?.questions else {
            return PracticeSubmissionSourceSummary(
                choice: 0,
                text: 0,
                handwriting: 0,
                photo: 0,
                selfReview: 0,
                unanswered: 0
            )
        }

        var choice = 0
        var text = 0
        var handwriting = 0
        var photo = 0
        var selfReview = 0
        var unanswered = 0

        for question in questions {
            guard hasAnswerDraft(for: question) else {
                unanswered += 1
                continue
            }
            if hasCompletedSelfReviewDraft(for: question) {
                selfReview += 1
            } else if question.isChoice {
                choice += 1
            } else {
                switch answerModes[question.id] ?? .handwriting {
                case .text: text += 1
                case .handwriting: handwriting += 1
                case .photo: photo += 1
                }
            }
        }

        return PracticeSubmissionSourceSummary(
            choice: choice,
            text: text,
            handwriting: handwriting,
            photo: photo,
            selfReview: selfReview,
            unanswered: unanswered
        )
    }

    var submittedAnswerSummary: String {
        currentResult?.extractedAnswer ?? currentAnswerSummary
    }

    func hasAnswerDraft(for question: PracticeQuestion) -> Bool {
        if question.supportsSelfReview {
            let items = selfReviewItems[question.id] ?? question.initialSelfReviewItems
            if !items.isEmpty, items.allSatisfy({ $0.status != nil }) {
                return true
            }
        }
        return !answerSummary(for: question)
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .isEmpty
    }

    var canGoBack: Bool {
        currentIndex > 0 && !isSubmitting && !isFinalizing
    }

    var canGoForward: Bool {
        guard let questions = session?.questions else { return false }
        let currentFinished = isAssessment
            ? currentQuestion.map { hasAnswerDraft(for: $0) } == true
            : currentResult != nil
        return currentIndex + 1 < questions.count
            && currentFinished
            && !isSubmitting
            && !isFinalizing
    }

    var isComplete: Bool {
        guard let questions = session?.questions, !questions.isEmpty else { return false }
        return questions.allSatisfy { results[$0.id] != nil }
    }

    func start(student: StudentSession, kpId: String, count: Int = 5, deferredGrading: Bool = false) async -> Bool {
        isLoading = true
        message = ""
        requiresLogin = false
        defer { isLoading = false }

        do {
            let loaded = try await apiClient.practiceSession(
                for: student,
                targetKpId: kpId,
                count: count
            )
            guard !loaded.questions.isEmpty else {
                message = "当前知识点暂时没有可练题目。"
                return false
            }
            prepare(loaded, workflow: deferredGrading ? .kpPractice(kpId: kpId) : .practice)
            return true
        } catch {
            handle(error)
            return false
        }
    }

    func startAssessment(
        student: StudentSession,
        kpId: String,
        count: Int = 3
    ) async -> Bool {
        isLoading = true
        message = ""
        requiresLogin = false
        defer { isLoading = false }

        do {
            let loaded = try await apiClient.diagnosticSession(
                for: student,
                targetKpId: kpId,
                count: count
            )
            guard !loaded.questions.isEmpty else {
                message = "当前知识点暂时没有可用于评估的题目。"
                return false
            }
            prepare(loaded, workflow: .assessment(kpId: kpId))
            return true
        } catch {
            handle(error)
            return false
        }
    }

    func startScopeDiagnostic(
        student: StudentSession,
        scopeType: String = "chapter",
        scopeId: String,
        scopeName: String,
        count: Int = 10
    ) async -> Bool {
        isLoading = true
        message = ""
        requiresLogin = false
        defer { isLoading = false }

        do {
            let loaded = try await apiClient.scopeDiagnosticSession(
                for: student,
                scopeType: scopeType,
                scopeId: scopeId,
                questionCount: count
            )
            guard !loaded.questions.isEmpty else {
                message = "当前章节暂时没有可用于定位的题目。"
                return false
            }
            prepare(
                loaded,
                workflow: .scopeDiagnostic(
                    scopeType: scopeType,
                    scopeId: scopeId,
                    scopeName: scopeName
                )
            )
            return true
        } catch {
            handle(error)
            return false
        }
    }

    func startLearningCatalogTopic(
        student: StudentSession,
        catalogCode: String,
        nodeId: String,
        topicTitle: String,
        layer: LearningCatalogTopicLayer,
        questionCount: Int? = nil
    ) async -> Bool {
        let context = LearningCatalogPracticeContext(
            catalogCode: catalogCode,
            nodeId: nodeId,
            topicTitle: topicTitle,
            layer: layer,
            questionCount: questionCount ?? layer.questionCount
        )
        return await loadLearningCatalogTopic(student: student, context: context)
    }

    /// Teacher homework needs no membership: the server opens it to its own student.
    func startTeacherHomework(student: StudentSession, attemptId: String, title: String) async -> Bool {
        isLoading = true
        message = ""
        requiresLogin = false
        defer { isLoading = false }
        do {
            let loaded = try await apiClient.teacherHomeworkSession(for: student, attemptId: attemptId)
            guard !loaded.questions.isEmpty else {
                message = "这份作业暂时没有题目。"
                return false
            }
            prepare(loaded, workflow: .teacherHomework(attemptId: attemptId, title: title))
            return true
        } catch {
            handle(error)
            return false
        }
    }

    func restartLearningCatalogTopic(student: StudentSession) async -> Bool {
        guard let context = workflow.learningCatalogContext else { return false }
        await retryLearningCatalogEvidence(student: student)
        return await loadLearningCatalogTopic(student: student, context: context)
    }

    func retryLearningCatalogEvidence(student: StudentSession) async {
        guard let context = workflow.learningCatalogContext else { return }
        for answerId in Array(pendingLearningCatalogAnswerIds) {
            await synchronizeLearningCatalogEvidence(
                answerId: answerId,
                context: context,
                student: student
            )
        }
    }

    func startImprovementRetest(
        student: StudentSession,
        planId: String
    ) async -> Bool {
        isLoading = true
        message = ""
        requiresLogin = false
        defer { isLoading = false }

        do {
            let loaded = try await apiClient.startImprovementRetest(
                for: student,
                planId: planId
            )
            guard !loaded.session.questions.isEmpty else {
                message = "当前提升计划暂时没有可用于复测的题目。"
                return false
            }
            prepare(
                loaded.session,
                workflow: .improvementRetest(
                    planId: planId,
                    attemptId: loaded.attemptId
                )
            )
            return true
        } catch {
            handle(error)
            return false
        }
    }

    func continueReviewRetry(student: StudentSession) async {
        guard case let .reviewRetry(answerId) = workflow, !reviewRetryCleared,
              currentResult?.isCorrect == false || !reviewRetryClearDetail.isEmpty else { return }
        _ = await startReviewRetry(student: student, answerId: answerId)
    }

    func startReviewRetry(
        student: StudentSession,
        answerId: Int
    ) async -> Bool {
        guard !isLoading, !isSubmitting, !isFinalizing, !isCorrectingGrading else { return false }
        if reviewRoundOwner != student.token {
            reviewRoundOwner = student.token
            reviewRoundQuestionIds = [:]
        } else if workflow == .reviewRetry(answerId: answerId), session != nil, currentResult == nil {
            return true
        }
        isLoading = true
        message = ""
        requiresLogin = false
        defer { isLoading = false }
        let excluded = reviewRoundQuestionIds[answerId, default: []]
        do {
            let variation: ReviewVariationQuestion?
            do {
                variation = try await apiClient.reviewVariations(
                    for: student, answerId: answerId, excludingQuestionIds: excluded
                ).variations.first(where: { !excluded.contains($0.question.id) })
            } catch {
                if (error as? APIError)?.isUnauthorized == true { throw error }
                variation = nil
            }
            let fallback: PracticeQuestion?
            if variation == nil {
                fallback = try await apiClient.retryReviewQuestion(
                    for: student, answerId: answerId, excludingQuestionIds: excluded
                ).question
            } else { fallback = nil }
            guard let question = variation?.question ?? fallback, !excluded.contains(question.id) else {
                message = "暂时没有更多合适的变式题，可先回看解析，稍后再练。"
                return false
            }
            prepare(
                PracticeSession(studentId: student.studentID, sessionType: "review_retry",
                    strategy: "review_variation", sessionObjective: variation?.title ?? "做变式题",
                    questions: [question]),
                workflow: .reviewRetry(answerId: answerId)
            )
            return true
        } catch {
            handle(error)
            return false
        }
    }

    func setAnswer(_ answer: String, for questionId: String) {
        guard
            results[questionId] == nil,
            !collectedQuestionIds.contains(questionId)
        else { return }
        answers[questionId] = answer
        message = ""
    }

    func setAnswerMode(_ mode: PracticeAnswerMode, for questionId: String) {
        guard
            results[questionId] == nil,
            !collectedQuestionIds.contains(questionId)
        else { return }
        answerModes[questionId] = mode
        message = ""
    }

    func setDrawing(
        _ drawing: PKDrawing,
        student: StudentSession,
        questionId: String
    ) {
        guard
            results[questionId] == nil,
            !collectedQuestionIds.contains(questionId)
        else { return }
        drawings[questionId] = drawing
        do {
            try draftFileStore.saveDrawing(
                drawing,
                studentId: student.studentID,
                questionId: questionId
            )
            message = ""
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "手写草稿暂时无法保存。"
        }
    }

    func setDrawingBackgroundImage(
        _ image: QuestionImage?,
        for questionId: String
    ) {
        guard
            results[questionId] == nil,
            !collectedQuestionIds.contains(questionId),
            let question = session?.questions.first(where: { $0.id == questionId })
        else { return }
        if let image {
            guard question.draftImages.contains(image) else { return }
            drawingBackgroundImagePaths[questionId] = image.imagePath
        } else {
            drawingBackgroundImagePaths[questionId] = nil
        }
        // A newly placed (or removed) image starts from its default spot.
        drawingBackgroundPlacements[questionId] = nil
        message = ""
    }

    func setDrawingBackgroundPlacement(
        _ placement: QuestionDrawingBackgroundPlacement?,
        for questionId: String
    ) {
        guard
            results[questionId] == nil,
            !collectedQuestionIds.contains(questionId),
            drawingBackgroundImagePaths[questionId] != nil
        else { return }
        drawingBackgroundPlacements[questionId] = placement == QuestionDrawingBackgroundPlacement() ? nil : placement
    }

    func setDrawingCanvasSize(_ size: CGSize, for questionId: String) {
        guard size.width > 0, size.height > 0 else { return }
        drawingCanvasSizes[questionId] = size
    }

    func beginPhotoSelection(student: StudentSession) -> AnswerPhotoContext? {
        guard let question = currentQuestion, !isLoading, !isSubmitting, !isFinalizing,
              !isCorrectingGrading, results[question.id] == nil,
              !collectedQuestionIds.contains(question.id) else { return nil }
        return AnswerPhotoContext(attemptId: attemptId, questionId: question.id, studentToken: student.token)
    }

    func confirmPhoto(data: Data, student: StudentSession, context: AnswerPhotoContext) -> Bool {
        guard context.attemptId == attemptId, context.studentToken == student.token,
              context.questionId == currentQuestion?.id else { return false }
        return attachPhoto(data: data, student: student, questionId: context.questionId)
    }

    @discardableResult
    func attachPhoto(
        data: Data,
        student: StudentSession,
        questionId: String
    ) -> Bool {
        guard
            session?.questions.contains(where: { $0.id == questionId }) == true,
            !isSubmitting, !isFinalizing, !isCorrectingGrading,
            results[questionId] == nil,
            !collectedQuestionIds.contains(questionId)
        else { return false }
        do {
            mediaDrafts[questionId] = try draftFileStore.savePhoto(
                data: data,
                studentId: student.studentID,
                questionId: questionId
            )
            answerModes[questionId] = .photo
            message = ""
            return true
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "照片暂时无法保存。"
            return false
        }
    }

    func clearDrawingDraft(student: StudentSession, questionId: String) {
        guard
            results[questionId] == nil,
            !collectedQuestionIds.contains(questionId)
        else { return }
        drawings[questionId] = PKDrawing()
        draftFileStore.removeDrawing(
            studentId: student.studentID,
            questionId: questionId
        )
        if answerModes[questionId] != .photo {
            answerModes[questionId] = .handwriting
        }
        message = ""
    }

    func removePhotoDraft(student: StudentSession, questionId: String) {
        guard
            results[questionId] == nil,
            !collectedQuestionIds.contains(questionId)
        else { return }
        mediaDrafts[questionId] = nil
        draftFileStore.removePhoto(
            studentId: student.studentID,
            questionId: questionId
        )
        answerModes[questionId] = .handwriting
        message = ""
    }

    func setSelfReviewStatus(
        _ status: SelfReviewStatus,
        itemId: String,
        questionId: String
    ) {
        guard
            results[questionId] == nil,
            !collectedQuestionIds.contains(questionId)
        else { return }
        let initialItems = session?.questions
            .first(where: { $0.id == questionId })?
            .initialSelfReviewItems ?? []
        var items = selfReviewItems[questionId] ?? initialItems
        guard let index = items.firstIndex(where: { $0.id == itemId }) else { return }
        items[index].status = status
        selfReviewItems[questionId] = items
        message = ""
    }

    func submit(student: StudentSession) async {
        guard let question = currentQuestion else { return }
        let answer = currentAnswerSummary.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !answer.isEmpty else {
            message = question.isChoice ? "请先选择答案。" : "请先写下你的答案。"
            return
        }

        if isAssessment {
            collectAssessmentAnswer(question: question)
            return
        }

        isSubmitting = true
        message = ""
        aiGradingFailure = nil
        // Tapped options are compared with the key at once; everything else waits on AI.
        let usesAI = !question.isChoice
        if usesAI { aiGradingStartedAt = Date() }
        defer { isSubmitting = false; aiGradingStartedAt = nil }

        do {
            let result = try await gradeAnswer(
                for: question,
                student: student,
                elapsed: elapsedTimeForCurrentQuestion()
            )
            await acceptGradedResult(result, for: question, student: student)
            try await completeReviewIfNeeded(result: result, student: student)
        } catch {
            handle(error)
            if usesAI, results[question.id] == nil, !requiresLogin, !(error is PrivacyConsentError) {
                aiGradingFailure = .answer
            }
        }
    }

    func dismissAIGradingFailure() {
        aiGradingFailure = nil
    }

    func correctCurrentGrading(
        student: StudentSession,
        isCorrect: Bool
    ) async {
        guard
            let question = currentQuestion,
            let currentResult = results[question.id],
            let answerId = currentResult.answerId,
            !isSubmitting,
            !isCorrectingGrading
        else { return }

        isCorrectingGrading = true
        message = ""
        defer { isCorrectingGrading = false }

        let extractedAnswer = currentResult.extractedAnswer?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let fallbackAnswer = answerSummary(for: question)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let correctedAnswer = (
            extractedAnswer?.isEmpty == false ? extractedAnswer : nil
        ) ?? fallbackAnswer

        do {
            let corrected = try await apiClient.correctAnswer(
                for: student,
                answerId: answerId,
                correctedAnswer: correctedAnswer,
                isCorrect: isCorrect,
                correctionReason: "学生核对标准答案和作答过程后纠正 AI 批改结果"
            )
            await acceptGradedResult(corrected, for: question, student: student)
            try await completeReviewIfNeeded(result: corrected, student: student)
            message = "批改结果已修正，掌握度和错题记录已同步更新。"
        } catch {
            handle(error)
        }
    }

    func correctPaperGrading(student: StudentSession, questionId: String, correct: Bool, answer: String) async {
        guard teacherPaperCompleted, let answerId = results[questionId]?.answerId, !isCorrectingGrading else { return }
        isCorrectingGrading = true
        defer { isCorrectingGrading = false }
        do {
            let corrected = try await apiClient.correctAnswer(for: student, answerId: answerId,
                correctedAnswer: answer, isCorrect: correct, correctionReason: "学生核对标准答案后纠正 AI 批改结果")
            results[questionId] = corrected
            notifyLearningProgress(student)
            try await refreshTeacherPaper(student: student)
            message = "批改结果已修正，掌握度和错题记录已同步更新。"
        } catch { handle(error) }
    }

    func retryReviewCompletion(student: StudentSession) async {
        guard
            case let .reviewRetry(answerId) = workflow,
            let result = currentResult,
            result.isCorrect,
            !reviewRetryCleared,
            !isSubmitting
        else { return }

        isSubmitting = true
        message = ""
        defer { isSubmitting = false }
        do {
            applyReviewCompletion(try await apiClient.completeReview(
                for: student,
                answerId: answerId,
                retryAnswerId: result.answerId
            ))
            notifyLearningProgress(student)
        } catch {
            handle(error)
        }
    }

    func submitSelfReview(student: StudentSession) async {
        guard let question = currentQuestion, question.supportsSelfReview else { return }
        let items = currentSelfReviewItems
        guard canSubmitCurrentSelfReview else {
            message = "请先完成每一小问的自评。"
            return
        }

        if isAssessment {
            selfReviewCollectedQuestionIds.insert(question.id)
            collectedQuestionIds.insert(question.id)
            questionElapsedTimes[question.id] = elapsedTimeForCurrentQuestion()
            message = ""
            return
        }

        isSubmitting = true
        message = ""
        defer { isSubmitting = false }

        let itemKey = items.map {
            "\($0.label)=\($0.status?.rawValue ?? "wrong")"
        }.joined(separator: "|")
        let stableId = submissionId(for: "self-review:\(question.id):\(itemKey)")
        let elapsed = max(0, Int(Date().timeIntervalSince(questionStartedAt) * 1_000))

        do {
            let result = try await apiClient.submitSelfReview(
                for: student,
                questionId: question.id,
                items: items,
                timeSpentMs: elapsed,
                targetKnowledgePointId: question.targetKnowledgePointId,
                submissionId: stableId
            )
            await acceptGradedResult(result, for: question, student: student)
            try await completeReviewIfNeeded(result: result, student: student)
        } catch {
            handle(error)
        }
    }

    func finalizeAssessment(student: StudentSession) async {
        guard
            let questions = session?.questions,
            !questions.isEmpty,
            canFinalizeAssessment,
            !hasAssessmentResult,
            !isFinalizing
        else { return }

        collectAllAssessmentDrafts()
        isFinalizing = true
        assessmentGradingTotal = questions.count
        assessmentGradingCompleted = questions.filter {
            results[$0.id] != nil
        }.count
        message = ""
        aiGradingFailure = nil
        aiGradingStartedAt = Date()
        // A missing AI consent opens the consent sheet instead of a retry prompt.
        var waitsForConsent = false
        defer {
            isFinalizing = false
            aiGradingStartedAt = nil
            if !hasAssessmentResult, !message.isEmpty, !requiresLogin, !waitsForConsent {
                aiGradingFailure = .set
            }
            notifyLearningProgress(student)
        }

        if let attemptId = session?.teacherPaper?.attemptId {
            do {
                session?.teacherPaper = try await apiClient.submitTeacherPaper(for: student, attemptId: attemptId)
            } catch {
                handle(error)
                return
            }
        }

        // Keep a small, bounded queue; retain successful results if one request fails.
        var pending = questions.filter { results[$0.id] == nil }.makeIterator()
        var gradingError: Error?
        var failedQuestion: PracticeQuestion?
        let elapsedTimes = questionElapsedTimes
        await withTaskGroup(of: (PracticeQuestion, Result<SubmitAnswerResult, Error>).self) { group in
            func enqueue(_ question: PracticeQuestion) {
                let elapsed = elapsedTimes[question.id, default: 0]
                group.addTask {
                    do {
                        let result = try await self.gradeAnswer(for: question, student: student, elapsed: elapsed)
                        return (question, .success(result))
                    } catch { return (question, .failure(error)) }
                }
            }
            for _ in 0..<3 {
                if let question = pending.next() { enqueue(question) }
            }
            while let (question, outcome) = await group.next() {
                switch outcome {
                case let .success(result):
                    await acceptGradedResult(result, for: question, student: student)
                    assessmentGradingCompleted += 1
                case let .failure(error):
                    if gradingError == nil {
                        gradingError = error
                        failedQuestion = question
                    }
                }
                if gradingError == nil, let next = pending.next() { enqueue(next) }
            }
        }
        if let gradingError {
            waitsForConsent = gradingError is PrivacyConsentError
            handle(gradingError)
            if !requiresLogin {
                message = Self.assessmentGradingFailureMessage(
                    completed: assessmentGradingCompleted,
                    total: assessmentGradingTotal,
                    questionNumber: failedQuestion.flatMap { failed in
                        questions.firstIndex { $0.id == failed.id }.map { $0 + 1 }
                    },
                    reason: message
                )
            }
            return
        }

        // Set practice uses the same whole-set grading as the web,
        // with a local score summary rather than a diagnostic feedback request.
        if isSetPractice { return }

        let submittedAnswers = questions.compactMap { question -> SubmittedDiagnosticAnswer? in
            guard
                let result = results[question.id],
                let answerId = result.answerId
            else { return nil }
            return SubmittedDiagnosticAnswer(
                answerId: answerId,
                masteryUpdate: result.masteryUpdate
            )
        }
        guard submittedAnswers.count == questions.count else {
            message = "部分答案尚未完成云端批改，请重试评估结果。"
            return
        }

        do {
            switch workflow {
            case let .assessment(kpId):
                diagnosticResult = try await apiClient.submittedDiagnosticFeedback(
                    for: student,
                    kpId: kpId,
                    answers: submittedAnswers
                )
            case let .scopeDiagnostic(scopeType, scopeId, _):
                scopeDiagnosticResult = try await apiClient
                    .submittedScopeDiagnosticFeedback(
                        for: student,
                        scopeType: scopeType,
                        scopeId: scopeId,
                        answers: submittedAnswers
                    )
            case .learningCatalog, .teacherHomework:
                if isTeacherPaper {
                    try await refreshTeacherPaper(student: student)
                    guard teacherPaperCompleted else {
                        message = "答卷正在同步，请重试查看批改结果。"
                        return
                    }
                }
                updateLearningCatalogSummary()
            case let .improvementRetest(planId, attemptId):
                improvementRetestResult = try await apiClient
                    .submitImprovementRetestFeedback(
                        for: student,
                        planId: planId,
                        attemptId: attemptId,
                        answers: submittedAnswers
                    )
            case .practice, .kpPractice, .mixedPractice, .reviewRetry:
                return
            }
        } catch {
            handle(error)
            if !requiresLogin {
                message = isImprovementRetest ? "复测结果生成失败，请重试。" : "评估结果生成失败，请重试。"
            }
        }
    }

    func moveForward() {
        guard canGoForward else { return }
        currentIndex += 1
        questionStartedAt = Date()
        message = ""
    }

    func goToQuestion(_ index: Int) {
        guard
            let questions = session?.questions,
            questions.indices.contains(index),
            !isSubmitting,
            !isFinalizing
        else { return }
        if isAssessment, let question = currentQuestion {
            collectAssessmentDraftIfAvailable(question)
        }
        currentIndex = index
        if isAssessment {
            let question = questions[index]
            collectedQuestionIds.remove(question.id)
            selfReviewCollectedQuestionIds.remove(question.id)
        }
        questionStartedAt = Date()
        message = ""
    }

    func reopenCurrentAssessmentAnswer() {
        guard
            isAssessment,
            !hasAssessmentResult,
            !isSubmitting,
            !isFinalizing,
            let question = currentQuestion,
            results[question.id] == nil
        else { return }
        collectedQuestionIds.remove(question.id)
        selfReviewCollectedQuestionIds.remove(question.id)
        questionElapsedTimes[question.id] = nil
        message = ""
    }

    private func loadLearningCatalogTopic(
        student: StudentSession,
        context: LearningCatalogPracticeContext
    ) async -> Bool {
        guard StudentAccessPolicy.hasFullLearningAccess(student) else {
            message = StudentAccessPolicy.accountRequiredMessage
            return false
        }
        isLoading = true
        message = ""
        requiresLogin = false
        defer { isLoading = false }

        do {
            let loaded = try await apiClient.learningCatalogTopicSession(
                for: student,
                catalogCode: context.catalogCode,
                nodeId: context.nodeId,
                layer: context.layer,
                questionCount: context.questionCount
            )
            guard !loaded.questions.isEmpty else {
                message = "当前层级暂时没有可用题目。"
                return false
            }
            // Only replace prior work after the new practice has loaded successfully.
            if workflow.learningCatalogContext != context {
                pendingLearningCatalogAnswerIds = []
                learningCatalogOverview = nil
                evidenceSyncMessage = ""
            }
            prepare(loaded, workflow: .learningCatalog(context))
            return true
        } catch let APIError.http(statusCode, _) where statusCode == 404 {
            message = "当前层级暂时没有可用题目。"
            return false
        } catch {
            handle(error)
            return false
        }
    }

    private func prepare(
        _ loaded: PracticeSession,
        workflow: PracticeWorkflow
    ) {
        attemptId = UUID()
        session = loaded
        self.workflow = workflow
        currentIndex = 0
        answers = [:]
        results = [:]
        diagnosticResult = nil
        scopeDiagnosticResult = nil
        improvementRetestResult = nil
        reviewRetryCleared = false
        reviewRetryClearDetail = ""
        aiGradingFailure = nil
        learningCatalogSummary = nil
        collectedQuestionIds = []
        answerModes = [:]
        drawings = [:]
        drawingBackgroundImagePaths = [:]
        drawingBackgroundPlacements = [:]
        drawingCanvasSizes = [:]
        backgroundImageCache = [:]
        mediaDrafts = [:]
        selfReviewItems = Dictionary(
            uniqueKeysWithValues: loaded.questions
                .filter(\.supportsSelfReview)
                .map { ($0.id, $0.initialSelfReviewItems) }
        )
        submissionIds = [:]
        questionElapsedTimes = [:]
        selfReviewCollectedQuestionIds = []
        assessmentGradingCompleted = 0
        assessmentGradingTotal = 0
        questionStartedAt = Date()
        if loaded.teacherPaper != nil {
            results = loaded.answers ?? [:]
            answers = results.mapValues { $0.givenAnswer ?? $0.extractedAnswer ?? "" }
            if loaded.teacherPaper?.isCompleted == true { updateLearningCatalogSummary() }
            // A paper reopened after a partly failed grading resumes at the first question
            // still waiting for an answer, not at a question that is already graded.
            currentIndex = Self.teacherPaperResumeIndex(questions: loaded.questions, graded: Set(results.keys))
        }
    }

    static func teacherPaperResumeIndex(questions: [PracticeQuestion], graded: Set<String>) -> Int {
        questions.firstIndex { !graded.contains($0.id) } ?? 0
    }

    func refreshTeacherPaper(student: StudentSession) async throws {
        if case let .teacherHomework(attemptId, _) = workflow {
            let loaded = try await apiClient.teacherHomeworkSession(for: student, attemptId: attemptId)
            session = loaded
            results.merge(loaded.answers ?? [:]) { _, cloud in cloud }
            return
        }

    }

    private func notifyLearningProgress(_ student: StudentSession) {
        NotificationCenter.default.post(name: .studentLearningProgressChanged, object: student.token)
    }

    private func acceptGradedResult(
        _ result: SubmitAnswerResult,
        for question: PracticeQuestion,
        student: StudentSession
    ) async {
        results[question.id] = result
        if case let .reviewRetry(answerId) = workflow, reviewRoundOwner == student.token {
            var used = reviewRoundQuestionIds[answerId, default: []].filter { $0 != question.id }
            used.append(question.id)
            reviewRoundQuestionIds[answerId] = Array(used.suffix(200))
        }
        notifyLearningProgress(student)
        await synchronizeLearningCatalogEvidence(result, student: student)
        if
            isLearningCatalog,
            isComplete,
            !isAssessment || learningCatalogSummary != nil
        {
            updateLearningCatalogSummary()
        }
    }

    private func synchronizeLearningCatalogEvidence(
        _ result: SubmitAnswerResult,
        student: StudentSession
    ) async {
        guard
            let context = workflow.learningCatalogContext,
            let answerId = result.answerId
        else { return }

        await synchronizeLearningCatalogEvidence(
            answerId: answerId,
            context: context,
            student: student
        )
    }

    private func synchronizeLearningCatalogEvidence(
        answerId: Int,
        context: LearningCatalogPracticeContext,
        student: StudentSession
    ) async {

        do {
            learningCatalogOverview = try await apiClient
                .recordLearningCatalogTopicEvidence(
                    for: student,
                    catalogCode: context.catalogCode,
                    nodeId: context.nodeId,
                    layer: context.layer,
                    answerId: answerId
                )
            pendingLearningCatalogAnswerIds.remove(answerId)
        } catch {
            pendingLearningCatalogAnswerIds.insert(answerId)
        }
        evidenceSyncMessage = pendingLearningCatalogAnswerIds.isEmpty
            ? ""
            : "题目已完成批改，但有专题学习记录尚未同步；可以重试同步。"
    }

    private func updateLearningCatalogSummary() {
        guard isLearningCatalog, let questions = session?.questions else { return }
        let graded = questions.compactMap { results[$0.id] }
        guard graded.count == questions.count else { return }
        let totalCredit = graded.reduce(0.0) {
            $0 + learningCatalogCredit(for: $1)
        }
        let displayedCredit = (totalCredit * 10).rounded() / 10
        learningCatalogSummary = LearningCatalogPracticeSummary(
            correctCount: displayedCredit,
            totalCount: graded.count
        )
    }

    private func learningCatalogCredit(for result: SubmitAnswerResult) -> Double {
        if let score = result.processGrading?.score, let maximum = result.processGrading?.maxScore, maximum > 0 {
            return min(max(score / maximum, 0), 1)
        }
        if let processScore = result.processGrading?.processScore {
            return min(max(processScore / 100, 0), 1)
        }
        let stepScores = result.processGrading?.stepScores ?? []
        let maximum = stepScores.compactMap(\.maxScore).reduce(0, +)
        if maximum > 0 {
            let score = stepScores.compactMap(\.score).reduce(0, +)
            return min(max(score / maximum, 0), 1)
        }
        return result.isCorrect ? 1 : 0
    }

    private func collectAssessmentAnswer(question: PracticeQuestion) {
        selfReviewCollectedQuestionIds.remove(question.id)
        collectedQuestionIds.insert(question.id)
        questionElapsedTimes[question.id] = elapsedTimeForCurrentQuestion()
        message = ""
    }

    private func collectAssessmentDraftIfAvailable(_ question: PracticeQuestion) {
        guard hasAnswerDraft(for: question) else { return }
        if hasCompletedSelfReviewDraft(for: question) {
            selfReviewCollectedQuestionIds.insert(question.id)
        } else {
            selfReviewCollectedQuestionIds.remove(question.id)
        }
        collectedQuestionIds.insert(question.id)
        questionElapsedTimes[question.id] = elapsedTimeForCurrentQuestion()
    }

    private func collectAllAssessmentDrafts() {
        guard let questions = session?.questions else { return }
        for question in questions where hasAnswerDraft(for: question) {
            if hasCompletedSelfReviewDraft(for: question) {
                selfReviewCollectedQuestionIds.insert(question.id)
            } else {
                selfReviewCollectedQuestionIds.remove(question.id)
            }
            collectedQuestionIds.insert(question.id)
            if questionElapsedTimes[question.id] == nil {
                questionElapsedTimes[question.id] = question.id == currentQuestion?.id
                    ? elapsedTimeForCurrentQuestion()
                    : 0
            }
        }
    }

    private func hasCompletedSelfReviewDraft(for question: PracticeQuestion) -> Bool {
        guard question.supportsSelfReview else { return false }
        let items = selfReviewItems[question.id] ?? question.initialSelfReviewItems
        return !items.isEmpty && items.allSatisfy { $0.status != nil }
    }

    private func gradeAnswer(
        for question: PracticeQuestion,
        student: StudentSession,
        elapsed: Int
    ) async throws -> SubmitAnswerResult {
        if isAssessment, !collectedQuestionIds.contains(question.id) {
            return try await apiClient.submitAnswer(
                for: student,
                questionId: question.id,
                answer: "",
                timeSpentMs: elapsed,
                targetKnowledgePointId: question.targetKnowledgePointId,
                submissionId: submissionId(
                    for: "unanswered:\(question.id):empty"
                ),
                teacherPaperAttemptId: session?.teacherPaper?.attemptId,
                topicContext: question.topicContext,
                requiresAI: !question.isChoice
            )
        }

        if selfReviewCollectedQuestionIds.contains(question.id) {
            let items = selfReviewItems[question.id] ?? question.initialSelfReviewItems
            let itemKey = items.map {
                "\($0.label)=\($0.status?.rawValue ?? "wrong")"
            }.joined(separator: "|")
            return try await apiClient.submitSelfReview(
                for: student,
                questionId: question.id,
                items: items,
                timeSpentMs: elapsed,
                targetKnowledgePointId: question.targetKnowledgePointId,
                submissionId: submissionId(
                    for: "self-review:\(question.id):\(itemKey)"
                ),
                teacherPaperAttemptId: session?.teacherPaper?.attemptId,
                topicContext: question.topicContext
            )
        }

        let mode = answerModes[question.id] ?? .handwriting
        let answer = answerSummary(for: question)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if question.isChoice || mode == .text {
            let answerKey = payloadFingerprint(
                Data(answer.utf8)
            )
            var result = try await apiClient.submitAnswer(
                for: student,
                questionId: question.id,
                answer: answer,
                timeSpentMs: elapsed,
                targetKnowledgePointId: question.targetKnowledgePointId,
                submissionId: submissionId(
                    for: "answer:\(question.id):\(answerKey)"
                ),
                teacherPaperAttemptId: session?.teacherPaper?.attemptId,
                topicContext: question.topicContext,
                requiresAI: !question.isChoice
            )
            if
                question.isChoice,
                !result.isCorrect,
                let answerId = result.answerId,
                drawings[question.id]?.strokes.isEmpty == false
            {
                let media = try await exportDrawing(
                    for: question,
                    student: student
                )
                do {
                    let evidence = try await apiClient.submitProcessEvidence(
                        for: student,
                        questionId: question.id,
                        answerId: answerId,
                        media: media,
                        timeSpentMs: elapsed
                    )
                    result = result.replacingProcessGrading(evidence.processGrading)
                } catch is PrivacyConsentError {
                    // Optional scratch-work analysis must not discard objective grading.
                    return result
                }
            }
            return result
        }

        let media: AnswerMediaDraft
        switch mode {
        case .handwriting:
            media = try await exportDrawing(for: question, student: student)
        case .photo:
            guard let photo = mediaDrafts[question.id] else {
                throw AnswerDraftError.invalidImage
            }
            media = photo
        case .text:
            throw AnswerDraftError.invalidImage
        }
        let mediaKey = try mediaPayloadFingerprint(
            media,
            question: question
        )
        return try await apiClient.submitPhotoAnswer(
            for: student,
            questionId: question.id,
            media: media,
            timeSpentMs: elapsed,
            targetKnowledgePointId: question.targetKnowledgePointId,
            submissionId: submissionId(
                for: "media-\(mode.rawValue):\(question.id):\(mediaKey)"
            ),
            teacherPaperAttemptId: session?.teacherPaper?.attemptId,
            topicContext: question.topicContext
        )
    }

    private func exportDrawing(
        for question: PracticeQuestion,
        student: StudentSession
    ) async throws -> AnswerMediaDraft {
        let backgroundImage: UIImage?
        if let path = drawingBackgroundImagePaths[question.id] {
            backgroundImage = try await loadBackgroundImage(path)
        } else {
            backgroundImage = nil
        }
        return try draftFileStore.exportDrawing(
            drawings[question.id] ?? PKDrawing(),
            backgroundImage: backgroundImage,
            canvasSize: backgroundImage == nil
                ? nil
                : drawingCanvasSizes[question.id],
            backgroundPlacement: drawingBackgroundPlacements[question.id] ?? QuestionDrawingBackgroundPlacement(),
            studentId: student.studentID,
            questionId: question.id
        )
    }

    private func loadBackgroundImage(_ path: String) async throws -> UIImage {
        if let cached = backgroundImageCache[path] {
            return cached
        }
        guard let url = AppConfig.resolvedAssetURL(path) else {
            throw AnswerDraftError.backgroundImageUnavailable
        }
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            if
                let httpResponse = response as? HTTPURLResponse,
                !(200 ... 299).contains(httpResponse.statusCode)
            {
                throw AnswerDraftError.backgroundImageUnavailable
            }
            guard let image = UIImage(data: data) else {
                throw AnswerDraftError.backgroundImageUnavailable
            }
            backgroundImageCache[path] = image
            return image
        } catch is AnswerDraftError {
            throw AnswerDraftError.backgroundImageUnavailable
        } catch {
            throw AnswerDraftError.backgroundImageUnavailable
        }
    }

    private func completeReviewIfNeeded(
        result: SubmitAnswerResult,
        student: StudentSession
    ) async throws {
        guard
            case let .reviewRetry(answerId) = workflow,
            result.isCorrect
        else { return }
        applyReviewCompletion(try await apiClient.completeReview(
            for: student,
            answerId: answerId,
            retryAnswerId: result.answerId
        ))
        notifyLearningProgress(student)
    }

    private func applyReviewCompletion(_ response: CompleteReviewResponse) {
        reviewRetryCleared = response.cleared
        reviewRetryClearDetail = response.cleared
            ? "" : (response.detail?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "")
    }

    private func answerSummary(for question: PracticeQuestion) -> String {
        let answer = answers[question.id, default: ""]
        let mode = answerModes[question.id] ?? .handwriting
        if question.isChoice || mode == .text {
            return answer
        }
        switch mode {
        case .handwriting:
            return drawings[question.id]?.strokes.isEmpty == false
                ? "[手写作答]"
                : ""
        case .photo:
            return mediaDrafts[question.id] == nil ? "" : "[照片作答]"
        case .text:
            return answer
        }
    }

    private func elapsedTimeForCurrentQuestion() -> Int {
        max(0, Int(Date().timeIntervalSince(questionStartedAt) * 1_000))
    }

    private func submissionId(for logicalKey: String) -> String {
        if let existing = submissionIds[logicalKey] {
            return existing
        }
        let created = UUID().uuidString.lowercased()
        submissionIds[logicalKey] = created
        return created
    }

    private func mediaPayloadFingerprint(
        _ media: AnswerMediaDraft,
        question: PracticeQuestion
    ) throws -> String {
        switch media.kind {
        case .photo:
            return payloadFingerprint(try Data(contentsOf: media.fileURL))
        case .handwriting:
            var payload = drawings[question.id, default: PKDrawing()]
                .dataRepresentation()
            let metadata = [
                drawingBackgroundImagePaths[question.id] ?? "",
                drawingCanvasSizes[question.id].map {
                    "\($0.width)x\($0.height)"
                } ?? "",
                drawingBackgroundPlacements[question.id].map {
                    "\($0.offset.width),\($0.offset.height),\($0.zoom)"
                } ?? ""].joined(separator: "|")
            payload.append(Data(metadata.utf8))
            return payloadFingerprint(payload)
        }
    }

    private func payloadFingerprint(_ data: Data) -> String {
        SHA256.hash(data: data)
            .map { String(format: "%02x", $0) }
            .joined()
    }

    func clearAccountNotice() {
        if message == StudentAccessPolicy.accountRequiredMessage { message = "" }
    }

    /// Keeps the server's reason (an unreadable photo needs a retake, not a retry).
    static func assessmentGradingFailureMessage(
        completed: Int,
        total: Int,
        questionNumber: Int?,
        reason: String
    ) -> String {
        let progress = "已完成批改 \(completed)/\(total)。"
        guard let questionNumber else { return progress + reason }
        return progress + "第 \(questionNumber) 题：" + reason
    }

    private func handle(_ error: Error) {
        if let apiError = error as? APIError, apiError.isUnauthorized {
            requiresLogin = true
        }
        message = (error as? LocalizedError)?.errorDescription ?? "学习任务暂时不可用，请稍后重试。"
    }
}
