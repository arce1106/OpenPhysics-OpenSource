import SwiftUI

private enum ReinforcementPracticePurpose: Equatable {
    case diagnostic
    case task(planId: String, taskId: String)
    case retest
    case standalone
}

struct ReinforcementView: View {
    @Environment(\.openPhysicsIsPhone) private var isPhone
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @EnvironmentObject private var appSession: AppSession
    @StateObject private var store = ReinforcementStore()
    @StateObject private var practiceStore = PracticeStore()
    @State private var practicePurpose: ReinforcementPracticePurpose = .standalone
    @State private var showsPractice = false
    @State private var learningPoint: SyncKnowledgePoint?
    @State private var showsLearning = false
    @State private var showsChapterChooser = false
    @State private var showsPlanDetail = false
    @State private var showsDiagnosticHistory = false
    @State private var historyChapter: ReinforcementChapterPlan?
    @State private var historyShowsAll = false

    private var historyScope: DiagnosticHistoryScope {
        guard !historyShowsAll, let chapter = historyChapter else { return .all }
        return .chapter(chapter.name)
    }

    private var phoneOverview: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let chapter = store.selectedChapter {
                    Button { showsChapterChooser = true } label: {
                        HStack(alignment: .center, spacing: 12) {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(chapter.volume).font(.footnote).foregroundStyle(.secondary)
                                Text(chapter.name).font(.title2.weight(.semibold)).foregroundStyle(.primary)
                            }.frame(maxWidth: .infinity, alignment: .leading)
                            Text("切换").font(.subheadline)
                            Image(systemName: "chevron.down").font(.caption.weight(.semibold))
                        }.frame(minHeight: 44).contentShape(Rectangle())
                    }.buttonStyle(.plain).tint(OpenPhysicsTheme.accent)
                    Text("已掌握 \(chapter.masteredCount) / \(chapter.knowledgePoints.count) 个知识点 · 当前 \(chapter.weakCount) 个薄弱点")
                        .font(.footnote).foregroundStyle(.secondary)
                    if accessRequired {
                        AccountAccessPreviewView(title: "登录后开启巩固提升", message: "可浏览全部章节，登录后开始单元检测、补弱路径和混合提升。已有记录和草稿会保留。")
                    }
                    if let plan = store.selectedChapterPlan, !plan.isCompleted {
                        recentPlanCard(plan)
                    } else if let report = store.selectedChapterReport {
                        latestReportCard(report)
                    } else if let plan = store.selectedChapterPlan {
                        recentPlanCard(plan)
                    } else if store.isLoadingChapterSummary {
                        ProgressView("正在读取本单元检测结果…")
                            .frame(maxWidth: .infinity, minHeight: 80)
                    }
                    // Only this chapter's plan can replace its assessment entry.
                    if !store.selectedChapterShowsPlanCard && !store.isLoadingChapterSummary {
                        OpenPhysicsPhoneGroup {
                            Button { startDiagnostic(chapter) } label: {
                                OpenPhysicsPhoneActionRow(title: "单元检测", detail: accessRequired ? "登录后开启" : "定位本章薄弱点，开始针对性提升", number: "01")
                            }.buttonStyle(.plain).disabled(store.isUpdatingPlan || practiceStore.isLoading)
                        }
                    }
                } else {
                    Button("选择章节") { showsChapterChooser = true }.frame(minHeight: 44)
                }
                Button { openDiagnosticHistory(store.selectedChapter) } label: {
                    Label("检测记录", systemImage: "clock").font(.subheadline).frame(maxWidth: .infinity, minHeight: 44)
                }
                if !store.message.isEmpty && store.message != StudentAccessPolicy.accountRequiredMessage {
                    Text(store.message).font(.footnote).foregroundStyle(.red)
                }
            }.padding(16)
        }.refreshable { await refreshPhone() }.tint(OpenPhysicsTheme.accent)
            .task(id: store.isLoading ? nil : store.selectedChapter?.id) {
                guard !store.isLoading, let student = appSession.studentSession else { return }
                await store.loadSelectedChapterSummary(student: student)
            }
    }

    private func refreshPhone() async {
        guard let student = appSession.studentSession else { return }
        await store.load(student: student, force: true)
    }

    private var accessRequired: Bool {
        !StudentAccessPolicy.hasFullLearningAccess(appSession.studentSession) || store.requiresActiveAccount
    }

    @MainActor init(store: ReinforcementStore? = nil) {
        _store = StateObject(wrappedValue: store ?? ReinforcementStore())
    }

    var body: some View {
        Group {
            if store.directory != nil, store.startData != nil {
                if !isPhone, showsPlanDetail, let plan = store.latestPlan {
                    improvementWorkspace(plan)
                } else if isPhone {
                    phoneOverview
                } else {
                    GeometryReader { proxy in
                        VStack(spacing: OpenPhysicsWorkspaceMetrics.panelSpacing) {
                            OpenPhysicsPageHeader(
                                title: "巩固提升",
                                subtitle: "按教材章节选择巩固路径，完成检测、补弱、回看和混合提升。",
                                refreshTitle: "刷新巩固路径",
                                isRefreshing: store.isLoading || store.isUpdatingPlan
                            ) {
                                guard let student = appSession.studentSession else { return }
                                Task { await store.load(student: student, force: true) }
                            }

                            HStack(
                                alignment: .top,
                                spacing: OpenPhysicsWorkspaceMetrics.panelSpacing
                            ) {
                                controlPanel
                                    .frame(
                                        width: OpenPhysicsWorkspaceMetrics.controlPanelWidth(
                                            for: proxy.size.width
                                        )
                                    )
                                routeWorkspace
                            }
                            .frame(maxHeight: .infinity, alignment: .top)
                        }
                        .padding(OpenPhysicsWorkspaceMetrics.pagePadding)
                    }
                }
            } else if store.isLoading {
                loadingState
            } else {
                unavailableState
            }
        }
        .background(OpenPhysicsTheme.pageBackground)
        .openPhysicsPrimaryNavigationChrome("巩固提升")
        .openPhysicsPhoneRefresh("刷新巩固路径", isRefreshing: store.isLoading || store.isUpdatingPlan, action: refreshPhone)
        .task(id: StudentAccessPolicy.hasFullLearningAccess(appSession.studentSession)) {
            guard let student = appSession.studentSession else { return }
            await store.load(student: student)
        }
        .navigationDestination(isPresented: Binding(
            get: { isPhone && showsPlanDetail }, set: { showsPlanDetail = $0 }
        )) {
            if let plan = store.latestPlan {
                improvementWorkspace(plan)
                    .background(OpenPhysicsTheme.pageBackground)
                    .navigationTitle("提升路径").navigationBarTitleDisplayMode(.inline)
                    .navigationDestination(isPresented: $showsPractice) { practiceDestination }
                    .navigationDestination(isPresented: $showsLearning) { learningDestination }
            }
        }
        .navigationDestination(isPresented: Binding(
            get: { (!isPhone || !showsPlanDetail) && showsPractice }, set: { showsPractice = $0 }
        )) {
            practiceDestination
        }
        .navigationDestination(isPresented: Binding(
            get: { (!isPhone || !showsPlanDetail) && showsLearning }, set: { showsLearning = $0 }
        )) {
            learningDestination
        }
        .sheet(isPresented: $showsChapterChooser) {
            chapterChooserSheet
        }
        .sheet(isPresented: $showsDiagnosticHistory) {
            diagnosticHistorySheet
        }
        .onChange(of: practiceStore.requiresLogin) { requiresLogin in
            if requiresLogin {
                appSession.logout(message: "登录已失效，请重新登录。")
            }
        }
    }

    private var practiceDestination: some View {
        PracticeWorkspaceView(
            store: practiceStore,
            onCompletion: completePractice,
            onScopeDiagnosticCompletion: { result in
                guard let student = appSession.studentSession else { return }
                Task { await store.createPlan(from: result, student: student) }
            },
            onImprovementRetestCompletion: { store.acceptRetestResult($0) }
        )
    }

    @ViewBuilder private var learningDestination: some View {
        if let learningPoint {
            KnowledgeLearningView(point: learningPoint) {
                guard let student = appSession.studentSession else { return }
                Task { await store.load(student: student, force: true) }
            }.toolbar(.visible, for: .navigationBar)
        }
    }

    private func improvementWorkspace(_ plan: ImprovementPlan) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                improvementHeader(plan)
                diagnosticSummary(plan)

                if let task = plan.currentTask {
                    currentRecommendedTask(task, plan: plan)
                } else if plan.readyForRetest {
                    readyForRetestCard(plan)
                } else if plan.isCompleted, let report = store.latestReport {
                    latestReportCard(report)
                }

                improvementPath(plan)

                if !store.message.isEmpty {
                    Label(store.message, systemImage: "exclamationmark.circle")
                        .font(.callout)
                        .foregroundStyle(.red)
                        .padding(.horizontal, 4)
                }
            }
            .frame(maxWidth: 1120, alignment: .leading)
            .padding(.horizontal, isPhone ? 16 : 24)
            .padding(.vertical, isPhone ? 16 : 20)
            .frame(maxWidth: .infinity)
        }
    }

    @ViewBuilder private func improvementHeader(_ plan: ImprovementPlan) -> some View {
        if isPhone {
            VStack(alignment: .leading, spacing: 8) {
                Text(plan.scopeName).font(.title2.weight(.semibold))
                Text("正确 \(plan.correctCount)/\(plan.totalCount) · \(plan.isCompleted ? "本轮已完成" : plan.readyForRetest ? "待复测" : "提升中")")
                    .font(.subheadline).foregroundStyle(.secondary)
            }.frame(maxWidth: .infinity, alignment: .leading)
        } else {
        OpenPhysicsAdaptiveStack(spacing: 16, alignment: .center) {
            OpenPhysicsBackButton { showsPlanDetail = false }

            VStack(alignment: .leading, spacing: 5) {
                Text(plan.isCompleted ? "本轮提升已完成" : "本章检测完成")
                    .font(.title.bold())
                Text("\(plan.scopeName) · 正确 \(plan.correctCount)/\(plan.totalCount)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            statusBadge(
                plan.isCompleted
                    ? "已完成"
                    : plan.readyForRetest ? "待复测" : "提升中",
                color: plan.isCompleted ? .green : .orange
            )
        }
        .padding(20)
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(Color(uiColor: .separator).opacity(0.3), lineWidth: 1)
        }
        }
    }

    private func diagnosticSummary(_ plan: ImprovementPlan) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(
                plan.weakCount > 0 ? "建议先回看薄弱知识" : "检测结果稳定",
                systemImage: plan.weakCount > 0
                    ? "lightbulb.max.fill"
                    : "checkmark.seal.fill"
            )
            .font(.headline)
            .foregroundStyle(OpenPhysicsTheme.accent)

            Text(
                plan.sourceResult?.feedback
                    ?? "本章掌握评估发现 \(plan.weakCount) 个需要继续巩固的知识点。"
            )
            .font(.body)

            Text(
                recommendationSummary(plan.sourceResult?.recommendation)
            )
            .font(.subheadline)
            .foregroundStyle(.secondary)

            if let task = plan.currentTask {
                Text("推荐下一步：先处理「\(task.kpName)」。")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(OpenPhysicsTheme.accent)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(OpenPhysicsTheme.accentSoft.opacity(0.72))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func recommendationSummary(_ recommendation: String?) -> String {
        if isPhone, let recommendation,
           ["study", "practice", "mastered"].contains(recommendation) {
            return diagnosticRecommendationLabel(recommendation)
        }
        return recommendation ?? "已经生成针对性提升路径，完成专项练习后再进入阶段复测。"
    }

    private func currentRecommendedTask(
        _ task: ImprovementTask,
        plan: ImprovementPlan
    ) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("当前推荐任务")
                .font(.headline)

            OpenPhysicsAdaptiveStack(spacing: 16, alignment: .center) {
                Text("\(task.priority)")
                    .font(.headline)
                    .foregroundStyle(OpenPhysicsTheme.accent)
                    .frame(width: 34, height: 34)
                    .background(OpenPhysicsTheme.accentSoft)
                    .clipShape(Circle())

                VStack(alignment: .leading, spacing: 7) {
                    Text("修复「\(task.kpName)」")
                        .font(.title3.weight(.semibold))
                    Text(task.reason)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    taskMasterySummary(task)
                }

                Spacer(minLength: 16)

                HStack(spacing: 10) {
                    Button("开始本步提升") {
                        startTask(task, plan: plan)
                    }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.capsule)
                    .tint(OpenPhysicsTheme.accent)
                    .disabled(store.isUpdatingPlan)

                    Button("回看知识") {
                        openKnowledge(for: task)
                    }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .tint(OpenPhysicsTheme.accent)
                    .disabled(knowledgePoint(for: task) == nil)
                }
            }
        }
        .padding(18)
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(OpenPhysicsTheme.accent.opacity(0.22), lineWidth: 1)
        }
    }

    private func readyForRetestCard(_ plan: ImprovementPlan) -> some View {
        OpenPhysicsAdaptiveStack(spacing: 16) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 34))
                .foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 5) {
                Text("专项提升已完成")
                    .font(.title3.weight(.semibold))
                Text("用一组阶段复测检查知识是否已经稳定迁移。")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("开始阶段复测") {
                startRetest(plan)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.capsule)
            .tint(OpenPhysicsTheme.accent)
            .disabled(practiceStore.isLoading)
        }
        .padding(18)
        .background(Color.orange.opacity(0.09))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private func improvementPath(_ plan: ImprovementPlan) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("提升路径")
                        .font(.title3.weight(.semibold))
                    Text("按知识结构逐项补齐，当前任务完成后自动推进。")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text("\(completedTaskCount(plan))/\(plan.tasks.count)")
                    .font(.title3.bold())
                    .foregroundStyle(OpenPhysicsTheme.accent)
            }

            ForEach(groupedTasks(plan), id: \.name) { group in
                VStack(alignment: .leading, spacing: 10) {
                    Text(group.name)
                        .font(.headline)
                        .foregroundStyle(OpenPhysicsTheme.accent)

                    ForEach(group.tasks) { task in
                        improvementTaskRow(task, plan: plan)
                    }
                }
            }
        }
        .padding(18)
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(Color(uiColor: .separator).opacity(0.3), lineWidth: 1)
        }
    }

    private func improvementTaskRow(
        _ task: ImprovementTask,
        plan: ImprovementPlan
    ) -> some View {
        let isCurrent = task.id == plan.currentTask?.id
        return OpenPhysicsAdaptiveStack(spacing: 14, alignment: .center) {
            Text("\(task.priority)")
                .font(.subheadline.bold())
                .foregroundStyle(
                    task.status == "passed" ? Color.green : OpenPhysicsTheme.accent
                )
                .frame(width: 32, height: 32)
                .background(
                    task.status == "passed"
                        ? Color.green.opacity(0.12)
                        : OpenPhysicsTheme.accentSoft
                )
                .clipShape(Circle())

            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Text(task.kpName)
                        .font(.headline)
                    if isCurrent {
                        statusBadge("当前", color: OpenPhysicsTheme.accent)
                    } else if task.status != "pending" {
                        statusBadge(
                            task.statusLabel,
                            color: task.status == "passed" ? .green : .orange
                        )
                    }
                }
                Text(task.reason)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                taskMasterySummary(task)
            }

            Spacer(minLength: 14)

            HStack(spacing: 8) {
                Button("回看知识") {
                    openKnowledge(for: task)
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .tint(OpenPhysicsTheme.accent)
                .disabled(knowledgePoint(for: task) == nil)

                if isCurrent {
                    Button("专项练") {
                        startTask(task, plan: plan)
                    }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.capsule)
                    .tint(OpenPhysicsTheme.accent)
                    .disabled(
                        !task.canPractice(planStatus: plan.status)
                            || store.isUpdatingPlan
                    )
                } else {
                    Button(task.actionLabel) {
                        startTask(task, plan: plan)
                    }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .tint(OpenPhysicsTheme.accent)
                    .disabled(
                        !task.canPractice(planStatus: plan.status)
                            || store.isUpdatingPlan
                    )
                }
            }
        }
        .padding(14)
        .background(
            isCurrent
                ? OpenPhysicsTheme.accentSoft.opacity(0.7)
                : Color(uiColor: .tertiarySystemGroupedBackground)
        )
        .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 15, style: .continuous)
                .stroke(
                    isCurrent ? OpenPhysicsTheme.accent.opacity(0.25) : .clear,
                    lineWidth: 1
                )
        }
    }

    private func taskMasterySummary(_ task: ImprovementTask) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 12) {
                Text("\(task.correctCount)/\(task.totalCount) 正确")
                Text("掌握度 \(Int((task.masteryAfter * 100).rounded()))%")
                    .fontWeight(.semibold)
                    .foregroundStyle(OpenPhysicsTheme.accent)
            }
            .font(.caption)
            ProgressView(value: task.masteryAfter, total: 1)
                .tint(OpenPhysicsTheme.accent)
                .frame(maxWidth: 360)
            Text(
                "\(Int((task.masteryBefore * 100).rounded()))% → \(Int((task.masteryAfter * 100).rounded()))%"
            )
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
    }

    private var chapterChooserSheet: some View {
        NavigationStack {
            controlPanel
                .padding(20)
                .background(OpenPhysicsTheme.pageBackground)
                .navigationTitle("选择其他章节")
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("完成") {
                            showsChapterChooser = false
                        }
                    }
                }
        }
        .presentationDetents([.large])
    }

    private var diagnosticHistorySheet: some View {
        NavigationStack {
            ZStack {
                if !isPhone, let attempt = store.selectedDiagnosticAttempt {
                    diagnosticAttemptDetail(attempt)
                } else {
                    diagnosticHistoryList
                }

                if store.isLoadingDiagnosticAttempt || store.isUpdatingPlan {
                    Color.black.opacity(0.08)
                        .ignoresSafeArea()
                    VStack(spacing: 12) {
                        ProgressView()
                        Text(
                            store.isLoadingDiagnosticAttempt
                                ? "正在加载检测结果…"
                                : "正在打开提升路径…"
                        )
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 28)
                    .padding(.vertical, 22)
                    .background(.regularMaterial)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
            }
            .background(OpenPhysicsTheme.pageBackground)
            .navigationTitle(
                isPhone || store.selectedDiagnosticAttempt == nil ? "检测历史" : "检测结果"
            )
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(isPresented: Binding(
                get: { isPhone && store.selectedDiagnosticAttempt != nil },
                set: { if !$0 { store.clearSelectedDiagnosticAttempt() } }
            )) {
                if let attempt = store.selectedDiagnosticAttempt {
                    diagnosticAttemptDetail(attempt)
                        .background(OpenPhysicsTheme.pageBackground)
                        .navigationTitle("检测结果").navigationBarTitleDisplayMode(.inline)
                }
            }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        showsDiagnosticHistory = false
                        store.clearSelectedDiagnosticAttempt()
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .accessibilityLabel("关闭检测历史")
                }
            }
        }
        .presentationDetents([.large])
        .task(id: historyScope) {
            guard let student = appSession.studentSession else { return }
            await store.loadDiagnosticHistory(student: student, scope: historyScope)
        }
    }

    private var diagnosticHistoryList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                if isPhone, historyChapter != nil {
                    Picker("记录范围", selection: $historyShowsAll) {
                        Text("本单元").tag(false)
                        Text("全部").tag(true)
                    }
                    .pickerStyle(.segmented)
                }
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(historyScope.chapterName ?? "章节与单元检测")
                            .font(.title3.weight(.semibold))
                        Text("回顾每次检测结果，以及由它生成的薄弱点提升路径。")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    if !store.diagnosticHistory.isEmpty {
                        statusBadge(
                            "已显示 \(store.diagnosticHistory.count)/\(store.diagnosticHistoryTotal)",
                            color: OpenPhysicsTheme.accent
                        )
                    }
                }
                .padding(18)
                .background(OpenPhysicsTheme.cardBackground)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

                if !store.diagnosticHistoryError.isEmpty {
                    HStack(spacing: 12) {
                        Label(
                            store.diagnosticHistoryError,
                            systemImage: "exclamationmark.circle"
                        )
                        .font(.subheadline)
                        .foregroundStyle(.red)
                        Spacer()
                        Button("重试") {
                            guard let student = appSession.studentSession else { return }
                            Task {
                                await store.loadDiagnosticHistory(
                                    student: student,
                                    scope: historyScope,
                                    reset: true
                                )
                            }
                        }
                        .buttonStyle(.bordered)
                        .buttonBorderShape(.capsule)
                    }
                    .padding(14)
                    .background(Color.red.opacity(0.06))
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }

                if store.isLoadingHistory && store.diagnosticHistory.isEmpty {
                    VStack(spacing: 12) {
                        ProgressView()
                        Text("正在加载检测历史…")
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, minHeight: 280)
                } else if store.diagnosticHistory.isEmpty && store.diagnosticHistoryError.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "clock.arrow.circlepath")
                            .font(.system(size: 36))
                            .foregroundStyle(OpenPhysicsTheme.accent)
                        Text(historyScope.chapterName == nil ? "暂无检测记录" : "本单元暂无检测记录")
                            .font(.title3.weight(.semibold))
                        Text(historyScope.chapterName == nil
                             ? "完成一次章节或单元检测后，会在这里生成历史记录。"
                             : "完成本单元检测后会生成记录，也可切换到“全部”查看其他单元。")
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, minHeight: 280)
                    .background(OpenPhysicsTheme.cardBackground)
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                } else {
                    ForEach(store.diagnosticHistory) { item in
                        diagnosticHistoryRow(item)
                    }

                    if store.hasMoreDiagnosticHistory {
                        Button {
                            guard let student = appSession.studentSession else { return }
                            Task {
                                await store.loadDiagnosticHistory(
                                    student: student,
                                    scope: historyScope,
                                    reset: false
                                )
                            }
                        } label: {
                            HStack {
                                if store.isLoadingHistory {
                                    ProgressView()
                                }
                                Text(store.isLoadingHistory ? "正在加载…" : "加载更多")
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .buttonBorderShape(.capsule)
                        .disabled(store.isLoadingHistory)
                    }
                }
            }
            .padding(20)
        }
    }

    private func diagnosticHistoryRow(
        _ item: ScopeDiagnosticAttemptListItem
    ) -> some View {
        let hasLinkedPlan = item.linkedPlanId?.isEmpty == false

        return Button {
            openDiagnosticHistoryItem(item)
        } label: {
            VStack(alignment: .leading, spacing: 10) {
                OpenPhysicsAdaptiveStack(spacing: 14, alignment: .top) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(hasLinkedPlan ? "对应提升路径" : "检测记录")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(OpenPhysicsTheme.accent)
                        Text(item.scopeName)
                            .font(.headline)
                            .foregroundStyle(.primary)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }

                HStack(spacing: 8) {
                    historyMetaChip(
                        historyDateLabel(item.submittedAt),
                        systemImage: "calendar"
                    )
                    historyMetaChip(
                        "正确 \(item.correctCount)/\(item.totalCount)",
                        systemImage: "checkmark.circle"
                    )
                    historyMetaChip(
                        "薄弱点 \(item.weakCount)",
                        systemImage: "exclamationmark.triangle",
                        color: item.weakCount > 0 ? .orange : .green
                    )
                }

                if let feedback = item.feedback, !feedback.isEmpty {
                    Text(feedback)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(16)
            .background(OpenPhysicsTheme.cardBackground)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(Color(uiColor: .separator).opacity(0.28), lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            hasLinkedPlan
                ? "查看\(item.scopeName)提升路径"
                : "查看\(item.scopeName)检测记录"
        )
    }

    private func diagnosticAttemptDetail(
        _ attempt: ScopeDiagnosticAttemptDetail
    ) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if isPhone {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(attempt.scopeName).font(.title2.weight(.semibold))
                        Text("检测于 \(historyDateLabel(attempt.submittedAt))").font(.footnote).foregroundStyle(.secondary)
                        statusBadge(diagnosticRecommendationLabel(attempt.recommendation), color: attempt.weakCount > 0 ? .orange : .green)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                } else {
                HStack(spacing: 12) {
                    Button {
                        store.clearSelectedDiagnosticAttempt()
                    } label: {
                        Label("返回检测历史", systemImage: "chevron.left")
                    }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)

                    VStack(alignment: .leading, spacing: 3) {
                        Text(attempt.scopeName)
                            .font(.title3.weight(.semibold))
                        Text("检测时间 \(historyDateLabel(attempt.submittedAt))")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    statusBadge(
                        diagnosticRecommendationLabel(attempt.recommendation),
                        color: attempt.weakCount > 0 ? .orange : .green
                    )
                }
                .padding(18)
                .background(OpenPhysicsTheme.cardBackground)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                }

                if isPhone {
                    OpenPhysicsPhoneGroup {
                        LabeledContent("正确率", value: "\(attempt.accuracyPercent)%").padding(16)
                        Divider().padding(.leading, 16)
                        LabeledContent("正确 / 总题数", value: "\(attempt.correctCount) / \(attempt.totalCount)").padding(16)
                        Divider().padding(.leading, 16)
                        LabeledContent("薄弱知识点", value: "\(attempt.weakCount)").padding(16)
                    }.font(.subheadline)
                } else {
                HStack(spacing: 0) {
                    metric("\(attempt.accuracyPercent)%", label: "正确率")
                    metric("\(attempt.correctCount)/\(attempt.totalCount)", label: "正确")
                    metric("\(attempt.weakCount)", label: "薄弱点")
                    metric(attempt.scopeType == "section" ? "小节" : "章节", label: "检测范围")
                }
                .background(OpenPhysicsTheme.cardBackground)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("检测反馈")
                        .font(.headline)
                    Text(
                        attempt.feedback?.isEmpty == false
                            ? attempt.feedback ?? ""
                            : "本次检测结果已记录。"
                    )
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(18)
                .background(OpenPhysicsTheme.cardBackground)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

                VStack(alignment: .leading, spacing: 12) {
                    Text("知识点表现")
                        .font(.headline)
                    if attempt.kpResults.isEmpty {
                        Text("暂无知识点明细")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, minHeight: 80)
                    } else {
                        ForEach(
                            attempt.kpResults.sorted {
                                if $0.isWeak != $1.isWeak { return $0.isWeak }
                                return $0.kpName < $1.kpName
                            },
                            id: \.stableID
                        ) { item in
                            diagnosticKnowledgePointRow(item)
                        }
                    }
                }
                .padding(18)
                .background(OpenPhysicsTheme.cardBackground)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

                VStack(alignment: .leading, spacing: 12) {
                    let hasLinkedPlan = attempt.linkedPlanId?.isEmpty == false

                    OpenPhysicsAdaptiveStack(spacing: 8) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("关联提升路径")
                                .font(.headline)
                            Text(
                                hasLinkedPlan
                                    ? "本次检测已关联提升路径：\(diagnosticPlanStatusLabel(attempt.linkedPlanStatus))"
                                    : "本次检测尚未关联提升路径"
                            )
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        }
                        Spacer()
                        if let planId = attempt.linkedPlanId, !planId.isEmpty {
                            Button("查看提升路径") {
                                openLinkedPlan(
                                    id: planId,
                                    reportAvailable: attempt.linkedReportAvailable
                                )
                            }
                            .buttonStyle(.borderedProminent)
                            .buttonBorderShape(.capsule)
                            .tint(OpenPhysicsTheme.accent)
                        }
                    }

                    Divider()

                    HStack {
                        Button("回到巩固提升") {
                            showsDiagnosticHistory = false
                            store.clearSelectedDiagnosticAttempt()
                        }
                        .buttonStyle(.bordered)
                        .buttonBorderShape(.capsule)
                        Spacer()
                        Button("重新检测") {
                            rediagnose(attempt)
                        }
                        .buttonStyle(.bordered)
                        .buttonBorderShape(.capsule)
                        .tint(OpenPhysicsTheme.accent)
                    }
                }
                .padding(18)
                .background(OpenPhysicsTheme.cardBackground)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
            .padding(isPhone ? 16 : 20)
        }
    }

    private func diagnosticKnowledgePointRow(
        _ item: ScopeDiagnosticKnowledgePointResult
    ) -> some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text(item.kpName)
                    .font(.subheadline.weight(.semibold))
                if let groupName = item.groupName, !groupName.isEmpty {
                    Text(groupName)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text(
                    "正确 \(item.correctCount)/\(item.totalCount) · 掌握度 \(masteryPercent(item.masteryBefore)) → \(masteryPercent(item.masteryAfter))"
                )
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer()
            statusBadge(item.isWeak ? "薄弱" : "稳定", color: item.isWeak ? .orange : .green)
        }
        .padding(14)
        .background(Color(uiColor: .tertiarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func historyMetaChip(
        _ text: String,
        systemImage: String,
        color: Color = .secondary
    ) -> some View {
        Label(text, systemImage: systemImage)
            .font(.caption)
            .foregroundStyle(color)
            .padding(.horizontal, 9)
            .frame(height: 28)
            .background(color.opacity(0.08))
            .clipShape(Capsule())
    }

    private var controlPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 5) {
                Text("选择教材与章节")
                    .font(.title3.weight(.semibold))
            }
            .padding(.horizontal, 18)
            .padding(.top, 12)
            .padding(.bottom, 8)

            Picker(
                "教材",
                selection: Binding(
                    get: { store.selectedVolume },
                    set: store.selectVolume
                )
            ) {
                ForEach(store.chapterPlans.map(\.volume).uniqueValues, id: \.self) {
                    Text($0).tag($0)
                }
            }
            .pickerStyle(.menu)
            .tint(OpenPhysicsTheme.accent)
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .background(OpenPhysicsTheme.accentSoft)
            .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
            .padding(.horizontal, 18)

            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(store.visibleChapterPlans) { plan in
                        chapterRow(plan)
                    }
                }
                .padding(14)
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

    private func chapterRow(_ plan: ReinforcementChapterPlan) -> some View {
        let selected = store.selectedChapter?.id == plan.id
        return Button {
            store.selectChapter(plan)
        } label: {
            VStack(alignment: .leading, spacing: 9) {
                // Title gets the full width; the badge beside it squeezed names into three lines.
                Text(plan.name)
                    .font(.headline)
                    .multilineTextAlignment(.leading)
                    .foregroundStyle(selected ? OpenPhysicsTheme.accent : .primary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: 8) {
                    statusBadge(
                        plan.statusLabel,
                        color: statusColor(plan.statusLabel)
                    )
                    .fixedSize()
                    Text("\(plan.masteredCount)/\(plan.knowledgePoints.count) 已掌握")
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    Spacer()
                    Text("\(plan.averageMasteryPercent)%")
                        .fontWeight(.semibold)
                        .foregroundStyle(OpenPhysicsTheme.accent)
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                ProgressView(
                    value: Double(plan.averageMasteryPercent),
                    total: 100
                )
                .tint(OpenPhysicsTheme.accent)
            }
            .padding(13)
            .background(
                selected
                    ? OpenPhysicsTheme.accentSoft
                    : Color(uiColor: .tertiarySystemGroupedBackground)
            )
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(
                        selected ? OpenPhysicsTheme.accent.opacity(0.32) : .clear,
                        lineWidth: 1
                    )
            }
        }
        .buttonStyle(.plain)
    }

    private var routeWorkspace: some View {
        GeometryReader { proxy in
            ScrollView {
                VStack(spacing: 16) {
                    if accessRequired {
                        AccountAccessPreviewView(
                            title: "登录后开启巩固提升",
                            message: "可先浏览全部章节和训练路径，登录后开始单元检测、补弱路径和混合提升。已有记录和草稿会保留。"
                        )
                    }
                    if let plan = store.latestPlan, !plan.isCompleted {
                        recentPlanCard(plan)
                    } else if let report = store.latestReport {
                        latestReportCard(report)
                    } else if let plan = store.latestPlan {
                        recentPlanCard(plan)
                    }
                    if let chapter = store.selectedChapter {
                        // The result card above already offers 重新检测 for this chapter.
                        currentChapterCard(
                            chapter,
                            showsDiagnosticEntry: shownTabletPlan?.scopeId != chapter.name
                        )
                    }
                    if !store.message.isEmpty && store.message != StudentAccessPolicy.accountRequiredMessage {
                        Label(store.message, systemImage: "exclamationmark.circle")
                            .font(.callout)
                            .foregroundStyle(.red)
                            .padding(.horizontal, 4)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .frame(
                    minHeight: proxy.size.height,
                    alignment: .top
                )
            }
        }
    }

    private func recentPlanCard(_ plan: ImprovementPlan) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("最近检测结果")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(OpenPhysicsTheme.accent)
                    Text(plan.scopeName)
                        .font(.title3.weight(.semibold))
                    Text(
                        "正确 \(plan.correctCount)/\(plan.totalCount) · 本次检测发现 \(plan.weakCount) 个薄弱点"
                    )
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                }
                Spacer()
                statusBadge(
                    plan.readyForRetest ? "待复测" : plan.isCompleted ? "已完成" : "提升中",
                    color: plan.isCompleted ? .green : .orange
                )
            }

            Divider()

            if isPhone {
                VStack(spacing: 10) {
                    continuePlanButton(plan)
                    if dynamicTypeSize < .xxLarge {
                        HStack(spacing: 10) {
                            planResultsButton
                            rediagnoseButton(plan)
                        }
                    } else {
                        VStack(spacing: 10) {
                            planResultsButton
                            rediagnoseButton(plan)
                        }
                    }
                }
            } else {
                HStack(spacing: 10) {
                    Spacer()
                    planResultsButton
                    continuePlanButton(plan)
                    rediagnoseButton(plan)
                }
            }
        }
        .padding(18)
        .background(Color.orange.opacity(0.09))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(Color.orange.opacity(0.32), lineWidth: 1)
        }
    }

    private var planResultsButton: some View {
        Button { showsPlanDetail = true } label: {
            planActionLabel("查看检测结果")
        }
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .tint(OpenPhysicsTheme.accent)
    }

    private func continuePlanButton(_ plan: ImprovementPlan) -> some View {
        Button { continueImprovement(plan) } label: {
            planActionLabel(plan.readyForRetest ? "开始阶段复测" : "继续薄弱点提升")
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.capsule)
        .tint(OpenPhysicsTheme.accent)
        .disabled(store.isUpdatingPlan || (plan.currentTask == nil && !plan.readyForRetest))
    }

    private func rediagnoseButton(_ plan: ImprovementPlan) -> some View {
        Button { rediagnose(plan) } label: {
            planActionLabel("重新检测")
        }
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .tint(OpenPhysicsTheme.accent)
        .disabled(store.isUpdatingPlan)
    }

    private func planActionLabel(_ title: String) -> some View {
        Text(title)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: isPhone ? .infinity : nil, minHeight: isPhone ? 32 : nil)
    }

    private func latestReportCard(_ report: ImprovementReport) -> some View {
        let summary = report.summary
        return OpenPhysicsAdaptiveStack(spacing: 18) {
            Image(systemName: "chart.line.uptrend.xyaxis.circle.fill")
                .font(.system(size: 38))
                .foregroundStyle(.green)
            VStack(alignment: .leading, spacing: 5) {
                Text("最近提升报告")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(OpenPhysicsTheme.accent)
                Text(summary.scopeName)
                    .font(.title3.weight(.semibold))
                Text(
                    "已通过 \(summary.passedTaskCount)/\(summary.taskCount) 个任务"
                )
                .font(.subheadline)
                .foregroundStyle(.secondary)
            }
            Spacer()
            statusBadge("已完成", color: .green)
        }
        .padding(18)
        .background(Color.green.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    /// The plan whose result card the iPad layout is showing, if any.
    private var shownTabletPlan: ImprovementPlan? {
        guard let plan = store.latestPlan, plan.scopeType == "chapter" else { return nil }
        return !plan.isCompleted || store.latestReport == nil ? plan : nil
    }

    private func currentChapterCard(
        _ chapter: ReinforcementChapterPlan,
        showsDiagnosticEntry: Bool = true
    ) -> some View {
        VStack(spacing: 0) {
            OpenPhysicsAdaptiveStack(spacing: 14, alignment: .top) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("当前章节训练路径")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(OpenPhysicsTheme.accent)
                    Text("\(chapter.volume) · \(chapter.name)")
                        .font(.title3.weight(.semibold))
                }
                Spacer()
                statusBadge(
                    chapter.statusLabel,
                    color: statusColor(chapter.statusLabel)
                )
            }
            .padding(18)

            Divider()
            HStack(spacing: 0) {
                metric("\(chapter.knowledgePoints.count)", label: "知识点")
                metric("\(chapter.masteredCount)", label: "已掌握")
                metric("\(chapter.weakCount)", label: "当前薄弱点")
                metric("\(chapter.averageMasteryPercent)%", label: "平均掌握")
            }
            .background(OpenPhysicsTheme.pageBackground)
            Divider()

            VStack(spacing: 10) {
                if showsDiagnosticEntry {
                    routeActionRow(
                        title: "单元检测",
                        detail: "先用少量题判断本章哪些知识点还不稳。",
                        action: accessRequired ? "登录后检测" : "开始检测",
                        primary: true,
                        enabled: !store.isUpdatingPlan
                    ) {
                        startDiagnostic(chapter)
                    }
                }
                routeActionRow(
                    title: "检测历史",
                    detail: "查看本章以往检测结果和对应薄弱点。",
                    action: "查看检测历史",
                    primary: false,
                    enabled: !store.isLoadingHistory
                ) {
                    openDiagnosticHistory(chapter)
                }
            }
            .padding(16)
        }
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(Color(uiColor: .separator).opacity(0.3), lineWidth: 1)
        }
    }

    private func routeActionRow(
        title: String,
        detail: String,
        action: String,
        primary: Bool,
        enabled: Bool,
        onTap: @escaping () -> Void
    ) -> some View {
        OpenPhysicsAdaptiveStack(spacing: isPhone ? 10 : 16) {
            VStack(alignment: .leading, spacing: 5) {
                Text(title)
                    .font(.headline)
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            if !isPhone { Spacer() }
            if primary {
                Button(action: onTap) {
                    planActionLabel(action)
                }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.capsule)
                    .tint(OpenPhysicsTheme.accent)
                    .frame(minWidth: isPhone ? nil : 132)
                    .disabled(!enabled)
            } else {
                Button(action: onTap) {
                    planActionLabel(action)
                }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .tint(OpenPhysicsTheme.accent)
                    .frame(minWidth: isPhone ? nil : 132)
                    .disabled(!enabled)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, minHeight: 82, alignment: .leading)
        .background(Color(uiColor: .tertiarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 15, style: .continuous)
                .stroke(Color(uiColor: .separator).opacity(0.2), lineWidth: 1)
        }
    }

    private func metric(_ value: String, label: String) -> some View {
        VStack(spacing: 5) {
            Text(value)
                .font(.title3.weight(.semibold))
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
    }

    private func statusBadge(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 10)
            .frame(height: 28)
            .background(color.opacity(0.11))
            .clipShape(Capsule())
    }

    private var loadingState: some View {
        VStack(spacing: 14) {
            ProgressView()
            Text("正在整理巩固路径…")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var unavailableState: some View {
        VStack(spacing: 16) {
            Image(systemName: "target")
                .font(.system(size: 42))
                .foregroundStyle(OpenPhysicsTheme.accent)
            Text("暂时无法加载巩固路径")
                .font(.title3.weight(.semibold))
            Text(store.message)
                .foregroundStyle(.secondary)
            Button("重新加载") {
                guard let student = appSession.studentSession else { return }
                Task { await store.load(student: student, force: true) }
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.capsule)
            .tint(OpenPhysicsTheme.accent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func matchingPlan(
        for chapter: ReinforcementChapterPlan
    ) -> ImprovementPlan? {
        guard
            let plan = store.latestPlan,
            plan.scopeType == "chapter",
            plan.scopeId == chapter.name
        else { return nil }
        return plan
    }

    private func groupedTasks(
        _ plan: ImprovementPlan
    ) -> [(name: String, tasks: [ImprovementTask])] {
        var order: [String] = []
        var groups: [String: [ImprovementTask]] = [:]
        for task in plan.tasks.sorted(by: { $0.priority < $1.priority }) {
            let name = task.groupName?.trimmingCharacters(in: .whitespacesAndNewlines)
            let key = (name?.isEmpty == false ? name : nil) ?? "其他知识点"
            if groups[key] == nil {
                order.append(key)
                groups[key] = []
            }
            groups[key, default: []].append(task)
        }
        return order.map { ($0, groups[$0, default: []]) }
    }

    private func completedTaskCount(_ plan: ImprovementPlan) -> Int {
        plan.tasks.filter {
            ["passed", "practiced", "needs_retest"].contains($0.status)
        }.count
    }

    private func knowledgePoint(
        for task: ImprovementTask
    ) -> SyncKnowledgePoint? {
        store.chapterPlans
            .lazy
            .flatMap(\.knowledgePoints)
            .first { $0.id == task.kpId }
    }

    private func openKnowledge(for task: ImprovementTask) {
        guard let point = knowledgePoint(for: task) else { return }
        learningPoint = point
        showsLearning = true
    }

    private func weakStepTarget(
        _ chapter: ReinforcementChapterPlan
    ) -> SyncKnowledgePoint? {
        if let task = matchingPlan(for: chapter)?.currentTask {
            return chapter.knowledgePoints.first { $0.id == task.kpId }
        }
        return chapter.firstWeakKnowledgePoint
    }

    private func reviewTarget(
        _ chapter: ReinforcementChapterPlan
    ) -> SyncKnowledgePoint? {
        weakStepTarget(chapter)
            ?? chapter.knowledgePoints.first { $0.learningState != "mastered" }
            ?? chapter.knowledgePoints.first
    }

    private func startDiagnostic(_ chapter: ReinforcementChapterPlan) {
        guard allowSubscribedEntry() else { return }
        guard let student = appSession.studentSession else { return }
        Task {
            if await practiceStore.startScopeDiagnostic(
                student: student,
                scopeId: chapter.name,
                scopeName: chapter.name,
                count: 10
            ) {
                practicePurpose = .diagnostic
                showsPractice = true
            }
        }
    }

    private func openDiagnosticHistory(_ chapter: ReinforcementChapterPlan?) {
        store.clearSelectedDiagnosticAttempt()
        historyChapter = chapter
        historyShowsAll = !isPhone || chapter == nil
        showsDiagnosticHistory = true
    }

    private func openDiagnosticHistoryItem(
        _ item: ScopeDiagnosticAttemptListItem
    ) {
        guard let student = appSession.studentSession else { return }
        if let planId = item.linkedPlanId, !planId.isEmpty {
            openLinkedPlan(
                id: planId,
                reportAvailable: item.linkedReportAvailable
            )
            return
        }
        Task {
            await store.loadDiagnosticAttempt(id: item.attemptId, student: student)
        }
    }

    private func openLinkedPlan(
        id: String,
        reportAvailable: Bool
    ) {
        guard let student = appSession.studentSession else { return }
        Task {
            if await store.loadLinkedPlan(
                id: id,
                reportAvailable: reportAvailable,
                student: student
            ) {
                showsDiagnosticHistory = false
                store.clearSelectedDiagnosticAttempt()
                showsPlanDetail = true
            }
        }
    }

    private func rediagnose(_ attempt: ScopeDiagnosticAttemptDetail) {
        guard let student = appSession.studentSession else { return }
        Task {
            if await practiceStore.startScopeDiagnostic(
                student: student,
                scopeType: attempt.scopeType,
                scopeId: attempt.scopeId,
                scopeName: attempt.scopeName,
                count: 10
            ) {
                showsDiagnosticHistory = false
                store.clearSelectedDiagnosticAttempt()
                practicePurpose = .diagnostic
                showsPractice = true
            }
        }
    }

    private func historyDateLabel(_ value: String) -> String {
        let fractionalFormatter = ISO8601DateFormatter()
        fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let standardFormatter = ISO8601DateFormatter()
        guard
            let date = fractionalFormatter.date(from: value)
                ?? standardFormatter.date(from: value)
        else { return value }
        return date.formatted(
            .dateTime
                .month(.twoDigits)
                .day(.twoDigits)
                .hour(.twoDigits(amPM: .omitted))
                .minute(.twoDigits)
        )
    }

    private func diagnosticRecommendationLabel(_ value: String?) -> String {
        switch value {
        case "study": return "建议回看"
        case "practice": return "建议练习"
        case "mastered": return "整体稳定"
        default: return "仅检测"
        }
    }

    private func diagnosticPlanStatusLabel(_ value: String?) -> String {
        switch value {
        case "diagnosed": return "已生成提升路径"
        case "in_progress": return "提升中"
        case "ready_for_retest": return "待阶段复测"
        case "completed": return "已完成提升"
        default: return "仅检测"
        }
    }

    private func masteryPercent(_ value: Double) -> String {
        "\(Int((value * 100).rounded()))%"
    }

    private func startTask(_ task: ImprovementTask, plan: ImprovementPlan) {
        guard allowSubscribedEntry() else { return }
        guard let student = appSession.studentSession else { return }
        Task {
            if await store.startTask(
                task,
                plan: plan,
                student: student,
                practiceStore: practiceStore
            ) {
                practicePurpose = .task(planId: plan.id, taskId: task.id)
                showsPractice = true
            }
        }
    }

    private func continueImprovement(_ plan: ImprovementPlan) {
        if let task = plan.currentTask {
            startTask(task, plan: plan)
        } else if plan.readyForRetest {
            startRetest(plan)
        }
    }

    private func rediagnose(_ plan: ImprovementPlan) {
        guard allowSubscribedEntry() else { return }
        guard let student = appSession.studentSession else { return }
        Task {
            if await practiceStore.startScopeDiagnostic(
                student: student,
                scopeType: plan.scopeType,
                scopeId: plan.scopeId,
                scopeName: plan.scopeName,
                count: 10
            ) {
                practicePurpose = .diagnostic
                showsPractice = true
            }
        }
    }

    private func startRetest(_ plan: ImprovementPlan) {
        guard allowSubscribedEntry() else { return }
        guard let student = appSession.studentSession else { return }
        Task {
            if await practiceStore.startImprovementRetest(
                student: student,
                planId: plan.id
            ) {
                practicePurpose = .retest
                showsPractice = true
            }
        }
    }

    private func allowSubscribedEntry() -> Bool {
        guard !accessRequired else {
            appSession.showsAccountNotice = true
            return false
        }
        return true
    }

    private func completePractice() {
        guard let student = appSession.studentSession else { return }
        let purpose = practicePurpose
        // Leaving a task part-way only refreshes the plan; the task counts once every question is graded.
        let finishedEveryQuestion = practiceStore.isComplete
        Task {
            if case let .task(planId, taskId) = purpose, finishedEveryQuestion {
                await store.completeTask(
                    planId: planId,
                    taskId: taskId,
                    student: student
                )
            } else {
                await store.load(student: student, force: true)
            }
        }
    }

    private func statusColor(_ status: String) -> Color {
        switch status {
        case "已稳定": return .green
        case "有薄弱", "待检测": return .orange
        default: return OpenPhysicsTheme.accent
        }
    }

}

private extension Array where Element: Hashable {
    var uniqueValues: [Element] {
        var seen = Set<Element>()
        return filter { seen.insert($0).inserted }
    }
}
