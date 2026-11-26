import SwiftUI

enum PrivacyPolicy {
    static let version = "2026-10-11.2"
    static let aiVersion = "ios-ai-2026-10-11.2"
    static var privacyURL: URL { legalURL("privacy") }
    static var termsURL: URL { legalURL("terms") }
    static var minorsURL: URL { legalURL("minors") }
    static let aiProcessingSummary = "手写识别、批改和答疑会按功能将必要的题目及解析、你的作答和图片、相关批改结果、答疑文字和近期对话发送给本部署管理员配置并告知的 AI 服务商。"
    static var loginAgreementNotice: LocalizedStringKey {
        LocalizedStringKey("登录即表示同意[《用户协议》](\(termsURL.absoluteString))、[《隐私政策》](\(privacyURL.absoluteString))及[《未成年人保护规则》](\(minorsURL.absoluteString))。使用 AI 功能前会单独征求你的同意。")
    }
    private static func legalURL(_ path: String) -> URL {
        var parts = URLComponents(url: AppConfig.apiBaseURL, resolvingAgainstBaseURL: false)!
        parts.path = "/legal/" + path; parts.query = nil; parts.fragment = nil
        return parts.url!
    }

    static func needsAI(path: String, method: String) -> Bool {
        method == "POST" && (["practice/submit", "practice/submit-photo", "practice/process-evidence",
            "practice/submit-paper-batch", "practice/extract-photo", "learn/chat"].contains(path)
            || path.hasPrefix("tutor/"))
    }
}

enum LocalAccountPrivacy {
    static func isErased(_ studentID: String, defaults: UserDefaults = .standard) -> Bool {
        defaults.bool(forKey: "openphysics.account-erased.v1.\(studentID)")
    }

    static func erase(_ studentID: String, defaults: UserDefaults = .standard) {
        // Keep only an opaque tombstone, so a late answer cannot recreate chat history.
        defaults.set(true, forKey: "openphysics.account-erased.v1.\(studentID)")
        let prefix = "openphysics.learn-chat.v3.\(studentID)."
        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix(prefix) {
            defaults.removeObject(forKey: key)
        }
    }
}

struct PrivacyConsentState: Decodable {
    let privacyVersion: String
    let aiVersion: String
    let iosTerms: Bool
    let iosAi: Bool
    var iosAiWithdrawn: Bool? = nil

    var termsAccepted: Bool { iosTerms && privacyVersion == PrivacyPolicy.version }
    var aiAccepted: Bool { termsAccepted && iosAi && aiVersion == PrivacyPolicy.aiVersion }
}

struct PrivacyConsentRequest: Encodable {
    let scope: String
    let version: String
    let granted: Bool
    var preserveWithdrawal: Bool? = nil
}

enum PrivacyConsentError: LocalizedError {
    case required, accountChanged
    var errorDescription: String? {
        switch self {
        case .required: return "尚未授权第三方 AI 处理。请阅读说明；同意后可再次提交，当前作答仍保留。"
        case .accountChanged: return "账号状态已变化，请重新打开当前页面。"
        }
    }
}

enum AIPrivacyPresentation {
    case main, practice, learningTutor, questionTutor
    static func source(for path: String) -> Self {
        if path.hasPrefix("practice/") { return .practice }
        switch path {
        case "learn/chat": return .learningTutor
        case "tutor/question-chat": return .questionTutor
        default: return .main
        }
    }
}

enum PrivacyEntryState: Equatable {
    case loading, unavailable, review, ready
}

extension APIClient {
    func privacyConsent(token: String) async throws -> PrivacyConsentState {
        try await request(path: "auth/privacy-consent", token: token)
    }

    func recordPrivacyConsent(scope: String, granted: Bool, token: String, preserveWithdrawal: Bool? = nil) async throws -> PrivacyConsentState {
        try await request(path: "auth/privacy-consent", method: "POST",
            body: PrivacyConsentRequest(scope: scope,
                version: scope == "ios_ai" ? PrivacyPolicy.aiVersion : PrivacyPolicy.version,
                granted: granted, preserveWithdrawal: preserveWithdrawal), token: token)
    }

