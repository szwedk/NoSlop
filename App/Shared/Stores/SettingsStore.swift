import Foundation
import Combine

/// Owns the in-memory Settings and persists them to the App Group as the JSON string key `settings`.
/// Every mutation through `update` stamps `updatedAt` (ms since 1970) so the extension's
/// last-writer-wins sync (§7) picks the change up.
@MainActor
final class SettingsStore: ObservableObject {
    @Published private(set) var settings = NoSlopSettings()
    @Published private(set) var lastError: String?
    /// Incremented on every persisted change; the Clean Feeds webviews observe it to push settings into the page.
    @Published private(set) var revision = 0

    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.outputFormatting = [.sortedKeys]
        return e
    }()
    private let decoder = JSONDecoder()

    init() {
        reload()
    }

    /// Re-reads the App Group; keeps the newer copy by `updatedAt` (the extension may have written).
    func reload() {
        guard let json = NoSlopSharedStore.settingsJSON(), let data = json.data(using: .utf8) else {
            if NoSlopSharedStore.settingsJSON() == nil { persist(settings) } // first launch: seed defaults
            return
        }
        do {
            let stored = try decoder.decode(NoSlopSettings.self, from: data)
            if stored.updatedAt >= settings.updatedAt, stored != settings {
                settings = stored
                revision += 1
            }
            lastError = nil
        } catch {
            lastError = "Stored settings could not be read (\(error.localizedDescription)); using defaults."
        }
    }

    func update(_ mutate: (inout NoSlopSettings) -> Void) {
        var copy = settings
        mutate(&copy)
        copy.version = 1
        copy.updatedAt = (Date().timeIntervalSince1970 * 1000).rounded()
        settings = copy
        persist(copy)
        revision += 1
    }

    /// Applies a partial patch coming from JS (`host.patchSettings`). Unknown keys are ignored.
    func applyPatch(_ partial: [String: Any]) {
        guard var obj = currentJSONObject() else { return }
        for (k, v) in partial where k != "updatedAt" { obj[k] = v }
        guard let data = try? JSONSerialization.data(withJSONObject: obj),
              let merged = try? decoder.decode(NoSlopSettings.self, from: data) else {
            lastError = "Patch from the feed page was not valid settings JSON."
            return
        }
        update { $0 = merged }
    }

    func currentJSONString() -> String {
        (try? encoder.encode(settings)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }

    func currentJSONObject() -> [String: Any]? {
        guard let data = try? encoder.encode(settings) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    func resetToDefaults() {
        update { $0 = NoSlopSettings() }
    }

    private func persist(_ value: NoSlopSettings) {
        do {
            let data = try encoder.encode(value)
            guard let json = String(data: data, encoding: .utf8) else { return }
            NoSlopSharedStore.writeSettingsJSON(json)
            lastError = nil
        } catch {
            lastError = "Could not save settings: \(error.localizedDescription)"
        }
    }

    // MARK: Convenience accessors used by the views

    func mode(for site: String) -> String { settings.sites[site]?.mode ?? "balanced" }

    func setMode(_ mode: String, for site: String) {
        guard NoSlopSettings.modes.contains(mode) else { return }
        update { $0.sites[site] = NoSlopSettings.SiteSettings(mode: mode) }
    }

    /// Appends unique, trimmed, non-empty entries to a list; returns how many were added.
    @discardableResult
    func append(_ items: [String], to keyPath: WritableKeyPath<NoSlopSettings, [String]>) -> Int {
        let cleaned = items.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        var added = 0
        update { s in
            var list = s[keyPath: keyPath]
            let existing = Set(list.map { $0.lowercased() })
            for item in cleaned where !existing.contains(item.lowercased()) && !list.contains(item) {
                list.append(item)
                added += 1
            }
            s[keyPath: keyPath] = list
        }
        return added
    }

    @discardableResult
    func appendAccounts(_ items: [String], site: String, blocked: Bool) -> Int {
        let cleaned = items.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        var added = 0
        update { s in
            var list = (blocked ? s.blockedAccounts[site] : s.allowedAccounts[site]) ?? []
            let existing = Set(list.map { $0.lowercased() })
            for item in cleaned where !existing.contains(item.lowercased()) {
                list.append(item)
                added += 1
            }
            if blocked { s.blockedAccounts[site] = list } else { s.allowedAccounts[site] = list }
        }
        return added
    }
}
