import Foundation

enum DiagnosticHistoryScope: Hashable {
    case all
    case chapter(String)

    var chapterName: String? {
        if case let .chapter(name) = self { return name }
        return nil
    }
}

@MainActor
final class ReinforcementStore: ObservableObject {
    @Published private(set) var directory: SyncDirectory?
    @Published private(set) var startData: ReinforcementStartData?
    @Published private(set) var latestPlan: ImprovementPlan?
    @Published private(set) var latestReport: ImprovementReport?
    @Published private(set) var diagnosticHistory: [ScopeDiagnosticAttemptListItem] = []
    @Published private(set) var diagnosticHistoryTotal = 0
    @Published private(set) var diagnosticHistoryScope = DiagnosticHistoryScope.all
    @Published private(set) var selectedDiagnosticAttempt: ScopeDiagnosticAttemptDetail?
    @Published private(set) var isLoading = false
    @Published private(set) var isUpdatingPlan = false
    @Published private(set) var isLoadingHistory = false
    @Published private(set) var isLoadingChapterSummary = false
    @Published private(set) var isLoadingDiagnosticAttempt = false
    @Published private(set) var diagnosticHistoryError = ""
    @Published private(set) var message = ""
    @Published private(set) var requiresActiveAccount = false
    @Published var selectedVolume = ""
    @Published var selectedChapterID = ""

    private let apiClient: APIClient
    private var loadedAccess: Bool?
    private var loadedStudentID: String?
    private var loadGeneration = 0
    private var historyGeneration = 0
    private var historyOwnerToken: String?
    private var historyOffset = 0
    private var chapterSummaryGeneration = 0

    init(apiClient: APIClient = APIClient()) {
        self.apiClient = apiClient
    }

    var chapterPlans: [ReinforcementChapterPlan] {
        guard let directory, let startData else { return [] }
        return directory.reinforcementChapterPlans(start: startData)
    }

    var visibleChapterPlans: [ReinforcementChapterPlan] {
        chapterPlans.filter { $0.volume == selectedVolume }
    }

    var selectedChapter: ReinforcementChapterPlan? {
        visibleChapterPlans.first { $0.id == selectedChapterID }
            ?? visibleChapterPlans.first
    }

    var selectedChapterPlan: ImprovementPlan? {
        guard let chapter = selectedChapter, let plan = latestPlan,
              plan.scopeType == "chapter", plan.scopeId == chapter.name else { return nil }
        return plan
    }

    var selectedChapterReport: ImprovementReport? {
        guard let chapter = selectedChapter, let report = latestReport,
              report.summary.scopeType == "chapter", report.summary.scopeId == chapter.name else { return nil }
        if let plan = selectedChapterPlan, report.summary.planId != plan.id { return nil }
        return report
    }

    var selectedChapterShowsPlanCard: Bool {
        guard let plan = selectedChapterPlan else { return false }
        return !plan.isCompleted || selectedChapterReport == nil
    }

    var hasMoreDiagnosticHistory: Bool { historyOffset < diagnosticHistoryTotal }

