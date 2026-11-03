import SafariServices
import os.log

/// Native side of the DESIGN.md §7 protocol. Only background.js talks to us.
/// Every message is a dictionary under SFExtensionMessageKey with a `type` string.
class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    private static let log = OSLog(subsystem: "com.szwedk.noslop", category: "native")

    #if os(iOS)
    private static let platform = "ios"
    #else
    private static let platform = "macos"
    #endif

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let message = request?.userInfo?[SFExtensionMessageKey] as? [String: Any] ?? [:]
        let type = message["type"] as? String ?? ""
        let reply = Self.handle(type: type, message: message)
        os_log(.debug, log: Self.log, "native %{public}@ -> %{public}@", type, String(describing: reply.keys.sorted()))
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: reply]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }

    static func handle(type: String, message: [String: Any]) -> [String: Any] {
        switch type {
        case "ping":
            let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
            return ["ok": true, "version": version, "platform": platform]
        case "getSharedSettings":
            if let settings = NoSlopSharedStore.settingsObject() { return ["settings": settings] }
            return ["settings": NSNull()]
        case "putSharedSettings":
            guard let settings = message["settings"] as? [String: Any] else {
                return ["ok": false, "error": "settings must be an object"]
            }
            let stored = NoSlopSharedStore.mergeSettings(settings)
            return ["ok": true, "stored": stored]
        case "recordStats":
            guard let stats = message["stats"] as? [String: Any] else {
                return ["ok": false, "error": "stats must be an object"]
            }
            // Default: `stats` is a delta (counters are added). Send `mode: "snapshot"` to max-merge instead.
            let isSnapshot = (message["mode"] as? String) == "snapshot"
            NoSlopSharedStore.mergeStats(stats, sum: !isSnapshot)
            return ["ok": true]
        case "classify":
            // v1: no on-device model. Fail-open contract: empty verdicts, the JS scorer decides alone.
            return ["verdicts": [Any]()]
        default:
            return ["ok": false, "error": "unknown message type: \(type)"]
        }
    }
}
