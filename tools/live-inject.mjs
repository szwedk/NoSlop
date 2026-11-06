#!/usr/bin/env node
// NoSlop — live-smoke injector (docs/DESIGN.md §10 "live smoke").
//
// Builds ONE injectable bundle out of the real content-script chain so the engine + adapters can be
// exercised on a REAL page (youtube.com, m.youtube.com, reddit.com, tiktok.com, …) from a browser's
// JavaScript console / CDP without installing the extension. Nothing here is loaded by the extension.
//
//   node tools/live-inject.mjs                    -> $TMPDIR/noslop-live.js (+ noslop-live.part-NN.js chunks)
//   node tools/live-inject.mjs --out FILE         -> write the bundle elsewhere
//   node tools/live-inject.mjs --serve [PORT]     -> also serve the bundle on http://127.0.0.1:PORT/noslop-live.js
//                                                   with `Access-Control-Allow-Origin: *` so a page can
//                                                   `fetch(...).then(r => r.text()).then(eval)` it
//   node tools/live-inject.mjs --print-loader     -> prints the one-liner to paste in the page console
//
// Bundle layout (manifest content_scripts[].js order, read from Extension/Resources/manifest.json so a
// reordered manifest is reflected automatically):
//   rules.js, lib/dom.js, lib/scorer.js, lib/host-extension.js, <STUB HOST>, lib/engine.js, adapters/*.js, content.js
// lib/host-extension.js is kept (it defines NoSlop.defaultSettings / migrateSettings that the engine and
// the stub host reuse; on a plain page it builds its own in-memory host, which the STUB HOST then
// replaces). content.css is injected as a <style data-noslop-live-css> element before the scripts run.
//
// The STUB HOST (docs/DESIGN.md §6 surface) is in-memory: settings = defaultSettings() with
// youtubePrefetch: true; fetchText(url) uses window.fetch with credentials 'same-origin'. The real
// extension fetches through background.js (no CORS); in the live harness a cross-origin URL (e.g.
// m.youtube.com asking for https://www.youtube.com/watch?v=…) is retried with the host rewritten to
// location.host when both are on the same registrable domain — a HARNESS-ONLY workaround, logged in
// NoSlop.host.__fetchLog[].rewritten so the report can tell the two apart.
//
// Collector: NoSlop.live.collect() -> { url, site, surface, processed, hidden, dimmed, none, reasons,
// hiddenTitles[], dimmedTitles[], stubs, surfacesHidden, fetches, errors } — read it 8 s after injection.
// NoSlop.live.errors[] captures window 'error' / 'unhandledrejection' events whose stack mentions NoSlop.
//
// Plain ESM Node script (Node 20+), no dependencies.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RESOURCES = path.join(ROOT, 'Extension/Resources');
export const DEFAULT_OUT = path.join(os.tmpdir(), 'noslop-live.js');
export const DEFAULT_PORT = 8765;
export const HOST_FILE = 'lib/host-extension.js';
export const CHUNK_LIMIT = 90 * 1024; // bytes per part file (a part never splits a script; a big script is its own part)

// ----------------------------------------------------------------------------- pieces
export function manifestScripts(resources = RESOURCES) {
  const m = JSON.parse(fs.readFileSync(path.join(resources, 'manifest.json'), 'utf8'));
  const cs = (m.content_scripts || [])[0];
  if (!cs || !Array.isArray(cs.js) || !cs.js.length) throw new Error('manifest has no content_scripts[0].js');
  return { js: cs.js.slice(), css: (cs.css || []).slice() };
}

function banner(label) {
  return `\n/* ======================= noslop-live: ${label} ======================= */\n`;
}

/** The <style> injection for content.css (kept out of the page's own stylesheet order on purpose). */
export function cssInjector(cssText) {
  return `${banner('content.css')}(function () {
  try {
    if (document.querySelector('style[data-noslop-live-css]')) return;
    var s = document.createElement('style');
    s.setAttribute('data-noslop-live-css', '1');
    s.textContent = ${JSON.stringify(cssText)};
    (document.head || document.documentElement).appendChild(s);
  } catch (e) { console.warn('[noslop-live] css inject failed', e); }
})();
`;
}

