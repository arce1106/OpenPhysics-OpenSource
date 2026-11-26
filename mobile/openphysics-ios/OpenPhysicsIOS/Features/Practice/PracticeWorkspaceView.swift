import SwiftUI
import WebKit

struct PracticeWorkspaceView: View {
    @ObservedObject private var privacy = PrivacyConsentCenter.shared
    @Environment(\.openPhysicsIsPhone) private var isPhone
    @Environment(\.openPhysicsTabletSidebar) private var tabletSidebar
    @State private var collapsedSidebarForPractice = false
    @State private var phoneImage: OpenPhysicsImageSelection?
    @EnvironmentObject private var appSession: AppSession
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: PracticeStore
    let onCompletion: () -> Void
    let onScopeDiagnosticCompletion: (ScopeDiagnosticResult) -> Void
    let onImprovementRetestCompletion: (ImprovementRetestResult) -> Void
    @State private var photoContext: AnswerPhotoContext?
    @State private var allowsFingerDrawing = false
    @State private var showsDrawingTools = false
    @State private var expandedSelfReviewQuestionIDs = Set<String>()
    @State private var selfReviewSolutionHeights: [String: CGFloat] = [:]
    @State private var showsAssessmentResult = false
    @State private var showsImprovementRetestResult = false
    @State private var showsLearningCatalogResult = false
    @State private var showsKpPracticeResult = false
    @State private var showsAssessmentSubmitConfirmation = false
    @State private var showsGradingCorrection = false

    init(
        store: PracticeStore,
        onCompletion: @escaping () -> Void = {},
        onScopeDiagnosticCompletion: @escaping (ScopeDiagnosticResult) -> Void = { _ in },
        onImprovementRetestCompletion: @escaping (ImprovementRetestResult) -> Void = { _ in }
    ) {
        self.store = store
        self.onCompletion = onCompletion
        self.onScopeDiagnosticCompletion = onScopeDiagnosticCompletion
        self.onImprovementRetestCompletion = onImprovementRetestCompletion
    }

