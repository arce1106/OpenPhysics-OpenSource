import SwiftUI

enum LearningResourceTab: String, CaseIterable, Identifiable {
    case card
    case video
    case slides
    case interactive

    var id: String { rawValue }

    var title: String {
        switch self {
        case .card: return "卡片"
        case .video: return "讲解"
        case .slides: return "微课"
        case .interactive: return "模拟"
        }
    }

    var symbol: String {
        switch self {
        case .card: return "rectangle.stack"
        case .video: return "play.rectangle"
        case .slides: return "rectangle.on.rectangle"
        case .interactive: return "slider.horizontal.3"
        }
    }
}

struct LearningResourceTabsView: View {
    let tabs: [LearningResourceTab]
    @Binding var selection: LearningResourceTab

    var body: some View {
        HStack(spacing: 8) {
            ForEach(tabs) { tab in
                Button {
                    selection = tab
                } label: {
                    Label(tab.title, systemImage: tab.symbol)
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .foregroundStyle(
                            selection == tab ? Color.white : OpenPhysicsTheme.accent
                        )
                        .background(
                            selection == tab
                                ? OpenPhysicsTheme.accent
                                : OpenPhysicsTheme.accentSoft
                        )
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selection == tab ? .isSelected : [])
            }
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 12)
        .background(Color(uiColor: .secondarySystemGroupedBackground))
    }
}

struct LearningVideoRecommendationsView: View {
    @ObservedObject var store: KnowledgeLearningStore
    let student: StudentSession
    let point: SyncKnowledgePoint

