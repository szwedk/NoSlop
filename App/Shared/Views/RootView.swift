import SwiftUI

enum AppSection: String, CaseIterable, Identifiable, Hashable {
    case home, sites, lists, controls, feeds, about
    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: return "Home"
        case .sites: return "Sites"
        case .lists: return "Lists"
        case .controls: return "Platform controls"
        case .feeds: return "Clean Feeds"
        case .about: return "About"
        }
    }

    var shortTitle: String {
        switch self {
        case .controls: return "Controls"
        case .feeds: return "Feeds"
        default: return title
        }
    }

    var symbol: String {
        switch self {
        case .home: return "house"
        case .sites: return "slider.horizontal.3"
        case .lists: return "list.bullet.rectangle"
        case .controls: return "wand.and.stars"
        case .feeds: return "rectangle.stack"
        case .about: return "info.circle"
        }
    }

    static var available: [AppSection] {
        #if NOSLOP_CLEAN_FEEDS
        return [.home, .sites, .lists, .controls, .feeds, .about]
        #else
        return [.home, .sites, .lists, .controls, .about]
        #endif
    }
}

struct RootView: View {
    /// Initial section; `-NoSlopInitialTab <id>` as a launch argument (simctl launch / scheme) selects a tab for screenshots and tests.
    @State private var selection: AppSection? = RootView.initialSection()

    private static func initialSection() -> AppSection {
        if let id = UserDefaults.standard.string(forKey: "NoSlopInitialTab"),
           let section = AppSection(rawValue: id), AppSection.available.contains(section) {
            return section
        }
        return .home
    }

    var body: some View {
        #if os(macOS)
        NavigationSplitView {
            List(AppSection.available, selection: $selection) { section in
                Label(section.title, systemImage: section.symbol).tag(section)
            }
            .navigationSplitViewColumnWidth(min: 180, ideal: 200)
            .listStyle(.sidebar)
        } detail: {
            sectionView(selection ?? .home)
        }
        #else
        TabView(selection: Binding(get: { selection ?? .home }, set: { selection = $0 })) {
            ForEach(AppSection.available) { section in
                NavigationStack {
                    sectionView(section)
                }
                .tabItem { Label(section.shortTitle, systemImage: section.symbol) }
                .tag(section)
            }
        }
        #endif
    }

    @ViewBuilder
    private func sectionView(_ section: AppSection) -> some View {
        switch section {
        case .home: HomeView()
        case .sites: SitesView()
        case .lists: ListsView()
        case .controls: PlatformControlsView()
        case .feeds:
            #if NOSLOP_CLEAN_FEEDS
            FeedsView()
            #else
            AboutView()
            #endif
        case .about: AboutView()
        }
    }
}
