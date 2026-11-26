import SwiftUI

enum HomeTaskDestination: Equatable {
    case sync
    case reinforcement
    case review

    var appSection: AppSection {
        switch self {
        case .sync: return .sync
        case .reinforcement: return .reinforcement
        case .review: return .review
        }
    }
}

struct HomeTaskPresentation: Equatable {
    let title: String
    let reason: String
    let actionTitle: String
    let destination: HomeTaskDestination
}

func homeMilestoneKnowledgePoint(
    milestone: String,
    points: [SyncKnowledgePoint],
    preferredID: String?
) -> SyncKnowledgePoint? {
    // The current dashboard supplies the milestone as text, not a knowledge-point ID.
    // Resolve its exact name; the general study recommendation can refer to another point.
    guard let opening = milestone.firstIndex(of: "「"),
          let closing = milestone.lastIndex(of: "」"), opening < closing else { return nil }
    let name = String(milestone[milestone.index(after: opening)..<closing])
    let matches = points.filter { $0.name == name }
    if let preferredID, let preferred = matches.first(where: { $0.id == preferredID }) {
        return preferred
    }
    return matches.count == 1 ? matches.first : nil
}

func buildTodayHomeTask(
    _ dashboard: DashboardData?
) -> HomeTaskPresentation {
    if let backlog = dashboard?.motivation.mistakeBacklogCount, backlog > 0 {
        return HomeTaskPresentation(
            title: "先清除 \(backlog) 道待复盘错题",
            reason: "先把已经暴露的问题解决，再进入新知识或新题，提分效率最高。",
            actionTitle: "去复盘错题",
            destination: .review
        )
    }

    if let plan = dashboard?.plan {
        let isLearning = plan.mastery < 0.4
        return HomeTaskPresentation(
            title: "推进「\(plan.kpName)」",
            reason: plan.reason,
            actionTitle: isLearning ? "进入同步学习" : "进入巩固提升",
            destination: isLearning ? .sync : .reinforcement
        )
    }

    return HomeTaskPresentation(
        title: "保持节奏，完成一次综合复习",
        reason: dashboard?.motivation.nextMilestone
            ?? "当前没有明显薄弱点，可以用综合练习保持手感。",
        actionTitle: "开始巩固提升",
        destination: .reinforcement
    )
}

struct HomeLoopRingPresentation: Equatable {
    let title: String
    let current: Int
    let target: Int
    let progress: Double
    let overflowProgress: Double
    let completed: Bool
    let autoCompleted: Bool

    var countLabel: String {
        if autoCompleted {
            return "\(current)/\(target) · 已清空"
        }
        return "\(current)/\(target)"
    }
}

struct HomeLearningLoopPresentation: Equatable {
    let practice: HomeLoopRingPresentation
    let review: HomeLoopRingPresentation

    var closedCount: Int {
        [practice, review].filter(\.completed).count
    }

    var centerValue: String {
        closedCount == 2 ? "双环" : "\(closedCount)/2"
    }
}

func buildHomeLearningLoopPresentation(
    loop: DailyLearningLoop?,
    dashboard: DashboardData
) -> HomeLearningLoopPresentation {
    func makeRing(
        title: String,
        ring: DailyLoopRing?,
        fallbackTarget: Int,
        fallbackCompleted: Bool = false
    ) -> HomeLoopRingPresentation {
        let target = max(ring?.target ?? fallbackTarget, 0)
        let displayCurrent = max(ring?.actualCurrent ?? 0, 0)
        let progress: Double
        let overflowProgress: Double

        if let ring, ring.target > 0 {
            progress = min(max(Double(ring.current) / Double(ring.target), 0), 1)
            overflowProgress = min(
                max(Double(ring.overflow) / Double(ring.target), 0),
                1
            )
        } else {
            progress = fallbackCompleted ? 1 : 0
            overflowProgress = 0
        }

        return HomeLoopRingPresentation(
            title: title,
            current: displayCurrent,
            target: target,
            progress: progress,
            overflowProgress: overflowProgress,
            completed: ring?.completed ?? fallbackCompleted,
            autoCompleted: ring?.autoCompleted ?? fallbackCompleted
        )
    }

    return HomeLearningLoopPresentation(
        practice: makeRing(
            title: "做题",
            ring: loop?.rings.practice,
            fallbackTarget: 5
        ),
        review: makeRing(
            title: "复盘",
            ring: loop?.rings.review,
            fallbackTarget: 3,
            fallbackCompleted: dashboard.motivation.mistakeBacklogCount == 0
        )
    )
}

struct HomeLoopCalendarCell: Equatable {
    let isoDate: String?
    let dayNumber: Int?
    let day: DailyLearningLoopDay?
    let isInHistoryRange: Bool
    let isToday: Bool
}

struct HomeLoopCalendarMonth: Equatable {
    let key: String
    let label: String
    let cells: [HomeLoopCalendarCell]
}

