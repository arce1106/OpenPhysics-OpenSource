import Foundation

@MainActor
final class AppSession: ObservableObject {
    @Published private(set) var studentSession: StudentSession?
    @Published private(set) var dashboard: DashboardData?
    @Published private(set) var dailyLearningLoop: DailyLearningLoop?
    @Published private(set) var dailyLearningLoopHistory: DailyLearningLoopHistory?
    @Published private(set) var growthReport: GrowthReportData?
    @Published private(set) var isRestoring = true
    @Published private(set) var isWorking = false
    @Published private(set) var isLoadingDailyLearningLoopHistory = false
    @Published private(set) var isRefreshingGrowthReport = false
    @Published private(set) var dailyLearningLoopHistoryError = ""
    @Published var message = ""
    @Published var showsPracticeExitConfirmation = false
    @Published var showsAccountNotice = false
    /// After signing in with a teacher's invitation: whether the class was joined. Shown once on home.
    @Published var classJoinNotice = ""
    @Published private(set) var homeNavigationToken = 0
    weak var activePractice: PracticeStore?
    private var pendingNavigation: (() -> Void)?

    private let apiClient: APIClient
    private let sessionStore: SessionStoring
    private var isRefreshingStudentSession = false
    private var progressObserver: NSObjectProtocol?
    private var dashboardRefreshTask: Task<Void, Never>?
    private var dashboardRequestID = UUID()
    private var dashboardOwnerToken: String?
    private var dashboardRefreshVersion = 0

    init(
        apiClient: APIClient = APIClient(),
        sessionStore: SessionStoring = KeychainSessionStore()
    ) {
        self.apiClient = apiClient
        self.sessionStore = sessionStore
        progressObserver = NotificationCenter.default.addObserver(
            forName: .studentLearningProgressChanged, object: nil, queue: .main
        ) { [weak self] notification in
            guard let token = notification.object as? String else { return }
            Task { @MainActor [weak self] in
                guard let self, self.studentSession?.token == token else { return }
                self.dailyLearningLoopHistory = nil
                await self.refreshDashboard()
            }
        }
    }

    deinit {
        if let progressObserver { NotificationCenter.default.removeObserver(progressObserver) }
        dashboardRefreshTask?.cancel()
    }

    func restore() async {
        // A fresh process starts at home; temporary ink/photo files are not a saved attempt.
        AnswerDraftFileStore().removeAllDrafts()
        defer { isRestoring = false }
        do {
            studentSession = try sessionStore.readSession()
            if studentSession != nil {
                await refreshStudentSession()
                if studentSession != nil {
                    await refreshDashboard()
                }
            }
        } catch {
            message = "本机会话无法读取，请重新登录。"
            try? sessionStore.clearSession()
            studentSession = nil
        }
    }

    func refreshStudentSession() async {
        guard let current = studentSession, !isRefreshingStudentSession else { return }
        isRefreshingStudentSession = true
        defer { isRefreshingStudentSession = false }
        do {
            let refreshed = try await apiClient.currentStudent(for: current)
            guard studentSession?.token == current.token else { return }
            try sessionStore.saveSession(refreshed)
            studentSession = refreshed
        } catch {
            guard studentSession?.token == current.token else { return }
            if let apiError = error as? APIError, apiError.isUnauthorized {
                logout(message: apiError.errorDescription ?? "登录已失效。")
            }
        }
    }

    func refreshAccess(for rejectedToken: String) async {
        guard let current = studentSession, current.token == rejectedToken else { return }
        let restricted = current.withAccountActive(false)
        try? sessionStore.saveSession(restricted)
        studentSession = restricted
        await refreshStudentSession()
    }



    func login(username: String, password: String) async {
        let trimmedUsername = username.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedUsername.isEmpty, !password.isEmpty else {
            message = "请输入用户名和密码。"
            return
        }

        isWorking = true
        message = ""
        defer { isWorking = false }
        do {
            let authenticatedSession = try await apiClient.login(
                username: trimmedUsername,
                password: password
            )
            try sessionStore.saveSession(authenticatedSession)
            studentSession = authenticatedSession
            dailyLearningLoopHistory = nil
            dailyLearningLoopHistoryError = ""
            await refreshDashboard()
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "登录失败，请稍后重试。"
        }
    }

    func refreshDashboard() async {
        guard let student = studentSession else { return }
        dashboardRefreshVersion += 1
        if let running = dashboardRefreshTask, dashboardOwnerToken == student.token {
            await running.value
            return
        }
        dashboardRefreshTask?.cancel()
        dashboardOwnerToken = student.token
        let requestID = UUID()
        dashboardRequestID = requestID
        isWorking = true
        let task = Task { await self.fetchDashboard(student: student, requestID: requestID) }
        dashboardRefreshTask = task
        await task.value
    }

