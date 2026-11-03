import Foundation

/// Mirrors the DESIGN.md §6 Settings JSON (storage.local key `settings`, version 1).
/// Every field decodes with a default so an older/partial JSON never fails to load.
struct NoSlopSettings: Codable, Equatable {
    static let sites = ["youtube", "x", "instagram", "facebook", "tiktok", "reddit", "linkedin"]
    static let modes = ["strict", "balanced", "off"]

    struct SiteSettings: Codable, Equatable {
        var mode: String = "balanced"
        /// Reddit only (opt-in): treat the "App" automated-account label as a tier-0 AI label. Encoded only when set.
        var flagAppAccounts: Bool? = nil
        enum CodingKeys: String, CodingKey { case mode, flagAppAccounts }
        init(mode: String = "balanced", flagAppAccounts: Bool? = nil) { self.mode = mode; self.flagAppAccounts = flagAppAccounts }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            mode = try c.decodeIfPresent(String.self, forKey: .mode) ?? "balanced"
            flagAppAccounts = try c.decodeIfPresent(Bool.self, forKey: .flagAppAccounts)
        }
        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(mode, forKey: .mode)
            if let flagAppAccounts { try c.encode(flagAppAccounts, forKey: .flagAppAccounts) }
        }
    }

    struct Surfaces: Codable, Equatable {
        var hideShorts = false
        var hideReels = false
        var hideGrokPosts = true
        var hideTikTokForYou = false
        var hideAds = false
        var hideRedditRecommended = false
        init() {}
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            hideShorts = try c.decodeIfPresent(Bool.self, forKey: .hideShorts) ?? false
            hideReels = try c.decodeIfPresent(Bool.self, forKey: .hideReels) ?? false
            hideGrokPosts = try c.decodeIfPresent(Bool.self, forKey: .hideGrokPosts) ?? true
            hideTikTokForYou = try c.decodeIfPresent(Bool.self, forKey: .hideTikTokForYou) ?? false
            hideAds = try c.decodeIfPresent(Bool.self, forKey: .hideAds) ?? false
            hideRedditRecommended = try c.decodeIfPresent(Bool.self, forKey: .hideRedditRecommended) ?? false
        }
    }

    struct AutoPromote: Codable, Equatable {
        var enabled = true
        var hits = 3
        init() {}
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
            hits = try c.decodeIfPresent(Int.self, forKey: .hits) ?? 3
        }
    }

    var version = 1
    var enabled = true
    /// Milliseconds since 1970 (JS `Date.now()`), last-writer-wins across app and extension.
    var updatedAt: Double = 0
    var sites: [String: SiteSettings] = Dictionary(uniqueKeysWithValues: NoSlopSettings.sites.map { ($0, SiteSettings()) })
    var surfaces = Surfaces()
    var youtubePrefetch = true
    var youtubePrefetchConcurrency = 2
    /// Instagram: scroll to the next reel after hiding the active one on /reels/.
    var reelsAutoAdvance = true
    /// TikTok: inject lib/tiktok-main.js (page world) to read TikTok's own AIGC fields from feed JSON.
    var tiktokJsonRelay = true
    var showStubs = true
    var dimInsteadOfHide = false
    var blockedAccounts: [String: [String]] = Dictionary(uniqueKeysWithValues: NoSlopSettings.sites.map { ($0, []) })
    var allowedAccounts: [String: [String]] = Dictionary(uniqueKeysWithValues: NoSlopSettings.sites.map { ($0, []) })
    var customPhrases: [String] = []
    var customHashtags: [String] = []
    var autoPromote = AutoPromote()
    var rulesOverride: JSONValue? = nil

    enum CodingKeys: String, CodingKey {
        case version, enabled, updatedAt, sites, surfaces, youtubePrefetch, youtubePrefetchConcurrency
        case reelsAutoAdvance, tiktokJsonRelay
        case showStubs, dimInsteadOfHide, blockedAccounts, allowedAccounts, customPhrases, customHashtags
        case autoPromote, rulesOverride
    }

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = try c.decodeIfPresent(Int.self, forKey: .version) ?? 1
        enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
        updatedAt = try c.decodeIfPresent(Double.self, forKey: .updatedAt) ?? 0
        var decodedSites = try c.decodeIfPresent([String: SiteSettings].self, forKey: .sites) ?? [:]
        for s in NoSlopSettings.sites where decodedSites[s] == nil { decodedSites[s] = SiteSettings() }
        sites = decodedSites
        surfaces = try c.decodeIfPresent(Surfaces.self, forKey: .surfaces) ?? Surfaces()
        youtubePrefetch = try c.decodeIfPresent(Bool.self, forKey: .youtubePrefetch) ?? true
        youtubePrefetchConcurrency = try c.decodeIfPresent(Int.self, forKey: .youtubePrefetchConcurrency) ?? 2
        reelsAutoAdvance = try c.decodeIfPresent(Bool.self, forKey: .reelsAutoAdvance) ?? true
        tiktokJsonRelay = try c.decodeIfPresent(Bool.self, forKey: .tiktokJsonRelay) ?? true
        showStubs = try c.decodeIfPresent(Bool.self, forKey: .showStubs) ?? true
        dimInsteadOfHide = try c.decodeIfPresent(Bool.self, forKey: .dimInsteadOfHide) ?? false
        var blocked = try c.decodeIfPresent([String: [String]].self, forKey: .blockedAccounts) ?? [:]
        var allowed = try c.decodeIfPresent([String: [String]].self, forKey: .allowedAccounts) ?? [:]
        for s in NoSlopSettings.sites {
            if blocked[s] == nil { blocked[s] = [] }
            if allowed[s] == nil { allowed[s] = [] }
        }
        blockedAccounts = blocked
        allowedAccounts = allowed
        customPhrases = try c.decodeIfPresent([String].self, forKey: .customPhrases) ?? []
        customHashtags = try c.decodeIfPresent([String].self, forKey: .customHashtags) ?? []
        autoPromote = try c.decodeIfPresent(AutoPromote.self, forKey: .autoPromote) ?? AutoPromote()
        rulesOverride = try c.decodeIfPresent(JSONValue.self, forKey: .rulesOverride)
        if case .null? = rulesOverride { rulesOverride = nil }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(version, forKey: .version)
        try c.encode(enabled, forKey: .enabled)
        try c.encode(updatedAt, forKey: .updatedAt)
        try c.encode(sites, forKey: .sites)
        try c.encode(surfaces, forKey: .surfaces)
        try c.encode(youtubePrefetch, forKey: .youtubePrefetch)
        try c.encode(youtubePrefetchConcurrency, forKey: .youtubePrefetchConcurrency)
        try c.encode(reelsAutoAdvance, forKey: .reelsAutoAdvance)
        try c.encode(tiktokJsonRelay, forKey: .tiktokJsonRelay)
        try c.encode(showStubs, forKey: .showStubs)
        try c.encode(dimInsteadOfHide, forKey: .dimInsteadOfHide)
        try c.encode(blockedAccounts, forKey: .blockedAccounts)
        try c.encode(allowedAccounts, forKey: .allowedAccounts)
        try c.encode(customPhrases, forKey: .customPhrases)
        try c.encode(customHashtags, forKey: .customHashtags)
        try c.encode(autoPromote, forKey: .autoPromote)
        // Always present so the JS side sees the §6 shape exactly (`"rulesOverride": null`).
        try c.encode(rulesOverride ?? .null, forKey: .rulesOverride)
    }

    static func siteDisplayName(_ site: String) -> String {
        switch site {
        case "youtube": return "YouTube"
        case "x": return "X"
        case "instagram": return "Instagram"
        case "facebook": return "Facebook"
        case "tiktok": return "TikTok"
        case "reddit": return "Reddit"
        case "linkedin": return "LinkedIn"
        default: return site.capitalized
        }
    }

    static func modeDescription(_ mode: String) -> String {
        switch mode {
        case "strict": return "Hides at a lower score: platform AI labels, disclosures, AI hashtags, tool names and blocked accounts hide; style tells dim earlier."
        case "balanced": return "Hides only high-precision signals (platform labels, disclosures, blocked accounts); style heuristics only dim."
        case "off": return "Nothing is hidden or dimmed on this site."
        default: return ""
        }
    }
}

/// Minimal JSON value for free-form fields (`rulesOverride`).
enum JSONValue: Codable, Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else if let o = try? c.decode([String: JSONValue].self) { self = .object(o) }
        else { throw DecodingError.dataCorruptedError(in: c, debugDescription: "Unsupported JSON value") }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let n): try c.encode(n)
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }
}
