import Foundation

/// Loads `rules.json` from the WebExtension folder reference inside the app bundle
/// (DESIGN.md §3; the file is owned by the core agent and may be absent in early builds).
enum RulesLoader {
    struct PlatformActions {
        var xMutedWords: [String] = []
        var instagramHiddenWords: [String] = []
        var instagramYourAlgorithmLess: [String] = []
        var tiktok: String = ""
        var youtube: String = ""
        var isEmpty: Bool {
            xMutedWords.isEmpty && instagramHiddenWords.isEmpty && instagramYourAlgorithmLess.isEmpty && tiktok.isEmpty && youtube.isEmpty
        }
    }

    static var webExtensionFolder: URL? {
        Bundle.main.url(forResource: "WebExtension", withExtension: nil)
    }

    static func rulesURL() -> URL? {
        webExtensionFolder?.appendingPathComponent("rules.json")
    }

    static func loadRules() -> [String: Any]? {
        guard let url = rulesURL(), let data = try? Data(contentsOf: url) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    static func rulesVersion() -> String? {
        loadRules()?["version"] as? String
    }

    static func platformActions() -> PlatformActions? {
        guard let rules = loadRules(), let pa = rules["platformActions"] as? [String: Any] else { return nil }
        var out = PlatformActions()
        out.xMutedWords = pa["xMutedWords"] as? [String] ?? []
        out.instagramHiddenWords = pa["instagramHiddenWords"] as? [String] ?? []
        out.instagramYourAlgorithmLess = pa["instagramYourAlgorithmLess"] as? [String] ?? []
        out.tiktok = pa["tiktok"] as? String ?? ""
        out.youtube = pa["youtube"] as? String ?? ""
        return out
    }
}