    var body: some View {
        Group {
            if store.teacherPaperCompleted {
                TeacherPaperReviewView(store: store)
            } else if let session = store.session, let question = store.currentQuestion {
                VStack(spacing: 0) {
                    workspaceHeader(session: session)
                    if (store.workflow.learningCatalogContext != nil && !StudentAccessPolicy.hasFullLearningAccess(appSession.studentSession))
                        || store.message == StudentAccessPolicy.accountRequiredMessage {
                        AccountAccessPreviewView(
                            title: "账号状态已变化，当前作答已保留",
                            message: "可继续查看题目和草稿，账号恢复后再提交。返回应用时会自动刷新账号状态。"
                        )
                    }
                    Divider()
                    if isPhone {
                        phoneWorkspace(question: question, session: session)
                    } else {
                    GeometryReader { proxy in
                        HStack(spacing: 0) {
                            VStack(spacing: 0) {
                                questionPane(question: question, session: session)
                                // Options are chosen here, so the submit action sits under them.
                                if question.isChoice, showsWorkspaceActionBar {
                                    Divider()
                                    PracticeWorkspaceActionBar { actionButtons }
                                }
                            }
                                .frame(
                                    width: proxy.size.width * (
                                        question.isChoice ? 0.50 : 0.43
                                    )
                                )
                            Divider()
                            answerPanel(question: question)
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                        }
                    }
                    }
                }
            } else {
                VStack(spacing: 14) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                    Text("学习任务不可用")
                        .font(.title2.bold())
                    Text(store.message)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .background(OpenPhysicsTheme.pageBackground)
        .overlay {
            // Like Android: a blocking progress card while AI grades, so the student knows it is working.
            if let startedAt = store.aiGradingStartedAt {
                AIGradingProgressOverlay(
                    startedAt: startedAt,
                    completed: store.assessmentGradingCompleted,
                    total: store.isFinalizing ? store.assessmentGradingTotal : 0
                )
                .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: store.aiGradingStartedAt)
        .alert(
            "本次批改未完成",
            isPresented: Binding(
                get: { store.aiGradingFailure != nil && store.aiGradingStartedAt == nil },
                set: { if !$0 { store.dismissAIGradingFailure() } }
            ),
            presenting: store.aiGradingFailure
        ) { failure in
            Button(failure == .set ? "重试未完成部分" : "重新批改") { retryAIGrading(failure) }
            Button("返回检查", role: .cancel) { store.dismissAIGradingFailure() }
        } message: { _ in
            Text(store.message.isEmpty ? "AI 批改没有完成，作答已保留，可以重试。" : store.message)
        }
        .sheet(isPresented: privacy.presentationBinding(for: .practice)) { AIPrivacyView(privacy: privacy) }
        .onChange(of: privacy.state?.aiAccepted) { accepted in
            if accepted == true, store.message == PrivacyConsentError.required.errorDescription { store.message = "" }
        }
        .navigationTitle("")
        .toolbar(isPhone ? .hidden : .automatic, for: .tabBar)
        .navigationBarBackButtonHidden(true)
        .toolbar(.hidden, for: .navigationBar)
        .interactiveDismissDisabled(store.isLoading || store.isSubmitting || store.isFinalizing || store.needsExitConfirmation)
        .alert("退出本次作答？", isPresented: $appSession.showsPracticeExitConfirmation) {
            Button("继续作答", role: .cancel) { appSession.cancelPracticeExit() }
            Button("放弃并退出", role: .destructive) { appSession.confirmPracticeExit() }
        } message: {
            Text(store.exitConfirmationMessage)
        }
        .onAppear {
            appSession.activePractice = store
            // iPad: give the question and scratch pad the full width while answering.
            if let tabletSidebar, !tabletSidebar.isHidden {
                tabletSidebar.setHidden(true)
                collapsedSidebarForPractice = true
            }
        }
        .onDisappear {
            if photoContext == nil, appSession.activePractice === store { appSession.activePractice = nil }
            if photoContext == nil, collapsedSidebarForPractice {
                if tabletSidebar?.prefersCollapsed != true { tabletSidebar?.setHidden(false) }
                collapsedSidebarForPractice = false
            }
        }
        .onChange(of: store.teacherPaperCompleted) { completed in
            if completed {
                onCompletion()
                Task { await appSession.refreshDashboard() }
            }
        }
        .sheet(isPresented: $showsAssessmentResult) {
            assessmentResultSheet
        }
        .sheet(isPresented: $showsImprovementRetestResult) {
            improvementRetestResultSheet
        }
        .sheet(isPresented: $showsLearningCatalogResult) {
            learningCatalogResultSheet
        }
        .sheet(isPresented: $showsKpPracticeResult) {
            kpPracticeResultSheet
        }
        .confirmationDialog(
            store.isTeacherPaper ? "提交整套答卷？" : store.isLearningCatalog ? "提交专题摸底？" : store.isImprovementRetest ? "提交阶段复测？" : store.isSetPractice ? "提交本组练习？" : "提交掌握评估？",
            isPresented: $showsAssessmentSubmitConfirmation,
            titleVisibility: .visible
        ) {
            Button(store.isLearningCatalog || store.isTeacherPaper ? "提交并统一批改" : "提交并开始批改") {
                guard let student = appSession.studentSession else { return }
                Task { await store.finalizeAssessment(student: student) }
            }
            Button("继续检查答案", role: .cancel) {}
        } message: {
            Text(
                "\(store.assessmentSubmissionSummary.displayText)。提交后将统一批改并生成本组结果。"
            )
        }
        .confirmationDialog(
            "纠正 AI 批改结果",
            isPresented: $showsGradingCorrection,
            titleVisibility: .visible
        ) {
            Button("实际答对了") {
                correctCurrentGrading(isCorrect: true)
            }
            Button("实际仍需订正") {
                correctCurrentGrading(isCorrect: false)
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("请先核对标准答案和自己的最终作答。纠正后会重新计算掌握度和错题状态。")
        }
        .onChange(of: store.requiresLogin) { requiresLogin in
            if requiresLogin {
                appSession.logout(message: "登录已失效，请重新登录。")
            }
        }
        .onChange(of: store.diagnosticResult) { result in
            if result != nil {
                showsAssessmentResult = true
            }
        }
        .onChange(of: store.scopeDiagnosticResult) { result in
            if result != nil {
                showsAssessmentResult = true
            }
        }
        .onChange(of: store.improvementRetestResult) { result in
            if result != nil {
                showsImprovementRetestResult = true
            }
        }
        .onChange(of: store.learningCatalogSummary) { result in
            if result != nil && !store.isTeacherPaper {
                showsLearningCatalogResult = true
            }
        }
        .onChange(of: store.hasAssessmentResult) { completed in
            if completed, store.isSetPractice { showsKpPracticeResult = true }
        }
        .fullScreenCover(item: $photoContext) { context in
            AnswerPhotoCaptureView { data in
                guard let student = appSession.studentSession,
                      student.token == context.studentToken else {
                    return "账号状态已变化，请取消后重新选择照片。"
                }
                return store.confirmPhoto(data: data, student: student, context: context)
                    ? nil : (store.message.isEmpty ? "本次作答已变化，请取消后重新选择照片。" : store.message)
            }
        }
        .sheet(item: $phoneImage) { selection in OpenPhysicsImagePreview(url: selection.url) }
        .onChange(of: store.attemptId) { _ in photoContext = nil }
        .onChange(of: appSession.studentSession?.token) { _ in photoContext = nil }

    }

    private var phoneActionsLocked: Bool {
        store.isLoading || store.isSubmitting || store.isFinalizing || store.isCorrectingGrading
    }

    private func phoneWorkspace(question: PracticeQuestion, session: PracticeSession) -> some View {
        questionPane(question: question, session: session)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(spacing: 8) {
                    if !store.message.isEmpty || !store.evidenceSyncMessage.isEmpty {
                        Text(store.message.isEmpty ? store.evidenceSyncMessage : store.message)
                            .font(.caption).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
                    }
                    if let result = store.currentResult, !store.isAssessment || store.hasAssessmentResult {
                        // The Pane already shows the verdict, answer and explanation; only the
                        // review status and the correction entry are added here.
                        if let status = reviewRetryStatus(result) {
                            Label(status.text, systemImage: status.symbol)
                                .font(.footnote.weight(.semibold)).foregroundStyle(status.color)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        if canCorrectGrading(result) {
                            Button("修正识别或批改") { showsGradingCorrection = true }
                                .font(.subheadline).disabled(phoneActionsLocked)
                        }
                    } else if store.isAssessment && store.currentAnswerIsCollected {
                        Button("本题已保存 · 修改作答") { store.reopenCurrentAssessmentAnswer() }
                            .font(.subheadline).disabled(phoneActionsLocked)
                    } else if !question.isChoice {
                        if let media = store.currentMediaDraft {
                            Button { phoneImage = OpenPhysicsImageSelection(url: media.fileURL) } label: {
                                Label("已保存作答照片 · 查看", systemImage: "photo.fill")
                                    .font(.subheadline).frame(maxWidth: .infinity, minHeight: 32)
                            }
                        }
                        answerTopActions(question)
                    }
                    HStack(spacing: 8) {
                        if store.isAssessment {
                            Button { store.goToQuestion(store.currentIndex - 1) } label: {
                                Image(systemName: "chevron.left").frame(minWidth: 28, minHeight: 32)
                            }.buttonStyle(.bordered).accessibilityLabel("上一题")
                                .disabled(phoneActionsLocked || store.currentIndex == 0)
                            if store.currentIndex < session.questions.count - 1 {
                                Button { store.goToQuestion(store.currentIndex + 1) } label: {
                                    Text("下一题").frame(maxWidth: .infinity, minHeight: 32)
                                }.buttonStyle(.bordered).disabled(phoneActionsLocked)
                            }
                            if store.hasAssessmentResult {
                                primaryActionButton.disabled(phoneActionsLocked)
                            } else {
                                Button(action: submitOrRetryAssessment) {
                                    Text(store.assessmentSubmitTitle)
                                        .frame(maxWidth: .infinity, minHeight: 32)
                                }.buttonStyle(.borderedProminent).disabled(!store.canFinalizeAssessment || phoneActionsLocked)
                            }
                        } else {
                            primaryActionButton
                        }
                    }
                }
                .tint(OpenPhysicsTheme.accent)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(.bar)
            }
    }

    private func workspaceHeader(session: PracticeSession) -> some View {
        PracticeWorkspaceHeader(
            title: store.workflow == .practice
                ? session.sessionObjective.isEmpty ? "巩固练习" : session.sessionObjective
                : store.workflow.title,
            currentIndex: store.currentIndex,
            answeredCount: store.answeredCount,
            total: session.questions.count,
            items: session.questions.enumerated().map { index, question in
                PracticeQuestionNavigationItem(
                    id: question.id,
                    index: index,
                    state: navigationState(for: question)
                )
            },
            navigationEnabled: !phoneActionsLocked,
            onBack: { appSession.requestLeavingPractice { onCompletion(); dismiss() } },
            onSelectQuestion: store.goToQuestion,
            onSubmit: store.isAssessment && !store.hasAssessmentResult ? submitOrRetryAssessment : nil,
            canSubmit: store.canFinalizeAssessment,
            submitTitle: store.assessmentSubmitTitle,
            onToggleTools: isPhone ? nil : { showsDrawingTools.toggle() }
        )
    }

    private func navigationState(
        for question: PracticeQuestion
    ) -> PracticeQuestionNavigationState {
        if let result = store.results[question.id] {
            return result.isCorrect ? .correct : .wrong
        }
        if store.collectedQuestionIds.contains(question.id) {
            return .answered
        }
        if store.isAssessment, store.hasAnswerDraft(for: question) {
            return .answered
        }
        return .pending
    }

    private func questionPane(
        question: PracticeQuestion,
        session: PracticeSession
    ) -> some View {
        QuestionPaneView(
            question: question,
            index: store.currentIndex,
            total: session.questions.count,
            answer: store.currentAnswerSummary,
            result: store.isAssessment && !store.hasAssessmentResult
                ? nil
                : store.currentResult,
            interactive: !(
                store.isAssessment
                    && store.currentAnswerIsCollected
                    && !store.hasAssessmentResult
            ),
            onAnswerChange: { answer in
                store.setAnswer(answer, for: question.id)
            },
            onError: { error in
                store.message = error
            },
            onOpenImage: { phoneImage = OpenPhysicsImageSelection(url: $0) }
        )
        .id(question.id)
        .padding(.horizontal, isPhone ? 16 : 0)
        .padding(.vertical, isPhone ? 8 : 0)
        .background(Color(uiColor: .systemBackground))
    }

    private func answerPanel(question: PracticeQuestion) -> some View {
        VStack(spacing: 0) {
            if usesExpandedWorkspace(question) {
                if question.isChoice {
                    expandedChoiceWorkspace(question)
                } else {
                    expandedNonChoiceWorkspace(question)
                }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        if
                            store.isAssessment,
                            store.currentAnswerIsCollected,
                            !store.hasAssessmentResult
                        {
                            assessmentSubmittedPanel
                        } else if let result = store.currentResult {
                            if store.isAssessment && !store.hasAssessmentResult {
                                assessmentSubmittedPanel
                            } else {
                                resultPanel(result)
                            }
                        } else {
                            EmptyView()
                        }

                        if !store.message.isEmpty {
                            Label(store.message, systemImage: "exclamationmark.circle")
                                .font(.callout)
                                .foregroundStyle(.red)
                        }
                        if !store.evidenceSyncMessage.isEmpty {
                            VStack(alignment: .leading, spacing: 10) {
                                Label(
                                    store.evidenceSyncMessage,
                                    systemImage: "icloud.slash"
                                )
                                .font(.callout)
                                .foregroundStyle(.orange)
                                Button("重试同步记录") {
                                    guard let student = appSession.studentSession else { return }
                                    Task {
                                        await store.retryLearningCatalogEvidence(
                                            student: student
                                        )
                                    }
                                }
                                .buttonStyle(.bordered)
                                .tint(OpenPhysicsTheme.accent)
                            }
                        }
                    }
                    .padding(20)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                }
            }

            if showsWorkspaceActionBar, !question.isChoice {
                Divider()
                PracticeWorkspaceActionBar {
                    actionButtons
                }
            }
        }
        .background(OpenPhysicsTheme.pageBackground)
    }

    private var showsWorkspaceActionBar: Bool {
        !store.isAssessment
            || store.isFinalizing
            || store.hasAssessmentResult
    }

    private func usesExpandedWorkspace(_ question: PracticeQuestion) -> Bool {
        store.currentResult == nil
            && !(
                store.isAssessment
                    && store.currentAnswerIsCollected
                    && !store.hasAssessmentResult
            )
    }

    private func expandedChoiceWorkspace(_ question: PracticeQuestion) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            scratchpadControls(question)

            choiceCanvas(question)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .layoutPriority(1)

            if !store.message.isEmpty {
                Label(store.message, systemImage: "exclamationmark.circle")
                    .font(.callout)
                    .foregroundStyle(.red)
            }
            if !store.evidenceSyncMessage.isEmpty {
                Label(store.evidenceSyncMessage, systemImage: "icloud.slash")
                    .font(.callout)
                    .foregroundStyle(.orange)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func expandedNonChoiceWorkspace(_ question: PracticeQuestion) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            answerTopActions(question)
            scratchpadControls(question)

            choiceCanvas(question)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .layoutPriority(1)

            if !store.message.isEmpty {
                Label(store.message, systemImage: "exclamationmark.circle")
                    .font(.callout)
                    .foregroundStyle(.red)
            }
            if !store.evidenceSyncMessage.isEmpty {
                Label(store.evidenceSyncMessage, systemImage: "icloud.slash")
                    .font(.callout)
                    .foregroundStyle(.orange)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var assessmentSubmittedPanel: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("本题已作答", systemImage: "checkmark.circle.fill")
                .font(.title2.bold())
                .foregroundStyle(OpenPhysicsTheme.accent)
            Text("评估期间暂不显示对错和解析。完成全部题目后，系统会根据整组作答统一给出掌握结论。")
                .foregroundStyle(.secondary)
            HStack {
                Text(store.isFinalizing ? "批改进度" : "完成进度")
                Spacer()
                Text(
                    store.isFinalizing
                        ? "\(store.assessmentGradingCompleted) / \(store.assessmentGradingTotal)"
                        : "\(store.answeredCount) / \(store.session?.questions.count ?? 0)"
                )
                    .fontWeight(.semibold)
                    .foregroundStyle(OpenPhysicsTheme.accent)
            }
            .font(.callout)

            Button {
                store.reopenCurrentAssessmentAnswer()
            } label: {
                Label("修改本题作答", systemImage: "pencil")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.capsule)
            .controlSize(.regular)
            .disabled(store.isFinalizing || store.currentResult != nil)
        }
        .padding(20)
        .background(OpenPhysicsTheme.accentSoft)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func scratchpadControls(_ question: PracticeQuestion) -> some View {
        HStack {
            Label("演算草稿", systemImage: "pencil.and.scribble")
                .font(.headline)
            backgroundImageControls(question)
            Spacer()
            Toggle(isOn: $allowsFingerDrawing) {
                Label("手指书写", systemImage: "hand.draw")
            }
            .toggleStyle(.button)
            .tint(OpenPhysicsTheme.accent)
            Button("清空", role: .destructive) {
                guard let student = appSession.studentSession else { return }
                store.clearDrawingDraft(student: student, questionId: question.id)
            }
            .disabled(store.currentDrawing.strokes.isEmpty)
        }
    }

    private func choiceCanvas(_ question: PracticeQuestion) -> some View {
        PencilCanvasView(
            drawing: Binding(
                get: { store.currentDrawing },
                set: { drawing in
                    guard let student = appSession.studentSession else { return }
                    store.setDrawing(
                        drawing,
                        student: student,
                        questionId: question.id
                    )
                }
            ),
            allowsFingerDrawing: allowsFingerDrawing,
            backgroundImageURL: AppConfig.resolvedAssetURL(
                store.drawingBackgroundImagePaths[question.id]
            ),
            onCanvasSizeChange: {
                store.setDrawingCanvasSize($0, for: question.id)
            },
            onDrawingChange: { _ in },
            showsTools: showsDrawingTools,
            backgroundPlacement: store.drawingBackgroundPlacements[question.id] ?? QuestionDrawingBackgroundPlacement(),
            onBackgroundPlacementChange: { store.setDrawingBackgroundPlacement($0, for: question.id) }
        )
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Color(uiColor: .separator), lineWidth: 0.5)
        }
    }

    /// A disabled submit button says what is still missing instead of showing a faint "提交答案".
    private var submitTitleForCurrentAnswer: String {
        guard !store.canSubmitCurrentAnswer, let question = store.currentQuestion else { return "提交答案" }
        return question.isChoice ? "选择答案后提交" : "拍照或自评后提交"
    }

    private func answerTopActions(_ question: PracticeQuestion) -> some View {
        let hasPhoto = store.currentMediaDraft != nil
        return HStack(spacing: 12) {
            if question.supportsSelfReview {
                Button {
                    toggleSelfReview(for: question.id)
                } label: {
                    Label(
                        "解析自评",
                        systemImage: "checkmark.bubble"
                    )
                    .frame(maxWidth: .infinity)
                }
                .modifier(SelfReviewButtonStyle(isPhone: isPhone))
                .tint(OpenPhysicsTheme.accent)
                .disabled(phoneActionsLocked)
                .popover(
                    isPresented: selfReviewPresentation(for: question.id),
                    attachmentAnchor: .rect(.bounds),
                    arrowEdge: .top
                ) {
                    selfReviewPopover(question)
                }
            }

            Button {
                guard let student = appSession.studentSession else { return }
                photoContext = store.beginPhotoSelection(student: student)
            } label: {
                Label(hasPhoto ? "更换照片" : "拍照上传", systemImage: hasPhoto ? "photo" : "camera")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .tint(OpenPhysicsTheme.accent)
            .disabled(store.isSubmitting || store.isFinalizing || store.isCorrectingGrading)

            if hasPhoto {
                Button(role: .destructive) {
                    guard let student = appSession.studentSession else { return }
                    store.removePhotoDraft(
                        student: student,
                        questionId: question.id
                    )
                } label: {
                    Image(systemName: "xmark")
                        .frame(width: 20, height: 20)
                }
                .buttonStyle(.bordered)
                .accessibilityLabel("移除已选照片")
                .disabled(store.isSubmitting)
            }
        }
        .controlSize(.regular)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(OpenPhysicsTheme.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Color(uiColor: .separator), lineWidth: 0.5)
        }
    }

    @ViewBuilder
    private func backgroundImageControls(_ question: PracticeQuestion) -> some View {
        if !question.draftImages.isEmpty {
            let selectedPath = store.drawingBackgroundImagePaths[question.id]
            Menu {
                ForEach(Array(question.draftImages.enumerated()), id: \.element.id) {
                    index,
                    image in
                    Button {
                        store.setDrawingBackgroundImage(image, for: question.id)
                    } label: {
                        Label(
                            question.draftImages.count == 1
                                ? "放入草稿纸"
                                : "题图 \(index + 1)",
                            systemImage: selectedPath == image.imagePath
                                ? "checkmark"
                                : "photo"
                        )
                    }
                }
                if selectedPath != nil {
                    Divider()
                    Text(allowsFingerDrawing ? "双指拖动、捏合可移动和缩放题图" : "拖动题图移动，双指捏合缩放")
                    if store.drawingBackgroundPlacements[question.id] != nil {
                        Button {
                            store.setDrawingBackgroundPlacement(nil, for: question.id)
                        } label: {
                            Label("题图复位", systemImage: "arrow.counterclockwise")
                        }
                    }
                    Button("清除题图背景", role: .destructive) {
                        store.setDrawingBackgroundImage(nil, for: question.id)
                    }
                }
            } label: {
                Label(
                    selectedPath == nil ? "放入题图" : "题图已放入",
                    systemImage: selectedPath == nil
                        ? "photo.on.rectangle"
                        : "photo.fill.on.rectangle.fill"
                )
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.capsule)
            .tint(OpenPhysicsTheme.accent)
            .accessibilityHint("将题目附图放到草稿纸中，可拖动、双指缩放，并直接在原图上标注")
        }
    }

    private func selfReviewPanel(
        _ question: PracticeQuestion,
        showsToggle: Bool = true
    ) -> some View {
        let isExpanded = expandedSelfReviewQuestionIDs.contains(question.id)
        return VStack(alignment: .leading, spacing: 14) {
            if showsToggle {
                Button {
                    toggleSelfReview(for: question.id)
                } label: {
                    HStack {
                        Label("对照解析自评", systemImage: "checkmark.bubble")
                        Spacer()
                        Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(store.isSubmitting)
            }

            if isExpanded {
                HStack(alignment: .top, spacing: 12) {
                    Text("请对照标准答案和解析，逐项如实判断。自评结果会以较低权重计入学习记录。")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    if !showsToggle {
                        Button {
                            expandedSelfReviewQuestionIDs.remove(question.id)
                        } label: {
                            Image(systemName: "xmark")
                                .font(.subheadline.weight(.semibold))
                                .frame(width: 30, height: 30)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.borderless)
                        .foregroundStyle(OpenPhysicsTheme.accent)
                        .accessibilityLabel("关闭自评")
                    }
                }

                SelfReviewSolutionPaneView(
                    question: question,
                    onHeightChanged: { height in
                        selfReviewSolutionHeights[question.id] = max(150, height + 16)
                    },
                    onError: { store.message = $0 }
                )
                .frame(height: selfReviewSolutionHeights[question.id] ?? 180)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

                VStack(spacing: 10) {
                    ForEach(store.currentSelfReviewItems) { item in
                        HStack(spacing: 12) {
                            Text(item.label)
                                .font(.headline)
                                .frame(minWidth: 46, alignment: .leading)
                            Spacer()
                            ForEach(SelfReviewStatus.allCases) { status in
                                selfReviewStatusButton(
                                    status,
                                    item: item,
                                    questionId: question.id
                                )
                            }
                        }
                    }
                }

                Button {
                    guard let student = appSession.studentSession else { return }
                    Task { await store.submitSelfReview(student: student) }
                } label: {
                    HStack {
                        if store.isSubmitting {
                            ProgressView()
                                .tint(.white)
                        }
                        Text(
                            store.isSubmitting
                                ? "正在提交…"
                                : store.isAssessment ? "保存自评" : "提交自评"
                        )
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.regular)
                .tint(OpenPhysicsTheme.accent)
                .disabled(store.isSubmitting || !store.canSubmitCurrentSelfReview)
            }
        }
        .padding(16)
        .background(OpenPhysicsTheme.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func selfReviewPopover(_ question: PracticeQuestion) -> some View {
        GeometryReader { proxy in
            ScrollView {
                selfReviewPanel(question, showsToggle: false)
                    .frame(
                        maxWidth: .infinity,
                        minHeight: max(0, proxy.size.height - 24),
                        alignment: .topLeading
                    )
                    .background(OpenPhysicsTheme.cardBackground)
                    .clipShape(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                    )
                    .padding(12)
            }
        }
        .frame(width: isPhone ? nil : 760, height: isPhone ? nil : 600)
        .background(Color(uiColor: .systemGroupedBackground))
    }

    private func selfReviewPresentation(for questionId: String) -> Binding<Bool> {
        Binding(
            get: { expandedSelfReviewQuestionIDs.contains(questionId) },
            set: { isPresented in
                if isPresented {
                    expandedSelfReviewQuestionIDs.insert(questionId)
                } else {
                    expandedSelfReviewQuestionIDs.remove(questionId)
                }
            }
        )
    }

    private func toggleSelfReview(for questionId: String) {
        if expandedSelfReviewQuestionIDs.contains(questionId) {
            expandedSelfReviewQuestionIDs.remove(questionId)
        } else {
            expandedSelfReviewQuestionIDs.insert(questionId)
        }
    }

    @ViewBuilder
    private func selfReviewStatusButton(
        _ status: SelfReviewStatus,
        item: SelfReviewItem,
        questionId: String
    ) -> some View {
        let action = {
            store.setSelfReviewStatus(
                status,
                itemId: item.id,
                questionId: questionId
            )
        }
        if item.status == status {
            Button(status.title, action: action)
                .buttonStyle(.borderedProminent)
                .tint(status == .wrong ? .orange : OpenPhysicsTheme.accent)
                .disabled(store.isSubmitting)
        } else {
            Button(status.title, action: action)
                .buttonStyle(.bordered)
                .tint(status == .wrong ? .orange : OpenPhysicsTheme.accent)
                .disabled(store.isSubmitting)
        }
    }

    private func resultPanel(_ result: SubmitAnswerResult) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Label(
                result.isCorrect ? "回答正确" : "需要订正",
                systemImage: result.isCorrect ? "checkmark.circle.fill" : "xmark.circle.fill"
            )
            .font(.title.bold())
            .foregroundStyle(result.isCorrect ? .green : .orange)

            if let status = reviewRetryStatus(result) {
                Label(status.text, systemImage: status.symbol)
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(status.color)
            }

            if !result.isCorrect {
                feedbackRow(title: "你的答案", value: store.submittedAnswerSummary)
                feedbackRow(title: "正确答案", value: result.correctAnswer)
            }

            if let grading = result.processGrading {
                processGradingPanel(grading, fallback: result.aiFeedback)
            } else if let feedback = result.aiFeedback, !feedback.isEmpty {
                Text(feedback)
                    .foregroundStyle(.secondary)
            } else if let explanation = result.explanation, !explanation.isEmpty {
                Text(explanation)
                    .foregroundStyle(.secondary)
            }

            if let update = result.masteryUpdate.values.first {
                HStack {
                    Text(update.name.isEmpty ? "掌握度更新" : update.name)
                    Spacer()
                    Text("\(Int(update.before * 100))% → \(Int(update.after * 100))%")
                        .fontWeight(.semibold)
                        .foregroundStyle(OpenPhysicsTheme.accent)
                }
                .font(.callout)
            }

            if canCorrectGrading(result) {
                Button {
                    showsGradingCorrection = true
                } label: {
                    Label("批改有误？纠正结果", systemImage: "checkmark.message")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .tint(OpenPhysicsTheme.accent)
                .disabled(store.isCorrectingGrading || store.isSubmitting)
            }
        }
        .padding(20)
        .background(result.isCorrect ? Color.green.opacity(0.09) : Color.orange.opacity(0.10))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    /// Only AI-read answers can be disputed; tapped options are graded by the answer key.
    private func canCorrectGrading(_ result: SubmitAnswerResult) -> Bool {
        guard result.answerId != nil, let grading = result.processGrading else { return false }
        return grading.answerSource != "choice"
    }

    private func reviewRetryStatus(_ result: SubmitAnswerResult) -> (text: String, symbol: String, color: Color)? {
        guard store.isReviewRetry, result.isCorrect else { return nil }
        if store.reviewRetryCleared {
            return ("复盘通过，原错题已清除", "checkmark.seal.fill", .green)
        }
        if !store.reviewRetryClearDetail.isEmpty {
            return ("原错题还未清除：\(store.reviewRetryClearDetail)", "exclamationmark.circle", .orange)
        }
        return ("变式题已答对，但原错题尚未清除，请再试一次。", "arrow.triangle.2.circlepath", .orange)
    }

    @ViewBuilder
    private func processGradingPanel(
        _ grading: ReviewProcessGrading,
        fallback: String?
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if grading.needsHumanReview == true {
                Label(
                    "AI 对本题判断把握较低，建议核对后再确认。",
                    systemImage: "person.crop.circle.badge.exclamationmark"
                )
                .font(.callout.weight(.semibold))
                .foregroundStyle(.orange)
            }

            if let feedback = grading.feedback, !feedback.isEmpty {
                gradingDetailRow(title: "批改反馈", value: feedback)
            } else if let fallback, !fallback.isEmpty {
                gradingDetailRow(title: "批改反馈", value: fallback)
            }
            if let firstError = grading.firstError, !firstError.isEmpty {
                gradingDetailRow(title: "第一处问题", value: firstError)
            }
            if let nextAction = grading.nextAction, !nextAction.isEmpty {
                gradingDetailRow(title: "下一步", value: nextAction)
            }
            if let basis = grading.gradingBasis, !basis.isEmpty {
                gradingDetailRow(title: "判分依据", value: basis)
            }

            if let confidence = grading.gradingConfidence {
                HStack {
                    Text("AI 判断可信度")
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text("\(Int((confidence * 100).rounded()))%")
                        .fontWeight(.semibold)
                }
                .font(.callout)
            }

            if let steps = grading.stepScores, !steps.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("过程得分")
                        .font(.callout.weight(.semibold))
                    ForEach(Array(steps.enumerated()), id: \.offset) { _, step in
                        HStack(alignment: .firstTextBaseline) {
                            Text(step.name ?? "步骤")
                            Spacer()
                            if let score = step.score, let maximum = step.maxScore {
                                Text("\(score.formatted()) / \(maximum.formatted())")
                                    .fontWeight(.semibold)
                            }
                        }
                        .font(.callout)
                        if let comment = step.comment, !comment.isEmpty {
                            Text(comment)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .padding(14)
        .background(Color(uiColor: .secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func gradingDetailRow(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.callout.weight(.semibold))
            Text(value)
                .font(.callout)
                .foregroundStyle(.secondary)
        }
    }

    private func correctCurrentGrading(isCorrect: Bool) {
        guard let student = appSession.studentSession else { return }
        Task {
            await store.correctCurrentGrading(
                student: student,
                isCorrect: isCorrect
            )
        }
    }

    private func feedbackRow(title: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .fontWeight(.semibold)
        }
    }

    private var actionButtons: some View {
        HStack {
            primaryActionButton
        }
    }

    @ViewBuilder
    private var primaryActionButton: some View {
        Group {
            if store.isAssessment, !store.hasAssessmentResult {
                if store.isFinalizing {
                    Button {
                    } label: {
                        HStack {
                            ProgressView()
                                .tint(.white)
                            Text(
                                store.assessmentSubmitTitle
                            )
                            .frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.capsule)
                    .controlSize(.regular)
                    .tint(OpenPhysicsTheme.accent)
                    .disabled(true)
                } else if store.canFinalizeAssessment {
                    Button(action: submitOrRetryAssessment) {
                        Text(store.assessmentSubmitTitle)
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.capsule)
                    .controlSize(.regular)
                    .tint(OpenPhysicsTheme.accent)
                }
            } else if
                store.isLearningCatalog,
                store.learningCatalogSummary != nil
            {
                Button {
                    showsLearningCatalogResult = true
                } label: {
                    workspaceActionLabel("查看本组结果")
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .controlSize(.regular)
                .tint(OpenPhysicsTheme.accent)
            } else if store.isSetPractice, store.hasAssessmentResult {
                Button { showsKpPracticeResult = true } label: {
                    workspaceActionLabel("练习结果")
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .controlSize(.regular)
                .tint(OpenPhysicsTheme.accent)
            } else if store.isImprovementRetest, store.improvementRetestResult != nil {
                Button {
                    showsImprovementRetestResult = true
                } label: {
                    workspaceActionLabel("查看复测结果")
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .controlSize(.regular)
                .tint(OpenPhysicsTheme.accent)
            } else if store.isAssessment, store.hasAssessmentResult {
                Button {
                    showsAssessmentResult = true
                } label: {
                    workspaceActionLabel("评估结果")
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .controlSize(.regular)
                .tint(OpenPhysicsTheme.accent)
            } else if store.currentResult == nil {
                let submit = Button {
                    guard let student = appSession.studentSession else { return }
                    Task { await store.submit(student: student) }
                } label: {
                    HStack {
                        if store.isSubmitting {
                            ProgressView()
                                .tint(.white)
                        }
                        Text(
                            store.isSubmitting
                                ? "正在批改…"
                                : submitTitleForCurrentAnswer
                        )
                            .frame(maxWidth: .infinity)
                    }
                }
                if isPhone || store.isSubmitting || store.canSubmitCurrentAnswer {
                    submit
                        .buttonStyle(.borderedProminent)
                        .buttonBorderShape(.capsule)
                        .controlSize(.regular)
                        .tint(OpenPhysicsTheme.accent)
                        .disabled(store.isSubmitting || !store.canSubmitCurrentAnswer)
                } else {
                    // iPad, not ready yet: a readable hint pill instead of a faint disabled button.
                    Text(submitTitleForCurrentAnswer)
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, minHeight: 34)
                        .background(Color(uiColor: .tertiarySystemFill), in: Capsule())
                        .accessibilityAddTraits(.isButton)
                        .accessibilityHint("暂不可提交")
                }
            } else if store.isReviewRetry, !store.reviewRetryCleared,
                      store.currentResult?.isCorrect == false || !store.reviewRetryClearDetail.isEmpty {
                // A wrong variation, or one the server will not count (its reason is shown): try another.
                Button {
                    guard let student = appSession.studentSession else { return }
                    Task { await store.continueReviewRetry(student: student) }
                } label: {
                    workspaceActionLabel(store.isLoading ? "正在准备…" : "再练一道")
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .controlSize(.regular)
                .tint(OpenPhysicsTheme.accent)
                .disabled(store.isLoading)
            } else if
                store.isReviewRetry,
                store.currentResult?.isCorrect == true,
                !store.reviewRetryCleared
            {
                Button {
                    guard let student = appSession.studentSession else { return }
                    Task {
                        await store.retryReviewCompletion(student: student)
                    }
                } label: {
                    HStack {
                        if store.isSubmitting {
                            ProgressView()
                                .tint(.white)
                        }
                        Text(store.isSubmitting ? "正在完成复盘…" : "重试清除原错题")
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .controlSize(.regular)
                .tint(OpenPhysicsTheme.accent)
                .disabled(store.isSubmitting)
            } else if store.canGoForward {
                Button {
                    store.moveForward()
                } label: {
                    workspaceActionLabel("下一题")
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .controlSize(.regular)
                .tint(OpenPhysicsTheme.accent)
            } else if store.isComplete {
                Button {
                    Task { await appSession.refreshDashboard() }
                    onCompletion()
                    dismiss()
                } label: {
                    workspaceActionLabel(
                        store.isReviewRetry
                            ? "返回错题复盘"
                            : "完成本次学习"
                    )
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .controlSize(.regular)
                .tint(OpenPhysicsTheme.accent)
            } else {
                Button {} label: {
                    workspaceActionLabel("还有题目未完成")
                }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.capsule)
                    .controlSize(.regular)
                    .tint(OpenPhysicsTheme.accent)
                    .disabled(true)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func workspaceActionLabel(_ title: String) -> some View {
        Text(title)
            .font(.headline)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 34)
    }

    @ViewBuilder
    private var assessmentResultSheet: some View {
        if let result = store.diagnosticResult {
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        VStack(spacing: 12) {
                            Image(systemName: result.recommendationSymbol)
                                .font(.system(size: 48))
                                .foregroundStyle(assessmentTone(result.recommendation))
                            Text(result.recommendationLabel)
                                .font(.largeTitle.bold())
                            Text("\(result.kpName)：正确 \(result.correctCount)/\(result.totalCount)")
                                .font(.title3)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity)

                        HStack(spacing: 14) {
                            assessmentMetric(
                                value: "\(Int((result.masteryBefore * 100).rounded()))%",
                                label: "评估前"
                            )
                            Image(systemName: "arrow.right")
                                .foregroundStyle(.secondary)
                            assessmentMetric(
                                value: "\(Int((result.masteryAfter * 100).rounded()))%",
                                label: "当前掌握"
                            )
                        }

                        Text(result.feedback)
                            .font(.body)
                            .padding(18)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(OpenPhysicsTheme.cardBackground)
                            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))

                        if !store.message.isEmpty {
                            Label(store.message, systemImage: "exclamationmark.circle")
                                .font(.callout)
                                .foregroundStyle(.red)
                        }

                        Button {
                            performAssessmentRecommendation(result)
                        } label: {
                            HStack {
                                if store.isLoading {
                                    ProgressView()
                                        .tint(.white)
                                }
                                Text(
                                    store.isLoading
                                        ? "正在准备…"
                                        : "做巩固小练"
                                )
                                .frame(maxWidth: .infinity)
                            }
                        }
                        .modifier(AssessmentResultButtonStyle(isPhone: isPhone, primary: true))
                        .disabled(store.isLoading)

                        Button {
                            completeAndDismiss()
                        } label: {
                            Text("返回同步学习")
                                .frame(maxWidth: isPhone ? .infinity : nil)
                        }
                        .modifier(AssessmentResultButtonStyle(isPhone: isPhone, primary: false))
                        .disabled(store.isLoading)
                        .frame(maxWidth: .infinity)
                    }
                    .padding(isPhone ? 20 : 28)
                }
                .background(OpenPhysicsTheme.pageBackground)
                .navigationTitle("评估结果")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("关闭") {
                            showsAssessmentResult = false
                        }
                    }
                }
            }
            .presentationDetents(isPhone ? [.large] : [.medium, .large])
        } else if let result = store.scopeDiagnosticResult {
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        VStack(spacing: 10) {
                            Image(systemName: "scope")
                                .font(.system(size: 46))
                                .foregroundStyle(OpenPhysicsTheme.accent)
                            Text("本章定位完成")
                                .font(.largeTitle.bold())
                            Text(
                                "\(result.scopeName)：正确 \(result.correctCount)/\(result.totalCount)"
                            )
                            .font(.title3)
                            .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity)

                        HStack(spacing: 14) {
                            assessmentMetric(
                                value: "\(result.accuracyPercent)%",
                                label: "本次正确率"
                            )
                            assessmentMetric(
                                value: "\(result.weakKpIds.count)",
                                label: "待补知识点"
                            )
                        }

                        Text(result.feedback)
                            .font(.body)
                            .padding(18)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(OpenPhysicsTheme.cardBackground)
                            .clipShape(
                                RoundedRectangle(
                                    cornerRadius: 16,
                                    style: .continuous
                                )
                            )

                        if !result.kpResults.isEmpty {
                            VStack(alignment: .leading, spacing: 12) {
                                Text("知识点定位")
                                    .font(.headline)
                                ForEach(result.kpResults, id: \.stableID) { item in
                                    HStack(spacing: 12) {
                                        Image(
                                            systemName: item.isWeak
                                                ? "exclamationmark.circle.fill"
                                                : "checkmark.circle.fill"
                                        )
                                        .foregroundStyle(
                                            item.isWeak ? Color.orange : Color.green
                                        )
                                        VStack(alignment: .leading, spacing: 3) {
                                            Text(item.kpName)
                                                .font(.subheadline.weight(.semibold))
                                            Text(
                                                "正确 \(item.correctCount)/\(item.totalCount) · 掌握 \(Int((item.masteryAfter * 100).rounded()))%"
                                            )
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        Text(item.isWeak ? "待补" : "稳定")
                                            .font(.caption.weight(.semibold))
                                            .foregroundStyle(
                                                item.isWeak ? Color.orange : Color.green
                                            )
                                    }
                                    .padding(14)
                                    .background(OpenPhysicsTheme.cardBackground)
                                    .clipShape(
                                        RoundedRectangle(
                                            cornerRadius: 14,
                                            style: .continuous
                                        )
                                    )
                                }
                            }
                        }

                        Button {
                            onScopeDiagnosticCompletion(result)
                            completeAndDismiss()
                        } label: {
                            Text("生成提升路径")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.regular)
                        .tint(OpenPhysicsTheme.accent)
                    }
                    .padding(isPhone ? 20 : 28)
                }
                .background(OpenPhysicsTheme.pageBackground)
                .navigationTitle("检测结果")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("关闭") {
                            showsAssessmentResult = false
                        }
                    }
                }
            }
            .presentationDetents([.large])
        }
    }

    @ViewBuilder
    private var learningCatalogResultSheet: some View {
        if
            let summary = store.learningCatalogSummary,
            let context = store.workflow.learningCatalogContext
        {
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        VStack(spacing: 10) {
                            Image(
                                systemName: summary.isPerfect
                                    ? "checkmark.seal.fill"
                                    : "chart.bar.fill"
                            )
                            .font(.system(size: 48))
                            .foregroundStyle(
                                summary.isPerfect
                                    ? Color.green
                                    : OpenPhysicsTheme.accent
                            )
                            Text("\(context.layer.title)完成")
                                .font(.largeTitle.bold())
                            Text(context.topicTitle)
                                .font(.title3)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity)

                        HStack(spacing: 14) {
                            assessmentMetric(
                                value: "\(summary.scoreLabel)/\(summary.totalCount)",
                                label: "本组得分"
                            )
                            assessmentMetric(
                                value: "\(summary.accuracyPercent)%",
                                label: "得分率"
                            )
                        }

                        Text(summary.headline)
                            .font(.body)
                            .padding(18)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(OpenPhysicsTheme.cardBackground)
                            .clipShape(
                                RoundedRectangle(cornerRadius: 16, style: .continuous)
                            )

                        if !store.evidenceSyncMessage.isEmpty {
                            Label(
                                store.evidenceSyncMessage,
                                systemImage: "icloud.slash"
                            )
                            .font(.callout)
                            .foregroundStyle(.orange)
                        }

                        Button {
                            completeLearningCatalogAndDismiss()
                        } label: {
                            Text("回到专题路径")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.regular)
                        .tint(OpenPhysicsTheme.accent)

                        Button {
                            guard let student = appSession.studentSession else { return }
                            Task {
                                if await store.restartLearningCatalogTopic(student: student) {
                                    showsLearningCatalogResult = false
                                }
                            }
                        } label: {
                            HStack {
                                if store.isLoading {
                                    ProgressView()
                                }
                                Text(store.isLoading ? "正在准备…" : "再练一组")
                                    .frame(maxWidth: .infinity)
                            }
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.regular)
                        .tint(OpenPhysicsTheme.accent)
                        .disabled(store.isLoading)
                    }
                    .padding(isPhone ? 20 : 28)
                }
                .background(OpenPhysicsTheme.pageBackground)
                .navigationTitle("本组结果")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("关闭") {
                            showsLearningCatalogResult = false
                        }
                    }
                }
            }
            .presentationDetents(isPhone ? [.large] : [.medium, .large])
        }
    }

    private func assessmentMetric(value: String, label: String) -> some View {
        VStack(spacing: 5) {
            Text(value)
                .font(.title.bold())
                .foregroundStyle(OpenPhysicsTheme.accent)
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(16)
        .background(OpenPhysicsTheme.accentSoft)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    @ViewBuilder
    private var improvementRetestResultSheet: some View {
        if let result = store.improvementRetestResult {
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        VStack(spacing: 10) {
                            Image(
                                systemName: result.needsRetestCount == 0
                                    ? "checkmark.seal.fill"
                                    : "arrow.triangle.2.circlepath.circle.fill"
                            )
                            .font(.system(size: 48))
                            .foregroundStyle(
                                result.needsRetestCount == 0
                                    ? Color.green
                                    : Color.orange
                            )
                            Text(
                                result.needsRetestCount == 0
                                    ? "本轮提升完成"
                                    : "还有知识点需要继续巩固"
                            )
                            .font(.largeTitle.bold())
                            Text(
                                "正确 \(result.correctCount)/\(result.totalCount) · 通过 \(result.passedCount) 项"
                            )
                            .font(.title3)
                            .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity)

                        HStack(spacing: 14) {
                            assessmentMetric(
                                value: "\(result.accuracyPercent)%",
                                label: "复测正确率"
                            )
                            assessmentMetric(
                                value: "\(result.needsRetestCount)",
                                label: "仍需巩固"
                            )
                        }

                        VStack(alignment: .leading, spacing: 12) {
                            Text("知识点复测")
                                .font(.headline)
                            ForEach(result.taskResults) { task in
                                HStack(spacing: 12) {
                                    Image(
                                        systemName: task.passed
                                            ? "checkmark.circle.fill"
                                            : "arrow.clockwise.circle.fill"
                                    )
                                    .foregroundStyle(
                                        task.passed ? Color.green : Color.orange
                                    )
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(task.kpName)
                                            .font(.subheadline.weight(.semibold))
                                        Text(task.feedback)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Text(
                                        task.passed
                                            ? "通过"
                                            : "正确 \(task.correctCount)/\(task.totalCount)"
                                    )
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(
                                        task.passed ? Color.green : Color.orange
                                    )
                                }
                                .padding(14)
                                .background(OpenPhysicsTheme.cardBackground)
                                .clipShape(
                                    RoundedRectangle(
                                        cornerRadius: 14,
                                        style: .continuous
                                    )
                                )
                            }
                        }

                        Button {
                            onImprovementRetestCompletion(result)
                            showsImprovementRetestResult = false
                            Task { await appSession.refreshDashboard() }
                            onCompletion()
                            dismiss()
                        } label: {
                            Text(
                                result.needsRetestCount == 0
                                    ? "返回巩固提升"
                                    : "查看下一轮提升任务"
                            )
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.regular)
                        .tint(OpenPhysicsTheme.accent)
                    }
                    .padding(isPhone ? 20 : 28)
                }
                .background(OpenPhysicsTheme.pageBackground)
                .navigationTitle("复测结果")
                .navigationBarTitleDisplayMode(.inline)
            }
            .presentationDetents([.large])
        }
    }

    private func retryAIGrading(_ failure: AIGradingFailure) {
        store.dismissAIGradingFailure()
        guard let student = appSession.studentSession else { return }
        Task {
            switch failure {
            case .answer: await store.submit(student: student)
            case .set: await store.finalizeAssessment(student: student)
            }
        }
    }

    private func submitOrRetryAssessment() {
        if store.assessmentSummaryPending {
            guard let student = appSession.studentSession else { return }
            Task { await store.finalizeAssessment(student: student) }
        } else {
            showsAssessmentSubmitConfirmation = true
        }
    }

    private var kpPracticeResultSheet: some View {
        NavigationStack {
            ScrollView {
                if let summary = store.setPracticeSummary {
                    VStack(alignment: .leading, spacing: 20) {
                        VStack(spacing: 12) {
                            Image(systemName: summary.isPerfect ? "checkmark.seal.fill" : "book.closed")
                                .font(.system(size: 42)).foregroundStyle(OpenPhysicsTheme.accent)
                            Text("本组练习完成").font(.title2.bold())
                            Text("得分 \(summary.scoreLabel) / \(summary.totalCount)").font(.title.bold())
                            Text("得分率 \(summary.accuracyPercent)%").foregroundStyle(.secondary)
                        }.frame(maxWidth: .infinity)
                        Text(summary.isPerfect ? "本轮掌握较稳定，可以继续巩固应用。" : "先查看批改详情，弄清错因，再继续巩固。")
                            .foregroundStyle(.secondary)
                        if !store.message.isEmpty {
                            Label(store.message, systemImage: "exclamationmark.circle").foregroundStyle(.red)
                        }
                        if let kpId = store.workflow.practiceKnowledgePointId {
                            Button {
                                guard let student = appSession.studentSession else { return }
                                Task {
                                    if await store.start(student: student, kpId: kpId, count: 5, deferredGrading: true) {
                                        showsKpPracticeResult = false
                                    }
                                }
                            } label: {
                                HStack {
                                    if store.isLoading { ProgressView().tint(.white) }
                                    Text(store.isLoading ? "正在准备…" : "继续巩固")
                                }.frame(maxWidth: .infinity, minHeight: 32)
                            }.buttonStyle(.borderedProminent).disabled(store.isLoading)
                            Button(action: completeAndDismiss) {
                                Text("回到同步学习").frame(maxWidth: .infinity, minHeight: 32)
                            }.buttonStyle(.bordered).disabled(store.isLoading)
                        } else {
                            // Mixed practice, like the web: one way back to choose the next direction.
                            Button(action: completeAndDismiss) {
                                Text("换方向继续练").frame(maxWidth: .infinity, minHeight: 32)
                            }.buttonStyle(.borderedProminent)
                        }
                    }.padding(24)
                }
            }
            .background(OpenPhysicsTheme.pageBackground)
            .tint(OpenPhysicsTheme.accent)
            .navigationTitle("练习结果").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) {
                Button("查看答卷") { showsKpPracticeResult = false }.disabled(store.isLoading)
            } }
        }.presentationDetents([.large]).interactiveDismissDisabled(store.isLoading)
    }

    private func assessmentTone(_ recommendation: String) -> Color {
        switch recommendation {
        case "mastered": return .green
        case "practice": return .orange
        default: return OpenPhysicsTheme.accent
        }
    }

    private func performAssessmentRecommendation(_ result: KpDiagnosticResult) {
        guard
            let student = appSession.studentSession,
            let kpId = store.workflow.assessmentKnowledgePointId
        else { return }
        Task {
            if await store.start(student: student, kpId: kpId, count: 5, deferredGrading: true) {
                showsAssessmentResult = false
            }
        }
    }

    private func completeAndDismiss() {
        showsAssessmentResult = false
        showsKpPracticeResult = false
        Task { await appSession.refreshDashboard() }
        onCompletion()
        dismiss()
    }

    private func completeLearningCatalogAndDismiss() {
        showsLearningCatalogResult = false
        Task { await appSession.refreshDashboard() }
        onCompletion()
        dismiss()
    }
}

