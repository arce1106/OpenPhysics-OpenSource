import SwiftUI

enum PracticeHistoryScope: Equatable {
    case all
    case growth(fromDate: String?, toDate: String?)

    var fromDate: String? {
        if case let .growth(fromDate, _) = self { return fromDate }
        return nil
    }

    var toDate: String? {
        if case let .growth(_, toDate) = self { return toDate }
        return nil
    }

    var subtitle: String {
        if
            case let .growth(fromDate?, toDate?) = self,
            !fromDate.isEmpty,
            !toDate.isEmpty
        {
            return "成长回顾区间：\(fromDate) 至 \(toDate)"
        }
        return "按时间查看最近完成的题目、作答、批改和解析。"
    }

    var pageSize: Int {
        if case .growth = self { return 100 }
        return 50
    }
}

enum PracticeHistoryResultFilter: String, CaseIterable, Identifiable {
    case all
    case correct
    case wrong
    case review

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "全部"
        case .correct: return "做对"
        case .wrong: return "做错"
        case .review: return "需确认"
        }
    }
}

func filterPracticeHistory(
    _ records: [AnswerHistoryRecord],
    by filter: PracticeHistoryResultFilter
) -> [AnswerHistoryRecord] {
    switch filter {
    case .all:
        return records
    case .correct:
        return records.filter(\.isCorrect)
    case .wrong:
        return records.filter { !$0.isCorrect }
    case .review:
        return records.filter(\.needsHumanReview)
    }
}

@MainActor
final class PracticeHistoryStore: ObservableObject {
    @Published private(set) var records: [AnswerHistoryRecord] = []
    @Published private(set) var isLoading = false
    @Published private(set) var isLoadingMore = false
    @Published private(set) var canLoadMore = false
    @Published private(set) var requiresLogin = false
    @Published var message = ""

    private let apiClient: APIClient

    init(apiClient: APIClient = APIClient()) {
        self.apiClient = apiClient
    }

    func load(
        student: StudentSession,
        scope: PracticeHistoryScope,
        reset: Bool = true
    ) async {
        if reset {
            guard !isLoading else { return }
            isLoading = true
        } else {
            guard !isLoadingMore, canLoadMore else { return }
            isLoadingMore = true
        }
        message = ""
        requiresLogin = false
        defer {
            isLoading = false
            isLoadingMore = false
        }

        let offset = reset ? 0 : records.count
        do {
            let page = try await apiClient.answerHistory(
                for: student,
                limit: scope.pageSize,
                offset: offset,
                fromDate: scope.fromDate,
                toDate: scope.toDate
            )
            if reset {
                records = page
            } else {
                let existingIds = Set(records.map(\.id))
                records.append(
                    contentsOf: page.filter { !existingIds.contains($0.id) }
                )
            }
            canLoadMore = page.count == scope.pageSize
        } catch {
            if let apiError = error as? APIError, apiError.isUnauthorized {
                requiresLogin = true
            }
            message = (error as? LocalizedError)?.errorDescription
                ?? "练习记录加载失败，请稍后重试。"
            if reset {
                records = []
                canLoadMore = false
            }
        }
    }
}

struct PracticeHistoryView: View {
    @Environment(\.openPhysicsIsPhone) private var isPhone
    @EnvironmentObject private var appSession: AppSession
    @Environment(\.dismiss) private var dismiss
    @StateObject private var store = PracticeHistoryStore()
    @StateObject private var reviewStore = ReviewStore()
    @State private var activeFilter = PracticeHistoryResultFilter.all
    @State private var selectedReviewAnswerId: Int?

    let scope: PracticeHistoryScope

    private var visibleRecords: [AnswerHistoryRecord] {
        filterPracticeHistory(store.records, by: activeFilter)
    }

    private var correctCount: Int {
        store.records.filter(\.isCorrect).count
    }

    private var wrongCount: Int {
        store.records.count - correctCount
    }

    private var accuracy: Int {
        guard !store.records.isEmpty else { return 0 }
        return Int(
            (
                Double(correctCount) / Double(store.records.count) * 100
            ).rounded()
        )
    }

    @MainActor init(scope: PracticeHistoryScope, store: PracticeHistoryStore? = nil) {
        self.scope = scope
        _store = StateObject(wrappedValue: store ?? PracticeHistoryStore())
    }

