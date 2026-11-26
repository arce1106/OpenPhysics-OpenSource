import SwiftUI
import WebKit

// Device identity is intentional: an iPad in a narrow window keeps its iPad UI.
private struct OpenPhysicsPhoneKey: EnvironmentKey {
    static let defaultValue = UIDevice.current.userInterfaceIdiom == .phone
}

extension EnvironmentValues {
    var openPhysicsIsPhone: Bool {
        get { self[OpenPhysicsPhoneKey.self] }
        set { self[OpenPhysicsPhoneKey.self] = newValue }
    }
}

/// iPad only: lets any screen see whether the sidebar is collapsed and change it.
struct OpenPhysicsTabletSidebar {
    var isHidden: Bool
    var setHidden: (Bool) -> Void
    /// Portrait: the shell keeps the sidebar collapsed, so pages that hid it temporarily
    /// must not reopen it when they close.
    var prefersCollapsed = false
}

private struct OpenPhysicsTabletSidebarKey: EnvironmentKey {
    static let defaultValue: OpenPhysicsTabletSidebar? = nil
}

extension EnvironmentValues {
    var openPhysicsTabletSidebar: OpenPhysicsTabletSidebar? {
        get { self[OpenPhysicsTabletSidebarKey.self] }
        set { self[OpenPhysicsTabletSidebarKey.self] = newValue }
    }
}

/// Shown only while the iPad sidebar is collapsed, so navigation is never hidden behind a gesture.
struct OpenPhysicsSidebarRevealButton: View {
    @Environment(\.openPhysicsTabletSidebar) private var sidebar

    var body: some View {
        if let sidebar, sidebar.isHidden {
            Button { sidebar.setHidden(false) } label: {
                Image(systemName: "sidebar.left")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(OpenPhysicsTheme.accent)
                    .frame(width: 32, height: 32)
                    .background(Color(uiColor: .systemBackground), in: Circle())
                    .overlay(Circle().stroke(OpenPhysicsTheme.accent.opacity(0.18), lineWidth: 1))
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("显示侧栏")
        }
    }
}

struct OpenPhysicsAdaptiveStack<Content: View>: View {
    @Environment(\.openPhysicsIsPhone) private var isPhone
    var spacing: CGFloat = 12
    var alignment: VerticalAlignment = .center
    @ViewBuilder let content: Content

    var body: some View {
        if isPhone {
            VStack(alignment: .leading, spacing: spacing) { content }
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            HStack(alignment: alignment, spacing: spacing) { content }
        }
    }
}

enum OpenPhysicsTheme {
    static let accent = Color(red: 0.08, green: 0.48, blue: 0.51)
    static let accentSoft = Color(red: 0.91, green: 0.97, blue: 0.97)
    static let pageBackground = Color(uiColor: .systemGroupedBackground)
    static let cardBackground = Color(uiColor: .secondarySystemGroupedBackground)
}

enum OpenPhysicsWorkspaceMetrics {
    static let pagePadding: CGFloat = 16
    static let panelSpacing: CGFloat = 14

    static func controlPanelWidth(for availableWidth: CGFloat) -> CGFloat {
        min(280, max(220, availableWidth * 0.24))
    }
}

extension View {
    func openPhysicsPrimaryNavigationChrome(_ phoneTitle: String = "") -> some View {
        modifier(OpenPhysicsPrimaryNavigationChrome(phoneTitle: phoneTitle))
    }

    func openPhysicsPhoneRefresh(
        _ title: String,
        isRefreshing: Bool,
        action: @escaping () async -> Void
    ) -> some View {
        modifier(OpenPhysicsPhoneRefresh(title: title, isRefreshing: isRefreshing, action: action))
    }

    func openPhysicsPhonePullToRefresh(action: @escaping () async -> Void) -> some View {
        modifier(OpenPhysicsPhonePullToRefresh(action: action))
    }
}

private struct OpenPhysicsPhonePullToRefresh: ViewModifier {
    @Environment(\.openPhysicsIsPhone) private var isPhone
    let action: () async -> Void

    @ViewBuilder func body(content: Content) -> some View {
        if isPhone { content.refreshable { await action() } }
        else { content }
    }
}

private struct OpenPhysicsPrimaryNavigationChrome: ViewModifier {
    @Environment(\.openPhysicsIsPhone) private var isPhone
    let phoneTitle: String

    @ViewBuilder func body(content: Content) -> some View {
        if isPhone, !phoneTitle.isEmpty {
            content.navigationTitle(phoneTitle)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar(.visible, for: .navigationBar)
        } else {
            content.navigationTitle("").toolbar(.hidden, for: .navigationBar)
        }
    }
}

private struct OpenPhysicsPhoneRefresh: ViewModifier {
    @Environment(\.openPhysicsIsPhone) private var isPhone
    let title: String
    let isRefreshing: Bool
    let action: () async -> Void

