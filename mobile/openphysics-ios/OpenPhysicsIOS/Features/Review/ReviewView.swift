import SwiftUI
import UIKit

struct ReviewView: View {
    @Environment(\.openPhysicsIsPhone) private var isPhone
    @EnvironmentObject private var appSession: AppSession
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var store = ReviewStore()
    @State private var selectedAnswerIds = Set<Int>()
    @State private var selectedMistakeAnswerId: Int?

    @MainActor init(store: ReviewStore? = nil) {
        _store = StateObject(wrappedValue: store ?? ReviewStore())
    }

    var body: some View {
        Group {
            if let data = store.data {
                if data.allMistakes.isEmpty {
                    emptyState
                } else {
                    if isPhone { phoneNotebook(data) } else { reviewWorkspace(data) }
                }
            } else if store.isLoading {
                ProgressView("正在整理待复盘错题…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                errorState
            }
        }
        .background(OpenPhysicsTheme.pageBackground)
        .openPhysicsPrimaryNavigationChrome("错题复盘")
        .openPhysicsPhoneRefresh("刷新错题", isRefreshing: store.isLoading) {
            guard let student = appSession.studentSession else { return }
            await store.load(student: student, force: true)
        }
        .navigationDestination(
            isPresented: Binding(
                get: { selectedMistakeAnswerId != nil },
                set: { isPresented in
                    if !isPresented { selectedMistakeAnswerId = nil }
                }
            )
        ) {
            if
                let answerId = selectedMistakeAnswerId,
                let mistake = store.data?.allMistakes.first(
                    where: { $0.answerId == answerId }
                )
            {
                ReviewMistakeDetailView(store: store, summary: mistake)
            }
        }
        .task(id: appSession.studentSession?.token) {
            guard let student = appSession.studentSession else { return }
            await store.load(student: student, force: true)
        }
        .onChange(of: scenePhase) { phase in
            guard phase == .active, let student = appSession.studentSession else { return }
            Task { await store.load(student: student, force: true) }
        }
        .onChange(of: store.requiresLogin) { requiresLogin in
            if requiresLogin {
                appSession.logout(message: "登录已失效，请重新登录。")
            }
        }
    }

    private func phoneNotebook(_ data: ReviewData) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("待复盘 \(data.pendingCount) 道 · 已清除 \(data.clearanceProgress.reviewed) 道")
                .font(.footnote).foregroundStyle(.secondary).padding(.horizontal, 4)
            // The Pane draws its own group cards; no extra outer panel on phone.
            ReviewNotebookPaneView(data: data, selectedAnswerIds: [], onToggleSelection: { _ in }, onOpenMistake: openMistake, onError: { store.message = $0 })
            if !store.message.isEmpty { Text(store.message).font(.caption).foregroundStyle(.red) }
        }.padding(16)
    }

    private func reviewWorkspace(_ data: ReviewData) -> some View {
        GeometryReader { proxy in
            VStack(spacing: OpenPhysicsWorkspaceMetrics.panelSpacing) {
                OpenPhysicsPageHeader(
                    title: "错题本",
                    subtitle: "把错题变成下一次做对的证据。",
                    refreshTitle: "刷新错题",
                    isRefreshing: store.isLoading
                ) {
                    refreshReviewData()
                }

                HStack(alignment: .top, spacing: OpenPhysicsWorkspaceMetrics.panelSpacing) {
                    controlPanel(data)
                        .frame(
                            width: OpenPhysicsWorkspaceMetrics.controlPanelWidth(
                                for: proxy.size.width
                            )
                        )
                    mistakePool(data)
                        .frame(maxWidth: .infinity)
                }
                .frame(maxHeight: .infinity)
            }
            .padding(OpenPhysicsWorkspaceMetrics.pagePadding)
        }
    }

    private func controlPanel(_ data: ReviewData) -> some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 5) {
                Text("复盘概览")
                    .font(.title3.weight(.semibold))
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("本轮重点")
                        .font(.subheadline.bold())
                        .foregroundStyle(.secondary)

                    priorityCard(data.reviewCenter?.primaryFocus)

                    LazyVGrid(
                        columns: [
                            GridItem(.flexible(), spacing: 10),
                            GridItem(.flexible(), spacing: 10),
                        ],
                        spacing: 10
                    ) {
                        reviewMetric(value: "\(data.pendingCount)", label: "待复盘")
                        reviewMetric(
                            value: "\(data.clearanceProgress.reviewed)",
                            label: "已清除"
                        )
                        reviewMetric(value: "\(data.clearancePercent)%", label: "清零进度")
                        reviewMetric(
                            value: "\(data.reviewCenter?.errorGroups.count ?? 0)",
                            label: "错因类型"
                        )
                    }

                    Divider()
                        .padding(.vertical, 2)

                    Text("复盘流程")
                        .font(.subheadline.bold())
                        .foregroundStyle(.secondary)

                    reviewPath
                }
                .padding(18)
            }
        }
        .frame(maxHeight: .infinity)
        .background(Color(uiColor: .systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(Color(uiColor: .separator).opacity(0.45))
        }
    }

    private func priorityCard(_ focus: ReviewErrorGroup?) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(focus?.errorName ?? "错题池")
                    .font(.title3.bold())
                    .lineLimit(2)
                Spacer()
                Text(focus == nil ? "待开始" : "优先处理")
                    .font(.caption.bold())
                    .foregroundStyle(OpenPhysicsTheme.accent)
                    .padding(.horizontal, 10)
                    .frame(height: 28)
                    .background(OpenPhysicsTheme.accentSoft)
                    .clipShape(Capsule())
            }

            Text(
                focus.map {
                    "\($0.count) 道错题集中在这一类，先从这里开始清理。"
                } ?? "先选择一道错题开始复盘。"
            )
            .font(.callout)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(14)
        .background(OpenPhysicsTheme.accentSoft.opacity(0.35))
        .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 15, style: .continuous)
                .stroke(OpenPhysicsTheme.accent.opacity(0.16))
        }
    }

    private func reviewMetric(value: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(value)
                .font(.title3.weight(.semibold))
                .foregroundStyle(OpenPhysicsTheme.accent)
            Text(label)
                .font(.caption.bold())
                .foregroundStyle(.secondary)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .stroke(Color(uiColor: .separator).opacity(0.35))
        }
    }

    private var reviewPath: some View {
        let steps = [
            ("发现错题", true),
            ("定位错因", true),
            ("修正解法", false),
            ("变式确认", false),
            ("清除错题", false),
        ]
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                HStack(alignment: .top, spacing: 12) {
                    VStack(spacing: 0) {
                        Text("\(index + 1)")
                            .font(.caption.bold())
                            .foregroundStyle(
                                step.1 ? OpenPhysicsTheme.accent : Color.secondary
                            )
                            .frame(width: 28, height: 28)
                            .background(
                                step.1
                                    ? OpenPhysicsTheme.accentSoft
                                    : Color(uiColor: .tertiarySystemFill)
                            )
                            .clipShape(Circle())
                        if index < steps.count - 1 {
                            Rectangle()
                                .fill(OpenPhysicsTheme.accent.opacity(0.16))
                                .frame(width: 2, height: 22)
                        }
                    }
                    Text(step.0)
                        .font(.subheadline.weight(step.1 ? .semibold : .regular))
                        .foregroundStyle(
                            index == 1 ? Color.primary : Color.secondary
                        )
                        .padding(.top, 5)
                    Spacer()
                }
            }
        }
    }

    private func mistakePool(_ data: ReviewData) -> some View {
        VStack(spacing: 12) {
            HStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("待复盘错题")
                        .font(.title3.weight(.semibold))
                }

                Spacer()

                printToolbar(data)
            }

            Divider()

            ReviewNotebookPaneView(
                data: data,
                selectedAnswerIds: selectedAnswerIds,
                onToggleSelection: toggleSelection,
                onOpenMistake: openMistake,
                onError: { store.message = $0 }
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            if !store.message.isEmpty {
                Label(store.message, systemImage: "exclamationmark.circle")
                    .font(.callout)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(16)
        .frame(maxHeight: .infinity)
        .background(Color(uiColor: .systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(Color(uiColor: .separator).opacity(0.45))
        }
    }

    private func refreshReviewData() {
        guard let student = appSession.studentSession else { return }
        Task {
            await store.load(student: student, force: true)
            selectedAnswerIds = selectedAnswerIds.intersection(
                Set(store.data?.allMistakes.map(\.answerId) ?? [])
            )
        }
    }

    private func printToolbar(_ data: ReviewData) -> some View {
        HStack(spacing: 8) {
            Text("\(selectedAnswerIds.count) 道已选")
                .font(.callout)
                .foregroundStyle(.secondary)

            Button("全选错题") {
                selectedAnswerIds = Set(data.allMistakes.map(\.answerId))
            }
            .disabled(data.allMistakes.isEmpty)

            if !selectedAnswerIds.isEmpty {
                Button("清空") {
                    selectedAnswerIds = []
                }
            }

            Button(
                selectedAnswerIds.isEmpty
                    ? "选择错题后打印"
                    : "打印所选错题"
            ) {
                let selected = data.allMistakes.filter {
                    selectedAnswerIds.contains($0.answerId)
                }
                ReviewPrinter.print(mistakes: selected)
            }
            .buttonStyle(.borderedProminent)
            .tint(OpenPhysicsTheme.accent)
            .disabled(selectedAnswerIds.isEmpty)
        }
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .controlSize(.regular)
        .padding(6)
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(Capsule())
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 48))
                .foregroundStyle(OpenPhysicsTheme.accent)
            Text("暂无待复盘错题")
                .font(.title3.weight(.semibold))
            Text("继续保持当前节奏，新的错题会在练习后自动进入这里。")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var errorState: some View {
        VStack(spacing: 14) {
            Image(systemName: "exclamationmark.triangle")
                .font(.largeTitle)
                .foregroundStyle(.orange)
            Text(store.message.isEmpty ? "错题本暂时不可用" : store.message)
                .foregroundStyle(.secondary)
            Button("重新加载") {
                guard let student = appSession.studentSession else { return }
                Task { await store.load(student: student, force: true) }
            }
            .buttonStyle(.borderedProminent)
            .tint(OpenPhysicsTheme.accent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func toggleSelection(_ answerId: Int) {
        if selectedAnswerIds.contains(answerId) {
            selectedAnswerIds.remove(answerId)
        } else {
            selectedAnswerIds.insert(answerId)
        }
    }

    private func openMistake(_ answerId: Int) {
        selectedMistakeAnswerId = answerId
    }
}

enum ReviewDetailLayoutPolicy {
    /// iPad keeps these in the header: floating buttons covered the option marks and grading rows.
    static let headerActions = ["AI 助教", "做变式题"]
}

struct ReviewMistakeDetailView: View {
    @Environment(\.openPhysicsIsPhone) private var isPhone
    @EnvironmentObject private var appSession: AppSession
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: ReviewStore
    let summary: ReviewMistake

    @StateObject private var practiceStore = PracticeStore()
    @State private var mistake: ReviewMistake?
    @State private var isLoading = true
    @State private var showsPractice = false
    @State private var showsTutor = false
    @State private var videoSelection: LessonVideoSelection?
    @State private var actionMessage = ""
    @State private var detailColumnWidth: CGFloat = 0

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            detailColumn
                .background(
                    GeometryReader { proxy in
                        Color.clear
                            .onAppear { detailColumnWidth = proxy.size.width }
                            .onChange(of: proxy.size.width) { detailColumnWidth = $0 }
                    }
                )
            if showsTutorPanel, let mistake {
                ReviewTutorSheet(store: store, mistake: mistake, onClose: closeTutor)
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .stroke(Color(uiColor: .separator).opacity(0.24), lineWidth: 1)
                    }
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .padding(isPhone ? 0 : 16)
        .background(OpenPhysicsTheme.pageBackground)
        .openPhysicsPrimaryNavigationChrome("错题详情")
        .toolbar {
            if isPhone, let mistake, let video = mistake.lessonVideo {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        videoSelection = LessonVideoSelection(questionId: mistake.questionId, answerId: mistake.answerId)
                    } label: { Image(systemName: "play.rectangle").frame(minWidth: 44, minHeight: 44) }
                    .tint(OpenPhysicsTheme.accent).disabled(!video.available).accessibilityLabel("视频讲解")
                }
            }
        }
        .toolbar(isPhone ? .hidden : .automatic, for: .tabBar)
        .task(id: summary.answerId) {
            await loadDetailAsync()
        }
        .sheet(item: $videoSelection) { selection in
            LessonVideoView(selection: selection)
        }
        .sheet(isPresented: Binding(get: { isPhone && showsTutor }, set: { showsTutor = $0 })) {
            if let mistake {
                ReviewTutorSheet(store: store, mistake: mistake)
                    .environmentObject(appSession)
                    .presentationDetents([.large])
            }
        }
        .tutorSidePanelMakesRoom(isPresented: showsTutorPanel)
        // iPhone keeps the sheet; on iPad a sheet is a small centred card, so the variation
        // opens full screen like every other practice page.
        .sheet(
            isPresented: Binding(get: { isPhone && showsPractice }, set: { showsPractice = $0 }),
            onDismiss: practiceDismissed
        ) { variationPractice }
        .fullScreenCover(
            isPresented: Binding(get: { !isPhone && showsPractice }, set: { showsPractice = $0 }),
            onDismiss: practiceDismissed
        ) { variationPractice }
        .onChange(of: practiceStore.requiresLogin) { requiresLogin in
            if requiresLogin {
                appSession.logout(message: "登录已失效，请重新登录。")
            }
        }
    }

    private var detailColumn: some View {
        VStack(spacing: 14) {
            if !isPhone { detailHeader }

            if let mistake {
                ReviewMistakeDetailPaneView(
                    mistake: mistake,
                    onError: { actionMessage = $0 }
                )
                // Same side margin as the phone practice result page.
                .padding(.horizontal, isPhone ? 16 : 0)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(uiColor: .systemBackground))
                .clipShape(RoundedRectangle(cornerRadius: isPhone ? 0 : 18, style: .continuous))
                .safeAreaInset(edge: .bottom) {
                    if isPhone {
                        HStack(spacing: 12) {
                            Button { store.prepareTutor(for: mistake.answerId); showsTutor = true } label: {
                                Label("AI 助教", systemImage: "sparkles").frame(maxWidth: .infinity, minHeight: 32)
                            }.buttonStyle(.bordered)
                            Button(action: startVariation) {
                                HStack {
                                    if practiceStore.isLoading { ProgressView().tint(.white) }
                                    Text(practiceStore.isLoading ? "正在准备…" : "做变式题")
                                }.frame(maxWidth: .infinity, minHeight: 32)
                            }.buttonStyle(.borderedProminent).disabled(practiceStore.isLoading)
                        }.tint(OpenPhysicsTheme.accent).frame(maxWidth: .infinity).padding(12).background(.bar)
                    }
                }
            } else if isLoading {
                ProgressView("正在打开这道错题…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.largeTitle)
                        .foregroundStyle(.orange)
                    Text(actionMessage.isEmpty ? "这道错题暂时无法打开" : actionMessage)
                    Button("重试") {
                        loadDetail()
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(OpenPhysicsTheme.accent)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }

            if !actionMessage.isEmpty, mistake != nil {
                Label(actionMessage, systemImage: "exclamationmark.circle")
                    .font(.callout)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private var detailHeader: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 14) {
                OpenPhysicsBackButton { dismiss() }

                // Portrait with the tutor open leaves ~400pt: the panel already names the page.
                if detailColumnWidth == 0 || detailColumnWidth >= 560 {
                    Text("错题详情")
                        .font(.title3.weight(.semibold))
                        .lineLimit(1)
                }

                Spacer()

                if let mistake, let video = mistake.lessonVideo {
                    Button("视频讲解") {
                        videoSelection = LessonVideoSelection(questionId: mistake.questionId, answerId: mistake.answerId)
                    }
                    .buttonStyle(.bordered).tint(OpenPhysicsTheme.accent)
                    .disabled(!video.available)
                    .help(video.lockedReason ?? "观看本题视频讲解")
                }

                if practiceStore.reviewRetryCleared {
                    Label("已清除", systemImage: "checkmark.seal.fill")
                        .font(.callout.bold())
                        .foregroundStyle(.green)
                }

                if let mistake {
                    Button { toggleTutor(for: mistake) } label: {
                        Label(ReviewDetailLayoutPolicy.headerActions[0], systemImage: "sparkles")
                            .lineLimit(1)
                            .fixedSize()
                    }
                    .buttonStyle(.bordered)
                    .tint(OpenPhysicsTheme.accent)

                    Button(action: startVariation) {
                        HStack(spacing: 6) {
                            if practiceStore.isLoading { ProgressView().tint(.white) }
                            Text(practiceStore.isLoading ? "正在准备…" : ReviewDetailLayoutPolicy.headerActions[1])
                                .lineLimit(1)
                        }
                        .fixedSize()
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(OpenPhysicsTheme.accent)
                    .disabled(practiceStore.isLoading)
                }
            }

        }
        .padding(.horizontal, 20)
        .padding(.vertical, 5)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(Color(uiColor: .separator).opacity(0.24), lineWidth: 1)
        }
    }

    /// iPad keeps the question visible next to the tutor; iPhone uses the sheet.
    private var showsTutorPanel: Bool { !isPhone && showsTutor && mistake != nil }

    private func toggleTutor(for mistake: ReviewMistake) {
        if showsTutor { closeTutor(); return }
        store.prepareTutor(for: mistake.answerId)
        withAnimation(.easeInOut(duration: 0.22)) { showsTutor = true }
    }

    private func closeTutor() {
        withAnimation(.easeInOut(duration: 0.22)) { showsTutor = false }
    }

    private func loadDetail() {
        Task { await loadDetailAsync() }
    }

    private func loadDetailAsync() async {
        guard let student = appSession.studentSession else { return }
        isLoading = true
        actionMessage = ""
        mistake = await store.detail(for: summary, student: student)
        if let mistake {
            store.prepareTutor(for: mistake.answerId)
        } else {
            actionMessage = store.message
        }
        isLoading = false
    }

    private func startVariation() {
        guard let student = appSession.studentSession else { return }
        actionMessage = ""
        Task {
            if await practiceStore.startReviewRetry(
                student: student,
                answerId: summary.answerId
            ) {
                showsPractice = true
            } else {
                actionMessage = practiceStore.message
            }
        }
    }

    private var variationPractice: some View {
        NavigationStack {
            PracticeWorkspaceView(
                store: practiceStore,
                onCompletion: refreshNotebook
            )
        }
        .environmentObject(appSession)
        .environment(\.openPhysicsTabletSidebar, nil)
    }

    /// A cleared mistake has nothing left here; go back to the list, like Android and the web.
    private func practiceDismissed() {
        if practiceStore.reviewRetryCleared { dismiss() }
    }

    private func refreshNotebook() {
        guard let student = appSession.studentSession else { return }
        Task {
            await store.refreshAfterReview(student: student)
        }
    }
}

struct ReviewTutorSheet: View {
    @ObservedObject private var privacy = PrivacyConsentCenter.shared
    @EnvironmentObject private var appSession: AppSession
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: ReviewStore
    let mistake: ReviewMistake
    /// Set on iPad: shown as a side panel beside the question instead of a sheet.
    var onClose: (() -> Void)? = nil

    @State private var input = ""
    @FocusState private var isInputFocused: Bool

    var body: some View {
        if let onClose {
            TutorSidePanel(title: "AI 助教 · 本题", onClose: onClose) { conversation }
        } else {
            NavigationStack {
                conversation
                    .navigationTitle("AI 助教 · 本题")
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
                        if store.tutorMessages.isEmpty {
                            tutorWelcome
                        }
                        ForEach(store.tutorMessages) { message in
                            TutorMessageBubble(message: message)
                                .id(message.id)
                        }
                        if store.isTutorResponding {
                            HStack(spacing: 10) {
                                ProgressView()
                                Text("助教正在看这道题…")
                                    .foregroundStyle(.secondary)
                            }
                            .id("responding")
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
                .onChange(of: store.isTutorResponding) { responding in
                    if responding {
                        proxy.scrollTo("responding", anchor: .bottom)
                    }
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
                          placeholder: "说说你卡在哪一步…",
                          context: "围绕本题提问", onSend: { send(input) })
        }
        .background(OpenPhysicsTheme.pageBackground)
        .sheet(isPresented: privacy.presentationBinding(for: .questionTutor)) { AIPrivacyView(privacy: privacy) }
        .onChange(of: privacy.state?.aiAccepted) { accepted in
            // Once consent is given, the "not authorised" notice is stale.
            if accepted == true, store.tutorMessage == PrivacyConsentError.required.errorDescription { store.tutorMessage = "" }
        }
    }

    private var tutorWelcome: some View {
        TutorWelcome(
            title: "一起理清这道题",
            detail: "结合你的作答，找到卡住的那一步。",
            prompts: ["帮我找出第一处错误", "这一步为什么这样做？", "给我一道类似题"],
            isResponding: store.isTutorResponding, onSelect: send
        )
    }

    private func send(_ rawMessage: String) {
        let message = rawMessage.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty else { return }
        input = ""
        guard let student = appSession.studentSession else { return }
        Task {
            await store.sendTutorMessage(
                message,
                mistake: mistake,
                student: student
            )
            if !store.tutorMessage.isEmpty && input.isEmpty { input = message }
        }
    }
}

@MainActor
private enum ReviewPrinter {
    static func print(mistakes: [ReviewMistake]) {
        guard !mistakes.isEmpty else { return }
        let html = """
        <!doctype html>
        <html lang="zh-CN">
        <head>
          <meta charset="utf-8">
          <style>
            body { font: 16px -apple-system, BlinkMacSystemFont, sans-serif; color: #1a1d23; }
            h1 { font-size: 26px; }
            article { page-break-inside: avoid; border-bottom: 1px solid #ddd; padding: 18px 0; }
            .meta { color: #697386; font-size: 13px; margin-bottom: 8px; }
            .option { margin: 6px 0 0 18px; }
          </style>
        </head>
        <body>
          <h1>OpenPhysics 错题本</h1>
          \(mistakes.enumerated().map { index, mistake in
              """
              <article>
                <div class="meta">第 \(index + 1) 题 · \(htmlEscape(mistake.misconceptionName))</div>
                <div>\(htmlEscape(mistake.stemText))</div>
                \((mistake.options ?? []).map {
                    "<div class=\"option\">\(htmlEscape($0.label)). \(htmlEscape($0.text))</div>"
                }.joined())
              </article>
              """
          }.joined())
        </body>
        </html>
        """

        let controller = UIPrintInteractionController.shared
        let info = UIPrintInfo(dictionary: nil)
        info.jobName = "OpenPhysics 错题本"
        info.outputType = .general
        controller.printInfo = info
        controller.printFormatter = UIMarkupTextPrintFormatter(markupText: html)

        guard
            let scene = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .first(where: { $0.activationState == .foregroundActive }),
            let view = scene.keyWindow?.rootViewController?.view
        else { return }
        controller.present(
            from: CGRect(x: view.bounds.midX, y: 80, width: 1, height: 1),
            in: view,
            animated: true
        )
    }

    private static func htmlEscape(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }
}