    var body: some View {
        Group {
            if store.isLoadingVideos {
                VStack(spacing: 14) {
                    ProgressView()
                        .controlSize(.large)
                    Text("正在搜索相关视频…")
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if !store.videoMessage.isEmpty {
                VStack(spacing: 14) {
                    Image(systemName: "wifi.exclamationmark")
                        .font(.system(size: 40))
                        .foregroundStyle(.orange)
                    Text(store.videoMessage)
                        .multilineTextAlignment(.center)
                    Button("重新加载") {
                        Task {
                            await store.loadVideos(
                                student: student,
                                kpId: point.id
                            )
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(OpenPhysicsTheme.accent)
                }
                .padding(30)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let videos = store.videos {
                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("B站视频讲解")
                                .font(.title2.bold())
                            Text(videoSubtitle(videos))
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }

                        if videos.items.isEmpty {
                            learningVideoEmptyState(
                                title: "暂时没有合适的讲解视频",
                                symbol: "play.slash"
                            )
                        } else {
                            LazyVGrid(
                                columns: [
                                    GridItem(.adaptive(minimum: 280), spacing: 16)
                                ],
                                spacing: 16
                            ) {
                                ForEach(videos.items) { item in
                                    LearningVideoCard(item: item)
                                }
                            }
                        }

                        if !videos.experimentItems.isEmpty {
                            VStack(alignment: .leading, spacing: 12) {
                                Text("演示实验")
                                    .font(.title3.bold())
                                LazyVGrid(
                                    columns: [
                                        GridItem(.adaptive(minimum: 280), spacing: 16)
                                    ],
                                    spacing: 16
                                ) {
                                    ForEach(videos.experimentItems) { item in
                                        LearningVideoCard(
                                            item: item,
                                            fallbackCategory: "演示实验"
                                        )
                                    }
                                }
                            }
                        }
                    }
                    .padding(24)
                }
            } else {
                Color.clear
            }
        }
        .task {
            await store.loadVideos(student: student, kpId: point.id)
        }
    }

    private func videoSubtitle(_ videos: LearningVideoRecommendationResponse) -> String {
        let all = videos.items + videos.experimentItems
        if !all.isEmpty, all.allSatisfy(\.isSearchLink) {
            return "这个知识点还没有收录精选视频，点开后会在 B 站搜索相关讲解。"
        }
        return "当前知识点最相关的讲解"
    }

    private func learningVideoEmptyState(
        title: String,
        symbol: String
    ) -> some View {
        VStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 36))
                .foregroundStyle(.secondary)
            Text(title)
                .font(.headline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(40)
        .background(OpenPhysicsTheme.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

private struct LearningVideoCard: View {
    @State private var isOpening = false
    @State private var showsOpenError = false
    let item: LearningVideoRecommendation
    var fallbackCategory = "相关讲解"

    var body: some View {
        Button {
            isOpening = true
            Task {
                defer { isOpening = false }
                showsOpenError = !(await LearningVideoLink.open(item.url))
            }
        } label: {
            HStack(spacing: 0) {
                AsyncImage(url: AppConfig.resolvedAssetURL(item.coverUrl)) { phase in
                    switch phase {
                    case let .success(image):
                        image
                            .resizable()
                            .scaledToFill()
                    default:
                        ZStack {
                            LinearGradient(
                                colors: [
                                    OpenPhysicsTheme.accent.opacity(0.88),
                                    OpenPhysicsTheme.accent.opacity(0.58),
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                            Image(systemName: item.isSearchLink ? "magnifyingglass" : "play.fill")
                                .font(.title)
                                .foregroundStyle(.white)
                        }
                    }
                }
                .frame(width: 132, height: 96)
                .clipped()

                VStack(alignment: .leading, spacing: 7) {
                    Text(item.category ?? fallbackCategory)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(OpenPhysicsTheme.accent)
                    Text(item.isSearchLink ? "在 B 站搜索「\(item.displayTitle)」" : item.title)
                        .font(.headline)
                        .foregroundStyle(.primary)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    Text(videoMeta)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(OpenPhysicsTheme.cardBackground)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(Color(uiColor: .separator).opacity(0.35), lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
        .disabled(isOpening)
        .accessibilityHint("优先在已安装的 B 站客户端中打开")
        .alert("视频暂时无法打开", isPresented: $showsOpenError) {
            Button("知道了", role: .cancel) {}
        } message: {
            Text("请稍后重试，或检查设备是否可以打开网页。")
        }
    }

    private var videoMeta: String {
        [item.uploaderLabel, item.duration]
            .compactMap { value in
                guard let value, !value.isEmpty else { return nil }
                return value
            }
            .joined(separator: " · ")
    }
}

struct LearningResourcePlaceholderView: View {
    let title: String
    let symbol: String

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: symbol)
                .font(.system(size: 44))
                .foregroundStyle(OpenPhysicsTheme.accent)
            Text(title)
                .font(.title2.bold())
            Text("该资源在网页端当前也处于准备阶段。")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(30)
    }
}

struct LearningTutorSheet: View {
    @ObservedObject private var privacy = PrivacyConsentCenter.shared
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: KnowledgeLearningStore
    let student: StudentSession
    let point: SyncKnowledgePoint
    /// Set on iPad: shown as a side panel beside the card instead of a sheet.
    var onClose: (() -> Void)? = nil
    @State private var input = ""
    @FocusState private var isInputFocused: Bool

    var body: some View {
        if let onClose {
            TutorSidePanel(title: "AI 助教 · \(point.name)", onClose: onClose) { conversation }
        } else {
            NavigationStack {
                conversation
                    .navigationTitle("AI 助教 · \(point.name)")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("完成") { dismiss() }
                        }
                    }
            }
        }
    }

    private var conversation: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        if store.tutorMessages.isEmpty && store.tutorStreamText.isEmpty {
                            tutorWelcome
                        }
                        ForEach(store.tutorMessages) { message in
                            TutorMessageBubble(message: message)
                                .id(message.id)
                        }
                        if !store.tutorStreamText.isEmpty {
                            TutorMessageBubble(message:
                                LearningChatMessage(
                                    role: "assistant",
                                    content: store.tutorStreamText
                                )
                            )
                            .id("streaming")
                        } else if store.isTutorResponding {
                            HStack(spacing: 10) {
                                ProgressView()
                                Text("助教正在梳理这个知识点…")
                                    .foregroundStyle(.secondary)
                            }
                            .id("streaming")
                        }
                        Color.clear.frame(height: 1).id("conversation-bottom")
                    }
                    .modifier(TutorContentLayout())
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: isInputFocused) { focused in
                    if focused && !store.tutorMessages.isEmpty {
                        withAnimation { proxy.scrollTo("conversation-bottom", anchor: .bottom) }
                    }
                }
                .onChange(of: store.tutorMessages.count) { _ in
                    withAnimation {
                        proxy.scrollTo(
                            store.tutorMessages.last?.id,
                            anchor: .bottom
                        )
                    }
                }
                .onChange(of: store.tutorStreamText) { _ in
                    proxy.scrollTo("streaming", anchor: .bottom)
                }
            }

            if !store.tutorMessage.isEmpty {
                Text(store.tutorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 6)
            }

            TutorComposer(input: $input, isFocused: $isInputFocused,
                          isResponding: store.isTutorResponding,
                          placeholder: "说说哪里还没想明白…",
                          context: "围绕当前知识点提问", onSend: { send(input) })
        }
        .background(OpenPhysicsTheme.pageBackground)
        .sheet(isPresented: privacy.presentationBinding(for: .learningTutor)) { AIPrivacyView(privacy: privacy) }
        .onChange(of: privacy.state?.aiAccepted) { accepted in
            if accepted == true { store.clearPrivacyNotice() }
        }
    }

    private var tutorWelcome: some View {
        TutorWelcome(
            title: "把这个知识点想明白",
            detail: "围绕「\(point.name)」，从概念到应用一起理清。",
            prompts: ["用简单的话讲一遍", "举个具体的例子", "这个知识点常错在哪？"],
            isResponding: store.isTutorResponding, onSelect: send
        )
    }

    private func send(_ text: String) {
        let message = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty else { return }
        input = ""
        Task {
            await store.sendTutorMessage(
                message,
                student: student,
                kpId: point.id
            )
            if !store.tutorMessage.isEmpty && input.isEmpty { input = message }
        }
    }
}

// Shared presentation for every knowledge-point and question tutor on iPhone and iPad.
struct TutorWelcome: View {
    let title: String
    let detail: String
    let prompts: [String]
    let isResponding: Bool
    let onSelect: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 20, weight: .medium))
                        .foregroundStyle(OpenPhysicsTheme.accent)
                        .frame(width: 38, height: 38)
                        .background(OpenPhysicsTheme.accent.opacity(0.09), in: RoundedRectangle(cornerRadius: 12))
                        .accessibilityHidden(true)
                    Text(title).font(.title3.weight(.semibold))
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(detail).font(.subheadline).foregroundStyle(.secondary)
                    .lineSpacing(4).fixedSize(horizontal: false, vertical: true)
            }

            VStack(alignment: .leading, spacing: 10) {
                Text("可以这样问").font(.caption).foregroundStyle(.secondary)
                    .padding(.leading, 2)
                VStack(spacing: 0) {
                    ForEach(Array(prompts.enumerated()), id: \.offset) { index, prompt in
                        Button { onSelect(prompt) } label: {
                            HStack(spacing: 12) {
                                Text(prompt).font(.subheadline)
                                    .fixedSize(horizontal: false, vertical: true)
                                Spacer(minLength: 0)
                                Image(systemName: "arrow.up.left")
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(OpenPhysicsTheme.accent.opacity(0.65))
                            }
                            .foregroundStyle(.primary)
                            .padding(.horizontal, 15).padding(.vertical, 13)
                            .frame(minHeight: 46).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain).disabled(isResponding)
                        .accessibilityHint("向 AI 助教发送这个问题")
                        if index < prompts.count - 1 {
                            Divider().overlay(OpenPhysicsTheme.pageBackground).padding(.leading, 15)
                        }
                    }
                }
                .background(OpenPhysicsTheme.cardBackground, in: RoundedRectangle(cornerRadius: 18))
            }
        }
        .padding(.top, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct TutorComposer: View {
    @Environment(\.openPhysicsIsPhone) private var isPhoneDevice
    @Environment(\.openPhysicsTutorInSidePanel) private var inSidePanel
    private var isPhone: Bool { isPhoneDevice || inSidePanel }
    @Binding var input: String
    @FocusState.Binding var isFocused: Bool
    let isResponding: Bool
    let placeholder: String
    let context: String
    let onSend: () -> Void

    private var canSend: Bool {
        !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isResponding
    }

    var body: some View {
        VStack(spacing: 9) {
            HStack(alignment: .bottom, spacing: 8) {
                TextField(placeholder, text: $input, axis: .vertical)
                    .font(.callout).lineSpacing(4).lineLimit(1...5)
                    .textFieldStyle(.plain)
                    .focused($isFocused)
                    .padding(.vertical, 11)
                    .disabled(isResponding)
                    .accessibilityLabel("向 AI 助教提问")
                    .accessibilityIdentifier("tutor.input")
                    .onSubmit { if canSend { onSend() } }

                Button(action: onSend) {
                    ZStack {
                        Circle().fill(canSend ? OpenPhysicsTheme.accent : Color(uiColor: .tertiarySystemFill))
                        if isResponding {
                            ProgressView().controlSize(.small)
                        } else {
                            Image(systemName: "arrow.up").font(.system(size: 17, weight: .semibold))
                                .foregroundStyle(canSend ? Color.white : Color.secondary.opacity(0.6))
                        }
                    }
                    .frame(width: 34, height: 34)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain).disabled(!canSend)
                .accessibilityLabel(isResponding ? "正在回复" : "发送")
                .accessibilityIdentifier("tutor.send")
            }
            .padding(.leading, 16).padding(.trailing, 5).padding(.vertical, 5)
            .background(OpenPhysicsTheme.cardBackground, in: RoundedRectangle(cornerRadius: 22))
            .overlay {
                RoundedRectangle(cornerRadius: 22)
                    .strokeBorder(isFocused ? OpenPhysicsTheme.accent.opacity(0.4) : Color.primary.opacity(0.07), lineWidth: 1)
            }
            .shadow(color: Color.black.opacity(0.025), radius: 8, y: 3)
            .animation(.easeOut(duration: 0.18), value: canSend)
            .animation(.easeOut(duration: 0.18), value: isFocused)

            Text("\(context) · AI 回答仅供参考")
                .font(.caption2).foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: isPhone ? .infinity : 680)
        .padding(.horizontal, isPhone ? 16 : 28).padding(.top, 10).padding(.bottom, 8)
        .frame(maxWidth: .infinity)
        .background(OpenPhysicsTheme.pageBackground)
    }
}

struct TutorMessageBubble: View {
    let message: LearningChatMessage

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            if message.role == "user" { Spacer(minLength: 44) }
            VStack(alignment: .leading, spacing: 8) {
                if message.role != "user" {
                    Label("AI 助教", systemImage: "sparkles")
                        .font(.caption.weight(.medium)).foregroundStyle(OpenPhysicsTheme.accent)
                }
                if message.role == "user" {
                    Text(message.content)
                        .font(.callout).lineSpacing(5).textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    TutorRichMessage(content: message.content)
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 13)
            .foregroundStyle(message.role == "user" ? Color.white : Color.primary)
            .background(message.role == "user" ? OpenPhysicsTheme.accent : OpenPhysicsTheme.cardBackground,
                        in: RoundedRectangle(cornerRadius: 18))
            if message.role != "user" { Spacer(minLength: 16) }
        }
        .frame(maxWidth: .infinity, alignment: message.role == "user" ? .trailing : .leading)
    }
}

