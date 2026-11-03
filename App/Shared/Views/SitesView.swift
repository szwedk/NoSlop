import SwiftUI

struct SitesView: View {
    @EnvironmentObject private var settings: SettingsStore

    var body: some View {
        Form {
            Section {
                ForEach(NoSlopSettings.sites, id: \.self) { site in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(NoSlopSettings.siteDisplayName(site)).font(.headline)
                        Picker(NoSlopSettings.siteDisplayName(site), selection: Binding(
                            get: { settings.mode(for: site) },
                            set: { settings.setMode($0, for: site) })) {
                            ForEach(NoSlopSettings.modes, id: \.self) { Text($0.capitalized).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        .labelsHidden()
                        Text(NoSlopSettings.modeDescription(settings.mode(for: site)))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 2)
                }
            } header: { Text("Mode per site") } footer: {
                Text("Strict hides at a lower score; Balanced hides only high-precision signals; Off disables the site.")
            }

            Section {
                toggle("Hide YouTube Shorts", \.surfaces.hideShorts)
                toggle("Hide Instagram Reels", \.surfaces.hideReels)
                toggle("Hide Grok posts and promos on X", \.surfaces.hideGrokPosts)
                toggle("Hide TikTok “For You” feed", \.surfaces.hideTikTokForYou)
                toggle("Hide ads and promoted posts", \.surfaces.hideAds)
                toggle("Hide Reddit “recommended” posts", \.surfaces.hideRedditRecommended)
            } header: { Text("Surfaces") } footer: {
                Text("Surface toggles remove whole shelves or feeds regardless of score. On X the Grok toggle hides posts linking a Grok conversation, posts quoting or by @grok, and the home-feed Grok Imagine/Build promos; X's own “Made with AI” label is always hidden.")
            }

            Section {
                toggle("Use TikTok's own AI labels from feed data", \.tiktokJsonRelay)
                toggle("Skip to the next Instagram Reel after hiding one", \.reelsAutoAdvance)
                Toggle("Treat Reddit “App” accounts as AI", isOn: Binding(
                    get: { settings.settings.sites["reddit"]?.flagAppAccounts ?? false },
                    set: { v in settings.update { s in
                        var site = s.sites["reddit"] ?? NoSlopSettings.SiteSettings()
                        site.flagAppAccounts = v
                        s.sites["reddit"] = site
                    } }))
            } header: { Text("Site extras") } footer: {
                Text("The TikTok relay reads TikTok's AIGC fields from the feed JSON in the page. Reddit's “App” label marks automated accounts, not AI content — opt in only if you want them hidden too. On Facebook only posts whose AI label is shown inline are caught: Meta moved the label for AI-edited posts into the … menu.")
            }

            Section {
                toggle("Prefetch watch pages", \.youtubePrefetch)
                Stepper(value: Binding(
                    get: { settings.settings.youtubePrefetchConcurrency },
                    set: { v in settings.update { $0.youtubePrefetchConcurrency = max(1, min(4, v)) } }),
                    in: 1...4) {
                    HStack {
                        Text("Concurrency")
                        Spacer()
                        Text("\(settings.settings.youtubePrefetchConcurrency)").foregroundStyle(.secondary)
                    }
                }
                .disabled(!settings.settings.youtubePrefetch)
            } header: { Text("YouTube") } footer: {
                Text("Prefetch loads a video’s watch page in the background to read the “How this content was made” / Altered or synthetic label before you click. Uses extra bandwidth.")
            }

            Section {
                toggle("Show “Hidden” stubs", \.showStubs)
                toggle("Dim instead of hide", \.dimInsteadOfHide)
                toggle("Auto-block repeat offenders", \.autoPromote.enabled)
                Stepper(value: Binding(
                    get: { settings.settings.autoPromote.hits },
                    set: { v in settings.update { $0.autoPromote.hits = max(1, min(20, v)) } }),
                    in: 1...20) {
                    HStack {
                        Text("Labelled hits before auto-block")
                        Spacer()
                        Text("\(settings.settings.autoPromote.hits)").foregroundStyle(.secondary)
                    }
                }
                .disabled(!settings.settings.autoPromote.enabled)
            } header: { Text("Behaviour") } footer: {
                Text("Stubs show “Hidden: AI content — reason · Show · Never show @author” in place of a hidden post. Auto-block adds an account to your blocked list after N platform-labelled or self-disclosed hits; undo it in Lists.")
            }

            Section {
                Button("Reset all settings to defaults", role: .destructive) { settings.resetToDefaults() }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Sites")
    }

    private func toggle(_ title: String, _ keyPath: WritableKeyPath<NoSlopSettings, Bool>) -> some View {
        Toggle(title, isOn: Binding(
            get: { settings.settings[keyPath: keyPath] },
            set: { v in settings.update { $0[keyPath: keyPath] = v } }))
    }
}
