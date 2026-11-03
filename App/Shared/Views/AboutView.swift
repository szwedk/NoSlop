import SwiftUI

struct AboutView: View {
    private var version: String {
        let v = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        let b = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
        return "\(v) (\(b))"
    }

    var body: some View {
        Form {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text("NoSlop").font(.title2.bold())
                    Text("Removes AI-generated content and “AI slop” from social feeds. One codebase: an iPhone app and a Mac app, each containing the same Safari Web Extension. No backend, no account, no telemetry.")
                        .font(.callout)
                    Text("Version \(version)" + (RulesLoader.rulesVersion().map { " · rules \($0)" } ?? ""))
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }

            Section {
                bullet("On iPhone, Apple gives no app a way to see or change what the native Instagram, X or YouTube apps show. NoSlop filters those sites in Safari (instagram.com, x.com, m.youtube.com).")
                bullet("Home-Screen web apps do not run extensions on iOS. Private Browsing needs a per-extension toggle in Settings.")
                bullet("The “nuclear option” is a Screen Time shield on the native app so you open Safari instead.")
                bullet("On Mac, X, Instagram and YouTube have no native apps, so Safari (and the Chrome build) is everything.")
                bullet("Only platform labels (YouTube “Altered or synthetic” / “How this content was made”, Meta “AI info”, TikTok aigc tag, X “Made with AI” and Grok links) and self-disclosure are high-precision. Style heuristics only dim, never hide.")
                bullet("Unlabelled, undisclosed AI images cannot be reliably detected on-device in 2026. NoSlop does not pretend otherwise.")
            } header: { Text("The honest ceiling") }

            Section {
                bullet("Tier 0 — platform AI labels (score 1.5).")
                bullet("Tier 1 — self-disclosure, AI hashtags, tool names, chatbot residue, prompt metadata.")
                bullet("Tier 2 — your blocked accounts (1.5) and bundled seed lists (1.0); allowed accounts always win.")
                bullet("Tier 3 — style tells, capped so they can only dim.")
                Text("Strict hides at 0.8 / dims at 0.4; Balanced hides at 1.0 / dims at 0.6; Off does nothing.")
                    .font(.footnote).foregroundStyle(.secondary)
            } header: { Text("How scoring works") }

            Section {
                Text("Bundled seed lists come only from MIT-licensed sources. Non-commercial lists (AiSList, OpenSlop) are not bundled; use Lists ▸ Import list from URL. Platform selectors and label strings come from the research in docs/research.")
                    .font(.footnote)
            } header: { Text("Licences and data") }
        }
        .formStyle(.grouped)
        .navigationTitle("About")
    }

    private func bullet(_ text: String) -> some View {
        Label { Text(text).font(.callout) } icon: { Image(systemName: "circle.fill").font(.system(size: 6)).padding(.top, 7) }
    }
}