/** Live-harness preamble: error capture + a marker so a second injection is a no-op. */
export function preamble() {
  return `${banner('preamble')}(function () {
  if (globalThis.__noslopLiveInjected) { console.warn('[noslop-live] already injected on this page'); throw new Error('noslop-live: already injected'); }
  globalThis.__noslopLiveInjected = true;
  var NS = (globalThis.NoSlop = globalThis.NoSlop || {});
  NS.live = NS.live || {};
  NS.live.errors = [];
  NS.live.injectedAt = Date.now();
  var push = function (kind, msg, stack) { NS.live.errors.push({ kind: kind, message: String(msg), stack: String(stack || '').slice(0, 800), ts: Date.now() }); };
  globalThis.addEventListener('error', function (ev) {
    var st = (ev.error && ev.error.stack) || '';
    if (/noslop|NoSlop/i.test(st + ' ' + (ev.message || ''))) push('error', ev.message, st);
  });
  globalThis.addEventListener('unhandledrejection', function (ev) {
    var r = ev.reason; var st = (r && r.stack) || '';
    if (/noslop|NoSlop/i.test(st + ' ' + (r && r.message))) push('unhandledrejection', (r && r.message) || r, st);
  });
  // Any adapter / engine 'log(...)' goes through console.warn; mirror warnings that mention NoSlop.
  var origWarn = console.warn;
  console.warn = function () {
    try { var s = Array.prototype.map.call(arguments, function (a) { return (a && a.message) ? a.message : String(a); }).join(' '); if (/noslop/i.test(s)) push('warn', s, (arguments[1] && arguments[1].stack) || ''); } catch (_) {}
    return origWarn.apply(console, arguments);
  };
})();
`;
}

/** The STUB HOST (docs/DESIGN.md §6). Replaces whatever lib/host-extension.js built. */
export function stubHost() {
  return `${banner('STUB HOST (live harness, in-memory; NOT part of the extension)')}(function () {
  'use strict';
  var NS = (globalThis.NoSlop = globalThis.NoSlop || {});
  if (typeof NS.defaultSettings !== 'function' || typeof NS.migrateSettings !== 'function') {
    throw new Error('noslop-live: lib/host-extension.js must load before the stub host (defaultSettings/migrateSettings missing)');
  }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  var settings = NS.defaultSettings();
  settings.youtubePrefetch = true;           // task: watch-HTML prefetch ON so card hides can arrive via enrich
  settings.youtubePrefetchConcurrency = 2;
  var store = new Map();
  var listeners = new Set();
  var reports = [];
  var fetchLog = [];

  function sameSite(a, b) {
    var ra = a.split('.').slice(-2).join('.'), rb = b.split('.').slice(-2).join('.');
    return ra === rb;
  }
  function doFetch(url, timeout) {
    var ctl = (typeof AbortController === 'function') ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, timeout) : null;
    return fetch(url, { credentials: 'same-origin', signal: ctl ? ctl.signal : undefined, cache: 'no-store' })
      .then(function (r) { if (t) clearTimeout(t); return r.text().then(function (txt) { return { status: r.status, text: txt }; }); },
            function (e) { if (t) clearTimeout(t); throw e; });
  }

  var host = {
    __memory: true, __live: true, __reports: reports, __store: store, __fetchLog: fetchLog,
    getSettings: function () { return Promise.resolve(clone(settings)); },
    onSettingsChanged: function (cb) { listeners.add(cb); return function () { listeners.delete(cb); }; },
    patchSettings: function (partial) {
      settings = NS.migrateSettings(Object.assign({}, settings, partial || {}, { updatedAt: Date.now() }));
      var snap = clone(settings);
      listeners.forEach(function (cb) { try { cb(clone(snap)); } catch (e) { /* ignore */ } });
      return Promise.resolve(snap);
    },
    __setSettings: function (s) { return host.patchSettings(s); },
    storageGet: function (keys) {
      var out = {};
      var list = keys == null ? Array.from(store.keys()) : Array.isArray(keys) ? keys : typeof keys === 'object' ? Object.keys(keys) : [keys];
      list.forEach(function (k) { if (store.has(k)) out[k] = clone(store.get(k)); });
      return Promise.resolve(out);
    },
    storageSet: function (obj) { Object.keys(obj || {}).forEach(function (k) { store.set(k, clone(obj[k])); }); return Promise.resolve(); },
    storageRemove: function (keys) { (Array.isArray(keys) ? keys : [keys]).forEach(function (k) { store.delete(k); }); return Promise.resolve(); },
    // window.fetch, same-origin credentials. Cross-origin same-site URLs are retried on location.host (harness only).
    fetchText: function (url, opts) {
      var timeout = (opts && opts.timeout) || 10000;
      var started = Date.now();
      var row = { url: String(url), status: null, bytes: 0, ms: 0, rewritten: null, error: null };
      fetchLog.push(row);
      var u; try { u = new URL(String(url), location.href); } catch (e) { row.error = 'bad url'; return Promise.reject(e); }
      var attempt = function (href) {
        return doFetch(href, timeout).then(function (r) {
          row.status = r.status; row.bytes = r.text.length; row.ms = Date.now() - started;
          if (r.status >= 400) throw new Error('HTTP ' + r.status);
          return r.text;
        });
      };
      var p = attempt(u.href);
      if (u.host !== location.host && sameSite(u.hostname, location.hostname)) {
        p = p.catch(function (e) {
          var v = new URL(u.href); v.host = location.host;
          row.rewritten = v.href; row.error = 'first attempt: ' + (e && e.message);
          return attempt(v.href);
        });
      }
      return p.catch(function (e) { row.error = (row.error ? row.error + '; ' : '') + (e && e.message ? e.message : String(e)); row.ms = Date.now() - started; throw e; });
    },
    report: function (event) { reports.push(Object.assign({ ts: Date.now() }, event || {})); },
    flush: function () { return Promise.resolve(); }
  };
  NS.host = host;
})();
`;
}