func buildHomeLoopCalendarMonths(
    history: DailyLearningLoopHistory,
    todayDate: String? = nil
) -> [HomeLoopCalendarMonth] {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? .current

    func parse(_ value: String) -> Date? {
        let parts = value.split(separator: "-").compactMap {
            Int($0)
        }
        guard parts.count == 3 else { return nil }
        return calendar.date(
            from: DateComponents(
                year: parts[0],
                month: parts[1],
                day: parts[2]
            )
        )
    }

    guard
        let start = parse(history.startDate),
        let end = parse(history.endDate),
        var cursor = calendar.date(
            from: DateComponents(
                year: calendar.component(.year, from: start),
                month: calendar.component(.month, from: start),
                day: 1
            )
        ),
        let lastMonth = calendar.date(
            from: DateComponents(
                year: calendar.component(.year, from: end),
                month: calendar.component(.month, from: end),
                day: 1
            )
        )
    else {
        return []
    }

    let dayMap = Dictionary(
        uniqueKeysWithValues: history.days.map { ($0.date, $0) }
    )
    let resolvedToday = todayDate ?? history.endDate
    var months: [HomeLoopCalendarMonth] = []

    while cursor <= lastMonth {
        let year = calendar.component(.year, from: cursor)
        let month = calendar.component(.month, from: cursor)
        let weekday = calendar.component(.weekday, from: cursor)
        let mondayFirstOffset = (weekday + 5) % 7
        let dayCount = calendar.range(of: .day, in: .month, for: cursor)?.count
            ?? 0
        var cells = Array(
            repeating: HomeLoopCalendarCell(
                isoDate: nil,
                dayNumber: nil,
                day: nil,
                isInHistoryRange: false,
                isToday: false
            ),
            count: mondayFirstOffset
        )

        if dayCount > 0 {
            for dayNumber in 1...dayCount {
                let isoDate = String(
                    format: "%04d-%02d-%02d",
                    year,
                    month,
                    dayNumber
                )
                cells.append(
                    HomeLoopCalendarCell(
                        isoDate: isoDate,
                        dayNumber: dayNumber,
                        day: dayMap[isoDate],
                        isInHistoryRange:
                            isoDate >= history.startDate
                            && isoDate <= history.endDate,
                        isToday: isoDate == resolvedToday
                    )
                )
            }
        }

        months.append(
            HomeLoopCalendarMonth(
                key: "\(year)-\(month)",
                label: "\(year)年\(month)月",
                cells: cells
            )
        )
        guard
            let nextMonth = calendar.date(
                byAdding: .month,
                value: 1,
                to: cursor
            )
        else {
            break
        }
        cursor = nextMonth
    }

    return Array(months.reversed())
}

struct HomeView: View {
    @Environment(\.openPhysicsIsPhone) private var isPhone
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @EnvironmentObject private var appSession: AppSession
    @State private var showsPracticeHistory = false
    @State private var showsHomeworkHistory = false
    @State private var showsLoopHistory = false
    @State private var teacherHomework: [TeacherHomework] = []
    @State private var showsHomework = false
    @State private var showsMoreHomework = false
    @StateObject private var homeworkStore = PracticeStore()

    private let onNavigate: (AppSection) -> Void

