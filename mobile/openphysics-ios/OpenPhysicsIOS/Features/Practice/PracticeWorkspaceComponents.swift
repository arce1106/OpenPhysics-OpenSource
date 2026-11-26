import SwiftUI

enum PracticeQuestionNavigationState: Equatable {
    case pending
    case answered
    case correct
    case wrong

    var label: String {
        switch self {
        case .pending: return "未作答"
        case .answered: return "已作答"
        case .correct: return "回答正确"
        case .wrong: return "需要订正"
        }
    }

    var symbol: String {
        switch self {
        case .pending: return "circle"
        case .answered: return "checkmark.circle"
        case .correct: return "checkmark.circle.fill"
        case .wrong: return "exclamationmark.circle.fill"
        }
    }

    var tint: Color {
        switch self {
        case .pending: return .secondary
        case .answered: return OpenPhysicsTheme.accent
        case .correct: return .green
        case .wrong: return .orange
        }
    }
}

struct PracticeQuestionNavigationItem: Identifiable, Equatable {
    let id: String
    let index: Int
    let state: PracticeQuestionNavigationState
}

struct PracticeWorkspaceHeader: View {
    @Environment(\.openPhysicsIsPhone) private var isPhone
    @State private var showsQuestionCard = false
    let title: String
    let currentIndex: Int
    let answeredCount: Int
    let total: Int
    let items: [PracticeQuestionNavigationItem]
    let navigationEnabled: Bool
    let onBack: () -> Void
    let onSelectQuestion: (Int) -> Void
    var onSubmit: (() -> Void)? = nil
    var canSubmit = false
    var submitTitle = "提交批改"
    var onToggleTools: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: 0) {
            if isPhone {
                phoneBar
            } else {
            HStack(spacing: 12) {
                if isPhone {
                    Button(action: onBack) {
                        Image(systemName: "chevron.left").font(.body.weight(.semibold))
                            .frame(width: 44, height: 44)
                    }.buttonStyle(.plain).tint(OpenPhysicsTheme.accent)
                        .accessibilityLabel("返回").accessibilityHint("退出当前做题页面")
                } else {
                    OpenPhysicsBackButton(action: onBack)
                        .accessibilityHint("退出当前做题页面")
                }

                Text(title)
                    .font(isPhone ? .callout.weight(.semibold) : .title3.bold())
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                Spacer()

                Text("\(isPhone ? currentIndex + 1 : answeredCount) / \(total)")
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 13)
                    .frame(height: 32)
                    .background(Color(uiColor: .tertiarySystemFill))
                    .clipShape(Capsule())
                    .accessibilityLabel(isPhone ? "第 \(currentIndex + 1) 题，共 \(total) 题，已完成 \(answeredCount) 题" : "已完成 \(answeredCount) 题，共 \(total) 题")
                if let onToggleTools {
                    // Same capsule as the 0 / 3 count beside it; the accent text marks it as tappable.
                    Button(action: onToggleTools) {
                        Text("工具")
                            .font(.callout.weight(.semibold))
                            .foregroundStyle(OpenPhysicsTheme.accent)
                            .padding(.horizontal, 13)
                            .frame(height: 32)
                            .background(Color(uiColor: .tertiarySystemFill))
                            .clipShape(Capsule())
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("显示或隐藏书写工具")
                }
                if isPhone {
                    Button { showsQuestionCard = true } label: {
                        Image(systemName: "square.grid.2x2").frame(width: 44, height: 44)
                    }.buttonStyle(.plain).tint(OpenPhysicsTheme.accent).accessibilityLabel("答题卡")
                }
                if let onSubmit, !isPhone {
                    Button(submitTitle, action: onSubmit)
                        .buttonStyle(.borderedProminent).tint(OpenPhysicsTheme.accent)
                        .controlSize(.regular).disabled(!canSubmit)
                }
            }
            }

            if items.count > 1, !isPhone {
                PracticeQuestionProgressStrip(
                    items: items,
                    currentIndex: currentIndex,
                    enabled: navigationEnabled,
                    onSelect: onSelectQuestion
                )
            }
        }
        .padding(.horizontal, isPhone ? 4 : 16)
        .padding(.vertical, 2)
        .background(.bar)
        .sheet(isPresented: $showsQuestionCard) {
            PracticeAnswerCard(items: items, currentIndex: currentIndex, navigationEnabled: navigationEnabled,
                               onSelectQuestion: onSelectQuestion, onClose: { showsQuestionCard = false })
            .presentationDetents([.medium, .large])
        }
    }

    /// Phone: the same layout as native pages — round back button, centred title.
    private var phoneBar: some View {
        ZStack {
            Text(title)
                .font(.headline)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .padding(.horizontal, 108)
                .accessibilityAddTraits(.isHeader)
            HStack(spacing: 8) {
                Button(action: onBack) {
                    Image(systemName: "chevron.left").font(.body.weight(.semibold))
                        .foregroundStyle(.primary)
                        .frame(width: 44, height: 44)
                        .modifier(PracticeHeaderCircle())
                }.buttonStyle(.plain)
                    .accessibilityLabel("返回").accessibilityHint("退出当前做题页面")
                Spacer()
                Text("\(currentIndex + 1) / \(total)")
                    .font(.footnote.weight(.semibold).monospacedDigit())
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 10)
                    .frame(height: 28)
                    .background(Color(uiColor: .tertiarySystemFill), in: Capsule())
                    .accessibilityLabel("第 \(currentIndex + 1) 题，共 \(total) 题，已完成 \(answeredCount) 题")
                Button { showsQuestionCard = true } label: {
                    Image(systemName: "square.grid.2x2")
                        .foregroundStyle(.primary)
                        .frame(width: 44, height: 44)
                        .modifier(PracticeHeaderCircle())
                }.buttonStyle(.plain).accessibilityLabel("答题卡")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
    }
}