/** NoSlop.live.collect(): counts, reasons histogram, hidden titles, fetch log — the report's raw numbers. */
export function collector() {
  return `${banner('collector (live harness)')}(function () {
  var NS = (globalThis.NoSlop = globalThis.NoSlop || {});
  NS.live = NS.live || {};
  function titleOf(el, st) {
    var it = st && st.item;
    var t = (it && (it.title || it.text)) || '';
    if (!t) { try { t = (el.getAttribute('post-title') || el.querySelector('#video-title, h3, [post-title], a[title]') && (el.querySelector('#video-title, h3, a[title]') || {}).textContent) || ''; } catch (_) {} }
    return String(t).replace(/\\s+/g, ' ').trim().slice(0, 140);
  }
  NS.live.collect = function () {
    var eng = NS.engine, E = eng && eng._E;
    var out = { url: location.href, site: eng && eng.site, surface: eng && eng.surface, running: !!(eng && eng.running),
      processed: 0, hidden: 0, dimmed: 0, none: 0, reasons: {}, reasonsByAction: { hide: {}, dim: {} },
      hiddenTitles: [], dimmedTitles: [], stubs: 0, stubTexts: [], surfacesHidden: 0,
      cacheSize: E && E.cache ? E.cache.size : null, enrichQueue: E && E.queue ? E.queue.length : null, enrichInflight: E && E.inflight ? E.inflight.size : null,
      fetches: (NS.host && NS.host.__fetchLog) || [], reports: (NS.host && NS.host.__reports) || [], errors: NS.live.errors || [], kinds: {}, authorsHidden: {} };
    var els = document.querySelectorAll('[data-noslop-id]');
    out.processed = els.length;
    els.forEach(function (el) {
      var st = eng && eng.stateOf ? eng.stateOf(el) : null;
      var v = st && st.verdict; var action = (v && v.action) || (el.classList.contains('noslop-hidden') ? 'hide' : el.classList.contains('noslop-dim') ? 'dim' : 'none');
      var kind = (st && st.item && st.item.kind) || '?'; out.kinds[kind] = (out.kinds[kind] || 0) + 1;
      if (action === 'hide') out.hidden++; else if (action === 'dim') out.dimmed++; else out.none++;
      if (v && action !== 'none') {
        (v.reasons || []).forEach(function (r) { out.reasons[r] = (out.reasons[r] || 0) + 1; out.reasonsByAction[action][r] = (out.reasonsByAction[action][r] || 0) + 1; });
        var row = { id: st && st.id, title: titleOf(el, st), score: v.score, reasons: v.reasons, author: st && st.item && st.item.author, kind: kind };
        (action === 'hide' ? out.hiddenTitles : out.dimmedTitles).push(row);
        if (action === 'hide' && row.author) { var a = row.author.handle || row.author.name || row.author.id; if (a) out.authorsHidden[a] = (out.authorsHidden[a] || 0) + 1; }
      }
    });
    var stubs = document.querySelectorAll('.noslop-stub');
    out.stubs = stubs.length;
    stubs.forEach(function (s) { out.stubTexts.push(s.textContent.replace(/\\s+/g, ' ').trim()); });
    out.surfacesHidden = document.querySelectorAll('.noslop-surface').length;
    return out;
  };
})();
`;
}