    init(onNavigate: @escaping (AppSection) -> Void = { _ in }) {
        self.onNavigate = onNavigate
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                header

                // With a dashboard, homework leads the 今日推荐任务 card instead.
                if !teacherHomework.isEmpty, appSession.dashboard == nil {
                    teacherHomeworkCard
                }

                if let dashboard = appSession.dashboard {
                    if isPhone {
                        // The 学习 and 错题 tabs already hold these entries; phone home keeps one task.
                        missionCard(dashboard)
                        learningStatusCard(dashboard)
                    } else {
                        // The sidebar already lists every entry; repeating them as cards added nothing.
                        heroSection(dashboard)
                    }
                    growthSection(dashboard)
                } else if appSession.isWorking {
                    loadingCard
                } else {
                    retryCard
                }
            }
            .padding(OpenPhysicsWorkspaceMetrics.pagePadding)
        }
        .task(id: appSession.studentSession?.token) {
            async let dashboard: Void = appSession.refreshDashboard()
            async let homework: Void = loadTeacherHomework()
            _ = await (dashboard, homework)
        }
        .refreshable {
            async let dashboard: Void = appSession.refreshDashboard()
            async let homework: Void = loadTeacherHomework()
            _ = await (dashboard, homework)
        }
        .background(OpenPhysicsTheme.pageBackground)
        .openPhysicsPrimaryNavigationChrome(isPhone ? "今天怎么学" : "")
        .navigationDestination(isPresented: $showsPracticeHistory) {
            PracticeHistoryView(scope: practiceHistoryScope)
        }
        .navigationDestination(isPresented: $showsHomeworkHistory) {
            HomeworkHistoryView()
        }
        .navigationDestination(isPresented: $showsHomework) {
            PracticeWorkspaceView(store: homeworkStore) {
                Task { await loadTeacherHomework() }
            }
        }
        .onChange(of: showsHomework) { shown in
            if !shown { Task { await loadTeacherHomework() } }
        }
        .onChange(of: homeworkStore.requiresLogin) { expired in
            if expired { appSession.logout(message: "登录已失效，请重新登录。") }
        }
        .alert("班级", isPresented: Binding(
            get: { !appSession.classJoinNotice.isEmpty }, set: { if !$0 { appSession.classJoinNotice = "" } }
        )) {
            Button("知道了", role: .cancel) { appSession.classJoinNotice = "" }
        } message: { Text(appSession.classJoinNotice) }
    }

    /// Failures stay quiet: the card is extra, and the rest of home must still load.
    private func loadTeacherHomework() async {
        guard let student = appSession.studentSession else {
            teacherHomework = []
            return
        }
        if let items = try? await APIClient().teacherHomework(for: student) {
            teacherHomework = items
        }
    }

    private func openTeacherHomework(_ item: TeacherHomework) {
        guard let student = appSession.studentSession, !homeworkStore.isLoading else { return }
        Task {
            if await homeworkStore.startTeacherHomework(
                student: student, attemptId: item.attemptId, title: item.title
            ) {
                showsHomework = true
            }
        }
    }

    private var homeTeacherHomework: HomeTeacherHomework { HomeTeacherHomework(teacherHomework) }

    private var hasPendingTeacherHomework: Bool {
        teacherHomework.contains { $0.status != "completed" }
    }

    private var teacherHomeworkCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("今日推荐任务")
                .font(.subheadline.weight(.bold))
                .foregroundStyle(OpenPhysicsTheme.accent)
            teacherHomeworkRows
        }
        .padding(isPhone ? 18 : 22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .homePanel()
        .accessibilityElement(children: .contain)
    }

    private var teacherHomeworkRows: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(homeTeacherHomework.rows(expanded: showsMoreHomework)) { item in
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.kindLabel)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(OpenPhysicsTheme.accent)
                        Text(item.title)
                            .font(isPhone ? .headline : .title3.weight(.semibold))
                        Text(item.detail)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    if item.status == "completed" {
                        Button(item.actionTitle) { openTeacherHomework(item) }
                            .buttonStyle(.bordered)
                            .buttonBorderShape(.capsule)
                    } else {
                        Button(item.actionTitle) { openTeacherHomework(item) }
                            .buttonStyle(.borderedProminent)
                            .buttonBorderShape(.capsule)
                            .tint(OpenPhysicsTheme.accent)
                    }
                }
                .disabled(homeworkStore.isLoading)
            }

            if let label = homeTeacherHomework.moreLabel(expanded: showsMoreHomework) {
                Button(label) { showsMoreHomework.toggle() }
                    .font(.subheadline.weight(.semibold))
                    .tint(OpenPhysicsTheme.accent)
            }

            if !homeworkStore.message.isEmpty {
                Text(homeworkStore.message)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !isPhone {
                HStack(spacing: 8) {
                    OpenPhysicsSidebarRevealButton()
                    Text("今天怎么学")
                        .font(.largeTitle.weight(.heavy))
                        .fontWidth(.expanded)
                }
            }
            Text(
                isPhone
                    ? "\(appSession.studentSession?.displayLabel ?? "同学")，先完成最值得做的一件事。"
                    : "\(appSession.studentSession?.displayLabel ?? "同学")，先完成最值得做的一件事，再选择学习入口。"
            )
            .font(isPhone ? .subheadline : .body.weight(.semibold))
            .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 2)
        .padding(.bottom, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func heroSection(_ dashboard: DashboardData) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 14) {
                missionCard(dashboard)
                    .frame(minWidth: 500, maxWidth: .infinity)
                learningStatusCard(dashboard)
                    .frame(minWidth: 310, idealWidth: 340, maxWidth: 380)
            }

            VStack(spacing: 12) {
                missionCard(dashboard)
                learningStatusCard(dashboard)
            }
        }
    }

    private func missionCard(_ dashboard: DashboardData) -> some View {
        let task = buildTodayHomeTask(dashboard)

        return VStack(alignment: .leading, spacing: 0) {
            Text("今日推荐任务")
                .font(.subheadline.weight(.bold))
                .foregroundStyle(OpenPhysicsTheme.accent)

            // A teacher's homework comes before the system's own recommendation.
            if !teacherHomework.isEmpty {
                teacherHomeworkRows
                    .padding(.top, 12)
                Divider()
                    .padding(.top, 14)
            }

            Text(task.title)
                .font(teacherHomework.isEmpty
                    ? (isPhone ? .title2.weight(.semibold) : .title.weight(.heavy))
                    : (isPhone ? .headline : .title3.weight(.semibold)))
                .padding(.top, teacherHomework.isEmpty ? 10 : 14)

            Text(task.reason)
                .font(isPhone ? .subheadline : .body)
                .foregroundStyle(.secondary)
                .lineSpacing(3)
                .padding(.top, 10)

            Spacer(minLength: 16)

            if hasPendingTeacherHomework {
                Button(task.actionTitle) {
                    onNavigate(task.destination.appSection)
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .tint(OpenPhysicsTheme.accent)
            } else {
                Button(task.actionTitle) {
                    onNavigate(task.destination.appSection)
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .controlSize(.large)
                .tint(OpenPhysicsTheme.accent)
            }
        }
        .padding(isPhone ? 18 : 22)
        .frame(maxWidth: .infinity, minHeight: isPhone ? 180 : 208, alignment: .leading)
        .background {
            LinearGradient(
                colors: [
                    Color(uiColor: .systemBackground),
                    OpenPhysicsTheme.accentSoft.opacity(0.5),
                ],
                startPoint: .leading,
                endPoint: .trailing
            )
        }
        .homePanel()
        .accessibilityElement(children: .contain)
    }

    private func learningStatusCard(_ dashboard: DashboardData) -> some View {
        let loop = buildHomeLearningLoopPresentation(
            loop: appSession.dailyLearningLoop,
            dashboard: dashboard
        )

        return VStack(spacing: 10) {
            HStack(spacing: 16) {
                Button {
                    showsLoopHistory = true
                    Task {
                        await appSession.loadDailyLearningLoopHistory()
                    }
                } label: {
                    HomeEnergyRingsView(presentation: loop)
                        .frame(width: 116, height: 116)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityHint("打开近 35 天学习日历")
                .popover(
                    isPresented: $showsLoopHistory,
                    attachmentAnchor: .rect(.bounds),
                    arrowEdge: .top
                ) {
                    HomeLoopHistoryPopover(
                        history: appSession.dailyLearningLoopHistory,
                        todayLoop: appSession.dailyLearningLoop,
                        todayPresentation: loop,
                        isLoading: appSession.isLoadingDailyLearningLoopHistory,
                        errorMessage: appSession.dailyLearningLoopHistoryError,
                        onRetry: {
                            Task {
                                await appSession.loadDailyLearningLoopHistory(
                                    force: true
                                )
                            }
                        },
                        onDismiss: {
                            showsLoopHistory = false
                        }
                    )
                    .frame(
                        minWidth: isPhone ? 0 : 500,
                        idealWidth: isPhone ? 360 : 540,
                        maxWidth: isPhone ? .infinity : 580,
                        minHeight: 520,
                        idealHeight: 600,
                        maxHeight: 660
                    )
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("今日目标")
                        .font(.headline.weight(.heavy))

                    HomeLoopLegendRow(
                        ring: loop.practice,
                        color: OpenPhysicsTheme.accent
                    )
                    HomeLoopLegendRow(
                        ring: loop.review,
                        color: Color(red: 0.34, green: 0.68, blue: 0.18)
                    )
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            Divider()

            HStack(spacing: 8) {
                // Phone: the theme colour for progress, one warning colour only when mistakes are waiting.
                HomeOutcomeMetric(
                    title: "连续学习天数",
                    value: "\(appSession.dailyLearningLoop?.streakDays ?? dashboard.motivation.streakDays)",
                    color: isPhone ? OpenPhysicsTheme.accent : Color(red: 0.83, green: 0.42, blue: 0.03)
                )
                HomeOutcomeMetric(
                    title: "本周掌握知识点",
                    value: "\(dashboard.motivation.weeklyKpsMastered)",
                    color: isPhone ? OpenPhysicsTheme.accent : Color(red: 0.18, green: 0.62, blue: 0.27)
                )
                HomeOutcomeMetric(
                    title: "待复盘错题",
                    value: "\(dashboard.motivation.mistakeBacklogCount)",
                    color: isPhone
                        ? (dashboard.motivation.mistakeBacklogCount > 0 ? Color.orange : Color.secondary)
                        : Color(red: 0.84, green: 0.22, blue: 0.06)
                )
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 220, alignment: .center)
        .background(Color(uiColor: .systemBackground))
        .homePanel()
        .accessibilityElement(children: .contain)
    }

    private func growthSection(_ dashboard: DashboardData) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 5) {
                Text("学习成长记录")
                    .font(.title2.weight(.heavy))
                if !isPhone {
                    Text(growthDescription(dashboard))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 22)
            .padding(.vertical, 18)

            Divider()

            OpenPhysicsAdaptiveStack(spacing: 0, alignment: .top) {
                growthAdvice(dashboard)
                    .frame(maxWidth: .infinity)
                Divider()
                growthReport
                    .frame(maxWidth: .infinity)
            }
        }
        .background(Color(uiColor: .systemBackground))
        .homePanel()
    }

    private func growthAdvice(_ dashboard: DashboardData) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("下一步建议")
                .font(.headline.weight(.heavy))
            if !isPhone {
                Text(
                    "先按今日推荐完成最关键任务，再根据错题、掌握度和知识点状态选择入口。系统会用练习、订正和复盘数据更新下一步建议。"
                )
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineSpacing(4)
                .padding(.top, 12)
            }

            if let milestone = dashboard.motivation.nextMilestone,
               !milestone.isEmpty {
                Spacer(minLength: 16)

                if isPhone {
                    NavigationLink {
                        HomeMilestoneLearningView(
                            milestone: milestone,
                            preferredID: dashboard.plan?.kpId
                        )
                    } label: {
                        milestoneCard(milestone)
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("打开这个知识点的学习页面")
                } else {
                    milestoneCard(milestone)
                }
            }
        }
        .padding(22)
        .frame(
            maxWidth: .infinity,
            maxHeight: .infinity,
            alignment: .topLeading
        )
    }

    private func milestoneCard(_ milestone: String) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("下一目标")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(milestone)
                    .font(.subheadline.weight(.heavy))
                    .foregroundStyle(OpenPhysicsTheme.accent)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if isPhone {
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(OpenPhysicsTheme.accent)
            }
        }
        .padding(.horizontal, 14)
        .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
        .background(OpenPhysicsTheme.accentSoft)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .stroke(OpenPhysicsTheme.accent.opacity(0.2), lineWidth: 1)
        }
        .contentShape(RoundedRectangle(cornerRadius: 12))
    }

    private var growthReport: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("成长回顾")
                    .font(.headline.weight(.heavy))
                Spacer()
                OpenPhysicsRefreshButton(
                    title: "刷新成长回顾",
                    isRefreshing: appSession.isRefreshingGrowthReport
                ) {
                    Task { await appSession.refreshGrowthReport() }
                }
            }

            GrowthReviewSummaryView(text: appSession.growthReport.map {
                canonicalGrowthSummary($0.summary)
            } ?? "完成一段连续学习后，这里会整理近期掌握提升、错因变化和下一步复习重点。")
            .padding(.top, 10)

            if let report = appSession.growthReport,
               let startDate = report.startDate,
               let endDate = report.endDate {
                Text("\(startDate) ~ \(endDate)")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .padding(.top, 12)
            }

            Spacer(minLength: 16)

            // 作业记录 sits beside 练习记录 (the home card shows only the latest homework). On iPad
            // they share one row, level with 下一目标 in the left column; iPhone stacks them.
            if isPhone {
                VStack(spacing: 10) { recordButtons }
            } else {
                HStack(spacing: 10) { recordButtons }
            }
        }
        .padding(22)
        .frame(
            maxWidth: .infinity,
            maxHeight: .infinity,
            alignment: .topLeading
        )
    }

    @ViewBuilder
    private var recordButtons: some View {
        recordButton(label: "练习记录", title: growthRecordButtonTitle) { showsPracticeHistory = true }
        recordButton(label: "作业记录", title: "查看历次作业得分") { showsHomeworkHistory = true }
    }

    private func recordButton(label: String, title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(label)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(title)
                        .font(.subheadline.weight(.heavy))
                        .foregroundStyle(OpenPhysicsTheme.accent)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(OpenPhysicsTheme.accent)
            }
            .padding(.horizontal, 14)
            .frame(
                maxWidth: .infinity,
                minHeight: 60,
                alignment: .leading
            )
            .background(OpenPhysicsTheme.accentSoft)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay {
                RoundedRectangle(cornerRadius: 12)
                    .stroke(
                        OpenPhysicsTheme.accent.opacity(0.2),
                        lineWidth: 1
                    )
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(label)：\(title)")
    }

    private var practiceHistoryScope: PracticeHistoryScope {
        guard
            let report = appSession.growthReport,
            report.metrics?.totalAnswers ?? 0 > 0
        else {
            return .all
        }
        return .growth(
            fromDate: report.startDate,
            toDate: report.endDate
        )
    }

    private var loadingCard: some View {
        HStack(spacing: 12) {
            ProgressView()
            Text("正在生成今日学习建议…")
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .systemBackground))
        .homePanel()
    }

    private var retryCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(
                appSession.message.isEmpty
                    ? "首页暂时没有数据"
                    : appSession.message
            )
            Button("重新加载") {
                Task { await appSession.refreshDashboard() }
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.capsule)
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .systemBackground))
        .homePanel()
    }

    private func growthDescription(_ dashboard: DashboardData) -> String {
        let streakDays =
            appSession.dailyLearningLoop?.streakDays
            ?? dashboard.motivation.streakDays
        if streakDays > 0 {
            return "最近连续 \(streakDays) 天有学习记录，系统会根据作答、订正和知识点掌握变化持续更新反馈。"
        }
        return "完成学习、练习或订正后，系统会记录知识点掌握变化，并给出下一步建议。"
    }

    private var growthRecordButtonTitle: String {
        let answerCount = appSession.growthReport?.metrics?.totalAnswers ?? 0
        return answerCount > 0
            ? "查看这 \(answerCount) 题记录"
            : "查看练习记录"
    }

    private func canonicalGrowthSummary(_ summary: String) -> String {
        let names = [
            "v1c1s3k02": "平均速度与瞬时速度",
            "v1c1s2k01": "时刻与时间间隔",
            "v1c2s3k02": "速度与位移的关系",
            "v1c2s2k01": "速度与时间的关系",
            "v1c1s1k02": "参考系",
        ]
        let named = names.reduce(summary) { result, pair in
            result.replacingOccurrences(of: pair.key, with: pair.value)
        }
        // Older reports state "正确率 0%" for a week without answers; that is no accuracy at all.
        .replacingOccurrences(of: "本周你完成了 0 道题，正确率 0%。", with: "本周还没有做题。")
        // The listed points are cumulative, not this week's; say so to match "本周掌握知识点".
        guard !named.contains("已掌握的知识点包括") else { return named }
        return named.replacingOccurrences(of: "掌握的知识点包括", with: "目前已掌握的知识点包括")
    }
}

