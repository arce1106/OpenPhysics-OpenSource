import SwiftUI

struct GaokaoReviewView: View {
    @Environment(\.openPhysicsIsPhone) private var isPhone
    @State private var showsPhoneTopic = false
    @State private var showsPhoneProgress = false
    @EnvironmentObject private var appSession: AppSession
    @StateObject private var store = GaokaoReviewStore()
    @StateObject private var practiceStore = PracticeStore()
    @State private var showsPractice = false

    private var accessRequired: Bool {
        !StudentAccessPolicy.hasFullLearningAccess(appSession.studentSession)
            || practiceStore.message == StudentAccessPolicy.accountRequiredMessage
    }

    private let trainingLayers: [LearningCatalogTopicLayer] = [
        .foundation,
        .breakthrough,
        .transfer]

    @MainActor init(store: GaokaoReviewStore? = nil, showsTopic: Bool = false) {
        _showsPhoneTopic = State(initialValue: showsTopic)
        _store = StateObject(wrappedValue: store ?? GaokaoReviewStore())
    }

    var body: some View {
        Group {
            if let catalog = store.catalog {
                if isPhone {
                    phoneCatalog(catalog)
                } else {
                GeometryReader { proxy in
                    VStack(spacing: OpenPhysicsWorkspaceMetrics.panelSpacing) {
                        pageHeader(catalog)

                        HStack(
                            alignment: .top,
                            spacing: OpenPhysicsWorkspaceMetrics.panelSpacing
                        ) {
                            catalogPanel(catalog)
                                .frame(
                                    width: OpenPhysicsWorkspaceMetrics.controlPanelWidth(
                                        for: proxy.size.width
                                    )
                                )
                            topicWorkbench
                        }
                        .frame(maxHeight: .infinity, alignment: .top)
                    }
                    .padding(OpenPhysicsWorkspaceMetrics.pagePadding)
                }
                }
            } else if store.isLoadingCatalog {
                loadingState
            } else {
                unavailableState
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(OpenPhysicsTheme.pageBackground)
        .openPhysicsPrimaryNavigationChrome("高考复习")
        .openPhysicsPhoneRefresh("刷新专题", isRefreshing: store.isLoadingCatalog || store.isLoadingOverview, action: refreshPhone)
        .task {
            guard let student = appSession.studentSession else { return }
            await store.load(student: student)
        }
        .navigationDestination(isPresented: Binding(
            get: { isPhone && showsPhoneTopic },
            set: { showsPhoneTopic = $0 }
        )) {
            phoneTopicWorkbench
        }
        .navigationDestination(isPresented: Binding(get: { !isPhone && showsPractice }, set: { showsPractice = $0 })) {
            practiceDestination
        }
        .onChange(of: practiceStore.learningCatalogOverview) { overview in
            if let overview {
                store.acceptOverview(overview)
            }
        }
        .onChange(of: StudentAccessPolicy.hasFullLearningAccess(appSession.studentSession)) { active in
            if active { practiceStore.clearAccountNotice() }
        }
        .onChange(of: store.requiresLogin || practiceStore.requiresLogin) { expired in
            if expired {
                appSession.logout(message: "登录已失效，请重新登录。")
            }
        }
    }

    private func refreshPhone() async {
        guard let student = appSession.studentSession else { return }
        await practiceStore.retryLearningCatalogEvidence(student: student)
        await store.load(student: student, force: true)
        await store.refreshSelected(student: student)
    }

    private var practiceDestination: some View {
        PracticeWorkspaceView(store: practiceStore) {
            guard let student = appSession.studentSession else { return }
            Task {
                await practiceStore.retryLearningCatalogEvidence(student: student)
                await store.refreshSelected(student: student)
            }
        }
    }

    private func phoneCatalog(_ catalog: LearningCatalogData) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                Text("\(catalog.knowledgeBlocks.count) 个知识板块 · \(catalog.topicCount) 个专题")
                    .font(.footnote).foregroundStyle(.secondary)
                    .padding(.horizontal, 4)
                ForEach(catalog.knowledgeBlocks) { block in
                    blockSection(block)
                }
            }
            .padding(16)
        }
        .refreshable { await refreshPhone() }
    }

    private var phoneTopicWorkbench: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if accessRequired {
                    AccountAccessPreviewView(title: "登录后开启高考复习", message: "可浏览全部专题和复习路径，登录后开始摸底、分层训练和套卷。")
                }
                if store.isLoadingOverview {
                    workbenchLoadingState
                } else if let overview = store.overview, let topic = store.selectedTopic {
                    phoneTopicPath(topic: topic, overview: overview)
                } else if store.selectedTopic == nil {
                    emptyTopicState
                } else {
                    overviewErrorState
                }
            }.padding(16)
        }
        .background(OpenPhysicsTheme.pageBackground)
        .navigationTitle("专题复习").navigationBarTitleDisplayMode(.inline)
        .navigationDestination(isPresented: $showsPractice) { practiceDestination }
        .refreshable { await refreshPhone() }
        .openPhysicsPhoneRefresh("刷新学情", isRefreshing: store.isLoadingOverview, action: refreshPhone)
        .sheet(isPresented: $showsPhoneProgress) {
            NavigationStack {
                if let overview = store.overview {
                    List {
                        Section {
                            LabeledContent("核心知识点", value: "\(overview.coreKnowledgePointCount)")
                            LabeledContent("已检测", value: "\(overview.attemptedKnowledgePointCount)")
                            LabeledContent("待检测", value: "\(overview.untestedKnowledgePointCount)")
                            LabeledContent("作答记录", value: "\(overview.evidenceCount ?? 0)")
                        } footer: {
                            Text("专题表现按已作答题目的得分计算；未练知识点待检测，不计零分。")
                        }
                        Section("最近学习") {
                            Text(overview.topicPerformanceLabel)
                            Text(overview.recentPracticeLabel).foregroundStyle(.secondary)
                        }
                    }
                    .navigationTitle("专题学情").navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { showsPhoneProgress = false } } }
                }
            }
            .presentationDetents([.medium, .large])
            .tint(OpenPhysicsTheme.accent)
        }
    }

    private func phoneTopicPath(topic: LearningCatalogNode, overview: LearningCatalogTopicOverview) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 8) {
                Text("专题 \(overview.topicCode)").font(.caption.weight(.semibold)).foregroundStyle(OpenPhysicsTheme.accent)
                Text(overview.title).font(.title2.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                Button { showsPhoneProgress = true } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("已检测 \(overview.attemptedKnowledgePointCount) / \(overview.coreKnowledgePointCount) 个知识点 · \(overview.evidenceCount ?? 0) 次作答")
                            .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                        HStack(spacing: 4) {
                            Text("学情")
                            Image(systemName: "chevron.right")
                        }.foregroundStyle(OpenPhysicsTheme.accent).fixedSize()
                    }.font(.footnote).frame(minHeight: 44).contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityIdentifier("gaokao.progress")
            }

            Button {
                startSession(overview.hasLearningEvidence ? overview.recommendedLayer : .diagnostic, topic: topic)
            } label: {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(accessRequired ? "登录后开始复习" : overview.hasLearningEvidence ? "继续专题复习" : "专题摸底")
                            .font(.callout.weight(.semibold))
                        Text(overview.hasLearningEvidence ? "推荐：\(overview.recommendedLayerName)" : "8 题，了解当前掌握情况")
                            .font(.footnote).foregroundStyle(Color.secondary)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                    if practiceStore.isLoading { ProgressView() }
                    else { Image(systemName: "arrow.right.circle.fill").font(.title) }
                }
                .padding(16).foregroundStyle(OpenPhysicsTheme.accent)
                .background(OpenPhysicsTheme.accent.opacity(0.10), in: RoundedRectangle(cornerRadius: 16))
            }.buttonStyle(.plain).disabled(practiceStore.isLoading)
                .accessibilityIdentifier("gaokao.primary")

            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("专题训练")
                    Spacer()
                    Text(accessRequired ? "登录后开启" : "按需要直接进入")
                }.font(.footnote).foregroundStyle(.secondary).padding(.horizontal, 4)
                OpenPhysicsPhoneGroup {
                    ForEach(trainingLayers) { layer in
                        Button { startSession(layer, topic: topic) } label: {
                            OpenPhysicsPhoneActionRow(title: layer.title, detail: phoneLayerDetail(layer), number: layer.number,
                                value: "\(layer.questionCount) 题", emphasized: overview.hasLearningEvidence && overview.recommendedLayer == layer)
                        }.buttonStyle(.plain).disabled(practiceStore.isLoading)
                            .accessibilityIdentifier("gaokao.layer.\(layer.rawValue)")
                        if layer != trainingLayers.last { Divider().padding(.leading, 60) }
                    }
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                Text("阶段验收").font(.footnote).foregroundStyle(.secondary).padding(.horizontal, 4)
                OpenPhysicsPhoneGroup {
                    Button { startSession(.paper, topic: topic) } label: {
                        OpenPhysicsPhoneActionRow(title: "专题套卷", detail: "混合训练，检验整体掌握", value: "10 题")
                    }.buttonStyle(.plain).disabled(practiceStore.isLoading)

                }
                if overview.hasLearningEvidence {
                    Button("重新摸底") { startSession(.diagnostic, topic: topic) }
                        .font(.subheadline).frame(maxWidth: .infinity, minHeight: 44)
                        .tint(OpenPhysicsTheme.accent).disabled(practiceStore.isLoading)
                }
            }
            if !practiceStore.message.isEmpty && practiceStore.message != StudentAccessPolicy.accountRequiredMessage {
                Text(practiceStore.message).font(.footnote).foregroundStyle(.red)
            }
            if !practiceStore.evidenceSyncMessage.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Label(practiceStore.evidenceSyncMessage, systemImage: "icloud.slash").font(.footnote).foregroundStyle(.orange)
                    Button("重试同步") { Task { await refreshPhone() } }.frame(minHeight: 44)
                }
            }
        }
    }

    private func phoneLayerDetail(_ layer: LearningCatalogTopicLayer) -> String {
        switch layer {
        case .foundation: return "基础知识与常见题型"
        case .breakthrough: return "典型模型与关键方法"
        case .transfer: return "综合应用与复杂情境"
        default: return layer.description
        }
    }

    private func pageHeader(_ catalog: LearningCatalogData) -> some View {
        HStack(alignment: .center, spacing: 12) {
            OpenPhysicsSidebarRevealButton()
            VStack(alignment: .leading, spacing: 5) {
                Text("高考复习")
                    .font(.title3.weight(.semibold))
            }

            Spacer(minLength: 12)

            Text("\(catalog.knowledgeBlocks.count) 个知识板块 · \(catalog.topicCount) 个专题")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(OpenPhysicsTheme.accent)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(OpenPhysicsTheme.accentSoft)
                .clipShape(Capsule())

            OpenPhysicsRefreshButton(
                title: "刷新高考复习",
                isRefreshing: store.isLoadingCatalog || store.isLoadingOverview
            ) {
                guard let student = appSession.studentSession else { return }
                Task {
                    await practiceStore.retryLearningCatalogEvidence(student: student)
                    await store.load(student: student, force: true)
                    await store.refreshSelected(student: student)
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(Color(uiColor: .separator).opacity(0.24), lineWidth: 1)
        }
    }

    private func catalogPanel(_ catalog: LearningCatalogData) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 5) {
                Text("复习目录")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(OpenPhysicsTheme.accent)
                Text("选择知识板块")
                    .font(.title2.bold())
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 18)

            Divider()

            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(catalog.knowledgeBlocks) { block in
                        blockSection(block)
                    }
                }
                .padding(12)
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

    private func blockSection(_ block: LearningCatalogNode) -> some View {
        let isExpanded = store.expandedBlockId == block.id
        return VStack(spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    store.toggleBlock(block)
                }
            } label: {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(block.title)
                            .font(.headline)
                            .foregroundStyle(.primary)
                            .multilineTextAlignment(.leading)
                        Text("\(block.topics.count) 个专题")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 8)
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption.bold())
                        .foregroundStyle(
                            isExpanded ? OpenPhysicsTheme.accent : Color.secondary
                        )
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    isExpanded
                        ? OpenPhysicsTheme.accentSoft
                        : Color(uiColor: .systemBackground)
                )
            }
            .buttonStyle(.plain)

            if isExpanded {
                VStack(spacing: 0) {
                    ForEach(block.topics) { topic in
                        topicButton(topic)
                        if topic.id != block.topics.last?.id {
                            Divider().padding(.leading, 48)
                        }
                    }
                }
                .background(Color(uiColor: .systemBackground))
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(
                    isExpanded
                        ? OpenPhysicsTheme.accent.opacity(0.35)
                        : Color(uiColor: .separator).opacity(0.25),
                    lineWidth: 1
                )
        }
    }

    private func topicButton(_ topic: LearningCatalogNode) -> some View {
        let isSelected = store.selectedTopicId == topic.id
        return Button {
            guard let student = appSession.studentSession else { return }
            showsPhoneTopic = true
            Task { await store.selectTopic(topic, student: student) }
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(topic.topicDisplayCode)
                    .font(.subheadline.bold())
                    .foregroundStyle(OpenPhysicsTheme.accent)
                    .frame(width: 34, alignment: .leading)
                Text(topic.title)
                    .font(.subheadline.weight(isSelected ? .semibold : .regular))
                    .foregroundStyle(
                        isSelected ? OpenPhysicsTheme.accent : Color.primary
                    )
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 4)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(isSelected ? OpenPhysicsTheme.accentSoft : Color.clear)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var topicWorkbench: some View {
        ScrollView {
            if accessRequired {
                AccountAccessPreviewView(
                    title: "登录后开启高考复习",
                    message: "可先浏览全部专题和复习路径，登录后开始摸底、分层训练和专题套卷。已有记录和草稿会保留。"
                )
                .padding(16)
            }
            if store.isLoadingOverview || (store.selectedTopic == nil && store.isLoadingCatalog) {
                workbenchLoadingState
            } else if store.selectedTopic == nil {
                emptyTopicState
            } else if let overview = store.overview, let topic = store.selectedTopic {
                topicPath(topic: topic, overview: overview)
            } else {
                overviewErrorState
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: .systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(Color(uiColor: .separator).opacity(0.35), lineWidth: 1)
        }
    }

    private var emptyTopicState: some View {
        VStack(spacing: 14) {
            Text("专题")
                .font(.title2.bold())
                .foregroundStyle(OpenPhysicsTheme.accent)
                .frame(width: 82, height: 82)
                .background(OpenPhysicsTheme.accentSoft)
                .clipShape(Circle())
            Text("暂无可用专题")
                .font(.title2.bold())
            Text("专题目录更新后将自动显示复习路径。")
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 460)
        }
        .padding(40)
        .frame(maxWidth: .infinity, minHeight: 440, alignment: .center)
    }

    private var workbenchLoadingState: some View {
        VStack(spacing: 14) {
            ProgressView()
            Text(store.selectedTopic == nil ? "正在恢复最近复习专题…" : "正在加载专题复习路径…")
                .foregroundStyle(.secondary)
        }
        .padding(40)
        .frame(maxWidth: .infinity, minHeight: 440, alignment: .center)
    }

    private var overviewErrorState: some View {
        VStack(spacing: 14) {
            Image(systemName: "exclamationmark.triangle")
                .font(.largeTitle)
                .foregroundStyle(.orange)
            Text(store.overviewMessage.isEmpty ? "专题学习状态加载失败" : store.overviewMessage)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("重新加载") {
                guard let student = appSession.studentSession else { return }
                Task { await store.refreshSelected(student: student) }
            }
            .buttonStyle(.borderedProminent)
            .tint(OpenPhysicsTheme.accent)
        }
        .padding(40)
        .frame(maxWidth: .infinity, minHeight: 440, alignment: .center)
    }

    private func topicPath(
        topic: LearningCatalogNode,
        overview: LearningCatalogTopicOverview
    ) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            if overview.hasLearningEvidence {
                recentStatusCard(overview)
            }

            VStack(alignment: .leading, spacing: 18) {
                OpenPhysicsAdaptiveStack(spacing: 18, alignment: .center) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("当前专题复习路径")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(OpenPhysicsTheme.accent)
                        Text("专题 \(overview.topicCode)")
                            .font(.subheadline.bold())
                            .foregroundStyle(.secondary)
                        Text(overview.title)
                            .font(.title3.weight(.semibold))
                    }

                    Spacer(minLength: 12)

                    Button(accessRequired ? "登录后摸底" : "专题摸底") {
                        startSession(.diagnostic, topic: topic)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.regular)
                    .tint(OpenPhysicsTheme.accent)
                    .disabled(practiceStore.isLoading)
                }

                statistics(overview)
                Text("专题表现按已作答题目的得分计算；未练知识点待检测，不计零分。")
                    .font(.caption).foregroundStyle(.secondary)

                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("专题训练入口")
                            .font(.title3.bold())
                        Text(accessRequired ? "登录后可按需要选择三个复习层级。" : "三个复习层级都可以直接进入，按当前需要选择。")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(overview.topicPerformanceLabel)
                        .font(.headline)
                        .foregroundStyle(OpenPhysicsTheme.accent)
                }

                OpenPhysicsAdaptiveStack(spacing: 12, alignment: .top) {
                    ForEach(trainingLayers) { layer in
                        layerCard(
                            layer,
                            topic: topic,
                            recommended: overview.recommendedLayer == layer
                        )
                    }
                }

                paperCard(topic)


                if !practiceStore.message.isEmpty && practiceStore.message != StudentAccessPolicy.accountRequiredMessage {
                    Label(practiceStore.message, systemImage: "exclamationmark.circle")
                        .font(.callout)
                        .foregroundStyle(.red)
                }
                if !practiceStore.evidenceSyncMessage.isEmpty {
                    HStack(spacing: 10) {
                        Label(
                            practiceStore.evidenceSyncMessage,
                            systemImage: "icloud.slash"
                        )
                        .font(.callout)
                        .foregroundStyle(.orange)
                        Spacer()
                        Button("重试同步") {
                            guard let student = appSession.studentSession else { return }
                            Task {
                                await practiceStore.retryLearningCatalogEvidence(
                                    student: student
                                )
                                await store.refreshSelected(student: student)
                            }
                        }
                        .buttonStyle(.bordered)
                        .tint(OpenPhysicsTheme.accent)
                    }
                }
            }
            .padding(20)
        }
        .padding(16)
    }

    private func recentStatusCard(_ overview: LearningCatalogTopicOverview) -> some View {
        OpenPhysicsAdaptiveStack(spacing: 18, alignment: .center) {
            VStack(alignment: .leading, spacing: 7) {
                Text("最近专题状态")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(OpenPhysicsTheme.accent)
                Text("「\(overview.title)」\(overview.statusLabel)")
                    .font(.title3.bold())
                Text("\(overview.recentPracticeLabel) · 待检测 \(overview.untestedKnowledgePointCount) 个")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text("推荐进入「\(overview.recommendedLayerName)」")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(OpenPhysicsTheme.accent)
            }

            Spacer(minLength: 12)

            VStack(spacing: 10) {
                Button("继续专题复习") {
                    guard let topic = store.selectedTopic else { return }
                    startSession(overview.recommendedLayer, topic: topic)
                }
                .buttonStyle(.borderedProminent)
                .tint(OpenPhysicsTheme.accent)

                Button("重新摸底") {
                    guard let topic = store.selectedTopic else { return }
                    startSession(.diagnostic, topic: topic)
                }
                .buttonStyle(.bordered)
                .tint(OpenPhysicsTheme.accent)
            }
            .disabled(practiceStore.isLoading)
        }
        .padding(20)
        .background(Color.orange.opacity(0.07))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Color.orange.opacity(0.28), lineWidth: 1)
        }
    }

    private func statistics(_ overview: LearningCatalogTopicOverview) -> some View {
        HStack(spacing: 0) {
            statistic("核心知识点", value: overview.coreKnowledgePointCount)
            Divider()
            statistic("已检测", value: overview.attemptedKnowledgePointCount)
            Divider()
            statistic("待检测", value: overview.untestedKnowledgePointCount)
            Divider()
            statistic("作答记录", value: overview.evidenceCount ?? 0)
        }
        .background(OpenPhysicsTheme.pageBackground)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func statistic(_ title: String, value: Int) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text("\(value)")
                .font(.title2.bold())
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func layerCard(
        _ layer: LearningCatalogTopicLayer,
        topic: LearningCatalogNode,
        recommended: Bool
    ) -> some View {
        Button {
            startSession(layer, topic: topic)
        } label: {
            OpenPhysicsAdaptiveStack(spacing: 12, alignment: .top) {
                Text(layer.number)
                    .font(.headline.bold())
                    .foregroundStyle(OpenPhysicsTheme.accent)
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 6) {
                        Text(layer.title)
                            .font(.headline.bold())
                            .foregroundStyle(.primary)
                        if accessRequired || recommended {
                            Text(accessRequired ? "登录后开启" : "当前建议")
                                .font(.caption2.bold())
                                .foregroundStyle(.white)
                                .padding(.horizontal, 7)
                                .padding(.vertical, 3)
                                .background(OpenPhysicsTheme.accent)
                                .clipShape(Capsule())
                        }
                    }
                    Text(layer.description)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
            }
            .padding(16)
            .frame(maxWidth: .infinity, minHeight: 96, alignment: .topLeading)
            .background(
                recommended
                    ? OpenPhysicsTheme.accentSoft
                    : OpenPhysicsTheme.pageBackground
            )
            .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 15, style: .continuous)
                    .stroke(
                        recommended
                            ? OpenPhysicsTheme.accent
                            : Color(uiColor: .separator).opacity(0.25),
                        lineWidth: recommended ? 1.5 : 1
                    )
            }
        }
        .buttonStyle(.plain)
        .disabled(practiceStore.isLoading)
    }

    private func paperCard(_ topic: LearningCatalogNode) -> some View {
        OpenPhysicsAdaptiveStack(spacing: 18, alignment: .center) {
            VStack(alignment: .leading, spacing: 6) {
                Text("专题套卷")
                    .font(.title3.bold())
                Text(LearningCatalogTopicLayer.paper.description)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 12)
            Button(accessRequired ? "登录后开始套卷" : "开始专题套卷") {
                startSession(.paper, topic: topic)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.regular)
            .tint(OpenPhysicsTheme.accent)
            .disabled(practiceStore.isLoading)
        }
        .padding(18)
        .background(OpenPhysicsTheme.accentSoft.opacity(0.7))
        .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
    }


    private var loadingState: some View {
        VStack(spacing: 14) {
            ProgressView()
            Text("正在加载高考复习目录…")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(OpenPhysicsTheme.pageBackground)
    }

    private var unavailableState: some View {
        VStack(spacing: 14) {
            Image(systemName: "exclamationmark.triangle")
                .font(.largeTitle)
                .foregroundStyle(.orange)
            Text(store.catalogMessage.isEmpty ? "高考复习目录暂不可用" : store.catalogMessage)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("重新加载") {
                guard let student = appSession.studentSession else { return }
                Task { await store.load(student: student, force: true) }
            }
            .buttonStyle(.borderedProminent)
            .tint(OpenPhysicsTheme.accent)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(OpenPhysicsTheme.pageBackground)
    }

    private func startSession(
        _ layer: LearningCatalogTopicLayer,
        topic: LearningCatalogNode
    ) {
        guard let student = appSession.studentSession else { return }
        guard !accessRequired else {
            appSession.showsAccountNotice = true
            return
        }
        Task {
            if await practiceStore.startLearningCatalogTopic(
                student: student,
                catalogCode: GaokaoReviewStore.catalogCode,
                nodeId: topic.id,
                topicTitle: topic.title,
                layer: layer
            ) {
                showsPractice = true
            }
        }
    }
}
