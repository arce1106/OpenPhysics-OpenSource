import Foundation

extension Notification.Name {
    static let studentLearningProgressChanged = Notification.Name("studentLearningProgressChanged")
}

@MainActor
final class SyncLearningStore: ObservableObject {
    @Published private(set) var directory: SyncDirectory?
    @Published private(set) var isLoading = false
    @Published private(set) var message = ""
    @Published var selectedVolume = ""
    @Published var selectedChapter: SyncChapter?
    @Published var selectedKnowledgePoint: SyncKnowledgePoint?
    @Published var showsKnowledgePointDetail = false

    private let apiClient: APIClient
    private var owner: StudentSession?
    private var generation = UUID()
    private var refreshVersion = 0
    private var refreshTask: Task<Void, Never>?
    private var progressTask: Task<Void, Never>?
    private var progressObserver: NSObjectProtocol?

    init(apiClient: APIClient = APIClient()) {
        self.apiClient = apiClient
        progressObserver = NotificationCenter.default.addObserver(
            forName: .studentLearningProgressChanged, object: nil, queue: .main
        ) { [weak self] notification in
            guard let token = notification.object as? String else { return }
            Task { @MainActor [weak self] in
                guard let self, let student = self.owner, student.token == token else { return }
                self.progressTask?.cancel()
                self.progressTask = Task { [weak self] in
                    do { try await Task.sleep(nanoseconds: 150_000_000) } catch { return }
                    guard let self, self.owner?.token == token else { return }
                    await self.load(student: student, force: true)
                }
            }
        }
    }

    deinit {
        if let progressObserver { NotificationCenter.default.removeObserver(progressObserver) }
        refreshTask?.cancel()
        progressTask?.cancel()
    }

    func load(student: StudentSession, force: Bool = false) async {
        if owner?.token != student.token {
            generation = UUID()
            refreshTask?.cancel()
            progressTask?.cancel()
            refreshTask = nil
            directory = nil
            selectedKnowledgePoint = nil
            selectedChapter = nil
            selectedVolume = ""
            showsKnowledgePointDetail = false
        }
        owner = student
        if !force, directory != nil { return }
        refreshVersion += 1
        if let refreshTask {
            await refreshTask.value
            return
        }
        isLoading = true
        message = ""
        let requestGeneration = generation
        let task = Task { await self.refresh(student: student, generation: requestGeneration) }
        refreshTask = task
        await task.value
    }

    private func refresh(student: StudentSession, generation requestGeneration: UUID) async {
        defer {
            if generation == requestGeneration {
                isLoading = false
                refreshTask = nil
            }
        }
        var failures = 0
        while !Task.isCancelled, generation == requestGeneration {
            let version = refreshVersion
            do {
                let raw = try await apiClient.directory(for: student)
                let accessible = StudentAccessPolicy.hasFullLearningAccess(student)
                    ? raw.kps.filter { !$0.contentPending } : []
                var judgments: [KnowledgeMasteryJudgment] = []
                var judgmentFailed = false
                do { judgments = try await apiClient.masteryJudgments(for: student, kpIds: accessible.map(\.id)) }
                catch { judgmentFailed = true }
                guard !Task.isCancelled, generation == requestGeneration else { return }
                // A submission during this request needs a newer snapshot, not the older response.
                if version != refreshVersion { failures = 0; continue }
                if judgmentFailed, failures == 0 {
                    failures += 1
                    try? await Task.sleep(nanoseconds: 500_000_000)
                    continue
                }
                let byId = Dictionary(judgments.map { ($0.kpId, $0) }, uniquingKeysWith: { _, latest in latest })
                let loaded = SyncDirectory(kps: raw.kps.map { point in
                    var updated = point; updated.judgment = byId[point.id]; return updated
                }, stats: raw.stats, relations: raw.relations)
                directory = loaded
                message = judgmentFailed ? "掌握度已读取，掌握证据暂未更新，可点击刷新重试。" : ""
                if let selected = selectedKnowledgePoint,
                   let updated = loaded.kps.first(where: { $0.id == selected.id }),
                   let volume = updated.volume {
                    selectedVolume = volume
                    selectedChapter = loaded.chapters(in: volume).first { $0.name == updated.chapter }
                    selectedKnowledgePoint = updated
                } else if let chapter = selectedChapter,
                          let updated = loaded.chapters(in: chapter.volume).first(where: { $0.id == chapter.id }) {
                    selectedChapter = updated
                    selectedKnowledgePoint = loaded.recommendedKnowledgePoint(in: updated.knowledgePoints)
                } else if let initial = loaded.initialSelection {
                    selectedVolume = initial.volume
                    selectedChapter = initial.chapter
                    selectedKnowledgePoint = initial.point
                }
                return
            } catch {
                guard !Task.isCancelled, generation == requestGeneration else { return }
                if version != refreshVersion { failures = 0; continue }
                if failures == 0 {
                    failures += 1
                    try? await Task.sleep(nanoseconds: 500_000_000)
                    continue
                }
                message = (error as? LocalizedError)?.errorDescription ?? "学习进度刷新失败，请点击刷新重试。"
                return
            }
        }
    }

