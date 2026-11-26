import SwiftUI
import WebKit

struct KnowledgeCardPaneView: UIViewRepresentable {
    @Environment(\.openPhysicsIsPhone) private var isPhone
    @ScaledMetric(relativeTo: .body) private var textScale: CGFloat = 1
    let card: LearningKnowledgeCard
    let onRendered: () -> Void
    let onError: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onRendered: onRendered, onError: onError)
    }

    func makeUIView(context: Context) -> WKWebView {
        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: "openPhysicsKnowledgeCard")
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
        context.coordinator.onRendered = onRendered
        context.coordinator.onError = onError
        context.coordinator.payload = payload
        context.coordinator.injectPayloadIfReady()
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(
            forName: "openPhysicsKnowledgeCard"
        )
        webView.navigationDelegate = nil
    }

    private var payload: String {
        let object: [String: Any] = [
            "mode": "knowledge_card",
            "presentation": isPhone ? "phone" : "tablet",
            "textScale": textScale,
            "content_id": card.contentId,
            "title": card.title,
            "sections": card.sections.map(\.paneDictionary),
        ]
        let data = try? JSONSerialization.data(withJSONObject: object)
        return data.flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }

    private static let bridgeBootstrapScript = """
        (function() {
          function forward(method, payload) {
            try {
              window.webkit.messageHandlers.openPhysicsKnowledgeCard.postMessage({
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
        var onRendered: () -> Void
        var onError: (String) -> Void

        private var isReady = false
        private var lastInjectedPayload = ""

        init(onRendered: @escaping () -> Void, onError: @escaping (String) -> Void) {
            self.onRendered = onRendered
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
            onError("知识卡内容加载失败，请检查本地服务。")
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            onError("知识卡内容加载失败，请检查本地服务。")
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
            case "onPaneReady":
                isReady = true
                injectPayloadIfReady()
            case "onPayloadRendered":
                isReady = true
                PaneWebViewChrome.reveal(webView)
                onRendered()
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
            else { return "知识卡内容加载失败，请重新进入。" }
            return message
        }
    }
}
