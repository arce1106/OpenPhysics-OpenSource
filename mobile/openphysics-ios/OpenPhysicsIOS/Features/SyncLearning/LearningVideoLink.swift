import Foundation
import UIKit

struct LearningVideoTarget: Equatable {
    let url: URL
    let universalLinksOnly: Bool
}

enum LearningVideoLink {
    static func targets(_ raw: String) -> [LearningVideoTarget] {
        guard let original = URLComponents(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = original.scheme?.lowercased(), ["http", "https"].contains(scheme),
              let host = original.host?.lowercased(), !host.isEmpty,
              original.user == nil, original.password == nil, let url = original.url else { return [] }
        let web = LearningVideoTarget(url: url, universalLinksOnly: false)
        guard host == "bilibili.com" || host.hasSuffix(".bilibili.com") || host == "b23.tv" else { return [web] }
        var result = [LearningVideoTarget(url: url, universalLinksOnly: true)]
        var query = original
        query.percentEncodedQuery = query.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%20")
        let keyword = query.queryItems?.first(where: { $0.name == "keyword" })?.value
        let searchPaths = ["", "/", "/all", "/all/", "/video", "/video/"]
        let isSearch = (host == "search.bilibili.com" && searchPaths.contains(original.path))
            || (host == "m.bilibili.com" && ["/search", "/search/"].contains(original.path))
        if isSearch, let keyword, !keyword.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            // Bilibili's public mobile page uses this mobile Universal Link and search scheme.
            if let encoded = encodeQueryValue(keyword),
               let mobile = URL(string: "https://m.bilibili.com/search?keyword=\(encoded)"),
               let app = URL(string: "bilibili://search?keyword=\(encoded)") {
                if mobile != url { result.append(LearningVideoTarget(url: mobile, universalLinksOnly: true)) }
                result.append(LearningVideoTarget(url: app, universalLinksOnly: false))
            }
        } else {
            if host == "www.bilibili.com" || host == "bilibili.com" {
                var mobile = original
                mobile.scheme = "https"
                mobile.host = "m.bilibili.com"
                if let mobileURL = mobile.url { result.append(LearningVideoTarget(url: mobileURL, universalLinksOnly: true)) }
            }
            // Keep BV/AV IDs, parts, timestamps and short links intact; let Bilibili resolve them.
            if let encoded = encodeQueryValue(url.absoluteString), let app = URL(string: "bilibili://browser?url=\(encoded)") {
                result.append(LearningVideoTarget(url: app, universalLinksOnly: false))
            }
        }
        result.append(web)
        return result
    }

    private static func encodeQueryValue(_ value: String) -> String? {
        value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed.subtracting(CharacterSet(charactersIn: "+&=?#%")))
    }

    @MainActor static func open(
        _ raw: String,
        launch: (LearningVideoTarget) async -> Bool = launchWithSystem
    ) async -> Bool {
        for target in targets(raw) {
            guard !Task.isCancelled else { return false }
            if await launch(target) { return true }
        }
        return false
    }

    @MainActor private static func launchWithSystem(_ target: LearningVideoTarget) async -> Bool {
        await withCheckedContinuation { continuation in
            UIApplication.shared.open(target.url, options: target.universalLinksOnly ? [.universalLinksOnly: true] : [:]) {
                continuation.resume(returning: $0)
            }
        }
    }
}
