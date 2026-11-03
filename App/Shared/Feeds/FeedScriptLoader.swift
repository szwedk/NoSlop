#if NOSLOP_CLEAN_FEEDS
import Foundation
import WebKit

/// Builds the WKUserScripts for a Clean Feeds webview from the bundled WebExtension folder.
/// Order (DESIGN.md §8): host-webview.js, rules.js, lib/dom.js, lib/scorer.js, lib/engine.js, adapters/*.js, content.js,
/// then content.css as a <style> tag. Missing files are skipped (other agents' files may not exist yet).
struct FeedScriptBundle {
    struct Entry: Identifiable {
        let path: String
        let found: Bool
        var id: String { path }
    }

    let scripts: [WKUserScript]
    let entries: [Entry]
    var loadedCount: Int { entries.filter(\.found).count }
    var missing: [String] { entries.filter { !$0.found }.map(\.path) }

    static func load() -> FeedScriptBundle {
        guard let root = RulesLoader.webExtensionFolder else {
            return FeedScriptBundle(scripts: [], entries: [Entry(path: "WebExtension/", found: false)])
        }
        let fm = FileManager.default
        var order = ["lib/host-webview.js", "rules.js", "lib/dom.js", "lib/scorer.js", "lib/engine.js"]
        let adaptersDir = root.appendingPathComponent("adapters")
        if let names = try? fm.contentsOfDirectory(atPath: adaptersDir.path) {
            order += names.filter { $0.hasSuffix(".js") }.sorted().map { "adapters/" + $0 }
        } else {
            order.append("adapters/*.js")
        }
        order.append("content.js")

        var scripts: [WKUserScript] = []
        var entries: [Entry] = []
        for rel in order {
            let url = root.appendingPathComponent(rel)
            guard rel.hasSuffix(".js"), !rel.contains("*"), let source = try? String(contentsOf: url, encoding: .utf8) else {
                entries.append(Entry(path: rel, found: false))
                continue
            }
            // Each WKUserScript is evaluated separately, so a failure in one does not stop the next;
            // the source is injected unwrapped to keep top-level let/const/function scoping intact.
            let tagged = source + "\n//# sourceURL=noslop/\(rel)\n"
            scripts.append(WKUserScript(source: tagged, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .defaultClient))
            entries.append(Entry(path: rel, found: true))
        }

        let cssURL = root.appendingPathComponent("content.css")
        if let css = try? String(contentsOf: cssURL, encoding: .utf8),
           let encoded = try? JSONSerialization.data(withJSONObject: [css]),
           let literal = String(data: encoded, encoding: .utf8) {
            // literal is a JSON array with one string; index [0] yields a safe JS string literal.
            let src = """
            (function () {
              var css = \(literal)[0];
              function add() {
                var s = document.createElement('style');
                s.id = 'noslop-content-css';
                s.textContent = css;
                (document.head || document.documentElement).appendChild(s);
              }
              if (document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add);
            })();
            """
            scripts.append(WKUserScript(source: src, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .defaultClient))
            entries.append(Entry(path: "content.css", found: true))
        } else {
            entries.append(Entry(path: "content.css", found: false))
        }
        return FeedScriptBundle(scripts: scripts, entries: entries)
    }
}
#endif