    func load(student: StudentSession, force: Bool = false) async {
        let fullAccess = StudentAccessPolicy.hasFullLearningAccess(student)
        if directory != nil, startData != nil, !force,
           loadedStudentID == student.studentID, loadedAccess == fullAccess { return }
        loadGeneration += 1
        let generation = loadGeneration
        isLoading = true
        message = ""
        requiresActiveAccount = !fullAccess
        defer { if generation == loadGeneration { isLoading = false } }

        do {
            // The browsable directory must not depend on a unavailable-account request.
            let loadedDirectory = try await apiClient.directory(for: student)
            guard generation == loadGeneration, !Task.isCancelled else { return }
            directory = loadedDirectory
            var loadedStart = ReinforcementStartData(isFirstTime: true, hasDiagnosed: false, recommendedKps: [])
            startData = loadedStart
            if fullAccess {
                do {
                    loadedStart = try await apiClient.reinforcementStart(for: student)
                } catch {
                    guard generation == loadGeneration, !Task.isCancelled else { return }
                    if (error as? APIError)?.isAccountUnavailable == true {
                        requiresActiveAccount = true
                    } else {
                        handle(error, fallback: "目录已加载，推荐路径暂不可用，请重试。")
                    }
                }
            }
            guard generation == loadGeneration, !Task.isCancelled else { return }
            startData = loadedStart

            async let planRequest = try? apiClient.latestImprovementPlan(for: student)
            async let reportRequest = try? apiClient.latestCompletedImprovementReport(for: student)
            let (plan, report) = await (planRequest, reportRequest)
            guard generation == loadGeneration, !Task.isCancelled else { return }
            if let plan { latestPlan = plan }
            if let report { latestReport = report }
            loadedStudentID = student.studentID
            loadedAccess = fullAccess

            let plans = loadedDirectory.reinforcementChapterPlans(start: loadedStart)
            let preferred = loadedDirectory.preferredReinforcementChapter(
                in: plans,
                start: loadedStart
            )
            if let selected = plans.first(where: { $0.id == selectedChapterID }) {
                selectedVolume = selected.volume
            } else {
                selectedVolume = preferred?.volume ?? plans.first?.volume ?? ""
                selectedChapterID = preferred?.id ?? plans.first?.id ?? ""
            }
            ensureValidSelection()
        } catch {
            guard generation == loadGeneration, !Task.isCancelled else { return }
            handle(error, fallback: "巩固提升路径加载失败，请稍后重试。")
        }
    }

    func selectVolume(_ volume: String) {
        selectedVolume = volume
        selectedChapterID = visibleChapterPlans.first?.id ?? ""
    }

    func selectChapter(_ plan: ReinforcementChapterPlan) {
        selectedVolume = plan.volume
        selectedChapterID = plan.id
    }

    func loadSelectedChapterSummary(student: StudentSession) async {
        guard let chapter = selectedChapter else { return }
        chapterSummaryGeneration += 1
        let generation = chapterSummaryGeneration
        isLoadingChapterSummary = true
        defer { if generation == chapterSummaryGeneration { isLoadingChapterSummary = false } }
        do {
            async let plan = apiClient.latestImprovementPlan(
                for: student, scopeType: "chapter", scopeId: chapter.name
            )
            async let report = apiClient.latestCompletedImprovementReport(
                for: student, scopeType: "chapter", scopeId: chapter.name
            )
            let (loadedPlan, loadedReport) = try await (plan, report)
            guard generation == chapterSummaryGeneration, selectedChapter?.id == chapter.id,
                  !Task.isCancelled else { return }
            latestPlan = loadedPlan
            latestReport = loadedReport
            message = ""
        } catch {
            guard generation == chapterSummaryGeneration, selectedChapter?.id == chapter.id,
                  !Task.isCancelled else { return }
            handle(error, fallback: "本单元最近检测结果暂时无法加载，请刷新重试。")
        }
    }

    func createPlan(
        from result: ScopeDiagnosticResult,
        student: StudentSession
    ) async {
        isUpdatingPlan = true
        message = ""
        defer { isUpdatingPlan = false }
        do {
            latestPlan = try await apiClient.createImprovementPlan(
                for: student,
                diagnosticResult: result
            )
        } catch {
            handle(error, fallback: "检测已完成，但提升路径生成失败，请稍后重试。")
        }
    }

    func startTask(
        _ task: ImprovementTask,
        plan: ImprovementPlan,
        student: StudentSession,
        practiceStore: PracticeStore
    ) async -> Bool {
        isUpdatingPlan = true
        message = ""
        defer { isUpdatingPlan = false }
        do {
            let updated = try await apiClient.updateImprovementTaskStatus(
                for: student,
                planId: plan.id,
                taskId: task.id,
                status: "in_progress"
            )
            latestPlan = updated
            return await practiceStore.start(
                student: student,
                kpId: task.kpId,
                count: 3
            )
        } catch {
            handle(error, fallback: "专项练习准备失败，请稍后重试。")
            return false
        }
    }

    func completeTask(
        planId: String,
        taskId: String,
        student: StudentSession
    ) async {
        isUpdatingPlan = true
        message = ""
        defer { isUpdatingPlan = false }
        do {
            let practiced = try await apiClient.updateImprovementTaskStatus(
                for: student,
                planId: planId,
                taskId: taskId,
                status: "practiced"
            )
            latestPlan = practiced
            do {
                latestPlan = try await apiClient.moveToNextImprovementTask(
                    for: student,
                    planId: planId
                )
            } catch {
                latestPlan = practiced
            }
        } catch {
            handle(error, fallback: "练习已完成，但提升进度同步失败，请稍后刷新。")
        }
    }

