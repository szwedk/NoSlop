// Startup smoke test: the FULL content-script chain from manifest.json (rules.js, lib/*, every adapter, content.js)
// is loaded in jsdom for each supported hostname exactly as Safari/Chrome would (classic scripts, document_start,
// a fake `browser` runtime). Any ReferenceError / TypeError at load or during the first engine pass fails here.
// Also covers: the Clean Feeds webview order (host-webview.js first, no host-extension.js), the popup's two
// content-script messages, and background.js inside a service-worker-like global (no window/document).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { loadScripts, makeFakeBrowser, RESOURCES, settle } from './helpers/load.mjs';

const manifest = JSON.parse(fs.readFileSync(path.join(RESOURCES, 'manifest.json'), 'utf8'));
const CHAIN = manifest.content_scripts[0].js;

// hostname -> [expected adapter site, a page path]. All eight hostnames the task names, incl. m.youtube.com + twitter.com.
const HOSTS = [
  ['www.youtube.com', 'youtube', '/'],
  ['m.youtube.com', 'youtube', '/'],
  ['x.com', 'x', '/home'],
  ['twitter.com', 'x', '/home'],
  ['www.instagram.com', 'instagram', '/'],
  ['www.facebook.com', 'facebook', '/'],
  ['www.tiktok.com', 'tiktok', '/foryou'],
  ['www.reddit.com', 'reddit', '/'],
  ['www.linkedin.com', 'linkedin', '/feed/']
];

/** Collect uncaught errors + console.error/warn lines from the window so a silent failure is still visible. */
function errorTrap(window) {
  const errors = [];
  window.addEventListener('error', (ev) => errors.push(String(ev.error || ev.message)));
  window.addEventListener('unhandledrejection', (ev) => errors.push('unhandledrejection: ' + String(ev.reason)));
  const origWarn = window.console.warn, origError = window.console.error;
  window.console.warn = (...a) => { errors.push('console.warn: ' + a.join(' ')); origWarn.apply(window.console, a); };
  window.console.error = (...a) => { errors.push('console.error: ' + a.join(' ')); origError.apply(window.console, a); };
  return errors;
}

describe('content-script chain boots on every supported host (extension runtime)', () => {
  for (const [host, site, pathname] of HOSTS) {
    test(`${host}: no ReferenceError at load, adapter ${site} picked, engine running, first pass + navigation + settings change survive`, async () => {
      const url = `https://${host}${pathname}`;
      // A page shell that is NOT a logged-in feed: adapters must gate and return [] without throwing.
      const html = '<!doctype html><html lang="en"><head><title>t</title></head><body><div id="app"><main role="main"><p>hello</p></main></div></body></html>';
      const browser = makeFakeBrowser({ senderUrl: url });
      const ctx = await loadScripts(CHAIN, { url, html, browser });
      const { window, NoSlop } = ctx;
      const errors = errorTrap(window);
      assert.ok(window.__noslopStarted, 'content.js started the engine');
      await settle(4);
      assert.equal(NoSlop.engine.running, true, 'engine running');
      assert.equal(NoSlop.engine.site, site);
      assert.equal(typeof NoSlop.engine.surface, 'string');
      // the engine ran at least one pass over the (empty) feed without throwing
      assert.equal(typeof NoSlop.engine.processNow(window.document.body), 'number');
      // SPA navigation + a settings change re-run the pipeline
      window.history.pushState({}, '', pathname === '/' ? '/explore' : '/');
      await settle(4);
      await NoSlop.host.patchSettings({ surfaces: Object.assign({}, NoSlop.defaultSettings().surfaces, { hideShorts: true, hideReels: true, hideAds: true, hideRedditRecommended: true }) });
      await settle(4);
      assert.equal(NoSlop.engine.running, true);
      // the popup's tab messages are answered by the content script
      const recent = await browser.runtime.sendMessage({ type: 'getRecentHidden', limit: 5 });
      assert.deepEqual(JSON.parse(JSON.stringify(recent)), { site, items: [] });
      const shown = await browser.runtime.sendMessage({ type: 'showItem', id: 'nope' });
      assert.equal(shown.ok, true);
      const unknown = await browser.runtime.sendMessage({ type: 'somethingElse' });
      assert.equal(unknown, undefined, 'unknown message types are left for background.js');
      NoSlop.engine.stop();
      assert.deepEqual(errors, [], 'no errors / warnings during startup');
    });
  }

  test('every manifest content script and background.js passes a strict-parse (node --check equivalent)', () => {
    for (const f of [...CHAIN, ...manifest.background.scripts, 'lib/host-webview.js', 'lib/tiktok-main.js', 'popup/popup.js', 'adapters/_template.js']) {
      const src = fs.readFileSync(path.join(RESOURCES, f), 'utf8');
      assert.doesNotThrow(() => new vm.Script(src, { filename: f }), f);
      assert.ok(!/^\s*(?:import|export)\b/m.test(src), `${f} must be a classic script`);
    }
  });

  test('manifest lists every adapter and lib file in §2 order and exposes the TikTok relay as a web-accessible resource', () => {
    const adapters = fs.readdirSync(path.join(RESOURCES, 'adapters')).filter((f) => f.endsWith('.js') && !f.startsWith('_')).map((f) => 'adapters/' + f).sort();
    for (const a of adapters) assert.ok(CHAIN.includes(a), `${a} is in content_scripts`);
    const libs = ['lib/dom.js', 'lib/scorer.js', 'lib/host-extension.js', 'lib/engine.js'];
    for (const l of libs) assert.ok(CHAIN.includes(l), l);
    assert.equal(CHAIN[0], 'rules.js'); assert.equal(CHAIN[CHAIN.length - 1], 'content.js');
    assert.ok(CHAIN.indexOf('lib/engine.js') < CHAIN.indexOf('adapters/youtube.js'));
    assert.ok(CHAIN.indexOf('lib/host-extension.js') < CHAIN.indexOf('lib/engine.js'));
    assert.ok(!CHAIN.includes('lib/host-webview.js') && !CHAIN.includes('lib/tiktok-main.js'), 'webview shim and page-world relay are not content scripts');
    const war = manifest.web_accessible_resources;
    assert.ok(Array.isArray(war) && war.some((w) => (w.resources || []).includes('lib/tiktok-main.js') && (w.matches || []).includes('*://*.tiktok.com/*')));
    for (const f of CHAIN) assert.ok(fs.existsSync(path.join(RESOURCES, f)), f);
  });
});