// ----------------------------------------------------------------------------- build
export function buildBundle({ resources = RESOURCES } = {}) {
  const { js, css } = manifestScripts(resources);
  const read = (rel) => fs.readFileSync(path.join(resources, ...rel.split('/')), 'utf8');
  const parts = [];
  parts.push({ name: 'preamble', code: preamble() });
  for (const rel of css) parts.push({ name: rel, code: cssInjector(read(rel)) });
  for (const rel of js) {
    parts.push({ name: rel, code: banner(rel) + read(rel) + '\n' });
    if (rel === HOST_FILE) parts.push({ name: 'stub-host', code: stubHost() });
    if (rel === 'lib/engine.js') parts.push({ name: 'collector', code: collector() });
  }
  if (!parts.some((p) => p.name === 'stub-host')) throw new Error(`${HOST_FILE} is not in the manifest; the stub host has nowhere to go`);
  const bundle = `// GENERATED by tools/live-inject.mjs — NoSlop live-smoke bundle (NOT shipped). ${new Date().toISOString()}\n` +
    parts.map((p) => p.code).join('\n');
  // Each part is a complete classic script (IIFE attaching to globalThis.NoSlop); parts are grouped so no file
  // is split. Evaluate the parts in order when a console/CDP tool caps the payload size.
  const chunks = [];
  let cur = [], size = 0;
  for (const p of parts) {
    if (cur.length && size + p.code.length > CHUNK_LIMIT) { chunks.push(cur); cur = []; size = 0; }
    cur.push(p); size += p.code.length;
  }
  if (cur.length) chunks.push(cur);
  return { bundle, parts, chunks: chunks.map((c) => ({ names: c.map((p) => p.name), code: c.map((p) => p.code).join('\n') })), scripts: js, css };
}

export function writeBundle(out = DEFAULT_OUT, opts = {}) {
  const r = buildBundle(opts);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, r.bundle);
  const base = out.replace(/\.js$/, '');
  const files = [out];
  // clear stale parts
  for (const f of fs.readdirSync(path.dirname(out))) if (f.startsWith(path.basename(base) + '.part-')) fs.unlinkSync(path.join(path.dirname(out), f));
  r.chunks.forEach((c, i) => { const f = `${base}.part-${String(i + 1).padStart(2, '0')}.js`; fs.writeFileSync(f, `// noslop-live part ${i + 1}/${r.chunks.length}: ${c.names.join(', ')}\n${c.code}`); files.push(f); });
  // syntax check with the real parser (classic script semantics)
  new Function(r.bundle); // throws on a syntax error
  return Object.assign(r, { out, files });
}

/** Console/CDP one-liner. Sites with `require-trusted-types-for 'script'` (youtube.com) reject a bare eval(string);
 *  a Trusted Types policy (createScript) is created when the API exists — CSP there has no trusted-types name list. */
export function loaderSnippet(port = DEFAULT_PORT) {
  return `const __src = await fetch('http://127.0.0.1:${port}/noslop-live.js', { cache: 'no-store' }).then(r => r.text()); ` +
    `const __tt = (globalThis.trustedTypes && trustedTypes.createPolicy) ? trustedTypes.createPolicy('noslop-live-' + Date.now(), { createScript: (s) => s }) : null; ` +
    `(0, eval)(__tt ? __tt.createScript(__src) : __src); NoSlop.live.collect().site`;
}