    @discardableResult
    func recordLoginPrivacyConsent(termsAccepted: Bool, aiAccepted: Bool, token: String) async throws -> PrivacyConsentState {
        guard termsAccepted else { throw PrivacyConsentError.required }
        var saved = try await recordPrivacyConsent(scope: "ios_terms", granted: true, token: token)
        guard saved.termsAccepted else { throw PrivacyConsentError.required }
        // Both login methods link the AI clause from the explicit agreement action.
        // A prior withdrawal takes precedence; re-enabling remains a separate choice
        // in privacy settings. Older servers omit this flag, so fail closed there.
        if aiAccepted && !saved.aiAccepted && saved.iosAiWithdrawn == false {
            saved = try await recordPrivacyConsent(scope: "ios_ai", granted: true, token: token, preserveWithdrawal: true)
            guard saved.aiAccepted || saved.iosAiWithdrawn == true else { throw PrivacyConsentError.required }
        }
        return saved
    }
}

/// No device-wide permission or optimistic grant: every AI action checks the account receipt.
@MainActor final class PrivacyConsentCenter: ObservableObject {
    static let shared = PrivacyConsentCenter()
    @Published private(set) var token: String?
    @Published private(set) var state: PrivacyConsentState?
    @Published private(set) var busy = false
    @Published var message = ""
    @Published var showsAI = false
    @Published private(set) var aiPresentation = AIPrivacyPresentation.main
    /// True when an AI action (not the settings entry) opened the sheet: show the explicit consent prompt.
    @Published private(set) var aiConsentPrompt = false
    private let api: APIClient

    init(api: APIClient = APIClient()) { self.api = api }

    func entryState(for sessionToken: String?) -> PrivacyEntryState {
        guard let sessionToken, token == sessionToken else { return .loading }
        if let state { return state.termsAccepted ? .ready : .review }
        return busy || message.isEmpty ? .loading : .unavailable
    }

    // This is the server receipt returned by the explicit login agreement action.
    // Install it before publishing the session, without an extra read or UI step.
    func acceptLoginReceipt(_ receipt: PrivacyConsentState, token: String) {
        self.token = token; state = receipt; message = ""; showsAI = false; busy = false
    }

    func reset() {
        token = nil; state = nil; message = ""; showsAI = false; busy = false
    }

    func presentAI(from source: AIPrivacyPresentation, asConsentPrompt: Bool = false) {
        aiPresentation = source; aiConsentPrompt = asConsentPrompt; message = ""; showsAI = true
    }

    func presentationBinding(for source: AIPrivacyPresentation) -> Binding<Bool> {
        Binding(get: { self.showsAI && self.aiPresentation == source }, set: { shown in
            if self.aiPresentation == source { self.showsAI = shown }
        })
    }

    func activate(_ student: StudentSession?) async {
        let next = student?.token
        guard token != next else { return }
        token = next; state = nil; message = ""; showsAI = false; busy = false
        await refresh()
    }

    func refresh() async {
        guard let token else { return }
        busy = true
        defer { if self.token == token { busy = false } }
        do {
            let loaded = try await api.privacyConsent(token: token)
            guard self.token == token else { return }
            state = loaded; message = ""
        } catch {
            guard self.token == token else { return }
            message = error.localizedDescription
        }
    }

    func set(scope: String, granted: Bool) async {
        guard let token, !busy else { return }
        busy = true; message = ""
        defer { if self.token == token { busy = false } }
        do {
            let saved = try await api.recordPrivacyConsent(scope: scope, granted: granted, token: token)
            guard self.token == token else { return }
            state = saved
            message = scope == "ios_ai"
                ? (granted ? "已开启。请返回原页面再次提交。" : "已撤回。之后的 AI 请求将停止；已发送的请求可能仍会完成。")
                : ""
        } catch {
            guard self.token == token else { return }
            message = error.localizedDescription
        }
    }