private struct HomeLoopHistoryPopover: View {
    let history: DailyLearningLoopHistory?
    let todayLoop: DailyLearningLoop?
    let todayPresentation: HomeLearningLoopPresentation
    let isLoading: Bool
    let errorMessage: String
    let onRetry: () -> Void
    let onDismiss: () -> Void

    private var syncedHistory: DailyLearningLoopHistory? {
        guard let history else { return nil }
        guard let todayLoop else { return history }
        return history.mergingToday(todayLoop)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Label("学习日历", systemImage: "calendar")
                    .font(.title3.weight(.heavy))
                    .foregroundStyle(.primary)

                Spacer()

                Text(
                    syncedHistory.map { "近\($0.days.count)天" }
                    ?? (isLoading ? "加载中" : "近35天")
                )
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

                Button(action: onDismiss) {
                    Image(systemName: "xmark")
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .controlSize(.small)
                .tint(OpenPhysicsTheme.accent)
                .accessibilityLabel("关闭学习日历")
            }

            HomeLoopTodayHistoryRow(presentation: todayPresentation)

            if isLoading && syncedHistory == nil {
                Spacer()
                ProgressView("正在同步历史记录…")
                    .frame(maxWidth: .infinity)
                Spacer()
            } else if let syncedHistory {
                HomeLoopHistoryStats(summary: syncedHistory.summary)

                HomeLoopWeekdayHeader()

                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 22) {
                        ForEach(
                            buildHomeLoopCalendarMonths(
                                history: syncedHistory,
                                todayDate: todayLoop?.date
                            ),
                            id: \.key
                        ) { month in
                            HomeLoopCalendarMonthView(month: month)
                        }
                    }
                    .padding(.bottom, 2)
                }
            } else {
                Spacer()
                VStack(spacing: 12) {
                    Image(systemName: "calendar.badge.exclamationmark")
                        .font(.largeTitle)
                        .foregroundStyle(OpenPhysicsTheme.accent)
                    Text("暂时无法获取历史记录")
                        .font(.headline)
                    if !errorMessage.isEmpty {
                        Text(errorMessage)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    Button("重新加载", action: onRetry)
                        .buttonStyle(.borderedProminent)
                        .buttonBorderShape(.capsule)
                        .tint(OpenPhysicsTheme.accent)
                }
                .frame(maxWidth: .infinity)
                Spacer()
            }
        }
        .padding(18)
        .background(Color(uiColor: .systemBackground))
        .accessibilityElement(children: .contain)
    }
}