    func acceptRetestResult(_ result: ImprovementRetestResult) {
        latestPlan = result.plan
    }

    func loadDiagnosticHistory(
        student: StudentSession,
        scope: DiagnosticHistoryScope? = nil,
        reset: Bool = true
    ) async {
        let scope = scope ?? diagnosticHistoryScope
        let shouldReset = reset || scope != diagnosticHistoryScope || historyOwnerToken != student.token
        guard shouldReset || !isLoadingHistory else { return }
        historyGeneration += 1
        let generation = historyGeneration
        if shouldReset {
            diagnosticHistoryScope = scope
            historyOwnerToken = student.token
            diagnosticHistory = []
            diagnosticHistoryTotal = 0
            historyOffset = 0
            selectedDiagnosticAttempt = nil
        }
        isLoadingHistory = true
        diagnosticHistoryError = ""
        let offset = historyOffset
        defer { if generation == historyGeneration { isLoadingHistory = false } }
        do {
            let response = try await apiClient.scopeDiagnosticAttempts(
                for: student,
                scopeType: scope.chapterName == nil ? nil : "chapter",
                scopeId: scope.chapterName,
                limit: 10,
                offset: offset
            )
            guard generation == historyGeneration, !Task.isCancelled else { return }
            if shouldReset {
                diagnosticHistory = response.items
            } else {
                let existing = Set(diagnosticHistory.map(\.attemptId))
                diagnosticHistory.append(
                    contentsOf: response.items.filter {
                        !existing.contains($0.attemptId)
                    }
                )
            }
            diagnosticHistoryTotal = response.total
            historyOffset = response.offset + response.items.count
        } catch {
            guard generation == historyGeneration, !Task.isCancelled else { return }
            diagnosticHistoryError =
                (error as? LocalizedError)?.errorDescription
                ?? "检测历史加载失败，请稍后重试。"
        }
    }

    func loadDiagnosticAttempt(
        id: String,
        student: StudentSession
    ) async {
        guard !isLoadingDiagnosticAttempt else { return }
        isLoadingDiagnosticAttempt = true
        diagnosticHistoryError = ""
        defer { isLoadingDiagnosticAttempt = false }
        do {
            selectedDiagnosticAttempt = try await apiClient.scopeDiagnosticAttempt(
                for: student,
                attemptId: id
            )
        } catch {
            diagnosticHistoryError =
                (error as? LocalizedError)?.errorDescription
                ?? "检测结果加载失败，请稍后重试。"
        }
    }

    func clearSelectedDiagnosticAttempt() {
        selectedDiagnosticAttempt = nil
        diagnosticHistoryError = ""
    }

    func loadLinkedPlan(
        id: String,
        reportAvailable: Bool,
        student: StudentSession
    ) async -> Bool {
        guard !isUpdatingPlan else { return false }
        isUpdatingPlan = true
        diagnosticHistoryError = ""
        defer { isUpdatingPlan = false }
        do {
            let plan = try await apiClient.improvementPlan(
                for: student,
                planId: id
            )
            latestPlan = plan
            latestReport = nil
            if reportAvailable {
                latestReport = try? await apiClient.improvementReport(
                    for: student,
                    planId: id
                )
            }
            return true
        } catch {
            diagnosticHistoryError =
                (error as? LocalizedError)?.errorDescription
                ?? "对应提升路径加载失败，请稍后重试。"
            return false
        }
    }

    private func ensureValidSelection() {
        guard !chapterPlans.isEmpty else {
            selectedVolume = ""
            selectedChapterID = ""
            return
        }
        if !chapterPlans.contains(where: { $0.volume == selectedVolume }) {
            selectedVolume = chapterPlans[0].volume
        }
        if !visibleChapterPlans.contains(where: { $0.id == selectedChapterID }) {
            selectedChapterID = visibleChapterPlans.first?.id ?? ""
        }
    }

    private func handle(_ error: Error, fallback: String) {
        message = (error as? LocalizedError)?.errorDescription ?? fallback
    }
}