struct TutorRichMessage: View {
    let content: String
    @ScaledMetric(relativeTo: .callout) private var textScale: CGFloat = 1
    @State private var height: CGFloat = 80
    @State private var failed = false

    var body: some View {
        if failed {
            // Keep the reply available even if the online renderer cannot be loaded.
            Text(content).font(.callout).textSelection(.enabled)
        } else {
            InlineLearningContentPane(
                payload: Self.payload(content: content, textScale: textScale),
                onHeightChanged: { next in
                    if next.isFinite, next > 0, abs(height - next) > 0.5 { height = next }
                },
                onError: { _ in failed = true },
                contentStyle: Self.contentStyle,
                allowsInteraction: true
            )
            .frame(maxWidth: .infinity).frame(height: height)
        }
    }

    static func payload(content: String, textScale: CGFloat) -> String {
        let object: [String: Any] = [
            "mode": "knowledge_card", "presentation": "phone", "textScale": textScale,
            "sections": [["type": "text", "text": content]],
        ]
        let data = try? JSONSerialization.data(withJSONObject: object)
        return data.flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }

    // Chat-only styling lives in the iOS host; shared Android/knowledge-card layouts stay intact.
    static let contentStyle = """
        html, body, #root { background: transparent !important; }
        .op-pane-root { padding: 0 !important; font-size: inherit; line-height: 1.65; }
        .op-pane-knowledge-card, .op-pane-knowledge-sections { display: block !important; }
        .op-pane-root .op-pane-knowledge-section { margin: 0 !important; padding: 0 !important;
          border: 0 !important; background: transparent !important; box-shadow: none !important; }
        .op-pane-knowledge-section > h2 { display: none; }
        .op-pane-rich { color: #172033; font-size: 1em; }
        """
}

