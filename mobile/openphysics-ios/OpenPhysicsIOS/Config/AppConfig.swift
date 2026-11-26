import Foundation

enum AppConfig {
    static var apiBaseURL: URL {
        guard
            let rawValue = Bundle.main.object(forInfoDictionaryKey: "OpenPhysicsAPIBaseURL") as? String,
            let url = URL(string: rawValue)
        else {
            return URL(string: "http://localhost:8010/api/student")!
        }
        return url
    }


    static var learningContentPaneURL: URL {
        var components = URLComponents()
        components.scheme = apiBaseURL.scheme
        components.host = apiBaseURL.host
        components.port = apiBaseURL.port
        components.path = "/panes/learning-content/"
        return components.url ?? URL(string: "http://localhost:8010/panes/learning-content/")!
    }

    static func resolvedAssetURL(_ value: String?) -> URL? {
        guard let value, !value.isEmpty else { return nil }
        if value.hasPrefix("//") {
            return URL(string: "https:\(value)")
        }
        if let absolute = URL(string: value), absolute.scheme != nil {
            return absolute
        }
        var components = URLComponents()
        components.scheme = apiBaseURL.scheme
        components.host = apiBaseURL.host
        components.port = apiBaseURL.port
        components.path = value.hasPrefix("/") ? value : "/\(value)"
        return components.url
    }
}