// Transport for pages where a direct fetch of 127.0.0.1 is refused (Chrome Local Network Access): the bundle
// text crosses origins through window.postMessage. Three modes: the target page window.open()s
// http://127.0.0.1:PORT/relay.html from a real click (opener mode — the one that works on youtube.com, where
// LNA also blanks a localhost <iframe>), the relay sits in an <iframe> inside the target, or the relay tab
// window.open()s the target (button). The target page first installs the receiver (`receiverSnippet()`).
export const RELAY_HTML = `<!doctype html><meta charset="utf-8"><title>noslop-live relay</title>
<body style="font:14px system-ui;padding:12px">
<p id="s">noslop-live relay</p>
<p><input id="t" size="80" placeholder="target url (window.open mode)"> <button id="b">Open target + send</button></p>
<script>
(async () => {
  const s = document.getElementById('s');
  const src = await fetch('/noslop-live.js', { cache: 'no-store' }).then((r) => r.text());
  s.textContent = 'bundle: ' + src.length + ' bytes';
  const msg = { noslopLive: src, len: src.length };
  const send = (w, origin) => { try { w.postMessage(msg, origin || '*'); } catch (e) { s.textContent += ' send failed: ' + e; } };
  if (window.opener) { // opener mode: the target page window.open()ed this relay (a click there = user activation)
    let n = 0; const t = setInterval(() => { send(window.opener); if (++n > 60) clearInterval(t); }, 500);
    window.addEventListener('message', (ev) => { if (ev.data && ev.data.noslopAck) { clearInterval(t); s.textContent += ' delivered'; setTimeout(() => window.close(), 300); } });
  }
  if (window.parent && window.parent !== window) { // iframe mode: post to the parent until it acks
    let n = 0; const t = setInterval(() => { send(window.parent); if (++n > 30) clearInterval(t); }, 500);
    window.addEventListener('message', (ev) => { if (ev.data && ev.data.noslopAck) { clearInterval(t); s.textContent += ' delivered'; } });
  }
  const q = new URLSearchParams(location.search); if (q.get('target')) document.getElementById('t').value = q.get('target');
  if (q.get('mode') === 'hash' && q.get('target')) { // hash mode: forward this tab to the target with the bundle in the URL fragment
    const bytes = new TextEncoder().encode(src); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    const b64 = btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
    s.textContent += ' -> forwarding ' + b64.length + ' chars in #noslop=';
    location.assign(q.get('target') + '#noslop=' + b64);
  }
  document.getElementById('b').onclick = () => {
    const url = document.getElementById('t').value; const w = window.open(url, 'noslop-target');
    if (!w) { s.textContent += ' popup blocked'; return; }
    let n = 0; const t = setInterval(() => { send(w); if (++n > 120) clearInterval(t); }, 500);
    window.addEventListener('message', (ev) => { if (ev.data && ev.data.noslopAck) { clearInterval(t); s.textContent += ' delivered'; } });
  };
})();
</script>`;

/** Paste this (small) snippet into the TARGET page first; it stores the bundle text posted by relay.html. */
export function receiverSnippet(port = DEFAULT_PORT) {
  return "window.__noslopSrc = null; window.addEventListener('message', (ev) => { const d = ev.data; if (d && typeof d.noslopLive === 'string') { window.__noslopSrc = d.noslopLive; try { ev.source.postMessage({ noslopAck: true }, '*'); } catch (_) {} } });" +
    " (function(){ let b = document.getElementById('noslop-launch'); if (!b) { b = document.createElement('button'); b.id = 'noslop-launch'; b.textContent = 'noslop relay'; b.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647;font:16px system-ui;padding:8px 14px;background:#ff0;color:#000;border:2px solid #000'; document.body.appendChild(b); }" +
    " b.onclick = () => { window.open('http://127.0.0.1:" + port + "/relay.html', 'noslop-relay', 'popup,width=420,height=160'); }; })();";
}

/** Hash mode (the transport that works in a CDP-driven browser on youtube.com): navigate the tab to
 *  http://127.0.0.1:PORT/relay.html?mode=hash&target=<encoded target url>; the relay forwards to the target with
 *  #noslop=<url-safe base64 of the bundle>. Then run this in the target page: it decodes the fragment (from
 *  location.hash, or the navigation entry if the SPA already rewrote the URL), evals via Trusted Types, cleans the URL. */
export function hashUrl(target, port = DEFAULT_PORT) {
  return `http://127.0.0.1:${port}/relay.html?mode=hash&target=${encodeURIComponent(target)}`;
}
export function hashEvalSnippet() {
  return "const __nav = performance.getEntriesByType('navigation')[0]; const __m = /#noslop=([A-Za-z0-9_-]+)/.exec(location.hash) || /#noslop=([A-Za-z0-9_-]+)/.exec((__nav && __nav.name) || ''); if (!__m) throw new Error('no #noslop fragment'); " +
    "const __b64 = __m[1].replace(/-/g, '+').replace(/_/g, '/'); const __bin = atob(__b64 + '='.repeat((4 - __b64.length % 4) % 4)); const __bytes = Uint8Array.from(__bin, (c) => c.charCodeAt(0)); const __src = new TextDecoder().decode(__bytes); " +
    "const __tt = (globalThis.trustedTypes && trustedTypes.createPolicy) ? trustedTypes.createPolicy('noslop-live-' + Date.now(), { createScript: (s) => s }) : null; (0, eval)(__tt ? __tt.createScript(__src) : __src); " +
    "try { if (/#noslop=/.test(location.hash)) history.replaceState(history.state, '', location.pathname + location.search); } catch (_) {} ({ bytes: __src.length, site: NoSlop.engine.site, running: NoSlop.engine.running, live: NoSlop.host.__live })";
}

