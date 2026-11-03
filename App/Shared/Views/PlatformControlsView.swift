import SwiftUI

/// Paste-lists and menu paths that teach the platforms themselves to show less AI content.
/// Data comes from rules.json `platformActions` (DESIGN.md §3, bundled under WebExtension/).
struct PlatformControlsView: View {
    @State private var actions: RulesLoader.PlatformActions? = RulesLoader.platformActions()
    @State private var copied: String?

    var body: some View {
        Form {
            if actions == nil {
                Section {
                    Label("rules.json was not found in this build (WebExtension/rules.json). Platform lists appear once the extension data ships.", systemImage: "exclamationmark.triangle")
                        .font(.footnote).foregroundStyle(.orange)
                    Button("Reload") { actions = RulesLoader.platformActions() }
                }
            }
            let a = actions ?? RulesLoader.PlatformActions()

            pasteSection(
                title: "X — Muted words",
                // Path: docs/research/slop-detection-prior-art.md §6 table (X row, LIKELY): Settings and privacy ▸ Privacy and safety ▸ Mute and block ▸ Muted words.
                path: "x.com ▸ Settings and privacy ▸ Privacy and safety ▸ Mute and block ▸ Muted words (web) · Notifications gear ▸ Muted ▸ Muted words (mobile)",
                link: URL(string: "https://x.com/settings/muted_keywords"), // URL not verified in research; the menu path above is.
                linkTitle: "Open x.com muted words",
                items: a.xMutedWords, id: "x")

            pasteSection(
                title: "Instagram — Hidden Words",
                // Path: prior-art §6 (Instagram row): Hidden Words for recommended posts (caption words/emoji/hashtags).
                path: "Instagram ▸ Settings ▸ Content preferences ▸ Hidden Words ▸ add each word/hashtag for recommended posts",
                link: URL(string: "https://www.instagram.com/"),
                linkTitle: "Open instagram.com",
                items: a.instagramHiddenWords, id: "ig-hidden")

            pasteSection(
                title: "Instagram — Your Algorithm (less)",
                // Path: prior-art §6 (Instagram row, VERIFIED): Reels/Explore icon top-right or Settings ▸ Content preferences ▸ Your algorithm.
                path: "Instagram ▸ Settings ▸ Content preferences ▸ Your algorithm ▸ add as “less” topics",
                link: URL(string: "https://www.instagram.com/"),
                linkTitle: "Open instagram.com",
                items: a.instagramYourAlgorithmLess, id: "ig-algo")

            Section {
                Text(a.tiktok.isEmpty ? "Settings ▸ Content preferences ▸ Manage topics ▸ AI-generated content slider to minimum" : a.tiktok)
                    .font(.callout)
                Text("Adjusts the For You feed only; it reduces, it does not remove.").font(.footnote).foregroundStyle(.secondary)
            } header: { Text("TikTok — AIGC slider") }

            Section {
                Text(a.youtube.isEmpty ? "On any card: More (⋮) ▸ “Don’t recommend channel”. Undo everything at myactivity.google.com." : a.youtube)
                    .font(.callout)
                Link("Open myactivity.google.com (undo)", destination: URL(string: "https://myactivity.google.com/")!)
                    .font(.footnote)
            } header: { Text("YouTube — Don’t recommend") } footer: {
                Text("None of these platforms expose an API for these controls, so NoSlop gives you the list to paste and the path to paste it at.")
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Platform controls")
        .onAppear { actions = RulesLoader.platformActions() }
    }

    @ViewBuilder
    private func pasteSection(title: String, path: String, link: URL?, linkTitle: String, items: [String], id: String) -> some View {
        Section {
            Text(path).font(.footnote).foregroundStyle(.secondary)
            if let link {
                Link(linkTitle, destination: link).font(.callout)
            }
            if items.isEmpty {
                Text("No entries in rules.json.").foregroundStyle(.secondary)
            } else {
                Button {
                    Pasteboard.copy(items.joined(separator: "\n"))
                    copied = id
                } label: {
                    Label(copied == id ? "Copied \(items.count) entries" : "Copy all \(items.count) entries", systemImage: copied == id ? "checkmark" : "doc.on.doc")
                }
                ForEach(items, id: \.self) { item in
                    HStack {
                        Text(item).font(.body.monospaced())
                        Spacer()
                        Button {
                            Pasteboard.copy(item)
                            copied = id + "/" + item
                        } label: {
                            Image(systemName: copied == id + "/" + item ? "checkmark" : "doc.on.doc")
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel("Copy \(item)")
                    }
                }
            }
        } header: { Text(title) }
    }
}

enum Pasteboard {
    static func copy(_ text: String) {
        #if os(iOS)
        UIPasteboard.general.string = text
        #else
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #endif
    }
}