private struct SelfReviewSolutionPaneView: View {
    let question: PracticeQuestion
    let onHeightChanged: (CGFloat) -> Void
    let onError: (String) -> Void

    var body: some View {
        InlineLearningContentPane(payload: payload, onHeightChanged: onHeightChanged, onError: onError)
    }

    private var payload: String {
        let questionObject: [String: Any] = [
            "id": question.id,
            "question_type": question.questionType,
            "correct_answer": question.selfReviewAnswer,
            "correct_answer_rendered":
                question.correctAnswerRendered.map { $0.jsonObject as Any } ?? NSNull(),
            "explanation": question.explanation ?? "",
            "explanation_rendered":
                question.explanationRendered.map { $0.jsonObject as Any } ?? NSNull()]
        let object: [String: Any] = [
            "mode": "self_review_solution",
            "question": questionObject]
        let data = try? JSONSerialization.data(withJSONObject: object)
        return data.flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }

}

/// Embeds the shared formula/Markdown renderer in a native scrolling layout.
struct InlineLearningContentPane: UIViewRepresentable {
    let payload: String
    let onHeightChanged: (CGFloat) -> Void
    let onError: (String) -> Void
    var contentStyle = ""
    var allowsInteraction = false

    func makeCoordinator() -> Coordinator {
        Coordinator(onHeightChanged: onHeightChanged, onError: onError)
    }

