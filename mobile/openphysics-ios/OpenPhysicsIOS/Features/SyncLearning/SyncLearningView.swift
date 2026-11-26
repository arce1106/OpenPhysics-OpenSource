import SwiftUI

struct SyncLearningView: View {
    @Environment(\.openPhysicsIsPhone) private var isPhone
    @EnvironmentObject private var appSession: AppSession
    @StateObject private var store = SyncLearningStore()
    @StateObject private var practiceStore = PracticeStore()
    @State private var collapsedPhoneChapterID: String?
    @State private var learningPoint: SyncKnowledgePoint?
    @State private var showsLearning = false
    @State private var showsPractice = false

    @MainActor init(store: SyncLearningStore? = nil) {
        _store = StateObject(wrappedValue: store ?? SyncLearningStore())
    }

    var body: some View {
        Group {
            if let directory = store.directory {
                if isPhone {
                    phoneDirectory(directory)
                } else {
                GeometryReader { proxy in
                    VStack(spacing: OpenPhysicsWorkspaceMetrics.panelSpacing) {
                        OpenPhysicsPageHeader(
                            title: "同步学习",
                            subtitle: "按教材章节推进知识学习，沿章节路径完成讲解、练习与掌握评估。",
                            refreshTitle: "刷新同步学习",
                            isRefreshing: store.isLoading
                        ) {
                            guard let student = appSession.studentSession else { return }
                            Task { await store.load(student: student, force: true) }
                        }

                        if !store.message.isEmpty {
                            Text(store.message).font(.callout).foregroundStyle(.secondary)
                        }
                        HStack(spacing: OpenPhysicsWorkspaceMetrics.panelSpacing) {
                            sidePanel(directory)
                                .frame(
                                    width: OpenPhysicsWorkspaceMetrics.controlPanelWidth(
                                        for: proxy.size.width
                                    )
                                )
                            chapterWorkspace(directory)
                        }
                        .frame(maxHeight: .infinity)
                    }
                    .padding(OpenPhysicsWorkspaceMetrics.pagePadding)
                }
                }
            } else if store.isLoading {
                loadingState
            } else {
                errorState
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(OpenPhysicsTheme.pageBackground)
        .openPhysicsPrimaryNavigationChrome("同步学习")
        .openPhysicsPhoneRefresh("刷新学习进度", isRefreshing: store.isLoading, action: refreshPhone)
        .task {
            guard let student = appSession.studentSession else { return }
            await store.load(student: student)
        }
        .onChange(of: StudentAccessPolicy.hasFullLearningAccess(appSession.studentSession)) { active in
            if active { practiceStore.clearAccountNotice() }
        }
        .navigationDestination(isPresented: Binding(
            get: { isPhone && store.showsKnowledgePointDetail },
            set: { store.showsKnowledgePointDetail = $0 }
        )) {
            if let point = store.selectedKnowledgePoint {
                phoneKnowledgePointDetail(point)
                    .navigationTitle("知识点").navigationBarTitleDisplayMode(.inline)
            }
        }
        .navigationDestination(isPresented: Binding(get: { !isPhone && showsLearning }, set: { showsLearning = $0 })) {
            learningDestination
        }
        .navigationDestination(isPresented: Binding(get: { !isPhone && showsPractice }, set: { showsPractice = $0 })) {
            practiceDestination
        }
    }

    @ViewBuilder private var learningDestination: some View {
        if let point = store.directory?.kps.first(where: { $0.id == learningPoint?.id }) ?? learningPoint {
            KnowledgeLearningView(point: point) {
                guard let student = appSession.studentSession else { return }
                Task { await store.load(student: student, force: true) }
            }.toolbar(.visible, for: .navigationBar)
        }
    }

    private var practiceDestination: some View {
        PracticeWorkspaceView(store: practiceStore) {
            guard let student = appSession.studentSession else { return }
            Task { await store.load(student: student, force: true) }
        }
    }

    private func phoneDirectory(_ directory: SyncDirectory) -> some View {
        VStack(spacing: 12) {
                Picker("教材", selection: Binding(get: { store.selectedVolume }, set: store.selectVolume)) {
                    ForEach(directory.volumes, id: \.self) { Text($0).tag($0) }
                }
                .pickerStyle(.menu).tint(OpenPhysicsTheme.accent)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .padding(.horizontal, 8)
                .background(OpenPhysicsTheme.cardBackground, in: RoundedRectangle(cornerRadius: 12))
                ScrollViewReader { reader in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 14) {
                            ForEach(directory.chapters(in: store.selectedVolume)) { chapter in
                                OpenPhysicsPhoneGroup {
                                    DisclosureGroup(isExpanded: Binding(
                                        get: { store.selectedChapter?.id == chapter.id && collapsedPhoneChapterID != chapter.id },
                                        set: { expanded in
                                            collapsedPhoneChapterID = expanded ? nil : chapter.id
                                            if expanded { store.selectChapter(chapter) }
                                        }
                                    )) {
                                        VStack(spacing: 0) {
                                            ForEach(chapter.knowledgePoints) { point in
                                                Button { store.selectKnowledgePoint(point) } label: {
                                                    HStack(alignment: .top, spacing: 12) {
                                                        VStack(alignment: .leading, spacing: 6) {
                                                            Text(point.name).font(.body.weight(.medium)).foregroundStyle(.primary)
                                                            Text(point.masteryLabel).font(.caption).foregroundStyle(.secondary)
                                                        }
                                                        Spacer(minLength: 4)
                                                        if !point.contentPending { PhoneMasteryMeter(percent: point.masteryPercent) }
                                                    }.padding(.vertical, 14).contentShape(Rectangle())
                                                }.buttonStyle(.plain)
                                                if point.id != chapter.knowledgePoints.last?.id { Divider() }
                                            }
                                        }.padding(.top, 8)
                                    } label: {
                                        VStack(alignment: .leading, spacing: 6) {
                                            Text(chapter.name).font(.headline).foregroundStyle(.primary)
                                            Text("\(chapter.masteredCount)/\(chapter.knowledgePoints.count) 已掌握")
                                                .font(.caption).foregroundStyle(.secondary)
                                        }
                                    }.padding(16)
                                }.id(chapter.id)
                            }
                            if !store.message.isEmpty { Text(store.message).foregroundStyle(.secondary) }
                        }
                    }.refreshable { await refreshPhone() }
                    .onAppear {
                        if let id = store.selectedChapter?.id { reader.scrollTo(id, anchor: .top) }
                    }
                }
        }.padding(16)
    }

