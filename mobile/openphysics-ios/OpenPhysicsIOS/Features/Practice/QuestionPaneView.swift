import SwiftUI
import WebKit

struct QuestionPaneView: UIViewRepresentable {
    @Environment(\.openPhysicsIsPhone) private var isPhone
    @ScaledMetric(relativeTo: .body) private var textScale: CGFloat = 1
    let question: PracticeQuestion
    let index: Int
    let total: Int
    let answer: String
    let result: SubmitAnswerResult?
    let interactive: Bool
    let onAnswerChange: (String) -> Void
    let onError: (String) -> Void
    var onOpenImage: (URL) -> Void = { _ in }

    func makeCoordinator() -> Coordinator {
        let coordinator = Coordinator(onAnswerChange: onAnswerChange, onError: onError)
        coordinator.onOpenImage = onOpenImage
        return coordinator
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
        context.coordinator.onOpenImage = onOpenImage
        context.coordinator.onAnswerChange = onAnswerChange
        context.coordinator.onError = onError
        context.coordinator.payload = payload
        context.coordinator.injectPayloadIfReady()
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(
            forName: "openPhysicsPane"
        )
        webView.navigationDelegate = nil
    }

    private var payload: String {
        var object: [String: Any] = [
            "presentation": isPhone ? "phone" : "tablet",
            "textScale": textScale,
            "mode": isPhone && result != nil ? "practice_result" : (interactive ? "question_interactive" : "question_readonly"),
            "question": question.paneDictionary(),
            "index": index,
            "total": total,
            "givenAnswer": answer,
            "selectedOptions": answerLabels,
            "showAnswerSummary": result != nil,
            "answerState": result.map { $0.paneAnswerState as Any } ?? NSNull(),
        ]
        if let result {
            var questionObject = question.paneDictionary()
            questionObject["correct_answer"] = result.correctAnswer
            questionObject["correct_answer_rendered"] =
                result.correctAnswerRendered.map { $0.jsonObject as Any } ?? NSNull()
            questionObject["explanation"] = result.explanation ?? ""
            questionObject["explanation_rendered"] =
                result.explanationRendered.map { $0.jsonObject as Any } ?? NSNull()
            object["question"] = questionObject
        }
        let data = try? JSONSerialization.data(withJSONObject: object)
        return data.flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }

    private var answerLabels: [String] {
        answer
            .replacingOccurrences(of: "，", with: ",")
            .replacingOccurrences(of: "、", with: ",")
            .split { $0 == "," || $0.isWhitespace }
            .flatMap { token in
                token.map(String.init)
            }
            .filter { !$0.isEmpty }
            .reduce(into: [String]()) { labels, label in
                if !labels.contains(label) { labels.append(label) }
            }
            .sorted()
    }

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
            onQuestionPaneReady: function(payload) { forward("onPaneReady", payload); },
            onPayloadRendered: function(payload) { forward("onPayloadRendered", payload); },
            onOpenImage: function(payload) { forward("onOpenImage", payload); },
            onOptionSelected: function(payload) { forward("onOptionSelected", payload); },
            onPaneError: function(payload) { forward("onPaneError", payload); },
            onQuestionError: function(payload) { forward("onPaneError", payload); },
            onHeightChanged: function(payload) { forward("onHeightChanged", payload); }
          };
        })();
        """

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        weak var webView: WKWebView?
        var payload = ""
        var onOpenImage: (URL) -> Void = { _ in }
        var onAnswerChange: (String) -> Void
        var onError: (String) -> Void

        private var isReady = false
        private var lastInjectedPayload = ""

        init(
            onAnswerChange: @escaping (String) -> Void,
            onError: @escaping (String) -> Void
        ) {
            self.onAnswerChange = onAnswerChange
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
            onError("题目内容加载失败，请检查本地服务。")
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            onError("题目内容加载失败，请检查本地服务。")
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
            case "onOptionSelected":
                guard
                    let data = body.data(using: .utf8),
                    let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                    let answer = object["answer"] as? String
                else { return }
                onAnswerChange(answer)
            case "onOpenImage":
                if let data = body.data(using: .utf8),
                   let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let source = object["src"] as? String,
                   let url = URL(string: source), ["http", "https"].contains(url.scheme ?? "") {
                    onOpenImage(url)
                }
            case "onPaneError":
                PaneWebViewChrome.reveal(webView)
                let errorMessage = Self.errorMessage(from: body)
                onError(errorMessage)
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
                if error != nil {
                    self?.lastInjectedPayload = ""
                }
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
            else { return "题目内容加载失败，请重新进入。" }
            return message
        }
    }
}