    var body: some View {
        VStack(spacing: 12) {
            if !isPhone { header }
            timelineCard
        }
        .padding(OpenPhysicsWorkspaceMetrics.pagePadding)
        .background(OpenPhysicsTheme.pageBackground)
        .openPhysicsPrimaryNavigationChrome("练习记录")
        .openPhysicsPhoneRefresh("刷新练习记录", isRefreshing: store.isLoading) { await load(reset: true) }
        .navigationDestination(
            isPresented: Binding(
                get: { selectedReviewAnswerId != nil },
                set: { isPresented in
                    if !isPresented { selectedReviewAnswerId = nil }
                }
            )
        ) {
            if let record = selectedReviewRecord {
                ReviewMistakeDetailView(
                    store: reviewStore,
                    summary: record.reviewSummary
                )
            }
        }
        .task(id: appSession.studentSession?.studentID) {
            await load(reset: true)
        }
        .onChange(of: store.requiresLogin) { requiresLogin in
            if requiresLogin {
                appSession.logout(message: "登录已失效，请重新登录。")
            }
        }
        .onChange(of: reviewStore.requiresLogin) { requiresLogin in
            if requiresLogin {
                appSession.logout(message: "登录已失效，请重新登录。")
            }
        }
    }

    private var selectedReviewRecord: AnswerHistoryRecord? {
        guard let selectedReviewAnswerId else { return nil }
        return store.records.first { $0.id == selectedReviewAnswerId }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 16) {
            OpenPhysicsBackButton { dismiss() }

            VStack(alignment: .leading, spacing: 5) {
                Text("练习记录")
                    .font(.title.weight(.heavy))
                Text(scope.subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            historyBadge(
                value: "\(store.records.count)",
                label: "最近记录",
                color: OpenPhysicsTheme.accent
            )
            historyBadge(
                value: "\(wrongCount)",
                label: "需订正",
                color: wrongCount > 0 ? .orange : .green
            )

            OpenPhysicsRefreshButton(
                title: "刷新练习记录",
                isRefreshing: store.isLoading
            ) {
                Task { await load(reset: true) }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 15)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(Color(uiColor: .separator).opacity(0.24), lineWidth: 1)
        }
    }

    private var timelineCard: some View {
        VStack(spacing: 12) {
            OpenPhysicsAdaptiveStack(spacing: 14, alignment: .center) {
                VStack(alignment: .leading, spacing: 4) {
                    if !isPhone {
                    Text("练习记录时间线")
                        .font(.title2.weight(.heavy))
                    }
                    Text(
                        "共 \(store.records.count) 道 · 正确 \(correctCount) · 需订正 \(wrongCount) · 正确率 \(accuracy)%"
                    )
                    .font(isPhone ? .footnote : .subheadline)
                    .foregroundStyle(.secondary)
                }

                if !isPhone { Spacer() }
                filterBar
            }

            Divider()

            Group {
                if store.isLoading && store.records.isEmpty {
                    ProgressView("正在整理练习记录…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if !store.message.isEmpty && store.records.isEmpty {
                    errorState
                } else if visibleRecords.isEmpty {
                    emptyState
                } else {
                    VStack(spacing: 10) {
                        HistoryRecordsPaneView(
                            records: visibleRecords,
                            onOpenReview: { answerId in
                                selectedReviewAnswerId = answerId
                            },
                            onError: { store.message = $0 }
                        )
                        .frame(maxWidth: .infinity, maxHeight: .infinity)

                        if store.canLoadMore {
                            Button {
                                Task { await load(reset: false) }
                            } label: {
                                HStack(spacing: 8) {
                                    if store.isLoadingMore {
                                        ProgressView()
                                            .controlSize(.small)
                                    }
                                    Text(
                                        store.isLoadingMore
                                            ? "正在加载…"
                                            : "加载更多记录"
                                    )
                                }
                            }
                            .buttonStyle(.bordered)
                            .buttonBorderShape(.capsule)
                            .tint(OpenPhysicsTheme.accent)
                            .disabled(store.isLoadingMore)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            if !store.message.isEmpty && !store.records.isEmpty {
                Label(store.message, systemImage: "exclamationmark.circle")
                    .font(.callout)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(isPhone ? 0 : 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(isPhone ? Color.clear : Color(uiColor: .systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: isPhone ? 0 : 20, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(isPhone ? Color.clear : Color(uiColor: .separator).opacity(0.32), lineWidth: 1)
        }
    }

    private var filterBar: some View {
        HStack(spacing: 4) {
            ForEach(PracticeHistoryResultFilter.allCases) { filter in
                Button {
                    activeFilter = filter
                } label: {
                    HStack(spacing: 6) {
                        Text(filter.title)
                        Text("\(count(for: filter))")
                            .font(.caption.monospacedDigit())
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(
                        activeFilter == filter
                            ? OpenPhysicsTheme.accent
                            : Color.secondary
                    )
                    .padding(.horizontal, 13)
                    .frame(height: 36)
                    .background(
                        activeFilter == filter
                            ? Color(uiColor: .systemBackground)
                            : Color.clear
                    )
                    .clipShape(Capsule())
                    .overlay {
                        Capsule()
                            .stroke(
                                activeFilter == filter
                                    ? OpenPhysicsTheme.accent.opacity(0.42)
                                    : Color.clear,
                                lineWidth: 1
                            )
                    }
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(
                    activeFilter == filter ? .isSelected : []
                )
            }
        }
        .padding(4)
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(Capsule())
        .overlay {
            Capsule()
                .stroke(Color(uiColor: .separator).opacity(0.32), lineWidth: 1)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "clock.arrow.circlepath")
                .font(.system(size: 42))
                .foregroundStyle(OpenPhysicsTheme.accent)
            Text(store.records.isEmpty ? "还没有练习记录" : "暂无符合条件的记录")
                .font(.title3.bold())
            Text(
                store.records.isEmpty
                    ? "完成练习后会自动生成学习记录。"
                    : "换一个筛选条件继续查看。"
            )
            .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var errorState: some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.largeTitle)
                .foregroundStyle(.orange)
            Text(store.message)
                .foregroundStyle(.secondary)
            Button("重新加载") {
                Task { await load(reset: true) }
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.capsule)
            .tint(OpenPhysicsTheme.accent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func count(for filter: PracticeHistoryResultFilter) -> Int {
        filterPracticeHistory(store.records, by: filter).count
    }

    private func historyBadge(
        value: String,
        label: String,
        color: Color
    ) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.headline.weight(.heavy))
                .foregroundStyle(color)
                .monospacedDigit()
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 14)
        .frame(height: 50)
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
    }

    private func load(reset: Bool) async {
        guard
            let student = appSession.studentSession
        else { return }
        await store.load(student: student, scope: scope, reset: reset)
    }
}

/// What a homework row says on the right: the score once finished, otherwise where it stands.
func homeworkRecordStatus(_ item: TeacherHomework) -> (status: String, note: String) {
    switch item.status {
    case "completed":
        guard let score = item.homeworkScore else { return ("已完成", "") }
        return (score.label, score.note)
    case "grading": return ("批改中", "已批改 \(item.gradedCount)/\(item.questionCount)")
    default: return ("未完成", "\(item.questionCount) 题")
    }
}

func homeworkRecordMeta(_ item: TeacherHomework) -> String {
    var parts = [String]()
    if !item.className.isEmpty { parts.append(item.className) }
    parts.append(item.delivery == "paper" ? "纸质作业" : "\(item.questionCount) 题")
    if let published = item.publishedAt, published.count >= 10 { parts.append("布置于 \(published.prefix(10))") }
    return parts.joined(separator: " · ")
}

/// The mean out of 100 of the homework that has a score; nil when none has.
func homeworkAverage(_ items: [TeacherHomework]) -> Int? {
    let scores = items.compactMap { $0.homeworkScore?.percent }
    guard !scores.isEmpty else { return nil }
    return Int((Double(scores.reduce(0, +)) / Double(scores.count)).rounded())
}

/// 作业记录: every teacher homework the student has had, newest first.
/// The home card shows only the latest one.
struct HomeworkHistoryView: View {
    @Environment(\.openPhysicsIsPhone) private var isPhone
    @EnvironmentObject private var appSession: AppSession
    @Environment(\.dismiss) private var dismiss
    @StateObject private var homeworkStore = PracticeStore()
    @State private var items: [TeacherHomework] = []
    @State private var isLoading = false
    @State private var message = ""
    @State private var showsHomework = false

    var body: some View {
        VStack(spacing: 12) {
            if !isPhone { header }
            listCard
        }
        .padding(OpenPhysicsWorkspaceMetrics.pagePadding)
        .background(OpenPhysicsTheme.pageBackground)
        .openPhysicsPrimaryNavigationChrome("作业记录")
        .openPhysicsPhoneRefresh("刷新作业记录", isRefreshing: isLoading) { await load() }
        .navigationDestination(isPresented: $showsHomework) {
            PracticeWorkspaceView(store: homeworkStore) {
                Task { await load() }
            }
        }
        .onChange(of: showsHomework) { shown in
            if !shown { Task { await load() } }
        }
        .task(id: appSession.studentSession?.studentID) { await load() }
        .onChange(of: homeworkStore.requiresLogin) { expired in
            if expired { appSession.logout(message: "登录已失效，请重新登录。") }
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 16) {
            OpenPhysicsBackButton { dismiss() }
            VStack(alignment: .leading, spacing: 5) {
                Text("作业记录")
                    .font(.title.weight(.heavy))
                Text("按时间查看老师布置的每次作业，打开可看答卷和批改。")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            badge(value: "\(items.count)", label: "份作业", color: OpenPhysicsTheme.accent)
            if let average = homeworkAverage(items) {
                badge(value: "\(average)", label: "平均分", color: OpenPhysicsTheme.accent)
            }
            OpenPhysicsRefreshButton(title: "刷新作业记录", isRefreshing: isLoading) {
                Task { await load() }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 15)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(Color(uiColor: .separator).opacity(0.24), lineWidth: 1)
        }
    }

    private var listCard: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text(isPhone ? "共 \(items.count) 份老师作业" : "得分按百分制显示")
                    .font(isPhone ? .footnote : .subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.bottom, 8)
                if isLoading && items.isEmpty {
                    ProgressView("正在加载老师作业…").frame(maxWidth: .infinity).padding(.vertical, 40)
                } else if items.isEmpty {
                    Text(message.isEmpty ? "还没有老师作业。老师布置后，可在这里查看每次作业的得分和答卷。" : message)
                        .foregroundStyle(.secondary)
                        .padding(.vertical, 24)
                }
                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                    if index > 0 { Divider() }
                    row(item)
                }
                if !homeworkStore.message.isEmpty {
                    Text(homeworkStore.message).font(.footnote).foregroundStyle(.red).padding(.top, 8)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(uiColor: .systemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(Color(uiColor: .separator).opacity(0.32), lineWidth: 1)
            }
        }
    }

    private func row(_ item: TeacherHomework) -> some View {
        let state = homeworkRecordStatus(item)
        let scored = item.status == "completed" && item.homeworkScore != nil
        return Button { open(item) } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.title)
                        .font(isPhone ? .headline : .title3.weight(.semibold))
                        .foregroundStyle(.primary)
                    Text(homeworkRecordMeta(item))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .trailing, spacing: 4) {
                    Text(state.status)
                        .font(.headline.weight(.heavy).monospacedDigit())
                        .foregroundStyle(scored ? OpenPhysicsTheme.accent : Color.secondary)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 3)
                        .background(scored ? OpenPhysicsTheme.accentSoft : Color.clear, in: Capsule())
                    if !state.note.isEmpty {
                        Text(state.note).font(.caption2).foregroundStyle(.secondary)
                    }
                }
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(.tertiary)
            }
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(homeworkStore.isLoading)
        .accessibilityLabel("\(item.title)，\(state.status)\(state.note.isEmpty ? "" : "，\(state.note)")")
    }

    private func badge(value: String, label: String, color: Color) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.headline.weight(.heavy))
                .foregroundStyle(color)
                .monospacedDigit()
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 14)
        .frame(height: 50)
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
    }

    private func load() async {
        guard let student = appSession.studentSession else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            items = try await APIClient().teacherHomework(for: student, history: true)
            message = ""
        } catch {
            message = "暂时无法加载老师作业，下拉或点刷新重试。"
        }
    }

    private func open(_ item: TeacherHomework) {
        guard let student = appSession.studentSession, !homeworkStore.isLoading else { return }
        Task {
            if await homeworkStore.startTeacherHomework(student: student, attemptId: item.attemptId, title: item.title) {
                showsHomework = true
            }
        }
    }
}