// Keep long conversations readable in wider iPad sheets, while retaining phone spacing.
struct TutorContentLayout: ViewModifier {
    @Environment(\.openPhysicsIsPhone) private var isPhoneDevice
    @Environment(\.openPhysicsTutorInSidePanel) private var inSidePanel
    private var isPhone: Bool { isPhoneDevice || inSidePanel }

    func body(content: Content) -> some View {
        content
            .frame(maxWidth: isPhone ? .infinity : 680, alignment: .leading)
            .padding(.horizontal, isPhone ? 20 : 28)
            .padding(.vertical, 20)
            .frame(maxWidth: .infinity)
    }
}

// MARK: - iPad tutor side panel

private struct TutorInSidePanelKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// The side panel is phone-width, so the conversation uses phone spacing inside it.
    var openPhysicsTutorInSidePanel: Bool {
        get { self[TutorInSidePanelKey.self] }
        set { self[TutorInSidePanelKey.self] = newValue }
    }
}

enum TutorSidePanelMetrics {
    static let width: CGFloat = 380
    /// Portrait: a little narrower so the question or card keeps more than half the screen.
    static let portraitWidth: CGFloat = 340
}

/// iPad: the tutor opens beside the question or card instead of covering it, so the
/// student can keep reading while asking. iPhone keeps the full-screen sheet.
struct TutorSidePanel<Content: View>: View {
    @Environment(\.openPhysicsTabletSidebar) private var tabletSidebar
    let title: String
    let onClose: () -> Void
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "sparkles")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(OpenPhysicsTheme.accent)
                    .accessibilityHidden(true)
                Text(title)
                    .font(.headline)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 30, height: 30)
                        .background(Color(uiColor: .tertiarySystemFill), in: Circle())
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("收起 AI 助教")
            }
            .padding(.leading, 18)
            .padding(.trailing, 6)
            .frame(height: 56)
            .background(OpenPhysicsTheme.cardBackground)
            Divider()
            content
                .environment(\.openPhysicsTutorInSidePanel, true)
        }
        .frame(width: tabletSidebar?.prefersCollapsed == true
            ? TutorSidePanelMetrics.portraitWidth
            : TutorSidePanelMetrics.width)
        .frame(maxHeight: .infinity)
        .background(OpenPhysicsTheme.pageBackground)
    }
}

/// Opening the iPad tutor panel borrows the sidebar's width; closing it, or leaving
/// the page, gives the width back only if the panel was what hid the sidebar.
private struct TutorSidePanelSidebarModifier: ViewModifier {
    @Environment(\.openPhysicsTabletSidebar) private var sidebar
    @State private var collapsedForTutor = false
    let isPresented: Bool

    func body(content: Content) -> some View {
        content
            .onChange(of: isPresented) { presented in
                if presented {
                    guard let sidebar, !sidebar.isHidden else { return }
                    sidebar.setHidden(true)
                    collapsedForTutor = true
                } else {
                    restoreSidebar()
                }
            }
            .onDisappear(perform: restoreSidebar)
    }

    private func restoreSidebar() {
        guard collapsedForTutor else { return }
        collapsedForTutor = false
        if sidebar?.prefersCollapsed != true { sidebar?.setHidden(false) }
    }
}

extension View {
    func tutorSidePanelMakesRoom(isPresented: Bool) -> some View {
        modifier(TutorSidePanelSidebarModifier(isPresented: isPresented))
    }
}