    func acceptAgreement() async {
        guard let token, !busy else { return }
        busy = true; message = ""
        defer { if self.token == token { busy = false } }
        do {
            // AI is never granted together with the agreement; it is asked separately on first AI use.
            let saved = try await api.recordLoginPrivacyConsent(termsAccepted: true, aiAccepted: false, token: token)
            guard self.token == token else { return }
            state = saved
        } catch {
            guard self.token == token else { return }
            message = error.localizedDescription
        }
    }

    func authorize(api: APIClient, token: String, path: String) async throws {
        guard self.token == token else { throw PrivacyConsentError.accountChanged }
        let current = try await api.privacyConsent(token: token)
        guard self.token == token else { throw PrivacyConsentError.accountChanged }
        state = current
        guard current.aiAccepted else {
            // Choice grading is complete before optional scratch-work analysis.
            // Skip that add-on without competing with its result sheet.
            if current.termsAccepted && path != "practice/process-evidence" {
                presentAI(from: .source(for: path), asConsentPrompt: true)
            }
            throw PrivacyConsentError.required
        }
    }
}

struct PrivacyLoadingView: View {
    @EnvironmentObject private var appSession: AppSession
    @ObservedObject var privacy: PrivacyConsentCenter

    var body: some View {
        VStack(spacing: 16) {
            if privacy.entryState(for: appSession.studentSession?.token) == .unavailable {
                Text("暂时无法进入学习").font(.headline)
                Text("请检查网络后重试。").foregroundStyle(.secondary)
                Button("重试") { Task { await privacy.refresh() } }.buttonStyle(.borderedProminent)
                Button("返回登录") { appSession.logout() }
            } else {
                ProgressView("正在进入学习…")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(OpenPhysicsTheme.pageBackground)
    }
}

struct PrivacyReviewView: View {
    @EnvironmentObject private var appSession: AppSession
    @ObservedObject var privacy: PrivacyConsentCenter
    @State private var showsDeletion = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("请确认隐私政策更新").font(.title2.bold())
                Text("我们补充了 Apple 内购、账号注销和第三方 AI 处理说明。点击“同意并继续”即同意以下协议；AI 功能会在首次使用时单独征求你的同意，你此前的 AI 授权选择保持不变。")
                PrivacyDocumentLinks()
                if privacy.state == nil {
                    if privacy.busy { ProgressView("正在读取确认记录…") }
                    else { Button("重新读取") { Task { await privacy.refresh() } } }
                } else {
                    Button("同意并继续") { Task { await privacy.acceptAgreement() } }
                        .buttonStyle(.borderedProminent).disabled(privacy.busy)
                }
                if !privacy.message.isEmpty { Text(privacy.message).font(.callout) }
                Button("暂不接受，退出登录", role: .cancel) { appSession.logout() }
                Button("注销现有账号", role: .destructive) { showsDeletion = true }
            }.padding(24).frame(maxWidth: 620).frame(maxWidth: .infinity)
        }
        .sheet(isPresented: $showsDeletion) { AccountDeletionView().environmentObject(appSession) }
    }
}

struct PrivacyDocumentLinks: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Link("用户协议", destination: PrivacyPolicy.termsURL)
            Link("隐私政策", destination: PrivacyPolicy.privacyURL)
            Link("未成年人保护规则", destination: PrivacyPolicy.minorsURL)
        }
    }
}