    func body(content: Content) -> some View {
        content.toolbar {
            if isPhone {
                ToolbarItem(placement: .navigationBarTrailing) {
                    if isRefreshing {
                        ProgressView().accessibilityLabel(title)
                    } else {
                        // A one-item "…" menu hid the only action; show refresh directly.
                        Button { Task { await action() } } label: {
                            Image(systemName: "arrow.clockwise").frame(minWidth: 44, minHeight: 44)
                        }
                        .tint(OpenPhysicsTheme.accent)
                        .accessibilityLabel(title)
                    }
                }
            }
        }
    }
}

/// Compact rows used only by the phone's learning entry screens.
struct OpenPhysicsPhoneActionRow: View {
    let title: String
    let detail: String
    var number: String? = nil
    var value: String? = nil
    var emphasized = false

    var body: some View {
        HStack(spacing: 12) {
            if let number {
                Text(number).font(.caption.weight(.semibold))
                    .foregroundStyle(OpenPhysicsTheme.accent)
                    .frame(width: 32, height: 32)
                    .background(OpenPhysicsTheme.accent.opacity(0.10), in: RoundedRectangle(cornerRadius: 10))
            }
            VStack(alignment: .leading, spacing: 5) {
                Text(title).font(.callout.weight(.semibold)).foregroundStyle(.primary)
                if !detail.isEmpty {
                    Text(detail).font(.footnote).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let value {
                Text(value).font(.footnote).foregroundStyle(emphasized ? OpenPhysicsTheme.accent : .secondary)
                    .fixedSize(horizontal: true, vertical: false)
            }
            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
        .contentShape(Rectangle())
        .multilineTextAlignment(.leading)
    }
}

struct OpenPhysicsPhoneGroup<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 0) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(OpenPhysicsTheme.cardBackground, in: RoundedRectangle(cornerRadius: 16))
    }
}

struct OpenPhysicsRefreshButton: View {
    let title: String
    let isRefreshing: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Group {
                if isRefreshing {
                    ProgressView()
                } else {
                    Image(systemName: "arrow.clockwise")
                }
            }
            .frame(width: 22, height: 22)
        }
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .tint(OpenPhysicsTheme.accent)
        .disabled(isRefreshing)
        .accessibilityLabel(title)
    }
}

struct OpenPhysicsPageHeader: View {
    @EnvironmentObject private var appSession: AppSession
    @Environment(\.openPhysicsIsPhone) private var isPhone
    @Environment(\.dismiss) private var dismiss
    let title: String
    let subtitle: String
    let refreshTitle: String
    let isRefreshing: Bool
    let onRefresh: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            if isPhone {
                OpenPhysicsBackButton { dismiss() }
            } else {
                // iPad root pages are reached from the sidebar; a back button had no clear target.
                OpenPhysicsSidebarRevealButton()
            }
            VStack(alignment: .leading, spacing: 5) {
                Text(title)
                    .font(.title3.weight(.semibold))
            }

            Spacer(minLength: 12)

            OpenPhysicsRefreshButton(
                title: refreshTitle,
                isRefreshing: isRefreshing,
                action: onRefresh
            )
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
}

struct OpenPhysicsBackButton: View {
    let action: () -> Void
    var body: some View {
        HStack(spacing: 4) {
            OpenPhysicsSidebarRevealButton()
            backButton
        }
    }

    private var backButton: some View {
        Button(action: action) {
            Image(systemName: "chevron.left")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(OpenPhysicsTheme.accent)
                .frame(width: 32, height: 32)
                .background(Color(uiColor: .systemBackground), in: Circle())
                .overlay(Circle().stroke(OpenPhysicsTheme.accent.opacity(0.18), lineWidth: 1))
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityLabel("返回")
    }
}

struct OpenPhysicsCard<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        content
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(OpenPhysicsTheme.cardBackground)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}


struct OpenPhysicsImageSelection: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

struct OpenPhysicsImagePreview: View {
    @Environment(\.dismiss) private var dismiss
    let url: URL
    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        NavigationStack {
            Group {
                if let image { AnswerPhotoPreview(image: image) }
                else if failed { Text("图片暂时无法加载，请返回后重试。").foregroundStyle(.secondary).padding() }
                else { ProgressView("正在加载图片…") }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .navigationTitle("查看图片").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
            .task(id: url) {
                do {
                    let data: Data
                    if url.isFileURL { data = try Data(contentsOf: url) }
                    else { data = try await URLSession.shared.data(from: url).0 }
                    try Task.checkCancellation()
                    image = UIImage(data: data)
                    failed = image == nil
                } catch { if !Task.isCancelled { failed = true } }
            }
        }
    }
}