    private func refreshPhone() async {
        guard let student = appSession.studentSession else { return }
        await store.load(student: student, force: true)
    }

    private func phoneKnowledgePointDetail(_ point: SyncKnowledgePoint) -> some View {
        let locked = showsLockedState(point)
        return ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if locked { lockedKnowledgePointBanner }
                    VStack(alignment: .leading, spacing: 12) {
                        Text([point.volume, point.chapter, point.section].compactMap { $0 }.joined(separator: " · "))
                            .font(.footnote).foregroundStyle(.secondary)
                        Text(point.name).font(.title2.weight(.semibold))
                        ViewThatFits(in: .horizontal) {
                            HStack(spacing: 8) {
                                SyncStatusBadge(text: point.masteryLabel, tone: point.badgeTone)
                                if !point.contentPending { Text("掌握度 \(point.masteryPercent)%").font(.subheadline).foregroundStyle(.secondary) }
                            }
                            VStack(alignment: .leading, spacing: 8) {
                                SyncStatusBadge(text: point.masteryLabel, tone: point.badgeTone)
                                if !point.contentPending { Text("掌握度 \(point.masteryPercent)%").font(.subheadline).foregroundStyle(.secondary) }
                            }
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                // The advice names the next step, so it sits above the rows and that row is marked.
                Text(point.advice).font(.footnote).foregroundStyle(.secondary).lineSpacing(4).padding(.horizontal, 4)
                OpenPhysicsPhoneGroup {
                    Button { openLearning(point) } label: {
                        OpenPhysicsPhoneActionRow(title: "知识学习",
                            detail: locked ? "登录后开启" : "\(point.learningActionLabel) · 概念、例题与辅助讲解", number: "01",
                            value: locked || recommendsAssessment(point) ? nil : "推荐", emphasized: !locked && !recommendsAssessment(point))
                    }.buttonStyle(.plain)
                    Divider().padding(.leading, 60)
                    Button { startPracticeAction(point) } label: {
                        OpenPhysicsPhoneActionRow(title: practiceStore.isLoading ? point.practiceActionLoadingTitle : point.practiceActionTitle,
                            detail: locked ? "登录后开启" : point.practiceActionDetail, number: "02",
                            value: !locked && recommendsAssessment(point) ? "推荐" : nil, emphasized: !locked && recommendsAssessment(point))
                    }.buttonStyle(.plain).disabled(practiceStore.isLoading)
                }
                if !practiceStore.message.isEmpty && practiceStore.message != StudentAccessPolicy.accountRequiredMessage {
                    Label(practiceStore.message, systemImage: "exclamationmark.circle")
                        .font(.callout).foregroundStyle(.red)
                }
            }.padding(16)
        }.tint(OpenPhysicsTheme.accent)
            .background(OpenPhysicsTheme.pageBackground)
            .refreshable { await refreshPhone() }
            .navigationDestination(isPresented: $showsLearning) { learningDestination }
            .navigationDestination(isPresented: $showsPractice) { practiceDestination }
    }

