#if NOSLOP_CLEAN_FEEDS
import SwiftUI
import WebKit

/// All feed webviews share the persistent default data store so logins survive between tabs and launches.
/// (They also share one web-content process pool automatically: since iOS 15 / macOS 12 WebKit keys the
/// pool on the data store and `WKProcessPool` is deprecated, so no explicit pool is created here.)
enum FeedWebKit {
    // Mobile Safari UA so instagram.com / x.com / m.youtube.com serve their mobile DOM on iPhone (the adapters' mobile selectors).
    static let mobileUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

    static func makeWebView(host: FeedHost, scripts: [WKUserScript]) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.applicationNameForUserAgent = "NoSlop"
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        #if os(iOS)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        #endif
        let ucc = WKUserContentController()
        ucc.addScriptMessageHandler(host, contentWorld: .defaultClient, name: FeedHost.handlerName)
        scripts.forEach { ucc.addUserScript($0) }
        config.userContentController = ucc
        let webView = WKWebView(frame: .zero, configuration: config)
        #if os(iOS)
        webView.customUserAgent = mobileUserAgent
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        #endif
        return webView
    }
}

/// Controls one feed webview: owns the WKWebView, pushes settings into the page, exposes navigation state.
@MainActor
final class FeedController: ObservableObject, Identifiable {
    let id: String
    let title: String
    let url: URL
    let webView: WKWebView
    private let host: FeedHost
    private let settings: SettingsStore

    init(id: String, title: String, url: URL, settings: SettingsStore, scripts: [WKUserScript]) {
        self.id = id
        self.title = title
        self.url = url
        self.settings = settings
        self.host = FeedHost(settings: settings)
        self.webView = FeedWebKit.makeWebView(host: host, scripts: scripts)
    }

    func loadIfNeeded() {
        if webView.url == nil { webView.load(URLRequest(url: url)) }
    }

    func reload() {
        if webView.url == nil { loadIfNeeded() } else { webView.reload() }
    }

    func goHome() { webView.load(URLRequest(url: url)) }

    /// Called whenever the SettingsStore persists a change: `NoSlop.host._emitSettings(json)` (host-webview.js).
    func pushSettings() {
        let json = settings.currentJSONString()
        let js = "if (globalThis.NoSlop && NoSlop.host && NoSlop.host._emitSettings) { NoSlop.host._emitSettings(\(json)); }"
        webView.evaluateJavaScript(js, in: nil, in: .defaultClient) { _ in }
    }
}

#if os(iOS)
struct FeedWebViewRepresentable: UIViewRepresentable {
    let controller: FeedController
    func makeUIView(context: Context) -> WKWebView { controller.webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
#else
struct FeedWebViewRepresentable: NSViewRepresentable {
    let controller: FeedController
    func makeNSView(context: Context) -> WKWebView { controller.webView }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
#endif
#endif
