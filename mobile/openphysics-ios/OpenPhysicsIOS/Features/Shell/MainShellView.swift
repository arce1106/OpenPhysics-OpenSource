import SwiftUI
import UIKit

enum AppSection: String, CaseIterable, Identifiable {
    case today
    case sync
    case reinforcement
    case gaokao
    case review
    case account

    var id: String { rawValue }

    static var launchSelection: AppSection {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        guard
            let keyIndex = arguments.firstIndex(of: "-OpenPhysicsSection"),
            arguments.indices.contains(keyIndex + 1),
            let section = AppSection(rawValue: arguments[keyIndex + 1])
        else { return .today }
        return section
        #else
        return .today
        #endif
    }

    static var launchColumnVisibility: NavigationSplitViewVisibility {
        let arguments = ProcessInfo.processInfo.arguments
        guard
            let keyIndex = arguments.firstIndex(of: "-OpenPhysicsSidebar"),
            arguments.indices.contains(keyIndex + 1)
        else { return .automatic }

        switch arguments[keyIndex + 1] {
        case "hidden": return .detailOnly
        case "visible": return .all
        default: return .automatic
        }
    }

    var title: String {
        switch self {
        case .today: return "首页"
        case .sync: return "同步学习"
        case .reinforcement: return "巩固提升"
        case .gaokao: return "高考复习"
        case .review: return "错题本"
        case .account: return "个人中心"
        }
    }

    var symbol: String {
        switch self {
        case .today: return "house"
        case .sync: return "books.vertical"
        case .reinforcement: return "target"
        case .gaokao: return "graduationcap"
        case .review: return "arrow.counterclockwise"
        case .account: return "person.crop.circle"
        }
    }
}

/// iPad is designed for landscape. Narrower than this (portrait), a tiled sidebar would leave
/// the workspace pages too little room, so it stays collapsed and opens only on demand.
enum TabletShellLayoutPolicy {
    static let minimumWidthForSidebar: CGFloat = 1_100

    static func keepsSidebarCollapsed(width: CGFloat) -> Bool {
        width > 0 && width < minimumWidthForSidebar
    }
}

enum SidebarRevealPolicy {
    static func shouldReveal(
        startX: CGFloat,
        horizontalDistance: CGFloat,
        verticalDistance: CGFloat
    ) -> Bool {
        startX <= 32
            && horizontalDistance >= 72
            && abs(verticalDistance) < horizontalDistance * 0.75
    }
}

struct MainShellView: View {
    @EnvironmentObject private var appSession: AppSession
    @Environment(\.openPhysicsIsPhone) private var isPhone
    @State private var phoneTab = PhoneTab.home
    @State private var learningPath: [AppSection] = []
    @State private var selection: AppSection? = AppSection.launchSelection
    @State private var columnVisibility = AppSection.launchColumnVisibility
    @State private var isNarrowShell = false
    @State private var collapsedForNarrowWidth = false
    @State private var lastShellWasNarrow: Bool?

    init(initialSection: AppSection = AppSection.launchSelection) {
        _selection = State(initialValue: initialSection)
        _phoneTab = State(initialValue: PhoneTab.destination(for: initialSection))
        _learningPath = State(initialValue: PhoneTab.destination(for: initialSection) == .learning ? [initialSection] : [])
    }

    var body: some View {
        Group {
            if isPhone { phoneShell } else { tabletShell }
        }
    }

    private var phoneShell: some View {
        TabView(selection: Binding(
            get: { phoneTab },
            set: { next in appSession.requestLeavingPractice { phoneTab = next } }
        )) {
            NavigationStack {
                HomeView(onNavigate: navigatePhone)
            }
            .id(appSession.homeNavigationToken)
            .tabItem { Label("首页", systemImage: "house") }.tag(PhoneTab.home)

            NavigationStack(path: $learningPath) {
                PhoneLearningHubView()
                    .navigationDestination(for: AppSection.self) { section in
                        destination(for: section)
                    }
            }
            .tabItem { Label("学习", systemImage: "books.vertical") }.tag(PhoneTab.learning)

            NavigationStack { ReviewView() }
                .tabItem { Label("错题", systemImage: "arrow.counterclockwise") }.tag(PhoneTab.review)
            NavigationStack { AccountView() }
                .tabItem { Label("我的", systemImage: "person.crop.circle") }.tag(PhoneTab.account)
        }
        .tint(OpenPhysicsTheme.accent)
        .onChange(of: appSession.homeNavigationToken) { _ in
            phoneTab = .home
            learningPath = []
        }
    }