struct PracticeAnswerCard: View {
    let items: [PracticeQuestionNavigationItem]
    let currentIndex: Int
    let navigationEnabled: Bool
    let onSelectQuestion: (Int) -> Void
    let onClose: () -> Void

    var body: some View {
            NavigationStack {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 88))], spacing: 12) {
                        ForEach(items) { item in
                            Button {
                                onSelectQuestion(item.index)
                                onClose()
                            } label: {
                                VStack(spacing: 4) {
                                    Text("\(item.index + 1)").font(.headline)
                                    Image(systemName: item.state.symbol)
                                    Text(item.state.label).font(.caption).fixedSize(horizontal: false, vertical: true)
                                }.frame(maxWidth: .infinity, minHeight: 76)
                                    .padding(8)
                                    .foregroundStyle(item.state.tint)
                                    .background(item.state.tint.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                                    .overlay { RoundedRectangle(cornerRadius: 12).stroke(item.index == currentIndex ? OpenPhysicsTheme.accent : .clear, lineWidth: 2) }
                            }.buttonStyle(.plain)
                                .disabled(!navigationEnabled)
                                .accessibilityLabel("第 \(item.index + 1) 题，\(item.state.label)\(item.index == currentIndex ? "，当前题目" : "")")
                        }
                    }.padding(20)
                }
                .navigationTitle("答题卡").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成", action: onClose) } }
            }
    }
}

struct PracticeQuestionProgressStrip: View {
    let items: [PracticeQuestionNavigationItem]
    let currentIndex: Int
    let enabled: Bool
    let onSelect: (Int) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 4) {
            ForEach(items) { item in
                Button {
                    onSelect(item.index)
                } label: {
                    Text("\(item.index + 1)")
                        .font(.caption.weight(.bold))
                        .frame(width: 40, height: 28)
                        .foregroundStyle(foreground(for: item))
                        .background(background(for: item))
                        .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 7, style: .continuous)
                                .stroke(
                                    item.index == currentIndex
                                        ? OpenPhysicsTheme.accent
                                        : Color.clear,
                                    lineWidth: 2
                                )
                        }
                }
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
                .buttonStyle(.plain)
                .disabled(!enabled)
                .accessibilityLabel(accessibilityLabel(for: item))
            }
        }
    }

    }

    private func background(for item: PracticeQuestionNavigationItem) -> Color {
        if item.index == currentIndex {
            return OpenPhysicsTheme.accent
        }
        switch item.state {
        case .pending:
            return Color(uiColor: .tertiarySystemFill)
        case .answered:
            return OpenPhysicsTheme.accentSoft
        case .correct:
            return Color.green.opacity(0.18)
        case .wrong:
            return Color.orange.opacity(0.20)
        }
    }

    private func foreground(for item: PracticeQuestionNavigationItem) -> Color {
        if item.index == currentIndex {
            return .white
        }
        switch item.state {
        case .pending:
            return .secondary
        case .answered:
            return OpenPhysicsTheme.accent
        case .correct:
            return .green
        case .wrong:
            return .orange
        }
    }

    private func accessibilityLabel(for item: PracticeQuestionNavigationItem) -> String {
        let state: String
        switch item.state {
        case .pending: state = "未作答"
        case .answered: state = "已作答"
        case .correct: state = "回答正确"
        case .wrong: state = "需要订正"
        }
        return "第 \(item.index + 1) 题，\(state)"
    }
}

struct PracticeWorkspaceActionBar<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(.horizontal, 20)
            .padding(.vertical, 5)
            .background(.bar)
    }
}

/// Shared by the practice and paper-review headers.
struct PracticeHeaderCircle: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            // Not `.interactive()`: its press-and-drag recognizer sits over the button and, with a
            // real finger's slight movement, took the touch, so 返回 needed two or three taps.
            content.glassEffect(.regular, in: Circle())
        } else {
            content.background(.regularMaterial, in: Circle())
        }
    }
}

/// Blocking progress while AI grades one answer or a whole set, with the time waited so far.
struct AIGradingProgressOverlay: View {
    let startedAt: Date
    let completed: Int
    let total: Int

    var body: some View {
        ZStack {
            Color.black.opacity(0.28).ignoresSafeArea()
            TimelineView(.periodic(from: startedAt, by: 1)) { context in
                let waited = max(0, Int(context.date.timeIntervalSince(startedAt)))
                VStack(spacing: 14) {
                    ProgressView().controlSize(.large)
                    Text(title).font(.headline)
                    if total > 0 {
                        ProgressView(value: Double(min(completed, total)), total: Double(total))
                            .tint(OpenPhysicsTheme.accent)
                    }
                    Text("已等待 \(waited) 秒").font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
                    Text(waited < 60
                         ? "照片和手写批改通常需要 30–60 秒，请保持本页打开。"
                         : "解答较长或网络较慢时会多等一会儿，最长约 2 分钟。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(24)
                .frame(maxWidth: 320)
                .background(Color(uiColor: .systemBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .shadow(color: .black.opacity(0.12), radius: 18, y: 6)
                .padding(24)
                .accessibilityElement(children: .combine)
            }
        }
    }

    private var title: String {
        guard total > 0 else { return "AI 正在批改本题" }
        return completed < total ? "AI 正在批改 \(completed)/\(total) 题" : "正在生成本组结果"
    }
}
