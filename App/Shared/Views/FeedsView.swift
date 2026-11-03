#if NOSLOP_CLEAN_FEEDS
import SwiftUI
import WebKit

/// Debug/sideload-only "Clean Feeds": Instagram / X / YouTube in a WKWebView with the extension scripts injected.
/// Positioned as a reader/filter tool the user configures, never as the sites' apps (App Review 4.2 / 5.2.2).
struct FeedsView: View {
    @EnvironmentObject private var settings: SettingsStore
    @StateObject private var model = FeedsModel()
    @State private var selected = "instagram"
    @State private var showScripts = false

    var body: some View {
        VStack(spacing: 0) {
            Picker("Feed", selection: $selected) {
                ForEach(model.controllers) { c in Text(c.title).tag(c.id) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.vertical, 8)

            if model.bundle.loadedCount == 0 {
                banner("Extension scripts are not in this build yet (WebExtension/ has no rules.js / lib / adapters). The page loads unfiltered.", color: .orange)
            } else if !model.bundle.missing.isEmpty {
                banner("Loaded \(model.bundle.loadedCount) scripts; missing: \(model.bundle.missing.joined(separator: ", ")).", color: .secondary)
            }

            if let controller = model.controller(id: selected) {
                FeedWebViewRepresentable(controller: controller)
                    .onAppear { controller.loadIfNeeded() }
                    .id(controller.id)
            }
        }
        .navigationTitle("Clean Feeds")
        .toolbar {
            ToolbarItemGroup {
                Button { model.controller(id: selected)?.goHome() } label: { Image(systemName: "house") }
                    .accessibilityLabel("Feed home")
                Button { model.controller(id: selected)?.reload() } label: { Image(systemName: "arrow.clockwise") }
                    .accessibilityLabel("Reload")
                Button { showScripts.toggle() } label: { Image(systemName: "doc.text.magnifyingglass") }
                    .accessibilityLabel("Injected scripts")
                    .popover(isPresented: $showScripts) { scriptList }
            }
        }
        .onAppear { model.prepare(settings: settings) }
        .onChange(of: settings.revision) { _, _ in model.pushSettings() }
    }

    private func banner(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(color)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal)
            .padding(.bottom, 6)
    }

    private var scriptList: some View {
        List(model.bundle.entries) { e in
            Label(e.path, systemImage: e.found ? "checkmark.circle" : "xmark.circle")
                .foregroundStyle(e.found ? Color.primary : Color.secondary)
                .font(.callout.monospaced())
        }
        .frame(minWidth: 280, minHeight: 240)
    }
}

@MainActor
final class FeedsModel: ObservableObject {
    @Published private(set) var controllers: [FeedController] = []
    private(set) var bundle = FeedScriptBundle(scripts: [], entries: [])

    func prepare(settings: SettingsStore) {
        guard controllers.isEmpty else { return }
        bundle = FeedScriptBundle.load()
        let scripts = bundle.scripts
        controllers = [
            FeedController(id: "instagram", title: "Instagram", url: URL(string: "https://www.instagram.com/")!, settings: settings, scripts: scripts),
            FeedController(id: "x", title: "X", url: URL(string: "https://x.com/home")!, settings: settings, scripts: scripts),
            FeedController(id: "youtube", title: "YouTube", url: URL(string: "https://m.youtube.com/")!, settings: settings, scripts: scripts),
        ]
    }

    func controller(id: String) -> FeedController? { controllers.first { $0.id == id } }

    func pushSettings() { controllers.forEach { $0.pushSettings() } }
}
#endif
