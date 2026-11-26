import SwiftUI
import WebKit

struct ReviewNotebookPaneView: View {
    @Environment(\.openPhysicsIsPhone) private var isPhone
    let data: ReviewData
    let selectedAnswerIds: Set<Int>
    let onToggleSelection: (Int) -> Void
    let onOpenMistake: (Int) -> Void
    let onError: (String) -> Void

    var body: some View {
        LearningReviewPane(
            payload: payload,
            onToggleSelection: onToggleSelection,
            onOpenMistake: onOpenMistake,
            onOpenReview: { _ in },
            onError: onError
        )
    }

    private var payload: String {
        let object: [String: Any] = [
            "mode": "review_notebook",
            "presentation": isPhone ? "phone" : "tablet",
            "maxMistakesPerGroup": 5,
            "reviewGroupBatchSize": 8,
            "selectedAnswerIds": selectedAnswerIds.sorted(),
            "groups": data.groups.map { group in
                [
                    "kp_id": group.kpId,
                    "kp_name": group.kpName,
                    "mistakes": group.mistakes.map(\.paneSummaryDictionary),
                ]
            },
        ]
        return reviewPayloadString(object)
    }
}

struct ReviewMistakeDetailPaneView: View {
    @Environment(\.openPhysicsIsPhone) private var isPhone
    let mistake: ReviewMistake
    let onError: (String) -> Void

    /// iPhone: the result-first page used after grading; iPad keeps the side-by-side detail.
    private var payload: [String: Any] {
        guard isPhone else {
            return ["mode": "review_mistake_detail", "presentation": "tablet", "mistake": mistake.paneDetailDictionary]
        }
        var object = mistake.panePracticeResultDictionary
        object["mode"] = "practice_result"
        object["presentation"] = "phone"
        return object
    }

    var body: some View {
        LearningReviewPane(
            payload: reviewPayloadString(payload),
            onToggleSelection: { _ in },
            onOpenMistake: { _ in },
            onOpenReview: { _ in },
            onError: onError
        )
    }
}

struct HistoryRecordsPaneView: View {
    @Environment(\.openPhysicsIsPhone) private var isPhone
    let records: [AnswerHistoryRecord]
    let onOpenReview: (Int) -> Void
    let onError: (String) -> Void

    var body: some View {
        LearningReviewPane(
            payload: reviewPayloadString(
                [
                    "mode": "history_records",
                    "presentation": isPhone ? "phone" : "tablet",
                    "records": records.map(\.paneDictionary),
                ]
            ),
            onToggleSelection: { _ in },
            onOpenMistake: { _ in },
            onOpenReview: onOpenReview,
            onError: onError
        )
    }
}

struct ReviewPaneWebView: UIViewRepresentable {
    let payload: String
    let onToggleSelection: (Int) -> Void
    let onOpenMistake: (Int) -> Void
    let onOpenReview: (Int) -> Void
    let onError: (String) -> Void
    var onAction: (String, [String: Any]) -> Void = { _, _ in }

    func makeCoordinator() -> Coordinator {
        Coordinator(
            onToggleSelection: onToggleSelection,
            onOpenMistake: onOpenMistake,
            onOpenReview: onOpenReview,
            onError: onError,
            onAction: onAction
        )
    }