private struct HomeLoopTodayHistoryRow: View {
    let presentation: HomeLearningLoopPresentation

    var body: some View {
        HStack(spacing: 12) {
            Text("今日数据")
                .font(.subheadline.weight(.heavy))

            Spacer()

            HomeLoopTodayValue(
                title: "做题",
                value: presentation.practice.countLabel,
                color: OpenPhysicsTheme.accent
            )
            HomeLoopTodayValue(
                title: "复盘",
                value: presentation.review.countLabel,
                color: Color(red: 0.34, green: 0.68, blue: 0.18)
            )
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

private struct HomeLoopTodayValue: View {
    let title: String
    let value: String
    let color: Color

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
            Text("\(title) \(value)")
                .font(.caption.weight(.bold))
                .monospacedDigit()
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct HomeLoopHistoryStats: View {
    let summary: DailyLearningLoopHistorySummary

    var body: some View {
        HStack(spacing: 8) {
            HomeLoopHistoryStat(
                title: "做题",
                value: summary.practiceTotal,
                color: OpenPhysicsTheme.accent
            )
            HomeLoopHistoryStat(
                title: "复盘",
                value: summary.reviewTotal,
                color: Color(red: 0.34, green: 0.68, blue: 0.18)
            )
            HomeLoopHistoryStat(
                title: "双环",
                value: summary.dualClosedDays,
                color: Color(red: 0.83, green: 0.42, blue: 0.03)
            )
        }
    }
}

private struct HomeLoopHistoryStat: View {
    let title: String
    let value: Int
    let color: Color

    var body: some View {
        VStack(spacing: 3) {
            Text("\(value)")
                .font(.title3.weight(.heavy))
                .foregroundStyle(color)
                .monospacedDigit()
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity)
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

private struct HomeLoopWeekdayHeader: View {
    private let labels = [
        "周一",
        "周二",
        "周三",
        "周四",
        "周五",
        "周六",
        "周日",
    ]

    var body: some View {
        HStack(spacing: 4) {
            ForEach(labels, id: \.self) { label in
                Text(label)
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("星期，周一至周日")
    }
}

private struct HomeLoopCalendarMonthView: View {
    let month: HomeLoopCalendarMonth

    private let columns = Array(
        repeating: GridItem(.flexible(), spacing: 4),
        count: 7
    )

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(month.label)
                .font(.subheadline.weight(.heavy))

            LazyVGrid(columns: columns, spacing: 6) {
                ForEach(
                    Array(month.cells.enumerated()),
                    id: \.offset
                ) { _, cell in
                    HomeLoopCalendarDayView(cell: cell)
                }
            }
        }
    }
}

private struct HomeLoopCalendarDayView: View {
    let cell: HomeLoopCalendarCell

    var body: some View {
        Group {
            if let dayNumber = cell.dayNumber {
                VStack(spacing: 3) {
                    Text("\(dayNumber)")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(
                            cell.isToday
                                ? Color.primary
                                : Color.secondary
                        )

                    HomeLoopMiniRings(day: cell.day)
                        .frame(width: 30, height: 30)
                }
                .frame(maxWidth: .infinity, minHeight: 50)
                .background(
                    cell.isToday
                        ? OpenPhysicsTheme.accentSoft
                        : Color.clear
                )
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                .overlay {
                    if cell.isToday {
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .stroke(
                                OpenPhysicsTheme.accent.opacity(0.32),
                                lineWidth: 1
                            )
                    }
                }
                .opacity(cell.isInHistoryRange ? 1 : 0.38)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(accessibilityLabel)
            } else {
                Color.clear
                    .frame(minHeight: 50)
                    .accessibilityHidden(true)
            }
        }
    }

    private var accessibilityLabel: String {
        guard let isoDate = cell.isoDate else { return "" }
        guard let day = cell.day else {
            return "\(isoDate)，暂无学习记录"
        }
        return "\(isoDate)，做题 \(day.rings.practice.actualCurrent)/\(day.rings.practice.target)，复盘 \(day.rings.review.actualCurrent)/\(day.rings.review.target)"
    }
}

private struct HomeLoopMiniRings: View {
    let day: DailyLearningLoopDay?

    private var practiceProgress: Double {
        guard day?.isEffectiveDay == true else { return 0 }
        return day?.rings.practice.progress ?? 0
    }

    private var reviewProgress: Double {
        guard day?.isEffectiveDay == true else { return 0 }
        return day?.rings.review.progress ?? 0
    }

    var body: some View {
        ZStack {
            miniRing(
                progress: practiceProgress,
                color: OpenPhysicsTheme.accent,
                lineWidth: 4
            )
            .padding(2)

            miniRing(
                progress: reviewProgress,
                color: Color(red: 0.34, green: 0.68, blue: 0.18),
                lineWidth: 3.5
            )
            .padding(5.75)

            Circle()
                .fill(Color(uiColor: .systemBackground))
                .padding(7.5)
        }
    }

    private func miniRing(
        progress: Double,
        color: Color,
        lineWidth: CGFloat
    ) -> some View {
        ZStack {
            Circle()
                .stroke(color.opacity(0.13), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: min(max(progress, 0), 1))
                .stroke(
                    color,
                    style: StrokeStyle(
                        lineWidth: lineWidth,
                        lineCap: progress > 0 ? .round : .butt
                    )
                )
                .rotationEffect(.degrees(-90))
        }
    }
}

private struct HomeOutcomeMetric: View {
    let title: String
    let value: String
    let color: Color

    var body: some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.title3.weight(.heavy))
                .foregroundStyle(color)
                .monospacedDigit()
            Text(title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
        }
        .frame(maxWidth: .infinity)
    }
}

private struct HomeLoopLegendRow: View {
    let ring: HomeLoopRingPresentation
    let color: Color

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: ring.completed ? "checkmark.circle.fill" : "circle.fill")
                .font(.caption)
                .foregroundStyle(ring.completed ? color : color.opacity(0.42))

            Text(ring.title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)

            Spacer(minLength: 4)

            Text(ring.countLabel)
                .font(.subheadline.weight(.heavy))
                .foregroundStyle(color)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.72)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct HomeEnergyRingsView: View {
    let presentation: HomeLearningLoopPresentation

    var body: some View {
        ZStack {
            HomeActivityRing(
                progress: presentation.practice.progress,
                overflowProgress: presentation.practice.overflowProgress,
                colors: [
                    Color(red: 0.03, green: 0.43, blue: 0.47),
                    Color(red: 0.10, green: 0.74, blue: 0.74),
                    Color(red: 0.03, green: 0.43, blue: 0.47),
                ],
                lineWidth: 17
            )
            .padding(4)

            HomeActivityRing(
                progress: presentation.review.progress,
                overflowProgress: presentation.review.overflowProgress,
                colors: [
                    Color(red: 0.24, green: 0.53, blue: 0.10),
                    Color(red: 0.55, green: 0.82, blue: 0.20),
                    Color(red: 0.24, green: 0.53, blue: 0.10),
                ],
                lineWidth: 13
            )
            .padding(19)

            Circle()
                .fill(Color(uiColor: .systemBackground))
                .padding(25.5)

            VStack(spacing: 1) {
                Text(presentation.centerValue)
                    .font(.headline.weight(.heavy))
                    .monospacedDigit()
                Text("项达标")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            "今日目标，已完成 \(presentation.closedCount) 项；做题 \(presentation.practice.countLabel)，复盘 \(presentation.review.countLabel)"
        )
    }
}

private struct HomeActivityRing: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let progress: Double
    let overflowProgress: Double
    let colors: [Color]
    let lineWidth: CGFloat

    private var normalizedProgress: Double {
        min(max(progress, 0), 1)
    }

    private var normalizedOverflow: Double {
        min(max(overflowProgress, 0), 1)
    }

    var body: some View {
        ZStack {
            Circle()
                .stroke(
                    colors[0].opacity(0.13),
                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                )

            Circle()
                .trim(from: 0, to: normalizedProgress)
                .stroke(
                    AngularGradient(
                        colors: colors,
                        center: .center,
                        startAngle: .degrees(-90),
                        endAngle: .degrees(270)
                    ),
                    style: StrokeStyle(
                        lineWidth: lineWidth,
                        lineCap: .round
                    )
                )
                .rotationEffect(.degrees(-90))
                .shadow(
                    color: colors[0].opacity(normalizedProgress > 0 ? 0.24 : 0),
                    radius: 4,
                    x: 0,
                    y: 2
                )

            if normalizedOverflow > 0 {
                Circle()
                    .trim(from: 0, to: normalizedOverflow)
                    .stroke(
                        colors[1].opacity(0.72),
                        style: StrokeStyle(
                            lineWidth: 3,
                            lineCap: .round,
                            dash: [2, 5]
                        )
                    )
                    .padding(-(lineWidth / 2 + 3))
                    .rotationEffect(.degrees(-90))
            }
        }
        .animation(
            reduceMotion ? nil : .spring(response: 0.72, dampingFraction: 0.82),
            value: normalizedProgress
        )
        .animation(
            reduceMotion ? nil : .easeOut(duration: 0.45).delay(0.12),
            value: normalizedOverflow
        )
    }
}

private struct HomePanelModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .clipShape(RoundedRectangle(cornerRadius: 20))
            .overlay {
                RoundedRectangle(cornerRadius: 20)
                    .stroke(
                        Color(uiColor: .separator).opacity(0.18),
                        lineWidth: 1
                    )
            }
            .shadow(
                color: Color.black.opacity(0.045),
                radius: 22,
                x: 0,
                y: 10
            )
    }
}

private extension View {
    func homePanel() -> some View {
        modifier(HomePanelModifier())
    }
}

private struct GrowthReviewSummaryView: View {
    let text: String
    @State private var fullHeight: CGFloat = 0
    @State private var compactHeight: CGFloat = 0
    @State private var showsFullReview = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(text).font(.subheadline).foregroundStyle(.secondary).lineSpacing(4)
                .lineLimit(3).fixedSize(horizontal: false, vertical: true)
                .background(GeometryReader { proxy in
                    Color.clear.preference(key: CompactReviewHeight.self, value: proxy.size.height)
                })
                .background(alignment: .topLeading) {
                    Text(text).font(.subheadline).lineSpacing(4)
                        .fixedSize(horizontal: false, vertical: true)
                        .background(GeometryReader { proxy in
                            Color.clear.preference(key: FullReviewHeight.self, value: proxy.size.height)
                        }).hidden().accessibilityHidden(true)
                }
            if fullHeight > compactHeight + 1 {
                Button("查看完整回顾") { showsFullReview = true }.font(.subheadline)
            }
        }
        .onPreferenceChange(FullReviewHeight.self) { fullHeight = $0 }
        .onPreferenceChange(CompactReviewHeight.self) { compactHeight = $0 }
        .sheet(isPresented: $showsFullReview) {
            NavigationStack {
                ScrollView {
                    Text(text).font(.body).lineSpacing(6)
                        .frame(maxWidth: 720, alignment: .leading).padding(24)
                        .frame(maxWidth: .infinity)
                }
                .navigationTitle("成长回顾").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) {
                    Button("关闭") { showsFullReview = false }
                } }
            }
        }
    }
}

