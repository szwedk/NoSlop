import Foundation

/// Access to the App Group shared between the apps and the Safari extensions.
/// Compiled into all four targets (Foundation only; extension-API safe).
/// DESIGN.md §6/§7: key `settings` = Settings JSON string, key `stats` = Stats JSON string.
public enum NoSlopSharedStore {
    /// iOS: `group.com.szwedk.noslop` (DESIGN.md §7; carried by the managed provisioning profile).
    /// macOS: the same group with the team-id prefix. macOS lets a sandboxed app use a team-prefixed
    /// group container WITHOUT a provisioning profile, which is what the manual-signing Debug recipe
    /// (CODE_SIGN_STYLE=Manual, no profile) needs; a `group.`-prefixed id on macOS requires a profile.
    #if os(macOS)
    public static let appGroupID = "5DDNFER638.group.com.szwedk.noslop"
    #else
    public static let appGroupID = "group.com.szwedk.noslop"
    #endif
    public static let settingsKey = "settings"
    public static let statsKey = "stats"
    /// Prefix for the Clean Feeds WKWebView host's storage.local emulation (`storageGet`/`storageSet`).
    public static let webviewStoragePrefix = "webview.storage."

    /// Falls back to the standard defaults when the group container is unavailable (an unsigned simulator build,
    /// or the NOSLOP_NO_APP_GROUP=1 sideload build whose entitlements carry no application-groups).
    /// `UserDefaults(suiteName:)` never returns nil for an App Group the process is NOT entitled to: iOS hands back a
    /// live object whose reads are empty and whose writes cfprefsd drops, so the app's own settings would reset on
    /// every launch. The entitlement is therefore probed once through `containerURL(forSecurityApplicationGroupIdentifier:)`
    /// (nil on iOS without the entitlement; macOS keeps the team-prefixed suite, which needs no profile).
    public static let defaults: UserDefaults = {
        #if os(iOS)
        guard FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupID) != nil else { return .standard }
        #endif
        return UserDefaults(suiteName: appGroupID) ?? .standard
    }()

    // MARK: Settings (raw JSON string, parsed by the extension/webview JS)

    public static func settingsJSON() -> String? {
        defaults.string(forKey: settingsKey)
    }

    public static func settingsObject() -> [String: Any]? {
        guard let json = settingsJSON(), let data = json.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    public static func writeSettingsJSON(_ json: String) {
        defaults.set(json, forKey: settingsKey)
    }

    /// Last-writer-wins on `updatedAt` (§7). Returns true when the incoming object was stored.
    @discardableResult
    public static func mergeSettings(_ incoming: [String: Any]) -> Bool {
        let incomingStamp = (incoming["updatedAt"] as? NSNumber)?.doubleValue ?? 0
        let currentStamp = (settingsObject()?["updatedAt"] as? NSNumber)?.doubleValue ?? -1
        guard incomingStamp >= currentStamp else { return false }
        guard JSONSerialization.isValidJSONObject(incoming),
              let data = try? JSONSerialization.data(withJSONObject: incoming, options: [.sortedKeys]),
              let json = String(data: data, encoding: .utf8) else { return false }
        writeSettingsJSON(json)
        return true
    }

    // MARK: Stats  { "<YYYY-MM-DD>": { "<site>": { "hide": n, "dim": n, "reasons": { "<reason>": n } } } }

    public static func statsObject() -> [String: Any] {
        guard let json = defaults.string(forKey: statsKey), let data = json.data(using: .utf8),
              let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return [:] }
        return obj
    }

    public static func writeStats(_ stats: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(stats),
              let data = try? JSONSerialization.data(withJSONObject: stats, options: [.sortedKeys]),
              let json = String(data: data, encoding: .utf8) else { return }
        defaults.set(json, forKey: statsKey)
    }

    /// Merges a stats tree into the stored one. `sum` adds counters (deltas); `max` keeps the larger
    /// counter (idempotent snapshots). Days older than 60 are pruned.
    public static func mergeStats(_ incoming: [String: Any], sum: Bool = true) {
        var stored = statsObject()
        for (day, sitesAny) in incoming {
            guard let sites = sitesAny as? [String: Any] else { continue }
            var storedSites = stored[day] as? [String: Any] ?? [:]
            for (site, countersAny) in sites {
                guard let counters = countersAny as? [String: Any] else { continue }
                var storedCounters = storedSites[site] as? [String: Any] ?? [:]
                for key in ["hide", "dim"] {
                    let a = (storedCounters[key] as? NSNumber)?.intValue ?? 0
                    let b = (counters[key] as? NSNumber)?.intValue ?? 0
                    storedCounters[key] = sum ? a + b : max(a, b)
                }
                var reasons = storedCounters["reasons"] as? [String: Any] ?? [:]
                for (reason, nAny) in counters["reasons"] as? [String: Any] ?? [:] {
                    let a = (reasons[reason] as? NSNumber)?.intValue ?? 0
                    let b = (nAny as? NSNumber)?.intValue ?? 0
                    reasons[reason] = sum ? a + b : max(a, b)
                }
                storedCounters["reasons"] = reasons
                storedSites[site] = storedCounters
            }
            stored[day] = storedSites
        }
        let cutoff = dayString(Date(timeIntervalSinceNow: -60 * 86_400))
        stored = stored.filter { $0.key >= cutoff }
        writeStats(stored)
    }

    /// Records one event (`{site, action, reason}`) for today. Used by the Clean Feeds host.
    public static func recordEvent(site: String, action: String, reason: String?) {
        guard action == "hide" || action == "dim" else { return }
        var reasons: [String: Any] = [:]
        if let reason, !reason.isEmpty { reasons[reason] = 1 }
        mergeStats([dayString(Date()): [site: [action: 1, "reasons": reasons]]], sum: true)
    }

    public static func dayString(_ date: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }
}