struct AIPrivacyView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var privacy: PrivacyConsentCenter

    private var showsConsentPrompt: Bool {
        privacy.aiConsentPrompt && privacy.state?.aiAccepted != true
    }

    var body: some View {
        NavigationStack {
            Group {
                if showsConsentPrompt { consentPrompt } else { settingsForm }
            }
            .navigationTitle(showsConsentPrompt ? "使用 AI 前请确认" : "隐私与 AI 设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: showsConsentPrompt ? .cancellationAction : .confirmationAction) {
                    Button(showsConsentPrompt ? "关闭" : "完成") { dismiss() }.disabled(privacy.busy)
                }
            }
            .interactiveDismissDisabled(privacy.busy)
        }
        .task { await privacy.refresh() }
    }

    /// Explicit, separate permission before any data goes to a third-party AI.
    private var consentPrompt: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Label("这个功能需要第三方 AI", systemImage: "sparkles")
                    .font(.title3.bold())
                    .foregroundStyle(OpenPhysicsTheme.accent)
                Text("拍照识别、主观题批改和 AI 助教答疑由第三方 AI 服务完成。只有你同意后，才会发送内容。")
                    .font(.body)
                VStack(alignment: .leading, spacing: 10) {
                    Text("会发送什么、发给谁").font(.headline)
                    Text(PrivacyPolicy.aiProcessingSummary)
                        .foregroundStyle(Color.primary.opacity(0.85))
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(OpenPhysicsTheme.cardBackground, in: RoundedRectangle(cornerRadius: 14))
                Text("可随时在「我的 › 隐私与 AI 设置」中撤回。上传前请遮挡图片中的个人信息；AI 结果仅供学习参考。不同意不影响查看题目、资料和已有记录。")
                    .font(.footnote).foregroundStyle(.secondary)
                PrivacyDocumentLinks().font(.footnote)
                if !privacy.message.isEmpty { Text(privacy.message).font(.callout).foregroundStyle(.secondary) }
                VStack(spacing: 10) {
                    Button {
                        Task {
                            await privacy.set(scope: "ios_ai", granted: true)
                            if privacy.state?.aiAccepted == true { dismiss() }
                        }
                    } label: {
                        HStack {
                            if privacy.busy { ProgressView().tint(.white) }
                            Text("同意并使用 AI")
                        }.frame(maxWidth: .infinity, minHeight: 34)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(OpenPhysicsTheme.accent)
                    .disabled(privacy.busy || privacy.state == nil)
                    Button("暂不使用") { dismiss() }
                        .frame(maxWidth: .infinity, minHeight: 34)
                        .disabled(privacy.busy)
                }
                .padding(.top, 4)
            }
            .padding(24)
            .frame(maxWidth: 620)
            .frame(maxWidth: .infinity)
        }
        .background(OpenPhysicsTheme.pageBackground)
    }

    private var settingsForm: some View {
        Form {
            Section {
                if privacy.state != nil {
                    Toggle("AI 辅助学习", isOn: Binding(
                        get: { privacy.state?.aiAccepted == true },
                        set: { enabled in
                            Task { await privacy.set(scope: "ios_ai", granted: enabled) }
                        }
                    ))
                    .toggleStyle(.switch)
                    .tint(OpenPhysicsTheme.accent)
                    .disabled(privacy.busy)
                    .accessibilityHint("开启即同意第三方 AI 处理；关闭即撤回授权。")
                } else {
                    HStack {
                        Text("AI 辅助学习")
                        Spacer()
                        ProgressView()
                    }
                }
            } footer: {
                Text("用于手写识别、批改和答疑。开启即同意第三方 AI 处理，关闭即撤回授权。")
            }
            Section("AI 处理说明") {
                VStack(alignment: .leading, spacing: 16) {
                    Text(PrivacyPolicy.aiProcessingSummary)
                    Text("开启即同意上述处理及后续逐题、批量处理，可随时撤回。上传前请遮挡图片中的个人信息；AI 结果仅供学习参考。")
                }
                .font(.subheadline)
                .foregroundStyle(Color.primary.opacity(0.8))
                .lineSpacing(5)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.vertical, 8)
            }
            Section {
                PrivacyDocumentLinks()
            } footer: {
                Text("详细说明见以上协议。关闭后仍可查看题目、资料和已有记录；已发送的 AI 请求可能仍会完成。")
            }
            if privacy.busy || !privacy.message.isEmpty || privacy.state == nil {
                Section {
                    if privacy.busy { ProgressView() }
                    if !privacy.message.isEmpty { Text(privacy.message).font(.callout) }
                    if privacy.state == nil && !privacy.busy {
                        Button("重新读取授权状态") { Task { await privacy.refresh() } }
                    }
                }
            }
        }
    }
}