    private func navigatePhone(_ section: AppSection) {
        appSession.requestLeavingPractice {
            phoneTab = PhoneTab.destination(for: section)
            if phoneTab == .learning { learningPath = [section] }
        }
    }

    private var tabletShell: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            List(AppSection.allCases, selection: sidebarSelection) { section in
                Label(section.title, systemImage: section.symbol)
                    .tag(section)
            }
            .navigationTitle("OpenPhysics")
            .navigationBarTitleDisplayMode(.inline)
            .navigationSplitViewColumnWidth(min: 220, ideal: 240, max: 280)
            .safeAreaInset(edge: .bottom) {
                accountSummary
            }
        } detail: {
            NavigationStack {
                destination(for: selection ?? .today)
            }
            .id("\(selection?.rawValue ?? "today"):\(appSession.homeNavigationToken)")
            .contentShape(Rectangle())
            .simultaneousGesture(sidebarRevealGesture)
            .overlay(alignment: .leading) {
                // A thin edge strip only while collapsed: a wider one swallowed taps on
                // buttons near the left edge, including the show-sidebar button.
                if columnVisibility == .detailOnly {
                    GeometryReader { proxy in
                        SidebarEdgeSwipeView {
                            revealSidebar()
                        }
                        .frame(width: 12, height: proxy.size.height)
                    }
                    .accessibilityHidden(true)
                    .zIndex(1_000)
                }
            }
        }
        .navigationSplitViewStyle(.balanced)
        // Set on the split view: pages pushed inside the detail stack do not inherit
        // environment values attached to the stack itself.
        .environment(\.openPhysicsTabletSidebar, OpenPhysicsTabletSidebar(
            isHidden: columnVisibility == .detailOnly,
            setHidden: { hidden in
                withAnimation(.easeOut(duration: 0.22)) {
                    columnVisibility = hidden ? .detailOnly : .all
                }
            },
            prefersCollapsed: isNarrowShell
        ))
        .tint(OpenPhysicsTheme.accent)
        .onChange(of: appSession.homeNavigationToken) { _ in selection = .today }
        .background(
            GeometryReader { proxy in
                Color.clear
                    .onAppear { adaptSidebar(toWidth: proxy.size.width) }
                    .onChange(of: proxy.size.width) { adaptSidebar(toWidth: $0) }
            }
        )
    }

    /// Portrait: collapse the sidebar (the page header shows the show-sidebar button).
    /// Back to landscape: reopen it only if landscape had it open before — a page that hid
    /// it (practice) or a student who closed it keeps it closed. Launching in portrait
    /// counts as open: the system already reports the sidebar hidden there.
    private func adaptSidebar(toWidth width: CGFloat) {
        guard width > 0 else { return }
        let narrow = TabletShellLayoutPolicy.keepsSidebarCollapsed(width: width)
        let wasNarrow = lastShellWasNarrow
        lastShellWasNarrow = narrow
        isNarrowShell = narrow
        if narrow, wasNarrow != true {
            collapsedForNarrowWidth = wasNarrow == nil || columnVisibility != .detailOnly
            columnVisibility = .detailOnly
        } else if !narrow, wasNarrow == true {
            if collapsedForNarrowWidth {
                withAnimation(.easeOut(duration: 0.22)) { columnVisibility = .all }
            }
            collapsedForNarrowWidth = false
        }
    }

    private var sidebarSelection: Binding<AppSection?> {
        Binding(
            get: { selection },
            set: { next in
                guard let next, next != selection else { return }
                appSession.requestLeavingPractice {
                    selection = next
                    // Portrait: the sidebar was opened to navigate; give the page its width back.
                    if isNarrowShell {
                        withAnimation(.easeOut(duration: 0.22)) { columnVisibility = .detailOnly }
                    }
                }
            }
        )
    }

    private var sidebarRevealGesture: some Gesture {
        DragGesture(minimumDistance: 18)
            .onEnded { value in
                guard
                    SidebarRevealPolicy.shouldReveal(
                        startX: value.startLocation.x,
                        horizontalDistance: value.translation.width,
                        verticalDistance: value.translation.height
                    )
                else { return }

                revealSidebar()
            }
    }

    private func revealSidebar() {
        withAnimation(.easeOut(duration: 0.22)) {
            columnVisibility = .all
        }
    }

    @ViewBuilder
    private func destination(for section: AppSection) -> some View {
        switch section {
        case .today:
            HomeView { destination in
                selection = destination
            }
        case .sync:
            SyncLearningView()
        case .reinforcement:
            ReinforcementView()
        case .gaokao:
            GaokaoReviewView()
        case .review:
            ReviewView()
        case .account:
            AccountView()
        }
    }

    private var accountSummary: some View {
        HStack(spacing: 10) {
            Image(systemName: "person.crop.circle.fill")
                .font(.title2)
                .foregroundStyle(OpenPhysicsTheme.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(appSession.studentSession?.displayLabel ?? "学生")
                    .font(.subheadline.weight(.semibold))
                Text(StudentAccessPolicy.accountStatusText(appSession.studentSession))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding()
        .background(.bar)
    }

}

private struct SidebarEdgeSwipeView: UIViewRepresentable {
    let onReveal: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onReveal: onReveal)
    }

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.backgroundColor = .clear

        let recognizer = UIScreenEdgePanGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handle(_:))
        )
        recognizer.edges = .left
        recognizer.cancelsTouchesInView = false
        view.addGestureRecognizer(recognizer)
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        context.coordinator.onReveal = onReveal
    }

    final class Coordinator: NSObject {
        var onReveal: () -> Void

        init(onReveal: @escaping () -> Void) {
            self.onReveal = onReveal
        }

        @objc func handle(_ recognizer: UIScreenEdgePanGestureRecognizer) {
            guard
                recognizer.state == .ended,
                recognizer.translation(in: recognizer.view).x >= 72
            else { return }
            onReveal()
        }
    }
}


