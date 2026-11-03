import Foundation
import Combine

/// Reads the App Group key `stats` written by the extension handler (§7) and the Clean Feeds host.
/// Shape: { "<YYYY-MM-DD>": { "<site>": { "hide": n, "dim": n, "reasons": { "<reason>": n } } } }
@MainActor
final class StatsStore: ObservableObject {
    struct Counts: Equatable {
        var hide = 0
        var dim = 0
        var total: Int { hide + dim }
    }

    struct SiteRow: Identifiable, Equatable {
        let site: String
        let counts: Counts
        var id: String { site }
    }

    @Published private(set) var today = Counts()
    @Published private(set) var week = Counts()
    @Published private(set) var weekBySite: [SiteRow] = []
    @Published private(set) var topReasons: [(reason: String, count: Int)] = []
    @Published private(set) var lastRefresh = Date.distantPast

    private var timer: AnyCancellable?

    init() {
        refresh()
        timer = Timer.publish(every: 15, on: .main, in: .common).autoconnect().sink { [weak self] _ in
            self?.refresh()
        }
    }

    func refresh() {
        let stats = NoSlopSharedStore.statsObject()
        let todayKey = NoSlopSharedStore.dayString(Date())
        let weekKeys = Set((0..<7).map { NoSlopSharedStore.dayString(Date(timeIntervalSinceNow: Double(-$0) * 86_400)) })

        var todayCounts = Counts()
        var weekCounts = Counts()
        var perSite: [String: Counts] = [:]
        var reasons: [String: Int] = [:]

        for (day, sitesAny) in stats {
            guard weekKeys.contains(day), let sites = sitesAny as? [String: Any] else { continue }
            for (site, countersAny) in sites {
                guard let counters = countersAny as? [String: Any] else { continue }
                let hide = (counters["hide"] as? NSNumber)?.intValue ?? 0
                let dim = (counters["dim"] as? NSNumber)?.intValue ?? 0
                weekCounts.hide += hide
                weekCounts.dim += dim
                var row = perSite[site] ?? Counts()
                row.hide += hide
                row.dim += dim
                perSite[site] = row
                if day == todayKey {
                    todayCounts.hide += hide
                    todayCounts.dim += dim
                }
                for (reason, nAny) in counters["reasons"] as? [String: Any] ?? [:] {
                    reasons[reason, default: 0] += (nAny as? NSNumber)?.intValue ?? 0
                }
            }
        }

        today = todayCounts
        week = weekCounts
        weekBySite = perSite.map { SiteRow(site: $0.key, counts: $0.value) }
            .sorted { ($0.counts.total, $0.site) > ($1.counts.total, $1.site) }
        topReasons = reasons.sorted { ($0.value, $0.key) > ($1.value, $1.key) }.prefix(8).map { ($0.key, $0.value) }
        lastRefresh = Date()
    }

    func clear() {
        NoSlopSharedStore.writeStats([:])
        refresh()
    }
}