/// iOS-only chrome for the shared learning-content Pane. Keeps the shared Pane
/// (also used by Android and Web) unchanged; only the native WKWebView host feels native.
@MainActor
enum PaneWebViewChrome {
    private static let nativeFeelSource = """
        (function() {
          var viewport = document.querySelector('meta[name="viewport"]');
          if (viewport) {
            viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
          }
          var style = document.createElement('style');
          style.textContent = `
            html { -webkit-text-size-adjust: 100%; }
            * { -webkit-tap-highlight-color: transparent; -webkit-touch-callout: none; scrollbar-width: none; }
            *::-webkit-scrollbar { display: none; width: 0; height: 0; }
            body { -webkit-user-select: none; user-select: none; }
            input, textarea, [contenteditable="true"] { -webkit-user-select: text; user-select: text; }
            .op-pane-rich .katex { font-size: 1em; }
            /* Inline fractions set their digits at script size (~70%). Scale the whole fraction,
               not just the digits, so the bar and baseline stay aligned. Display math is unchanged. */
            .op-pane-rich .katex:not(.katex-display .katex) .mfrac:has(.mtight) { font-size: 1.25em; }
            .op-pane-rich .katex .mfrac .mfrac { font-size: 1em; }
            .op-pane-root.op-pane-phone :is(.op-pane-phone-explanation, .op-pane-phone-original) > summary {
              list-style: none; display: flex; align-items: center; justify-content: space-between;
              min-height: 44px; line-height: 1.4; color: #182c30;
            }
            .op-pane-root.op-pane-phone :is(.op-pane-phone-explanation, .op-pane-phone-original) > summary::-webkit-details-marker { display: none; }
            .op-pane-root.op-pane-phone :is(.op-pane-phone-explanation, .op-pane-phone-original) > summary::after {
              content: ""; flex: none; width: 8px; height: 8px; margin: 0 6px 0 12px;
              border-right: 2px solid #9aa6a4; border-bottom: 2px solid #9aa6a4;
              transform: rotate(-45deg); transition: transform .2s ease;
            }
            .op-pane-root.op-pane-phone :is(.op-pane-phone-explanation, .op-pane-phone-original)[open] > summary::after { transform: rotate(45deg); }
            .openphysics-table-wrap { -webkit-overflow-scrolling: touch; }
            .openphysics-table-wrap[data-op-more] {
              -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 32px), transparent);
              mask-image: linear-gradient(to right, #000 calc(100% - 32px), transparent);
            }
          `;
          (document.head || document.documentElement).appendChild(style);
          // A table wider than the screen fades at its right edge until scrolled to the end.
          function updateTable(el) {
            if (el.scrollWidth - el.clientWidth - el.scrollLeft > 2) el.setAttribute('data-op-more', '');
            else el.removeAttribute('data-op-more');
          }
          function updateTables() { document.querySelectorAll('.openphysics-table-wrap').forEach(updateTable); }
          document.addEventListener('scroll', function(event) {
            var target = event.target;
            if (target && target.classList && target.classList.contains('openphysics-table-wrap')) updateTable(target);
          }, true);
          window.addEventListener('resize', updateTables);
          new MutationObserver(updateTables).observe(document.documentElement, { childList: true, subtree: true });
        })();
        """

    static func install(on controller: WKUserContentController) {
        controller.addUserScript(
            WKUserScript(source: nativeFeelSource, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
        )
    }

    /// Hides the web view until the Pane reports its first render, so the
    /// unstyled page never flashes. A timed fallback guarantees content is shown.
    private static let loadingIndicatorTag = 0x4F50_4C44

    static func prepare(_ webView: WKWebView) {
        webView.allowsLinkPreview = false
        webView.scrollView.showsVerticalScrollIndicator = false
        webView.scrollView.showsHorizontalScrollIndicator = false
        // Hide only the content: a spinner stays visible until the pane has rendered.
        webView.scrollView.alpha = 0
        if webView.viewWithTag(loadingIndicatorTag) == nil {
            let indicator = UIActivityIndicatorView(style: .medium)
            indicator.tag = loadingIndicatorTag
            indicator.color = UIColor(OpenPhysicsTheme.accent)
            indicator.translatesAutoresizingMaskIntoConstraints = false
            indicator.startAnimating()
            webView.addSubview(indicator)
            NSLayoutConstraint.activate([
                indicator.centerXAnchor.constraint(equalTo: webView.centerXAnchor),
                indicator.topAnchor.constraint(equalTo: webView.topAnchor, constant: 48),
            ])
        }
        Task { @MainActor [weak webView] in
            try? await Task.sleep(nanoseconds: 8_000_000_000)
            reveal(webView)
        }
    }

    static func reveal(_ webView: WKWebView?) {
        guard let webView, webView.scrollView.alpha < 1 else { return }
        webView.viewWithTag(loadingIndicatorTag)?.removeFromSuperview()
        UIView.animate(withDuration: 0.18) { webView.scrollView.alpha = 1 }
    }
}
