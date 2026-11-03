import SwiftUI

@main
struct NoSlopApp: App {
    @StateObject private var settings = SettingsStore()
    @StateObject private var stats = StatsStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(settings)
                .environmentObject(stats)
                // noslop://open from the extension popup: the system already brought us forward; refresh what we show.
                .onOpenURL { url in
                    guard url.scheme == "noslop" else { return }
                    settings.reload()
                    stats.refresh()
                    #if os(macOS)
                    NSApplication.shared.activate(ignoringOtherApps: true)
                    #endif
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active {
                        settings.reload()
                        stats.refresh()
                    }
                }
        }
        #if os(macOS)
        .defaultSize(width: 900, height: 640)
        #endif
    }
}