/** Once window.__noslopSrc holds the bundle: eval it through a Trusted Types policy (youtube.com needs one). */
export function evalSnippet() {
  return "const __src = window.__noslopSrc; if (!__src) throw new Error('bundle not received yet'); const __tt = (globalThis.trustedTypes && trustedTypes.createPolicy) ? trustedTypes.createPolicy('noslop-live-' + Date.now(), { createScript: (s) => s }) : null; (0, eval)(__tt ? __tt.createScript(__src) : __src); const __b = document.getElementById('noslop-launch'); if (__b) __b.remove(); ({ bytes: __src.length, site: NoSlop.engine.site, running: NoSlop.engine.running })";
}

export function serve(out, port = DEFAULT_PORT) {
  const dir = path.dirname(out);
  // CORS * plus Chrome Private Network Access: a public https page fetching 127.0.0.1 sends a preflight with
  // Access-Control-Request-Private-Network and needs Access-Control-Allow-Private-Network: true back.
  const cors = {
    'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '600', 'Cache-Control': 'no-store'
  };
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    const name = path.basename(new URL(req.url, 'http://x').pathname);
    if (name === 'relay.html') { res.writeHead(200, Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, cors)); res.end(RELAY_HTML); return; }
    const file = path.join(dir, name);
    if (!name.startsWith('noslop-live') || !fs.existsSync(file)) { res.writeHead(404, cors); res.end('not found'); return; }
    res.writeHead(200, Object.assign({ 'Content-Type': 'application/javascript; charset=utf-8' }, cors));
    fs.createReadStream(file).pipe(res);
  });
  server.listen(port, '127.0.0.1');
  return server;
}

// ----------------------------------------------------------------------------- CLI
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  let out = DEFAULT_OUT, doServe = false, port = DEFAULT_PORT, printLoader = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') out = path.resolve(argv[++i]);
    else if (a === '--serve') { doServe = true; if (argv[i + 1] && /^\d+$/.test(argv[i + 1])) port = Number(argv[++i]); }
    else if (a === '--print-loader') printLoader = true;
    else if (a === '--help' || a === '-h') { console.log('usage: node tools/live-inject.mjs [--out FILE] [--serve [PORT]] [--print-loader]'); process.exit(0); }
    else { console.error(`unknown argument: ${a}`); process.exit(2); }
  }
  try {
    const r = writeBundle(out);
    console.log(`[live-inject] bundle: ${out} (${(r.bundle.length / 1024).toFixed(0)} KB) — scripts: ${r.scripts.join(', ')} + stub host + collector; css: ${r.css.join(', ')}`);
    console.log(`[live-inject] parts: ${r.files.slice(1).map((f) => path.basename(f)).join(', ')}`);
    if (printLoader || doServe) {
      console.log(`[live-inject] page loader (direct fetch; refused on youtube.com by Chrome LNA):\n  ${loaderSnippet(port)}`);
      console.log(`[live-inject] relay receiver (paste in the target page, then click the yellow button):\n  ${receiverSnippet(port)}`);
      console.log(`[live-inject] relay eval (after the popup says delivered):\n  ${evalSnippet()}`);
      console.log(`[live-inject] HASH MODE (works in a CDP-driven browser): navigate to\n  ${hashUrl('https://www.youtube.com/results?search_query=made+with+veo+3+ai+generated', port)}\n  then run in the page:\n  ${hashEvalSnippet()}`);
    }
    if (doServe) {
      serve(out, port);
      console.log(`[live-inject] serving ${path.dirname(out)}/noslop-live*.js on http://127.0.0.1:${port}/ (CORS *) — Ctrl-C to stop`);
    }
  } catch (e) {
    console.error(`[live-inject] FAILED: ${e.message}`);
    process.exit(1);
  }
}
