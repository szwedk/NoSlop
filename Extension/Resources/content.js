// NoSlop — content-script bootstrap. Loaded last (see manifest content_scripts[].js order):
// rules.js, lib/dom.js, lib/scorer.js, lib/host-extension.js, lib/engine.js, adapters/*.js, content.js
// Picks the first registered adapter whose matches(location) is true and starts the engine.
(function () {
  'use strict';
  const NS = globalThis.NoSlop;
  if (!NS || !NS.engine || !NS.adapters || !NS.host) return;
  try { if (globalThis.top && globalThis.top !== globalThis) return; } catch (_) { /* cross-origin frame: run anyway */ }
  if (globalThis.__noslopStarted) return;
  globalThis.__noslopStarted = true;
  const adapter = NS.adapters.pick(globalThis.location);
  if (!adapter) return;
  NS.engine.start({ adapter, rules: NS.rules, host: NS.host }).catch((e) => {
    try { console.warn('[NoSlop] engine failed to start:', e && e.message ? e.message : e); } catch (_) { /* ignore */ }
  });
})();