    func makeUIView(context: Context) -> WKWebView {
        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: "openPhysicsSelfReview")
        contentController.addUserScript(
            WKUserScript(
                source: Self.bridgeBootstrapScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )

        if !contentStyle.isEmpty, let data = try? JSONEncoder().encode(contentStyle),
           let literal = String(data: data, encoding: .utf8) {
            contentController.addUserScript(WKUserScript(source: """
                const inlineStyle = document.createElement('style');
                inlineStyle.textContent = \(literal);
                document.head.appendChild(inlineStyle);
                """, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        let configuration = WKWebViewConfiguration()
        PaneWebViewChrome.install(on: contentController)
        configuration.userContentController = contentController
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        PaneWebViewChrome.prepare(webView)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.isUserInteractionEnabled = allowsInteraction
        context.coordinator.webView = webView
        context.coordinator.payload = payload
        webView.load(URLRequest(url: AppConfig.learningContentPaneURL))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.onHeightChanged = onHeightChanged
        context.coordinator.onError = onError
        context.coordinator.payload = payload
        context.coordinator.injectPayloadIfReady()
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(
            forName: "openPhysicsSelfReview"
        )
        webView.navigationDelegate = nil
    }

    private static let bridgeBootstrapScript = """
        (function() {
          function forward(method, payload) {
            try {
              window.webkit.messageHandlers.openPhysicsSelfReview.postMessage({
                method: method,
                payload: payload || ""
              });
            } catch (_) {}
          }
          window.OpenPhysicsBridge = {
            onPaneReady: function(payload) { forward("onPaneReady", payload); },
            onPayloadRendered: function(payload) { forward("onPayloadRendered", payload); },
            onPaneError: function(payload) { forward("onPaneError", payload); },
            onHeightChanged: function(payload) { forward("onHeightChanged", payload); }
          };
        })();
        """

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        weak var webView: WKWebView?
        var payload = ""
        var onHeightChanged: (CGFloat) -> Void
        var onError: (String) -> Void

        private var isReady = false
        private var lastInjectedPayload = ""

        init(
            onHeightChanged: @escaping (CGFloat) -> Void,
            onError: @escaping (String) -> Void
        ) {
            self.onHeightChanged = onHeightChanged
            self.onError = onError
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            isReady = true
            injectPayloadIfReady()
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard
                navigationAction.targetFrame?.isMainFrame == true,
                let target = navigationAction.request.url,
                let paneHost = AppConfig.learningContentPaneURL.host,
                target.host != nil,
                target.host != paneHost
            else {
                decisionHandler(.allow)
                return
            }
            decisionHandler(.cancel)
        }

        func webView(
            _ webView: WKWebView,
            didFail navigation: WKNavigation!,
            withError error: Error
        ) {
            onError("内容加载失败，请检查网络。")
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            onError("内容加载失败，请检查网络。")
        }

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard
                let event = message.body as? [String: Any],
                let method = event["method"] as? String
            else { return }
            let body = event["payload"] as? String ?? ""

            switch method {
            case "onPaneReady", "onPayloadRendered":
                isReady = true
                if method == "onPayloadRendered" { PaneWebViewChrome.reveal(webView) }
                injectPayloadIfReady()
            case "onHeightChanged":
                guard
                    let data = body.data(using: .utf8),
                    let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                    let height = object["height"] as? NSNumber
                else { return }
                onHeightChanged(CGFloat(truncating: height))
            case "onPaneError":
                PaneWebViewChrome.reveal(webView)
                onError(Self.errorMessage(from: body))
            default:
                break
            }
        }

        func injectPayloadIfReady() {
            guard isReady, payload != lastInjectedPayload, let webView else { return }
            let payloadLiteral = Self.javascriptLiteral(payload)
            let script = """
                (function injectOpenPhysicsPayload(attempt) {
                  if (window.OpenPhysicsPane && window.OpenPhysicsPane.setPayload) {
                    window.OpenPhysicsPane.setPayload(\(payloadLiteral));
                    return;
                  }
                  if (attempt < 30) {
                    setTimeout(function() { injectOpenPhysicsPayload(attempt + 1); }, 80);
                  }
                })(0);
                """
            lastInjectedPayload = payload
            webView.evaluateJavaScript(script) { [weak self] _, error in
                if error != nil { self?.lastInjectedPayload = "" }
            }
        }

        private static func javascriptLiteral(_ value: String) -> String {
            guard
                let data = try? JSONEncoder().encode(value),
                let literal = String(data: data, encoding: .utf8)
            else { return "\"{}\"" }
            return literal
        }

        private static func errorMessage(from payload: String) -> String {
            guard
                let data = payload.data(using: .utf8),
                let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                let message = object["message"] as? String,
                !message.isEmpty
            else { return "内容加载失败，请重新进入。" }
            return message
        }
    }
}

/// On iPhone only the submit button is prominent; self-review is a secondary action. iPad keeps its layout.
private struct SelfReviewButtonStyle: ViewModifier {
    let isPhone: Bool
    func body(content: Content) -> some View {
        if isPhone { content.buttonStyle(.bordered) } else { content.buttonStyle(.borderedProminent) }
    }
}

private struct AssessmentResultButtonStyle: ViewModifier {
    let isPhone: Bool
    let primary: Bool

    @ViewBuilder func body(content: Content) -> some View {
        if isPhone {
            content
                .buttonStyle(PhoneAssessmentButtonStyle(primary: primary))
        } else if primary {
            content.buttonStyle(.borderedProminent).controlSize(.regular).tint(OpenPhysicsTheme.accent)
        } else {
            content.buttonStyle(.bordered).controlSize(.regular)
        }
    }
}

private struct PhoneAssessmentButtonStyle: ButtonStyle {
    let primary: Bool
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(maxWidth: .infinity, minHeight: 48)
            .padding(.horizontal, 16)
            .foregroundStyle(primary ? Color.white : OpenPhysicsTheme.accent)
            .background(primary ? OpenPhysicsTheme.accent : OpenPhysicsTheme.accentSoft, in: Capsule())
            .opacity(configuration.isPressed ? 0.75 : 1)
    }
}
