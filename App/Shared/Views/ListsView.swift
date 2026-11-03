import SwiftUI

/// Blocked / allowed accounts per site, custom phrases and hashtags, and "Import list from URL".
struct ListsView: View {
    enum ListKind: String, CaseIterable, Identifiable {
        case blocked = "Blocked accounts"
        case allowed = "Allowed accounts"
        case phrases = "Custom phrases"
        case hashtags = "Custom hashtags"
        var id: String { rawValue }
        var needsSite: Bool { self == .blocked || self == .allowed }
    }

    @EnvironmentObject private var settings: SettingsStore
    @State private var kind: ListKind = .blocked
    @State private var site = "youtube"
    @State private var newEntry = ""
    @State private var importURL = ""
    @State private var importing = false
    @State private var importMessage: String?

    private var entries: [String] {
        switch kind {
        case .blocked: return settings.settings.blockedAccounts[site] ?? []
        case .allowed: return settings.settings.allowedAccounts[site] ?? []
        case .phrases: return settings.settings.customPhrases
        case .hashtags: return settings.settings.customHashtags
        }
    }

    var body: some View {
        Form {
            Section {
                Picker("List", selection: $kind) {
                    ForEach(ListKind.allCases) { Text($0.rawValue).tag($0) }
                }
                if kind.needsSite {
                    Picker("Site", selection: $site) {
                        ForEach(NoSlopSettings.sites, id: \.self) { Text(NoSlopSettings.siteDisplayName($0)).tag($0) }
                    }
                }
                HStack {
                    TextField(placeholder, text: $newEntry)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit(addEntry)
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        #endif
                    Button("Add", action: addEntry).disabled(newEntry.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            } header: { Text(kind.rawValue) } footer: { Text(footer) }

            Section {
                if entries.isEmpty {
                    Text("Nothing here yet.").foregroundStyle(.secondary)
                } else {
                    ForEach(entries, id: \.self) { entry in
                        Text(entry).font(.body.monospaced())
                    }
                    .onDelete(perform: delete)
                }
            } header: {
                HStack {
                    Text("\(entries.count) entries")
                    Spacer()
                    if !entries.isEmpty {
                        Button("Clear", role: .destructive, action: clearAll).font(.footnote)
                    }
                }
            }

            Section {
                TextField("https://example.com/list.txt", text: $importURL)
                    .textFieldStyle(.roundedBorder)
                    #if os(iOS)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    #endif
                Button {
                    Task { await importFromURL() }
                } label: {
                    HStack {
                        Label("Import list from URL", systemImage: "square.and.arrow.down")
                        if importing { ProgressView().controlSize(.small) }
                    }
                }
                .disabled(importing || URL(string: importURL.trimmingCharacters(in: .whitespaces)) == nil)
                if let importMessage {
                    Text(importMessage).font(.footnote).foregroundStyle(.secondary)
                }
            } header: { Text("Import") } footer: {
                Text("Fetches a plain-text list (one entry per line; lines starting with // or ! are ignored) or a JSON array of strings and appends it to the list selected above. This is the only network request the app makes, and only when you tap Import. Use it for lists NoSlop cannot bundle, e.g. AiSList (CC BY-NC) or OpenSlop (PolyForm NC).")
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Lists")
    }

    private var placeholder: String {
        switch kind {
        case .blocked, .allowed: return site == "reddit" ? "r/subreddit or u/user" : "@handle or channel id"
        case .phrases: return "phrase to hide, e.g. “made with sora”"
        case .hashtags: return "#hashtag"
        }
    }

    private var footer: String {
        switch kind {
        case .blocked: return "Posts from these accounts are always hidden on \(NoSlopSettings.siteDisplayName(site)) (score 1.5)."
        case .allowed: return "Posts from these accounts are never hidden or dimmed on \(NoSlopSettings.siteDisplayName(site))."
        case .phrases: return "Case-insensitive phrases that hide a post on every site (score 1.0)."
        case .hashtags: return "Hashtags that hide a post on every site (score 1.0)."
        }
    }

    private func addEntry() {
        let value = newEntry.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        append([value])
        newEntry = ""
    }

    private func append(_ items: [String]) {
        let normalized = kind == .hashtags ? items.map { $0.hasPrefix("#") ? $0 : "#" + $0 } : items
        switch kind {
        case .blocked: settings.appendAccounts(normalized, site: site, blocked: true)
        case .allowed: settings.appendAccounts(normalized, site: site, blocked: false)
        case .phrases: settings.append(normalized, to: \.customPhrases)
        case .hashtags: settings.append(normalized, to: \.customHashtags)
        }
    }

    private func delete(at offsets: IndexSet) {
        let removed = Set(offsets.map { entries[$0] })
        settings.update { s in
            switch kind {
            case .blocked: s.blockedAccounts[site] = (s.blockedAccounts[site] ?? []).filter { !removed.contains($0) }
            case .allowed: s.allowedAccounts[site] = (s.allowedAccounts[site] ?? []).filter { !removed.contains($0) }
            case .phrases: s.customPhrases.removeAll { removed.contains($0) }
            case .hashtags: s.customHashtags.removeAll { removed.contains($0) }
            }
        }
    }

    private func clearAll() {
        settings.update { s in
            switch kind {
            case .blocked: s.blockedAccounts[site] = []
            case .allowed: s.allowedAccounts[site] = []
            case .phrases: s.customPhrases = []
            case .hashtags: s.customHashtags = []
            }
        }
    }

    private func importFromURL() async {
        guard let url = URL(string: importURL.trimmingCharacters(in: .whitespaces)),
              let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http" else {
            importMessage = "Enter an http(s) URL."
            return
        }
        importing = true
        defer { importing = false }
        do {
            var request = URLRequest(url: url)
            request.timeoutInterval = 20
            let (data, response) = try await URLSession.shared.data(for: request)
            if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                importMessage = "Server answered HTTP \(http.statusCode)."
                return
            }
            let items = ListImporter.parse(data: data, forHashtags: kind == .hashtags)
            let before = entries.count
            append(items)
            let added = entries.count - before
            importMessage = "Imported \(added) new of \(items.count) entries."
        } catch {
            importMessage = "Import failed: \(error.localizedDescription)"
        }
    }
}

/// Parses an imported list: JSON array of strings, JSON object with string-array values, or plain text lines.
enum ListImporter {
    static func parse(data: Data, forHashtags: Bool) -> [String] {
        if let json = try? JSONSerialization.jsonObject(with: data) {
            var out: [String] = []
            collect(json, into: &out)
            return dedupe(out)
        }
        guard let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) else { return [] }
        let lines = text.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }
        let kept = lines.filter { line in
            guard !line.isEmpty, !line.hasPrefix("//"), !line.hasPrefix("!") else { return false }
            if !forHashtags, line.hasPrefix("# ") || line == "#" { return false } // markdown/comment header
            return true
        }
        return dedupe(kept)
    }

    private static func collect(_ value: Any, into out: inout [String]) {
        switch value {
        case let s as String: out.append(s)
        case let a as [Any]: a.forEach { collect($0, into: &out) }
        case let o as [String: Any]: o.sorted { $0.key < $1.key }.forEach { collect($0.value, into: &out) }
        default: break
        }
    }

    private static func dedupe(_ items: [String]) -> [String] {
        var seen = Set<String>()
        return items.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && seen.insert($0.lowercased()).inserted }
    }
}
