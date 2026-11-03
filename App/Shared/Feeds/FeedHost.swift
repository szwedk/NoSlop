#if NOSLOP_CLEAN_FEEDS
import Foundation
import WebKit

/// Swift side of the §6 host for the Clean Feeds webviews. JS calls
/// `window.webkit.messageHandlers.noslop.postMessage({type, ...})` and gets a Promise reply.
/// Message types: getSettings, patchSettings {partial}, fetchText {url, timeout}, report {events|event},
/// storageGet {keys}, storageSet {items}, log {message}.
@MainActor
final class FeedHost: NSObject, WKScriptMessageHandlerWithReply {
    nonisolated static let handlerName = "noslop"
    /// Mac Safari UA used for every proxied fetch (see the fetchText case below).
    nonisolated static let desktopUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15"
    private let settings: SettingsStore

    init(settings: SettingsStore) {
        self.settings = settings
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) async -> (Any?, String?) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else {
            return (nil, "noslop: message body must be an object with a `type`")
        }
        switch type {
        case "getSettings":
            return (settings.currentJSONObject() ?? [:], nil)
        case "patchSettings":
            if let partial = body["partial"] as? [String: Any] { settings.applyPatch(partial) }
            return (settings.currentJSONObject() ?? [:], nil)
        case "fetchText":
            guard let urlString = body["url"] as? String, let url = URL(string: urlString),
                  let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http" else {
                return (nil, "fetchText: invalid url")
            }
            let timeout = (body["timeout"] as? NSNumber)?.doubleValue ?? 8000
            var request = URLRequest(url: url)
            request.timeoutInterval = max(1, timeout / 1000)
            // Always a desktop Safari UA: with the iPhone UA www.youtube.com 302-redirects to m.youtube.com, whose watch
            // HTML carries no howThisWasMadeSectionViewModel / badge JSON (tests/live/REPORT.md), so the tier-0 label
            // path would never fire in the iOS Clean Feeds webview. The JS host no longer forwards navigator.userAgent.
            request.setValue(Self.desktopUserAgent, forHTTPHeaderField: "User-Agent")
            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                    return (nil, "fetchText: HTTP \(http.statusCode)")
                }
                return (String(data: data, encoding: .utf8) ?? String(decoding: data, as: UTF8.self), nil)
            } catch {
                return (nil, "fetchText: \(error.localizedDescription)")
            }
        case "report":
            var events: [[String: Any]] = []
            if let list = body["events"] as? [[String: Any]] { events = list }
            else if let one = body["event"] as? [String: Any] { events = [one] }
            for ev in events where (ev["type"] as? String ?? "stats") == "stats" {
                NoSlopSharedStore.recordEvent(site: ev["site"] as? String ?? "unknown",
                                              action: ev["action"] as? String ?? "",
                                              reason: ev["reason"] as? String)
            }
            return (["ok": true, "count": events.count], nil)
        case "storageGet":
            let keys = body["keys"] as? [String] ?? []
            var out: [String: Any] = [:]
            for key in keys {
                if let json = NoSlopSharedStore.defaults.string(forKey: NoSlopSharedStore.webviewStoragePrefix + key),
                   let data = json.data(using: .utf8),
                   let value = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) {
                    out[key] = value
                }
            }
            return (out, nil)
        case "storageSet":
            let items = body["items"] as? [String: Any] ?? [:]
            for (key, value) in items {
                if value is NSNull {
                    NoSlopSharedStore.defaults.removeObject(forKey: NoSlopSharedStore.webviewStoragePrefix + key)
                } else if let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
                          let json = String(data: data, encoding: .utf8) {
                    NoSlopSharedStore.defaults.set(json, forKey: NoSlopSharedStore.webviewStoragePrefix + key)
                }
            }
            return (["ok": true], nil)
        case "log":
            NSLog("NoSlop feed: %@", String(describing: body["message"] ?? ""))
            return (["ok": true], nil)
        default:
            return (nil, "noslop: unknown message type \(type)")
        }
    }
}
#endif