    func makeUIView(context: Context) -> WKWebView {
        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: "openPhysicsPane")
        contentController.addUserScript(
            WKUserScript(
                source: Self.bridgeBootstrapScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )

        let configuration = WKWebViewConfiguration()
        contentController.addUserScript(WKUserScript(source: """
            const compactReviewStyle = document.createElement('style');
            compactReviewStyle.textContent = `
              .op-pane-review-notebook .op-pane-review-title { font-size: 0.86rem; font-weight: 400; }
              .op-pane-phone .op-pane-review-check { display: none; }
              .op-pane-phone .op-pane-review-row { grid-template-columns: minmax(0, 1fr); }
              .op-pane-phone .op-pane-review-time { grid-column: 1; }
              .op-pane-phone .op-pane-review-title { white-space: normal; }
              :root:has(.op-pane-review-notebook) { background: transparent; }
              .op-pane-phone .op-pane-review-detail { padding: 0 16px; }
              .op-pane-phone .op-pane-review-time { color: #7a8583; }
              .op-pane-phone .op-pane-review-caret {
                font-size: 0; flex: none; width: 8px; height: 8px; margin: 0 4px 0 2px;
                border-right: 2px solid #9aa6a4; border-bottom: 2px solid #9aa6a4;
                transform: rotate(-45deg); transition: transform .2s ease;
              }
              .op-pane-phone .op-pane-review-group-header[aria-expanded="true"] .op-pane-review-caret { transform: rotate(45deg); }
              /* The whole-paper review keeps its continuous scroll, but uses the same
                 question canvas as the phone practice screen. Tablet styles stay intact. */
              .op-pane-root.op-pane-phone:has(> .op-pane-paper-review) { padding: 0; }
              .op-pane-phone .op-pane-paper-review { gap: 24px; }
              .op-pane-phone .op-pane-paper-review > article > h2 {
                margin: 0 0 10px; color: #667579; font-size: .82em; font-weight: 600;
              }
              .op-pane-phone .op-pane-paper-review .op-pane-question-header { display: none; }
              .op-pane-phone .op-pane-paper-review .op-pane-stem > .op-pane-rich > :first-child { margin-top: 0; }
              .op-pane-phone .op-pane-paper-review .op-pane-stem > .op-pane-rich > :last-child { margin-bottom: 0; }
            `;
            document.head.appendChild(compactReviewStyle);
            """, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        contentController.addUserScript(WKUserScript(source: Self.mistakeChoiceResultScript,
            injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        PaneWebViewChrome.install(on: contentController)
        configuration.userContentController = contentController
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        PaneWebViewChrome.prepare(webView)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        context.coordinator.webView = webView
        context.coordinator.payload = payload
        webView.load(URLRequest(url: AppConfig.learningContentPaneURL))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.onToggleSelection = onToggleSelection
        context.coordinator.onOpenMistake = onOpenMistake
        context.coordinator.onOpenReview = onOpenReview
        context.coordinator.onError = onError
        context.coordinator.payload = payload
        context.coordinator.onAction = onAction
        context.coordinator.injectPayloadIfReady()
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(
            forName: "openPhysicsPane"
        )
        webView.navigationDelegate = nil
    }

    /// Marks right/wrong on a reviewed choice question (iOS only). Reuses the Pane's own
    /// result classes and badges; idempotent, so re-renders simply re-apply it.
    private static let mistakeChoiceResultScript = """
        (function() {
          function letters(value) { return String(value || '').toUpperCase().match(/[A-Z]/g) || []; }
          function mark() {
            var payload = window.__openPhysicsPayload;
            if (!payload || payload.mode !== 'review_mistake_detail' || !payload.mistake) return;
            var correct = letters(payload.mistake.correct_answer);
            if (!correct.length) return;
            var given = letters(payload.mistake.given_answer);
            document.querySelectorAll('.op-pane-review-detail .op-pane-option').forEach(function(option) {
              var labelElement = option.querySelector('.op-pane-option-label');
              if (!labelElement) return;
              var label = labelElement.textContent.trim().toUpperCase();
              var isCorrect = correct.indexOf(label) >= 0;
              var isGiven = given.indexOf(label) >= 0;
              option.classList.remove('selected');
              option.classList.toggle('is-correct', isCorrect);
              option.classList.toggle('is-given-correct', isGiven && isCorrect);
              option.classList.toggle('is-wrong', isGiven && !isCorrect);
              option.classList.toggle('is-dimmed', !isGiven && !isCorrect);
              if (option.querySelector('.op-pane-option-result-badges')) return;
              var badges = [];
              if (isGiven) badges.push(['我的选择', isCorrect ? 'is-yours-correct' : 'is-yours-wrong']);
              if (isCorrect) badges.push(['正确答案', 'is-correct-answer']);
              if (!badges.length) return;
              var wrap = document.createElement('span');
              wrap.className = 'op-pane-option-result-badges';
              badges.forEach(function(badge) {
                var item = document.createElement('span');
                item.className = 'op-pane-option-result-badge ' + badge[1];
                item.textContent = badge[0];
                wrap.appendChild(item);
              });
              option.appendChild(wrap);
            });
          }
          new MutationObserver(mark).observe(document.documentElement, { childList: true, subtree: true });
        })();
        """

    private static let bridgeBootstrapScript = """
        (function() {
          function forward(method, payload) {
            try {
              window.webkit.messageHandlers.openPhysicsPane.postMessage({
                method: method,
                payload: payload || ""
              });
            } catch (_) {}
          }
          window.OpenPhysicsBridge = {
            onPaneReady: function(payload) { forward("onPaneReady", payload); },
            onPayloadRendered: function(payload) { forward("onPayloadRendered", payload); },
            onOpenImage: function(payload) { forward("onOpenImage", payload); },
            onOpenLessonVideo: function(payload) { forward("onOpenLessonVideo", payload); },
            onOpenTutor: function(payload) { forward("onOpenTutor", payload); },
            onCorrectGrading: function(payload) { forward("onCorrectGrading", payload); },
            onOpenReview: function(payload) { forward("onOpenReview", payload); },
            onOpenMistake: function(payload) { forward("onOpenMistake", payload); },
            onToggleMistakeSelection: function(payload) {
              forward("onToggleMistakeSelection", payload);
            },
            onPaneError: function(payload) { forward("onPaneError", payload); },
            onHeightChanged: function(payload) { forward("onHeightChanged", payload); }
          };
        })();
        """

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        weak var webView: WKWebView?
        var payload = ""
        var onToggleSelection: (Int) -> Void
        var onOpenMistake: (Int) -> Void
        var onOpenReview: (Int) -> Void
        var onError: (String) -> Void
        var onAction: (String, [String: Any]) -> Void

        private var isReady = false
        private var lastInjectedPayload = ""

        init(
            onToggleSelection: @escaping (Int) -> Void,
            onOpenMistake: @escaping (Int) -> Void,
            onOpenReview: @escaping (Int) -> Void,
            onError: @escaping (String) -> Void,
            onAction: @escaping (String, [String: Any]) -> Void
        ) {
            self.onToggleSelection = onToggleSelection
            self.onOpenMistake = onOpenMistake
            self.onOpenReview = onOpenReview
            self.onError = onError
            self.onAction = onAction
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
            onError("错题内容加载失败，请检查本地服务。")
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            onError("错题内容加载失败，请检查本地服务。")
        }

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard
                message.frameInfo.isMainFrame,
                message.frameInfo.request.url?.host == AppConfig.learningContentPaneURL.host,
                let event = message.body as? [String: Any],
                let method = event["method"] as? String
            else { return }
            let body = event["payload"] as? String ?? ""

            switch method {
            case "onPaneReady", "onPayloadRendered":
                isReady = true
                if method == "onPayloadRendered" { PaneWebViewChrome.reveal(webView) }
                injectPayloadIfReady()
            case "onToggleMistakeSelection":
                if let answerId = Self.answerId(from: body) {
                    onToggleSelection(answerId)
                }
            case "onOpenMistake":
                if let answerId = Self.answerId(from: body) {
                    onOpenMistake(answerId)
                }
            case "onOpenReview":
                if let answerId = Self.answerId(from: body) {
                    onOpenReview(answerId)
                }
            case "onOpenLessonVideo", "onOpenTutor", "onCorrectGrading", "onOpenImage":
                if let data = body.data(using: .utf8),
                   let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    onAction(method, object)
                }
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
                    try { window.__openPhysicsPayload = JSON.parse(\(payloadLiteral)); } catch (_) {}
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
                if error != nil {
                    self?.lastInjectedPayload = ""
                }
            }
        }

        private static func answerId(from payload: String) -> Int? {
            guard
                let data = payload.data(using: .utf8),
                let object = try? JSONSerialization.jsonObject(with: data)
                    as? [String: Any]
            else { return nil }
            return object["answerId"] as? Int
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
                let object = try? JSONSerialization.jsonObject(with: data)
                    as? [String: Any],
                let message = object["message"] as? String,
                !message.isEmpty
            else { return "错题内容加载失败，请重新进入。" }
            return message
        }
    }
}

private func reviewPayloadString(_ object: [String: Any]) -> String {
    guard
        JSONSerialization.isValidJSONObject(object),
        let data = try? JSONSerialization.data(withJSONObject: object),
        let value = String(data: data, encoding: .utf8)
    else { return "{}" }
    return value
}