private struct HomeMilestoneLearningView: View {
    @EnvironmentObject private var appSession: AppSession
    @StateObject private var store = SyncLearningStore()
    @State private var hasLoaded = false

    let milestone: String
    let preferredID: String?

    private var point: SyncKnowledgePoint? {
        homeMilestoneKnowledgePoint(
            milestone: milestone,
            points: store.directory?.kps ?? [],
            preferredID: preferredID
        )
    }

    var body: some View {
        Group {
            if let point {
                KnowledgeLearningView(point: point) {
                    Task { await appSession.refreshDashboard() }
                }
            } else if !hasLoaded || store.isLoading {
                ProgressView("正在打开学习内容…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                VStack(spacing: 16) {
                    Text(store.message.isEmpty ? "暂时无法打开这个学习目标，请重试或返回首页刷新。" : store.message)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    Button("重新加载") { Task { await load(force: true) } }
                        .buttonStyle(.borderedProminent)
                        .tint(OpenPhysicsTheme.accent)
                }
                .padding(24)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(OpenPhysicsTheme.pageBackground)
        .navigationTitle(point?.name ?? "知识学习")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .task(id: appSession.studentSession?.token) { await load() }
    }

    private func load(force: Bool = false) async {
        guard let student = appSession.studentSession else { return }
        await store.load(student: student, force: force)
        hasLoaded = true
    }
}

private struct FullReviewHeight: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}
private struct CompactReviewHeight: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}