    func selectVolume(_ volume: String) {
        guard let directory else { return }
        selectedVolume = volume
        selectedChapter = directory.recommendedChapter(in: volume)
        selectedKnowledgePoint = selectedChapter.flatMap {
            directory.recommendedKnowledgePoint(in: $0.knowledgePoints)
        }
        showsKnowledgePointDetail = false
    }

    func selectChapter(_ chapter: SyncChapter) {
        guard let directory else { return }
        selectedChapter = chapter
        selectedKnowledgePoint = directory.recommendedKnowledgePoint(in: chapter.knowledgePoints)
        showsKnowledgePointDetail = false
    }

    func selectKnowledgePoint(_ point: SyncKnowledgePoint) {
        selectedKnowledgePoint = point
        showsKnowledgePointDetail = true
    }
}

@MainActor
final class KnowledgeLearningStore: ObservableObject {
    @Published private(set) var bundle: LearnBundle?
    @Published private(set) var isLoading = false
    @Published private(set) var isCompleting = false
    @Published private(set) var message = ""
    @Published private(set) var videos: LearningVideoRecommendationResponse?
    @Published private(set) var isLoadingVideos = false
    @Published private(set) var videoMessage = ""
    @Published private(set) var tutorMessages: [LearningChatMessage] = []
    @Published private(set) var tutorStreamText = ""
    @Published private(set) var isTutorResponding = false
    @Published private(set) var tutorMessage = ""
    @Published private(set) var requiresActiveAccount = false

    /// Clears the "not authorised" notice once AI consent has been given.
    func clearPrivacyNotice() {
        if tutorMessage == PrivacyConsentError.required.errorDescription { tutorMessage = "" }
    }

    private let apiClient: APIClient
    private var startedAt = Date()
    private var loadedTutorKey = ""

    init(apiClient: APIClient = APIClient()) {
        self.apiClient = apiClient
    }

    func load(student: StudentSession, kpId: String) async {
        isLoading = true
        message = ""
        requiresActiveAccount = false
        startedAt = Date()
        defer { isLoading = false }
        do {
            bundle = try await apiClient.learnBundle(for: student, kpId: kpId)
            prepareTutorHistory(student: student, kpId: kpId)
        } catch {
            // A 402 is a locked point, not a failed load: the view shows 账号状态, not 重新加载.
            if (error as? APIError)?.isAccountUnavailable == true {
                requiresActiveAccount = true
                return
            }
            message = (error as? LocalizedError)?.errorDescription
                ?? "知识卡加载失败，请稍后重试。"
        }
    }

