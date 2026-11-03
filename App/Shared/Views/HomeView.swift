import SwiftUI
#if os(macOS)
import SafariServices
#endif

struct HomeView: View {
    @EnvironmentObject private var settings: SettingsStore
    @EnvironmentObject private var stats: StatsStore
    @State private var safariMessage: String?

    private var enabledBinding: Binding<Bool> {
        Binding(get: { settings.settings.enabled }, set: { v in settings.update { $0.enabled = v } })
    }

    var body: some View {
        Form {
            Section {
                Toggle(isOn: enabledBinding) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("NoSlop filtering").font(.headline)
                        Text(settings.settings.enabled ? "On — the Safari extension hides and dims AI content on supported sites."
                             : "Off — nothing is hidden or dimmed.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
                if let err = settings.lastError {
                    Label(err, systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(.orange)
                }
            } header: { Text("Status") }

            Section {
                HStack {
                    statTile("Today", stats.today)
                    Divider()
                    statTile("Last 7 days", stats.week)
                }
                .padding(.vertical, 4)
                if stats.weekBySite.isEmpty {
                    Text("No activity recorded yet. Counts appear here once the extension (or Clean Feeds) hides or dims something.")
                        .font(.footnote).foregroundStyle(.secondary)
                } else {
                    ForEach(stats.weekBySite) { row in
                        HStack {
                            Text(NoSlopSettings.siteDisplayName(row.site))
                            Spacer()
                            Text("\(row.counts.hide) hidden · \(row.counts.dim) dimmed").foregroundStyle(.secondary)
                        }
                        .font(.callout)
                    }
                }
                if !stats.topReasons.isEmpty {
                    DisclosureGroup("Top reasons (7 days)") {
                        ForEach(stats.topReasons, id: \.reason) { r in
                            HStack {
                                Text(r.reason).font(.callout.monospaced())
                                Spacer()
                                Text("\(r.count)").foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            } header: { Text("Activity") } footer: {
                HStack {
                    Text("Counts come from the shared App Group and refresh every 15 s.")
                    Spacer()
                    Button("Refresh") { stats.refresh() }.buttonStyle(.borderless).font(.footnote)
                }
            }

            Section {
                enableSteps
            } header: { Text("Enable in Safari") }

            Section {
                Label {
                    Text("NoSlop cannot touch the native Instagram, X or YouTube apps on iPhone — Apple gives no app a way to see or change what they show. It filters those sites in Safari (instagram.com, x.com, m.youtube.com). Home-Screen web apps do not run extensions on iOS, and Private Browsing needs its own per-extension toggle. Only platform AI labels and self-disclosure are high-precision; style heuristics only dim, never hide.")
                        .font(.footnote)
                } icon: {
                    Image(systemName: "hand.raised").foregroundStyle(.orange)
                }
            } header: { Text("The honest ceiling") }
        }
        .formStyle(.grouped)
        .navigationTitle("NoSlop")
        .onAppear { stats.refresh(); settings.reload() }
    }

    private func statTile(_ title: String, _ counts: StatsStore.Counts) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text("\(counts.total)").font(.system(size: 32, weight: .semibold, design: .rounded))
            Text("\(counts.hide) hidden · \(counts.dim) dimmed").font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var enableSteps: some View {
        #if os(macOS)
        VStack(alignment: .leading, spacing: 8) {
            Text("1. Open Safari ▸ Settings ▸ Extensions.\n2. Tick NoSlop Extension.\n3. Allow it on youtube.com, x.com, instagram.com and the other sites you use (or “Always Allow on Every Website”).")
                .font(.callout)
            Button {
                openSafariExtensionSettings()
            } label: {
                Label("Open Safari Extension Settings", systemImage: "safari")
            }
            if let safariMessage {
                Text(safariMessage).font(.footnote).foregroundStyle(.secondary)
            }
            Text("Developer builds: Safari ▸ Settings ▸ Advanced ▸ “Show features for web developers”, then Developer ▸ “Allow unsigned extensions” (resets when Safari quits).")
                .font(.footnote).foregroundStyle(.secondary)
        }
        #else
        VStack(alignment: .leading, spacing: 8) {
            Text("1. Open the Settings app.\n2. Apps ▸ Safari ▸ Extensions ▸ NoSlop.\n3. Turn on “Allow Extension”.\n4. Under Permissions set the sites (or “All Websites”) to Allow.\n5. In Safari, open instagram.com, x.com or m.youtube.com and tap the puzzle icon in the address bar to confirm NoSlop is active.")
                .font(.callout)
            Text("iOS has no deep link into Safari’s extension settings, so these steps are manual. To use Private Browsing you must also enable NoSlop under Settings ▸ Apps ▸ Safari ▸ Extensions ▸ NoSlop ▸ “Private Browsing”.")
                .font(.footnote).foregroundStyle(.secondary)
        }
        #endif
    }

    #if os(macOS)
    private func openSafariExtensionSettings() {
        SFSafariApplication.showPreferencesForExtension(withIdentifier: "com.szwedk.noslop.Extension") { error in
            DispatchQueue.main.async {
                safariMessage = error.map { "Safari could not open the extension settings: \($0.localizedDescription)" }
                    ?? "Safari extension settings opened."
            }
        }
    }
    #endif
}