enum PhoneTab: Hashable {
    case home, learning, review, account

    static func destination(for section: AppSection) -> PhoneTab {
        switch section {
        case .today: return .home
        case .sync, .reinforcement, .gaokao: return .learning
        case .review: return .review
        case .account: return .account
        }
    }
}

struct PhoneLearningHubView: View {
    private let sections: [AppSection] = [.sync, .reinforcement, .gaokao]
    private let descriptions: [AppSection: String] = [
        .sync: "按教材章节学习，读懂知识，再检查掌握情况。",
        .reinforcement: "检测薄弱环节，完成针对练习与提升。",
        .gaokao: "按专题复习，完成分层训练和套卷。"]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ForEach(sections) { section in
                    NavigationLink(value: section) {
                        OpenPhysicsCard {
                            HStack(alignment: .top, spacing: 14) {
                                Image(systemName: section.symbol)
                                    .font(.title2).foregroundStyle(OpenPhysicsTheme.accent)
                                    .frame(width: 44, height: 44)
                                    .background(OpenPhysicsTheme.accentSoft, in: RoundedRectangle(cornerRadius: 12))
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(section.title).font(.headline).foregroundStyle(.primary)
                                    Text(descriptions[section] ?? "")
                                        .font(.subheadline).foregroundStyle(.secondary)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                                Spacer(minLength: 0)
                                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                            }
                        }
                    }.buttonStyle(.plain)
                }
            }.padding(16)
        }
        .background(OpenPhysicsTheme.pageBackground)
        .navigationTitle("学习").navigationBarTitleDisplayMode(.inline)
    }
}