    func loadVideos(student: StudentSession, kpId: String) async {
        if videos?.kpId == kpId { return }
        isLoadingVideos = true
        videoMessage = ""
        defer { isLoadingVideos = false }
        do {
            videos = try await apiClient.learningVideos(
                for: student,
                kpId: kpId
            )
        } catch {
            videoMessage = (error as? LocalizedError)?.errorDescription
                ?? "视频讲解加载失败，请稍后重试。"
        }
    }

    func sendTutorMessage(
        _ rawMessage: String,
        student: StudentSession,
        kpId: String
    ) async {
        let text = rawMessage.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isTutorResponding else { return }

        prepareTutorHistory(student: student, kpId: kpId)
        let history = tutorMessages
        tutorMessages.append(
            LearningChatMessage(role: "user", content: text)
        )
        persistTutorHistory(student: student, kpId: kpId)
        isTutorResponding = true
        tutorStreamText = ""
        tutorMessage = ""
        defer {
            isTutorResponding = false
            tutorStreamText = ""
        }

        do {
            let response = try await apiClient.streamLearningChat(
                for: student,
                kpId: kpId,
                message: text,
                history: history
            ) { [weak self] chunk in
                await MainActor.run {
                    self?.tutorStreamText += chunk
                }
            }
            guard !response.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                tutorMessage = "AI 助教暂时没有返回内容，请稍后重试。"
                return
            }
            tutorMessages.append(
                LearningChatMessage(role: "assistant", content: response)
            )
            persistTutorHistory(student: student, kpId: kpId)
        } catch {
            if error is PrivacyConsentError {
                tutorMessages = history
                persistTutorHistory(student: student, kpId: kpId)
            }
            tutorMessage = (error as? LocalizedError)?.errorDescription
                ?? "这次没有连上 AI 助教，请稍后重试。"
        }
    }

    func complete(student: StudentSession) async -> Bool {
        guard let card = bundle?.card, !card.consumed else { return true }
        isCompleting = true
        message = ""
        defer { isCompleting = false }
        do {
            let elapsed = max(0, Int(Date().timeIntervalSince(startedAt)))
            let response = try await apiClient.completeLearning(
                for: student,
                kpId: card.kpId,
                contentId: card.contentId,
                timeSpentSeconds: elapsed
            )
            guard response.success else {
                message = "学习进度同步失败，请稍后重试。"
                return false
            }
            bundle = try await apiClient.learnBundle(for: student, kpId: card.kpId)
            return true
        } catch {
            message = (error as? LocalizedError)?.errorDescription
                ?? "学习进度同步失败，请稍后重试。"
            return false
        }
    }

    private func prepareTutorHistory(
        student: StudentSession,
        kpId: String
    ) {
        guard !LocalAccountPrivacy.isErased(student.studentID) else { tutorMessages = []; return }
        let key = tutorStorageKey(student: student, kpId: kpId)
        guard loadedTutorKey != key else { return }
        loadedTutorKey = key
        tutorStreamText = ""
        tutorMessage = ""
        guard
            let data = UserDefaults.standard.data(forKey: key),
            let decoded = try? JSONDecoder().decode(
                [LearningChatMessage].self,
                from: data
            )
        else {
            tutorMessages = []
            return
        }
        tutorMessages = Array(decoded.suffix(30))
    }

    private func persistTutorHistory(
        student: StudentSession,
        kpId: String
    ) {
        guard !LocalAccountPrivacy.isErased(student.studentID) else { return }
        let messages = Array(tutorMessages.suffix(30))
        guard let data = try? JSONEncoder().encode(messages) else { return }
        UserDefaults.standard.set(
            data,
            forKey: tutorStorageKey(student: student, kpId: kpId)
        )
    }

    private func tutorStorageKey(
        student: StudentSession,
        kpId: String
    ) -> String {
        "openphysics.learn-chat.v3.\(student.studentID).\(kpId)"
    }
}
