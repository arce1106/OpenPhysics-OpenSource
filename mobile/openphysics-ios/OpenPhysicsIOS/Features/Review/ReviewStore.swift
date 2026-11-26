import Foundation

@MainActor
final class ReviewStore: ObservableObject {
    @Published private(set) var data: ReviewData?
    @Published private(set) var details: [Int: ReviewMistake] = [:]
    @Published private(set) var isLoading = false
    @Published private(set) var loadingDetailAnswerId: Int?
    @Published private(set) var tutorMessages: [LearningChatMessage] = []
    @Published private(set) var isTutorResponding = false
    @Published var tutorMessage = ""
    @Published var message = ""
    @Published private(set) var requiresLogin = false

    private let apiClient: APIClient
    private var tutorAnswerId: Int?
    private var notebookLoad: Task<Void, Never>?
    private var owner: StudentSession?
    private var refreshVersion = 0
    private var generation = UUID()
    private var progressObserver: NSObjectProtocol?

    init(apiClient: APIClient = APIClient()) {
        self.apiClient = apiClient
        progressObserver = NotificationCenter.default.addObserver(
            forName: .studentLearningProgressChanged, object: nil, queue: .main
        ) { [weak self] notification in
            guard let token = notification.object as? String else { return }
            Task { @MainActor [weak self] in
                guard let self, let student = self.owner, student.token == token else { return }
                await self.refreshAfterReview(student: student)
            }
        }
    }

    deinit {
        if let progressObserver { NotificationCenter.default.removeObserver(progressObserver) }
        notebookLoad?.cancel()
    }

    func load(student: StudentSession, force: Bool = false) async {
        if owner?.token != student.token {
            generation = UUID()
            notebookLoad?.cancel()
            notebookLoad = nil
            data = nil
            details = [:]
            tutorAnswerId = nil
            tutorMessages = []
        }
        owner = student
        if !force, data != nil { return }
        refreshVersion += 1
        if let running = notebookLoad {
            await running.value
            return
        }
        let requestGeneration = generation
        // The owning store keeps the request alive when a tab is temporarily hidden.
        let load = Task { await self.fetchNotebook(student: student, generation: requestGeneration) }
        notebookLoad = load
        await load.value
    }

    private func fetchNotebook(student: StudentSession, generation requestGeneration: UUID) async {
        isLoading = true
        message = ""
        requiresLogin = false
        defer {
            if generation == requestGeneration { isLoading = false; notebookLoad = nil }
        }
        var failures = 0
        while !Task.isCancelled, generation == requestGeneration {
            let version = refreshVersion
            do {
                let loaded = try await apiClient.reviewNotebook(for: student)
                guard !Task.isCancelled, generation == requestGeneration else { return }
                if version != refreshVersion { failures = 0; continue }
                data = loaded
                return
            } catch {
                guard !Task.isCancelled, generation == requestGeneration else { return }
                if version != refreshVersion { failures = 0; continue }
                if let error = error as? APIError, error.isTransport, !error.isCancellation, failures == 0 {
                    failures += 1
                    try? await Task.sleep(nanoseconds: 500_000_000)
                    continue
                }
                handle(error, fallback: "错题本加载失败，请稍后重试。")
                return
            }
        }
    }

    func detail(
        for summary: ReviewMistake,
        student: StudentSession
    ) async -> ReviewMistake? {
        if let cached = details[summary.answerId] {
            return cached
        }
        loadingDetailAnswerId = summary.answerId
        message = ""
        defer { loadingDetailAnswerId = nil }

        do {
            let loaded = try await apiClient.reviewMistake(
                for: student,
                answerId: summary.answerId
            )
            details[summary.answerId] = loaded
            return loaded
        } catch {
            handle(error, fallback: "这道错题暂时无法打开，请稍后重试。")
            return nil
        }
    }

    func refreshAfterReview(student: StudentSession) async {
        details = [:]
        await load(student: student, force: true)
    }

    func prepareTutor(for answerId: Int) {
        guard tutorAnswerId != answerId else { return }
        tutorAnswerId = answerId
        tutorMessages = []
        tutorMessage = ""
    }

    func sendTutorMessage(
        _ rawMessage: String,
        mistake: ReviewMistake,
        student: StudentSession
    ) async {
        let text = rawMessage.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isTutorResponding else { return }

        prepareTutor(for: mistake.answerId)
        let history = tutorMessages
        tutorMessages.append(
            LearningChatMessage(role: "user", content: text)
        )
        isTutorResponding = true
        tutorMessage = ""
        defer { isTutorResponding = false }

        do {
            let response = try await apiClient.questionTutorChat(
                for: student,
                questionId: mistake.questionId,
                givenAnswer: mistake.givenAnswer ?? "",
                message: text,
                history: history,
                processGrading: mistake.processGrading
            )
            let answer = response.trimmingCharacters(
                in: .whitespacesAndNewlines
            )
            guard !answer.isEmpty else {
                tutorMessage = "AI 助教暂时没有返回内容，请稍后重试。"
                return
            }
            tutorMessages.append(
                LearningChatMessage(role: "assistant", content: answer)
            )
        } catch {
            if error is PrivacyConsentError { tutorMessages = history }
            if let apiError = error as? APIError, apiError.isUnauthorized {
                requiresLogin = true
            }
            tutorMessage = (error as? LocalizedError)?.errorDescription
                ?? "这次没有连上 AI 助教，请稍后重试。"
        }
    }

    private func handle(_ error: Error, fallback: String) {
        // Leaving a page cancels its requests; that is not a network failure to report.
        if error is CancellationError || (error as? APIError)?.isCancellation == true { return }
        if let apiError = error as? APIError, apiError.isUnauthorized {
            requiresLogin = true
        }
        message = (error as? LocalizedError)?.errorDescription ?? fallback
    }
}
