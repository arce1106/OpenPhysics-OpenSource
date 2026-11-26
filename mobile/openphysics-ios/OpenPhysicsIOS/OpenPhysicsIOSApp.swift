import SwiftUI

@main
struct OpenPhysicsIOSApp: App {
    @StateObject private var appSession = AppSession()
    @StateObject private var privacy = PrivacyConsentCenter.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            appContent
        }
    }

    private var appContent: some View {
            Group {
                if appSession.isRestoring {
                    ProgressView("正在进入学习…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(OpenPhysicsTheme.pageBackground)
                } else if appSession.studentSession == nil {
                    LoginView()
                } else {
                    switch privacy.entryState(for: appSession.studentSession?.token) {
                    case .loading, .unavailable:
                        PrivacyLoadingView(privacy: privacy)
                    case .review:
                        PrivacyReviewView(privacy: privacy)
                    case .ready:
                        MainShellView()
                    }
                }
            }
            .environmentObject(appSession)
            .environmentObject(privacy)
            .sheet(isPresented: privacy.presentationBinding(for: .main)) { AIPrivacyView(privacy: privacy) }
            .alert("账号不可用", isPresented: $appSession.showsAccountNotice) {
                Button("重新登录") { appSession.logout() }
                Button("取消", role: .cancel) { }
            } message: {
                Text("请重新登录或联系部署管理员。")
            }
            .task(id: appSession.studentSession?.token) {
                await privacy.activate(appSession.studentSession)
            }
            .task {
                if appSession.isRestoring {
                    await appSession.restore()
                }
            }
            .onChange(of: scenePhase) { phase in
                guard phase == .active, !appSession.isRestoring else { return }
                Task {
                    async let learningRefresh: Void = appSession.refreshDashboard()
                    await appSession.refreshStudentSession()
                    await learningRefresh
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: .studentAccessRefreshRequested)) { notification in
                guard let token = notification.object as? String else { return }
                Task { await appSession.refreshAccess(for: token) }
            }
    }
}