    private func recommendsAssessment(_ point: SyncKnowledgePoint) -> Bool {
        point.usesConsolidationPractice
    }

    /// Locked like 专题复习: the banner explains it and every action opens 账号状态.
    private func showsLockedState(_ point: SyncKnowledgePoint) -> Bool {
        !StudentAccessPolicy.canUseKnowledgePoint(point, for: appSession.studentSession)
            || practiceStore.message == StudentAccessPolicy.accountRequiredMessage
    }

    private func allowsKnowledgePoint(_ point: SyncKnowledgePoint) -> Bool {
        if point.contentPending { return false }
        guard StudentAccessPolicy.canUseKnowledgePoint(point, for: appSession.studentSession) else {
            appSession.showsAccountNotice = true
            return false
        }
        return true
    }

    private var lockedKnowledgePointBanner: some View {
        AccountAccessPreviewView(
            title: "登录后学习本知识点",
            message: "有效账号可学习全部知识点。请重新登录或联系部署管理员，已有记录会保留。"
        )
    }

    private func sidePanel(_ directory: SyncDirectory) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if store.showsKnowledgePointDetail, let point = store.selectedKnowledgePoint {
                knowledgePointDetail(point)
            } else {
                directoryPanel(directory)
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(Color(uiColor: .separator).opacity(0.35), lineWidth: 1)
        }
    }

    private func directoryPanel(_ directory: SyncDirectory) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("选择教材与章节")
                    .font(.title3.weight(.semibold))
                Text("按教材顺序推进，随时回到正在学习的位置。")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 18)
            .padding(.top, 20)

            Picker("教材", selection: Binding(
                get: { store.selectedVolume },
                set: store.selectVolume
            )) {
                ForEach(directory.volumes, id: \.self) { volume in
                    Text(volume).tag(volume)
                }
            }
            .pickerStyle(.menu)
            .tint(OpenPhysicsTheme.accent)
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(OpenPhysicsTheme.accentSoft)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .padding(.horizontal, 18)

            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(directory.chapters(in: store.selectedVolume)) { chapter in
                        chapterRow(chapter)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 18)
            }
        }
    }

    private func chapterRow(_ chapter: SyncChapter) -> some View {
        let selected = store.selectedChapter?.id == chapter.id
        return Button {
            store.selectChapter(chapter)
        } label: {
            VStack(alignment: .leading, spacing: 9) {
                // Title gets the full width; the badge beside it squeezed names into three lines.
                Text(chapter.name)
                    .font(.headline)
                    .multilineTextAlignment(.leading)
                    .foregroundStyle(selected ? OpenPhysicsTheme.accent : .primary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: 8) {
                    SyncStatusBadge(
                        text: chapter.statusLabel,
                        tone: chapter.statusLabel == "已完成" ? .success : .primary
                    )
                    .fixedSize()
                    Text("\(chapter.masteredCount)/\(chapter.knowledgePoints.count) 已掌握")
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    Spacer()
                    Text(chapter.knowledgePoints.allSatisfy({ $0.contentPending }) ? "—" : "\(chapter.averageMasteryPercent)%")
                        .fontWeight(.semibold)
                        .foregroundStyle(OpenPhysicsTheme.accent)
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                ProgressView(value: Double(chapter.averageMasteryPercent), total: 100)
                    .tint(OpenPhysicsTheme.accent)
            }
            .padding(13)
            .background(selected ? OpenPhysicsTheme.accentSoft : Color(uiColor: .tertiarySystemGroupedBackground))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(
                        selected ? OpenPhysicsTheme.accent.opacity(0.32) : Color.clear,
                        lineWidth: 1
                    )
            }
        }
        .buttonStyle(.plain)
    }

    private func knowledgePointDetail(_ point: SyncKnowledgePoint) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Button {
                        store.showsKnowledgePointDetail = false
                    } label: {
                        Label("返回章节目录", systemImage: "chevron.left")
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(OpenPhysicsTheme.accent)

                    Text(point.name)
                        .font(.title3.weight(.semibold))

                    Text([point.volume, point.chapter, point.section].compactMap { $0 }.joined(separator: " / "))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)

                    HStack(spacing: 8) {
                        SyncStatusBadge(text: point.masteryLabel, tone: point.badgeTone)
                        if !point.contentPending { SyncStatusBadge(text: "掌握度 \(point.masteryPercent)%", tone: .primary) }
                    }

                    Text(point.advice)
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .padding(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color(uiColor: .tertiarySystemGroupedBackground))
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

                    if showsLockedState(point) { lockedKnowledgePointBanner }
                }
                .padding(20)
            }
            .frame(maxHeight: .infinity)

            knowledgePointActions(point)
                .padding(20)
        }
        .frame(maxHeight: .infinity)
    }

    private func knowledgePointActions(_ point: SyncKnowledgePoint) -> some View {
        // The advice decides which action is primary: studied points go to 巩固小练 first.
        let assessmentFirst = recommendsAssessment(point)
        return VStack(alignment: .leading, spacing: 16) {
            if point.contentPending {
                Text("内容待补充：目录已保留，学习内容和题目由部署者补充。")
                    .foregroundStyle(.secondary)
            } else if assessmentFirst {
                assessmentButton(point, prominent: true)
                learningButton(point, prominent: false)
            } else {
                learningButton(point, prominent: true)
                assessmentButton(point, prominent: false)
            }

            if !practiceStore.message.isEmpty && practiceStore.message != StudentAccessPolicy.accountRequiredMessage {
                Text(practiceStore.message).font(.caption).foregroundStyle(.red)
            }
        }
    }

    @ViewBuilder private func learningButton(_ point: SyncKnowledgePoint, prominent: Bool) -> some View {
        let button = Button { openLearning(point) } label: {
            detailActionButtonLabel(showsLockedState(point) ? "登录后学习" : point.learningActionLabel, loading: false,
                                    progressTint: prominent ? .white : OpenPhysicsTheme.accent)
        }
        if prominent {
            button.buttonStyle(.borderedProminent).buttonBorderShape(.capsule).controlSize(.regular)
                .tint(OpenPhysicsTheme.accent)
        } else {
            button.buttonStyle(.bordered).buttonBorderShape(.capsule).controlSize(.regular)
                .tint(OpenPhysicsTheme.accent)
        }
    }

    @ViewBuilder private func assessmentButton(_ point: SyncKnowledgePoint, prominent: Bool) -> some View {
        let button = Button { startPracticeAction(point) } label: {
            detailActionButtonLabel(
                showsLockedState(point) ? "登录后\(point.practiceActionTitle)"
                    : practiceStore.isLoading ? point.practiceActionLoadingTitle : point.practiceActionTitle,
                loading: practiceStore.isLoading,
                progressTint: prominent ? .white : OpenPhysicsTheme.accent
            )
        }
        if prominent {
            button.buttonStyle(.borderedProminent).buttonBorderShape(.capsule).controlSize(.regular)
                .tint(OpenPhysicsTheme.accent).disabled(practiceStore.isLoading)
        } else {
            button.buttonStyle(.bordered).buttonBorderShape(.capsule).controlSize(.regular)
                .disabled(practiceStore.isLoading)
        }
    }

    private func detailActionButtonLabel(
        _ title: String,
        loading: Bool,
        progressTint: Color
    ) -> some View {
        HStack {
            if loading {
                ProgressView()
                    .tint(progressTint)
            }
            Text(title)
        }
        .font(.headline)
        .frame(maxWidth: .infinity)
        .frame(minHeight: 34)
    }

    private func chapterWorkspace(_ directory: SyncDirectory) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if let chapter = store.selectedChapter {
                chapterHeader(chapter)
                Divider()
                learningPath(chapter, directory: directory)
            } else {
                emptyChapterState
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(Color(uiColor: .separator).opacity(0.35), lineWidth: 1)
        }
    }

    private func chapterHeader(_ chapter: SyncChapter) -> some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text(chapter.name)
                    .font(.title3.weight(.semibold))
                Text(chapter.volume)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            SyncMetric(value: "\(chapter.knowledgePoints.count)", label: "知识点")
            SyncMetric(value: "\(chapter.masteredCount)", label: "已掌握")
            SyncMetric(value: chapter.knowledgePoints.allSatisfy({ $0.contentPending }) ? "—" : "\(chapter.averageMasteryPercent)%", label: "平均")
        }
        .padding(20)
    }

    private func learningPath(
        _ chapter: SyncChapter,
        directory: SyncDirectory
    ) -> some View {
        let recommended = directory.recommendedKnowledgePoint(in: chapter.knowledgePoints)
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("章节学习路径", systemImage: "point.topleft.down.curvedto.point.bottomright.up")
                    .font(.headline)
                Spacer()
                if let recommended {
                    Text("推荐从「\(recommended.name)」继续")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)

            HStack(spacing: 12) {
                MasteryColorLegend()
                Spacer(minLength: 8)
                // The darkest lines belong to the focused point: the recommendation until another is tapped.
                ChapterGraphEdgeLegend(
                    focusTitle: store.selectedKnowledgePoint.map { $0.id == recommended?.id ? "推荐路径" : "所选知识点" }
                        ?? (recommended == nil ? nil : "推荐路径")
                )
            }
            .padding(.horizontal, 8)

            ChapterKnowledgeGraphView(
                knowledgePoints: chapter.knowledgePoints,
                relations: directory.relations,
                recommendedKnowledgePointId: recommended?.id,
                selectedKnowledgePointId: store.selectedKnowledgePoint?.id,
                onSelect: store.selectKnowledgePoint
            )
            .padding(18)
        }
    }

    /// Studied or mastered points go to 巩固小练 (5 questions, graded as a set), as on Android;
    /// the rest take the 3-question 掌握评估.
    private func startPracticeAction(_ point: SyncKnowledgePoint) {
        guard allowsKnowledgePoint(point) else { return }
        guard point.usesConsolidationPractice else { return startAssessment(point) }
        guard let student = appSession.studentSession else { return }
        Task {
            showsPractice = await practiceStore.start(student: student, kpId: point.id, count: 5, deferredGrading: true)
        }
    }

    private func startAssessment(_ point: SyncKnowledgePoint) {
        guard let student = appSession.studentSession else { return }
        Task {
            showsPractice = await practiceStore.startAssessment(
                student: student,
                kpId: point.id,
                count: 3
            )
        }
    }

    private func openLearning(_ point: SyncKnowledgePoint) {
        guard allowsKnowledgePoint(point) else { return }
        learningPoint = point
        showsLearning = true
    }

    private var loadingState: some View {
        VStack(spacing: 14) {
            ProgressView()
                .controlSize(.regular)
            Text("正在读取教材目录与学习进度…")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 24)
    }

    private var errorState: some View {
        VStack(spacing: 14) {
            Image(systemName: "books.vertical")
                .font(.system(size: 42))
                .foregroundStyle(OpenPhysicsTheme.accent)
            Text(store.message.isEmpty ? "同步学习目录暂时没有数据" : store.message)
                .multilineTextAlignment(.center)
            Button("重新加载") {
                guard let student = appSession.studentSession else { return }
                Task { await store.load(student: student, force: true) }
            }
            .buttonStyle(.borderedProminent)
            .tint(OpenPhysicsTheme.accent)
        }
        .padding(30)
    }

    private var emptyChapterState: some View {
        VStack(spacing: 12) {
            Image(systemName: "book.closed")
                .font(.system(size: 42))
                .foregroundStyle(.secondary)
            Text("当前教材暂无可用章节")
                .font(.title3.bold())
            Text("请从左侧选择其他教材。")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct KnowledgeLearningView: View {
    @Environment(\.openPhysicsIsPhone) private var isPhone
    @EnvironmentObject private var appSession: AppSession
    @Environment(\.dismiss) private var dismiss
    @StateObject private var store = KnowledgeLearningStore()
    @State private var paneRendered = false
    @State private var paneMessage = ""
    @State private var activeResource: LearningResourceTab = .card
    @State private var showsTutor = false
    @State private var learningColumnWidth: CGFloat = 0

    let point: SyncKnowledgePoint
    let onCompleted: () -> Void

    @MainActor init(point: SyncKnowledgePoint, store: KnowledgeLearningStore? = nil, onCompleted: @escaping () -> Void) {
        self.point = point
        self.onCompleted = onCompleted
        _store = StateObject(wrappedValue: store ?? KnowledgeLearningStore())
    }

    var body: some View {
        HStack(spacing: 0) {
            learningColumn
                .background(
                    GeometryReader { proxy in
                        Color.clear
                            .onAppear { learningColumnWidth = proxy.size.width }
                            .onChange(of: proxy.size.width) { learningColumnWidth = $0 }
                    }
                )
            if showsTutorPanel, let student = appSession.studentSession {
                HStack(spacing: 0) {
                    Divider()
                    LearningTutorSheet(store: store, student: student, point: point, onClose: closeTutor)
                }
                .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .background(OpenPhysicsTheme.pageBackground)
        .navigationTitle(isPhone ? point.name : "同步学习")
        .toolbar(isPhone ? .hidden : .automatic, for: .tabBar)
        .navigationBarTitleDisplayMode(.inline)
        // Re-runs when account status changes.
        .task(id: canUsePoint) {
            guard canUsePoint, let student = appSession.studentSession else { return }
            await store.load(student: student, kpId: point.id)
            selectInitialResource()
        }
        .tutorSidePanelMakesRoom(isPresented: showsTutorPanel)
        .sheet(isPresented: Binding(get: { isPhone && showsTutor }, set: { showsTutor = $0 })) {
            if let student = appSession.studentSession {
                LearningTutorSheet(
                    store: store,
                    student: student,
                    point: point
                )
            }
        }
    }

    private var learningColumn: some View {
        VStack(spacing: 0) {
            if isPhone { phoneLearningHeader } else { learningHeader }
            if store.bundle != nil {
                Divider()
                LearningResourceTabsView(
                    tabs: availableResources,
                    selection: $activeResource
                )
                if
                    activeResource != .card,
                    store.bundle?.card?.consumed == false
                {
                    cardReminder
                }
            }
            Divider()
            resourceContent
                .padding(.horizontal, isPhone ? (activeResource == .card ? 20 : 16) : 0)
                .background(isPhone && activeResource == .card ? Color(uiColor: .systemBackground) : Color.clear)
            if activeResource == .card, store.bundle?.card != nil {
                Divider()
                completionBar
            }
        }
    }

    /// iPad keeps the card readable next to the tutor; iPhone uses the sheet.
    private var showsTutorPanel: Bool { !isPhone && showsTutor }

    private var compactHeader: Bool { learningColumnWidth > 0 && learningColumnWidth < 600 }

    private func toggleTutor() {
        withAnimation(.easeInOut(duration: 0.22)) { showsTutor.toggle() }
    }

    private func closeTutor() {
        withAnimation(.easeInOut(duration: 0.22)) { showsTutor = false }
    }

    private var phoneLearningHeader: some View {
        HStack(spacing: 8) {
            SyncStatusBadge(text: point.masteryLabel, tone: point.badgeTone)
            Text("掌握度 \(point.masteryPercent)%").font(.caption).foregroundStyle(.secondary)
            Spacer(minLength: 0)
            Button { showsTutor = true } label: {
                Image(systemName: "sparkles").frame(width: 44, height: 44)
            }
            .buttonStyle(.plain).tint(OpenPhysicsTheme.accent)
            .accessibilityLabel("AI 助教").disabled(store.bundle == nil)
        }
        .padding(.horizontal, 16)
        .background(OpenPhysicsTheme.cardBackground)
    }

    private var learningHeader: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text(point.name)
                    .font(.title3.weight(.semibold))
                Text([point.volume, point.chapter, point.section].compactMap { $0 }.joined(separator: " / "))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(compactHeader ? 1 : nil)
            }
            Spacer()
            SyncStatusBadge(text: point.masteryLabel, tone: point.badgeTone)
                .fixedSize()
            // Portrait with the tutor open leaves ~450pt; the mastery tiles give way first.
            if !compactHeader {
                SyncMetric(value: "\(point.masteryPercent)%", label: "当前掌握")
                if let bundle = store.bundle, bundle.totalResourceCount > 0 {
                    SyncMetric(
                        value: "\(bundle.consumedResourceCount)/\(bundle.totalResourceCount)",
                        label: "学习进度"
                    )
                }
            }
            Button(action: toggleTutor) {
                Label("AI 助教", systemImage: "sparkles")
                    .lineLimit(1)
                    .fixedSize()
            }
            .buttonStyle(.bordered)
            .tint(OpenPhysicsTheme.accent)
            .disabled(store.bundle == nil)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 16)
        .background(Color(uiColor: .secondarySystemGroupedBackground))
    }

    private var canUsePoint: Bool {
        StudentAccessPolicy.canUseKnowledgePoint(point, for: appSession.studentSession)
    }

    private var lockedState: some View {
        ScrollView {
            AccountAccessPreviewView(
                title: "登录后学习本知识点",
                message: "知识卡、例题讲解和 AI 助教需要有效账号。请重新登录或联系部署管理员，已有记录会保留。"
            )
            .frame(maxWidth: 560)
            .padding(.vertical, 24)
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private var resourceContent: some View {
        if !canUsePoint || (store.requiresActiveAccount && store.bundle == nil) {
            lockedState
        } else if store.isLoading {
            VStack(spacing: 14) {
                ProgressView()
                    .controlSize(.regular)
                Text("正在准备学习资源…")
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if store.bundle == nil {
            learningErrorState
        } else {
            switch activeResource {
            case .card:
                cardContent
            case .video:
                if let student = appSession.studentSession {
                    LearningVideoRecommendationsView(
                        store: store,
                        student: student,
                        point: point
                    )
                }
            case .slides:
                LearningResourcePlaceholderView(
                    title: "微课功能即将上线",
                    symbol: "rectangle.on.rectangle"
                )
            case .interactive:
                LearningResourcePlaceholderView(
                    title: "模拟功能即将上线",
                    symbol: "slider.horizontal.3"
                )
            }
        }
    }

    @ViewBuilder
    private var cardContent: some View {
        if let card = store.bundle?.card {
            ZStack {
                KnowledgeCardPaneView(
                    card: card,
                    onRendered: { paneRendered = true },
                    onError: { paneMessage = $0 }
                )
                .padding(.vertical, isPhone ? 16 : 0)
                .opacity(paneRendered ? 1 : 0.01)
                if !paneRendered, paneMessage.isEmpty {
                    ProgressView("正在排版公式与图表…")
                }
                if !paneMessage.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.title)
                            .foregroundStyle(.orange)
                        Text(paneMessage)
                        Button("重新载入") {
                            paneMessage = ""
                            paneRendered = false
                            guard let student = appSession.studentSession else { return }
                            Task { await store.load(student: student, kpId: point.id) }
                        }
                        .buttonStyle(.bordered)
                    }
                }
            }
            .background(Color(uiColor: .systemBackground))
        } else {
            VStack(spacing: 14) {
                Image(systemName: "doc.text.magnifyingglass")
                    .font(.system(size: 42))
                    .foregroundStyle(.secondary)
                Text("这个知识点暂时没有知识卡")
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var learningErrorState: some View {
        VStack(spacing: 14) {
            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: 42))
                .foregroundStyle(.secondary)
            Text(store.message.isEmpty ? "这个知识点暂时没有学习资源" : store.message)
                .multilineTextAlignment(.center)
            Button("重新加载") {
                guard let student = appSession.studentSession else { return }
                Task {
                    await store.load(student: student, kpId: point.id)
                    selectInitialResource()
                }
            }
            .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var cardReminder: some View {
        OpenPhysicsAdaptiveStack(spacing: 12) {
            Label(
                "如果概念还没有理顺，建议先回到卡片完成主线学习。",
                systemImage: "info.circle"
            )
            .font(.callout)
            .foregroundStyle(.secondary)
            Spacer()
            Button("回到卡片") {
                activeResource = .card
            }
            .buttonStyle(.bordered)
            .tint(OpenPhysicsTheme.accent)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 10)
        .background(Color.orange.opacity(0.08))
    }

    private var availableResources: [LearningResourceTab] {
        guard let bundle = store.bundle else { return [] }
        var resources: [LearningResourceTab] = []
        if bundle.card != nil {
            resources.append(.card)
        }
        resources.append(.video)
        if bundle.slides != nil {
            resources.append(.slides)
        }
        if !bundle.simulations.isEmpty {
            resources.append(.interactive)
        }
        return resources
    }

    private func selectInitialResource() {
        guard let bundle = store.bundle else { return }
        if bundle.card != nil {
            activeResource = .card
        } else if !bundle.simulations.isEmpty {
            activeResource = .interactive
        } else if bundle.slides != nil {
            activeResource = .slides
        } else {
            activeResource = .video
        }
    }

    private var completionBar: some View {
        Group {
            if isPhone {
                VStack(spacing: 8) {
                    completionStatus.font(.footnote)
                    completionButton.frame(maxWidth: .infinity)
                }
            } else {
                HStack(spacing: 16) {
                    completionStatus.font(.callout)
                    Spacer()
                    completionButton
                }
            }
        }
        .padding(.horizontal, isPhone ? 16 : 24)
        .padding(.vertical, isPhone ? 10 : 14)
        .background(.bar)
    }

    @ViewBuilder
    private var completionStatus: some View {
        if !store.message.isEmpty, store.bundle?.card != nil {
            Label(store.message, systemImage: "exclamationmark.circle").foregroundStyle(.red)
        } else {
            Label(
                store.bundle?.card?.consumed == true ? "学习进度已同步" : "读完知识卡后，确认理解以更新学习进度",
                systemImage: store.bundle?.card?.consumed == true ? "checkmark.circle.fill" : "info.circle"
            )
            .foregroundStyle(store.bundle?.card?.consumed == true ? .green : .secondary)
        }
    }

    private var completionButton: some View {
        Button {
            if store.bundle?.card?.consumed == true {
                onCompleted()
                dismiss()
            } else {
                guard let student = appSession.studentSession else { return }
                Task {
                    if await store.complete(student: student) { onCompleted() }
                }
            }
        } label: {
            HStack {
                if store.isCompleting { ProgressView().tint(.white) }
                Text(store.bundle?.card?.consumed == true ? "返回学习路径" : store.isCompleting ? "正在同步…" : "我已理解")
            }
            .frame(maxWidth: isPhone ? .infinity : nil, minHeight: isPhone ? 32 : nil)
        }
        .buttonStyle(.borderedProminent).tint(OpenPhysicsTheme.accent).controlSize(.regular)
        .disabled(store.isCompleting || store.bundle?.card == nil || (store.bundle?.card?.consumed != true && (!paneRendered || !paneMessage.isEmpty)))
    }

}

private struct SyncMetric: View {
    let value: String
    let label: String

    var body: some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.headline)
                .foregroundStyle(OpenPhysicsTheme.accent)
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Color(uiColor: .tertiarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

private enum SyncBadgeTone {
    case primary
    case success
    case warning
    case neutral
    case band(MasteryColorBand)

    var foreground: Color {
        switch self {
        case .primary: return OpenPhysicsTheme.accent
        case .success: return .green
        case .warning: return .orange
        case .neutral: return .secondary
        case let .band(band): return Self.color(band.colors.2)
        }
    }

    var background: Color {
        if case let .band(band) = self { return Self.color(band.colors.0) }
        return foreground.opacity(0.12)
    }

    private static func color(_ hex: UInt) -> Color {
        Color(red: Double((hex >> 16) & 255) / 255, green: Double((hex >> 8) & 255) / 255, blue: Double(hex & 255) / 255)
    }
}

private struct SyncStatusBadge: View {
    let text: String
    let tone: SyncBadgeTone

    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .foregroundStyle(tone.foreground)
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(tone.background)
            .clipShape(Capsule())
    }
}

private extension SyncKnowledgePoint {
    var badgeTone: SyncBadgeTone {
        // A mastery judgment label ("发展中" …) takes the same colour as its band in the graph legend.
        if let judgment, judgment.confidence != "low", let band = MasteryColorBand(rawValue: judgment.masteryLevel) {
            return .band(band)
        }
        switch learningStateTone {
        case "mastered", "success": return .success
        case "practice", "warning": return .warning
        case "learning", "primary": return .primary
        default: return .neutral
        }
    }

}

/// Phone directory: the percentage takes its mastery band colour, with a thin bar, so weak points stand out.
private struct PhoneMasteryMeter: View {
    let percent: Int

    private var color: Color {
        let hex = MasteryColorBand.forPercent(percent).colors.2
        return Color(red: Double((hex >> 16) & 255) / 255, green: Double((hex >> 8) & 255) / 255, blue: Double(hex & 255) / 255)
    }

    var body: some View {
        VStack(alignment: .trailing, spacing: 6) {
            Text("\(percent)%").font(.subheadline.weight(.semibold).monospacedDigit()).foregroundStyle(color)
            ProgressView(value: Double(min(max(percent, 0), 100)), total: 100)
                .tint(color)
                .frame(width: 56)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("掌握度 \(percent)%")
    }
}