describe('other runtimes', () => {
  test('Clean Feeds webview order (host-webview.js first, no host-extension.js) boots on instagram.com and keeps the webview host', async () => {
    const order = ['lib/host-webview.js', 'rules.js', 'lib/dom.js', 'lib/scorer.js', 'lib/engine.js', ...CHAIN.filter((f) => f.startsWith('adapters/')), 'content.js'];
    const ctx = await loadScripts(order, { url: 'https://www.instagram.com/', html: '<!doctype html><html><body><main role="main"></main></body></html>' });
    const errors = errorTrap(ctx.window);
    await settle(4);
    assert.equal(ctx.NoSlop.host.kind, 'webview', 'content.js must not replace the webview host');
    assert.equal(ctx.NoSlop.engine.running, true);
    assert.equal(ctx.NoSlop.engine.site, 'instagram');
    ctx.NoSlop.engine.stop();
    assert.deepEqual(errors, []);
  });

  test('background.js runs in a service-worker-like global (no window / document) with and without a native bridge', async () => {
    const src = fs.readFileSync(path.join(RESOURCES, 'background.js'), 'utf8');
    for (const native of [null, async (msg) => (msg.type === 'ping' ? { ok: true, version: '1', platform: 'macos' } : { ok: true, settings: null })]) {
      const browser = makeFakeBrowser({ alarms: true, native });
      const sandbox = { console, setTimeout, clearTimeout, setInterval, clearInterval, fetch: async () => ({ ok: true, text: async () => '' }), AbortController, URL, browser, chrome: browser };
      sandbox.globalThis = sandbox; sandbox.self = sandbox;
      vm.createContext(sandbox);
      assert.doesNotThrow(() => vm.runInContext(src, sandbox, { filename: 'background.js' }));
      await sandbox.NoSlop.bg.startupPromise;
      const r = await browser.runtime.sendMessage({ type: 'ping' });
      assert.equal(r.ok, true);
      assert.equal(r.platform, native ? 'macos' : null);
      const s = await browser.runtime.sendMessage({ type: 'getSettings' });
      assert.equal(s.settings.tiktokJsonRelay, true);
      assert.equal(s.settings.reelsAutoAdvance, true);
      assert.equal(s.settings.surfaces.hideRedditRecommended, false);
    }
  });

  test('lib/tiktok-main.js (page world) loads with neither `browser` nor `chrome` defined', () => {
    const src = fs.readFileSync(path.join(RESOURCES, 'lib/tiktok-main.js'), 'utf8');
    const sandbox = { console, setTimeout, clearTimeout, location: { origin: 'https://www.tiktok.com', href: 'https://www.tiktok.com/foryou' }, fetch: async () => ({ clone() { return this; }, text: async () => '{}' }), XMLHttpRequest: function () {}, postMessage() {} };
    sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
    vm.createContext(sandbox);
    assert.doesNotThrow(() => vm.runInContext(src, sandbox, { filename: 'tiktok-main.js' }));
    assert.equal(sandbox.__noslopTiktokMain, true);
  });
});