    private func fetchDashboard(student: StudentSession, requestID: UUID) async {
        defer {
            if dashboardRequestID == requestID {
                dashboardRefreshTask = nil
                isWorking = false
            }
        }
        while !Task.isCancelled, studentSession?.token == student.token {
            let version = dashboardRefreshVersion
            do {
                async let dashboardRequest = apiClient.dashboard(for: student)
                async let loopRequest = try? apiClient.dailyLearningLoop(for: student)
                async let growthRequest = try? loadGrowthReport(for: student)
                let (loadedDashboard, loadedLoop, loadedGrowth) = try await (dashboardRequest, loopRequest, growthRequest)
                guard !Task.isCancelled, studentSession?.token == student.token else { return }
                // A grade completed during this request: fetch a newer snapshot before publishing.
                if version != dashboardRefreshVersion { continue }
                dashboard = loadedDashboard
                dailyLearningLoop = loadedLoop
                growthReport = loadedGrowth
                message = ""
                return
            } catch {
                guard !Task.isCancelled, studentSession?.token == student.token else { return }
                if version != dashboardRefreshVersion { continue }
                if let apiError = error as? APIError, apiError.isUnauthorized {
                    logout(message: apiError.errorDescription ?? "登录已失效。")
                } else {
                    message = (error as? LocalizedError)?.errorDescription ?? "首页加载失败，请稍后重试。"
                }
                return
            }
        }
    }

    func acceptAuthentication(_ session: StudentSession, privacyReceipt: PrivacyConsentState? = nil) async throws {
        try sessionStore.saveSession(session)
        if let privacyReceipt {
            PrivacyConsentCenter.shared.acceptLoginReceipt(privacyReceipt, token: session.token)
        }
        studentSession = session
        message = ""
        await refreshDashboard()
    }

    func loadDailyLearningLoopHistory(force: Bool = false) async {
        guard
            let studentSession,
            !isLoadingDailyLearningLoopHistory,
            force || dailyLearningLoopHistory == nil
        else {
            return
        }

        isLoadingDailyLearningLoopHistory = true
        dailyLearningLoopHistoryError = ""
        defer { isLoadingDailyLearningLoopHistory = false }

        let version = dashboardRefreshVersion
        do {
            let history = try await apiClient.dailyLearningLoopHistory(
                for: studentSession,
                days: 35
            )
            guard self.studentSession?.token == studentSession.token,
                  version == dashboardRefreshVersion else { return }
            dailyLearningLoopHistory = history
        } catch {
            guard self.studentSession?.token == studentSession.token else { return }
            if let apiError = error as? APIError, apiError.isUnauthorized {
                logout(message: apiError.errorDescription ?? "登录已失效。")
            } else {
                dailyLearningLoopHistoryError =
                    (error as? LocalizedError)?.errorDescription
                    ?? "暂时无法获取学习日历。"
            }
        }
    }

    func refreshGrowthReport() async {
        guard studentSession != nil, !isRefreshingGrowthReport else { return }
        isRefreshingGrowthReport = true
        defer { isRefreshingGrowthReport = false }
        await refreshDashboard()
    }

    func requestLeavingPractice(_ action: @escaping () -> Void) {
        guard activePractice?.isLoading != true, activePractice?.isSubmitting != true, activePractice?.isFinalizing != true,
              activePractice?.isCorrectingGrading != true else { return }
        if activePractice?.needsExitConfirmation == true {
            pendingNavigation = action
            showsPracticeExitConfirmation = true
        } else {
            activePractice = nil
            action()
        }
    }

    func confirmPracticeExit() {
        if let studentId = studentSession?.studentID {
            activePractice?.discardUnfinishedWork(studentId: studentId)
        }
        activePractice = nil
        let action = pendingNavigation
        pendingNavigation = nil
        showsPracticeExitConfirmation = false
        action?()
    }

    func cancelPracticeExit() {
        pendingNavigation = nil
        showsPracticeExitConfirmation = false
    }

    func logout(message: String = "") {
        PrivacyConsentCenter.shared.reset()
        showsAccountNotice = false
        pendingNavigation = nil
        activePractice = nil
        showsPracticeExitConfirmation = false
        AnswerDraftFileStore().removeAllDrafts()
        try? sessionStore.clearSession()
        studentSession = nil
        dashboardRequestID = UUID()
        dashboardRefreshTask?.cancel()
        dashboardRefreshTask = nil
        isWorking = false
        dashboard = nil
        dailyLearningLoop = nil
        dailyLearningLoopHistory = nil
        growthReport = nil
        dailyLearningLoopHistoryError = ""
        self.message = message
    }

    private func loadGrowthReport(
        for studentSession: StudentSession
    ) async throws -> GrowthReportData? {
        if let report = try await apiClient.growthReport(for: studentSession) {
            return report
        }
        return try await apiClient.generateGrowthReport(for: studentSession)
    }
}
